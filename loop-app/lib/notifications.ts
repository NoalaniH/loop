import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { AppSettings } from './types';

export function setupNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('loop-nudges', {
      name: 'Loop Nudges',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200, 200, 200],
    });
  }

  // Simulators don't support real push tokens, but local notifications still work
  if (!Device.isDevice && Platform.OS === 'ios') return true;

  const { status: current } = await Notifications.getPermissionsAsync();
  if (current === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// Notifications are now driven entirely by the native Loop Score algorithm.
// This function cancels any legacy pre-scheduled notifications and is a no-op otherwise.
export async function scheduleLoopNotifications(_settings: AppSettings): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export function formatActiveHours(start: number, end: number): string {
  const fmt = (h: number) => {
    const adjusted = h > 24 ? h - 24 : h;
    const period = adjusted >= 12 ? 'pm' : 'am';
    const display = adjusted > 12 ? adjusted - 12 : adjusted === 0 ? 12 : adjusted;
    return `${display}${period}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export function isActiveNow(start: number, end: number): boolean {
  const now = new Date();
  const current = now.getHours() + now.getMinutes() / 60;
  const adjustedEnd = end > 24 ? end - 24 + 24 : end; // handle midnight wrap
  if (end <= 24) {
    return current >= start && current < end;
  }
  // Wraps past midnight
  return current >= start || current < (end - 24);
}
