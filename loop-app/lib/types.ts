export type RedirectItem = {
  id: string;
  type: 'funny' | 'action' | 'interesting' | 'interrupt';
  title: string;
  body?: string;
  url?: string;
  tags: string[];
  durationSeconds: number;
};

export type ActiveHours = {
  start: number; // 0–23
  end: number;   // 0–23
};

export type AppSettings = {
  onboarded: boolean;
  loopApps: string[];
  activeHours: ActiveHours;
  cooldownMinutes: number;
  maxPerDay: number;
};

export type HoursPreset = {
  label: string;
  sublabel: string;
  value: ActiveHours;
};

export const HOURS_PRESETS: HoursPreset[] = [
  { label: 'Morning',   sublabel: '7am – 11am', value: { start: 7,  end: 11 } },
  { label: 'Afternoon', sublabel: '12pm – 5pm', value: { start: 12, end: 17 } },
  { label: 'Evening',   sublabel: '5pm – 9pm',  value: { start: 17, end: 21 } },
  { label: 'Night',     sublabel: '9pm – 1am',  value: { start: 21, end: 25 } },
  { label: 'All day',   sublabel: '8am – 10pm', value: { start: 8,  end: 22 } },
];

export const LOOP_APP_OPTIONS = [
  'Instagram',
  'TikTok',
  'X (Twitter)',
  'YouTube',
  'Reddit',
  'Facebook',
  'Snapchat',
  'LinkedIn',
  'Pinterest',
  'Threads',
  'News',
  'Safari',
];
