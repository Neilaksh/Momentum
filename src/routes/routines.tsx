import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  ArrowUpDown,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Download,
  Edit2,
  FileJson,
  Grid,
  Heart,
  Layers,
  List,
  MoreHorizontal,
  Move,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Shuffle,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  batchAddRoutineTasks,
  clearAllRoutineTasks,
  copyWeekdayRoutines,
  deleteRoutineTask,
  getRoutine,
  getWeek,
  reorderRoutineTasks,
  setActiveRoutineVariant,
  toggleRoutineTaskActive,
  updateRoutineTask,
} from "@/lib/tracker.functions";
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
  timeSlotStartMinutes,
  toISODate,
  type ColorKey,
  type RoutineTask,
  type WeekData,
} from "@/lib/tracker-shared";

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
  "🌅",
  "🏋️",
  "🏊",
  "🚿",
  "🍳",
  "☕",
  "📚",
  "💻",
  "🌺",
  "🍱",
  "🎮",
  "🏄",
  "🧘",
  "🥋",
  "🍲",
  "📖",
  "🎨",
  "🌙",
  "😴",
  "💼",
  "🎓",
  "🏃",
  "🚰",
  "📝",
  "🎯",
  "🚴",
  "🥑",
  "💊",
  "🚶",
  "🥗",
  "📖",
  "🧹",
  "🎮",
  "🥋",
  "😴",
];

const STORAGE_CUSTOM_SLOTS_KEY = "momentum_custom_time_slots";
const STORAGE_CUSTOM_CATS_KEY = "momentum_custom_categories";
const STORAGE_SLOT_ORDER_KEY = "momentum_slot_order";

// Each weekly routine ("primary" | "alternate") keeps its own time-slot rows,
// categories, and manual slot ordering. Keys are suffixed per variant, so
// switching weeks swaps the whole grid. For the primary we fall back to the
// legacy unsuffixed key so existing users keep their current setup.
const slotsKeyFor = (v: string) =>
  v === "primary" ? STORAGE_CUSTOM_SLOTS_KEY : `${STORAGE_CUSTOM_SLOTS_KEY}_${v}`;
const catsKeyFor = (v: string) =>
  v === "primary" ? STORAGE_CUSTOM_CATS_KEY : `${STORAGE_CUSTOM_CATS_KEY}_${v}`;
const slotOrderKeyFor = (v: string) =>
  v === "primary" ? STORAGE_SLOT_ORDER_KEY : `${STORAGE_SLOT_ORDER_KEY}_${v}`;

/**
 * Move Routine Slot Popover
 * Allows moving any routine block to another day or another time slot,
 * or shifting it one step earlier/later or to prev/next day.
 */
function MoveRoutineSlotPopover({
  task,
  allTimeSlots,
  onMove,
  children,
}: {
  task: RoutineTask;
  allTimeSlots: string[];
  onMove: (taskId: string, targetWeekday: number, targetTimeSlot: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const parsed = parseRoutineTitle(task.title);
  const currentSlot = parsed.timeSlot || allTimeSlots[0] || "6:00–7:00 AM";
  const currentWeekday = task.weekday;

  const currentSlotIndex = allTimeSlots.indexOf(currentSlot);

  const handleShiftDay = (delta: number) => {
    const nextDay = (currentWeekday + delta + 7) % 7;
    onMove(task.id, nextDay, currentSlot);
    setOpen(false);
  };

  const handleShiftSlot = (delta: number) => {
    if (currentSlotIndex === -1) {
      if (allTimeSlots.length > 0) {
        onMove(task.id, currentWeekday, allTimeSlots[0]!);
      }
      setOpen(false);
      return;
    }
    const nextIndex = currentSlotIndex + delta;
    if (nextIndex >= 0 && nextIndex < allTimeSlots.length) {
      onMove(task.id, currentWeekday, allTimeSlots[nextIndex]!);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-3 space-y-3 shadow-xl border-border bg-popover text-popover-foreground z-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-base leading-none">{parsed.emoji}</span>
            <span className="text-xs font-semibold truncate text-foreground">
              {parsed.cleanTitle}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
            Move Slot
          </span>
        </div>

        {/* Quick Shift Arrows */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Quick Shift
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] justify-center gap-1"
              onClick={() => handleShiftDay(-1)}
              title="Shift to Previous Day"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev Day
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] justify-center gap-1"
              onClick={() => handleShiftDay(1)}
              title="Shift to Next Day"
            >
              Next Day <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] justify-center gap-1"
              disabled={currentSlotIndex <= 0}
              onClick={() => handleShiftSlot(-1)}
              title="Shift to Earlier Time Slot"
            >
              <ChevronUp className="h-3.5 w-3.5" /> Earlier Slot
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] justify-center gap-1"
              disabled={currentSlotIndex === -1 || currentSlotIndex >= allTimeSlots.length - 1}
              onClick={() => handleShiftSlot(1)}
              title="Shift to Later Time Slot"
            >
              Later Slot <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Select Specific Day */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Move to Day
          </label>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_NAMES.map((name, idx) => {
              const isCurrent = idx === currentWeekday;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    if (!isCurrent) {
                      onMove(task.id, idx, currentSlot);
                      setOpen(false);
                    }
                  }}
                  className={`py-1 text-[11px] font-semibold rounded transition-colors ${
                    isCurrent
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                  title={`Move to ${name}`}
                >
                  {name.slice(0, 1)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Select Specific Time Slot */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Move to Time Slot
          </label>
          <div className="max-h-36 overflow-y-auto space-y-0.5 pr-1">
            {allTimeSlots.map((slot) => {
              const isCurrent = slot === currentSlot;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => {
                    if (!isCurrent) {
                      onMove(task.id, currentWeekday, slot);
                      setOpen(false);
                    }
                  }}
                  className={`w-full text-left px-2 py-1 rounded text-[11px] transition-colors flex items-center justify-between ${
                    isCurrent
                      ? "bg-primary/20 text-primary font-semibold border border-primary/30"
                      : "hover:bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{slot}</span>
                  {isCurrent && <span className="text-[10px] text-primary">Current</span>}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type ViewMode = "matrix" | "day" | "analytics";

export type CustomCategory = {
  name: string;
  colorKey: ColorKey;
};

// Category that slots are reassigned to when their custom category is deleted.
// "General" is the app-wide catch-all fallback (parseRoutineTitle defaults an
// unknown/missing category to it, and formatRoutineTitle defaults to it), so a
// deleted custom category's slots render consistently with that existing
// behavior — no dangling category name.
const FALLBACK_CATEGORY_NAME = "General";

function RoutinesPage() {
  // Default to Day View on narrow (mobile) viewports: the 7-Day Matrix needs
  // ~950px of horizontal scroll and hover-only edit controls there. Users can
  // still switch to Matrix via the tab switcher. Runs after mount so SSR
  // markup stays consistent (no hydration mismatch).
  const [viewMode, setViewMode] = useState<ViewMode>("matrix");
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setViewMode("day");
    }
  }, []);
  const [selectedDay, setSelectedDay] = useState<number>(0); // 0=Mon, ..., 6=Sun
  const [editMode, setEditMode] = useState(false); // grid "view" (default) vs "edit"

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

  // Manual time-slot row ordering for the Matrix (localStorage). Slots the user
  // has explicitly positioned live here; anything else falls back to the
  // chronological order derived from the slot times.
  const [slotOrder, setSlotOrder] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_SLOT_ORDER_KEY);
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
  // Category name queued for destructive deletion (confirmation gated).
  const [confirmDeleteCategory, setConfirmDeleteCategory] = useState<string | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<RoutineTask | null>(null);

  // Copy Weekday Schedule State
  const [isCopyScheduleOpen, setIsCopyScheduleOpen] = useState(false);
  const [copySourceDay, setCopySourceDay] = useState<number>(0);
  const [copyTargetDay, setCopyTargetDay] = useState<number>(1);
  const [copyOverwrite, setCopyOverwrite] = useState<boolean>(false);

  // Import JSON State
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [importOverwrite, setImportOverwrite] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);
  // Drag and Drop Slot Movement State
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverCellKey, setDragOverCellKey] = useState<string | null>(null);

  // Form State for Routine Slot
  const [formTitle, setFormTitle] = useState("");
  const [formEmoji, setFormEmoji] = useState("📌");
  const [formCategory, setFormCategory] = useState("Fitness");
  const [formColorKey, setFormColorKey] = useState<ColorKey>("emerald");
  const [formTimeSlot, setFormTimeSlot] = useState<string>("6:00–7:00 AM");
  const [formWeekdays, setFormWeekdays] = useState<number[]>([0]); // Default Monday
  const [formTaskId, setFormTaskId] = useState<string | null>(null);
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
  const updateFn = useServerFn(updateRoutineTask);
  const toggleFn = useServerFn(toggleRoutineTaskActive);
  const batchAddFn = useServerFn(batchAddRoutineTasks);
  const deleteFn = useServerFn(deleteRoutineTask);
  const clearFn = useServerFn(clearAllRoutineTasks);
  const setVariantFn = useServerFn(setActiveRoutineVariant);

  // Queries
  const { data: weekData } = useQuery({
    queryKey: ["week", weekStart],
    queryFn: () => fetchWeekFn({ data: { weekStart } }) as Promise<WeekData>,
  });

  const { data: routineData } = useQuery({
    queryKey: ["routine"],
    queryFn: () => fetchRoutineFn(),
  });

  const tasks = (routineData?.tasks ?? []) as RoutineTask[];
  // Which weekly routine (primary/alternate) is currently being viewed/edited.
  // Sourced from the server so the active week stays in sync across devices.
  const activeVariant = (routineData?.activeVariant ?? "primary") as "primary" | "alternate";

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

  // When the active week changes, reload THAT week's slots/categories/order so
  // each weekly routine renders its own independent grid. A fresh alternate
  // falls back to just the default categories (a blank slate).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(slotsKeyFor(activeVariant));
      setCustomTimeSlots(saved ? (JSON.parse(saved) as string[]) : []);
    } catch {
      setCustomTimeSlots([]);
    }
    try {
      const saved = localStorage.getItem(slotOrderKeyFor(activeVariant));
      setSlotOrder(saved ? (JSON.parse(saved) as string[]) : []);
    } catch {
      setSlotOrder([]);
    }
    try {
      const saved = localStorage.getItem(catsKeyFor(activeVariant));
      setCategories(saved ? (JSON.parse(saved) as CustomCategory[]) : [...DEFAULT_CATEGORIES]);
    } catch {
      setCategories([...DEFAULT_CATEGORIES]);
    }
  }, [activeVariant]);

  // Persist custom time slots & categories (per active week)
  useEffect(() => {
    try {
      localStorage.setItem(slotsKeyFor(activeVariant), JSON.stringify(customTimeSlots));
    } catch {}
  }, [customTimeSlots, activeVariant]);

  useEffect(() => {
    try {
      localStorage.setItem(slotOrderKeyFor(activeVariant), JSON.stringify(slotOrder));
    } catch {}
  }, [slotOrder, activeVariant]);

  useEffect(() => {
    try {
      localStorage.setItem(catsKeyFor(activeVariant), JSON.stringify(categories));
    } catch {}
  }, [categories, activeVariant]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["routine"] });
    void qc.invalidateQueries({ queryKey: ["week"] });
    void qc.invalidateQueries({ queryKey: ["day"] });
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
    // Within a shared time-slot cell, order comes from user-defined sort_order
    // (written globally per task by reorderRoutineTasks) — never alphabetical.
    // created_at then id only guarantee stable rendering for never-reordered
    // (all-zero) cells and as a final deterministic tiebreak.
    const cellComparator = (a: RoutineTask, b: RoutineTask) => {
      const ao = a.sort_order ?? 0;
      const bo = b.sort_order ?? 0;
      if (ao !== bo) return ao - bo;
      if (a.created_at !== b.created_at)
        return (a.created_at ?? "").localeCompare(b.created_at ?? "");
      return (a.id ?? "").localeCompare(b.id ?? "");
    };
    for (const list of map.values()) list.sort(cellComparator);
    return map;
  }, [tasks]);

  // Collect all unique time slots, sorted chronologically by start time
  // (earliest → latest, 12h and 24h formats alike) regardless of creation
  // order. Unparseable slots keep their relative order at the end.
  const allTimeSlots = useMemo(() => {
    const set = new Set<string>(customTimeSlots);
    for (const t of tasks) {
      const parsed = parseRoutineTitle(t.title);
      if (parsed.timeSlot) set.add(parsed.timeSlot);
    }
    return Array.from(set).sort((a, b) => {
      const aStart = timeSlotStartMinutes(a);
      const bStart = timeSlotStartMinutes(b);
      if (aStart === null && bStart === null) return a.localeCompare(b);
      if (aStart === null) return 1;
      if (bStart === null) return -1;
      return aStart - bStart || a.localeCompare(b);
    });
  }, [customTimeSlots, tasks]);

  // Matrix row order: the user's manual slot ordering (slotOrder) takes
  // precedence; slots never explicitly positioned keep their chronological
  // position after any ordered ones, so nothing disappears when new slots are
  // added or tasks are moved into a brand-new time slot.
  const orderedTimeSlots = useMemo(() => {
    const ordered = slotOrder.filter((s) => allTimeSlots.includes(s));
    const rest = allTimeSlots.filter((s) => !ordered.includes(s));
    return [...ordered, ...rest];
  }, [slotOrder, allTimeSlots]);

  // Swap a time-slot row with its neighbour and persist the full manual order.
  const moveTimeSlotRow = (slot: string, direction: "up" | "down") => {
    const list = [...orderedTimeSlots];
    const index = list.indexOf(slot);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || targetIndex < 0 || targetIndex >= list.length) return;
    const moved = list[index]!;
    const [neighbour] = list.splice(targetIndex, 1, moved);
    if (!neighbour) return;
    list[index] = neighbour;
    setSlotOrder(list);
  };

  // ===================== CALCULATIONS & ANALYTICS =====================
  const analytics = useMemo(() => {
    let totalWeeklyMins = 0;
    const catMins: Record<string, { mins: number; count: number; colorKey: ColorKey }> = {};
    const dayMins = Array.from({ length: 7 }, () => ({ mins: 0, count: 0 }));

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
    }

    const totalWeeklyHours = (totalWeeklyMins / 60).toFixed(1);
    const avgDailyHours = (totalWeeklyMins / 60 / 7).toFixed(1);

    const categoriesList = Object.entries(catMins)
      .map(([name, data]) => ({
        name,
        hours: (data.mins / 60).toFixed(1),
        count: data.count,
        colorKey: data.colorKey,
        pct: totalWeeklyMins > 0 ? Math.round((data.mins / totalWeeklyMins) * 100) : 0,
      }))
      .sort((a, b) => Number(b.hours) - Number(a.hours));

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
      activeRoutineCount: tasks.filter((t) => t.is_active).length,
    };
  }, [tasks]);

  // Mutations
  const updateMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      title: string;
      weekday: number;
      goalId?: string | null;
      subjectId?: string | null;
      isActive?: boolean;
    }) => updateFn({ data: vars }),
    onSuccess: () => {
      invalidate();
      toast.success("Routine updated");
      closeModal();
    },
    onError: () => toast.error("Failed to update routine"),
  });

  const moveSlotMutation = useMutation({
    mutationFn: (vars: { id: string; title: string; weekday: number }) =>
      updateFn({ data: vars }),
    onSuccess: (_, vars) => {
      invalidate();
      const parsed = parseRoutineTitle(vars.title);
      toast.success(
        `Moved "${parsed.cleanTitle}" to ${WEEKDAY_NAMES[vars.weekday]} (${parsed.timeSlot || "Flexible"})`,
      );
    },
    onError: () => toast.error("Failed to move routine slot"),
  });

  const handleMoveRoutineSlot = (
    taskId: string,
    targetWeekday: number,
    targetTimeSlot: string,
  ) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const parsed = parseRoutineTitle(task.title);
    if (task.weekday === targetWeekday && (parsed.timeSlot || "") === targetTimeSlot) {
      return;
    }
    const newTitle = formatRoutineTitle(
      parsed.cleanTitle,
      targetTimeSlot,
      parsed.category,
      parsed.emoji,
      parsed.colorKey,
      parsed.habitId,
      parsed.taskId,
    );
    moveSlotMutation.mutate({
      id: taskId,
      weekday: targetWeekday,
      title: newTitle,
    });
  };

  const reorderFn = useServerFn(reorderRoutineTasks);
  const reorderMutation = useMutation({
    mutationFn: (vars: { orderedIds: string[]; variant?: string }) =>
      reorderFn({ data: { orderedIds: vars.orderedIds, variant: vars.variant ?? activeVariant } }),
    onSuccess: invalidate,
    onError: () => {
      invalidate();
      toast.error("Couldn't reorder routines.");
    },
  });

  // Swap a task with its neighbour inside a time-slot cell. Order is
  // title-based and global: the whole cell's (re-ordered) ids are sent so the
  // server can write the new sort_order to every weekday's row for those tasks.
  const moveRoutineInCell = (cellKey: string, taskId: string, direction: "up" | "down") => {
    const list = [...(taskMatrix.get(cellKey) ?? [])];
    const index = list.findIndex((t) => t.id === taskId);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || targetIndex < 0 || targetIndex >= list.length) return;
    const moved = list[index];
    if (!moved) return;
    const [neighbour] = list.splice(targetIndex, 1, moved);
    if (!neighbour) return;
    list[index] = neighbour;
    reorderMutation.mutate({ orderedIds: list.map((t) => t.id) });
  };

  const toggleMutation = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) => toggleFn({ data: vars }),
    onSuccess: () => {
      invalidate();
      toast.success("Status updated");
    },
  });

  const batchAddMutation = useMutation({
    mutationFn: (
      items: Array<{
        weekday: number;
        title: string;
        goalId?: string | null;
        subjectId?: string | null;
        isActive?: boolean;
        sortOrder?: number;
      }>,
    ) => batchAddFn({ data: { items, variant: activeVariant } }),
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
    mutationFn: () => clearFn({ data: { variant: activeVariant } }),
    onSuccess: () => {
      invalidate();
      toast.success("Schedule cleared");
    },
  });

  const copyWeekdayFn = useServerFn(copyWeekdayRoutines);
  const copyMutation = useMutation({
    mutationFn: (vars: {
      sourceWeekday: number;
      targetWeekday: number;
      overwriteTarget?: boolean;
    }) => copyWeekdayFn({ data: { ...vars, variant: activeVariant } }),
    onSuccess: (res) => {
      invalidate();
      toast.success(`Copied ${res.copiedCount} routine slot(s)!`);
      setIsCopyScheduleOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to copy routine schedule");
    },
  });

  const switchVariantMutation = useMutation({
    mutationFn: (variant: "primary" | "alternate") => setVariantFn({ data: { variant } }),
    onSuccess: () => {
      invalidate();
      toast.success(
        activeVariant === "primary"
          ? "Switched to Alternate Routine (blank slate)."
          : "Switched back to Primary Routine.",
      );
    },
    onError: () => toast.error("Couldn't switch routine."),
  });

  // Export Routine JSON
  const handleExportRoutinesJSON = () => {
    try {
      const exportPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        customTimeSlots,
        categories,
        routineTasks: tasks.map((t) => ({
          weekday: t.weekday,
          title: t.title,
          goal_id: t.goal_id,
          subject_id: t.subject_id,
          is_active: t.is_active,
        })),
      };
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `momentum-routines-backup-${toISODate(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Routines exported successfully!");
    } catch (err) {
      toast.error("Failed to export routines JSON");
    }
  };

  // Import Routine JSON
  const handleImportRoutinesJSON = async () => {
    setImportError(null);
    if (!importJsonText.trim()) {
      setImportError("Please paste JSON or upload a backup file.");
      return;
    }
    try {
      const parsed = JSON.parse(importJsonText);
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.routineTasks)
          ? parsed.routineTasks
          : null;

      if (!items || !Array.isArray(items)) {
        setImportError("Invalid JSON structure: could not find routine tasks array.");
        return;
      }

      // Update customTimeSlots if present
      if (Array.isArray(parsed.customTimeSlots) && parsed.customTimeSlots.length > 0) {
        const mergedSlots = Array.from(new Set([...customTimeSlots, ...parsed.customTimeSlots]));
        setCustomTimeSlots(mergedSlots);
        try {
          localStorage.setItem(slotsKeyFor(activeVariant), JSON.stringify(mergedSlots));
        } catch {}
      }

      // Update categories if present
      if (Array.isArray(parsed.categories) && parsed.categories.length > 0) {
        const existingNames = new Set(categories.map((c) => c.name.toLowerCase()));
        const newCats = parsed.categories.filter(
          (c: any) => c?.name && !existingNames.has(c.name.toLowerCase()),
        );
        if (newCats.length > 0) {
          const mergedCats = [...categories, ...newCats];
          setCategories(mergedCats);
          try {
            localStorage.setItem(STORAGE_CUSTOM_CATS_KEY, JSON.stringify(mergedCats));
          } catch {}
        }
      }

      const formattedItems = items
        .filter((t: any) => t && typeof t.title === "string" && typeof t.weekday === "number")
        .map((t: any) => ({
          weekday: t.weekday % 7,
          title: t.title,
          isActive: t.is_active ?? t.isActive ?? true,
          sortOrder: typeof t.sort_order === "number" ? t.sort_order : typeof t.sortOrder === "number" ? t.sortOrder : undefined,
        }));

      if (formattedItems.length === 0) {
        setImportError("No valid routine slots found in the JSON file.");
        return;
      }

      if (importOverwrite) {
        await clearFn({ data: { variant: activeVariant } });
      }

      await batchAddFn({ data: { items: formattedItems, variant: activeVariant } });
      invalidate();
      setIsImportOpen(false);
      setImportJsonText("");
      toast.success(`Successfully imported ${formattedItems.length} routine slot(s)!`);
    } catch (err: any) {
      setImportError(`Failed to parse or save JSON: ${err?.message || "Invalid syntax"}`);
    }
  };

  // Modal Handlers
  const openAddModal = (defaultWeekday?: number, defaultTimeSlot?: string) => {
    setEditingTask(null);
    setFormTitle("");
    setFormEmoji("🏋️");
    setFormCategory(categories[0]?.name ?? "Fitness");
    setFormColorKey(categories[0]?.colorKey ?? "emerald");
    setFormTimeSlot(defaultTimeSlot ?? allTimeSlots[0] ?? "6:00–7:00 AM");
    setFormWeekdays(defaultWeekday !== undefined ? [defaultWeekday] : [0]);
    setFormTaskId(null);
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
    setFormTaskId(parsed.taskId);
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
      null,
      formTaskId,
    );

    if (editingTask) {
      updateMutation.mutate({
        id: editingTask.id,
        title: fullTitle,
        weekday: formWeekdays[0] ?? editingTask.weekday,
        isActive: formIsActive,
      });
    } else {
      const items = formWeekdays.map((wd) => ({
        weekday: wd,
        title: fullTitle,
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

  // Whether a category is one of the app's built-in defaults. Built-ins can never
  // be deleted; only user-created custom categories can.
  const isBuiltinCategory = (name: string) =>
    DEFAULT_CATEGORIES.some((c) => c.name.toLowerCase() === name.toLowerCase());

  // Custom categories = everything in state that isn't a built-in default.
  const customCategories = useMemo(
    () => categories.filter((c) => !isBuiltinCategory(c.name)),
    [categories],
  );

  // Slots currently assigned to a given category (by name, parsed from their title).
  const slotIdsByCategory = useMemo(() => {
    const map = new Map<string, { id: string; title: string; weekday: number }[]>();
    for (const t of tasks) {
      const cat = parseRoutineTitle(t.title).category;
      const list = map.get(cat) ?? [];
      list.push({ id: t.id, title: t.title, weekday: t.weekday });
      map.set(cat, list);
    }
    return map;
  }, [tasks]);

  // Reassign a slot to the universal "General" fallback by rebuilding its title.
  // formatRoutineTitle takes the CLEAN title and the emoji separately (the emoji
  // lives both in the bracket and prefixes the display title), so pass
  // cleanTitle + emoji explicitly to avoid double-prefixing.
  const reassignSlotToFallback = (title: string): string => {
    const p = parseRoutineTitle(title);
    return formatRoutineTitle(
      p.cleanTitle,
      p.timeSlot,
      FALLBACK_CATEGORY_NAME,
      p.emoji,
      p.colorKey,
      p.habitId,
      p.taskId,
    );
  };

  // Delete a custom category, reassigning its slots to the fallback category.
  const handleDeleteCategory = (catName: string) => {
    setConfirmDeleteCategory(catName); // gate behind AlertDialog confirmation
  };

  const confirmDeleteCategoryAction = () => {
    if (!confirmDeleteCategory) return;
    const catName = confirmDeleteCategory;

    // Reassign every slot currently using this category to the fallback.
    const affected = slotIdsByCategory.get(catName) ?? [];
    for (const slot of affected) {
      updateMutation.mutate({
        id: slot.id,
        title: reassignSlotToFallback(slot.title),
        weekday: slot.weekday,
      });
    }

    // Remove the category (also persists via the categories effect).
    setCategories((prev) => prev.filter((c) => c.name !== catName));
    setConfirmDeleteCategory(null);
    toast.success(
      affected.length > 0
        ? `Deleted "${catName}" — ${affected.length} routine slot${affected.length === 1 ? "" : "s"} moved to "${FALLBACK_CATEGORY_NAME}".`
        : `Deleted custom category "${catName}".`,
    );
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

  const doClearAllSlots = () => {
    setCustomTimeSlots([]);
    try {
      localStorage.removeItem(slotsKeyFor(activeVariant));
    localStorage.removeItem(slotOrderKeyFor(activeVariant));
    } catch {}
    clearMutation.mutate();
    toast.success("All time slots and routines cleared");
  };

  const loadSampleSchedule = () => {
    if (tasks.length > 0) {
      if (
        !confirm("This will add the sample daily routine timetable to your schedule. Continue?")
      ) {
        return;
      }
    }

    setCustomTimeSlots(Array.from(new Set([...SAMPLE_TIME_SLOTS])));
    const items: Array<{
      weekday: number;
      title: string;
      goalId?: string | null;
      isActive?: boolean;
    }> = [];
    for (const entry of SAMPLE_WEEKLY_ROUTINE) {
      const color = (entry.colorKey ??
        (COLOR_PALETTE[entry.category.toLowerCase() as ColorKey]
          ? entry.category.toLowerCase()
          : "slate")) as ColorKey;
      const fullTitle = formatRoutineTitle(
        entry.title,
        entry.timeSlot,
        entry.category,
        entry.emoji,
        color,
      );
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
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <Sparkles className="h-3.5 w-3.5" /> Routine Matrix & System
              </span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              My Daily Routine <span className="text-muted-foreground">— Weekly Schedule</span>
            </h1>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                  activeVariant === "primary"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-purple-500/15 text-purple-400"
                }`}
              >
                <Shuffle className="h-3 w-3" />
                {activeVariant === "primary" ? "Primary Week" : "Alternate Week"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Fully editable time-blocked timetable with custom time slots, custom categories, habit
              & goal integrations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Secondary actions consolidated into a dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-border hover:bg-secondary"
                  disabled={batchAddMutation.isPending}
                >
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" /> More Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Schedule Options
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setIsAddSlotOpen(true)}>
                  <Clock className="h-4 w-4 text-primary" /> + Time Slot
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsAddCategoryOpen(true)}>
                  <Tag className="h-4 w-4 text-cyan-400" /> + Category
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsCopyScheduleOpen(true)}>
                  <Copy className="h-4 w-4 text-indigo-400" /> Copy Day Schedule...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleExportRoutinesJSON}>
                  <Download className="h-4 w-4 text-emerald-400" /> Export Schedule JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsImportOpen(true)}>
                  <Upload className="h-4 w-4 text-amber-400" /> Import Schedule JSON...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={loadSampleSchedule}
                  disabled={batchAddMutation.isPending}
                >
                  <Zap className="h-4 w-4 text-primary" /> Load Sample
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button size="sm" className="gap-1.5" onClick={() => openAddModal()}>
              <Plus className="h-4 w-4" /> Add Routine Slot
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={switchVariantMutation.isPending}
              onClick={() =>
                switchVariantMutation.mutate(
                  activeVariant === "primary" ? "alternate" : "primary",
                )
              }
              title="Switch between your Primary and Alternate weekly routines"
            >
              <Shuffle className="h-4 w-4 text-purple-400" />{" "}
              {activeVariant === "primary" ? "Alternate Routine" : "Primary Routine"}
            </Button>
          </div>
        </div>

        {/* Calculated Stats Overview */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Weekly Scheduled</span>
              <Clock className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="num mt-1 text-2xl font-bold">
              {analytics.totalWeeklyHours}{" "}
              <span className="text-xs font-normal text-muted-foreground">hrs/wk</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              ~{analytics.avgDailyHours} hrs/day average
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Active Routine Slots</span>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="num mt-1 text-2xl font-bold text-emerald-400">
              {analytics.activeRoutineCount}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {tasks.length} total registered
            </div>
          </div>
        </div>

        {/* View Switches & Toolbar */}
        <div className="flex flex-nowrap items-center gap-4 overflow-x-auto border-b border-border/60 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:justify-between">
          <div className="flex items-center gap-1 rounded-full bg-secondary/80 p-1 text-xs">
            <button
              onClick={() => setViewMode("matrix")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-all ${
                viewMode === "matrix"
                  ? "bg-background text-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Grid className="h-3.5 w-3.5" /> 7-Day Matrix Grid
            </button>
            <button
              onClick={() => setViewMode("day")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-all ${
                viewMode === "day"
                  ? "bg-background text-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-3.5 w-3.5" /> Day View
            </button>
            <button
              onClick={() => setViewMode("analytics")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-all ${
                viewMode === "analytics"
                  ? "bg-background text-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
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
                    selectedDay === idx
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              ))}
            </div>
          )}

          {tasks.length > 0 || customTimeSlots.length > 0 ? (
            <button
              onClick={() => setIsClearConfirmOpen(true)}
              className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors ml-auto"
            >
              <RotateCcw className="h-3 w-3" /> Clear Timeslots & Schedule
            </button>
          ) : null}

          {/* Matrix Edit / Done Editing toggle (view mode by default) */}
          <button
            onClick={() => setEditMode((e) => !e)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              editMode
                ? "bg-primary text-primary-foreground shadow"
                : "border border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <Edit2 className="h-3.5 w-3.5" />
            {editMode ? "Done Editing" : "Edit"}
          </button>
        </div>

        {/* Clear-schedule confirmation (destructive, gated behind explicit confirm) */}
        <AlertDialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear timeslots &amp; schedule?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all custom time slots and every routine in your weekly
                schedule. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={doClearAllSlots}
                className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
              >
                Clear Everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* View Mode 1: 7-Day Timetable Matrix */}
        {viewMode === "matrix" && (
          <div className="space-y-4">
            <div className="relative overflow-x-auto rounded-xl border border-border/80 bg-card shadow-2xl">
              <table className="w-full border-collapse text-left text-xs min-w-[950px]">
                {/* Header Row */}
                <thead>
                  <tr className="border-b border-border bg-secondary/70 backdrop-blur">
                    <th className="sticky left-0 z-20 w-32 md:w-44 border-r border-border bg-secondary p-3 font-semibold uppercase tracking-wider text-muted-foreground text-center">
                      Time Slot
                    </th>
                    {WEEKDAY_NAMES.map((dayName, idx) => {
                      const isWeekend = idx === 5 || idx === 6;
                      const dayLoad = analytics.dayLoads[idx];
                      const isOverloaded = dayLoad && Number(dayLoad.hours) > 8;
                      return (
                        <th
                          key={dayName}
                          className={`p-3 font-semibold text-center uppercase tracking-wider border-r border-border/50 ${
                            isWeekend ? "bg-rose-500/10 text-rose-300" : "text-foreground"
                          }`}
                        >
                          <div>{dayName}</div>
                          {dayLoad && (
                            <div className="flex flex-col items-center gap-0.5 mt-0.5">
                              <span className="text-[10px] font-mono font-normal text-muted-foreground lowercase">
                                {dayLoad.hours}h ({dayLoad.count} slots)
                              </span>
                              {isOverloaded && (
                                <span
                                  title="Scheduled routine exceeds 8 hours"
                                  className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 text-[9px] font-bold text-amber-500 lowercase"
                                >
                                  <AlertTriangle className="h-2.5 w-2.5" /> Over 8h
                                </span>
                              )}
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
                        <h4 className="font-semibold text-sm text-foreground">
                          No time slots created yet
                        </h4>
                        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                          Create your own custom time slots to design your schedule, or load the
                          sample timetable.
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
                      {orderedTimeSlots.map((timeSlot, slotIdx) => (
                        <tr key={timeSlot} className="hover:bg-secondary/20 transition-colors">
                          {/* Time Column with hover delete button */}
                          <td className="sticky left-0 z-10 w-32 md:w-44 border-r border-border bg-card/95 py-2.5 px-2 font-mono font-medium text-[11px] text-center text-muted-foreground group/time">
                            <div className="flex items-center justify-center gap-1">
                              <span className="whitespace-nowrap">
                                {timeSlot.replace(/\s*-\s*/g, "–")}
                              </span>
                              {editMode && (
                                <>
                                  <button
                                    onClick={() => moveTimeSlotRow(timeSlot, "up")}
                                    disabled={slotIdx === 0}
                                    aria-label={`Move time slot ${timeSlot} up`}
                                    title="Move time slot up"
                                    className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:hover:text-muted-foreground p-0.5 -m-0.5 transition-colors"
                                  >
                                    <ChevronUp className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => moveTimeSlotRow(timeSlot, "down")}
                                    disabled={slotIdx === orderedTimeSlots.length - 1}
                                    aria-label={`Move time slot ${timeSlot} down`}
                                    title="Move time slot down"
                                    className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:hover:text-muted-foreground p-0.5 -m-0.5 transition-colors"
                                  >
                                    <ChevronDown className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteTimeSlotRow(timeSlot)}
                                    className="inline-flex md:hidden md:group-hover/time:inline-flex text-muted-foreground hover:text-destructive p-1.5 -m-1 md:p-0 md:m-0 transition-colors"
                                    title={`Delete time slot "${timeSlot}"`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </>
                              )}
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground/40 font-sans">
                              {calculateSlotDurationMinutes(timeSlot)}m
                            </div>
                          </td>

                          {/* 7 Days Columns */}
                          {WEEKDAY_NAMES.map((_, dayIdx) => {
                            const key = `${timeSlot}|${dayIdx}`;
                            const cellTasks = taskMatrix.get(key) ?? [];
                            const isWeekend = dayIdx === 5 || dayIdx === 6;
                            const isCellDragOver = dragOverCellKey === key;

                            return (
                              <td
                                key={dayIdx}
                                onDragOver={(e) => {
                                  if (draggingTaskId) {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "move";
                                    setDragOverCellKey(key);
                                  }
                                }}
                                onDragLeave={() => {
                                  if (dragOverCellKey === key) {
                                    setDragOverCellKey(null);
                                  }
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  setDragOverCellKey(null);
                                  const tId = e.dataTransfer.getData("text/plain") || draggingTaskId;
                                  if (tId) {
                                    handleMoveRoutineSlot(tId, dayIdx, timeSlot);
                                    setDraggingTaskId(null);
                                  }
                                }}
                                className={`p-2 border-r border-border/30 vertical-top align-top min-h-[52px] transition-all relative ${
                                  isWeekend ? "bg-rose-500/[0.02]" : ""
                                } ${editMode ? "group" : ""} ${
                                  isCellDragOver
                                    ? "bg-primary/20 border-primary ring-2 ring-primary/50 shadow-inner"
                                    : ""
                                }`}
                              >
                                <div className="space-y-1.5 min-h-[44px] flex flex-col justify-center">
                                  {cellTasks.map((task, taskIdx) => {
                                    const parsed = parseRoutineTitle(task.title);
                                    const color =
                                      COLOR_PALETTE[parsed.colorKey] ?? COLOR_PALETTE.slate;
                                    const isThisDragging = draggingTaskId === task.id;

                                    return (
                                      <div
                                        key={task.id}
                                        draggable={editMode}
                                        onDragStart={editMode ? (e) => {
                                          e.stopPropagation();
                                          setDraggingTaskId(task.id);
                                          e.dataTransfer.setData("text/plain", task.id);
                                          e.dataTransfer.effectAllowed = "move";
                                        } : undefined}
                                        onDragEnd={editMode ? () => {
                                          setDraggingTaskId(null);
                                          setDragOverCellKey(null);
                                        } : undefined}
                                        onClick={editMode ? () => openEditModal(task) : undefined}
                                        className={`relative flex flex-col gap-1 rounded-lg border border-border/70 bg-secondary/40 py-2 pl-3 pr-2 text-[11px] transition-all ${
                                          editMode
                                            ? "group/item hover:scale-[1.02] hover:shadow-md cursor-grab active:cursor-grabbing"
                                            : "hover:shadow-xs"
                                        } ${!task.is_active ? "opacity-40 grayscale" : ""} ${
                                          isThisDragging ? "opacity-30 scale-95 border-dashed border-primary" : ""
                                        }`}
                                      >
                                        {/* Category colour accent: thin left stripe carries the
                                        category's colour; the card itself stays neutral. */}
                                        <span
                                          aria-hidden
                                          className={`absolute left-0.5 top-1 bottom-1 w-[3px] rounded-full bg-current ${color.text}`}
                                        />
                                        <div className="flex items-center justify-between gap-1">
                                          <span className="font-semibold truncate text-foreground flex items-center gap-1">
                                            <span className="text-sm leading-none">
                                              {parsed.emoji}
                                            </span>
                                            <span className="truncate">{parsed.cleanTitle}</span>
                                          </span>

                                          {/* Action icons */}
                                          <div className="flex items-center gap-1">
                                            {/* Reorder within cell — edit mode only */}
                                            {editMode && (
                                              <>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    moveRoutineInCell(key, task.id, "up");
                                                  }}
                                                  disabled={taskIdx === 0}
                                                  aria-label={`Move ${parsed.cleanTitle} up`}
                                                  title="Move up"
                                                  className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:hover:text-muted-foreground p-1 -m-0.5"
                                                >
                                                  <ChevronUp className="h-3 w-3" />
                                                </button>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    moveRoutineInCell(key, task.id, "down");
                                                  }}
                                                  disabled={taskIdx === cellTasks.length - 1}
                                                  aria-label={`Move ${parsed.cleanTitle} down`}
                                                  title="Move down"
                                                  className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:hover:text-muted-foreground p-1 -m-0.5"
                                                >
                                                  <ChevronDown className="h-3 w-3" />
                                                </button>
                                              </>
                                            )}

                                            {/* Move Slot Popover — edit mode only */}
                                            {editMode && (
                                            <MoveRoutineSlotPopover
                                              task={task}
                                              allTimeSlots={allTimeSlots}
                                              onMove={handleMoveRoutineSlot}
                                            >
                                              <button
                                                type="button"
                                                onClick={(e) => e.stopPropagation()}
                                                title="Move routine slot to another day / time slot"
                                                className="text-muted-foreground hover:text-foreground p-1 -m-0.5 transition-colors"
                                              >
                                                <ArrowRightLeft className="h-3 w-3" />
                                              </button>
                                            </MoveRoutineSlotPopover>
                                            )}

                                            {editMode && (
                                              <>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleMutation.mutate({
                                                      id: task.id,
                                                      isActive: !task.is_active,
                                                    });
                                                  }}
                                                  title={task.is_active ? "Deactivate" : "Activate"}
                                                  className="text-muted-foreground hover:text-foreground p-1 -m-0.5"
                                                >
                                                  <Check
                                                    className={`h-3 w-3 ${task.is_active ? "text-emerald-400" : ""}`}
                                                  />
                                                </button>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteMutation.mutate(task.id);
                                                  }}
                                                  title="Delete slot"
                                                  className="text-muted-foreground hover:text-destructive p-1 -m-0.5"
                                                >
                                                  <Trash2 className="h-3 w-3" />
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </div>

                                        {/* Status Badge */}
                                        <div className="flex flex-wrap items-center gap-1 text-[11px] mt-0.5">
                                          {!task.is_active && (
                                            <span className="inline-flex items-center gap-0.5 text-muted-foreground bg-muted/60 px-1 py-0.5 rounded border border-border/50 text-[10px] font-semibold">
                                              <Pause className="h-2 w-2" />
                                              <span>Paused</span>
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}

                                  {isCellDragOver && (
                                    <div className="rounded border border-dashed border-primary/60 bg-primary/10 py-1.5 text-center text-[10px] font-semibold text-primary">
                                      Drop slot here
                                    </div>
                                  )}

                                  {/* Add button on hover (edit mode only) */}
                                  {editMode && (
                                    <button
                                      onClick={() => openAddModal(dayIdx, timeSlot)}
                                      className="w-full flex md:hidden md:group-hover:flex items-center justify-center rounded border border-dashed border-border/60 py-2 text-[10px] text-muted-foreground hover:border-primary hover:text-primary transition-all"
                                    >
                                      <Plus className="h-3 w-3 mr-0.5" /> Add
                                    </button>
                                  )}
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
                <h3 className="font-semibold text-lg">
                  {WEEKDAY_NAMES[selectedDay]} Routine Schedule
                </h3>
                <p className="text-xs text-muted-foreground">
                  Scheduled time:{" "}
                  <span className="num font-semibold text-foreground">
                    {analytics.dayLoads[selectedDay]?.hours ?? 0} hours
                  </span>{" "}
                  across {analytics.dayLoads[selectedDay]?.count ?? 0} routine blocks.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCopySourceDay(selectedDay);
                    setCopyTargetDay((selectedDay + 1) % 7);
                    setIsCopyScheduleOpen(true);
                  }}
                  className="gap-1.5 text-xs border-border hover:bg-secondary"
                >
                  <Copy className="h-3.5 w-3.5 text-indigo-400" /> Copy Day
                </Button>
                {editMode && (
                  <Button size="sm" onClick={() => openAddModal(selectedDay)}>
                    <Plus className="h-4 w-4 mr-1" /> Add to{" "}
                    {WEEKDAY_NAMES[selectedDay]?.slice(0, 3) ?? "Day"}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tasks
                .filter((t) => t.weekday === selectedDay)
                // Chronological within the day: sort by the block's start time
                // (same parser as the matrix rows), tasks without a parseable
                // slot keep their original order at the end.
                .sort(
                  (a, b) =>
                    (timeSlotStartMinutes(parseRoutineTitle(a.title).timeSlot) ?? Infinity) -
                    (timeSlotStartMinutes(parseRoutineTitle(b.title).timeSlot) ?? Infinity),
                )
                .map((task) => {
                  const parsed = parseRoutineTitle(task.title);
                  const color = COLOR_PALETTE[parsed.colorKey] ?? COLOR_PALETTE.slate;
                  const duration = calculateSlotDurationMinutes(parsed.timeSlot);

                  return (
                    <div
                      key={task.id}
                      className={`relative flex flex-col justify-between rounded-xl border border-border/70 bg-secondary/40 p-4 transition-all hover:shadow-lg ${
                        !task.is_active ? "opacity-50" : ""
                      }`}
                    >
                      {/* Category colour accent: thin left stripe carries the
                          category's colour; the card itself stays neutral. */}
                      <span
                        aria-hidden
                        className={`absolute left-0.5 top-1 bottom-1 w-[3px] rounded-full bg-current ${color.text}`}
                      />
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className="text-3xl">{parsed.emoji}</span>
                            <div>
                              <h4 className="font-bold text-foreground text-sm">
                                {parsed.cleanTitle}
                              </h4>
                              <span className="num text-xs text-muted-foreground">
                                {parsed.timeSlot || "Flexible Time"} ({duration}m)
                              </span>
                            </div>
                          </div>

                          <button
                            onClick={() =>
                              toggleMutation.mutate({ id: task.id, isActive: !task.is_active })
                            }
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                              task.is_active
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {task.is_active ? "Active" : "Paused"}
                          </button>
                        </div>

                        {/* Task Reference Badge */}
                        {parsed.taskId && (
                          <div className="flex flex-col gap-1 text-xs">
                            <div className="flex items-center gap-1.5 text-purple-400">
                              <Layers className="h-3.5 w-3.5" />
                              <span>Task Reference: {parsed.taskId}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-2 text-xs">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-medium ${color.text} bg-background/50 border ${color.border}`}
                        >
                          {parsed.category}
                        </span>

                        <div className="flex items-center gap-1.5">
                          {/* Move Slot Popover — edit mode only */}
                          {editMode && (
                          <MoveRoutineSlotPopover
                            task={task}
                            allTimeSlots={allTimeSlots}
                            onMove={handleMoveRoutineSlot}
                          >
                            <button
                              type="button"
                              className="flex items-center gap-1 rounded-md bg-secondary/60 hover:bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                              title="Move to another day or time slot"
                            >
                              <ArrowRightLeft className="h-3 w-3" /> Move
                            </button>
                          </MoveRoutineSlotPopover>
                          )}

                          {editMode && (
                            <>
                              <button
                                onClick={() => openEditModal(task)}
                                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                                title="Edit slot details"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => deleteMutation.mutate(task.id)}
                                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                title="Delete slot"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
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
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
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
                  const bgClass =
                    cat.colorKey === "emerald"
                      ? "bg-emerald-500"
                      : cat.colorKey === "cyan"
                        ? "bg-cyan-500"
                        : cat.colorKey === "amber"
                          ? "bg-amber-500"
                          : cat.colorKey === "purple"
                            ? "bg-purple-500"
                            : cat.colorKey === "indigo"
                              ? "bg-indigo-500"
                              : cat.colorKey === "rose"
                                ? "bg-rose-500"
                                : cat.colorKey === "blue"
                                  ? "bg-blue-500"
                                  : cat.colorKey === "teal"
                                    ? "bg-teal-500"
                                    : cat.colorKey === "fuchsia"
                                      ? "bg-fuchsia-500"
                                      : cat.colorKey === "orange"
                                        ? "bg-orange-500"
                                        : "bg-primary";

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
                    <div
                      key={cat.name}
                      className={`rounded-lg border p-3 ${color.bg} ${color.border}`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-semibold ${color.text}`}>{cat.name}</span>
                        <span className="num font-bold text-muted-foreground">{cat.pct}%</span>
                      </div>
                      <div className="num mt-1 text-lg font-bold text-foreground">
                        {cat.hours} <span className="text-xs font-normal">hrs</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {cat.count} routine blocks
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Day Load */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4 text-purple-400" /> Day-by-Day Load Density
              </h3>
              <div className="space-y-2">
                {analytics.dayLoads.map((dl) => (
                  <div
                    key={dl.weekday}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 p-2.5 text-xs"
                  >
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
                      <span className="text-[10px] text-muted-foreground ml-1.5">
                        ({dl.count} slots)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Routine Add / Edit Dialog Overlay */}
      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95 my-8">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                  {editingTask
                    ? "Edit Routine Slot"
                    : "Add Routine Slot"}
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

              {/* Emoji Quick Picker (collapsed by default; expands into a popover) */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Choose Icon / Emoji
                </label>
                <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
                    >
                      <span className="text-lg leading-none">{formEmoji}</span>
                      <span className="font-medium">Choose icon</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64">
                    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1">
                      {EMOJI_PRESETS.map((emo) => (
                        <button
                          key={emo}
                          type="button"
                          onClick={() => {
                            setFormEmoji(emo);
                            setEmojiPickerOpen(false);
                          }}
                          className={`h-8 w-8 rounded text-lg flex items-center justify-center transition-all ${
                            formEmoji === emo
                              ? "bg-primary text-primary-foreground scale-110 shadow"
                              : "hover:bg-secondary"
                          }`}
                        >
                          {emo}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Category & Time Slot */}
              <div className="grid gap-3 sm:grid-cols-2">
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
                    className="w-full rounded-lg border border-border bg-secondary/50 p-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
                    className="w-full rounded-lg border border-border bg-secondary/50 p-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {allTimeSlots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot} ({calculateSlotDurationMinutes(slot)}m)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Per-Block Color Override */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                  Block Color Override
                </label>
                <div className="flex flex-wrap gap-2">
                  {(Object.entries(COLOR_PALETTE) as Array<[ColorKey, typeof COLOR_PALETTE[ColorKey]]>).map(([key, palette]) => (
                    <button
                      key={key}
                      type="button"
                      title={palette.label}
                      aria-label={`Set color to ${palette.label}`}
                      onClick={() => setFormColorKey(key)}
                      className={`h-7 w-7 rounded-full border-2 transition-all ${
                        formColorKey === key
                          ? "border-foreground scale-110 shadow-sm"
                          : "border-transparent hover:scale-105 hover:border-border"
                      } ${palette.bg} flex items-center justify-center`}
                    >
                      {formColorKey === key && (
                        <span className={`text-[10px] font-bold ${palette.text}`}>✓</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Overrides the category's default color for this specific block.
                </p>
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
                            selected
                              ? "bg-primary text-primary-foreground shadow"
                              : "bg-secondary text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {dayName.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95">
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddSlotOpen(false)}
                >
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
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95">
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

              {/* Manage existing custom categories: delete any user-created one.
                  Built-in defaults are never listed/deletable here. */}
              {customCategories.length > 0 && (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                    Manage Custom Categories
                  </label>
                  <ul className="space-y-1.5">
                    {customCategories.map((cat) => {
                      const usedBy = (slotIdsByCategory.get(cat.name) ?? []).length;
                      const color = COLOR_PALETTE[cat.colorKey] ?? COLOR_PALETTE.slate;
                      return (
                        <li
                          key={cat.name}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-secondary/30 px-3 py-2 text-xs"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className={`h-2.5 w-2.5 shrink-0 rounded-full ${color.bg} ${color.border}`}
                            />
                            <span className="truncate font-medium text-foreground">{cat.name}</span>
                            <span className="shrink-0 text-muted-foreground">
                              {usedBy > 0 ? `${usedBy} slot${usedBy === 1 ? "" : "s"}` : "unused"}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(cat.name)}
                            title={`Delete "${cat.name}"`}
                            aria-label={`Delete category ${cat.name}`}
                            className="p-3 -m-2 md:p-1 md:m-0 text-muted-foreground transition-colors hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Built-in categories can't be deleted. Deleting a custom category reassigns its
                    routine slots to "{FALLBACK_CATEGORY_NAME}".
                  </p>
                </div>
              )}

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
                          newCatColor === cKey
                            ? "ring-2 ring-primary scale-105"
                            : "opacity-75 hover:opacity-100"
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddCategoryOpen(false)}
                >
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

      {/* Copy Weekday Schedule Modal */}
      {isCopyScheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Copy className="h-4 w-4 text-indigo-400" /> Copy Weekday Schedule
              </h3>
              <button
                onClick={() => setIsCopyScheduleOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-semibold p-1"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (copySourceDay === copyTargetDay) {
                  toast.error("Source and target weekday cannot be the same");
                  return;
                }
                copyMutation.mutate({
                  sourceWeekday: copySourceDay,
                  targetWeekday: copyTargetDay,
                  overwriteTarget: copyOverwrite,
                });
              }}
              className="mt-4 space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                    Copy From (Source)
                  </label>
                  <select
                    value={copySourceDay}
                    onChange={(e) => setCopySourceDay(Number(e.target.value))}
                    className="w-full rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {WEEKDAY_NAMES.map((name, idx) => (
                      <option key={name} value={idx}>
                        {name} ({tasks.filter((t) => t.weekday === idx).length} slots)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                    Copy To (Target)
                  </label>
                  <select
                    value={copyTargetDay}
                    onChange={(e) => setCopyTargetDay(Number(e.target.value))}
                    className="w-full rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {WEEKDAY_NAMES.map((name, idx) => (
                      <option key={name} value={idx}>
                        {name} ({tasks.filter((t) => t.weekday === idx).length} slots)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-secondary/30 p-3">
                <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyOverwrite}
                    onChange={(e) => setCopyOverwrite(e.target.checked)}
                    className="rounded border-border"
                  />
                  <span>Overwrite existing routine slots on target weekday</span>
                </label>
                <p className="text-[11px] text-muted-foreground mt-1 ml-5">
                  If unchecked, source slots will be appended alongside existing items.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCopyScheduleOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={copyMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {copyMutation.isPending ? "Copying..." : "Copy Schedule"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Routines JSON Modal */}
      {isImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="font-bold text-base flex items-center gap-2">
                <FileJson className="h-4 w-4 text-amber-400" /> Import Schedule JSON
              </h3>
              <button
                onClick={() => {
                  setIsImportOpen(false);
                  setImportError(null);
                }}
                className="text-muted-foreground hover:text-foreground text-sm font-semibold p-1"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Upload Backup File (.json)
                </label>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        setImportJsonText(event.target?.result as string);
                        setImportError(null);
                      };
                      reader.readAsText(file);
                    }
                  }}
                  className="block w-full text-xs text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-border file:bg-secondary file:text-xs file:font-semibold file:text-foreground hover:file:bg-secondary/80 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Or Paste JSON Content
                </label>
                <textarea
                  value={importJsonText}
                  onChange={(e) => {
                    setImportJsonText(e.target.value);
                    setImportError(null);
                  }}
                  rows={6}
                  placeholder={`{\n  "customTimeSlots": [...],\n  "categories": [...],\n  "routineTasks": [...]\n}`}
                  className="w-full rounded-md border border-border bg-secondary/50 p-2.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {importError && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              <div className="rounded-lg border border-border/70 bg-secondary/30 p-3">
                <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importOverwrite}
                    onChange={(e) => setImportOverwrite(e.target.checked)}
                    className="rounded border-border"
                  />
                  <span>Replace existing schedule completely</span>
                </label>
                <p className="text-[11px] text-muted-foreground mt-1 ml-5">
                  If unchecked, imported routine slots will be merged with your current schedule.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsImportOpen(false);
                    setImportError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleImportRoutinesJSON}
                  disabled={!importJsonText.trim() || batchAddMutation.isPending}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {batchAddMutation.isPending ? "Importing..." : "Import Schedule"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete-category confirmation (destructive, gated): affects every routine
          slot using the category, which get reassigned to the fallback. */}
      <AlertDialog
        open={confirmDeleteCategory !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteCategory(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category "{confirmDeleteCategory}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const count = confirmDeleteCategory
                  ? (slotIdsByCategory.get(confirmDeleteCategory) ?? []).length
                  : 0;
                return count > 0
                  ? `This category is used by ${count} routine slot${count === 1 ? "" : "s"}. Deleting it will reassign those slots to "${FALLBACK_CATEGORY_NAME}".`
                  : `This category is not used by any routine slots. It will just be removed.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteCategoryAction}
              className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
            >
              Delete Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
