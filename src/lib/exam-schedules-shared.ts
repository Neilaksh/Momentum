import { parseISODate, toISODate } from "./tracker-shared";

export interface ExamSchedule {
  id: string;
  user_id?: string | undefined;
  subject_id: string | null;
  title: string;
  exam_date: string; // YYYY-MM-DD
  start_time?: string | null | undefined; // e.g. "09:00 AM" or "09:30"
  end_time?: string | null | undefined; // e.g. "11:30 AM" or "12:00"
  location?: string | null | undefined; // e.g. "Hall B - Room 204"
  notes?: string | null | undefined; // e.g. "Chapters 1-5, scientific calculator required"
  created_at: string;
  updated_at: string;
}

export interface CreateExamScheduleInput {
  subject_id?: string | null | undefined;
  title: string;
  exam_date: string;
  start_time?: string | null | undefined;
  end_time?: string | null | undefined;
  location?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface UpdateExamScheduleInput {
  id: string;
  subject_id?: string | null | undefined;
  title?: string | undefined;
  exam_date?: string | undefined;
  start_time?: string | null | undefined;
  end_time?: string | null | undefined;
  location?: string | null | undefined;
  notes?: string | null | undefined;
}

/**
 * Parses time string (e.g. "17:15", "05:15 PM", "9:30 am") into total minutes from midnight.
 */
export function parseTimeToMinutes(timeStr?: string | null): number | null {
  if (!timeStr || !timeStr.trim()) return null;
  const str = timeStr.trim().toLowerCase();

  // 12-hour format: "9:30 am", "09:30am", "11:45 pm", "09:30:00 am"
  const match12 = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/i);
  if (match12 && match12[1] && match12[2] && match12[3]) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const meridiem = match12[3].toLowerCase();
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // 24-hour format: "09:30", "17:15", "9:30", "17:15:00"
  const match24 = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match24 && match24[1] && match24[2]) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    return hours * 60 + minutes;
  }

  return null;
}

/**
 * Checks whether an exam has already completed/passed based on date and time.
 */
export function hasExamPassed(exam: ExamSchedule, referenceDate: Date = new Date()): boolean {
  const todayStr = toISODate(referenceDate);

  // Past calendar day
  if (exam.exam_date < todayStr) return true;

  // Future calendar day
  if (exam.exam_date > todayStr) return false;

  // Today: check end_time or start_time
  const nowMinutes = referenceDate.getHours() * 60 + referenceDate.getMinutes();

  const endMinutes = parseTimeToMinutes(exam.end_time);
  if (endMinutes !== null) {
    return nowMinutes >= endMinutes;
  }

  const startMinutes = parseTimeToMinutes(exam.start_time);
  if (startMinutes !== null) {
    // If only start time was provided, consider passed after start + 2 hours (120 mins)
    return nowMinutes >= startMinutes + 120;
  }

  // If no time is specified, passes once today is over
  return false;
}

/**
 * Calculates human-friendly countdown or status for an exam date.
 */
export function getDaysUntilExam(
  examDateStr: string,
  referenceDate: Date = new Date(),
  hasPassed?: boolean,
): {
  diffDays: number;
  label: string;
  isToday: boolean;
  isTomorrow: boolean;
  isPast: boolean;
  isSoon: boolean; // within 7 days
} {
  const todayStr = toISODate(referenceDate);
  const examDate = parseISODate(examDateStr);
  const today = parseISODate(todayStr);

  const diffTime = examDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (hasPassed) {
    return {
      diffDays,
      label: "Completed",
      isToday: false,
      isTomorrow: false,
      isPast: true,
      isSoon: false,
    };
  }

  const isToday = diffDays === 0;
  const isTomorrow = diffDays === 1;
  const isPast = diffDays < 0;
  const isSoon = diffDays > 0 && diffDays <= 7;

  let label: string;
  if (isToday) {
    label = "Today";
  } else if (isTomorrow) {
    label = "Tomorrow";
  } else if (diffDays > 1) {
    label = `In ${diffDays} days`;
  } else if (diffDays === -1) {
    label = "Yesterday";
  } else {
    label = `${Math.abs(diffDays)} days ago`;
  }

  return {
    diffDays,
    label,
    isToday,
    isTomorrow,
    isPast,
    isSoon,
  };
}

/**
 * Formats time range nicely: e.g. "09:00 AM - 11:30 AM" or "09:00 AM"
 */
export function formatExamTime(startTime?: string | null, endTime?: string | null): string {
  if (!startTime && !endTime) return "";
  if (startTime && endTime) return `${startTime} – ${endTime}`;
  return startTime || endTime || "";
}

/**
 * Filters and sorts exams that have not yet passed.
 * When viewDateStr is provided:
 * - If viewing a future day (viewDateStr > todayStr), only shows exams scheduled on or after that day
 * - If viewing a past day (viewDateStr < todayStr), returns empty (historical view)
 * - If viewing today (viewDateStr === todayStr), shows today's active exams and future upcoming exams
 */
export function getUpcomingExams(
  exams: ExamSchedule[],
  referenceDate: Date = new Date(),
  limit?: number,
  viewDateStr?: string,
): ExamSchedule[] {
  const todayStr = toISODate(referenceDate);
  const activeDate = viewDateStr || todayStr;

  // If viewing a past day, do not show exams in upcoming glance bar
  if (activeDate < todayStr) return [];

  const upcoming = exams
    .filter((e) => {
      // 1. Must not have passed in real time
      if (hasExamPassed(e, referenceDate)) return false;

      // 2. Must be scheduled on or after the date being viewed
      if (e.exam_date < activeDate) return false;

      return true;
    })
    .sort((a, b) => {
      if (a.exam_date !== b.exam_date) return a.exam_date.localeCompare(b.exam_date);
      return (a.start_time || "").localeCompare(b.start_time || "");
    });
  return typeof limit === "number" ? upcoming.slice(0, limit) : upcoming;
}

/**
 * Returns all exams scheduled for a specific date (YYYY-MM-DD).
 */
export function getExamsForDate(exams: ExamSchedule[], dateStr: string): ExamSchedule[] {
  return exams
    .filter((e) => e.exam_date === dateStr)
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
}
