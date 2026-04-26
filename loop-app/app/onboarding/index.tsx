import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, fontSize } from '@/lib/theme';

export default function Welcome() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.wordmark}>Loop</Text>
        <Text style={styles.tagline}>Break the scroll loop.</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.desc}>
          Loop notices when you're stuck in a scroll spiral and gives you one better thing instead.
        </Text>
        <Text style={styles.desc}>
          No feed. No streaks. Just a nudge — and a way out.
        </Text>
      </View>

      <Pressable
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        onPress={() => router.push('/onboarding/permissions')}
      >
        <Text style={styles.btnText}>Get started</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    justifyContent: 'flex-end',
    gap: spacing.xl,
  },
  hero: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  wordmark: {
    fontSize: fontSize.display,
    color: colors.text,
    fontWeight: '700',
    letterSpacing: -2,
    lineHeight: fontSize.display,
  },
  tagline: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
    fontWeight: '400',
  },
  body: {
    gap: spacing.md,
  },
  desc: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 24,
    fontWeight: '400',
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
