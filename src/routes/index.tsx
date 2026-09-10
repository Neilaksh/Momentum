import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Award,
  Calendar as CalendarIcon,
  CalendarClock,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  FileText,
  GraduationCap,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Zap,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { DailyQuoteBanner } from "@/components/DailyQuoteBanner";
import { WeeklyReviewBanner } from "@/components/WeeklyReviewBanner";
import { UpcomingExamsGlanceBar } from "@/components/ExamScheduleBanner";
import { useExamSchedules } from "@/lib/exam-schedules-store";
import { ProgressRing } from "@/components/ProgressRing";
import { PieStat } from "@/components/PieStat";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addDayTask,
  completeDayTasksBulk,
  deleteDayTask,
  getGoals,
  getWeek,
  renameDayTask,
  reorderDayTasks,
  rescheduleDayTask,
  toggleDayTask,
  updateDayTaskDescription,
  setDayTaskPriority,
} from "@/lib/tracker.functions";
import { getSubjects } from "@/lib/subjects.functions";
import { subjectColorHex, type Subject } from "@/lib/subjects-shared";
import {
  WEEKDAY_NAMES,
  XP_PER_TASK,
  XP_PERFECT_DAY,
  addDays,
  buildRolloverChains,
  formatDayDate,
  formatMinutes,
  formatTaskDescription,
  parseISODate,
  parseGoalTitle,
  parseRoutineTitle,
  parseTaskDescription,
  pctComplete,
  startOfWeek,
  toISODate,
  type GoalPriority,
  type WeekData,
} from "@/lib/tracker-shared";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tasks — Daily & Weekly Task Tracker with Day Pie Chart" },
      {
        name: "description",
        content:
          "Unified daily and weekly task tracker: focus on today's tasks with a live completion pie chart and manage your entire 7-day schedule in one place.",
      },
      { property: "og:title", content: "Tasks — Daily & Weekly Task Tracker" },
      {
        property: "og:description",
        content:
          "A dark-mode task tracker combining focused daily completion pie charts and 7-day weekly schedule management.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <UnifiedTasksPage />
    </RequireAuth>
  ),
});

type TaskFilter = "all" | "pending" | "completed";

/** Stable key for an in-flight add-task request (target day + trimmed title). */
const addTaskKey = (date: string, title: string) => `${date}::${title}`;

function UnifiedTasksPage() {
  const [initialSubjectFilter] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("subjectId");
  });
  const [weekStart, setWeekStart] = useState(() => toISODate(startOfWeek(new Date())));
  const todayISO = toISODate(new Date());
  const [selectedDate, setSelectedDate] = useState(() => todayISO);
  const [draft, setDraft] = useState("");
  const [draftSubjectId, setDraftSubjectId] = useState<string | null>(initialSubjectFilter);
  const [draftPriority, setDraftPriority] = useState<GoalPriority | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState<string | null>(initialSubjectFilter);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [estDrafts, setEstDrafts] = useState<Record<string, string>>({});
  const [showCharts, setShowCharts] = useState(false);
  const focusPanelRef = useRef<HTMLElement>(null);
  // (date, title) pairs of add-task requests currently in flight, so a
  // double-click / double-Enter can never create duplicate rows.
  const addInflightKeys = useRef<Set<string>>(new Set());
  const qc = useQueryClient();

  useEffect(() => {
    if (initialSubjectFilter) {
      setDraftSubjectId(initialSubjectFilter);
      setSubjectFilter(initialSubjectFilter);
    }
  }, [initialSubjectFilter]);

  const fetchWeek = useServerFn(getWeek);
  const fetchSubjectsFn = useServerFn(getSubjects);
  const toggleFn = useServerFn(toggleDayTask);
  const addFn = useServerFn(addDayTask);
  const delFn = useServerFn(deleteDayTask);
  const updateDescFn = useServerFn(updateDayTaskDescription);

  const { data, isLoading } = useQuery({
    queryKey: ["week", weekStart],
    queryFn: () => fetchWeek({ data: { weekStart } }) as Promise<WeekData>,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["week"] });
    void qc.invalidateQueries({ queryKey: ["history"] });
    void qc.invalidateQueries({ queryKey: ["goals"] });
  };

  const toggle = useMutation({
    mutationFn: (v: { id: string; completed: boolean }) => toggleFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["week", weekStart] });
      const prev = qc.getQueryData<WeekData>(["week", weekStart]);
      if (prev) {
        qc.setQueryData<WeekData>(["week", weekStart], {
          ...prev,
          days: prev.days.map((d) => ({
            ...d,
            tasks: d.tasks.map((t) =>
              t.id === v.id
                ? { ...t, completed_at: v.completed ? new Date().toISOString() : null, progress_pct: v.completed ? 100 : t.progress_pct }
                : t,
            ),
          })),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["week", weekStart], ctx.prev);
      toast.error("Couldn't save that — try again.");
    },
    onSettled: invalidate,
  });

  const addTask = useMutation({
    mutationFn: (v: { date: string; title: string; subjectId?: string | null; priority?: GoalPriority | null }) =>
      addFn({ data: v }),
    onSuccess: () => {
      invalidate();
      toast.success("Task added");
    },
    onError: () => toast.error("Couldn't add that task."),
    // Release the in-flight dedupe key whether the insert succeeded or failed,
    // so an intentional retry after an error is never blocked.
    onSettled: (_data, _error, variables) => {
      if (variables) addInflightKeys.current.delete(addTaskKey(variables.date, variables.title));
    },
  });

  const removeTask = useMutation({
    mutationFn: (v: { id: string }) => delFn({ data: v }),
    onSuccess: invalidate,
    onError: () => toast.error("Couldn't delete task — try again."),
  });

  // Inline title editing (pencil icon → small modal). The server fn renames the
  // whole rollover chain, not just the visible row. Priority is plain metadata
  // (NOT identity-bearing like the title), so it's written to the visible row
  // only — future rollover copies inherit it via the carry-forward pass.
  const [renamingTask, setRenamingTask] = useState<{
    id: string;
    title: string;
    priority: GoalPriority | null;
  } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamePriority, setRenamePriority] = useState<GoalPriority | null>(null);
  const renameFn = useServerFn(renameDayTask);
  const setPriorityFn = useServerFn(setDayTaskPriority);
  const renameTask = useMutation({
    mutationFn: async (v: { id: string; title: string; priority?: GoalPriority | null }) => {
      const res = await renameFn({ data: { id: v.id, title: v.title } });
      if (v.priority !== undefined) {
        await setPriorityFn({ data: { id: v.id, priority: v.priority } });
      }
      return res;
    },
    onSuccess: (_res, v) => {
      invalidate();
      setRenamingTask(null);
      toast.success(`Renamed to “${v.title.trim()}”`);
    },
    onError: () => toast.error("Couldn't rename task — try again."),
  });
  const setTaskPriority = useMutation({
    mutationFn: (v: { id: string; priority: GoalPriority | null }) => setPriorityFn({ data: v }),
    onSuccess: () => {
      invalidate();
      setRenamingTask(null);
      toast.success("Priority updated");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't update priority — try again."),
  });

  const updateDescription = useMutation({
    mutationFn: (v: { id: string; description: string | null; estMinutes?: number | null }) =>
      updateDescFn({ data: v }),
    onSuccess: () => {
      invalidate();
      toast.success("Note saved");
    },
    onError: () => toast.error("Couldn't save note — try again."),
  });

  const completeBulkFn = useServerFn(completeDayTasksBulk);
  const completeBulk = useMutation({
    mutationFn: (v: { date: string }) => completeBulkFn({ data: v }),
    onSuccess: (res) => {
      invalidate();
      toast.success(
        res?.completedCount
          ? `Completed ${res.completedCount} task${res.completedCount !== 1 ? "s" : ""}!`
          : "All tasks completed!",
      );
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't complete tasks."),
  });

  const reorderFn = useServerFn(reorderDayTasks);
  const reorderTask = useMutation({
    mutationFn: (v: { date: string; orderedIds: string[] }) => reorderFn({ data: v }),
    onSuccess: () => {
      invalidate();
    },
    onError: () => toast.error("Couldn't reorder tasks."),
  });

  const rescheduleFn = useServerFn(rescheduleDayTask);
  const rescheduleTask = useMutation({
    mutationFn: (v: { id: string; targetDate: string }) => rescheduleFn({ data: v }),
    onSuccess: (_, vars) => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ["goals"] });
      toast.success(`Rescheduled to ${formatDayDate(vars.targetDate)}`);
    },
    onError: (err: any) =>
      toast.error(err?.message || "Couldn't reschedule task."),
  });

  const toggleNote = (t: { id: string; description: string | null }) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(t.id)) {
        next.delete(t.id);
      } else {
        next.add(t.id);
        setNoteDrafts((d) => ({ ...d, [t.id]: parseTaskDescription(t.description).note }));
        const existingEst = parseTaskDescription(t.description).estMinutes;
        setEstDrafts((d) => ({ ...d, [t.id]: existingEst != null ? String(existingEst) : "" }));
      }
      return next;
    });
  };

  const startRenaming = (t: { id: string; title: string; priority?: string | null }) => {
    const p = (t.priority ?? null) as GoalPriority | null;
    setRenamingTask({ id: t.id, title: t.title, priority: p });
    setRenameDraft(t.title);
    setRenamePriority(p);
  };

  const submitRename = () => {
    if (!renamingTask) return;
    const title = renameDraft.trim();
    const priorityChanged = renamePriority !== (renamingTask.priority ?? null);
    if ((!title || title === renamingTask.title.trim()) && !priorityChanged) {
      setRenamingTask(null);
      return;
    }
    if (title && title !== renamingTask.title.trim()) {
      renameTask.mutate({ id: renamingTask.id, title, priority: renamePriority });
    } else {
      setTaskPriority.mutate({ id: renamingTask.id, priority: renamePriority });
    }
  };

  const fetchGoals = useServerFn(getGoals);
  const { data: goalsData } = useQuery({
    queryKey: ["goals"],
    queryFn: () => fetchGoals({ data: undefined }),
  });

  const goalsMap = useMemo(() => {
    const map = new Map<string, { id: string; title: string; status?: string | null }>();
    for (const g of goalsData?.goals ?? []) {
      // Goal titles store an encoded priority prefix "[p:High] ..." — show the
      // clean title on the Tasks tab (priority is surfaced on the Goals tab).
      map.set(g.id, { ...g, title: parseGoalTitle(g.title).cleanTitle });
    }
    return map;
  }, [goalsData]);

  const { data: subjectsData } = useQuery({
    queryKey: ["subjects"],
    queryFn: () => fetchSubjectsFn() as Promise<{ subjects: Subject[] }>,
  });
  const subjects = subjectsData?.subjects ?? [];
  const subjectsMap = useMemo(() => {
    const map = new Map<string, Subject>();
    for (const s of subjects) map.set(s.id, s);
    return map;
  }, [subjects]);
  // If the filtered subject was deleted, fall back to "All" instead of an empty list.
  const activeSubjectFilter = subjectFilter && subjectsMap.has(subjectFilter) ? subjectFilter : null;

  // Exam Schedules integration
  const { exams } = useExamSchedules();
  const examDatesSet = useMemo(() => new Set(exams.map((e) => e.exam_date)), [exams]);

  const days = data?.days ?? [];
  // Include direct tasks AND goal-linked repeating tasks (only unlinked routine schedule blocks stay in Routines tab)
  const days$ = days.map((d) => ({
    ...d,
    tasks: d.tasks.filter((t) => t.source !== "routine" || t.goal_id !== null),
  }));
  const allTasks = days$.flatMap((d) => d.tasks);
  const doneCount = allTasks.filter((t) => t.completed_at).length;
  const weekPct = pctComplete(allTasks);

  // Display-only: ids of tasks whose rollover chain contains a completed copy.
  // A frozen original showing "Due" on the week board upgrades its badge to
  // "Completed late" once its active copy has been completed elsewhere. Purely
  // a badge swap — day counts/percentages use t.completed_at and are unchanged,
  // the frozen row stays read-only, and the completed copy's own day renders
  // exactly as it already does.
  //
  // Chain detection runs over the visible week's tasks PLUS the ±7-day
  // lookaround buffer the server attaches (chainContextTasks): chains are
  // capped at STALE_LIMIT = 3 rolls, so a chain's completed copy can sit a few
  // days past the week edge (e.g. starts Friday, completes Monday). Without
  // the buffer the chain would collapse to its frozen prefix with no completed
  // member and the badge would never show. Buffer rows never render and never
  // enter the week's counts — they only complete chain membership here.
  const chainCompletedIds = new Set<string>();
  const chainContextTasks = (data?.chainContextTasks ?? []).filter(
    // Same universe as allTasks above: pure-routine (non-goal) rows are not
    // rendered as tasks, so they must not join a chain either.
    (t) => t.source !== "routine" || t.goal_id !== null,
  );
  const chainDetectionTasks = [...allTasks, ...chainContextTasks];
  for (const chain of buildRolloverChains(chainDetectionTasks)) {
    if (chain.length > 1 && chain.some((t) => t.completed_at)) {
      for (const t of chain) chainCompletedIds.add(t.id);
    }
  }

  // Selected Day resolution
  const activeDay = useMemo(() => {
    const found = days$.find((d) => d.date === selectedDate);
    // Never silently retarget to a different day: if the selected date isn't in
    // the loaded week yet (week switch / refetch), keep targeting the date the
    // user actually picked instead of falling back to days$[0].
    return found ?? { date: selectedDate, weekday: 0, tasks: [] };
  }, [days$, selectedDate]);

  // Keep selected date inside active week when shifting weeks
  useEffect(() => {
    if (days.length > 0) {
      const datesInWeek = days.map((d) => d.date);
      if (!datesInWeek.includes(selectedDate)) {
        if (datesInWeek.includes(todayISO)) {
          setSelectedDate(todayISO);
        } else if (datesInWeek[0]) {
          setSelectedDate(datesInWeek[0]);
        }
      }
    }
  }, [days, weekStart, selectedDate, todayISO]);

  const activeTasks = activeDay.tasks;
  const doneActive = activeTasks.filter((t) => t.completed_at).length;
  const remainingActive = activeTasks.length - doneActive;
  // Sum estimated minutes across all active-day tasks that have an estimate
  const totalEstMinutes = activeTasks.reduce((sum, t) => {
    const { estMinutes } = parseTaskDescription(t.description);
    return sum + (estMinutes ?? 0);
  }, 0);
  const routineActiveCount = days.find((d) => d.date === selectedDate)?.tasks.filter((t) => t.source === "routine").length ?? 0;
  const oneOffActiveCount = activeTasks.length;
  const isPerfectActive = activeTasks.length > 0 && doneActive === activeTasks.length;
  const activeDayXpEarned = doneActive * XP_PER_TASK + (isPerfectActive ? XP_PERFECT_DAY : 0);

  const parsedActiveDate = parseISODate(activeDay.date);
  const activeWeekdayName = WEEKDAY_NAMES[(parsedActiveDate.getDay() + 6) % 7]!;
  const isActiveDayToday = activeDay.date === todayISO;
  // Past days are read-only in the focused panel: toggling, deleting and adding
  // are locked for any date strictly before today. Today and future stay editable.
  const isActiveDayPast = activeDay.date < todayISO;

  const filteredActiveTasks = useMemo(() => {
    let list = [...activeTasks];
    list.sort((a, b) => {
      const orderA = a.sort_order ?? 0;
      const orderB = b.sort_order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return a.created_at.localeCompare(b.created_at);
    });
    if (activeSubjectFilter) list = list.filter((t) => t.subject_id === activeSubjectFilter);
    if (filter === "pending") return list.filter((t) => !t.completed_at);
    if (filter === "completed") return list.filter((t) => !!t.completed_at);
    return list;
  }, [activeTasks, filter, activeSubjectFilter]);

  const moveTask = (taskId: string, direction: "up" | "down") => {
    const list = [...filteredActiveTasks];
    const index = list.findIndex((t) => t.id === taskId);
    if (index === -1) return;
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === list.length - 1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const currentTask = list[index];
    const targetTask = list[targetIndex];
    if (!currentTask || !targetTask) return;
    list[index] = targetTask;
    list[targetIndex] = currentTask;
    reorderTask.mutate({ date: selectedDate, orderedIds: list.map((t) => t.id) });
  };

  const chartData = useMemo(
    () =>
      days$.map((d, i) => ({
        day: WEEKDAY_NAMES[i]!.slice(0, 3),
        done: d.tasks.filter((t) => t.completed_at).length,
        total: d.tasks.length,
        date: d.date,
      })),
    [days$],
  );

  function shiftWeek(delta: number) {
    const nextStart = toISODate(addDays(parseISODate(weekStart), delta * 7));
    setWeekStart(nextStart);
  }

  const weekEnd = toISODate(addDays(parseISODate(weekStart), 6));

  return (
    <AppShell profile={data?.profile ?? null}>
      {/* Slim Announcements Tray — quote + weekly review + exams in compact stack */}
      <DailyQuoteBanner />
      <WeeklyReviewBanner />
      <UpcomingExamsGlanceBar
        subjects={subjects}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      {/* Header: Week Switcher & Jump to Today */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Tasks</h1>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              Weekly
            </span>
          </div>
          <p className="num mt-0.5 text-xs text-muted-foreground">
            {formatDayDate(weekStart)} — {formatDayDate(weekEnd)}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            onClick={() => shiftWeek(-1)}
            aria-label="Previous week"
            className="h-8 w-8"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const curWeekStart = toISODate(startOfWeek(new Date()));
              setWeekStart(curWeekStart);
              setSelectedDate(todayISO);
            }}
            className="h-8 text-xs font-medium px-3"
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => shiftWeek(1)}
            aria-label="Next week"
            className="h-8 w-8"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Unified Interactive Week Hub ── */}
      <div className="mt-5">
        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {days$.map((d, i) => {
            const isSelected = d.date === selectedDate;
            const isDayToday = d.date === todayISO;
            const hasExam = examDatesSet.has(d.date);
            const dayDone = d.tasks.filter((t) => t.completed_at).length;
            const dayTotal = d.tasks.length;
            const dayPct = dayTotal ? Math.round((dayDone / dayTotal) * 100) : 0;
            const isComplete = dayTotal > 0 && dayDone === dayTotal;

            return (
              <button
                key={d.date}
                onClick={() => {
                  setSelectedDate(d.date);
                  setTimeout(() => focusPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                }}
                className={`relative flex flex-col items-center gap-0.5 rounded-xl border p-1.5 sm:p-2.5 text-center transition-all ${
                  isSelected
                    ? "border-primary bg-primary/10 shadow-sm shadow-primary/20 ring-1 ring-primary"
                    : isDayToday
                      ? "border-primary/40 bg-card hover:bg-primary/5"
                      : "border-border/60 bg-card hover:border-primary/40 hover:bg-secondary/30"
                }`}
              >
                {/* Day label */}
                <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider ${
                  isSelected ? "text-primary" : "text-muted-foreground"
                }`}>
                  {WEEKDAY_NAMES[i]!.slice(0, 3)}
                </span>

                {/* Date number with mini progress ring */}
                <div className="relative my-0.5">
                  <ProgressRing value={dayPct} size={32} stroke={2.5} label={String(parseISODate(d.date).getDate())} className="text-[11px] sm:text-xs" />
                </div>

                {/* Indicators row */}
                <div className="flex items-center gap-0.5 min-h-[14px]">
                  {isDayToday && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" title="Today" />
                  )}
                  {hasExam && (
                    <GraduationCap className="h-3 w-3 text-primary" />
                  )}
                  {isComplete && (
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  )}
                </div>

                {/* Task count */}
                <span className="hidden sm:block num text-[9px] text-muted-foreground">
                  {dayDone}/{dayTotal}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Compact Stats Bar + Toggleable Charts ── */}
      <div className="mt-4">
        {/* Compact summary row — always visible */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-4">
            {/* Today's progress mini */}
            <div className="flex items-center gap-2.5">
              <PieStat
                done={doneActive}
                total={activeTasks.length}
                label={isActiveDayToday ? "Today" : activeWeekdayName.slice(0, 3)}
                caption=""
                size={44}
                showTooltip={false}
              />
              <div>
                <p className="text-xs font-semibold">
                  {doneActive}/{activeTasks.length} <span className="text-muted-foreground font-normal">tasks</span>
                </p>
                <p className="num text-[10px] text-muted-foreground">
                  {isActiveDayToday ? "Today" : activeWeekdayName} · {activeTasks.length ? Math.round((doneActive / activeTasks.length) * 100) : 0}%
                </p>
              </div>
            </div>

            {/* Separator */}
            <div className="hidden sm:block h-8 w-px bg-border" />

            {/* Week progress */}
            <div className="hidden sm:flex items-center gap-2.5">
              <div className="flex flex-col">
                <p className="text-xs font-semibold">
                  {doneCount}/{allTasks.length} <span className="text-muted-foreground font-normal">weekly</span>
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="h-1.5 w-20 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-300" style={{ width: `${weekPct}%` }} />
                  </div>
                  <span className="num text-[10px] text-muted-foreground">{weekPct}%</span>
                </div>
              </div>
            </div>

            {/* XP badge */}
            {activeDayXpEarned > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                <Zap className="h-3 w-3" /> +{activeDayXpEarned} XP
              </span>
            )}
            {isPerfectActive && (
              <span className="flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
                <Sparkles className="h-3 w-3" /> Perfect
              </span>
            )}
          </div>

          {/* Chart toggle */}
          <button
            onClick={() => setShowCharts(!showCharts)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            {showCharts ? "Hide Charts" : "Show Charts"}
            <ChevronDown className={`h-3 w-3 transition-transform ${showCharts ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* Expandable charts panel */}
        {showCharts && (
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] animate-in slide-in-from-top-2 duration-200">
            {/* Day Pie Chart */}
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
                  {isActiveDayToday ? "Today's Breakdown" : `${activeWeekdayName}'s Breakdown`}
                </span>
              </div>
              <div className="flex justify-center">
                <PieStat
                  done={doneActive}
                  total={activeTasks.length}
                  label={isActiveDayToday ? "Today" : activeWeekdayName}
                  caption={`${doneActive} of ${activeTasks.length} completed`}
                  size={140}
                  showTooltip={true}
                />
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Completed</span>
                  <span className="num font-semibold">{doneActive}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Remaining</span>
                  <span className="num font-semibold">{remainingActive}</span>
                </div>
                <div className="border-t border-border/60 pt-1.5 flex justify-between font-medium">
                  <span className="text-primary flex items-center gap-1">
                    <Zap className="h-3 w-3" /> XP
                  </span>
                  <span className="num font-bold text-primary">+{activeDayXpEarned}</span>
                </div>
              </div>
            </section>

            {/* Week Bar Chart */}
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm overflow-hidden min-w-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
                  Week Progress
                </span>
                <span className="num text-xs text-muted-foreground">{doneCount}/{allTasks.length} done ({weekPct}%)</span>
              </div>
              <div className="h-32 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 8, right: 8, bottom: 0, left: -24 }}
                    onClick={(e) => {
                      if (e && e.activePayload && e.activePayload.length) {
                        const payload = e.activePayload[0]?.payload;
                        if (payload?.date) setSelectedDate(payload.date);
                      }
                    }}
                  >
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                    <Tooltip
                      cursor={{ fill: "var(--secondary)" }}
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                      formatter={(val: any, _name: any, item: any) => [`${val} of ${item?.payload?.total ?? 0} tasks done`, "Completions"]}
                    />
                    <Bar dataKey="done" fill="var(--primary)" radius={[6, 6, 0, 0]} className="cursor-pointer" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* Focused Day Task Management Panel */}
      <section ref={focusPanelRef} className="mt-6 scroll-mt-28 sm:scroll-mt-24 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">
                {isActiveDayToday ? "Today's Tasks" : `${activeWeekdayName}'s Tasks`}
              </h2>
            </div>
            <p className="num text-xs text-muted-foreground mt-0.5">
              {formatDayDate(activeDay.date)} · {doneActive} of {activeTasks.length} completed ({activeTasks.length ? Math.round((doneActive / activeTasks.length) * 100) : 0}%)
              {totalEstMinutes > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-primary/80">
                  · ⏱ ~{formatMinutes(totalEstMinutes)} planned
                </span>
              )}
            </p>
          </div>

          {/* Action buttons & Filter tabs */}
          <div className="flex flex-wrap items-center gap-2">
            {!isActiveDayPast && remainingActive > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => completeBulk.mutate({ date: selectedDate })}
                disabled={completeBulk.isPending}
                className="h-8 gap-1.5 text-xs text-primary border-primary/30 hover:bg-primary/10 transition-colors"
                title="Mark all uncompleted tasks for this day as completed"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Complete All ({remainingActive})
              </Button>
            )}

            <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1 text-xs">
              <button
                onClick={() => setFilter("all")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  filter === "all"
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({activeTasks.length})
              </button>
              <button
                onClick={() => setFilter("pending")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  filter === "pending"
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Pending ({remainingActive})
              </button>
              <button
                onClick={() => setFilter("completed")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  filter === "completed"
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Done ({doneActive})
              </button>
            </div>
          </div>
        </div>

        {/* Subject Filter Chips */}
        {subjects.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setSubjectFilter(null)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                activeSubjectFilter === null
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            {subjects.map((s) => {
              const selected = activeSubjectFilter === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSubjectFilter(selected ? null : s.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    selected
                      ? "border-primary/60 bg-primary/15 text-foreground"
                      : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: subjectColorHex(s.color) }}
                  />
                  <span className="max-w-[120px] truncate">{s.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Task List for Active Day */}
        <div className="py-4">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading tasks…</p>
          ) : filteredActiveTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm font-medium text-foreground">
                {activeTasks.length === 0
                  ? `No tasks scheduled for ${activeWeekdayName}.`
                  : filter === "pending"
                    ? "All caught up! No pending tasks remaining."
                    : "No completed tasks yet."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {activeTasks.length === 0 ? "Add your first task below to get started." : ""}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredActiveTasks.map((t) => {
                const goalLocked =
                  !!t.goal_id && goalsMap.get(t.goal_id)?.status === "completed";
                return (
                <li
                  key={t.id}
                  className={`group flex flex-col gap-1.5 rounded-xl border p-3 transition-all ${
                    t.completed_at
                      ? "border-border/40 bg-secondary/20 opacity-80"
                      : "border-border/80 bg-secondary/40 hover:border-primary/50"
                  }`}
                >
                  {/* Mobile: the row splits into a title line + a meta/actions
                      line so nothing overflows the card. md+: contents wrappers
                      dissolve and every element sits in the original single
                      flex row — desktop layout is pixel-identical. */}
                  <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                    <button
                      disabled={goalLocked || isActiveDayPast}
                      onClick={() => toggle.mutate({ id: t.id, completed: !t.completed_at })}
                      aria-label={
                        goalLocked
                          ? `${t.title} is locked because its goal is completed`
                          : isActiveDayPast
                            ? `${t.title} is locked because it belongs to a past day`
                            : t.completed_at
                              ? `Mark ${t.title} incomplete`
                              : `Mark ${t.title} complete`
                      }
                      title={
                        goalLocked
                          ? "Goal completed — task locked"
                          : isActiveDayPast
                            ? "Past day — tasks are read-only"
                            : undefined
                      }
                      className={`flex shrink-0 items-center justify-center rounded-md p-2 -m-2 md:p-0 md:m-0 transition-all ${
                        goalLocked || isActiveDayPast ? "cursor-not-allowed" : ""
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-md border transition-all ${
                          goalLocked || isActiveDayPast
                            ? "border-border/60 bg-secondary/40 text-muted-foreground opacity-60"
                            : t.completed_at
                              ? "border-emerald-500/40 bg-emerald-500/20"
                              : "border-border hover:border-primary"
                        }`}
                      >
                        {t.completed_at && (
                          <svg
                            viewBox="0 0 12 12"
                            className="h-3.5 w-3.5 stroke-emerald-400"
                            fill="none"
                            strokeWidth={2.5}
                          >
                            <path d="M2.5 6.3l2.4 2.4 4.6-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                    </button>

                    <span
                      className={`flex-1 text-sm font-medium transition-all ${
                        t.completed_at ? "text-muted-foreground line-through" : "text-foreground"
                      }`}
                    >
                      {parseRoutineTitle(t.title).displayTitle}
                    </span>

                    {!t.completed_at && activeDay.date < todayISO && (
                      t.is_stale ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-600/40 dark:border-amber-400/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          Stale
                        </span>
                      ) : chainCompletedIds.has(t.id) ? (
                        // Frozen original whose rollover copy was completed
                        // elsewhere: swap "Due" for the existing "Completed late"
                        // badge. Display only — the row stays read-only and this
                        // panel's stats read t.completed_at, which is untouched.
                        <span className="rounded-full bg-secondary/70 border border-border/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Completed late
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 border border-destructive/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          Due
                        </span>
                      )
                    )}

                    {t.completed_at && t.rollover_count > 0 && (
                      <span className="rounded-full bg-secondary/70 border border-border/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Completed late
                      </span>
                    )}

                    </div>

                    {/* Mobile second line: badges left, actions right. */}
                    <div className="flex flex-wrap items-center gap-1.5 md:contents">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:contents">
                    {t.subject_id && subjectsMap.get(t.subject_id) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary/60 border border-border/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ background: subjectColorHex(subjectsMap.get(t.subject_id)!.color) }}
                        />
                        <span className="max-w-[100px] truncate">{subjectsMap.get(t.subject_id)!.name}</span>
                      </span>
                    )}

                    {t.goal_id && goalsMap.get(t.goal_id) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        <Target className="h-2.5 w-2.5" />
                        <span className="max-w-[120px] truncate">{goalsMap.get(t.goal_id)?.title}</span>
                      </span>
                    )}

                    {t.priority && (
                      <span
                        title={
                          t.priority === "High"
                            ? "High priority task"
                            : t.priority === "Med"
                              ? "Medium priority task"
                              : "Low priority task"
                        }
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                          t.priority === "High"
                            ? "bg-red-500/15 text-red-400 border-red-500/30"
                            : t.priority === "Med"
                              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                              : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        }`}
                      >
                        {t.priority === "High" ? "🔴 High" : t.priority === "Med" ? "🟡 Med" : "🟢 Low"}
                      </span>
                    )}

                    </div>

                    {/* ── Desktop inline actions (hover-reveal) ── */}
                    <div className="ml-auto hidden md:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!isActiveDayPast && filteredActiveTasks.length > 1 && (
                      <>
                        <button
                          disabled={filteredActiveTasks.findIndex((x) => x.id === t.id) === 0}
                          onClick={() => moveTask(t.id, "up")}
                          aria-label={`Move ${t.title} up`}
                          title="Move task up"
                          className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          disabled={
                            filteredActiveTasks.findIndex((x) => x.id === t.id) ===
                            filteredActiveTasks.length - 1
                          }
                          onClick={() => moveTask(t.id, "down")}
                          aria-label={`Move ${t.title} down`}
                          title="Move task down"
                          className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}

                    {!isActiveDayPast && !goalLocked && !t.completed_at && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            aria-label={`Reschedule ${t.title}`}
                            title="Reschedule / snooze to another day"
                            className="p-1 text-muted-foreground hover:text-amber-400 transition-colors"
                          >
                            <CalendarClock className="h-3.5 w-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-56 p-3 space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Reschedule Task
                          </p>
                          <div className="grid gap-1">
                            <Button variant="ghost" size="sm" className="justify-start text-xs h-8 px-2"
                              onClick={() => {
                                const tomorrow = toISODate(addDays(parseISODate(activeDay.date), 1));
                                rescheduleTask.mutate({ id: t.id, targetDate: tomorrow });
                              }}
                            >
                              👉 Tomorrow ({formatDayDate(toISODate(addDays(parseISODate(activeDay.date), 1))).slice(0, 3)})
                            </Button>
                            <Button variant="ghost" size="sm" className="justify-start text-xs h-8 px-2"
                              onClick={() => {
                                const inTwoDays = toISODate(addDays(parseISODate(activeDay.date), 2));
                                rescheduleTask.mutate({ id: t.id, targetDate: inTwoDays });
                              }}
                            >
                              👉 In 2 days
                            </Button>
                            <Button variant="ghost" size="sm" className="justify-start text-xs h-8 px-2"
                              onClick={() => {
                                const nextWeek = toISODate(addDays(parseISODate(activeDay.date), 7));
                                rescheduleTask.mutate({ id: t.id, targetDate: nextWeek });
                              }}
                            >
                              👉 Next Week (+7d)
                            </Button>
                          </div>
                          <div className="pt-2 border-t border-border/60">
                            <label className="text-[10px] uppercase text-muted-foreground block mb-1">
                              Pick Specific Date
                            </label>
                            <Input type="date" min={todayISO} defaultValue={activeDay.date}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val && val >= todayISO) {
                                  rescheduleTask.mutate({ id: t.id, targetDate: val });
                                }
                              }}
                              className="h-7 text-xs px-2"
                            />
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}

                    <button
                      disabled={goalLocked || isActiveDayPast}
                      onClick={() => toggleNote(t)}
                      aria-label={t.description ? "Edit note" : "Add note"}
                      title={t.description ? "View / edit note" : "Add note"}
                      className={`p-1 transition-colors ${
                        t.description
                          ? "text-primary"
                          : "text-muted-foreground hover:text-primary"
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </button>

                    <button
                      disabled={goalLocked || isActiveDayPast}
                      onClick={() => startRenaming(t)}
                      title="Rename task"
                      className={`p-1 text-muted-foreground transition-colors ${
                        goalLocked || isActiveDayPast ? "cursor-not-allowed" : "hover:text-primary"
                      }`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>

                    <button
                      disabled={isActiveDayPast}
                      onClick={() => removeTask.mutate({ id: t.id })}
                      title={isActiveDayPast ? "Past day — read-only" : "Delete task"}
                      className={`p-1 text-muted-foreground transition-colors ${
                        isActiveDayPast ? "cursor-not-allowed" : "hover:text-destructive"
                      }`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    </div>

                    {/* ── Mobile: compact ••• action menu ── */}
                    <div className="ml-auto flex items-center gap-1 md:hidden">
                      {/* Note indicator — always visible if task has a note */}
                      {t.description && parseTaskDescription(t.description).note && (
                        <button
                          onClick={() => toggleNote(t)}
                          className="p-1.5 text-primary"
                          aria-label="View note"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {!isActiveDayPast && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                              aria-label="Task actions"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {!goalLocked && (
                              <DropdownMenuItem onClick={() => toggleNote(t)}>
                                <FileText className="h-3.5 w-3.5 mr-2" />
                                {t.description ? "Edit Note" : "Add Note"}
                              </DropdownMenuItem>
                            )}
                            {!goalLocked && (
                              <DropdownMenuItem onClick={() => startRenaming(t)}>
                                <Pencil className="h-3.5 w-3.5 mr-2" />
                                Rename
                              </DropdownMenuItem>
                            )}
                            {!goalLocked && !t.completed_at && (
                              <>
                                <DropdownMenuItem onClick={() => {
                                  const tomorrow = toISODate(addDays(parseISODate(activeDay.date), 1));
                                  rescheduleTask.mutate({ id: t.id, targetDate: tomorrow });
                                }}>
                                  <CalendarClock className="h-3.5 w-3.5 mr-2" />
                                  Reschedule → Tomorrow
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  const nextWeek = toISODate(addDays(parseISODate(activeDay.date), 7));
                                  rescheduleTask.mutate({ id: t.id, targetDate: nextWeek });
                                }}>
                                  <CalendarClock className="h-3.5 w-3.5 mr-2" />
                                  Reschedule → Next Week
                                </DropdownMenuItem>
                              </>
                            )}
                            {filteredActiveTasks.length > 1 && (
                              <>
                                <DropdownMenuItem
                                  disabled={filteredActiveTasks.findIndex((x) => x.id === t.id) === 0}
                                  onClick={() => moveTask(t.id, "up")}
                                >
                                  <ArrowUp className="h-3.5 w-3.5 mr-2" />
                                  Move Up
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={filteredActiveTasks.findIndex((x) => x.id === t.id) === filteredActiveTasks.length - 1}
                                  onClick={() => moveTask(t.id, "down")}
                                >
                                  <ArrowDown className="h-3.5 w-3.5 mr-2" />
                                  Move Down
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuItem
                              onClick={() => removeTask.mutate({ id: t.id })}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  </div>

                  {/* Task note preview if not expanded */}
                  {(t.description && parseTaskDescription(t.description).note) && !expandedNotes.has(t.id) && (
                    <div
                      onClick={() => !isActiveDayPast && toggleNote(t)}
                      className="ml-9 cursor-pointer text-xs text-muted-foreground line-clamp-1 hover:text-foreground transition-colors"
                      title="Click to expand note"
                    >
                      📝 {parseTaskDescription(t.description).note}
                    </div>
                  )}
                  {/* Effort estimate badge when note is not expanded */}
                  {parseTaskDescription(t.description).estMinutes != null && !expandedNotes.has(t.id) && (
                    <div className="ml-9 mt-0.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        ⏱ {formatMinutes(parseTaskDescription(t.description).estMinutes!)} est.
                      </span>
                    </div>
                  )}

                  {/* Expandable note editor */}
                  {expandedNotes.has(t.id) && (
                    <div className="ml-9 mt-1 rounded-lg border border-border/80 bg-background/90 p-2.5 shadow-sm">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-semibold text-muted-foreground">Task Note & Estimate</span>
                        <button
                          type="button"
                          onClick={() => toggleNote(t)}
                          className="text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Close
                        </button>
                      </div>
                      <Textarea
                        value={noteDrafts[t.id] ?? ""}
                        onChange={(e) =>
                          setNoteDrafts((d) => ({ ...d, [t.id]: e.target.value }))
                        }
                        placeholder="Add details, links, or notes for this task..."
                        className="min-h-[60px] text-xs resize-none bg-secondary/30"
                        disabled={goalLocked || isActiveDayPast}
                      />
                      {/* Effort estimate row */}
                      <div className="mt-2 flex items-center gap-2">
                        <label className="text-[11px] text-muted-foreground shrink-0">⏱ Est. mins:</label>
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          value={estDrafts[t.id] ?? ""}
                          onChange={(e) => setEstDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                          placeholder="e.g. 30"
                          disabled={goalLocked || isActiveDayPast}
                          className="h-7 w-24 rounded-md border border-border bg-secondary/40 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <span className="text-[11px] text-muted-foreground">minutes (optional)</span>
                      </div>
                      <div className="mt-2 flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => toggleNote(t)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          disabled={goalLocked || isActiveDayPast || updateDescription.isPending}
                          onClick={() => {
                            const rawEst = estDrafts[t.id]?.trim();
                            const parsedEst = rawEst ? parseInt(rawEst, 10) : null;
                            const estMinutes = parsedEst && parsedEst > 0 ? parsedEst : null;
                            updateDescription.mutate({
                              id: t.id,
                              description: (noteDrafts[t.id] ?? "").trim() || null,
                              estMinutes,
                            });
                            setExpandedNotes((prev) => {
                              const next = new Set(prev);
                              next.delete(t.id);
                              return next;
                            });
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Add Task Form for Active Day */}
        <form
          className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (isActiveDayPast) return;
            const title = draft.trim();
            if (!title) return;
            // Double-submit guard: if this exact (day, title) add is already in
            // flight (double-click / Enter+click / duplicate event), drop it.
            const inflightKey = addTaskKey(activeDay.date, title);
            if (addInflightKeys.current.has(inflightKey)) return;
            addInflightKeys.current.add(inflightKey);
            addTask.mutate({
              date: activeDay.date,
              title: draft.trim(),
              subjectId: draftSubjectId,
              priority: draftPriority,
            });
            setDraft("");
            setDraftSubjectId(null);
            setDraftPriority(null);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Add a task for ${activeWeekdayName}...`}
            className="h-10 min-w-0 flex-1 text-base md:text-sm"
            disabled={isActiveDayPast}
          />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <select
              value={draftSubjectId ?? ""}
              onChange={(e) => setDraftSubjectId(e.target.value || null)}
              aria-label="Subject (optional)"
              className="h-10 w-full rounded-lg border border-border bg-secondary/50 px-2.5 text-base md:text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:w-44"
              disabled={isActiveDayPast}
            >
              <option value="">No subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={draftPriority ?? ""}
              onChange={(e) => setDraftPriority((e.target.value || null) as GoalPriority | null)}
              aria-label="Priority (optional)"
              className="h-10 w-full rounded-lg border border-border bg-secondary/50 px-2.5 text-base md:text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:w-32"
              disabled={isActiveDayPast}
            >
              <option value="">Priority</option>
              <option value="High">🔴 High</option>
              <option value="Med">🟡 Med</option>
              <option value="Low">🟢 Low</option>
            </select>
          </div>
          <Button
            type="submit"
            className="h-10 shrink-0 gap-1.5 px-4"
            aria-label="Add task"
            disabled={isActiveDayPast || !draft.trim()}
          >
            <Plus className="h-4 w-4" />
            <span>Add Task</span>
          </Button>
        </form>
        {isActiveDayPast && (
          <p className="mt-2 text-xs text-muted-foreground">
            Past days are read-only — select today or a future day to add or change tasks.
          </p>
        )}
      </section>



      {/* Rename-task modal (pencil icon on a task row) */}
      <Dialog
        open={renamingTask !== null}
        onOpenChange={(open) => {
          if (!open) setRenamingTask(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename task</DialogTitle>
            <DialogDescription>
              Renaming updates every copy of this task (including rolled-over copies) so its history
              and streak tracking stay connected.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitRename();
              }
            }}
            placeholder="Task title"
            aria-label="Task title"
            autoFocus
            className="h-9 text-sm"
          />
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Priority</label>
            <div className="grid grid-cols-4 gap-1">
              {[
                { val: null, label: "None" },
                { val: "Low" as const, label: "🟢 Low" },
                { val: "Med" as const, label: "🟡 Med" },
                { val: "High" as const, label: "🔴 High" },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setRenamePriority(opt.val)}
                  className={`rounded-md py-1 text-xs font-medium border transition-colors ${
                    renamePriority === opt.val
                      ? "border-primary bg-primary/20 text-foreground"
                      : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenamingTask(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitRename}
              disabled={!renameDraft.trim() || renameTask.isPending || setTaskPriority.isPending}
            >
              {renameTask.isPending || setTaskPriority.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}




