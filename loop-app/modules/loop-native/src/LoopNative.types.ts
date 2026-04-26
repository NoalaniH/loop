export type PermissionStatus = 'granted' | 'denied' | 'notDetermined' | 'unknown';

export type LoopDetectedEvent = {
  platform: 'ios' | 'android';
  timestamp: number;
  appPackage?: string;
  openCount?: number;
};

export type PermissionStatusChangedEvent = {
  platform: 'ios' | 'android';
  type: 'screenTime' | 'usageAccess';
  status: PermissionStatus;
};

export type SelectedAppsUpdatedEvent = {
  platform: 'ios';
};

export type MonitoringSchedule = {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  thresholdMinutes?: number;
  loopApps?: string[];
};

export type UsageEvent = {
  packageName: string;
  timestamp: number;
  eventType: number;
};

export type LoopScoreSyncParams = {
  maxPerDay: number;
  cooldownMs: number;
  lastTapTime: number; // ms timestamp, 0 = never
  feedbackGood?: boolean; // optional explicit feedback: true=good, false=bad intervention
};

export type DebugScoreState = {
  // Context
  hour: number;
  isLateNight: boolean;
  inQuietZone: boolean;
  minutesSinceTap: number;
  // Pattern
  patternHasData: boolean;
  patternRatio: number;
  patternBase: number;
  // Score components
  timeOfDayBonus: number;
  engagementScore: number;
  tapBoost: number;
  driftBonus: number;
  ignorePenalty: number;
  // Android-only (undefined on iOS)
  switchCount?: number;
  maxSwitchesOneApp?: number;
  sessionMinutes?: number;
  topPackage?: string;
  switchScore?: number;
  sessionScore?: number;
  returnLoopScore?: number;
  contextMult?: number;
  lateNightMult?: number;
  peakMult?: number;
  patternMult?: number;
  // Final
  rawScore: number;
  finalScore: number;
  threshold: number;
  wouldFire: boolean;
  // State
  consecutiveIgnores: number;
  confidence: number;
  todayCount: number;
  maxPerDay: number;
  cooldownRemainingMs: number;
  lastFireScore: number;
};

export type TriggerEntry = {
  timestamp: number;
  hour: number;
  minutesSinceTap: number;
  finalScore: number;
  threshold: number;
  topFactors: string[];
  confidence: number;
  outcome?: 'tapped' | 'returnedToApp' | 'ignored';
  switchCount?: number;
  topPackage?: string;
};
