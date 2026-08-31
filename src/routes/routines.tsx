import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, useEffect } from "react";
import {
  Activity,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Edit2,
  Flame,
  Grid,
  Heart,
  Layers,
  List,
  Plus,
  Repeat,
  RotateCcw,
  Sparkles,
  Tag,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  batchAddRoutineTasks,
  clearAllRoutineTasks,
  deleteRoutineTask,
  getGoals,
  getRoutine,
  getWeek,
  toggleRoutineTaskActive,
  updateRoutineTask,
} from "@/lib/tracker.functions";
import { getHabits } from "@/lib/habits.functions";
import { getSubjects } from "@/lib/subjects.functions";
import type { Subject } from "@/lib/subjects-shared";
import {
  COLOR_PALETTE,
  DEFAULT_CATEGORIES,
  SAMPLE_TIME_SLOTS,
  SAMPLE_WEEKLY_ROUTINE,
  WEEKDAY_NAMES,
  calculateSlotDurationMinutes,
  formatRoutineTitle,
  parseRoutineTitle,
  startOfWeek,
  toISODate,
  type ColorKey,
  type Goal,
  type RoutineTask,
  type WeekData,
} from "@/lib/tracker-shared";
import { parseHabitTitle, type HabitsData } from "@/lib/habits-shared";

export const Route = createFileRoute("/routines")({
  head: () => ({
    meta: [
      { title: "Daily Routine — Weekly Schedule Matrix & Analytics | Momentum" },
      {
        name: "description",
        content:
          "Manage your weekly routine schedule matrix with custom time slots, custom categories, habit & goal integrations, and comprehensive workload calculations.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <RoutinesPage />
    </RequireAuth>
  ),
});

const EMOJI_PRESETS = [
  "🌅", "🏋️", "🏊", "🚿", "🍳", "☕", "📚", "💻", 
  "🌺", "🍱", "🎮", "🏄", "🧘", "🥋", "🍲", "📖", 
  "🎨", "🌙", "😴", "💼", "🎓", "🏃", "🚰", "📝",
  "🎯", "🚴", "🥑", "💊", "🧹", "🚶", "🌳", "⚡"
];

type ViewMode = "matrix" | "day" | "analytics";

export type CustomCategory = {
  name: string;
  colorKey: ColorKey;
};

const STORAGE_CUSTOM_SLOTS_KEY = "momentum_custom_routine_slots";
const STORAGE_CUSTOM_CATS_KEY = "momentum_custom_routine_categories";

function RoutinesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("matrix");
  const [selectedDay, setSelectedDay] = useState<number>(0); // 0=Mon, ..., 6=Sun
  
  // Custom Time Slots & Categories (stored in localStorage with fallback)
  const [customTimeSlots, setCustomTimeSlots] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_CUSTOM_SLOTS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    return [];
  });

  const [categories, setCategories] = useState<CustomCategory[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_CUSTOM_CATS_KEY);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [...DEFAULT_CATEGORIES];
  });

  // Modal Dialog States
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAddSlotOpen, setIsAddSlotOpen] = useState(false);
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<RoutineTask | null>(null);

  // Form State for Routine Slot
  const [formTitle, setFormTitle] = useState("");
  const [formEmoji, setFormEmoji] = useState("📌");
  const [formCategory, setFormCategory] = useState("Fitness");
  const [formColorKey, setFormColorKey] = useState<ColorKey>("emerald");
  const [formTimeSlot, setFormTimeSlot] = useState<string>("6:00–7:00 AM");
  const [formWeekdays, setFormWeekdays] = useState<number[]>([0]); // Default Monday
  const [formGoalId, setFormGoalId] = useState<string | null>(null);
  const [formHabitId, setFormHabitId] = useState<string | null>(null);
  const [formTaskId, setFormTaskId] = useState<string | null>(null);
  const [formSubjectId, setFormSubjectId] = useState<string | null>(null);
  const [formIsActive, setFormIsActive] = useState<boolean>(true);

  // Form State for Custom Time Slot
  const [newSlotStart, setNewSlotStart] = useState("08:00 AM");
  const [newSlotEnd, setNewSlotEnd] = useState("09:00 AM");
  const [newSlotCustomLabel, setNewSlotCustomLabel] = useState("");

  // Form State for Custom Category
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState<ColorKey>("teal");

  const qc = useQueryClient();
  const weekStart = useMemo(() => toISODate(startOfWeek(new Date())), []);
  const fetchWeekFn = useServerFn(getWeek);
  const fetchRoutineFn = useServerFn(getRoutine);
  const fetchGoalsFn = useServerFn(getGoals);
  const fetchHabitsFn = useServerFn(getHabits);
  const fetchSubjectsFn = useServerFn(getSubjects);
  const updateFn = useServerFn(updateRoutineTask);
  const toggleFn = useServerFn(toggleRoutineTaskActive);
  const batchAddFn = useServerFn(batchAddRoutineTasks);
  const deleteFn = useServerFn(deleteRoutineTask);
  const clearFn = useServerFn(clearAllRoutineTasks);

  // Queries
  const { data: weekData } = useQuery({
    queryKey: ["week", weekStart],
    queryFn: () => fetchWeekFn({ data: { weekStart } }) as Promise<WeekData>,
  });

  const { data: routineData } = useQuery({
    queryKey: ["routine"],
    queryFn: () => fetchRoutineFn(),
  });

  const { data: goalsData } = useQuery({
    queryKey: ["goals"],
    queryFn: () => fetchGoalsFn(),
  });

  const { data: habitsData } = useQuery({
    queryKey: ["habits", weekStart],
    queryFn: () => fetchHabitsFn({ data: { weekStart } }) as Promise<HabitsData>,
  });

  const { data: subjectsData } = useQuery({
    queryKey: ["subjects"],
    queryFn: () => fetchSubjectsFn() as Promise<{ subjects: Subject[] }>,
  });

  const tasks = (routineData?.tasks ?? []) as RoutineTask[];
  const goals = (goalsData?.goals ?? []) as Goal[];
  const subjects = subjectsData?.subjects ?? [];
  const habitStats = habitsData?.stats ?? [];
  const existingTasks = useMemo(() => {
    const list: Array<{ id: string; title: string }> = [];
    for (const day of weekData?.days ?? []) {
      for (const t of day.tasks) {
        if (!list.some((item) => item.title === t.title)) {
          list.push({ id: t.id, title: t.title });
        }
      }
    }
    return list;
  }, [weekData]);

  // Persist custom time slots & categories
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CUSTOM_SLOTS_KEY, JSON.stringify(customTimeSlots));
    } catch {}
  }, [customTimeSlots]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CUSTOM_CATS_KEY, JSON.stringify(categories));
    } catch {}
  }, [categories]);

  const goalsMap = useMemo(() => {
    const map = new Map<string, Goal>();
    for (const g of goals) map.set(g.id, g);
    return map;
  }, [goals]);

  const habitsMap = useMemo(() => {
    const map = new Map<string, (typeof habitStats)[0]>();
    for (const h of habitStats) map.set(h.habit.id, h);
    return map;
  }, [habitStats]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["routine"] });
    void qc.invalidateQueries({ queryKey: ["week"] });
    void qc.invalidateQueries({ queryKey: ["day"] });
    void qc.invalidateQueries({ queryKey: ["goals"] });
    void qc.invalidateQueries({ queryKey: ["habits"] });
  };

  // Group tasks by (timeSlot, weekday)
  const taskMatrix = useMemo(() => {
    const map = new Map<string, RoutineTask[]>();
    for (const t of tasks) {
      const parsed = parseRoutineTitle(t.title);
      const slotKey = parsed.timeSlot || "Unassigned";
      const key = `${slotKey}|${t.weekday}`;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  // Collect all unique time slots in order
  const allTimeSlots = useMemo(() => {
    const set = new Set<string>(customTimeSlots);
    for (const t of tasks) {
      const parsed = parseRoutineTitle(t.title);
      if (parsed.timeSlot) set.add(parsed.timeSlot);
    }
    return Array.from(set);
  }, [customTimeSlots, tasks]);

  // ===================== CALCULATIONS & ANALYTICS =====================
  const analytics = useMemo(() => {
    let totalWeeklyMins = 0;
    const catMins: Record<string, { mins: number; count: number; colorKey: ColorKey }> = {};
    const dayMins = Array.from({ length: 7 }, () => ({ mins: 0, count: 0 }));
    const goalAllocations: Record<string, { goal: Goal; mins: number; count: number; routines: string[] }> = {};
    const habitAllocations: Record<string, { habitTitle: string; target: number; scheduledDays: number; isMet: boolean }> = {};

    // Initialize habits tracking
    for (const hs of habitStats) {
      habitAllocations[hs.habit.id] = {
        habitTitle: hs.habit.title,
        target: hs.habit.target_per_week,
        scheduledDays: 0,
        isMet: false,
      };
    }

    for (const t of tasks) {
      if (!t.is_active) continue;
      const parsed = parseRoutineTitle(t.title);
      const duration = calculateSlotDurationMinutes(parsed.timeSlot);

      totalWeeklyMins += duration;

      // Day load
      if (dayMins[t.weekday]) {
        dayMins[t.weekday]!.mins += duration;
        dayMins[t.weekday]!.count += 1;
      }

      // Category breakdown
      const cat = parsed.category || "General";
      const catEntry = catMins[cat] ?? { mins: 0, count: 0, colorKey: parsed.colorKey || "slate" };
      catEntry.mins += duration;
      catEntry.count += 1;
      catEntry.colorKey = parsed.colorKey;
      catMins[cat] = catEntry;

      // Goal allocation
      if (t.goal_id && goalsMap.has(t.goal_id)) {
        const goal = goalsMap.get(t.goal_id)!;
        const gEntry = goalAllocations[goal.id] ?? { goal, mins: 0, count: 0, routines: [] };
        gEntry.mins += duration;
        gEntry.count += 1;
        if (!gEntry.routines.includes(parsed.cleanTitle)) {
          gEntry.routines.push(parsed.cleanTitle);
        }
        goalAllocations[goal.id] = gEntry;
      }

      // Habit synergy
      if (parsed.habitId && habitAllocations[parsed.habitId]) {
        habitAllocations[parsed.habitId]!.scheduledDays += 1;
      }
    }

    // Check habit goals met
    for (const hId of Object.keys(habitAllocations)) {
      const h = habitAllocations[hId]!;
      h.isMet = h.scheduledDays >= h.target;
    }

    const totalWeeklyHours = (totalWeeklyMins / 60).toFixed(1);
    const avgDailyHours = (totalWeeklyMins / 60 / 7).toFixed(1);

    const categoriesList = Object.entries(catMins).map(([name, data]) => ({
      name,
      hours: (data.mins / 60).toFixed(1),
      count: data.count,
      colorKey: data.colorKey,
      pct: totalWeeklyMins > 0 ? Math.round((data.mins / totalWeeklyMins) * 100) : 0,
    })).sort((a, b) => Number(b.hours) - Number(a.hours));

    return {
      totalWeeklyMins,
      totalWeeklyHours,
      avgDailyHours,
      categoriesList,
      dayLoads: dayMins.map((d, idx) => ({
        weekday: idx,
        name: WEEKDAY_NAMES[idx] ?? "Day",
        hours: (d.mins / 60).toFixed(1),
        count: d.count,
        level: d.mins < 240 ? "Light" : d.mins <= 480 ? "Balanced" : "Intense",
      })),
      goalAllocations: Object.values(goalAllocations),
      habitAllocations: Object.values(habitAllocations),
      activeRoutineCount: tasks.filter((t) => t.is_active).length,
    };
  }, [tasks, goalsMap, habitStats]);

  // Mutations
  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; title: string; weekday: number; goalId?: string | null; subjectId?: string | null; isActive?: boolean }) =>
      updateFn({ data: vars }),
    onSuccess: () => {
      invalidate();
      toast.success("Routine updated");
      closeModal();
    },
    onError: () => toast.error("Failed to update routine"),
  });

  const toggleMutation = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) => toggleFn({ data: vars }),
    onSuccess: () => {
      invalidate();
      toast.success("Status updated");
    },
  });

  const batchAddMutation = useMutation({
    mutationFn: (items: Array<{ weekday: number; title: string; goalId?: string | null; subjectId?: string | null; isActive?: boolean }>) =>
      batchAddFn({ data: { items } }),
    onSuccess: () => {
      invalidate();
      toast.success("Routines saved to schedule!");
      closeModal();
    },
    onError: () => toast.error("Failed to save routine slots"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Routine slot deleted");
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => clearFn(),
    onSuccess: () => {
      invalidate();
      toast.success("Schedule cleared");
    },
  });

  // Modal Handlers
  const openAddModal = (defaultWeekday?: number, defaultTimeSlot?: string) => {
    setEditingTask(null);
    setFormTitle("");
    setFormEmoji("🏋️");
    setFormCategory(categories[0]?.name ?? "Fitness");
    setFormColorKey(categories[0]?.colorKey ?? "emerald");
    setFormTimeSlot(defaultTimeSlot ?? allTimeSlots[0] ?? "6:00–7:00 AM");
    setFormWeekdays(defaultWeekday !== undefined ? [defaultWeekday] : [0]);
    setFormGoalId(null);
    setFormHabitId(null);
    setFormTaskId(null);
    setFormSubjectId(null);
    setFormIsActive(true);
    setIsDialogOpen(true);
  };

  const openEditModal = (task: RoutineTask) => {
    const parsed = parseRoutineTitle(task.title);
    setEditingTask(task);
    setFormTitle(parsed.cleanTitle);
    setFormEmoji(parsed.emoji);
    setFormCategory(parsed.category);
    setFormColorKey(parsed.colorKey);
    setFormTimeSlot(parsed.timeSlot || (allTimeSlots[0] ?? "6:00–7:00 AM"));
    setFormWeekdays([task.weekday]);
    setFormGoalId(task.goal_id);
    setFormHabitId(parsed.habitId);
    setFormTaskId(parsed.taskId);
    setFormSubjectId(task.subject_id);
    setFormIsActive(task.is_active);
    setIsDialogOpen(true);
  };

  const closeModal = () => {
    setIsDialogOpen(false);
    setEditingTask(null);
  };

  const handleCategoryChange = (catName: string) => {
    setFormCategory(catName);
    const found = categories.find((c) => c.name === catName);
    if (found) setFormColorKey(found.colorKey);
  };

  const handleHabitSelect = (hId: string) => {
    setFormHabitId(hId || null);
    if (hId) {
      const h = habitsMap.get(hId);
      if (h && !formTitle) {
        const parsedHabit = parseHabitTitle(h.habit.title);
        setFormTitle(parsedHabit.cleanTitle);
        setFormEmoji("🎯");
      }
    }
  };

  const handleTaskSelect = (tTitle: string) => {
    setFormTaskId(tTitle || null);
    if (tTitle && !formTitle) {
      setFormTitle(tTitle);
    }
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      toast.error("Please enter a routine title");
      return;
    }

    const fullTitle = formatRoutineTitle(
      formTitle,
      formTimeSlot,
      formCategory,
      formEmoji,
      formColorKey,
      formHabitId,
      formTaskId,
    );

    if (editingTask) {
      updateMutation.mutate({
        id: editingTask.id,
        title: fullTitle,
        weekday: formWeekdays[0] ?? editingTask.weekday,
        goalId: formGoalId,
        subjectId: formSubjectId,
        isActive: formIsActive,
      });
    } else {
      const items = formWeekdays.map((wd) => ({
        weekday: wd,
        title: fullTitle,
        goalId: formGoalId,
        subjectId: formSubjectId,
        isActive: formIsActive,
      }));
      batchAddMutation.mutate(items);
    }
  };

  // Add Custom Time Slot
  const handleAddCustomTimeSlot = (e: React.FormEvent) => {
    e.preventDefault();
    const formatted = newSlotCustomLabel.trim() || `${newSlotStart.trim()}–${newSlotEnd.trim()}`;
    if (!formatted) {
      toast.error("Please provide a valid time slot");
      return;
    }
    if (customTimeSlots.includes(formatted)) {
      toast.error("Time slot already exists");
      return;
    }
    setCustomTimeSlots([...customTimeSlots, formatted]);
    toast.success(`Added time slot "${formatted}"`);
    setIsAddSlotOpen(false);
    setNewSlotCustomLabel("");
  };

  // Add Custom Category
  const handleAddCustomCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCatName.trim();
    if (!name) {
      toast.error("Please enter a category name");
      return;
    }
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.error("Category already exists");
      return;
    }
    setCategories([...categories, { name, colorKey: newCatColor }]);
    toast.success(`Category "${name}" created!`);
    setIsAddCategoryOpen(false);
    setNewCatName("");
  };

  const handleDeleteTimeSlotRow = (slotToDelete: string) => {
    setCustomTimeSlots((prev) => prev.filter((s) => s !== slotToDelete));
    // Also delete any tasks matching this timeSlot
    const matchingIds = tasks
      .filter((t) => parseRoutineTitle(t.title).timeSlot === slotToDelete)
      .map((t) => t.id);

    if (matchingIds.length > 0) {
      deleteMutation.mutate(matchingIds[0]!);
      for (let i = 1; i < matchingIds.length; i++) {
        deleteMutation.mutate(matchingIds[i]!);
      }
    }
    toast.success(`Removed time slot "${slotToDelete}"`);
  };

  const handleClearAllSlots = () => {
    if (confirm("Are you sure you want to delete all custom time slots and clear your schedule?")) {
      setCustomTimeSlots([]);
      try {
        localStorage.removeItem(STORAGE_CUSTOM_SLOTS_KEY);
      } catch {}
      clearMutation.mutate();
      toast.success("All time slots and routines cleared");
    }
  };

  const loadSampleSchedule = () => {
    if (tasks.length > 0) {
      if (!confirm("This will add the sample daily routine timetable to your schedule. Continue?")) {
        return;
      }
    }

    setCustomTimeSlots(Array.from(new Set([...SAMPLE_TIME_SLOTS])));
    const items: Array<{ weekday: number; title: string; goalId?: string | null; isActive?: boolean }> = [];
    for (const entry of SAMPLE_WEEKLY_ROUTINE) {
      const color = (entry.colorKey ?? (COLOR_PALETTE[entry.category.toLowerCase() as ColorKey] ? entry.category.toLowerCase() : "slate")) as ColorKey;
      const fullTitle = formatRoutineTitle(entry.title, entry.timeSlot, entry.category, entry.emoji, color);
      for (const wd of entry.weekdays) {
        items.push({
          weekday: wd,
          title: fullTitle,
          goalId: null,
          isActive: true,
        });
      }
    }
    batchAddMutation.mutate(items);
  };

  return (
    <AppShell profile={weekData?.profile ?? null}>
      <div className="space-y-6">
        {/* Page Banner Header */}
        <div className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card/60 p-6 backdrop-blur sm:flex-row sm:items-center sm:justify-between shadow-lg">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary border border-primary/20">
                <Sparkles className="h-3.5 w-3.5" /> Routine Matrix & System
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight uppercase sm:text-3xl">
              My Daily Routine <span className="text-muted-foreground">— Weekly Schedule</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Fully editable time-blocked timetable with custom time slots, custom categories, habit & goal integrations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-border hover:bg-secondary"
              onClick={() => setIsAddSlotOpen(true)}
            >
              <Clock className="h-4 w-4 text-primary" /> + Time Slot
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-border hover:bg-secondary"
              onClick={() => setIsAddCategoryOpen(true)}
            >
              <Tag className="h-4 w-4 text-cyan-400" /> + Category
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
              onClick={loadSampleSchedule}
              disabled={batchAddMutation.isPending}
            >
              <Zap className="h-4 w-4" /> Load Sample
            </Button>

            <Button size="sm" className="gap-1.5" onClick={() => openAddModal()}>
              <Plus className="h-4 w-4" /> Add Routine Slot
            </Button>
          </div>
        </div>

        {/* Calculated Stats Overview */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Weekly Scheduled</span>
              <Clock className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="num mt-1 text-2xl font-bold">{analytics.totalWeeklyHours} <span className="text-xs font-normal text-muted-foreground">hrs/wk</span></div>
            <div className="text-[11px] text-muted-foreground mt-0.5">~{analytics.avgDailyHours} hrs/day average</div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Active Routine Slots</span>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="num mt-1 text-2xl font-bold text-emerald-400">{analytics.activeRoutineCount}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{tasks.length} total registered</div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Goal Allocation</span>
              <Target className="h-3.5 w-3.5 text-cyan-400" />
            </div>
            <div className="num mt-1 text-2xl font-bold text-cyan-400">{analytics.goalAllocations.length}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">active goals linked</div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Habit Synergy</span>
              <Flame className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="num mt-1 text-2xl font-bold text-amber-400">
              {analytics.habitAllocations.filter((h) => h.isMet).length}/{analytics.habitAllocations.length}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">habits target met</div>
          </div>
        </div>

        {/* View Switches & Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-3">
          <div className="flex items-center gap-1 rounded-full bg-secondary/80 p-1 text-xs">
            <button
              onClick={() => setViewMode("matrix")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-all ${
                viewMode === "matrix" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Grid className="h-3.5 w-3.5" /> 7-Day Matrix Grid
            </button>
            <button
              onClick={() => setViewMode("day")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-all ${
                viewMode === "day" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-3.5 w-3.5" /> Day View
            </button>
            <button
              onClick={() => setViewMode("analytics")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-all ${
                viewMode === "analytics" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" /> Calculations & Analytics
            </button>
          </div>

          {viewMode === "day" && (
            <div className="flex items-center gap-1 overflow-x-auto">
              {WEEKDAY_NAMES.map((name, idx) => (
                <button
                  key={name}
                  onClick={() => setSelectedDay(idx)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                    selectedDay === idx ? "bg-primary text-primary-foreground font-semibold" : "bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              ))}
            </div>
          )}

          {tasks.length > 0 || customTimeSlots.length > 0 ? (
            <button
              onClick={handleClearAllSlots}
              className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors ml-auto"
            >
              <RotateCcw className="h-3 w-3" /> Clear Timeslots & Schedule
            </button>
          ) : null}
        </div>

        {/* View Mode 1: 7-Day Timetable Matrix */}
        {viewMode === "matrix" && (
          <div className="space-y-4">
            <div className="relative overflow-x-auto rounded-xl border border-border/80 bg-card shadow-2xl">
              <table className="w-full border-collapse text-left text-xs min-w-[950px]">
                {/* Header Row */}
                <thead>
                  <tr className="border-b border-border bg-secondary/70 backdrop-blur">
                    <th className="sticky left-0 z-20 w-36 border-r border-border bg-secondary p-3 font-semibold uppercase tracking-wider text-muted-foreground text-center">
                      Time Slot
                    </th>
                    {WEEKDAY_NAMES.map((dayName, idx) => {
                      const isWeekend = idx === 5 || idx === 6;
                      const dayLoad = analytics.dayLoads[idx];
                      return (
                        <th
                          key={dayName}
                          className={`p-3 font-semibold text-center uppercase tracking-wider border-r border-border/50 ${
                            isWeekend ? "bg-rose-500/10 text-rose-300" : "text-foreground"
                          }`}
                        >
                          <div>{dayName}</div>
                          {dayLoad && (
                            <div className="text-[10px] font-mono font-normal text-muted-foreground lowercase mt-0.5">
                              {dayLoad.hours}h ({dayLoad.count} slots)
                            </div>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                {/* Rows for each Time Slot */}
                <tbody className="divide-y divide-border/40">
                  {allTimeSlots.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-12 text-center text-muted-foreground">
                        <Clock className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                        <h4 className="font-semibold text-sm text-foreground">No time slots created yet</h4>
                        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                          Create your own custom time slots to design your schedule, or load the sample timetable.
                        </p>
                        <div className="flex items-center justify-center gap-2 mt-4">
                          <Button size="sm" onClick={() => setIsAddSlotOpen(true)}>
                            <Plus className="h-4 w-4 mr-1" /> Add Custom Time Slot
                          </Button>
                          <Button variant="outline" size="sm" onClick={loadSampleSchedule}>
                            <Zap className="h-4 w-4 mr-1 text-primary" /> Load Sample Schedule
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <>
                    {allTimeSlots.map((timeSlot) => (
                      <tr key={timeSlot} className="hover:bg-secondary/20 transition-colors">
                        {/* Time Column with hover delete button */}
                        <td className="sticky left-0 z-10 border-r border-border bg-card/95 p-2 font-mono font-medium text-[11px] text-center text-muted-foreground group/time">
                          <div className="flex items-center justify-center gap-1">
                            <span>{timeSlot}</span>
                            <button
                              onClick={() => handleDeleteTimeSlotRow(timeSlot)}
                              className="hidden group-hover/time:inline-flex text-muted-foreground hover:text-destructive p-0.5 transition-colors"
                              title={`Delete time slot "${timeSlot}"`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="text-[9px] text-muted-foreground/60 font-sans">
                            {calculateSlotDurationMinutes(timeSlot)}m
                          </div>
                        </td>

                        {/* 7 Days Columns */}
                        {WEEKDAY_NAMES.map((_, dayIdx) => {
                          const key = `${timeSlot}|${dayIdx}`;
                          const cellTasks = taskMatrix.get(key) ?? [];
                          const isWeekend = dayIdx === 5 || dayIdx === 6;

                          return (
                            <td
                              key={dayIdx}
                              className={`p-1.5 border-r border-border/30 vertical-top align-top min-h-[52px] transition-colors relative group ${
                                isWeekend ? "bg-rose-500/[0.02]" : ""
                              }`}
                            >
                            <div className="space-y-1 min-h-[44px] flex flex-col justify-center">
                              {cellTasks.map((task) => {
                                const parsed = parseRoutineTitle(task.title);
                                const color = COLOR_PALETTE[parsed.colorKey] ?? COLOR_PALETTE.slate;
                                const linkedGoal = task.goal_id ? goalsMap.get(task.goal_id) : null;
                                const linkedHabit = parsed.habitId ? habitsMap.get(parsed.habitId) : null;

                                return (
                                  <div
                                    key={task.id}
                                    onClick={() => openEditModal(task)}
                                    className={`group/item relative flex flex-col gap-0.5 rounded-lg border p-1.5 text-[11px] cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md ${
                                      color.bg
                                    } ${color.border} ${!task.is_active ? "opacity-40 grayscale" : ""}`}
                                  >
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="font-semibold truncate text-foreground flex items-center gap-1">
                                        <span className="text-sm leading-none">{parsed.emoji}</span>
                                        <span className="truncate">{parsed.cleanTitle}</span>
                                      </span>

                                      {/* Action icons on item hover */}
                                      <div className="hidden group-hover/item:flex items-center gap-1">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleMutation.mutate({ id: task.id, isActive: !task.is_active });
                                          }}
                                          title={task.is_active ? "Deactivate" : "Activate"}
                                          className="text-muted-foreground hover:text-foreground"
                                        >
                                          <Check className={`h-3 w-3 ${task.is_active ? "text-emerald-400" : ""}`} />
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deleteMutation.mutate(task.id);
                                          }}
                                          title="Delete slot"
                                          className="text-muted-foreground hover:text-destructive"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </button>
                                      </div>
                                    </div>

                                    {/* Link Badges */}
                                    <div className="flex flex-wrap items-center gap-1 text-[9px] mt-0.5">
                                      {linkedGoal && (
                                        <span className="inline-flex items-center gap-0.5 text-cyan-400 bg-cyan-500/10 px-1 py-0.2 rounded border border-cyan-500/20">
                                          <Target className="h-2 w-2" />
                                          <span className="truncate max-w-[80px]">{linkedGoal.title}</span>
                                        </span>
                                      )}

                                      {linkedHabit && (
                                        <span className="inline-flex items-center gap-0.5 text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded border border-amber-500/20">
                                          <Repeat className="h-2 w-2" />
                                          <span className="truncate max-w-[80px]">{linkedHabit.habit.title}</span>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}

                              {/* Add button on hover */}
                              <button
                                onClick={() => openAddModal(dayIdx, timeSlot)}
                                className="w-full hidden group-hover:flex items-center justify-center rounded border border-dashed border-border/60 py-1 text-[10px] text-muted-foreground hover:border-primary hover:text-primary transition-all"
                              >
                                <Plus className="h-3 w-3 mr-0.5" /> Add
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  </>
                  )}
                </tbody>
              </table>
            </div>

            {/* Quick Add Time Slot Footer Prompt */}
            <div className="flex items-center justify-between rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground bg-card/40">
              <span>Need a different time slot or custom interval?</span>
              <Button variant="outline" size="sm" onClick={() => setIsAddSlotOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Custom Time Slot Row
              </Button>
            </div>
          </div>
        )}

        {/* View Mode 2: Single Day Breakdown */}
        {viewMode === "day" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
              <div>
                <h3 className="font-semibold text-lg">{WEEKDAY_NAMES[selectedDay]} Routine Schedule</h3>
                <p className="text-xs text-muted-foreground">
                  Scheduled time: <span className="num font-semibold text-foreground">{analytics.dayLoads[selectedDay]?.hours ?? 0} hours</span> across {analytics.dayLoads[selectedDay]?.count ?? 0} routine blocks.
                </p>
              </div>

              <Button size="sm" onClick={() => openAddModal(selectedDay)}>
                <Plus className="h-4 w-4 mr-1" /> Add to {WEEKDAY_NAMES[selectedDay]?.slice(0, 3) ?? "Day"}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tasks
                .filter((t) => t.weekday === selectedDay)
                .map((task) => {
                  const parsed = parseRoutineTitle(task.title);
                  const color = COLOR_PALETTE[parsed.colorKey] ?? COLOR_PALETTE.slate;
                  const linkedGoal = task.goal_id ? goalsMap.get(task.goal_id) : null;
                  const linkedHabit = parsed.habitId ? habitsMap.get(parsed.habitId) : null;
                  const duration = calculateSlotDurationMinutes(parsed.timeSlot);

                  return (
                    <div
                      key={task.id}
                      className={`flex flex-col justify-between rounded-xl border p-4 transition-all hover:shadow-lg ${color.bg} ${color.border} ${
                        !task.is_active ? "opacity-50" : ""
                      }`}
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className="text-3xl">{parsed.emoji}</span>
                            <div>
                              <h4 className="font-bold text-foreground text-sm">{parsed.cleanTitle}</h4>
                              <span className="num text-xs text-muted-foreground">{parsed.timeSlot || "Flexible Time"} ({duration}m)</span>
                            </div>
                          </div>

                          <button
                            onClick={() => toggleMutation.mutate({ id: task.id, isActive: !task.is_active })}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                              task.is_active
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {task.is_active ? "Active" : "Paused"}
                          </button>
                        </div>

                        {/* Integration Badges */}
                        <div className="flex flex-col gap-1 text-xs">
                          {linkedGoal && (
                            <div className="flex items-center gap-1.5 text-cyan-400">
                              <Target className="h-3.5 w-3.5" />
                              <span>Goal: {linkedGoal.title}</span>
                            </div>
                          )}

                          {linkedHabit && (
                            <div className="flex items-center gap-1.5 text-amber-400">
                              <Repeat className="h-3.5 w-3.5" />
                              <span>Habit: {linkedHabit.habit.title} ({linkedHabit.weekDone}/{linkedHabit.weekTarget} this week)</span>
                            </div>
                          )}

                          {parsed.taskId && (
                            <div className="flex items-center gap-1.5 text-purple-400">
                              <Layers className="h-3.5 w-3.5" />
                              <span>Task Reference: {parsed.taskId}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-2 text-xs">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${color.text} bg-background/50 border ${color.border}`}>
                          {parsed.category}
                        </span>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal(task)}
                            className="text-muted-foreground hover:text-foreground transition-colors p-1"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => deleteMutation.mutate(task.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors p-1"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* View Mode 3: Detailed Calculations & Analytics */}
        {viewMode === "analytics" && (
          <div className="space-y-6">
            {/* Category Allocation Distribution Bar */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" /> Category Time Allocation
                </h3>
                <span className="num text-xs text-muted-foreground font-semibold">
                  {analytics.totalWeeklyHours} hrs/week total
                </span>
              </div>

              {/* Multi-segment distribution bar */}
              <div className="h-3 w-full overflow-hidden rounded-full bg-secondary flex">
                {analytics.categoriesList.map((cat) => {
                  const color = COLOR_PALETTE[cat.colorKey] ?? COLOR_PALETTE.slate;
                  const bgClass = cat.colorKey === "emerald" ? "bg-emerald-500" :
                    cat.colorKey === "cyan" ? "bg-cyan-500" :
                    cat.colorKey === "amber" ? "bg-amber-500" :
                    cat.colorKey === "purple" ? "bg-purple-500" :
                    cat.colorKey === "indigo" ? "bg-indigo-500" :
                    cat.colorKey === "rose" ? "bg-rose-500" :
                    cat.colorKey === "blue" ? "bg-blue-500" :
                    cat.colorKey === "teal" ? "bg-teal-500" :
                    cat.colorKey === "fuchsia" ? "bg-fuchsia-500" :
                    cat.colorKey === "orange" ? "bg-orange-500" : "bg-primary";

                  return (
                    <div
                      key={cat.name}
                      style={{ width: `${cat.pct}%` }}
                      className={`h-full transition-all duration-500 ${bgClass}`}
                      title={`${cat.name}: ${cat.hours}h (${cat.pct}%)`}
                    />
                  );
                })}
              </div>

              {/* Category Breakdown Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                {analytics.categoriesList.map((cat) => {
                  const color = COLOR_PALETTE[cat.colorKey] ?? COLOR_PALETTE.slate;
                  return (
                    <div key={cat.name} className={`rounded-lg border p-3 ${color.bg} ${color.border}`}>
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-semibold ${color.text}`}>{cat.name}</span>
                        <span className="num font-bold text-muted-foreground">{cat.pct}%</span>
                      </div>
                      <div className="num mt-1 text-lg font-bold text-foreground">{cat.hours} <span className="text-xs font-normal">hrs</span></div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{cat.count} routine blocks</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Day Load & Goal/Habit Synergy Columns */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Daily Schedule Density */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-purple-400" /> Day-by-Day Load Density
                </h3>
                <div className="space-y-2">
                  {analytics.dayLoads.map((dl) => (
                    <div key={dl.weekday} className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 p-2.5 text-xs">
                      <span className="font-semibold text-foreground w-24">{dl.name}</span>
                      <div className="flex-1 mx-3">
                        <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${Math.min(100, (Number(dl.hours) / 10) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="num font-bold">{dl.hours} hrs</span>
                        <span className="text-[10px] text-muted-foreground ml-1.5">({dl.count} slots)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Goal Allocation & Habit Synergy */}
              <div className="space-y-6">
                {/* Goal Allocation */}
                <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                  <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                    <Target className="h-4 w-4 text-cyan-400" /> Linked Goals Allocation
                  </h3>
                  {analytics.goalAllocations.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No routines currently linked to active goals.</p>
                  ) : (
                    <div className="space-y-2">
                      {analytics.goalAllocations.map((ga) => (
                        <div key={ga.goal.id} className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs">
                          <div className="flex items-center justify-between font-semibold text-cyan-400">
                            <span>{ga.goal.title}</span>
                            <span className="num font-bold">{(ga.mins / 60).toFixed(1)} hrs/week</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-1">
                            {ga.count} routine blocks: {ga.routines.join(", ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Habit Synergy */}
                <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                  <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                    <Repeat className="h-4 w-4 text-amber-400" /> Habit Target Alignment
                  </h3>
                  {analytics.habitAllocations.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No routines currently linked to habits.</p>
                  ) : (
                    <div className="space-y-2">
                      {analytics.habitAllocations.map((ha, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 p-2.5 text-xs">
                          <div>
                            <span className="font-semibold text-foreground">{ha.habitTitle}</span>
                            <div className="text-[10px] text-muted-foreground">
                              Scheduled in routine: {ha.scheduledDays}x / Target: {ha.target}x/week
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            ha.isMet ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                          }`}>
                            {ha.isMet ? "Target Covered" : "Needs More Slots"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Routine Add / Edit Dialog Overlay */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95 my-8">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                {editingTask ? "Edit Routine Slot" : "Add Routine Slot"}
              </h3>
              <button
                onClick={closeModal}
                className="text-muted-foreground hover:text-foreground text-sm font-semibold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="mt-4 space-y-4">
              {/* Title & Emoji Selector */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Routine Title
                </label>
                <div className="flex gap-2">
                  <Input
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="e.g. Morning Exercise, Study Block 1, Swimming"
                    className="flex-1"
                    autoFocus
                  />
                </div>
              </div>

              {/* Quick Fill from Pre-Existing Tasks */}
              {existingTasks.length > 0 && !editingTask && (
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
                    <Layers className="h-3 w-3 text-purple-400" /> Or pick from existing tasks:
                  </label>
                  <select
                    value={formTaskId ?? ""}
                    onChange={(e) => handleTaskSelect(e.target.value)}
                    className="w-full rounded-lg border border-border bg-secondary/50 p-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">-- Custom Routine Title --</option>
                    {existingTasks.map((t) => (
                      <option key={t.id} value={t.title}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Emoji Quick Picker */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Choose Icon / Emoji
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1.5 border border-border rounded-lg bg-secondary/40">
                  {EMOJI_PRESETS.map((emo) => (
                    <button
                      key={emo}
                      type="button"
                      onClick={() => setFormEmoji(emo)}
                      className={`h-8 w-8 rounded text-lg flex items-center justify-center transition-all ${
                        formEmoji === emo ? "bg-primary text-primary-foreground scale-110 shadow" : "hover:bg-secondary"
                      }`}
                    >
                      {emo}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category & Time Slot */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Category
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsAddCategoryOpen(true)}
                      className="text-[10px] text-cyan-400 hover:underline"
                    >
                      + New
                    </button>
                  </div>
                  <select
                    value={formCategory}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background p-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {categories.map((cat) => (
                      <option key={cat.name} value={cat.name}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Time Slot
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsAddSlotOpen(true)}
                      className="text-[10px] text-primary hover:underline"
                    >
                      + New
                    </button>
                  </div>
                  <select
                    value={formTimeSlot}
                    onChange={(e) => setFormTimeSlot(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background p-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {allTimeSlots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot} ({calculateSlotDurationMinutes(slot)}m)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Weekday Multi-Select (For creating new) */}
              {!editingTask && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Repeat Days
                    </label>
                    <div className="flex gap-2 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setFormWeekdays([0, 1, 2, 3, 4, 5, 6])}
                        className="text-primary hover:underline"
                      >
                        All Days
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormWeekdays([0, 1, 2, 3, 4])}
                        className="text-cyan-400 hover:underline"
                      >
                        Weekdays
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormWeekdays([5, 6])}
                        className="text-rose-400 hover:underline"
                      >
                        Weekends
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {WEEKDAY_NAMES.map((dayName, idx) => {
                      const selected = formWeekdays.includes(idx);
                      return (
                        <button
                          key={dayName}
                          type="button"
                          onClick={() => {
                            if (selected) {
                              if (formWeekdays.length > 1) {
                                setFormWeekdays(formWeekdays.filter((w) => w !== idx));
                              }
                            } else {
                              setFormWeekdays([...formWeekdays, idx]);
                            }
                          }}
                          className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
                            selected ? "bg-primary text-primary-foreground shadow" : "bg-secondary text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {dayName.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Link to Goal & Habit */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                    Link to Goal
                  </label>
                  <select
                    value={formGoalId ?? ""}
                    onChange={(e) => setFormGoalId(e.target.value || null)}
                    className="w-full rounded-lg border border-border bg-background p-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">-- No Goal --</option>
                    {goals
                      .filter((g) => g.status === "active")
                      .map((goal) => (
                        <option key={goal.id} value={goal.id}>
                          {goal.title}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                    Link to Habit
                  </label>
                  <select
                    value={formHabitId ?? ""}
                    onChange={(e) => handleHabitSelect(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background p-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">-- No Habit --</option>
                    {habitStats.map((h) => (
                      <option key={h.habit.id} value={h.habit.id}>
                        {parseHabitTitle(h.habit.title).displayTitle} ({h.habit.target_per_week}x/wk)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Link to Subject (optional) */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Subject
                </label>
                <select
                  value={formSubjectId ?? ""}
                  onChange={(e) => setFormSubjectId(e.target.value || null)}
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">-- No Subject --</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {subjects.length === 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    No subjects yet — create one on the Manage Subjects page.
                  </p>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/60">
                <Button type="button" variant="outline" size="sm" onClick={closeModal}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={updateMutation.isPending || batchAddMutation.isPending}
                >
                  {editingTask ? "Save Changes" : "Create Routine"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Custom Time Slot Modal */}
      {isAddSlotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Create Custom Time Slot
              </h3>
              <button
                onClick={() => setIsAddSlotOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-semibold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddCustomTimeSlot} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Start & End Times (e.g. 04:30 PM - 06:00 PM)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={newSlotStart}
                    onChange={(e) => setNewSlotStart(e.target.value)}
                    placeholder="08:00 AM"
                  />
                  <Input
                    value={newSlotEnd}
                    onChange={(e) => setNewSlotEnd(e.target.value)}
                    placeholder="09:30 AM"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Or Custom Display Label (Optional)
                </label>
                <Input
                  value={newSlotCustomLabel}
                  onChange={(e) => setNewSlotCustomLabel(e.target.value)}
                  placeholder="e.g. 11:45 PM Night Owl"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <Button type="button" variant="outline" size="sm" onClick={() => setIsAddSlotOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Add Time Slot
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Custom Category Modal */}
      {isAddCategoryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Tag className="h-4 w-4 text-cyan-400" /> Create Custom Category
              </h3>
              <button
                onClick={() => setIsAddCategoryOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-semibold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddCustomCategory} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Category Name
                </label>
                <Input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="e.g. Deep Work, Languages, Side Project"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Color Theme
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(Object.keys(COLOR_PALETTE) as ColorKey[]).map((cKey) => {
                    const c = COLOR_PALETTE[cKey];
                    return (
                      <button
                        key={cKey}
                        type="button"
                        onClick={() => setNewCatColor(cKey)}
                        className={`rounded-lg border p-2 text-xs font-semibold transition-all ${c.bg} ${c.text} ${c.border} ${
                          newCatColor === cKey ? "ring-2 ring-primary scale-105" : "opacity-75 hover:opacity-100"
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <Button type="button" variant="outline" size="sm" onClick={() => setIsAddCategoryOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Create Category
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
