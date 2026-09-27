import { useCallback, useEffect, useState } from "react";

import {
  clampPomodoroCycle,
  clampPomodoroSettings,
  DEFAULT_POMODORO_CYCLE,
  DEFAULT_POMODORO_SETTINGS,
  POMODORO_CYCLE_STORAGE_KEY,
  POMODORO_SETTINGS_STORAGE_KEY,
  type PomodoroCycle,
  type PomodoroSettings,
} from "./pomodoro-shared";

/** localStorage is unavailable during SSR and can throw in private modes. */
function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn(`[pomodoro] could not read ${key}`, err);
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[pomodoro] could not save ${key}`, err);
  }
}

export interface PomodoroState {
  settings: PomodoroSettings;
  updateSettings: (patch: Partial<PomodoroSettings>) => void;
  resetSettings: () => void;
  cycle: PomodoroCycle;
  updateCycle: (patch: Partial<PomodoroCycle>) => void;
  resetCycle: () => void;
}

/**
 * The Pomodoro cycle state, cached per device.
 *
 * Settings and the cycle position both start at the classic defaults and hydrate
 * from localStorage in an effect, so the prerendered /study markup always matches
 * the first client render. Every write is clamped, so a stale or hand-edited
 * cache can never produce a phase shorter than a minute or a stray phase name.
 */
export function usePomodoro(): PomodoroState {
  const [settings, setSettings] = useState<PomodoroSettings>(DEFAULT_POMODORO_SETTINGS);
  const [cycle, setCycle] = useState<PomodoroCycle>(DEFAULT_POMODORO_CYCLE);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setSettings(clampPomodoroSettings(readJson(POMODORO_SETTINGS_STORAGE_KEY)));
    setCycle(clampPomodoroCycle(readJson(POMODORO_CYCLE_STORAGE_KEY)));
    setIsHydrated(true);
  }, []);

  // Only write back once hydrated, otherwise the defaults would overwrite a saved
  // cycle on every page load.
  useEffect(() => {
    if (isHydrated) writeJson(POMODORO_SETTINGS_STORAGE_KEY, settings);
  }, [settings, isHydrated]);

  useEffect(() => {
    if (isHydrated) writeJson(POMODORO_CYCLE_STORAGE_KEY, cycle);
  }, [cycle, isHydrated]);

  const updateSettings = useCallback((patch: Partial<PomodoroSettings>) => {
    setSettings((prev) => clampPomodoroSettings({ ...prev, ...patch }));
  }, []);

  const resetSettings = useCallback(() => setSettings(DEFAULT_POMODORO_SETTINGS), []);

  const updateCycle = useCallback((patch: Partial<PomodoroCycle>) => {
    setCycle((prev) => clampPomodoroCycle({ ...prev, ...patch }));
  }, []);

  const resetCycle = useCallback(() => setCycle(DEFAULT_POMODORO_CYCLE), []);

  return { settings, updateSettings, resetSettings, cycle, updateCycle, resetCycle };
}

/**
 * Short two-tone chime for the end of a phase, synthesised with WebAudio so the
 * app needs no audio asset. Silently no-ops when the browser blocks audio (SSR,
 * no output device, autoplay policy).
 */
export function playPhaseChime(): void {
  if (typeof window === "undefined") return;
  const AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;
  try {
    const ctx = new AudioCtor();
    const start = ctx.currentTime;
    // A5 then D6: bright but short, and quiet enough not to startle.
    [880, 1174.66].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = start + index * 0.22;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.22);
    });
    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 800);
  } catch (err) {
    console.warn("[pomodoro] chime failed", err);
  }
}
