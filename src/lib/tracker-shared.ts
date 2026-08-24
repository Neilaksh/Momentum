export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const XP_PER_TASK = 10;
export const XP_PERFECT_DAY = 50;

export type DayTask = {
  id: string;
  task_date: string;
  title: string;
  sort_order: number;
  source: string;
  routine_task_id: string | null;
  goal_id: string | null;
  completed_at: string | null;
};

export type RoutineTask = {
  id: string;
  weekday: number;
  title: string;
  sort_order: number;
  goal_id: string | null;
  is_active: boolean;
};

export type Goal = {
  id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  status: string;
  color: string;
};

export type Profile = {
  id: string;
  display_name: string | null;
  total_xp: number;
  level: number;
  current_streak: number;
  best_streak: number;
};

export type WeekDay = { date: string; weekday: number; tasks: DayTask[] };

export type WeekData = {
  weekStart: string;
  days: WeekDay[];
  profile: Profile | null;
};

/** ISO date string (YYYY-MM-DD) in local time. */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Monday-based week start for a given date. */
export function startOfWeek(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (copy.getDay() + 6) % 7; // 0 = Monday
  copy.setDate(copy.getDate() - day);
  return copy;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function weekDates(weekStartISO: string): string[] {
  const start = parseISODate(weekStartISO);
  return Array.from({ length: 7 }, (_, i) => toISODate(addDays(start, i)));
}

export function formatDayDate(iso: string): string {
  const d = parseISODate(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

export function levelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

export function xpForLevel(level: number): number {
  return Math.pow(Math.max(0, level - 1), 2) * 100;
}

export function levelProgress(xp: number): { level: number; into: number; span: number; pct: number } {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = next - base;
  const into = xp - base;
  return { level, into, span, pct: span > 0 ? Math.round((into / span) * 100) : 0 };
}

export function pctComplete(tasks: { completed_at: string | null }[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter((t) => t.completed_at).length;
  return Math.round((done / tasks.length) * 100);
}
