import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings } from './types';

const SETTINGS_KEY = '@loop/settings';

export const DEFAULT_SETTINGS: AppSettings = {
  onboarded: false,
  loopApps: [],
  activeHours: { start: 17, end: 21 },
  cooldownMinutes: 30,
  maxPerDay: 5,
};

export async function getSettings(): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const current = await getSettings();
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
}

export async function resetSettings(): Promise<void> {
  await AsyncStorage.removeItem(SETTINGS_KEY);
}
