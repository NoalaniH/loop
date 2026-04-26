import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { getSettings, saveSettings, resetSettings } from '@/lib/storage';
import { scheduleLoopNotifications, formatActiveHours } from '@/lib/notifications';
import { startNativeMonitoring } from '@/lib/useLoopNative';
import { HOURS_PRESETS, LOOP_APP_OPTIONS, ActiveHours, AppSettings } from '@/lib/types';
import { colors, spacing, fontSize, radius } from '@/lib/theme';

export default function Settings() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useFocusEffect(
    useCallback(() => {
      getSettings().then(setSettings);
    }, [])
  );

  async function updateHours(hours: ActiveHours) {
    if (!settings) return;
    const updated = { ...settings, activeHours: hours };
    setSettings(updated);
    await saveSettings({ activeHours: hours });
    await scheduleLoopNotifications(updated);
    await startNativeMonitoring({
      startHour: hours.start,
      startMinute: 0,
      endHour: hours.end > 24 ? hours.end - 24 : hours.end,
      endMinute: 0,
      thresholdMinutes: 5,
    });
  }

  async function toggleApp(app: string) {
    if (!settings) return;
    const next = settings.loopApps.includes(app)
      ? settings.loopApps.filter(a => a !== app)
      : [...settings.loopApps, app];
    setSettings({ ...settings, loopApps: next });
    await saveSettings({ loopApps: next });
  }

  function confirmReset() {
    Alert.alert(
      'Reset Loop',
      'This will clear all your settings and restart the onboarding. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await resetSettings();
            router.replace('/');
          },
        },
      ]
    );
  }

  if (!settings) return null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      {/* Active hours */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Active hours</Text>
        <Text style={styles.sectionHint}>
          Currently {formatActiveHours(settings.activeHours.start, settings.activeHours.end)}
        </Text>
        <View style={styles.presetList}>
          {HOURS_PRESETS.map(preset => {
            const on =
              settings.activeHours.start === preset.value.start &&
              settings.activeHours.end === preset.value.end;
            return (
              <Pressable
                key={preset.label}
                style={({ pressed }) => [
                  styles.preset,
                  on && styles.presetOn,
                  pressed && styles.presetPressed,
                ]}
                onPress={() => updateHours(preset.value)}
              >
                <Text style={[styles.presetLabel, on && styles.presetLabelOn]}>
                  {preset.label}
                </Text>
                <Text style={styles.presetSub}>{preset.sublabel}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Loop apps */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Your loop apps</Text>
        <Text style={styles.sectionHint}>What you're fighting.</Text>
        <View style={styles.chipGrid}>
          {LOOP_APP_OPTIONS.map(app => {
            const on = settings.loopApps.includes(app);
            return (
              <Pressable
                key={app}
                style={({ pressed }) => [
                  styles.chip,
                  on && styles.chipOn,
                  pressed && styles.chipPressed,
                ]}
                onPress={() => toggleApp(app)}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{app}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Info */}
      <View style={styles.infoBox}>
        <Row label="Cooldown" value={`${settings.cooldownMinutes} min between nudges`} />
        <Row label="Daily limit" value={`${settings.maxPerDay} nudges max`} />
      </View>

      {/* Reset */}
      <Pressable
        style={({ pressed }) => [styles.resetBtn, pressed && styles.resetBtnPressed]}
        onPress={confirmReset}
      >
        <Text style={styles.resetText}>Reset everything</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={rowStyles.value}>{value}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  value: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
});

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  header: {
    gap: spacing.sm,
  },
  backBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  backText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  title: {
    fontSize: fontSize.xl,
    color: colors.text,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  section: {
    gap: spacing.md,
  },
  sectionLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  sectionHint: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: -spacing.sm,
  },
  presetList: {
    gap: spacing.sm,
  },
  preset: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetOn: {
    borderColor: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  presetPressed: {
    opacity: 0.75,
  },
  presetLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  presetLabelOn: {
    color: colors.text,
  },
  presetSub: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  chipPressed: {
    opacity: 0.75,
  },
  chipText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  chipTextOn: {
    color: colors.bg,
    fontWeight: '500',
  },
  infoBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetBtn: {
    borderRadius: 16,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetBtnPressed: {
    backgroundColor: colors.surface,
  },
  resetText: {
    color: colors.destructive,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
});
