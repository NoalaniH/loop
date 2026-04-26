import { useCallback, useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { setupNotificationHandler } from '@/lib/notifications';
import { useLoopForegroundCheck, startNativeMonitoring, syncLoopScore, getAndClearTriggerJson } from '@/lib/useLoopNative';
import { appendTrigger } from '@/lib/triggerLog';
import { getSettings } from '@/lib/storage';
import { colors } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();
setupNotificationHandler();

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    SplashScreen.hideAsync();
    // Re-arm monitoring and sync Loop Score state on every cold launch so both
    // survive reinstalls and any edge case where the OS dropped the schedule.
    getSettings().then(async s => {
      if (!s?.onboarded) return;
      await startNativeMonitoring({
        startHour: s.activeHours.start,
        startMinute: 0,
        endHour: s.activeHours.end > 24 ? s.activeHours.end - 24 : s.activeHours.end,
        endMinute: 0,
        thresholdMinutes: 5,
      });
      await syncLoopScore(s);
    });
  }, []);

  // Expo-scheduled notification taps → /redirect
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      if (response.notification.request.content.data?.type === 'loop_nudge') {
        router.push('/redirect');
      }
    });
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (response?.notification.request.content.data?.type === 'loop_nudge') {
        router.push('/redirect');
      }
    });
    return () => sub.remove();
  }, []);

  // Native module loop detection → /redirect
  const handleLoopDetected = useCallback(() => {
    router.push('/redirect');
  }, [router]);

  const handleAfterForegroundCheck = useCallback(async () => {
    const json = await getAndClearTriggerJson();
    if (json) await appendTrigger(json);
  }, []);

  useLoopForegroundCheck(handleLoopDetected, handleAfterForegroundCheck);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      />
    </>
  );
}
