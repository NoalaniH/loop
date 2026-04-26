import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { requestNotificationPermissions } from '@/lib/notifications';
import { colors, spacing, fontSize } from '@/lib/theme';

export default function Permissions() {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);

  async function handleAllow() {
    setRequesting(true);
    await requestNotificationPermissions();
    setRequesting(false);
    router.push('/onboarding/setup');
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.step}>2 of 3</Text>
        <Text style={styles.title}>Allow notifications.</Text>
        <Text style={styles.body}>
          Loop sends short nudges — a few per day, during times you choose — to interrupt the spiral.
        </Text>
        <Text style={styles.body}>
          No spam. No guilt. Just a knock on the door.
        </Text>

        <View style={styles.exampleBox}>
          <Text style={styles.exampleLabel}>Example nudges</Text>
          <Text style={styles.example}>{"Nothing new here."}</Text>
          <Text style={styles.example}>{"Want one better thing?"}</Text>
          <Text style={styles.example}>{"You've been looping."}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          onPress={handleAllow}
          disabled={requesting}
        >
          <Text style={styles.btnText}>{requesting ? 'Requesting…' : 'Allow notifications'}</Text>
        </Pressable>

        <Pressable style={styles.skipBtn} onPress={() => router.push('/onboarding/setup')}>
          <Text style={styles.skipText}>Skip for now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xl,
    gap: spacing.lg,
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
  body: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 24,
  },
  exampleBox: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exampleLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  example: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  footer: {
    gap: spacing.sm,
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
  skipBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  skipText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
});
