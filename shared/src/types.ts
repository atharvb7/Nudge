// Shared domain types for Nudge. Everything here is metadata only:
// no page content, no keystroke values, no audio.

export type WordingStyle = 'warm' | 'literal';
export type InputStyle = 'voice' | 'buttons';
export type Energy = 1 | 2 | 3 | 4 | 5;
export type StepSize = 'tiny' | 'small';

/** Sensed state of the user. LEARNING = first 3 days, no auto-nudges. */
export type UserState = 'flow' | 'stuck' | 'depleted' | 'away' | 'neutral';

/** State passed to the sequencer (adds user-reported states). */
export type SequenceState = 'stuck' | 'restuck' | 'depleted' | 'overwhelmed' | 'neutral';

export type ActionButton = 'done' | 'too_big' | 'smaller' | 'different' | 'rest';
export const ACTION_BUTTONS: ActionButton[] = ['done', 'too_big', 'smaller', 'different', 'rest'];

export type SequenceAction = 'start' | 'too_big' | 'smaller' | 'different' | 'next';

export type SiteCategory = 'work' | 'escape' | 'neutral';

export type TaskKind = 'doc' | 'reading' | 'study' | 'code' | 'admin' | 'message' | 'chore' | 'any';

export interface StrategyCard {
  id: string;
  name: string;
  for_state: Array<'stuck' | 'restuck' | 'depleted' | 'overwhelmed'>;
  min_energy: number;
  modality: string;
  size: StepSize;
  steps: string[];
  literal_version: string[];
  phrasings: string[];
  why_it_works: string;
  tags: string[];
  is_rest?: boolean;
  /** which kinds of task this card fits: doc | reading | study | code | admin | message | chore | any */
  task_kinds: TaskKind[];
}

// ---------- Sensing ----------

/** Raw event, kept only until the next 30 s feature computation. */
export type RawEvent =
  | { t: number; kind: 'activate'; tabId: number; host: string; isTaskTab: boolean }
  | { t: number; kind: 'interact'; tabId: number; host: string; keys: number; scrolls: number; clicks: number }
  | { t: number; kind: 'idle'; state: 'active' | 'idle' | 'locked' }
  | { t: number; kind: 'fullscreen'; on: boolean };

/** One 30 s window of derived features. */
export interface FeatureWindow {
  t: number; // window end (ms)
  switches: number; // tab activations in window
  escapeSwitches: number; // activations landing on escape sites
  workSwitches: number;
  taskReturns: number; // activations landing on the pinned task tab
  taskInteractions: number; // key+scroll+click counts on task / work tabs
  escapeInteractions: number;
  onTaskMs: number; // ms with task tab (or work site) focused and not idle
  onEscapeMs: number;
  idleMs: number;
  activeHost: string | null;
  activeCategory: SiteCategory | null;
  fullscreen: boolean;
  hour: number;
}

export interface Baseline {
  /** Median / p75 of switches per minute in the user's own normal sessions */
  switchesPerMinMedian: number;
  switchesPerMinP75: number;
  taskInteractionsPerMinMedian: number;
  idleGapMinMedian: number;
  typicalSessionMin: number;
  samples: number;
  updatedAt: number;
}

export interface Sensitivity {
  /** >1 = needs stronger evidence before calling this state. Adjusted by "Wrong" feedback. */
  stuck: number;
  depleted: number;
  flow: number;
}

export interface Inference {
  id: string;
  t: number;
  state: UserState | 'restuck' | 'long_break';
  reason: string; // plain English
  feedback?: 'right' | 'wrong';
  acted?: 'nudged' | 'silenced' | 'learning' | 'none';
  silencedBecause?: string;
}

// ---------- Personal learning ----------

export interface StrategyStat {
  up: number;
  down: number;
  skip: number;
  shown: number;
  lastShown?: number;
  phrasingIndex: number;
}
export type StrategyStats = Record<string, StrategyStat>;

export interface Win {
  id: string;
  t: number;
  kind: 'started' | 'step_done' | 'paused_start' | 'rested' | 'brain_dump' | 'checkin' | 'came_back' | 'day_closed';
  label: string;
  strategyId?: string;
}

export interface CheckIn {
  t: number;
  day: string; // YYYY-MM-DD local
  feeling: 1 | 2 | 3 | 4 | 5; // heavy … light (never "bad")
}

export interface PlanItem {
  id: string;
  title: string;
  size: StepSize | 'big';
  weight: 1 | 2 | 3; // effort estimate
  status: 'today' | 'later' | 'done';
  createdAt: number;
}

export interface FutureNote {
  t: number;
  task: string;
  note: string;
  progress: string[];
}

// ---------- Session / step flow ----------

export interface StepRecord {
  step: string;
  outcome?: ActionButton;
  strategy_id: string;
  size: StepSize;
  t: number;
}

export interface Session {
  id: string;
  startedAt: number;
  lastActiveAt: number;
  task: string;
  taskTabTitle?: string;
  energy: Energy;
  steps: StepRecord[];
  /** last step marked done — "Stuck again" resumes from here */
  lastCompletedIndex: number;
  endedAt?: number;
  endedKind?: 'day_closed' | 'drifted';
}

export interface BreakState {
  startedAt: number;
  plannedMin: number; // 5 | 15
  returnPromptShown: boolean;
}

export interface NudgeGuard {
  day: string;
  lastAutoNudgeAt: number;
  cooldownMin: number; // starts 20, doubles per "I'm fine"
  dismissalsToday: number;
  offUntilTomorrow: boolean;
  /** when the third dismissal happened (offUntilTomorrow lasts ≥ 4 h, through the 05:00 rollover) */
  offAt?: number;
  dayClosed: boolean; // "Done for today" — no nudges until the user starts a new session
  dayClosedAt?: number;
  lastHydrationChipAt: number;
  lastTimeAnchorAt: number;
  /** identity (start time) of the step whose "still going?" chip was already shown */
  restuckChipShownForStep: number;
  /** learning-mode check-in chip already offered on this day */
  checkinChipDay?: string;
}

export interface QuietHours {
  enabled: boolean;
  start: string; // "22:30"
  end: string; // "08:00"
}

export interface A11ySettings {
  font: 'default' | 'dyslexic';
  textScale: 1 | 1.15 | 1.3 | 1.5;
  highContrast: boolean;
  reducedMotion: 'system' | 'on' | 'off';
}

export type Region = 'IN' | 'US' | 'UK' | 'OTHER';

export interface Settings {
  onboarded: boolean;
  installedAt: number;
  learningDays: number; // 3
  wordingStyle: WordingStyle;
  inputStyle: InputStyle;
  explainWhy: boolean;
  taskTab: { tabId: number | null; host: string; title: string } | null;
  tts: { enabled: boolean; rate: number; voiceURI: string | null };
  whisperMode: boolean;
  wakePhrase: boolean;
  speechEngine: 'auto' | 'on-device' | 'local-whisper' | 'chrome-cloud';
  quietHours: QuietHours;
  dndUntil: number | null;
  timeAnchor: boolean;
  hydrationChip: boolean;
  bodyDoubleSound: 'off' | 'brown' | 'rain' | 'pink';
  stillHereMessages: boolean;
  a11y: A11ySettings;
  region: Region;
  backendUrl: string;
  trackingPaused: boolean;
  excludedSites: string[];
  researchSites: string[];
  escapeSites: string[];
  sensitivity: Sensitivity;
  demoMode: boolean;
  theme: string;
  unlockedThemes: string[];
  winSounds: boolean;
}

export interface StorageShape {
  settings: Settings;
  baseline: Baseline | null;
  features: FeatureWindow[]; // rolling, last 2h
  rawEvents: RawEvent[]; // deleted after each computation
  inferences: Inference[]; // last 300
  stats: StrategyStats;
  wins: Win[];
  checkins: CheckIn[];
  plan: PlanItem[];
  energyToday: { day: string; energy: Energy } | null;
  session: Session | null;
  breakState: BreakState | null;
  guard: NudgeGuard;
  notes: FutureNote[];
  baselineSamples: number[][]; // [switchesPerMin, taskInteractionsPerMin, idleGapMin] per 5-min block during learning
}

// ---------- Backend contract ----------

export interface SequenceRequest {
  task: string;
  task_tab_title?: string;
  state: SequenceState;
  energy: Energy;
  history: Array<{ step: string; outcome?: ActionButton; strategy_id: string }>;
  transcript?: string;
  top_strategies: Array<{ id: string; score: number }>;
  exclude_ids?: string[];
  action: SequenceAction;
  wording_style: WordingStyle;
  explain_why: boolean;
  recent_phrasings?: string[];
}

export interface CrisisResource {
  name: string;
  phone?: string;
  alt?: string;
  url?: string;
  note?: string;
}

export interface SafetyPayload {
  crisis: true;
  message: string;
  resources: CrisisResource[];
  /** 'concern' = hopeless/frustrated language without explicit self-harm (absent = treat as high) */
  level?: 'high' | 'concern';
}

export interface SequenceResponse {
  mode: 'coach' | 'safety';
  /** optional short rotating invitation shown above the step */
  lead?: string | null;
  next_step: string;
  why_one_line: string;
  size: StepSize;
  buttons: ActionButton[];
  strategy_id: string;
  strategy_name: string;
  validation: string | null;
  suggest_rest: boolean;
  source: 'ollama' | 'gemini' | 'card' | 'safety';
  safety: SafetyPayload | null;
}

export interface OfframpResponse {
  note_to_future_self: string;
  rest_suggestion: string;
  source: 'ollama' | 'gemini' | 'card';
}

export interface BrainDumpResponse {
  mode: 'coach' | 'safety';
  groups: Array<{ label: string; items: string[] }>;
  pick: { item: string; why: string; first_step: string } | null;
  alternatives: string[];
  source: 'ollama' | 'gemini' | 'card';
  safety: SafetyPayload | null;
}

export interface HealthResponse {
  ok: boolean;
  llm: 'ollama' | 'gemini' | 'none';
  llm_location: 'local' | 'cloud' | 'none';
  embeddings: 'minilm' | 'keyword';
  whisper: boolean;
  strategies: number;
}
