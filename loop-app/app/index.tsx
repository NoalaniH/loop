import { useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Redirect, useRouter, useFocusEffect } from 'expo-router';
import { getSettings } from '@/lib/storage';
import { formatActiveHours, isActiveNow } from '@/lib/notifications';
import { AppSettings } from '@/lib/types';
import { colors, spacing, fontSize } from '@/lib/theme';

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      getSettings().then(s => {
        setSettings(s);
        setLoading(false);
      });
    }, [])
  );

  if (loading) return null;
  if (!settings?.onboarded) return <Redirect href="/onboarding" />;

  const active = isActiveNow(settings.activeHours.start, settings.activeHours.end);
  const hoursLabel = formatActiveHours(settings.activeHours.start, settings.activeHours.end);

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.header}
        onPress={() => {
          tapCount.current += 1;
          if (tapTimer.current) clearTimeout(tapTimer.current);
          if (tapCount.current >= 5) {
            tapCount.current = 0;
            router.push('/debug');
          } else {
            tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 2000);
          }
        }}
      >
        <Text style={styles.wordmark}>Loop</Text>
        <Text style={styles.tagline}>Break the scroll loop.</Text>
      </Pressable>

      <View style={styles.status}>
        <View style={[styles.dot, active ? styles.dotActive : styles.dotResting]} />
        <Text style={styles.statusText}>
          {active ? `Active  ·  ${hoursLabel}` : `Resting  ·  ${hoursLabel}`}
        </Text>
      </View>

      <Pressable
        style={({ pressed }) => [styles.triggerBtn, pressed && styles.triggerBtnPressed]}
        onPress={() => router.push('/redirect')}
      >
        <Text style={styles.triggerText}>{"I'm looping right now."}</Text>
      </Pressable>

      <Pressable style={styles.settingsLink} onPress={() => router.push('/settings')}>
        <Text style={styles.settingsText}>Settings</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    gap: spacing.xl,
  },
  header: {
    gap: spacing.sm,
  },
  wordmark: {
    fontSize: fontSize.xxl,
    color: colors.text,
    fontWeight: '700',
    letterSpacing: -1,
  },
  tagline: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontWeight: '400',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: colors.text,
  },
  dotResting: {
    backgroundColor: colors.textMuted,
  },
  statusText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    letterSpacing: 0.2,
  },
  triggerBtn: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  triggerBtnPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  triggerText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  settingsLink: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
  },
  settingsText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
});
