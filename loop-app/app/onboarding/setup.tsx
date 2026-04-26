import { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { saveSettings } from '@/lib/storage';
import { scheduleLoopNotifications } from '@/lib/notifications';
import { startNativeMonitoring, pickMonitoredApps, requestLoopPermission } from '@/lib/useLoopNative';
import { LOOP_APP_OPTIONS, HOURS_PRESETS, ActiveHours } from '@/lib/types';
import { colors, spacing, fontSize, radius } from '@/lib/theme';

export default function Setup() {
  const router = useRouter();
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [selectedHours, setSelectedHours] = useState<ActiveHours | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerDone, setPickerDone] = useState(false);

  function toggleApp(app: string) {
    setSelectedApps(prev =>
      prev.includes(app) ? prev.filter(a => a !== app) : [...prev, app]
    );
  }

  async function handlePickApps() {
    try {
      const granted = await requestLoopPermission();
      if (!granted) {
        Alert.alert(
          'Screen Time Access Required',
          'Loop needs Screen Time authorization to monitor apps. If this prompt never appeared, rebuild the app — the FamilyControls capability may not be active in your provisioning profile.',
        );
        return;
      }
      const selected = await pickMonitoredApps();
      if (selected) setPickerDone(true);
    } catch (e: any) {
      Alert.alert('Could not open picker', e?.message ?? 'Please try again.');
    }
  }

  async function handleStart() {
    setSaving(true);
    const hours = selectedHours ?? HOURS_PRESETS[2].value;
    const settings = {
      onboarded: true,
      loopApps: selectedApps,
      activeHours: hours,
      cooldownMinutes: 30,
      maxPerDay: 5,
    };
    await saveSettings(settings);
    await scheduleLoopNotifications(settings);
    await startNativeMonitoring({
      startHour: hours.start,
      startMinute: 0,
      endHour: hours.end > 24 ? hours.end - 24 : hours.end,
      endMinute: 0,
      thresholdMinutes: 5,
    });
    router.replace('/');
  }

  const canStart = Platform.OS === 'ios' ? pickerDone : selectedApps.length > 0;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.step}>3 of 3</Text>
        <Text style={styles.title}>Set your loop.</Text>

        {/* ── App selection ── */}
        {Platform.OS === 'ios' ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Which apps do you loop on?</Text>
            <Text style={styles.sectionHint}>
              iOS lets you pick through its own privacy-controlled selector.
              Loop never sees your full app list — only what you choose.
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.pickerCard,
                pickerDone && styles.pickerCardDone,
                pressed && styles.pickerCardPressed,
              ]}
              onPress={handlePickApps}
            >
              <View style={styles.pickerCardInner}>
                <Text style={[styles.pickerCardTitle, pickerDone && styles.pickerCardTitleDone]}>
                  {pickerDone ? 'Apps selected' : 'Choose apps'}
                </Text>
                <Text style={[styles.pickerCardSub, pickerDone && styles.pickerCardSubDone]}>
                  {pickerDone
                    ? 'Tap to change your selection'
                    : 'Opens the iOS app selector'}
                </Text>
              </View>
              <Text style={[styles.pickerCardBadge, pickerDone && styles.pickerCardBadgeDone]}>
                {pickerDone ? '✓' : '→'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Which apps do you loop on?</Text>
            <Text style={styles.sectionHint}>Select all that apply.</Text>
            <View style={styles.chipGrid}>
              {LOOP_APP_OPTIONS.map(app => {
                const on = selectedApps.includes(app);
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
        )}

        {/* ── Active hours ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>When are you most likely to scroll?</Text>
          <Text style={styles.sectionHint}>Loop will send nudges during this window.</Text>
          <View style={styles.presetList}>
            {HOURS_PRESETS.map(preset => {
              const on = selectedHours
                ? selectedHours.start === preset.value.start && selectedHours.end === preset.value.end
                : false;
              return (
                <Pressable
                  key={preset.label}
                  style={({ pressed }) => [
                    styles.preset,
                    on && styles.presetOn,
                    pressed && styles.presetPressed,
                  ]}
                  onPress={() => setSelectedHours(preset.value)}
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
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.btn,
            !canStart && styles.btnDisabled,
            pressed && canStart && styles.btnPressed,
          ]}
          onPress={handleStart}
          disabled={saving || !canStart}
        >
          <Text style={[styles.btnText, !canStart && styles.btnTextDisabled]}>
            {saving ? 'Starting…' : 'Start Loop'}
          </Text>
        </Pressable>
        {!canStart && (
          <Text style={styles.hint}>
            {Platform.OS === 'ios'
              ? 'Choose your apps above to continue'
              : 'Select at least one app to continue'}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  container: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    gap: spacing.xl,
  },
  step: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
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
    lineHeight: 20,
  },

  // ── iOS picker card ──────────────────────────────────────────────────────────
  pickerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  pickerCardDone: {
    borderColor: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  pickerCardPressed: {
    opacity: 0.75,
  },
  pickerCardInner: {
    gap: 4,
  },
  pickerCardTitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  pickerCardTitleDone: {
    color: colors.text,
  },
  pickerCardSub: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  pickerCardSubDone: {
    color: colors.textSecondary,
  },
  pickerCardBadge: {
    fontSize: fontSize.lg,
    color: colors.textMuted,
  },
  pickerCardBadgeDone: {
    color: colors.text,
  },

  // ── Android chip grid ────────────────────────────────────────────────────────
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

  // ── Active hours ─────────────────────────────────────────────────────────────
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
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.text,
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

  // ── Footer ───────────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    gap: spacing.sm,
  },
  btn: {
    backgroundColor: colors.text,
    borderRadius: 16,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  btnDisabled: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnText: {
    color: colors.bg,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  btnTextDisabled: {
    color: colors.textMuted,
  },
  hint: {
    textAlign: 'center',
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
});
