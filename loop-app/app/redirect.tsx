import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { pickItem, recordTypeTap } from '@/lib/content';
import { RedirectItem } from '@/lib/types';
import { colors, spacing, fontSize } from '@/lib/theme';
import { recordRedirectTap, sendFeedback } from '@/lib/useLoopNative';
import { getTriggerLog } from '@/lib/triggerLog';

export default function Redirect() {
  const router = useRouter();
  const [item, setItem] = useState<RedirectItem | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  useEffect(() => {
    recordRedirectTap();
    pickItem().then(i => {
      setItem(i);
      recordTypeTap(i.type);
    });
    // Show feedback prompt on every 3rd redirect visit
    getTriggerLog().then(log => {
      if (log.length > 0 && log.length % 3 === 0) setShowFeedback(true);
    });
  }, []);

  const handleFeedback = async (good: boolean) => {
    setFeedbackSent(true);
    await sendFeedback(good);
  };

  if (!item) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }

  const durLabel = item.durationSeconds < 60
    ? `~${item.durationSeconds} sec`
    : `~${Math.ceil(item.durationSeconds / 60)} min`;

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.typeLabel}>{item.type}</Text>
        <Text style={styles.title}>{item.title}</Text>
        {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
        <Text style={styles.dur}>{durLabel}</Text>
      </View>

      {showFeedback && !feedbackSent && (
        <View style={styles.feedbackRow}>
          <Text style={styles.feedbackLabel}>Was this a good call?</Text>
          <View style={styles.feedbackButtons}>
            <Pressable
              style={({ pressed }) => [styles.feedbackBtn, pressed && styles.feedbackBtnPressed]}
              onPress={() => handleFeedback(true)}
            >
              <Text style={styles.feedbackBtnText}>Yes</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.feedbackBtn, pressed && styles.feedbackBtnPressed]}
              onPress={() => handleFeedback(false)}
            >
              <Text style={styles.feedbackBtnText}>Not really</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [styles.doneBtn, pressed && styles.doneBtnPressed]}
        onPress={() => router.replace('/')}
      >
        <Text style={styles.doneBtnText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  typeLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: fontSize.xxl,
    color: colors.text,
    fontWeight: '700',
    letterSpacing: -1,
    lineHeight: fontSize.xxl * 1.1,
  },
  body: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
    lineHeight: 30,
    fontWeight: '400',
  },
  dur: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  feedbackRow: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  feedbackLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  feedbackButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  feedbackBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  feedbackBtnPressed: {
    backgroundColor: colors.surface,
  },
  feedbackBtnText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '400',
  },
  doneBtn: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  doneBtnPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  doneBtnText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
});
