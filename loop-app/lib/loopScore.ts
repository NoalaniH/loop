import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@loop/score_state';

interface ScoreState {
  lastTapTime: number; // ms timestamp, 0 = never
}

const DEFAULT: ScoreState = { lastTapTime: 0 };

async function load(): Promise<ScoreState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScoreState) : { ...DEFAULT };
  } catch {
    return { ...DEFAULT };
  }
}

export async function getLastTapTime(): Promise<number> {
  return (await load()).lastTapTime;
}

export async function recordTap(): Promise<number> {
  const now = Date.now();
  await AsyncStorage.setItem(KEY, JSON.stringify({ lastTapTime: now }));
  return now;
}
