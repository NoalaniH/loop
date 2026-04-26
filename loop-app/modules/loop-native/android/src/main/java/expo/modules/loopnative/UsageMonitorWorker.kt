package expo.modules.loopnative

import android.app.AppOpsManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Process
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import androidx.work.*
import java.util.Calendar
import java.util.concurrent.TimeUnit

private const val WORK_TAG              = "loop_usage_monitor"
private const val CHANNEL_ID            = "loop_nudges"
private const val NOTIF_ID              = 2001
private const val THRESHOLD_FIRST_DAILY = 35
private const val THRESHOLD_DEFAULT     = 50
private const val MIN_PATTERN_POINTS    = 10  // require this many data points before using histogram

internal val APP_PACKAGE_MAP = mapOf(
  "Instagram"   to "com.instagram.android",
  "TikTok"      to "com.zhiliaoapp.musically",
  "X (Twitter)" to "com.twitter.android",
  "YouTube"     to "com.google.android.youtube",
  "Reddit"      to "com.reddit.frontpage",
  "Facebook"    to "com.facebook.katana",
  "Snapchat"    to "com.snapchat.android",
  "LinkedIn"    to "com.linkedin.android",
  "Pinterest"   to "com.pinterest",
  "Threads"     to "com.instagram.barcelona",
  "News"        to "com.google.android.apps.magazines",
  "Safari"      to "com.android.chrome",
)

private data class PatternData(val ratio: Float, val hasEnoughData: Boolean)

class UsageMonitorWorker(
  private val ctx: Context,
  workerParams: WorkerParameters,
) : Worker(ctx, workerParams) {

  companion object {
    fun schedule(context: Context, @Suppress("UNUSED_PARAMETER") params: Map<String, Any>) {
      val request = PeriodicWorkRequestBuilder<UsageMonitorWorker>(15, TimeUnit.MINUTES)
        .addTag(WORK_TAG)
        .build()
      WorkManager.getInstance(context).enqueueUniquePeriodicWork(
        WORK_TAG,
        ExistingPeriodicWorkPolicy.KEEP,
        request,
      )
    }

    fun cancel(context: Context) {
      WorkManager.getInstance(context).cancelAllWorkByTag(WORK_TAG)
    }
  }

  override fun doWork(): Result {
    if (!hasUsageAccess()) return Result.success()

    val prefs           = ctx.getSharedPreferences("loop_shared", Context.MODE_PRIVATE)
    val watchedPackages = resolveWatchedPackages(prefs)

    // ── Hard gates ────────────────────────────────────────────────────────────

    val maxPerDay     = prefs.getInt("loop_score_max_per_day", 5)
    val cooldownMs    = prefs.getLong("loop_score_cooldown_ms", 30 * 60_000L)
    val lastNotifTime = prefs.getLong("loop_score_last_notification_time", 0L)

    val today      = todayString()
    val savedDate  = prefs.getString("loop_score_today_date", "") ?: ""
    val todayCount = if (savedDate == today) prefs.getInt("loop_score_today_count", 0) else 0

    if (todayCount >= maxPerDay) return Result.success()

    // ── Adaptive cooldown — shorten window when prior notification was high-score ──
    val lastFireScore       = prefs.getInt("loop_score_last_fire_score", 0)
    val effectiveCooldownMs = if (lastFireScore > 70) (cooldownMs * 0.8).toLong() else cooldownMs
    if (System.currentTimeMillis() - lastNotifTime < effectiveCooldownMs) return Result.success()

    // ── Loop Score ────────────────────────────────────────────────────────────

    val score     = computeLoopScore(watchedPackages, prefs)
    val threshold = if (todayCount == 0) THRESHOLD_FIRST_DAILY else THRESHOLD_DEFAULT
    if (score < threshold) return Result.success()

    // ── Fire ──────────────────────────────────────────────────────────────────

    val now               = System.currentTimeMillis()
    val switchCounts      = getAppSwitches(watchedPackages, 30)
    val top               = switchCounts.maxByOrNull { it.value }
    val hour              = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    val consecutiveIgnores = prefs.getInt("loop_score_consecutive_ignores", 0)

    prefs.edit()
      .putString("loop_score_today_date",           today)
      .putInt("loop_score_today_count",             todayCount + 1)
      .putLong("loop_score_last_notification_time", now)
      .putInt("loop_score_consecutive_ignores",     consecutiveIgnores + 1)
      .putLong("loop_score_last_ignore_time",       now)
      .putInt("loop_score_last_fire_score",         score)
      .putBoolean("loop_pending_alert",             true)
      .putString("loop_alert_package",              top?.key ?: "")
      .apply()

    // Write trigger JSON so JS can read it on next foreground
    val lastTapMs    = prefs.getLong("loop_score_last_tap_time", 0L)
    val minsSinceTap = if (lastTapMs > 0) (now - lastTapMs) / 60_000L else -1L
    val confidence   = prefs.getFloat("loop_score_confidence", 1.0f)
    val totalSwitchesAtFire = switchCounts.values.sum()

    val factors = mutableListOf<String>()
    if (totalSwitchesAtFire >= 3) factors.add("switchRate")
    if ((top?.value ?: 0) >= 3)  factors.add("returnLoop")
    if (minsSinceTap > 180)       factors.add("engagement")
    else if (minsSinceTap in 0L..29L) factors.add("tapBoost")
    if (isLateNight(hour))        factors.add("lateNight")

    val triggerJson = JSONObject().apply {
      put("timestamp",       now)
      put("hour",            hour)
      put("minutesSinceTap", minsSinceTap)
      put("finalScore",      score)
      put("threshold",       threshold)
      put("topFactors",      JSONArray(factors.take(2)))
      put("confidence",      confidence.toDouble())
      put("switchCount",     totalSwitchesAtFire)
      top?.let { put("topPackage", it.key) }
    }.toString()
    prefs.edit().putString("loop_last_trigger_json", triggerJson).apply()

    updateHourlyPattern(prefs, hour)
    notify(top?.key ?: "", top?.value ?: 0)
    return Result.success()
  }

  // ── Loop Score Computation ────────────────────────────────────────────────

  private fun computeLoopScore(watchedPackages: Set<String>, prefs: SharedPreferences): Int {
    val now           = System.currentTimeMillis()
    val switchCounts  = getAppSwitches(watchedPackages, 30)
    val totalSwitches     = switchCounts.values.sum()
    val maxSwitchesOneApp = switchCounts.values.maxOrNull() ?: 0
    val topPkg            = switchCounts.maxByOrNull { it.value }?.key

    val switchScore = when {
      totalSwitches >= 5 -> 30
      totalSwitches >= 3 -> 20
      totalSwitches >= 1 -> 10
      else               -> 0
    }

    val sessionMinutes = if (topPkg != null) getSessionMinutes(topPkg) else 0L
    val sessionScore = when {
      sessionMinutes >= 15 -> 20
      sessionMinutes >= 8  -> 15
      sessionMinutes >= 3  -> 10
      else                 -> 0
    }

    val returnLoopScore = when {
      maxSwitchesOneApp >= 4 -> 15
      maxSwitchesOneApp >= 3 -> 8
      else                   -> 0
    }

    val rawSignalScore = switchScore + sessionScore + returnLoopScore

    // ── Contextual multiplier ─────────────────────────────────────────────
    val cal       = Calendar.getInstance()
    val hour      = cal.get(Calendar.HOUR_OF_DAY)
    val startHour = prefs.getInt("loop_active_start_hour", 17)
    val endHour   = prefs.getInt("loop_active_end_hour", 21)
    val pd        = hourlyPatternData(prefs, hour)

    val lateNightMult = if (isLateNight(hour)) {
      if (pd.hasEnoughData) 1.1f + pd.ratio * 0.3f else 1.2f
    } else 1.0f

    val peakMult    = peakWindowWeight(hour, startHour, endHour)
    val patternMult = if (pd.hasEnoughData) 0.8f + pd.ratio * 0.4f else 1.0f
    val contextMult = if (isLateNight(hour)) lateNightMult
                      else maxOf(peakMult, 1.0f) * patternMult

    var score = (rawSignalScore * contextMult).toInt()

    // ── Engagement timing ────────────────────────────────────────────────
    val lastTapTime     = prefs.getLong("loop_score_last_tap_time", 0L)
    val minutesSinceTap = if (lastTapTime > 0) (now - lastTapTime) / 60_000 else Long.MAX_VALUE

    val inQuietZone = minutesSinceTap in 60L..240L
    if (inQuietZone) score = (score * 0.7f).toInt()

    val engagementScore = when {
      minutesSinceTap > 360 -> 25
      minutesSinceTap > 180 -> 20
      minutesSinceTap > 60  -> 10
      else                  -> 0
    }
    score += engagementScore

    val tapBoost = when {
      minutesSinceTap < 30 -> 25
      minutesSinceTap < 90 -> 10
      else                 -> 0
    }
    score += tapBoost

    val driftBonus = if (isLateNight(hour) && minutesSinceTap > 180) 10 else 0
    score += driftBonus

    // ── Ignore decay penalty ──────────────────────────────────────────────
    val consecutiveIgnores = prefs.getInt("loop_score_consecutive_ignores", 0)
    val lastIgnoreTime     = prefs.getLong("loop_score_last_ignore_time", 0L)
    val hoursAgo           = if (lastIgnoreTime > 0) (now - lastIgnoreTime) / 3_600_000.0 else 0.0
    val decayFactor        = (1.0 - hoursAgo / 24.0).coerceAtLeast(0.0)
    val ignorePenaltyBase  = when (consecutiveIgnores) {
      0    -> 0
      1    -> 10
      2    -> 20
      3    -> 40
      else -> 60
    }
    val ignorePenalty = (ignorePenaltyBase * decayFactor).toInt()
    score -= ignorePenalty

    // ── Confidence factor ────────────────────────────────────────────────
    val confidence  = prefs.getFloat("loop_score_confidence", 1.0f)
    val preConfScore = score
    score = (score * confidence).toInt()

    val todayCount  = prefs.getInt("loop_score_today_count", 0)
    val threshold   = if (todayCount == 0) THRESHOLD_FIRST_DAILY else THRESHOLD_DEFAULT
    val lastFireScore    = prefs.getInt("loop_score_last_fire_score", 0)
    val cooldownMs       = prefs.getLong("loop_score_cooldown_ms", 30 * 60_000L)
    val effCooldownMs    = if (lastFireScore > 70) (cooldownMs * 0.8).toLong() else cooldownMs
    val lastNotifTime    = prefs.getLong("loop_score_last_notification_time", 0L)
    val msSinceLast      = now - lastNotifTime

    Log.d(LOG_TAG, buildString {
      append("LoopScore | hour=$hour patternData=(ratio=${"%.2f".format(pd.ratio)} hasData=${pd.hasEnoughData})\n")
      append("  signals: switch=$switchScore session=$sessionScore returnLoop=$returnLoopScore raw=$rawSignalScore\n")
      append("  contextMult=${"%.2f".format(contextMult)} (lateNight=${"%.2f".format(lateNightMult)} peak=${"%.2f".format(peakMult)} pattern=${"%.2f".format(patternMult)})\n")
      append("  quietZone=${if (inQuietZone) "×0.7" else "off"}  engagement=+$engagementScore  tapBoost=+$tapBoost  drift=+$driftBonus\n")
      append("  ignorePenalty=-$ignorePenalty (ignores=$consecutiveIgnores decay=${"%.2f".format(decayFactor)})\n")
      append("  preConf=$preConfScore  confidence=×${"%.3f".format(confidence)}  final=${score.coerceAtLeast(0)}\n")
      append("  threshold=$threshold  cooldownMs=$effCooldownMs  msSinceLast=$msSinceLast")
    })

    return score.coerceAtLeast(0)
  }

  // ── Contextual helpers ────────────────────────────────────────────────────

  private fun hourlyPatternData(prefs: SharedPreferences, hour: Int): PatternData {
    val raw  = prefs.getString("loop_score_hourly_pattern", null) ?: return PatternData(0f, false)
    val vals = raw.split(",").mapNotNull { it.trim().toIntOrNull() }
    if (vals.size != 24) return PatternData(0f, false)
    if (vals.sum() < MIN_PATTERN_POINTS) return PatternData(0f, false)
    val maxVal = vals.max()
    if (maxVal == 0) return PatternData(0f, false)
    val ratio  = vals.getOrElse(hour) { 0 }.toFloat() / maxVal
    return PatternData(ratio, true)
  }

  private fun isLateNight(hour: Int): Boolean = hour >= 22 || hour < 2

  private fun peakWindowWeight(hour: Int, startHour: Int, rawEndHour: Int): Float {
    val endHour   = if (rawEndHour > 24) rawEndHour - 24 else rawEndHour
    val windowLen = if (endHour > startHour) endHour - startHour else 24 - startHour + endHour
    if (windowLen == 0) return 1.0f
    val offset    = ((hour - startHour + 24) % 24).let { if (it < windowLen) it else return 1.0f }
    val position  = offset.toFloat() / windowLen
    return if (position in 0.25f..0.75f) 1.2f else 1.0f
  }

  private fun updateHourlyPattern(prefs: SharedPreferences, hour: Int) {
    val raw  = prefs.getString("loop_score_hourly_pattern", null)
    val vals = raw?.split(",")?.mapNotNull { it.trim().toIntOrNull() }?.toMutableList()
             ?: MutableList(24) { 0 }
    if (vals.size == 24) {
      vals[hour] = vals[hour] + 1
      prefs.edit().putString("loop_score_hourly_pattern", vals.joinToString(",")).apply()
    }
  }

  // ── Usage helpers ─────────────────────────────────────────────────────────

  private fun getAppSwitches(watchedPackages: Set<String>, windowMinutes: Long): Map<String, Int> {
    val mgr   = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val now   = System.currentTimeMillis()
    val start = now - TimeUnit.MINUTES.toMillis(windowMinutes)
    val query = mgr.queryEvents(start, now)
    val counts = mutableMapOf<String, Int>()
    val ev    = UsageEvents.Event()
    while (query.hasNextEvent()) {
      query.getNextEvent(ev)
      if (ev.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
        if (watchedPackages.isNotEmpty() && ev.packageName !in watchedPackages) continue
        counts[ev.packageName] = (counts[ev.packageName] ?: 0) + 1
      }
    }
    return counts
  }

  private fun getSessionMinutes(packageName: String): Long {
    val mgr   = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val now   = System.currentTimeMillis()
    val start = now - TimeUnit.HOURS.toMillis(1)
    val query = mgr.queryEvents(start, now)
    var lastResume = 0L
    val ev    = UsageEvents.Event()
    while (query.hasNextEvent()) {
      query.getNextEvent(ev)
      if (ev.packageName == packageName && ev.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
        lastResume = ev.timeStamp
      }
    }
    return if (lastResume > 0) (now - lastResume) / 60_000 else 0L
  }

  private fun resolveWatchedPackages(prefs: SharedPreferences): Set<String> {
    val saved = prefs.getStringSet("loop_apps", emptySet()) ?: emptySet()
    return saved.mapNotNull { APP_PACKAGE_MAP[it] }.toSet()
  }

  private fun todayString(): String {
    val cal = Calendar.getInstance()
    val y   = cal.get(Calendar.YEAR)
    val m   = (cal.get(Calendar.MONTH) + 1).toString().padStart(2, '0')
    val d   = cal.get(Calendar.DAY_OF_MONTH).toString().padStart(2, '0')
    return "$y-$m-$d"
  }

  // ── Notification ──────────────────────────────────────────────────────────

  private fun notify(pkg: String, count: Int) {
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(CHANNEL_ID, "Loop Nudges", NotificationManager.IMPORTANCE_DEFAULT)
        .also { it.setSound(null, null) }
      nm.createNotificationChannel(ch)
    }

    val launchIntent = ctx.packageManager
      .getLaunchIntentForPackage(ctx.packageName)
      ?.apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP }

    val pi = PendingIntent.getActivity(
      ctx, 0, launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val messages = listOf(
      "You've been looping."    to "Tap for one better thing.",
      "Same app, same scroll."  to "Break it.",
      "Nothing new here."       to "One minute. Something different.",
    )
    val (title, body) = messages[(count + System.currentTimeMillis() / 1000).toInt() % messages.size]

    val notif = NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle(title)
      .setContentText(body)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setContentIntent(pi)
      .setAutoCancel(true)
      .setSound(null)
      .build()

    nm.notify(NOTIF_ID, notif)
  }

  private fun hasUsageAccess(): Boolean {
    val ops  = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = ops.checkOpNoThrow(
      AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName
    )
    return mode == AppOpsManager.MODE_ALLOWED
  }
}
