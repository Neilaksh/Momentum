import type { Tables } from "@/integrations/supabase/types";
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

/** day_tasks row — sourced from the generated Supabase types (single source of truth). */
export type DayTask = Tables<"day_tasks">;

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

/**
 * Partition day_tasks into rollover chains — the display-only chain identity
 * shared by the Goal Tasks list collapse and the week board's "Completed late"
 * badge. Uses the same rules as the server's superseded detection in getGoals
 * (tracker.functions.ts):
 *   1. a later copy with rollover_count === count + 1 supersedes the row, or
 *   2. a later copy with the SAME count >= 1 supersedes it (the rollover pass
 *      stamps the source row and its fresh copy with one count), or
 *   3. the OLDEST row of a multi-row group with rollover_count >= 1 is the
 *      chain's original — it chains forward to the next later row even when
 *      the counts drifted past the exact +1/same pattern (stale-limit jumps).
 *
 * Rows are keyed by (goal_id, normalized title) like the server, and rules
 * 1 & 2 only ever link a row to the earliest qualifying LATER copy, so two
 * independently-created same-title tasks that never rolled (both count 0)
 * stay separate chains. Every input row appears in exactly one returned
 * chain (singleton chains included), so callers can render one row per chain
 * or read per-chain status (e.g. "any copy completed?").
 */
export function buildRolloverChains(tasks: DayTask[]): DayTask[][] {
  const groups = new Map<string, DayTask[]>();
  for (const t of tasks) {
    const key = `${t.goal_id ?? ""}|${(t.title ?? "").trim().toLowerCase()}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  // Union-find so rule-linked rows merge into whole chains.
  const parent = new Map<string, string>();
  for (const t of tasks) parent.set(t.id, t.id);
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.task_date.localeCompare(b.task_date));
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i]!;
      const rCount = r.rollover_count ?? 0;
      let linked = false;
      // Rules 1 & 2 — identical to the server's superseded detection.
      for (let j = i + 1; j < sorted.length; j++) {
        const c = sorted[j]!;
        const cCount = c.rollover_count ?? 0;
        if (cCount === rCount + 1 || (cCount === rCount && rCount >= 1)) {
          union(r.id, c.id);
          linked = true;
          break;
        }
      }
      // Rule 3 — only the group's OLDEST row is the chain original: it still
      // collapses forward when no copy matches the exact count pattern
      // (stale-limit count jumps). Later rows with a >= 1 count but no
      // successor are NOT chain-linked, so a new independent task sharing the
      // title stays its own chain.
      if (!linked && i === 0 && rCount >= 1 && sorted.length > 1) {
        union(r.id, sorted[1]!.id);
      }
    }

    // Completion bridge — manual re-creation resets rollover_count to 0, so a
    // chain can end without its completed copy (real-world pattern 2/0/0:
    // engine-stamped original, then hand re-added rows the engine never
    // stamped). If the chain's newest row is uncompleted and a LATER
    // same-key row is completed, bridge the chain's newest row to that
    // completed row so the whole thing identifies as one chain again.
    // Gated on the chain already being multi-row (formed by the count rules
    // above — e.g. via the oldest-row rule) so genuinely independent
    // same-title tasks — singleton rows with no chain history — never merge.
    const byRoot = new Map<string, DayTask[]>();
    for (const t of sorted) {
      const root = find(t.id);
      const members = byRoot.get(root) ?? [];
      members.push(t);
      byRoot.set(root, members);
    }
    for (const members of byRoot.values()) {
      if (members.length < 2) continue;
      const newest = members.reduce((a, b) => (b.task_date > a.task_date ? b : a));
      if (newest.completed_at) continue;
      const target = sorted.find(
        (t) => t.task_date > newest.task_date && !!t.completed_at && find(t.id) !== find(newest.id),
      );
      if (target) union(newest.id, target.id);
    }
  }

  const chains = new Map<string, DayTask[]>();
  for (const t of tasks) {
    const root = find(t.id);
    const list = chains.get(root) ?? [];
    list.push(t);
    chains.set(root, list);
  }
  return [...chains.values()];
}

/**
 * Ids of rollover rows that are superseded: every row of a multi-row chain
 * EXCEPT the chain's newest (live) copy. Only the newest copy of each chain
 * contributes to a goal's total/done — frozen history does not. Shares
 * buildRolloverChains' linking (including the completion bridge) so the
 * server's goal-counting math and the client's badge/chain-collapse can never
 * disagree with each other.
 */
export function getSupersededRolloverIds(tasks: DayTask[]): Set<string> {
  const superseded = new Set<string>();
  for (const chain of buildRolloverChains(tasks)) {
    if (chain.length < 2) continue;
    const newest = chain.reduce((a, b) => (b.task_date > a.task_date ? b : a));
    for (const t of chain) if (t.id !== newest.id) superseded.add(t.id);
  }
  return superseded;
}

export type RoutineTask = {
  id: string;
  weekday: number;
  title: string;
  sort_order: number;
  goal_id: string | null;
  subject_id: string | null;
  is_active: boolean;
  variant_key: string | null;
  created_at: string;
};

export type Goal = {
  id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  status: string;
  color: string;
};

/** Progress for a single habit linked to a goal. */
export type GoalHabitStat = {
  habitId: string;
  title: string;
  targetPerWeek: number;
  /**
   * Unlimited links: whole Monday-weeks since the link (goal_habit_links.created_at).
   * Duration-limited links: the duration window's day count (repurposed so the
   * shared on-track rule weeksMet === weeksTotal stays uniform across both modes).
   */
  weeksTotal: number;
  /** Unlimited: weeks that met the weekly target. Duration-limited: days logged in the window. */
  weeksMet: number;
  /** 0–100 percentage. Unlimited: weeks on target. Duration-limited: days logged / duration. */
  hitRate: number;
  /** Present only for duration-limited links — the tracking window in days. */
  durationDays?: number;
  /** Present only for duration-limited links — distinct days logged in the window. */
  daysLogged?: number;
};

/**
 * Frozen per-habit hit-rate captured when its goal completed (stored in
 * goal_habit_snapshots). Displayed inside a completed goal instead of the
 * live, still-moving habit stats.
 */
export type GoalHabitSnapshot = {
  habitId: string;
  weeksOnTarget: number;
  totalWeeks: number;
  hitRatePct: number;
  snapshottedAt: string;
};

/**
 * Computed goal progress (server-side). Task score = completed/total day_tasks
 * linked to the goal. Habit score = average per-habit weekly hit-rate, each
 * habit measured since its goal_habit_links.created_at (when it was linked to
 * this goal), not since the goal itself was created. Overall = average of the
 * two when both exist; falls back to whichever single score exists; null when
 * neither exists.
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
  /**
   * day_tasks rows fetched from just OUTSIDE the visible week (a ±7-day
   * lookaround buffer — chains are capped at STALE_LIMIT = 3 rolls, so a few
   * days always spans the whole chain). Used ONLY by the client's rollover
   * chain detection so the "Completed late" badge works for chains that cross
   * a Sunday/Monday boundary: a chain whose frozen originals sit in the
   * visible week can have its completed copy a few days past the week edge.
   * These rows are never rendered and never affect week counts/percentages.
   */
  chainContextTasks?: DayTask[];
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

/**
 * Parse the task `description` field which may contain both a human-readable
 * note and an embedded effort estimate encoded as `\n---est:N---` at the end.
 * Returns the clean note and the estimated minutes (or null if not set).
 */
export function parseTaskDescription(raw: string | null | undefined): {
  note: string;
  estMinutes: number | null;
} {
  if (!raw) return { note: "", estMinutes: null };
  const match = raw.match(/(?:^|\n)---est:(\d+)---$/);
  if (match) {
    const est = parseInt(match[1]!, 10);
    const note = raw.slice(0, match.index).trimEnd();
    return {
      note,
      estMinutes: Number.isInteger(est) && est > 0 ? est : null,
    };
  }
  return { note: raw, estMinutes: null };
}

/** Serialize note + estMinutes back into the `description` field. */
export function formatTaskDescription(note: string, estMinutes: number | null): string | null {
  const cleanNote = note.trim();
  if (!cleanNote && estMinutes === null) return null;
  if (estMinutes === null) return cleanNote || null;
  return cleanNote ? `${cleanNote}\n---est:${estMinutes}---` : `\n---est:${estMinutes}---`;
}

/** Format minutes as "Xh Ym" / "Xm" / "Xh" for display. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export type GoalPriority = "High" | "Med" | "Low";

/**
 * Parse a goal title that may contain an encoded priority prefix `[p:High]`.
 * Returns the clean title and the priority (or null if unset).
 */
export function parseGoalTitle(raw: string): { cleanTitle: string; priority: GoalPriority | null } {
  if (!raw) return { cleanTitle: "", priority: null };
  const match = raw.match(/^\[p:(High|Med|Low)\]\s*(.*)$/);
  if (!match) return { cleanTitle: raw, priority: null };
  return { cleanTitle: (match[2] ?? "").trim(), priority: match[1] as GoalPriority };
}

/** Serialize a clean goal title + priority back into the stored title string. */
export function formatGoalTitle(cleanTitle: string, priority: GoalPriority | null): string {
  const clean = parseGoalTitle(cleanTitle).cleanTitle.trim();
  if (!priority) return clean;
  return `[p:${priority}] ${clean}`;
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

export function levelProgress(xp: number): {
  level: number;
  into: number;
  span: number;
  pct: number;
} {
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

export const COLOR_PALETTE: Record<
  ColorKey,
  { bg: string; text: string; border: string; label: string }
> = {
  emerald: {
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    label: "Emerald",
  },
  cyan: {
    bg: "bg-cyan-500/15",
    text: "text-cyan-400",
    border: "border-cyan-500/30",
    label: "Cyan",
  },
  amber: {
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    border: "border-amber-500/30",
    label: "Amber",
  },
  purple: {
    bg: "bg-purple-500/15",
    text: "text-purple-400",
    border: "border-purple-500/30",
    label: "Purple",
  },
  indigo: {
    bg: "bg-indigo-500/15",
    text: "text-indigo-400",
    border: "border-indigo-500/30",
    label: "Indigo",
  },
  rose: {
    bg: "bg-rose-500/15",
    text: "text-rose-400",
    border: "border-rose-500/30",
    label: "Rose",
  },
  blue: {
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    border: "border-blue-500/30",
    label: "Blue",
  },
  fuchsia: {
    bg: "bg-fuchsia-500/15",
    text: "text-fuchsia-400",
    border: "border-fuchsia-500/30",
    label: "Fuchsia",
  },
  teal: {
    bg: "bg-teal-500/15",
    text: "text-teal-400",
    border: "border-teal-500/30",
    label: "Teal",
  },
  orange: {
    bg: "bg-orange-500/15",
    text: "text-orange-400",
    border: "border-orange-500/30",
    label: "Orange",
  },
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
    const leadingEmojiMatch = cleanTitle.match(
      /^(\p{Extended_Pictographic}|\u2705|\u2728|\u2b50)\s*(.*)$/u,
    );
    if (leadingEmojiMatch) {
      if (!emoji || emoji === "📌" || emoji === "🎯") {
        emoji = leadingEmojiMatch[1]!;
      }
      cleanTitle = (leadingEmojiMatch[2] || "").trim();
    }

    if (!COLOR_PALETTE[colorKey]) {
      // Fall back through the category's own palette key (kept mapping from the
      // removed CATEGORY_COLORS), else slate.
      const fallbackColorKey = (DEFAULT_CATEGORIES.find((c) => c.name === category)?.colorKey ??
        "slate") as ColorKey;
      colorKey = COLOR_PALETTE[fallbackColorKey] ? fallbackColorKey : "slate";
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

  if (
    !timeSlot &&
    category === "General" &&
    emo === "📌" &&
    colorKey === "slate" &&
    !habitId &&
    !taskId
  ) {
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
  const endAmPm = endPart.toUpperCase().includes("PM")
    ? "PM"
    : endPart.toUpperCase().includes("AM")
      ? "AM"
      : undefined;

  const startMins = parseTimePart(parts[0] ?? "", endAmPm);
  const endMins = parseTimePart(endPart, endAmPm);

  if (startMins !== null && endMins !== null) {
    let diff = endMins - startMins;
    if (diff < 0) diff += 24 * 60; // wraps around midnight
    return diff > 0 ? diff : 30;
  }

  return 30;
}

/**
 * Start time of a time slot in minutes since midnight (0–1439), or null if the
 * slot's start can't be parsed. Handles 12-hour ("6:00–7:00 AM", with the
 * AM/PM inherited from the end part when the start omits it, and 12:00 AM
 * correctly resolving to midnight), 24-hour ("21:45–23:30"), and the en-dash /
 * em-dash / hyphen / "to" delimiters accepted by calculateSlotDurationMinutes.
 * Used to keep time-slot rows sorted chronologically regardless of the order
 * slots were created in.
 */
export function timeSlotStartMinutes(timeSlot: string): number | null {
  if (!timeSlot) return null;

  // Normalize delimiters (en-dash, em-dash, hyphen, to) — same as duration calc.
  const normalized = timeSlot.replace(/[–—]/g, "-").replace(/\s+to\s+/i, "-");
  const parts = normalized.split("-");

  const parseOne = (part: string, fallbackAmPm?: string): number | null => {
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
    if (!isPm && !isAm && fallbackAmPm) pm = fallbackAmPm.includes("PM");

    if (pm && h < 12) h += 12;
    // 12 o'clock: PM stays noon; AM — explicit or inherited from the end part —
    // is midnight.
    if (!pm && (isAm || fallbackAmPm === "AM") && h === 12) h = 0;

    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + (isNaN(m) ? 0 : m);
  };

  if (parts.length < 2) {
    // Bare single time (no range) — parse it on its own.
    return parseOne(parts[0] ?? "");
  }

  const endPart = parts[1] ?? "";
  const endAmPm = endPart.toUpperCase().includes("PM")
    ? "PM"
    : endPart.toUpperCase().includes("AM")
      ? "AM"
      : undefined;

  return parseOne(parts[0] ?? "", endAmPm);
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
  {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timeSlot: "5:45–6:00 AM",
    title: "Wake Up & Hydrate",
    emoji: "🌅",
    category: "Personal",
  },
  {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timeSlot: "6:00–7:00 AM",
    title: "Exercise",
    emoji: "🏋️",
    category: "Fitness",
  },
  {
    weekdays: [2, 3, 4, 5, 6],
    timeSlot: "6:45–7:00 AM",
    title: "Getting ready for swimming",
    emoji: "🏄",
    category: "Fitness",
  },
  {
    weekdays: [0, 1],
    timeSlot: "7:00–7:30 AM",
    title: "Freshen Up",
    emoji: "🚿",
    category: "Personal",
  },
  {
    weekdays: [2, 3, 4, 5, 6],
    timeSlot: "7:00–7:30 AM",
    title: "Swimming Class",
    emoji: "🏊",
    category: "Fitness",
  },
  {
    weekdays: [0, 1],
    timeSlot: "7:30–8:00 AM",
    title: "Breakfast",
    emoji: "🍳",
    category: "Meals",
  },
  {
    weekdays: [2, 3, 4, 5, 6],
    timeSlot: "7:30–8:00 AM",
    title: "Swimming Class",
    emoji: "🏊",
    category: "Fitness",
  },
  {
    weekdays: [0, 1],
    timeSlot: "8:00–8:30 AM",
    title: "Study Block 1",
    emoji: "📚",
    category: "Study",
  },
  {
    weekdays: [2, 3, 4, 5, 6],
    timeSlot: "8:00–8:30 AM",
    title: "Swimming Class",
    emoji: "🏊",
    category: "Fitness",
  },
  {
    weekdays: [0, 1],
    timeSlot: "8:30–9:00 AM",
    title: "Study Block 1",
    emoji: "📚",
    category: "Study",
  },
  {
    weekdays: [2, 3, 4, 5, 6],
    timeSlot: "8:30–9:00 AM",
    title: "Freshen Up After Swim",
    emoji: "🚿",
    category: "Personal",
  },
  {
    weekdays: [0, 1],
    timeSlot: "9:00–9:30 AM",
    title: "Study Block 1",
    emoji: "📚",
    category: "Study",
  },
  {
    weekdays: [2, 3, 4, 5, 6],
    timeSlot: "9:00–9:30 AM",
    title: "Breakfast",
    emoji: "🍳",
    category: "Meals",
  },
  {
    weekdays: [0, 1, 2, 3, 4],
    timeSlot: "9:30–10:00 AM",
    title: "Study Block 1",
    emoji: "📚",
    category: "Study",
  },
  {
    weekdays: [5],
    timeSlot: "9:30–10:00 AM",
    title: "Study Block 1",
    emoji: "📚",
    category: "Study",
  },
  {
    weekdays: [6],
    timeSlot: "9:30–10:00 AM",
    title: "Leisure Reading",
    emoji: "📖",
    category: "Recreation",
  },
  {
    weekdays: [0, 1],
    timeSlot: "10:00–10:30 AM",
    title: "Short Break",
    emoji: "☕",
    category: "Unwind",
  },
  {
    weekdays: [2, 3, 4],
    timeSlot: "10:00–10:30 AM",
    title: "Study Block 1",
    emoji: "📚",
    category: "Study",
  },
  {
    weekdays: [5],
    timeSlot: "10:00–10:30 AM",
    title: "Study Block 1",
    emoji: "📚",
    category: "Study",
  },
  {
    weekdays: [6],
    timeSlot: "10:00–10:30 AM",
    title: "Hobby / Project",
    emoji: "🎨",
    category: "Recreation",
  },
  {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timeSlot: "10:30–12:30 PM",
    title: "Study Block 2",
    emoji: "💻",
    category: "Study",
  },
  {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timeSlot: "12:30–1:00 PM",
    title: "Quality Time",
    emoji: "🌺",
    category: "Personal",
  },
  {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timeSlot: "1:00–2:00 PM",
    title: "Lunch & Rest",
    emoji: "🍱",
    category: "Meals",
  },
  {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timeSlot: "3:00–4:00 PM",
    title: "Study Block 3",
    emoji: "💻",
    category: "Study",
  },
  {
    weekdays: [0, 1, 2, 3, 4],
    timeSlot: "4:00–5:30 PM",
    title: "Gaming / Recreation",
    emoji: "🎮",
    category: "Recreation",
  },
  {
    weekdays: [5, 6],
    timeSlot: "4:00–5:30 PM",
    title: "Outing / Social Time",
    emoji: "🏄",
    category: "Recreation",
  },
  {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timeSlot: "5:30–6:00 PM",
    title: "Unwind / Meditation",
    emoji: "🧘",
    category: "Unwind",
  },
  {
    weekdays: [0, 1, 2, 3, 5],
    timeSlot: "6:00–6:30 PM",
    title: "Evening Study",
    emoji: "📚",
    category: "Study",
  },
  {
    weekdays: [4, 6],
    timeSlot: "6:00–6:30 PM",
    title: "Get Ready for Karate",
    emoji: "🥋",
    category: "Fitness",
  },
  {
    weekdays: [0, 1, 2, 3, 5],
    timeSlot: "6:30–8:00 PM",
    title: "Evening Study",
    emoji: "📚",
    category: "Study",
  },
  {
    weekdays: [4, 6],
    timeSlot: "6:30–8:00 PM",
    title: "Karate Class",
    emoji: "🥋",
    category: "Fitness",
  },
  {
    weekdays: [4, 6],
    timeSlot: "8:00–8:30 PM",
    title: "Free Time / Relax",
    emoji: "🎮",
    category: "Recreation",
  },
  {
    weekdays: [0, 1, 2, 3, 5],
    timeSlot: "8:00–8:30 PM",
    title: "Evening Study",
    emoji: "📚",
    category: "Study",
  },
  {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timeSlot: "8:30–9:00 PM",
    title: "Dinner",
    emoji: "🍲",
    category: "Meals",
  },
  {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timeSlot: "9:00–10:00 PM",
    title: "Gaming / Free Time",
    emoji: "🎮",
    category: "Recreation",
  },
  {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timeSlot: "10:00–10:20 PM",
    title: "Wind Down",
    emoji: "🌙",
    category: "Unwind",
  },
  {
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timeSlot: "10:30 PM",
    title: "Sleep",
    emoji: "😴",
    category: "Unwind",
  },
];
