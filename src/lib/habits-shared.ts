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
  goalId: string | null;
  rawTitle: string;
};

export function parseHabitTitle(rawTitle: string): ParsedHabitTitle {
  if (!rawTitle) {
    return { cleanTitle: "", displayTitle: "", goalId: null, rawTitle: "" };
  }
  const match = rawTitle.match(/^\[goal:([^\]]+)\]\s*(.*)$/);
  if (match) {
    const goalId = match[1] ?? null;
    const cleanTitle = match[2] ?? "";
    return {
      cleanTitle,
      displayTitle: cleanTitle,
      goalId,
      rawTitle,
    };
  }
  return {
    cleanTitle: rawTitle,
    displayTitle: rawTitle,
    goalId: null,
    rawTitle,
  };
}

export function formatHabitTitle(cleanTitle: string, goalId?: string | null): string {
  const trimmed = cleanTitle.trim();
  if (goalId) {
    return `[goal:${goalId}] ${trimmed}`;
  }
  return trimmed;
}

