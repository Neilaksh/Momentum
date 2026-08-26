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
