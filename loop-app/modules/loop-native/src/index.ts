import { requireNativeModule, EventEmitter, Subscription } from 'expo-modules-core';

// Graceful no-op stub used when the native module isn't compiled in yet
// (e.g. running in Expo Go before a dev build).
const stub = new Proxy({} as Record<string, unknown>, {
  get: (_, key) =>
    typeof key === 'string' && key !== 'then'
      ? (..._args: unknown[]) => Promise.resolve(null)
      : undefined,
});

let LoopNativeRaw: ReturnType<typeof requireNativeModule>;
try {
  LoopNativeRaw = requireNativeModule('LoopNative');
} catch {
  LoopNativeRaw = stub as ReturnType<typeof requireNativeModule>;
}
const LoopNative = LoopNativeRaw;
import type {
  PermissionStatus,
  LoopDetectedEvent,
  PermissionStatusChangedEvent,
  SelectedAppsUpdatedEvent,
  MonitoringSchedule,
  UsageEvent,
  LoopScoreSyncParams,
  DebugScoreState,
  TriggerEntry,
} from './LoopNative.types';

const emitter = new EventEmitter(LoopNative);

// ─── iOS: Screen Time / FamilyControls ───────────────────────────────────────

/** Request FamilyControls authorization (iOS only). Shows system permission dialog. */
export function requestScreenTimeAuthorization(): Promise<boolean> {
  return LoopNative.requestScreenTimeAuthorization();
}

export function getScreenTimeAuthorizationStatus(): Promise<PermissionStatus> {
  return LoopNative.getScreenTimeAuthorizationStatus();
}

/** Present the FamilyActivityPicker sheet so the user can select which apps to monitor. */
export function presentAppPicker(): Promise<boolean> {
  return LoopNative.presentAppPicker();
}

/** Start a DeviceActivitySchedule. Requires Screen Time auth + app selection first. */
export function startIOSMonitoring(schedule: MonitoringSchedule): Promise<boolean> {
  return LoopNative.startMonitoring(schedule);
}

export function stopIOSMonitoring(): Promise<boolean> {
  return LoopNative.stopMonitoring();
}

// ─── Android: UsageStats ─────────────────────────────────────────────────────

/** Open the system Usage Access settings screen. */
export function requestUsageAccessPermission(): Promise<void> {
  return LoopNative.requestUsageAccessPermission();
}

export function checkUsageAccessPermission(): Promise<boolean> {
  return LoopNative.checkUsageAccessPermission();
}

/** Read raw usage events for the last N hours. */
export function getRecentUsageEvents(hoursBack = 1): Promise<UsageEvent[]> {
  return LoopNative.getRecentUsageEvents(hoursBack);
}

/** Analyse recent events and fire onLoopDetected if a pattern is found. */
export function detectLoopFromEvents(hoursBack = 1): Promise<boolean> {
  return LoopNative.detectLoopFromEvents(hoursBack);
}

/** Start periodic WorkManager task for background loop detection. */
export function startAndroidMonitoring(schedule: MonitoringSchedule): Promise<boolean> {
  return LoopNative.startUsageMonitoring(schedule);
}

export function stopAndroidMonitoring(): Promise<boolean> {
  return LoopNative.stopUsageMonitoring();
}

// ─── Cross-platform ───────────────────────────────────────────────────────────

/**
 * Check if the native layer (iOS extension / Android Worker) wrote a pending
 * loop alert while the app was in the background. Call this on app foreground.
 * Fires onLoopDetected if a pending alert exists.
 */
export function checkPendingLoopAlert(): Promise<boolean> {
  return LoopNative.checkPendingLoopAlert();
}

// ─── Events ───────────────────────────────────────────────────────────────────

export function addLoopDetectedListener(
  listener: (event: LoopDetectedEvent) => void
): Subscription {
  return emitter.addListener('onLoopDetected', listener);
}

export function addPermissionStatusChangedListener(
  listener: (event: PermissionStatusChangedEvent) => void
): Subscription {
  return emitter.addListener('onPermissionStatusChanged', listener);
}

export function addSelectedAppsUpdatedListener(
  listener: (event: SelectedAppsUpdatedEvent) => void
): Subscription {
  return emitter.addListener('onSelectedAppsUpdated', listener);
}

/** Sync Loop Score state from JS to the native layer (App Group / SharedPreferences). */
export function syncLoopScoreState(params: LoopScoreSyncParams): Promise<boolean> {
  return LoopNative.syncLoopScoreState(params);
}

/** Returns a full real-time score breakdown for the debug screen. */
export function getDebugScoreState(): Promise<DebugScoreState> {
  return LoopNative.getDebugScoreState();
}

/**
 * Reads the trigger JSON written by native on each notification fire, clears it,
 * and returns it (or null if nothing was written since last call).
 */
export function getAndClearTriggerJson(): Promise<string | null> {
  return LoopNative.getAndClearTriggerJson();
}

export type {
  PermissionStatus,
  LoopDetectedEvent,
  PermissionStatusChangedEvent,
  SelectedAppsUpdatedEvent,
  MonitoringSchedule,
  UsageEvent,
  LoopScoreSyncParams,
  DebugScoreState,
  TriggerEntry,
};
