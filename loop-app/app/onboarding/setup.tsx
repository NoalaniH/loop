import { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { saveSettings } from '@/lib/storage';
import { scheduleLoopNotifications } from '@/lib/notifications';
import { startNativeMonitoring, pickMonitoredApps } from '@/lib/useLoopNative';
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

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.step}>3 of 3</Text>
        <Text style={styles.title}>Set your loop.</Text>

        {/* App selection */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Which apps do you scroll mindlessly?</Text>
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

        {/* Active hours */}
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
                  <Text style={[styles.presetLabel, on && styles.presetLabelOn]}>{preset.label}</Text>
                  <Text style={styles.presetSub}>{preset.sublabel}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Always-visible footer button */}
      <View style={styles.footer}>
        {Platform.OS === 'ios' && (
          <Pressable
            style={({ pressed }) => [styles.pickerBtn, pressed && styles.pickerBtnPressed, pickerDone && styles.pickerBtnDone]}
            onPress={async () => {
              const selected = await pickMonitoredApps();
              if (selected) setPickerDone(true);
            }}
          >
            <Text style={[styles.pickerBtnText, pickerDone && styles.pickerBtnTextDone]}>
              {pickerDone ? 'Apps selected ✓' : 'Select apps in Screen Time'}
            </Text>
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          onPress={handleStart}
          disabled={saving}
        >
          <Text style={styles.btnText}>{saving ? 'Starting…' : 'Start Loop'}</Text>
        </Pressable>
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
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    gap: spacing.sm,
  },
  pickerBtn: {
    borderRadius: 16,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pickerBtnPressed: {
    opacity: 0.75,
  },
  pickerBtnDone: {
    borderColor: colors.text,
  },
  pickerBtnText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  pickerBtnTextDone: {
    color: colors.text,
  },
  btn: {
    backgroundColor: colors.text,
    borderRadius: 16,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnText: {
    color: colors.bg,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
