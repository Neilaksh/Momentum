import { useState, useMemo, useEffect } from "react";
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  GraduationCap,
  ChevronRight,
  ChevronDown,
  Sparkles,
  CalendarDays,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Subject } from "@/lib/subjects-shared";
import { subjectColorHex } from "@/lib/subjects-shared";
import {
  formatExamTime,
  getDaysUntilExam,
  getExamsForDate,
  getUpcomingExams,
  type ExamSchedule,
} from "@/lib/exam-schedules-shared";
import { useExamSchedules } from "@/lib/exam-schedules-store";
import { formatDayDate, toISODate, parseISODate } from "@/lib/tracker-shared";
import { ExamScheduleDialog } from "./ExamScheduleDialog";

export interface UpcomingExamsGlanceBarProps {
  subjects: Subject[];
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
}

/**
 * Renders the top Upcoming Exams Glance Bar across the dashboard.
 * - Automatically dismisses any exam as soon as its deadline passes.
 * - When viewing future days, only shows exams on or after the viewed day (past exams become invisible).
 * - If no upcoming exams exist for the viewed day, the glance bar becomes invisible.
 */
export function UpcomingExamsGlanceBar({
  subjects,
  selectedDate,
  onSelectDate,
}: UpcomingExamsGlanceBarProps) {
  const { exams } = useExamSchedules();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    const updateTime = () => setCurrentTime(new Date());
    const timer = setInterval(updateTime, 10000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") updateTime();
    };

    window.addEventListener("focus", updateTime);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", updateTime);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const subjectsMap = useMemo(() => {
    const map = new Map<string, Subject>();
    for (const s of subjects) map.set(s.id, s);
    return map;
  }, [subjects]);

  const upcoming = useMemo(
    () => getUpcomingExams(exams, currentTime, 5, selectedDate),
    [exams, currentTime, selectedDate],
  );

  const referenceDate = useMemo(() => {
    const todayStr = toISODate(currentTime);
    const activeDate = selectedDate || todayStr;
    if (activeDate > todayStr) {
      return parseISODate(activeDate);
    }
    return currentTime;
  }, [selectedDate, currentTime]);

  if (upcoming.length === 0) {
    return (
      <>
        <ExamScheduleDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          subjects={subjects}
        />
      </>
    );
  }

  return (
    <>
      <div className="mb-6 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-card to-card p-4 shadow-sm transition-all sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/20 text-primary">
              <GraduationCap className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tracking-wider uppercase text-primary">
                  Exam Schedule
                </span>
                <span className="rounded-full bg-primary/20 px-2 py-0.2 text-[10px] font-bold text-primary">
                  {upcoming.length} upcoming
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Upcoming tests and examinations linked to your subjects.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(true)}
              className="h-8 gap-1.5 text-xs font-medium border-primary/30 hover:bg-primary/10 text-primary"
            >
              <CalendarDays className="h-3.5 w-3.5" /> View Full Schedule
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-label={isCollapsed ? "Expand upcoming exams" : "Collapse upcoming exams"}
              className="h-8 w-8 text-muted-foreground"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${
                  isCollapsed ? "-rotate-90" : ""
                }`}
              />
            </Button>
          </div>
        </div>

        {!isCollapsed && (
          <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((exam) => {
              const subject = exam.subject_id ? subjectsMap.get(exam.subject_id) : null;
              const countdown = getDaysUntilExam(exam.exam_date, referenceDate);
              const formattedTime = formatExamTime(exam.start_time, exam.end_time);

              return (
                <button
                  key={exam.id}
                  onClick={() => {
                    if (onSelectDate) onSelectDate(exam.exam_date);
                    setDialogOpen(true);
                  }}
                  className={`flex flex-col justify-between rounded-xl border p-3 text-left transition-all hover:scale-[1.01] ${
                    countdown.isToday
                      ? "border-primary bg-primary/10 shadow-sm"
                      : countdown.isSoon
                        ? "border-amber-500/30 bg-card hover:border-amber-500/60"
                        : "border-border bg-card/80 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    {subject ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold truncate max-w-[150px]"
                        style={{
                          backgroundColor: `${subjectColorHex(subject.color)}20`,
                          color: subjectColorHex(subject.color),
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: subjectColorHex(subject.color) }}
                        />
                        <span className="truncate">{subject.name}</span>
                      </span>
                    ) : (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        General
                      </span>
                    )}

                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider ${
                        countdown.isToday
                          ? "bg-primary text-primary-foreground animate-pulse"
                          : countdown.isTomorrow
                            ? "bg-amber-500/20 text-amber-500"
                            : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {countdown.label}
                    </span>
                  </div>

                  <div className="my-1.5">
                    <p className="font-semibold text-sm tracking-tight text-foreground truncate">
                      {exam.title}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 font-medium">
                      <CalendarIcon className="h-3 w-3 text-primary/70" />
                      {formatDayDate(exam.exam_date)}
                    </span>
                    {formattedTime && (
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-3 w-3 text-primary/70" />
                        {formattedTime}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <ExamScheduleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        subjects={subjects}
      />
    </>
  );
}

/**
 * Renders the focused day's exam alert card (distinctly separated from tasks).
 */
export function FocusedDayExamCard({
  subjects,
  selectedDate,
}: {
  subjects: Subject[];
  selectedDate: string;
}) {
  const { exams } = useExamSchedules();
  const [dialogOpen, setDialogOpen] = useState(false);

  const subjectsMap = useMemo(() => {
    const map = new Map<string, Subject>();
    for (const s of subjects) map.set(s.id, s);
    return map;
  }, [subjects]);

  const dayExams = useMemo(() => getExamsForDate(exams, selectedDate), [exams, selectedDate]);

  if (dayExams.length === 0) return null;

  const todayISO = toISODate(new Date());
  const isToday = selectedDate === todayISO;

  return (
    <>
      <div className="mb-5 space-y-3">
        {dayExams.map((exam) => {
          const subject = exam.subject_id ? subjectsMap.get(exam.subject_id) : null;
          const formattedTime = formatExamTime(exam.start_time, exam.end_time);

          return (
            <div
              key={exam.id}
              className={`relative overflow-hidden rounded-xl border p-4 sm:p-5 transition-all shadow-sm ${
                isToday
                  ? "border-primary/60 bg-gradient-to-r from-primary/15 via-card to-card ring-1 ring-primary/40"
                  : "border-primary/30 bg-gradient-to-r from-secondary/40 via-card to-card"
              }`}
            >
              {/* Decorative accent bar on left */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1.5"
                style={{
                  backgroundColor: subject ? subjectColorHex(subject.color) : "var(--primary)",
                }}
              />

              <div className="flex flex-wrap items-start justify-between gap-3 pl-1">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                      <GraduationCap className="h-3 w-3" />
                      {isToday ? "Exam Today" : "Exam Scheduled For This Day"}
                    </span>

                    {subject && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{
                          backgroundColor: `${subjectColorHex(subject.color)}20`,
                          color: subjectColorHex(subject.color),
                          border: `1px solid ${subjectColorHex(subject.color)}40`,
                        }}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: subjectColorHex(subject.color) }}
                        />
                        {subject.name}
                      </span>
                    )}
                  </div>

                  <h3 className="text-lg font-bold tracking-tight text-foreground">
                    {exam.title}
                  </h3>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-0.5">
                    {formattedTime && (
                      <span className="flex items-center gap-1.5 font-medium text-foreground/90">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        {formattedTime}
                      </span>
                    )}

                    {exam.location && (
                      <span className="flex items-center gap-1.5 text-foreground/80">
                        <MapPin className="h-3.5 w-3.5 text-primary" />
                        {exam.location}
                      </span>
                    )}
                  </div>

                  {exam.notes && (
                    <div className="mt-2.5 rounded-lg bg-secondary/40 border border-border/50 p-2.5 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground/85 block mb-0.5">
                        Exam Notes & Topics:
                      </span>
                      <p className="whitespace-pre-line">{exam.notes}</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDialogOpen(true)}
                    className="h-8 gap-1.5 text-xs font-medium"
                  >
                    Manage Schedule
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ExamScheduleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        subjects={subjects}
      />
    </>
  );
}
