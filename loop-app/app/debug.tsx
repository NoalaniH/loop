import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { getDebugScoreState } from '@/lib/useLoopNative';
import { getTriggerLog, clearTriggerLog } from '@/lib/triggerLog';
import * as LoopNative from 'loop-native';
import type { DebugScoreState, TriggerEntry } from 'loop-native';
import { colors, spacing, fontSize } from '@/lib/theme';

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export default function Debug() {
  const router = useRouter();
  const [state, setState] = useState<DebugScoreState | null>(null);
  const [log, setLog] = useState<TriggerEntry[]>([]);

  const refresh = useCallback(async () => {
    const [s, l] = await Promise.all([getDebugScoreState(), getTriggerLog()]);
    setState(s);
    setLog(l.slice(-10).reverse());
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const resetConfidence = async () => {
    await LoopNative.syncLoopScoreState({
      maxPerDay: state?.maxPerDay ?? 5,
      cooldownMs: 30 * 60 * 1000,
      lastTapTime: 0,
      feedbackGood: true,
    });
    // Force to 1.0 by syncing several times isn't ideal — just note in UI
    refresh();
  };

  if (!state) {
    return (
      <View style={styles.container}>
        <Text style={styles.dim}>Loading…</Text>
      </View>
    );
  }

  const cooldownSec = Math.ceil(state.cooldownRemainingMs / 1000);
  const cooldownStr = cooldownSec > 0
    ? `${Math.floor(cooldownSec / 60)}m ${cooldownSec % 60}s`
    : 'ready';

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>← back</Text>
      </Pressable>

      {/* ── Score breakdown ── */}
      <Text style={styles.section}>LOOP SCORE</Text>
      <View style={styles.card}>
        <Row label="final score" value={`${state.finalScore} / ${state.threshold}  ${state.wouldFire ? '✓ FIRE' : '✗ hold'}`} highlight={state.wouldFire} />
        {cooldownSec > 0 && <Row label="cooldown" value={cooldownStr} dim />}
        <Divider />
        <Row label="base" value="40" />
        {state.patternHasData
          ? <Row label="pattern bonus" value={`+${state.patternBase}  (ratio ${state.patternRatio.toFixed(2)})`} />
          : <Row label="pattern" value="no data yet" dim />}
        <Row label="time of day" value={`+${state.timeOfDayBonus}`} />
        <Row label="engagement" value={`+${state.engagementScore}`} />
        <Row label="tap boost" value={`+${state.tapBoost}`} />
        <Row label="quiet zone" value={state.inQuietZone ? '×0.7 ON' : '×0.7 off'} dim={!state.inQuietZone} />
        <Row label="drift" value={`+${state.driftBonus}`} />
        <Row label="ignore penalty" value={`-${state.ignorePenalty}`} />
        <Divider />
        <Row label="raw score" value={String(state.rawScore)} />
        <Row label="confidence" value={`×${state.confidence.toFixed(3)}`} />
        <Row label="final" value={String(state.finalScore)} />
      </View>

      {/* ── State ── */}
      <Text style={styles.section}>STATE</Text>
      <View style={styles.card}>
        <Row label="hour" value={`${state.hour}  ${state.isLateNight ? '(late night)' : ''}`} />
        <Row label="minutesSinceTap" value={state.minutesSinceTap === 999999 ? 'never' : String(state.minutesSinceTap)} />
        <Row label="consecutiveIgnores" value={String(state.consecutiveIgnores)} />
        <Row label="todayCount" value={`${state.todayCount} / ${state.maxPerDay}`} />
        <Row label="lastFireScore" value={String(state.lastFireScore)} />
      </View>

      {/* ── Android live signals ── */}
      {Platform.OS === 'android' && (
        <>
          <Text style={styles.section}>LIVE SIGNALS (30m)</Text>
          <View style={styles.card}>
            <Row label="switchCount" value={String(state.switchCount ?? 0)} />
            <Row label="maxSwitchesOneApp" value={`${state.maxSwitchesOneApp ?? 0}  ${state.topPackage ? `(${state.topPackage})` : ''}`} />
            <Row label="sessionMinutes" value={String(state.sessionMinutes ?? 0)} />
            <Divider />
            <Row label="switchScore" value={String(state.switchScore ?? 0)} />
            <Row label="sessionScore" value={String(state.sessionScore ?? 0)} />
            <Row label="returnLoopScore" value={String(state.returnLoopScore ?? 0)} />
            <Row label="contextMult" value={(state.contextMult ?? 1).toFixed(2)} />
          </View>
        </>
      )}

      {/* ── Trigger log ── */}
      <Text style={styles.section}>TRIGGER LOG (last 10)</Text>
      {log.length === 0
        ? <Text style={styles.dim}>  no triggers yet</Text>
        : log.map((e, i) => <TriggerRow key={i} entry={e} />)
      }

      {/* ── Controls ── */}
      <View style={styles.controls}>
        <CtrlBtn label="Clear log" onPress={async () => { await clearTriggerLog(); refresh(); }} />
        <CtrlBtn label="Reset confidence → 1.0" onPress={resetConfidence} />
        <CtrlBtn label="Refresh" onPress={refresh} />
      </View>
    </ScrollView>
  );
}

function Row({ label, value, highlight, dim }: {
  label: string; value: string; highlight?: boolean; dim?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, dim && styles.dim]}>{label}</Text>
      <Text style={[styles.rowValue, highlight && styles.highlight, dim && styles.dim]}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function TriggerRow({ entry }: { entry: TriggerEntry }) {
  const d = new Date(entry.timestamp);
  const hhmm = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  const factors = entry.topFactors?.join(', ') ?? '';
  const outcome = entry.outcome ?? '–';
  return (
    <View style={styles.triggerRow}>
      <Text style={styles.triggerText}>
        {`${hhmm}  score=${entry.finalScore}  ${factors}  → ${outcome}`}
      </Text>
    </View>
  );
}

function CtrlBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.ctrlBtn, pressed && styles.ctrlBtnPressed]}
      onPress={onPress}
    >
      <Text style={styles.ctrlBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#0a0a0a' },
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: 60,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  back: { marginBottom: spacing.md },
  backText: { color: colors.textSecondary, fontSize: fontSize.sm, fontFamily: mono },
  section: {
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 2,
    fontFamily: mono,
    marginTop: spacing.md,
    marginBottom: 2,
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#222',
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  rowLabel: { color: colors.textSecondary, fontSize: 12, fontFamily: mono },
  rowValue: { color: colors.text, fontSize: 12, fontFamily: mono },
  highlight: { color: '#5cff8a' },
  dim: { color: colors.textMuted, fontSize: 12, fontFamily: mono },
  divider: { height: 1, backgroundColor: '#222', marginVertical: 4 },
  triggerRow: {
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  triggerText: { color: colors.textSecondary, fontSize: 11, fontFamily: mono },
  controls: { marginTop: spacing.lg, gap: spacing.sm },
  ctrlBtn: {
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
  },
  ctrlBtnPressed: { backgroundColor: '#1a1a1a' },
  ctrlBtnText: { color: colors.textSecondary, fontSize: fontSize.sm, fontFamily: mono },
});
