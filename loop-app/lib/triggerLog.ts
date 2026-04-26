import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TriggerEntry } from '../modules/loop-native/src/LoopNative.types';

const KEY = '@loop/trigger_log';
const MAX_ENTRIES = 100;

export async function getTriggerLog(): Promise<TriggerEntry[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TriggerEntry[];
  } catch {
    return [];
  }
}

export async function appendTrigger(jsonString: string): Promise<void> {
  let entry: TriggerEntry;
  try {
    entry = JSON.parse(jsonString) as TriggerEntry;
  } catch {
    return;
  }
  const existing = await getTriggerLog();
  const updated = [...existing, entry].slice(-MAX_ENTRIES);
  await AsyncStorage.setItem(KEY, JSON.stringify(updated));
}

export async function updateLastTriggerOutcome(
  outcome: TriggerEntry['outcome']
): Promise<void> {
  const existing = await getTriggerLog();
  if (existing.length === 0) return;
  existing[existing.length - 1] = { ...existing[existing.length - 1], outcome };
  await AsyncStorage.setItem(KEY, JSON.stringify(existing));
}

export async function clearTriggerLog(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
