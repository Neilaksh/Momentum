// Shared (client-side) values for the Pomodoro cycle: a focus block, a short
// break after each block, and a long break after every longBreakAfter blocks.
// Mirrors the habits-shared / study-sessions-shared split: pure types and
// helpers only, so the module is safe to bundle on both sides of the SSR
// boundary.

export const POMODORO_PHASES = ["focus", "shortBreak", "longBreak"] as const;

export type PomodoroPhase = (typeof POMODORO_PHASES)[number];

/**
 * A classic Pomodoro cycle: focusMinutes of work, shortBreakMinutes off after
 * each block, and longBreakMinutes off after every longBreakAfter blocks.
 *
 * Breaks are client-side only: study_sessions rows are written for focus phases
 * alone, so rest time can never inflate study totals.
 */
export type PomodoroSettings = {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** Blocks per cycle before the long break (Tomato standard: 4). */
  longBreakAfter: number;
  /** Roll straight into the break when a focus phase ends. */
  autoStartBreaks: boolean;
  /** Roll straight into the next focus when a break ends. */
  autoStartFocus: boolean;
  /** Chime at the end of every phase. */
  soundEnabled: boolean;
};

/** Allowed range per setting, also used to clamp typed input. */
export const POMODORO_LIMITS = {
  focusMinutes: { min: 1, max: 180 },
  shortBreakMinutes: { min: 1, max: 60 },
  longBreakMinutes: { min: 1, max: 120 },
  longBreakAfter: { min: 1, max: 12 },
} as const;

/** The classic Pomodoro Technique defaults. */
export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakAfter: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  soundEnabled: true,
};
/** Where the settings and the cycle position are cached (see pomodoro-store). */
export const POMODORO_SETTINGS_STORAGE_KEY = "momentum_pomodoro_settings";
export const POMODORO_CYCLE_STORAGE_KEY = "momentum_pomodoro_cycle";

/**
 * The cycle position. phaseEndsAt is an absolute epoch (ms) so a countdown
 * survives re-renders, background-tab throttling and a reload; null means the
 * phase is set up but not running yet.
 */
export type PomodoroCycle = {
  phase: PomodoroPhase;
  /** Focus blocks finished since the cycle counter was last reset. */
  completedFocus: number;
  phaseEndsAt: number | null;
};

export const DEFAULT_POMODORO_CYCLE: PomodoroCycle = {
  phase: "focus",
  completedFocus: 0,
  phaseEndsAt: null,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function clampFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Coerce anything - a partial patch or a value restored from localStorage - into
 * usable settings, so a corrupt cache or a blank input can never leave the timer
 * with a phase shorter than a minute.
 */
export function clampPomodoroSettings(value: unknown): PomodoroSettings {
  const raw = (value ?? {}) as Partial<Record<keyof PomodoroSettings, unknown>>;
  const limits = POMODORO_LIMITS;
  const defaults = DEFAULT_POMODORO_SETTINGS;
  return {
    focusMinutes: clampNumber(
      raw.focusMinutes,
      limits.focusMinutes.min,
      limits.focusMinutes.max,
      defaults.focusMinutes,
    ),
    shortBreakMinutes: clampNumber(
      raw.shortBreakMinutes,
      limits.shortBreakMinutes.min,
      limits.shortBreakMinutes.max,
      defaults.shortBreakMinutes,
    ),
    longBreakMinutes: clampNumber(
      raw.longBreakMinutes,
      limits.longBreakMinutes.min,
      limits.longBreakMinutes.max,
      defaults.longBreakMinutes,
    ),
    longBreakAfter: clampNumber(
      raw.longBreakAfter,
      limits.longBreakAfter.min,
      limits.longBreakAfter.max,
      defaults.longBreakAfter,
    ),
    autoStartBreaks: clampFlag(raw.autoStartBreaks, defaults.autoStartBreaks),
    autoStartFocus: clampFlag(raw.autoStartFocus, defaults.autoStartFocus),
    soundEnabled: clampFlag(raw.soundEnabled, defaults.soundEnabled),
  };
}
/** Same tolerance for the restored cycle position. */
export function clampPomodoroCycle(value: unknown): PomodoroCycle {
  const raw = (value ?? {}) as Partial<Record<keyof PomodoroCycle, unknown>>;
  const phase = POMODORO_PHASES.includes(raw.phase as PomodoroPhase)
    ? (raw.phase as PomodoroPhase)
    : DEFAULT_POMODORO_CYCLE.phase;
  const endsAt = Number(raw.phaseEndsAt);
  return {
    phase,
    completedFocus: clampNumber(raw.completedFocus, 0, 999, 0),
    phaseEndsAt: Number.isFinite(endsAt) && endsAt > 0 ? endsAt : null,
  };
}

/** Breaks are rest time: they never produce a study_sessions row. */
export function isBreakPhase(phase: PomodoroPhase): boolean {
  return phase === "shortBreak" || phase === "longBreak";
}

/** Human label for a phase, used in badges and toasts. */
export function pomodoroPhaseLabel(phase: PomodoroPhase): string {
  if (phase === "shortBreak") return "Short break";
  if (phase === "longBreak") return "Long break";
  return "Focus";
}

/** How long one phase lasts, in seconds. */
export function pomodoroPhaseSeconds(phase: PomodoroPhase, settings: PomodoroSettings): number {
  if (phase === "shortBreak") return settings.shortBreakMinutes * 60;
  if (phase === "longBreak") return settings.longBreakMinutes * 60;
  return settings.focusMinutes * 60;
}

/**
 * Move the cycle on by one phase. A finished focus counts as a pomodoro and rolls
 * into the long break when the cycle is complete, otherwise into a short break; a
 * finished break always returns to focus.
 */
export function advancePomodoro(
  phase: PomodoroPhase,
  completedFocus: number,
  settings: PomodoroSettings,
): { phase: PomodoroPhase; completedFocus: number } {
  if (phase !== "focus") return { phase: "focus", completedFocus };
  const next = completedFocus + 1;
  const everyNth = Math.max(1, settings.longBreakAfter);
  return next % everyNth === 0
    ? { phase: "longBreak", completedFocus: next }
    : { phase: "shortBreak", completedFocus: next };
}

/** Which focus block of the current cycle we are on (1 based). */
export function pomodoroCyclePosition(completedFocus: number, settings: PomodoroSettings): number {
  return (completedFocus % Math.max(1, settings.longBreakAfter)) + 1;
}

/** mm:ss, or h:mm:ss past an hour - the timer display. */
export function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}
