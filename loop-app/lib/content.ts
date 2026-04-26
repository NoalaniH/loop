import AsyncStorage from '@react-native-async-storage/async-storage';
import { RedirectItem } from './types';
import rawContent from '@/data/content.json';

const RECENT_IDS_KEY = '@loop/last_shown_ids';
const TYPE_PREFS_KEY = '@loop/type_prefs';
const RECENT_MAX = 10;

export function getAllItems(): RedirectItem[] {
  return rawContent as RedirectItem[];
}

function getTimeTag(): string {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export async function recordTypeTap(type: string): Promise<void> {
  const raw = await AsyncStorage.getItem(TYPE_PREFS_KEY);
  const prefs: Record<string, number> = raw ? JSON.parse(raw) : {};
  prefs[type] = (prefs[type] ?? 0) + 1;
  await AsyncStorage.setItem(TYPE_PREFS_KEY, JSON.stringify(prefs));
}

export async function pickItem(): Promise<RedirectItem> {
  const items = getAllItems();

  const [rawIds, rawPrefs] = await Promise.all([
    AsyncStorage.getItem(RECENT_IDS_KEY),
    AsyncStorage.getItem(TYPE_PREFS_KEY),
  ]);

  const recentIds: string[] = rawIds ? JSON.parse(rawIds) : [];
  const typePrefs: Record<string, number> = rawPrefs ? JSON.parse(rawPrefs) : {};
  const timeTag = getTimeTag();

  let pool = items.filter(i => !recentIds.includes(i.id));
  if (pool.length === 0) pool = items;

  const weights = pool.map(item => {
    let w = 1;
    if (item.tags.includes(timeTag)) w += 2;
    else if (item.tags.includes('anytime')) w += 1;
    w += (typePrefs[item.type] ?? 0) * 0.5;
    return w;
  });

  const item = weightedPick(pool, weights);

  const newRecent = [item.id, ...recentIds].slice(0, RECENT_MAX);
  await AsyncStorage.setItem(RECENT_IDS_KEY, JSON.stringify(newRecent));

  return item;
}
