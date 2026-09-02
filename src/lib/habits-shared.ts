export type Habit = {
  id: string;
  title: string;
  color: string;
  target_per_week: number;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
};

export type HabitStat = {
  habit: Habit;
  weekDone: number;
  weekTarget: number;
  weekPct: number;
  yearDone: number;
  yearTarget: number;
  yearPct: number;
  streak: number;
  bestStreak?: number;
  doneDates: string[];
};

export type HabitsData = {
  weekStart: string;
  dates: string[];
  stats: HabitStat[];
  totals: {
    weekDone: number;
    weekTarget: number;
    weekPct: number;
    yearDone: number;
    yearTarget: number;
    yearPct: number;
  };
};

export type ParsedHabitTitle = {
  cleanTitle: string;
  displayTitle: string;
  rawTitle: string;
  timeTag?: string;
};

/**
 * Goal membership used to be encoded as a "[goal:<uuid>]" title prefix; the
 * goal_habit_links join table is the source of truth now. Legacy habit titles
 * may still carry the prefix, so parse it off for display everywhere.
 * Also parses optional [time:...] tags for preferred time/reminders.
 */
export function parseHabitTitle(rawTitle: string): ParsedHabitTitle {
  if (!rawTitle) {
    return { cleanTitle: "", displayTitle: "", rawTitle: "" };
  }
  let working = rawTitle.replace(/^\[goal:[^\]]+\]\s*/, "");
  let timeTag: string | undefined;
  const timeMatch = working.match(/\[time:([^\]]+)\]/i);
  if (timeMatch) {
    timeTag = timeMatch[1]?.trim();
    working = working.replace(/\[time:[^\]]+\]/gi, "").trim();
  }
  return {
    cleanTitle: working.trim(),
    displayTitle: working.trim(),
    rawTitle,
    timeTag,
  };
}

export function formatHabitTitle(cleanTitle: string, timeTag?: string | null): string {
  const trimmed = cleanTitle.trim();
  if (timeTag && timeTag.trim()) {
    return `[time:${timeTag.trim()}] ${trimmed}`;
  }
  return trimmed;
}

