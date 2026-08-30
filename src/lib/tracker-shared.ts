import type { Subject } from "./subjects-shared";

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
  description: string | null;
  sort_order: number;
  source: string;
  routine_task_id: string | null;
  goal_id: string | null;
  subject_id: string | null;
  completed_at: string | null;
  progress_pct: number;
  rollover_count: number;
  is_stale: boolean;
};

/**
 * Dedupe key for a goal-linked day_tasks row. The rollover, weekly
 * materialization and goal-schedule paths all insert goal-linked rows, and each
 * path may use a different routine_task_id (or none). They must agree on what
 * counts as "the same task on the same day", so they all key on
 * (task_date, goal_id, normalized title) here.
 */
export function goalLinkKey(
  date: string,
  t: { goal_id?: string | null; title?: string | null },
): string {
  return `goal|${date}|${t.goal_id ?? ""}|${(t.title ?? "").trim().toLowerCase()}`;
}

export type RoutineTask = {
  id: string;
  weekday: number;
  title: string;
  sort_order: number;
  goal_id: string | null;
  subject_id: string | null;
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

/** Weekly hit-rate for a single habit linked to a goal. */
export type GoalHabitStat = {
  habitId: string;
  title: string;
  targetPerWeek: number;
  /** Whole Monday-weeks since the goal was created. */
  weeksTotal: number;
  /** Weeks in which the habit's logs met or exceeded target_per_week. */
  weeksMet: number;
  /** 0–100 percentage of weeks on target. */
  hitRate: number;
};

/**
 * Computed goal progress (server-side). Task score = completed/total day_tasks
 * linked to the goal. Habit score = average per-habit weekly hit-rate since the
 * goal was created. Overall = average of the two when both exist; falls back to
 * whichever single score exists; null when neither exists.
 */
export type GoalProgress = {
  taskScore: number | null;
  taskTotal: number;
  taskDone: number;
  habitScore: number | null;
  habitsOnTrack: number;
  habitsTotal: number;
  overall: number | null;
  hasTasks: boolean;
  hasHabits: boolean;
  linkedHabits: GoalHabitStat[];
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
  subjects?: Subject[];
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

export const DEFAULT_TIME_SLOTS: readonly string[] = [];

export const SAMPLE_TIME_SLOTS = [
  "5:45–6:00 AM",
  "6:00–7:00 AM",
  "6:45–7:00 AM",
  "7:00–7:30 AM",
  "7:30–8:00 AM",
  "8:00–8:30 AM",
  "8:30–9:00 AM",
  "9:00–9:30 AM",
  "9:30–10:00 AM",
  "10:00–10:30 AM",
  "10:30–12:30 PM",
  "12:30–1:00 PM",
  "1:00–2:00 PM",
  "3:00–4:00 PM",
  "4:00–5:30 PM",
  "5:30–6:00 PM",
  "6:00–6:30 PM",
  "6:30–8:00 PM",
  "8:00–8:30 PM",
  "8:30–9:00 PM",
  "9:00–10:00 PM",
  "10:00–10:20 PM",
  "10:30 PM",
] as const;

export type ColorKey =
  | "emerald"
  | "cyan"
  | "amber"
  | "purple"
  | "indigo"
  | "rose"
  | "blue"
  | "fuchsia"
  | "teal"
  | "orange"
  | "slate";

export const COLOR_PALETTE: Record<ColorKey, { bg: string; text: string; border: string; label: string }> = {
  emerald: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", label: "Emerald" },
  cyan: { bg: "bg-cyan-500/15", text: "text-cyan-400", border: "border-cyan-500/30", label: "Cyan" },
  amber: { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30", label: "Amber" },
  purple: { bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/30", label: "Purple" },
  indigo: { bg: "bg-indigo-500/15", text: "text-indigo-400", border: "border-indigo-500/30", label: "Indigo" },
  rose: { bg: "bg-rose-500/15", text: "text-rose-400", border: "border-rose-500/30", label: "Rose" },
  blue: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30", label: "Blue" },
  fuchsia: { bg: "bg-fuchsia-500/15", text: "text-fuchsia-400", border: "border-fuchsia-500/30", label: "Fuchsia" },
  teal: { bg: "bg-teal-500/15", text: "text-teal-400", border: "border-teal-500/30", label: "Teal" },
  orange: { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/30", label: "Orange" },
  slate: { bg: "bg-secondary", text: "text-foreground", border: "border-border", label: "Slate" },
};

export const DEFAULT_CATEGORIES = [
  { name: "Fitness", colorKey: "emerald" as ColorKey },
  { name: "Study", colorKey: "cyan" as ColorKey },
  { name: "Meals", colorKey: "amber" as ColorKey },
  { name: "Recreation", colorKey: "purple" as ColorKey },
  { name: "Unwind", colorKey: "indigo" as ColorKey },
  { name: "Personal", colorKey: "rose" as ColorKey },
  { name: "Work", colorKey: "blue" as ColorKey },
  { name: "General", colorKey: "slate" as ColorKey },
];

export const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Fitness: COLOR_PALETTE.emerald,
  Study: COLOR_PALETTE.cyan,
  Meals: COLOR_PALETTE.amber,
  Recreation: COLOR_PALETTE.purple,
  Unwind: COLOR_PALETTE.indigo,
  Personal: COLOR_PALETTE.rose,
  Work: COLOR_PALETTE.blue,
  General: COLOR_PALETTE.slate,
};

export type ParsedRoutineTitle = {
  timeSlot: string;
  category: string;
  colorKey: ColorKey;
  emoji: string;
  cleanTitle: string;
  displayTitle: string;
  habitId: string | null;
  taskId: string | null;
  rawTitle: string;
};

/** Parse structured metadata from routine_tasks.title */
export function parseRoutineTitle(rawTitle: string): ParsedRoutineTitle {
  if (!rawTitle) {
    return {
      timeSlot: "",
      category: "General",
      colorKey: "slate",
      emoji: "📌",
      cleanTitle: "",
      displayTitle: "",
      habitId: null,
      taskId: null,
      rawTitle: "",
    };
  }

  // Check for extended pattern: [timeSlot|category|emoji|colorKey|habitId|taskId] title
  const match = rawTitle.match(/^\[([^\]]*)\]\s*(.*)$/);
  if (match) {
    const parts = (match[1] ?? "").split("|");
    const timeSlot = parts[0] ?? "";
    const category = parts[1] || "General";
    let emoji = parts[2] || "📌";
    let colorKey = (parts[3] as ColorKey) || "slate";
    const habitId = parts[4] && parts[4] !== "none" ? parts[4] : null;
    const taskId = parts[5] && parts[5] !== "none" ? parts[5] : null;
    let cleanTitle = (match[2] || "").trim();

    // Check if cleanTitle has its own leading emoji
    const leadingEmojiMatch = cleanTitle.match(/^(\p{Extended_Pictographic}|\u2705|\u2728|\u2b50)\s*(.*)$/u);
    if (leadingEmojiMatch) {
      if (!emoji || emoji === "📌" || emoji === "🎯") {
        emoji = leadingEmojiMatch[1]!;
      }
      cleanTitle = (leadingEmojiMatch[2] || "").trim();
    }

    if (!COLOR_PALETTE[colorKey]) {
      const fallbackColor = CATEGORY_COLORS[category];
      colorKey = fallbackColor ? "cyan" : "slate";
    }

    return {
      timeSlot,
      category,
      colorKey,
      emoji,
      cleanTitle,
      displayTitle: emoji ? `${emoji} ${cleanTitle}`.trim() : cleanTitle,
      habitId,
      taskId,
      rawTitle,
    };
  }

  // Legacy title parsing: check leading emoji if any
  const emojiMatch = rawTitle.match(/^(\p{Extended_Pictographic}|\u2705|\u2728|\u2b50)\s*(.*)$/u);
  if (emojiMatch) {
    return {
      timeSlot: "",
      category: "General",
      colorKey: "slate",
      emoji: emojiMatch[1] || "📌",
      cleanTitle: (emojiMatch[2] || rawTitle).trim(),
      displayTitle: rawTitle.trim(),
      habitId: null,
      taskId: null,
      rawTitle,
    };
  }

  return {
    timeSlot: "",
    category: "General",
    colorKey: "slate",
    emoji: "📌",
    cleanTitle: rawTitle,
    displayTitle: rawTitle,
    habitId: null,
    taskId: null,
    rawTitle,
  };
}

/** Format structured routine task title into storage string. */
export function formatRoutineTitle(
  cleanTitle: string,
  timeSlot: string = "",
  category: string = "General",
  emoji: string = "📌",
  colorKey: ColorKey = "slate",
  habitId: string | null = null,
  taskId: string | null = null,
): string {
  const trimmed = cleanTitle.trim();
  const emo = emoji || "📌";
  const hId = habitId ?? "none";
  const tId = taskId ?? "none";

  if (!timeSlot && category === "General" && emo === "📌" && colorKey === "slate" && !habitId && !taskId) {
    return trimmed;
  }
  return `[${timeSlot}|${category}|${emo}|${colorKey}|${hId}|${tId}] ${trimmed}`;
}

/** Calculate duration in minutes from a time slot string like "6:00–7:00 AM" or "10:30–12:30 PM" */
export function calculateSlotDurationMinutes(timeSlot: string): number {
  if (!timeSlot) return 30; // default 30 mins

  // Normalize delimiters (en-dash, em-dash, hyphen, to)
  const normalized = timeSlot.replace(/[–—]/g, "-").replace(/\s+to\s+/i, "-");
  const parts = normalized.split("-");

  if (parts.length < 2) return 30;

  const parseTimePart = (part: string, fallbackAmPm?: string): number | null => {
    const trimmed = part.trim().toUpperCase();
    const isPm = trimmed.includes("PM");
    const isAm = trimmed.includes("AM");
    const rawTime = trimmed.replace(/[^\d:]/g, "");
    if (!rawTime) return null;

    const [hStr, mStr] = rawTime.split(":");
    let h = parseInt(hStr ?? "0", 10);
    const m = parseInt(mStr ?? "0", 10);
    if (isNaN(h)) return null;

    let pm = isPm;
    if (!isPm && !isAm && fallbackAmPm) {
      pm = fallbackAmPm.includes("PM");
    }

    if (pm && h < 12) h += 12;
    if (!pm && isAm && h === 12) h = 0;

    return h * 60 + (isNaN(m) ? 0 : m);
  };

  const endPart = parts[1] ?? "";
  const endAmPm = endPart.toUpperCase().includes("PM") ? "PM" : endPart.toUpperCase().includes("AM") ? "AM" : undefined;

  const startMins = parseTimePart(parts[0] ?? "", endAmPm);
  const endMins = parseTimePart(endPart, endAmPm);

  if (startMins !== null && endMins !== null) {
    let diff = endMins - startMins;
    if (diff < 0) diff += 24 * 60; // wraps around midnight
    return diff > 0 ? diff : 30;
  }

  return 30;
}


/** Sample Routine Schedule matching reference spreadsheet */
export const SAMPLE_WEEKLY_ROUTINE: Array<{
  weekdays: number[]; // 0=Mon, 1=Tue, ..., 6=Sun
  timeSlot: string;
  title: string;
  emoji: string;
  category: string;
  colorKey?: ColorKey;
}> = [
  { weekdays: [0, 1, 2, 3, 4, 5, 6], timeSlot: "5:45–6:00 AM", title: "Wake Up & Hydrate", emoji: "🌅", category: "Personal" },
  { weekdays: [0, 1, 2, 3, 4, 5, 6], timeSlot: "6:00–7:00 AM", title: "Exercise", emoji: "🏋️", category: "Fitness" },
  { weekdays: [2, 3, 4, 5, 6], timeSlot: "6:45–7:00 AM", title: "Getting ready for swimming", emoji: "🏄", category: "Fitness" },
  { weekdays: [0, 1], timeSlot: "7:00–7:30 AM", title: "Freshen Up", emoji: "🚿", category: "Personal" },
  { weekdays: [2, 3, 4, 5, 6], timeSlot: "7:00–7:30 AM", title: "Swimming Class", emoji: "🏊", category: "Fitness" },
  { weekdays: [0, 1], timeSlot: "7:30–8:00 AM", title: "Breakfast", emoji: "🍳", category: "Meals" },
  { weekdays: [2, 3, 4, 5, 6], timeSlot: "7:30–8:00 AM", title: "Swimming Class", emoji: "🏊", category: "Fitness" },
  { weekdays: [0, 1], timeSlot: "8:00–8:30 AM", title: "Study Block 1", emoji: "📚", category: "Study" },
  { weekdays: [2, 3, 4, 5, 6], timeSlot: "8:00–8:30 AM", title: "Swimming Class", emoji: "🏊", category: "Fitness" },
  { weekdays: [0, 1], timeSlot: "8:30–9:00 AM", title: "Study Block 1", emoji: "📚", category: "Study" },
  { weekdays: [2, 3, 4, 5, 6], timeSlot: "8:30–9:00 AM", title: "Freshen Up After Swim", emoji: "🚿", category: "Personal" },
  { weekdays: [0, 1], timeSlot: "9:00–9:30 AM", title: "Study Block 1", emoji: "📚", category: "Study" },
  { weekdays: [2, 3, 4, 5, 6], timeSlot: "9:00–9:30 AM", title: "Breakfast", emoji: "🍳", category: "Meals" },
  { weekdays: [0, 1, 2, 3, 4], timeSlot: "9:30–10:00 AM", title: "Study Block 1", emoji: "📚", category: "Study" },
  { weekdays: [5], timeSlot: "9:30–10:00 AM", title: "Study Block 1", emoji: "📚", category: "Study" },
  { weekdays: [6], timeSlot: "9:30–10:00 AM", title: "Leisure Reading", emoji: "📖", category: "Recreation" },
  { weekdays: [0, 1], timeSlot: "10:00–10:30 AM", title: "Short Break", emoji: "☕", category: "Unwind" },
  { weekdays: [2, 3, 4], timeSlot: "10:00–10:30 AM", title: "Study Block 1", emoji: "📚", category: "Study" },
  { weekdays: [5], timeSlot: "10:00–10:30 AM", title: "Study Block 1", emoji: "📚", category: "Study" },
  { weekdays: [6], timeSlot: "10:00–10:30 AM", title: "Hobby / Project", emoji: "🎨", category: "Recreation" },
  { weekdays: [0, 1, 2, 3, 4, 5, 6], timeSlot: "10:30–12:30 PM", title: "Study Block 2", emoji: "💻", category: "Study" },
  { weekdays: [0, 1, 2, 3, 4, 5, 6], timeSlot: "12:30–1:00 PM", title: "Quality Time", emoji: "🌺", category: "Personal" },
  { weekdays: [0, 1, 2, 3, 4, 5, 6], timeSlot: "1:00–2:00 PM", title: "Lunch & Rest", emoji: "🍱", category: "Meals" },
  { weekdays: [0, 1, 2, 3, 4, 5, 6], timeSlot: "3:00–4:00 PM", title: "Study Block 3", emoji: "💻", category: "Study" },
  { weekdays: [0, 1, 2, 3, 4], timeSlot: "4:00–5:30 PM", title: "Gaming / Recreation", emoji: "🎮", category: "Recreation" },
  { weekdays: [5, 6], timeSlot: "4:00–5:30 PM", title: "Outing / Social Time", emoji: "🏄", category: "Recreation" },
  { weekdays: [0, 1, 2, 3, 4, 5, 6], timeSlot: "5:30–6:00 PM", title: "Unwind / Meditation", emoji: "🧘", category: "Unwind" },
  { weekdays: [0, 1, 2, 3, 5], timeSlot: "6:00–6:30 PM", title: "Evening Study", emoji: "📚", category: "Study" },
  { weekdays: [4, 6], timeSlot: "6:00–6:30 PM", title: "Get Ready for Karate", emoji: "🥋", category: "Fitness" },
  { weekdays: [0, 1, 2, 3, 5], timeSlot: "6:30–8:00 PM", title: "Evening Study", emoji: "📚", category: "Study" },
  { weekdays: [4, 6], timeSlot: "6:30–8:00 PM", title: "Karate Class", emoji: "🥋", category: "Fitness" },
  { weekdays: [4, 6], timeSlot: "8:00–8:30 PM", title: "Free Time / Relax", emoji: "🎮", category: "Recreation" },
  { weekdays: [0, 1, 2, 3, 5], timeSlot: "8:00–8:30 PM", title: "Evening Study", emoji: "📚", category: "Study" },
  { weekdays: [0, 1, 2, 3, 4, 5, 6], timeSlot: "8:30–9:00 PM", title: "Dinner", emoji: "🍲", category: "Meals" },
  { weekdays: [0, 1, 2, 3, 4, 5, 6], timeSlot: "9:00–10:00 PM", title: "Gaming / Free Time", emoji: "🎮", category: "Recreation" },
  { weekdays: [0, 1, 2, 3, 4, 5, 6], timeSlot: "10:00–10:20 PM", title: "Wind Down", emoji: "🌙", category: "Unwind" },
  { weekdays: [0, 1, 2, 3, 4, 5, 6], timeSlot: "10:30 PM", title: "Sleep", emoji: "😴", category: "Unwind" },
];

