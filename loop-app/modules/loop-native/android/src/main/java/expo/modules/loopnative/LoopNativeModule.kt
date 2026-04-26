package expo.modules.loopnative

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Process
import android.provider.Settings
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.util.Calendar
import java.util.concurrent.TimeUnit

private const val LOG_TAG = "LoopScore"
private const val MIN_PATTERN_POINTS = 10

class LoopNativeModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "ReactContext is null" }

  override fun definition() = ModuleDefinition {
    Name("LoopNative")
    Events("onLoopDetected", "onPermissionStatusChanged", "onSelectedAppsUpdated")

    // ── Permissions ────────────────────────────────────────────────────────

    AsyncFunction("requestUsageAccessPermission") {
      val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      context.startActivity(intent)
      sendEvent("onPermissionStatusChanged", mapOf(
        "platform" to "android", "type" to "usageAccess", "status" to "notDetermined"
      ))
    }

    AsyncFunction("checkUsageAccessPermission") { ->
      val granted = hasUsageAccess()
      sendEvent("onPermissionStatusChanged", mapOf(
        "platform" to "android", "type" to "usageAccess",
        "status" to if (granted) "granted" else "denied"
      ))
      granted
    }

    // ── Raw event reads ────────────────────────────────────────────────────

    AsyncFunction("getRecentUsageEvents") { hoursBack: Int ->
      check(hasUsageAccess()) { "Usage access not granted" }

      val mgr = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val end   = System.currentTimeMillis()
      val start = end - TimeUnit.HOURS.toMillis(hoursBack.toLong())

      val result = mgr.queryEvents(start, end)
      val list   = mutableListOf<Map<String, Any>>()
      val ev     = UsageEvents.Event()

      while (result.hasNextEvent()) {
        result.getNextEvent(ev)
        if (ev.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
          list.add(mapOf(
            "packageName" to ev.packageName,
            "timestamp"   to ev.timeStamp,
            "eventType"   to ev.eventType,
          ))
        }
      }
      list
    }

    // ── Loop detection (in-process) ────────────────────────────────────────

    AsyncFunction("detectLoopFromEvents") { hoursBack: Int ->
      if (!hasUsageAccess()) return@AsyncFunction false

      val mgr   = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val end   = System.currentTimeMillis()
      val start = end - TimeUnit.HOURS.toMillis(hoursBack.toLong())

      val result = mgr.queryEvents(start, end)
      val counts = mutableMapOf<String, Int>()
      val ev     = UsageEvents.Event()

      while (result.hasNextEvent()) {
        result.getNextEvent(ev)
        if (ev.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
          counts[ev.packageName] = (counts[ev.packageName] ?: 0) + 1
        }
      }

      val top     = counts.maxByOrNull { it.value }
      val looping = top != null && top.value >= 3

      if (looping) {
        sendEvent("onLoopDetected", mapOf(
          "platform"   to "android",
          "timestamp"  to System.currentTimeMillis(),
          "appPackage" to top!!.key,
          "openCount"  to top.value,
        ))
      }
      looping
    }

    // ── Background WorkManager monitoring ──────────────────────────────────

    AsyncFunction("startUsageMonitoring") { params: Map<String, Any> ->
      @Suppress("UNCHECKED_CAST")
      val loopApps = (params["loopApps"] as? List<String>)?.toSet() ?: emptySet()
      context.getSharedPreferences("loop_shared", Context.MODE_PRIVATE)
        .edit()
        .putBoolean("native_monitoring_active", true)
        .putStringSet("loop_apps", loopApps)
        .putInt("loop_active_start_hour", (params["startHour"] as? Number)?.toInt() ?: 17)
        .putInt("loop_active_end_hour",   (params["endHour"]   as? Number)?.toInt() ?: 21)
        .apply()
      UsageMonitorWorker.schedule(context, params)
      true
    }

    // ── Loop Score state sync ──────────────────────────────────────────────

    AsyncFunction("syncLoopScoreState") { params: Map<String, Any> ->
      val prefs = context.getSharedPreferences("loop_shared", Context.MODE_PRIVATE)
      val edit  = prefs.edit()

      (params["maxPerDay"]  as? Number)?.let { edit.putInt("loop_score_max_per_day", it.toInt()) }
      (params["cooldownMs"] as? Number)?.let { edit.putLong("loop_score_cooldown_ms", it.toLong()) }
      (params["lastTapTime"] as? Number)?.let {
        val newTap  = it.toLong()
        val prevTap = prefs.getLong("loop_score_last_tap_time", 0L)
        if (newTap > prevTap) {
          edit.putInt("loop_score_consecutive_ignores", 0)
          val currentConf = prefs.getFloat("loop_score_confidence", 1.0f)
          val newConf     = minOf(1.0f, currentConf + 0.05f)
          edit.putFloat("loop_score_confidence", newConf)
          Log.d(LOG_TAG, "confidence: tap recorded  ${"%.3f".format(currentConf)} → ${"%.3f".format(newConf)}")
        }
        edit.putLong("loop_score_last_tap_time", newTap)
      }
      (params["feedbackGood"] as? Boolean)?.let { good ->
        val currentConf = prefs.getFloat("loop_score_confidence", 1.0f)
        val newConf = if (good) minOf(1.0f, currentConf + 0.08f)
                      else      maxOf(0.5f, currentConf * 0.88f)
        edit.putFloat("loop_score_confidence", newConf)
        Log.d(LOG_TAG, "confidence: feedback=${if (good) "good" else "bad"}  ${"%.3f".format(currentConf)} → ${"%.3f".format(newConf)}")
      }
      edit.apply()
      true
    }

    AsyncFunction("stopUsageMonitoring") { ->
      UsageMonitorWorker.cancel(context)
      context.getSharedPreferences("loop_shared", Context.MODE_PRIVATE)
        .edit().putBoolean("native_monitoring_active", false).apply()
      true
    }

    // ── Pending-alert handshake ────────────────────────────────────────────

    AsyncFunction("checkPendingLoopAlert") { ->
      val prefs   = context.getSharedPreferences("loop_shared", Context.MODE_PRIVATE)
      val pending = prefs.getBoolean("loop_pending_alert", false)
      if (pending) {
        val now       = System.currentTimeMillis()
        val alertTime = prefs.getLong("loop_score_last_notification_time", 0L)
        val alertPkg  = prefs.getString("loop_alert_package", "") ?: ""
        val lastTap   = prefs.getLong("loop_score_last_tap_time", 0L)
        val tapAfterAlert = lastTap > alertTime && alertTime > 0

        val outcome: String
        if (tapAfterAlert) {
          outcome = "tapped"
        } else if (alertPkg.isNotEmpty() && alertTime > 0
                   && (now - alertTime) < 5 * 60_000L && hasUsageAccess()
                   && hasUserReturnedToApp(alertPkg, alertTime)) {
          outcome = "returnedToApp"
          val currentConf = prefs.getFloat("loop_score_confidence", 1.0f)
          val newConf     = maxOf(0.5f, currentConf * 0.9f)
          prefs.edit().putFloat("loop_score_confidence", newConf).apply()
          Log.d(LOG_TAG, "confidence: failed intervention  ${"%.3f".format(currentConf)} → ${"%.3f".format(newConf)}  pkg=$alertPkg")
        } else {
          outcome = "ignored"
        }

        prefs.edit()
          .putBoolean("loop_pending_alert", false)
          .putString("loop_last_alert_outcome", outcome)
          .apply()

        sendEvent("onLoopDetected", mapOf(
          "platform"  to "android",
          "timestamp" to now,
        ))
      }
      pending
    }

    // ── Debug: real-time score breakdown ───────────────────────────────────

    AsyncFunction("getDebugScoreState") { ->
      val prefs = context.getSharedPreferences("loop_shared", Context.MODE_PRIVATE)
      val now   = System.currentTimeMillis()

      val watchedPackages   = resolveWatchedPackages(prefs)
      val switchCounts      = if (hasUsageAccess()) getAppSwitches(watchedPackages, 30) else emptyMap()
      val totalSwitches     = switchCounts.values.sum()
      val maxSwitchesOneApp = switchCounts.values.maxOrNull() ?: 0
      val topPkg            = switchCounts.maxByOrNull { it.value }?.key
      val sessionMins       = if (topPkg != null && hasUsageAccess()) getSessionMinutes(topPkg) else 0L

      val switchScore = when {
        totalSwitches >= 5 -> 30
        totalSwitches >= 3 -> 20
        totalSwitches >= 1 -> 10
        else               -> 0
      }
      val sessionScore = when {
        sessionMins >= 15 -> 20
        sessionMins >= 8  -> 15
        sessionMins >= 3  -> 10
        else              -> 0
      }
      val returnLoopScore = when {
        maxSwitchesOneApp >= 4 -> 15
        maxSwitchesOneApp >= 3 -> 8
        else                   -> 0
      }
      val rawSignalScore = switchScore + sessionScore + returnLoopScore

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

      val rawScore   = score.coerceAtLeast(0)
      val confidence = prefs.getFloat("loop_score_confidence", 1.0f)
      val finalScore = (rawScore * confidence).toInt().coerceAtLeast(0)

      val today      = todayString()
      val savedDate  = prefs.getString("loop_score_today_date", "") ?: ""
      val todayCount = if (savedDate == today) prefs.getInt("loop_score_today_count", 0) else 0
      val maxPerDay  = prefs.getInt("loop_score_max_per_day", 5)
      val threshold  = if (todayCount == 0) 35 else 50

      val lastFireScore = prefs.getInt("loop_score_last_fire_score", 0)
      val cooldownMs    = prefs.getLong("loop_score_cooldown_ms", 30 * 60_000L)
      val effCooldown   = if (lastFireScore > 70) (cooldownMs * 0.8).toLong() else cooldownMs
      val lastNotifTime = prefs.getLong("loop_score_last_notification_time", 0L)
      val cooldownRemMs = (effCooldown - (now - lastNotifTime)).coerceAtLeast(0L)

      val minsSinceTapInt = if (minutesSinceTap == Long.MAX_VALUE) 999999 else minutesSinceTap.toInt()

      mapOf(
        "hour"               to hour,
        "isLateNight"        to isLateNight(hour),
        "inQuietZone"        to inQuietZone,
        "minutesSinceTap"    to minsSinceTapInt,
        "patternHasData"     to pd.hasEnoughData,
        "patternRatio"       to pd.ratio,
        "patternBase"        to 0,
        "timeOfDayBonus"     to 0,
        "engagementScore"    to engagementScore,
        "tapBoost"           to tapBoost,
        "driftBonus"         to driftBonus,
        "ignorePenalty"      to ignorePenalty,
        "switchCount"        to totalSwitches,
        "maxSwitchesOneApp"  to maxSwitchesOneApp,
        "sessionMinutes"     to sessionMins.toInt(),
        "topPackage"         to (topPkg ?: ""),
        "switchScore"        to switchScore,
        "sessionScore"       to sessionScore,
        "returnLoopScore"    to returnLoopScore,
        "contextMult"        to contextMult,
        "lateNightMult"      to lateNightMult,
        "peakMult"           to peakMult,
        "patternMult"        to patternMult,
        "rawScore"           to rawScore,
        "finalScore"         to finalScore,
        "threshold"          to threshold,
        "wouldFire"          to (finalScore >= threshold),
        "consecutiveIgnores" to consecutiveIgnores,
        "confidence"         to confidence,
        "todayCount"         to todayCount,
        "maxPerDay"          to maxPerDay,
        "cooldownRemainingMs" to cooldownRemMs,
        "lastFireScore"      to lastFireScore,
      )
    }

    // ── Trigger log ────────────────────────────────────────────────────────

    AsyncFunction("getAndClearTriggerJson") { ->
      val prefs       = context.getSharedPreferences("loop_shared", Context.MODE_PRIVATE)
      val triggerJson = prefs.getString("loop_last_trigger_json", null)
        ?: return@AsyncFunction null
      val outcome     = prefs.getString("loop_last_alert_outcome", null)

      val result = if (outcome != null) {
        try {
          val obj = JSONObject(triggerJson)
          obj.put("outcome", outcome)
          obj.toString()
        } catch (_: Exception) { triggerJson }
      } else triggerJson

      prefs.edit()
        .remove("loop_last_trigger_json")
        .remove("loop_last_alert_outcome")
        .apply()

      result
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private fun hasUsageAccess(): Boolean {
    val ops  = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = ops.checkOpNoThrow(
      AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName
    )
    return mode == AppOpsManager.MODE_ALLOWED
  }

  private fun hasUserReturnedToApp(packageName: String, sinceTime: Long): Boolean {
    val mgr   = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val now   = System.currentTimeMillis()
    val query = mgr.queryEvents(sinceTime, now)
    val ev    = UsageEvents.Event()
    while (query.hasNextEvent()) {
      query.getNextEvent(ev)
      if (ev.packageName == packageName && ev.eventType == UsageEvents.Event.ACTIVITY_RESUMED
          && ev.timeStamp > sinceTime) {
        return true
      }
    }
    return false
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

  private data class PatternData(val ratio: Float, val hasEnoughData: Boolean)

  private fun hourlyPatternData(prefs: SharedPreferences, hour: Int): PatternData {
    val raw  = prefs.getString("loop_score_hourly_pattern", null) ?: return PatternData(0f, false)
    val vals = raw.split(",").mapNotNull { it.trim().toIntOrNull() }
    if (vals.size != 24) return PatternData(0f, false)
    if (vals.sum() < MIN_PATTERN_POINTS) return PatternData(0f, false)
    val maxVal = vals.maxOrNull() ?: 0
    if (maxVal == 0) return PatternData(0f, false)
    val ratio  = vals.getOrElse(hour) { 0 }.toFloat() / maxVal
    return PatternData(ratio, true)
  }

  private fun getAppSwitches(watchedPackages: Set<String>, windowMinutes: Long): Map<String, Int> {
    val mgr   = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
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
    val mgr   = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
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
}
