import type { SubjectBreakdownEntry } from "./subjects-shared";

export type WeekReviewStreakStatus = "extended" | "maintained" | "broken" | "none";

export type WeekReviewDaily = {
  date: string;
  label: string; // "Mon" ... "Sun"
  done: number;
  total: number;
};

export type WeekReviewHabit = {
  id: string;
  title: string;
  color: string;
  target: number;
  done: number;
  pct: number;
};

export type WeekReviewGoal = {
  id: string;
  title: string;
  status: string;
  color: string;
  isNewlyCompleted: boolean;
  isNewlyCreated: boolean;
};

export type WeeklyReview = {
  weekStart: string; // Monday (ISO date)
  weekEnd: string; // Sunday (ISO date)
  totalTasks: number;
  completedTasks: number;
  completionRate: number; // 0-100
  daily: WeekReviewDaily[];
  xpEarned: number;
  streakStatus: WeekReviewStreakStatus;
  activeDaysInWeek: number;
  streakAsOfEnd: number;
  currentStreak: number;
  bestStreak: number;
  habits: WeekReviewHabit[];
  habitDone: number;
  habitTarget: number;
  habitRate: number; // 0-100
  goals: WeekReviewGoal[];
  subjects: SubjectBreakdownEntry[];
  reflection: string | null;
};

export type ReviewPromptStatus = {
  shouldShow: boolean;
  weekStart: string;
  isMonday: boolean;
};
