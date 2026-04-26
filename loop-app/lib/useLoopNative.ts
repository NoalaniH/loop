import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as LoopNative from 'loop-native';
import type { MonitoringSchedule, DebugScoreState } from 'loop-native';
import { getSettings } from './storage';
import { getLastTapTime, recordTap } from './loopScore';
import type { AppSettings } from './types';

/**
 * Mount this once in the root layout.
 * - Checks for pending loop alerts every time the app comes to foreground.
 * - Fires the onLoopDetected event into the provided callback so the caller
 *   can navigate to /redirect.
 */
export function useLoopForegroundCheck(
  onLoopDetected: () => void,
  onAfterCheck?: () => Promise<void>,
) {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const loopSub = LoopNative.addLoopDetectedListener(() => {
      onLoopDetected();
    });

    const stateSub = AppState.addEventListener('change', async (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        await LoopNative.checkPendingLoopAlert();
        await onAfterCheck?.();
      }
      appState.current = next;
    });

    // Cold-start: check immediately, then drain trigger log
    LoopNative.checkPendingLoopAlert().then(() => onAfterCheck?.());

    return () => {
      loopSub.remove();
      stateSub.remove();
    };
  }, [onLoopDetected, onAfterCheck]);
}

/** Request the right permission for the current platform. */
export async function requestLoopPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    return LoopNative.requestScreenTimeAuthorization();
  }
  await LoopNative.requestUsageAccessPermission();
  // Android opens Settings; actual grant happens there — re-check after user returns
  return LoopNative.checkUsageAccessPermission();
}

/** Get permission status string for display. */
export async function getLoopPermissionStatus(): Promise<string> {
  if (Platform.OS === 'ios') {
    return LoopNative.getScreenTimeAuthorizationStatus();
  }
  const granted = await LoopNative.checkUsageAccessPermission();
  return granted ? 'granted' : 'denied';
}

/** Start native monitoring on both platforms. */
export async function startNativeMonitoring(schedule: MonitoringSchedule): Promise<void> {
  if (Platform.OS === 'ios') {
    await LoopNative.startIOSMonitoring(schedule);
  } else {
    const settings = await getSettings();
    await LoopNative.startAndroidMonitoring({ ...schedule, loopApps: settings?.loopApps ?? [] });
  }
}

/** Sync Loop Score parameters to the native layer. Call on cold launch and after taps. */
export async function syncLoopScore(settings: AppSettings): Promise<void> {
  const lastTapTime = await getLastTapTime();
  await LoopNative.syncLoopScoreState({
    maxPerDay: settings.maxPerDay,
    cooldownMs: settings.cooldownMinutes * 60 * 1000,
    lastTapTime,
  });
}

/**
 * Record that the user reached the redirect screen (either via notification tap
 * or by pressing "I'm looping right now"). Resets the ignored-notification
 * counter in the native layer immediately.
 */
export async function recordRedirectTap(): Promise<void> {
  const lastTapTime = await recordTap();
  const settings = await getSettings();
  await LoopNative.syncLoopScoreState({
    maxPerDay: settings.maxPerDay,
    cooldownMs: settings.cooldownMinutes * 60 * 1000,
    lastTapTime,
  });
}

export async function stopNativeMonitoring(): Promise<void> {
  if (Platform.OS === 'ios') {
    await LoopNative.stopIOSMonitoring();
  } else {
    await LoopNative.stopAndroidMonitoring();
  }
}

/** iOS only: open the FamilyActivityPicker so the user selects apps to monitor. */
export async function pickMonitoredApps(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return LoopNative.presentAppPicker();
}

/** Returns a full real-time score breakdown for the debug screen. */
export function getDebugScoreState(): Promise<DebugScoreState> {
  return LoopNative.getDebugScoreState();
}

/**
 * Read and clear the trigger JSON written by native on the last notification fire.
 * Returns null if no trigger has fired since the last call.
 */
export function getAndClearTriggerJson(): Promise<string | null> {
  return LoopNative.getAndClearTriggerJson();
}

/** Send explicit feedback about the last intervention to adjust confidence. */
export async function sendFeedback(good: boolean): Promise<void> {
  const settings = await getSettings();
  await LoopNative.syncLoopScoreState({
    maxPerDay: settings.maxPerDay,
    cooldownMs: settings.cooldownMinutes * 60 * 1000,
    lastTapTime: 0,
    feedbackGood: good,
  });
}

export type { DebugScoreState };
