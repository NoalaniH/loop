import ExpoModulesCore
import FamilyControls
import DeviceActivity
import ManagedSettings
import SwiftUI
import os.log

private let loopLog = Logger(subsystem: "com.noalani.loop", category: "LoopScore")

private let kAppGroup     = "group.com.noalani.loop"
private let kActivityName = DeviceActivityName("loop.monitoring")
private let kEventName    = DeviceActivityEvent.Name("loop.threshold")
private let kSelectionKey = "loop_selected_apps"
private let kAlertKey     = "loop_pending_alert"

@available(iOS 16.0, *)
public class LoopNativeModule: Module {

  // Loaded from App Group on first use so it survives app kills.
  private lazy var selection: FamilyActivitySelection = loadSelection()

  public func definition() -> ModuleDefinition {
    Name("LoopNative")
    Events("onLoopDetected", "onPermissionStatusChanged", "onSelectedAppsUpdated")

    // ── Screen Time authorization ──────────────────────────────────────────

    AsyncFunction("requestScreenTimeAuthorization") { () async throws -> Bool in
      do {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        let granted = AuthorizationCenter.shared.authorizationStatus == .approved
        self.sendEvent("onPermissionStatusChanged", [
          "platform": "ios", "type": "screenTime",
          "status": granted ? "granted" : "denied",
        ])
        return granted
      } catch {
        throw NSError(domain: "LoopNative", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: error.localizedDescription])
      }
    }

    AsyncFunction("getScreenTimeAuthorizationStatus") { () -> String in
      switch AuthorizationCenter.shared.authorizationStatus {
      case .approved:       return "granted"
      case .denied:         return "denied"
      case .notDetermined:  return "notDetermined"
      @unknown default:     return "unknown"
      }
    }

    // ── FamilyActivityPicker ───────────────────────────────────────────────

    AsyncFunction("presentAppPicker") { () async throws -> Bool in
      return try await withCheckedThrowingContinuation { continuation in
        DispatchQueue.main.async {
          guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first,
            let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
          else {
            continuation.resume(throwing: NSError(
              domain: "LoopNative", code: 2,
              userInfo: [NSLocalizedDescriptionKey: "No root view controller found"]))
            return
          }

          let pickerVC = UIHostingController(
            rootView: AppPickerView(
              initialSelection: self.selection,
              onDone: { [weak self] newSelection in
                guard let self else { return }
                self.selection = newSelection
                self.saveSelection(newSelection)
                self.sendEvent("onSelectedAppsUpdated", [:])
                root.dismiss(animated: true)
                continuation.resume(returning: true)
              },
              onCancel: {
                root.dismiss(animated: true)
                continuation.resume(returning: false)
              }
            )
          )
          pickerVC.isModalInPresentation = true
          root.present(pickerVC, animated: true)
        }
      }
    }

    // ── DeviceActivity monitoring ─────────────────────────────────────────

    AsyncFunction("startMonitoring") { (params: [String: Any]) throws -> Bool in
      let startH  = params["startHour"]        as? Int ?? 0
      let startM  = params["startMinute"]      as? Int ?? 0
      let endH    = params["endHour"]          as? Int ?? 23
      let endM    = params["endMinute"]        as? Int ?? 59
      let thresh  = params["thresholdMinutes"] as? Int ?? 5

      // Persist active hours to App Group so the extension can use them for scoring
      if let defaults = UserDefaults(suiteName: kAppGroup) {
        defaults.set(startH, forKey: "loop_active_start_hour")
        defaults.set(endH,   forKey: "loop_active_end_hour")
      }

      let center = DeviceActivityCenter()
      center.stopMonitoring([kActivityName])

      let schedule = DeviceActivitySchedule(
        intervalStart: DateComponents(hour: startH, minute: startM),
        intervalEnd:   DateComponents(hour: endH,   minute: endM),
        repeats: true
      )

      // Re-load persisted selection so this survives app kills
      let currentSelection = self.loadSelection()
      self.selection = currentSelection

      let event = DeviceActivityEvent(
        applications: currentSelection.applicationTokens,
        categories:   currentSelection.categoryTokens,
        threshold:    DateComponents(minute: thresh)
      )

      do {
        try center.startMonitoring(kActivityName, during: schedule,
                                   events: [kEventName: event])
        return true
      } catch {
        throw NSError(domain: "LoopNative", code: 3,
                      userInfo: [NSLocalizedDescriptionKey: error.localizedDescription])
      }
    }

    AsyncFunction("stopMonitoring") { () -> Bool in
      DeviceActivityCenter().stopMonitoring([kActivityName])
      return true
    }

    // ── Loop Score state sync ─────────────────────────────────────────────

    AsyncFunction("syncLoopScoreState") { (params: [String: Any]) -> Bool in
      guard let defaults = UserDefaults(suiteName: kAppGroup) else { return false }

      if let maxPerDay = params["maxPerDay"] as? Int {
        defaults.set(maxPerDay, forKey: "loop_score_max_per_day")
      }
      if let cooldownMs = params["cooldownMs"] as? Double {
        defaults.set(cooldownMs, forKey: "loop_score_cooldown_ms")
      }
      if let lastTapTime = params["lastTapTime"] as? Double {
        let prevTap = defaults.double(forKey: "loop_score_last_tap_time")
        if lastTapTime > prevTap {
          defaults.set(0, forKey: "loop_score_consecutive_ignores")
          let currentConf   = defaults.double(forKey: "loop_score_confidence")
          let effectiveConf = currentConf > 0 ? currentConf : 1.0
          let newConf       = min(1.0, effectiveConf + 0.05)
          defaults.set(newConf, forKey: "loop_score_confidence")
          loopLog.debug("confidence: tap recorded  \(effectiveConf, format: .fixed(precision: 3)) → \(newConf, format: .fixed(precision: 3))")
        }
        defaults.set(lastTapTime, forKey: "loop_score_last_tap_time")
      }
      if let feedbackGood = params["feedbackGood"] as? Bool {
        let currentConf   = defaults.double(forKey: "loop_score_confidence")
        let effectiveConf = currentConf > 0 ? currentConf : 1.0
        let newConf       = feedbackGood
          ? min(1.0, effectiveConf + 0.08)
          : max(0.5, effectiveConf * 0.88)
        defaults.set(newConf, forKey: "loop_score_confidence")
        loopLog.debug("confidence: feedback=\(feedbackGood ? "good" : "bad")  \(effectiveConf, format: .fixed(precision: 3)) → \(newConf, format: .fixed(precision: 3))")
      }
      return true
    }

    // ── Pending alert check (call on app foreground) ──────────────────────

    AsyncFunction("checkPendingLoopAlert") { () -> Bool in
      guard let defaults = UserDefaults(suiteName: kAppGroup) else { return false }
      let pending = defaults.bool(forKey: kAlertKey)
      if pending {
        let nowSec         = Date().timeIntervalSince1970
        let alertTimestamp = defaults.double(forKey: "loop_alert_timestamp")
        let lastTap        = defaults.double(forKey: "loop_score_last_tap_time") / 1000
        let tapAfterAlert  = lastTap > alertTimestamp && alertTimestamp > 0

        let minutesSinceAlert = alertTimestamp > 0 ? (nowSec - alertTimestamp) / 60 : 0.0

        if !tapAfterAlert && alertTimestamp > 0 {
          let currentConf   = defaults.double(forKey: "loop_score_confidence")
          let effectiveConf = currentConf > 0 ? currentConf : 1.0
          let newConf: Double
          let reason: String
          if minutesSinceAlert < 3 {
            newConf = min(1.0, effectiveConf * 1.02)
            reason  = "quick open (weak signal)"
          } else if minutesSinceAlert > 20 {
            newConf = max(0.5, effectiveConf * 0.97)
            reason  = "long delay (likely ignored)"
          } else {
            newConf = effectiveConf
            reason  = "neutral timing"
          }
          defaults.set(newConf, forKey: "loop_score_confidence")
          loopLog.debug("confidence: \(reason)  \(effectiveConf, format: .fixed(precision: 3)) → \(newConf, format: .fixed(precision: 3))  minutesSinceAlert=\(minutesSinceAlert, format: .fixed(precision: 1))")
        }

        let outcome: String
        if tapAfterAlert {
          outcome = "tapped"
        } else if minutesSinceAlert > 20 {
          outcome = "ignored"
        } else {
          outcome = "returnedToApp"
        }
        defaults.set(outcome, forKey: "loop_last_alert_outcome")
        defaults.set(false, forKey: kAlertKey)
        self.sendEvent("onLoopDetected", [
          "platform": "ios",
          "timestamp": nowSec * 1000,
        ])
      }
      return pending
    }

    // ── Trigger log ───────────────────────────────────────────────────────

    AsyncFunction("getAndClearTriggerJson") { () -> String? in
      guard let defaults = UserDefaults(suiteName: kAppGroup) else { return nil }
      guard let triggerJson = defaults.string(forKey: "loop_last_trigger_json") else { return nil }
      let outcome = defaults.string(forKey: "loop_last_alert_outcome")

      var result = triggerJson
      if let outcome, var obj = try? JSONSerialization.jsonObject(with: Data(triggerJson.utf8)) as? [String: Any] {
        obj["outcome"] = outcome
        if let data = try? JSONSerialization.data(withJSONObject: obj),
           let merged = String(data: data, encoding: .utf8) {
          result = merged
        }
      }

      defaults.removeObject(forKey: "loop_last_trigger_json")
      defaults.removeObject(forKey: "loop_last_alert_outcome")
      return result
    }

    // ── Debug: real-time score breakdown ──────────────────────────────────

    AsyncFunction("getDebugScoreState") { () -> [String: Any] in
      guard let defaults = UserDefaults(suiteName: kAppGroup) else { return [:] }

      let nowMs           = Date().timeIntervalSince1970 * 1000
      let lastTap         = defaults.double(forKey: "loop_score_last_tap_time")
      let minutesSinceTap = lastTap > 0 ? (nowMs - lastTap) / 60_000 : Double.infinity

      let hour = Calendar.current.component(.hour, from: Date())
      let raw  = defaults.string(forKey: "loop_score_hourly_pattern") ?? ""
      let vals = raw.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
      let patternHasData = vals.count == 24 && vals.reduce(0, +) >= 10
      let patternRatio: Double
      if patternHasData, let maxVal = vals.max(), maxVal > 0 {
        patternRatio = Double(vals[hour]) / Double(maxVal)
      } else {
        patternRatio = 0
      }
      let patternBase = patternHasData ? Int(patternRatio * 10) : 0
      var score = 40 + patternBase

      let isLateNight  = hour >= 22 || hour < 2
      let startHour    = defaults.integer(forKey: "loop_active_start_hour").nonZero ?? 17
      let endHour      = defaults.integer(forKey: "loop_active_end_hour").nonZero   ?? 21

      let timeOfDayBonus: Int
      if isLateNight {
        timeOfDayBonus = patternHasData ? 12 + Int(patternRatio * 6) : 15
      } else {
        let effectiveEnd = endHour > 24 ? endHour - 24 : endHour
        let windowLen    = effectiveEnd > startHour ? effectiveEnd - startHour : 24 - startHour + effectiveEnd
        let offset       = (hour - startHour + 24) % 24
        let inWindow     = offset < windowLen
        let position     = windowLen > 0 ? Double(offset) / Double(windowLen) : 0
        let inPeak       = inWindow && position >= 0.25 && position <= 0.75
        timeOfDayBonus = inPeak ? 12 : (inWindow ? 5 : 0)
      }

      let engagementScore: Int
      switch minutesSinceTap {
      case let m where m > 360: engagementScore = 25
      case let m where m > 180: engagementScore = 20
      case let m where m > 60:  engagementScore = 10
      default:                  engagementScore = 0
      }

      let tapBoost: Int
      switch minutesSinceTap {
      case let m where m < 30: tapBoost = 20
      case let m where m < 90: tapBoost = 10
      default:                 tapBoost = 0
      }

      score += timeOfDayBonus + engagementScore + tapBoost

      let inQuietZone = minutesSinceTap >= 60 && minutesSinceTap <= 240
      if inQuietZone { score = Int(Double(score) * 0.7) }

      let driftBonus = (isLateNight && minutesSinceTap > 180) ? 10 : 0
      score += driftBonus

      let consecutiveIgnores = defaults.integer(forKey: "loop_score_consecutive_ignores")
      let lastIgnoreMs       = defaults.double(forKey: "loop_score_last_ignore_time")
      let hoursAgo           = lastIgnoreMs > 0 ? (nowMs - lastIgnoreMs) / 3_600_000 : 0.0
      let decayFactor        = max(0, 1 - hoursAgo / 24)
      let ignorePenaltyBase: Int
      switch consecutiveIgnores {
      case 0:        ignorePenaltyBase = 0
      case 1:        ignorePenaltyBase = 10
      case 2:        ignorePenaltyBase = 20
      case 3:        ignorePenaltyBase = 40
      default:       ignorePenaltyBase = 60
      }
      let ignorePenalty = Int(Double(ignorePenaltyBase) * decayFactor)
      score -= ignorePenalty

      let rawScore       = max(0, score)
      let conf           = defaults.double(forKey: "loop_score_confidence")
      let effectiveConf  = conf > 0 ? conf : 1.0
      let finalScore     = max(0, Int(Double(rawScore) * effectiveConf))

      let today      = { () -> String in
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        return fmt.string(from: Date())
      }()
      let savedDate  = defaults.string(forKey: "loop_score_today_date") ?? ""
      let todayCount = savedDate == today ? defaults.integer(forKey: "loop_score_today_count") : 0
      let maxPerDay  = defaults.integer(forKey: "loop_score_max_per_day").nonZero ?? 5
      let threshold  = todayCount == 0 ? 35 : 50

      let lastFireScore  = defaults.integer(forKey: "loop_score_last_fire_score")
      let rawCooldown    = defaults.double(forKey: "loop_score_cooldown_ms")
      let baseCooldown   = rawCooldown > 0 ? rawCooldown : 30 * 60_000
      let effCooldown    = lastFireScore > 70 ? baseCooldown * 0.8 : baseCooldown
      let lastNotifMs    = defaults.double(forKey: "loop_score_last_notification_time")
      let cooldownRemMs  = max(0, effCooldown - (nowMs - lastNotifMs))

      let minsSinceTapOut = minutesSinceTap.isInfinite ? 999999.0 : minutesSinceTap

      return [
        "hour":               hour,
        "isLateNight":        isLateNight,
        "inQuietZone":        inQuietZone,
        "minutesSinceTap":    Int(minsSinceTapOut),
        "patternHasData":     patternHasData,
        "patternRatio":       patternRatio,
        "patternBase":        patternBase,
        "timeOfDayBonus":     timeOfDayBonus,
        "engagementScore":    engagementScore,
        "tapBoost":           tapBoost,
        "driftBonus":         driftBonus,
        "ignorePenalty":      ignorePenalty,
        "rawScore":           rawScore,
        "finalScore":         finalScore,
        "threshold":          threshold,
        "wouldFire":          finalScore >= threshold,
        "consecutiveIgnores": consecutiveIgnores,
        "confidence":         effectiveConf,
        "todayCount":         todayCount,
        "maxPerDay":          maxPerDay,
        "cooldownRemainingMs": cooldownRemMs,
        "lastFireScore":      lastFireScore,
      ]
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private func saveSelection(_ sel: FamilyActivitySelection) {
    guard let defaults = UserDefaults(suiteName: kAppGroup) else { return }
    if let data = try? PropertyListEncoder().encode(sel) {
      defaults.set(data, forKey: kSelectionKey)
    }
  }

  private func loadSelection() -> FamilyActivitySelection {
    guard
      let defaults = UserDefaults(suiteName: kAppGroup),
      let data = defaults.data(forKey: kSelectionKey),
      let sel  = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
    else {
      return FamilyActivitySelection()
    }
    return sel
  }
}
