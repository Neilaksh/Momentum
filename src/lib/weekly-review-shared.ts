import { subjectColorHex, type SubjectBreakdownEntry } from "./subjects-shared";
import { formatMinutes } from "./tracker-shared";

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

/**
 * Label for the bucket that holds study sessions with no subject tagged. Study
 * time is still real time, so untagged sessions are grouped here rather than
 * dropped (unlike the task breakdown, which skips untagged tasks entirely).
 */
export const UNTAGGED_STUDY_LABEL = "Untagged";

/**
 * Color for the untagged study-time bucket: a theme-aware muted gray, NOT a
 * palette key. subjectColorHex() resolves an unknown key back to palette[0] —
 * a real-looking subject color — which would make "Untagged" look like a
 * genuine subject in the chart. Resolve entry colors with studyTimeColor() so
 * callers never have to branch on this.
 */
export const UNTAGGED_STUDY_COLOR = "var(--muted-foreground)";

/**
 * One row of the week's study-time breakdown. Same shape as
 * SubjectBreakdownEntry (subjectId / name / color) but tallying seconds instead
 * of a task count, because the two charts measure different units.
 *
 * Sessions with subject_id === null (or a subject that no longer joins) are
 * grouped into a single entry with subjectId === null, and that entry is always
 * sorted LAST regardless of duration — a long untagged session must not push
 * real subjects down the chart just because the student forgot to tag it.
 */
export type WeekReviewStudyTimeEntry = {
  subjectId: string | null;
  name: string;
  color: string;
  totalSeconds: number;
};

/** Chart/legend color for a study-time entry (handles the untagged sentinel). */
export function studyTimeColor(entry: WeekReviewStudyTimeEntry): string {
  return entry.subjectId === null ? UNTAGGED_STUDY_COLOR : subjectColorHex(entry.color);
}

/**
 * Study time for display as "Xh Ym" / "Xm" / "Xh", reusing the tracker's minute
 * formatter. Guards 0 / negative / non-finite input so an empty week renders
 * "0m" instead of "NaN m".
 */
export function formatStudyDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0m";
  return formatMinutes(Math.round(totalSeconds / 60));
}

/** Compact axis tick for the study-time chart: minutes → "45m" / "2h". */
export function formatStudyMinutesTick(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

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
  /** Completed study sessions for the week, ranked by duration; untagged last. */
  studyTime: WeekReviewStudyTimeEntry[];
  /**
   * Total seconds studied in the week across COMPLETED sessions only, tagged or
   * not — the headline stat represents time actually studied, regardless of
   * tagging discipline. A still-running session is excluded: it has no final
   * duration and belongs to the current week, not a finished one.
   */
  totalStudySeconds: number;
  reflection: string | null;
};

export type ReviewPromptStatus = {
  shouldShow: boolean;
  weekStart: string;
  isMonday: boolean;
};
