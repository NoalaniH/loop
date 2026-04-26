import DeviceActivity
import UserNotifications
import Foundation
import os.log

private let loopLog = Logger(subsystem: "com.noalani.loop", category: "LoopScore")

// Runs in a separate extension process (com.apple.deviceactivity.monitor).
// DeviceActivity already confirmed the usage-time threshold, so this extension
// computes a behavior-aware Loop Score from the stateful signals in App Group
// and only fires when the score clears a context-sensitive threshold.

private let kAppGroup = "group.com.noalani.loop"
private let kAlertKey = "loop_pending_alert"

// SharedPreferences-equivalent keys (all stored in App Group UserDefaults)
private let kMaxPerDay          = "loop_score_max_per_day"
private let kCooldownMs         = "loop_score_cooldown_ms"
private let kTodayDate          = "loop_score_today_date"
private let kTodayCount         = "loop_score_today_count"
private let kLastNotifTime      = "loop_score_last_notification_time"
private let kConsecutiveIgnores = "loop_score_consecutive_ignores"
private let kLastIgnoreTime     = "loop_score_last_ignore_time"
private let kLastTapTime        = "loop_score_last_tap_time"
private let kHourlyPattern      = "loop_score_hourly_pattern"
private let kLastFireScore      = "loop_score_last_fire_score"
private let kConfidence         = "loop_score_confidence"

private let kMinPatternPoints   = 10  // require this many data points before using histogram

@available(iOS 16.0, *)
class LoopActivityMonitor: DeviceActivityMonitor {

  override func intervalDidStart(for activity: DeviceActivityName) {}

  override func eventDidReachThreshold(
    _ event: DeviceActivityEvent.Name,
    activity: DeviceActivityName
  ) {
    guard event.rawValue == "loop.threshold" else { return }
    guard let defaults = UserDefaults(suiteName: kAppGroup) else { return }

    // Adaptive cooldown — shorten window when prior notification was high-score
    let lastFireScore  = defaults.integer(forKey: kLastFireScore)
    let rawCooldownMs  = defaults.double(forKey: kCooldownMs)
    let baseCooldown   = rawCooldownMs > 0 ? rawCooldownMs : 30 * 60_000
    let effectiveCool  = lastFireScore > 70 ? baseCooldown * 0.8 : baseCooldown

    guard passesCooldownAndCap(defaults, effectiveCooldownMs: effectiveCool) else { return }

    let score      = computeScore(defaults)
    let todayCount = currentTodayCount(defaults)
    let threshold  = todayCount == 0 ? 35 : 50
    guard score >= threshold else { return }

    recordNotificationSent(defaults, score: score)
    defaults.set(true,  forKey: kAlertKey)
    defaults.set(Date().timeIntervalSince1970, forKey: "loop_alert_timestamp")
    writeTriggerJson(defaults, score: score)
    scheduleNotification()
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {}

  // ── Loop Score ────────────────────────────────────────────────────────────
  //
  // DeviceActivity already confirmed the usage-time threshold is met.
  // We start from a base that incorporates the learned pattern for this hour,
  // then apply behavioral/contextual signals.

  private func computeScore(_ defaults: UserDefaults) -> Int {
    let now             = Date().timeIntervalSince1970 * 1000  // ms
    let lastTap         = defaults.double(forKey: kLastTapTime)
    let minutesSinceTap = lastTap > 0 ? (now - lastTap) / 60_000 : Double.infinity

    let hour = Calendar.current.component(.hour, from: Date())
    let pd   = patternData(defaults, hour: hour)

    let patternBase = pd.hasEnoughData ? Int(pd.ratio * 10) : 0
    var score = 40 + patternBase

    let todBonus      = timeOfDayBonus(defaults: defaults, hour: hour, pd: pd)
    let engBonus      = engagementPressure(minutesSinceTap: minutesSinceTap)
    let tapBonusVal   = tapBoost(minutesSinceTap: minutesSinceTap)
    score += todBonus + engBonus + tapBonusVal

    let inQuietZone   = minutesSinceTap >= 60 && minutesSinceTap <= 240
    if inQuietZone { score = Int(Double(score) * 0.7) }

    let driftBonus    = (isLateNight(hour) && minutesSinceTap > 180) ? 10 : 0
    score += driftBonus

    let ignorePenalty = decayedIgnorePenalty(defaults: defaults, nowMs: now)
    score -= ignorePenalty

    let confidence    = defaults.double(forKey: kConfidence)
    let effectiveConf = confidence > 0 ? confidence : 1.0
    let preConfScore  = score
    score = Int(Double(score) * effectiveConf)

    let todayCount = currentTodayCount(defaults)
    let threshold  = todayCount == 0 ? 35 : 50

    let lastFireScore = defaults.integer(forKey: kLastFireScore)
    let rawCooldown   = defaults.double(forKey: kCooldownMs)
    let baseCooldown  = rawCooldown > 0 ? rawCooldown : 30 * 60_000
    let effCooldown   = lastFireScore > 70 ? baseCooldown * 0.8 : baseCooldown
    let lastNotif     = defaults.double(forKey: kLastNotifTime)
    let msSinceLast   = now - lastNotif

    loopLog.debug("""
      LoopScore │ hour=\(hour) patternData=(ratio=\(pd.ratio, format: .fixed(precision: 2)) hasData=\(pd.hasEnoughData))
        base=\(40)+pattern=\(patternBase) → \(40 + patternBase)
        timeOfDay=+\(todBonus)  engagement=+\(engBonus)  tapBoost=+\(tapBonusVal)
        quietZone=\(inQuietZone ? "×0.7" : "off")  drift=+\(driftBonus)  ignorePenalty=-\(ignorePenalty)
        preConf=\(preConfScore)  confidence=×\(effectiveConf, format: .fixed(precision: 3))  final=\(max(0, score))
        threshold=\(threshold)  cooldownMs=\(Int(effCooldown))  msSinceLast=\(Int(msSinceLast))
      """)

    return max(0, score)
  }

  // ── Signals ───────────────────────────────────────────────────────────────

  private func timeOfDayBonus(defaults: UserDefaults, hour: Int, pd: PatternData) -> Int {
    // Late-night: blended with learned pattern instead of fixed 20
    // No/low data → 15 (safe default). With data: 12–18 by pattern ratio.
    if isLateNight(hour) {
      return pd.hasEnoughData ? 12 + Int(pd.ratio * 6) : 15
    }

    let startHour = defaults.integer(forKey: "loop_active_start_hour").nonZero ?? 17
    let endHour   = defaults.integer(forKey: "loop_active_end_hour").nonZero   ?? 21
    if isInPeakWindow(hour: hour, startHour: startHour, endHour: endHour) { return 12 }
    if isInActiveHours(hour: hour, startHour: startHour, endHour: endHour) { return 5 }
    return 0
  }

  private func engagementPressure(minutesSinceTap: Double) -> Int {
    switch minutesSinceTap {
    case let m where m > 360: return 25
    case let m where m > 180: return 20
    case let m where m > 60:  return 10
    default:                  return 0
    }
  }

  private func tapBoost(minutesSinceTap: Double) -> Int {
    switch minutesSinceTap {
    case let m where m < 30: return 20
    case let m where m < 90: return 10
    default:                 return 0
    }
  }

  private func decayedIgnorePenalty(defaults: UserDefaults, nowMs: Double) -> Int {
    let ignores       = defaults.integer(forKey: kConsecutiveIgnores)
    let lastIgnoreMs  = defaults.double(forKey: kLastIgnoreTime)
    let hoursAgo      = lastIgnoreMs > 0 ? (nowMs - lastIgnoreMs) / 3_600_000 : 0
    let decayFactor   = max(0, 1 - hoursAgo / 24)
    let base: Int
    switch ignores {
    case 0:        base = 0
    case 1:        base = 10
    case 2:        base = 20
    case 3:        base = 40
    default:       base = 60
    }
    return Int(Double(base) * decayFactor)
  }

  // ── Pattern helpers ───────────────────────────────────────────────────────

  private struct PatternData {
    let ratio: Double
    let hasEnoughData: Bool
  }

  private func patternData(_ defaults: UserDefaults, hour: Int) -> PatternData {
    guard let raw = defaults.string(forKey: kHourlyPattern) else {
      return PatternData(ratio: 0, hasEnoughData: false)
    }
    let vals = raw.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    guard vals.count == 24 else { return PatternData(ratio: 0, hasEnoughData: false) }
    let total = vals.reduce(0, +)
    guard total >= kMinPatternPoints else { return PatternData(ratio: 0, hasEnoughData: false) }
    let maxVal = vals.max() ?? 0
    guard maxVal > 0 else { return PatternData(ratio: 0, hasEnoughData: false) }
    let ratio = Double(vals[hour]) / Double(maxVal)
    return PatternData(ratio: ratio, hasEnoughData: true)
  }

  // ── Contextual helpers ────────────────────────────────────────────────────

  private func isLateNight(_ hour: Int) -> Bool { hour >= 22 || hour < 2 }

  private func isInActiveHours(hour: Int, startHour: Int, endHour: Int) -> Bool {
    let effectiveEnd = endHour > 24 ? endHour - 24 : endHour
    return effectiveEnd > startHour
      ? hour >= startHour && hour < effectiveEnd
      : hour >= startHour || hour < effectiveEnd
  }

  private func isInPeakWindow(hour: Int, startHour: Int, endHour: Int) -> Bool {
    let effectiveEnd = endHour > 24 ? endHour - 24 : endHour
    let windowLen    = effectiveEnd > startHour ? effectiveEnd - startHour : 24 - startHour + effectiveEnd
    guard windowLen > 0 else { return false }
    let offset       = (hour - startHour + 24) % 24
    guard offset < windowLen else { return false }
    let position     = Double(offset) / Double(windowLen)
    return position >= 0.25 && position <= 0.75
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  private func passesCooldownAndCap(_ defaults: UserDefaults, effectiveCooldownMs: Double) -> Bool {
    let now        = Date().timeIntervalSince1970 * 1000
    let maxPerDay  = defaults.integer(forKey: kMaxPerDay).nonZero ?? 5
    let todayCount = currentTodayCount(defaults)
    if todayCount >= maxPerDay { return false }

    let lastNotif = defaults.double(forKey: kLastNotifTime)
    if lastNotif > 0 && (now - lastNotif) < effectiveCooldownMs { return false }

    return true
  }

  private func currentTodayCount(_ defaults: UserDefaults) -> Int {
    let today     = todayString()
    let savedDate = defaults.string(forKey: kTodayDate) ?? ""
    return savedDate == today ? defaults.integer(forKey: kTodayCount) : 0
  }

  private func recordNotificationSent(_ defaults: UserDefaults, score: Int) {
    let today      = todayString()
    let todayCount = currentTodayCount(defaults)
    let nowMs      = Date().timeIntervalSince1970 * 1000

    defaults.set(today,                              forKey: kTodayDate)
    defaults.set(todayCount + 1,                     forKey: kTodayCount)
    defaults.set(nowMs,                              forKey: kLastNotifTime)
    defaults.set(defaults.integer(forKey: kConsecutiveIgnores) + 1, forKey: kConsecutiveIgnores)
    defaults.set(nowMs,                              forKey: kLastIgnoreTime)
    defaults.set(score,                              forKey: kLastFireScore)
    updateHourlyPattern(defaults)
  }

  private func updateHourlyPattern(_ defaults: UserDefaults) {
    let hour  = Calendar.current.component(.hour, from: Date())
    let raw   = defaults.string(forKey: kHourlyPattern) ?? String(repeating: "0,", count: 23) + "0"
    var vals  = raw.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    if vals.count == 24 {
      vals[hour] += 1
      defaults.set(vals.map { String($0) }.joined(separator: ","), forKey: kHourlyPattern)
    }
  }

  private func todayString() -> String {
    let fmt        = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.timeZone   = TimeZone.current
    return fmt.string(from: Date())
  }

  // ── Trigger log ───────────────────────────────────────────────────────────

  private func writeTriggerJson(_ defaults: UserDefaults, score: Int) {
    let nowMs           = Date().timeIntervalSince1970 * 1000
    let lastTap         = defaults.double(forKey: kLastTapTime)
    let minutesSinceTap = lastTap > 0 ? (nowMs - lastTap) / 60_000 : -1.0
    let hour            = Calendar.current.component(.hour, from: Date())
    let isLate          = isLateNight(hour)
    let confRaw         = defaults.double(forKey: kConfidence)
    let confidence      = confRaw > 0 ? confRaw : 1.0
    let todayCount      = currentTodayCount(defaults)
    let threshold       = todayCount == 0 ? 35 : 50

    var factors: [String] = []
    if minutesSinceTap > 180  { factors.append("engagement") }
    else if minutesSinceTap >= 0 && minutesSinceTap < 30 { factors.append("tapBoost") }
    if isLate                 { factors.append("lateNight") }

    let topFactors = Array(factors.prefix(2))
    let obj: [String: Any] = [
      "timestamp":       nowMs,
      "hour":            hour,
      "minutesSinceTap": minutesSinceTap,
      "finalScore":      score,
      "threshold":       threshold,
      "topFactors":      topFactors,
      "confidence":      confidence,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: obj),
       let json = String(data: data, encoding: .utf8) {
      defaults.set(json, forKey: "loop_last_trigger_json")
    }
  }

  // ── Notification ──────────────────────────────────────────────────────────

  private func scheduleNotification() {
    let messages: [(title: String, body: String)] = [
      ("You've been looping.",    "Tap for one better thing."),
      ("Nothing new here.",       "One minute. Something different."),
      ("Same app, same scroll.",  "Break it."),
    ]
    let pick    = messages[Int(Date().timeIntervalSince1970) % messages.count]
    let content = UNMutableNotificationContent()
    content.title = pick.title
    content.body  = pick.body
    content.sound = nil

    let request = UNNotificationRequest(
      identifier: "loop.threshold.\(Int(Date().timeIntervalSince1970))",
      content:    content,
      trigger:    UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
    )
    UNUserNotificationCenter.current().add(request)
  }
}

// ── Convenience ───────────────────────────────────────────────────────────────

private extension Int {
  var nonZero: Int? { self == 0 ? nil : self }
}
