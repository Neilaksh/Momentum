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
};

/**
 * Goal membership used to be encoded as a "[goal:<uuid>]" title prefix; the
 * goal_habit_links join table is the source of truth now. Legacy habit titles
 * may still carry the prefix, so parse it off for display everywhere.
 */
export function parseHabitTitle(rawTitle: string): ParsedHabitTitle {
  if (!rawTitle) {
    return { cleanTitle: "", displayTitle: "", rawTitle: "" };
  }
  const match = rawTitle.match(/^\[goal:([^\]]+)\]\s*(.*)$/);
  if (match) {
    const cleanTitle = match[2] ?? "";
    return {
      cleanTitle,
      displayTitle: cleanTitle,
      rawTitle,
    };
  }
  return {
    cleanTitle: rawTitle,
    displayTitle: rawTitle,
    rawTitle,
  };
}

