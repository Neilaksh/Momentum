import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Coffee,
  FileText,
  Hourglass,
  Maximize2,
  Minimize2,
  Play,
  Settings2,
  SkipForward,
  Square,
  Timer,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  getActiveStudySession,
  startStudySession,
  stopStudySession,
} from "@/lib/study-sessions.functions";
import {
  isSessionActive,
  STUDY_SESSION_MODES,
  type StudySession,
  type StudySessionMode,
} from "@/lib/study-sessions-shared";
import { subjectColorHex } from "@/lib/subjects-shared";
import {
  advancePomodoro,
  formatClock,
  isBreakPhase,
  pomodoroCyclePosition,
  pomodoroPhaseLabel,
  pomodoroPhaseSeconds,
  type PomodoroPhase,
} from "@/lib/pomodoro-shared";
import { playPhaseChime, usePomodoro } from "@/lib/pomodoro-store";

import { useSubjects } from "@/components/SubjectSelect";
import { PomodoroSettingsDialog } from "@/components/PomodoroSettingsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Preset target lengths, in minutes, for the timed modes. */
const POMODORO_PRESETS = [15, 25, 45, 50];
const COUNTDOWN_PRESETS = [15, 30, 45, 60];

/** The presets offered for a mode (stopwatch has no target to preset). */
function durationPresetsFor(mode: StudySessionMode): number[] {
  return mode === "countdown" ? COUNTDOWN_PRESETS : POMODORO_PRESETS;
}

/** Default focus/countdown length when a mode is (re)selected. */
const DEFAULT_DURATION_MINUTES: Record<"pomodoro" | "countdown", number> = {
  pomodoro: 25,
  countdown: 30,
};

/** Bounds for the custom duration input - 1 minute up to 12 hours. */
const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 720;

/** The default target length for a mode (stopwatch has no target). */
function defaultDurationFor(mode: StudySessionMode): number {
  return mode === "countdown"
    ? DEFAULT_DURATION_MINUTES.countdown
    : DEFAULT_DURATION_MINUTES.pomodoro;
}

/**
 * Coerce a typed duration into a usable target: blank/unparsable input falls back
 * to the caller default and out-of-range values clamp to the allowed 1-720 minute
 * window, so the timer can never start with a 0s target.
 */
function clampDurationMinutes(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, Math.round(value)));
}

function formatDurationHuman(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

/** The line under the clock: what the current phase is doing. */
function phaseHint(phase: PomodoroPhase, isCounting: boolean): string {
  if (phase === "focus") {
    return isCounting ? "Focus block in progress." : "Ready for a focus block.";
  }
  return isCounting
    ? `${pomodoroPhaseLabel(phase)} in progress - rest time is not counted.`
    : `${pomodoroPhaseLabel(phase)} is ready to start.`;
}
export function StudyTimer() {
  const queryClient = useQueryClient();

  const getActiveFn = useServerFn(getActiveStudySession);
  const startFn = useServerFn(startStudySession);
  const stopFn = useServerFn(stopStudySession);

  // Shared subjects fetch (same query key/logic as the Tasks & Routines forms).
  const { subjects } = useSubjects();

  // Pomodoro cycle settings and position, cached per device (see pomodoro-store).
  const { settings, updateSettings, resetSettings, cycle, updateCycle, resetCycle } = usePomodoro();

  const [mode, setMode] = useState<StudySessionMode>("pomodoro");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("none");
  // Raw text of the duration input so it can be cleared and retyped freely;
  // durationMinutes is its clamped, always-usable reading.
  const [durationInput, setDurationInput] = useState<string>(
    String(DEFAULT_DURATION_MINUTES.pomodoro),
  );
  const [notes, setNotes] = useState<string>("");
  const [now, setNow] = useState<number>(() => Date.now());
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [userMinimized, setUserMinimized] = useState<boolean>(false);
  const [isNotesOpen, setIsNotesOpen] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // The 1s ticker re-renders constantly, so each automatic transition is guarded
  // to fire exactly once per phase.
  const hasCompletedFocusRef = useRef<boolean>(false);
  const hasCompletedBreakRef = useRef<boolean>(false);

  const { data: activeData, isLoading: isSessionLoading } = useQuery({
    queryKey: ["active-study-session"],
    queryFn: async () => {
      const res = await getActiveFn();
      return (res?.session ?? null) as StudySession | null;
    },
    refetchInterval: (query) => (query.state.data ? 5000 : false),
  });

  const activeSession = activeData ?? null;
  const isRunning = isSessionActive(activeSession);
  const activeMode = activeSession?.mode ?? mode;
  const isPomodoro = activeMode === "pomodoro";
  // A running session is always a focus block: breaks are client-side only, so the
  // stored session stays the source of truth while one is open.
  const isBreak = isPomodoro && !isRunning && isBreakPhase(cycle.phase);
  const isBreakCounting = isBreak && cycle.phaseEndsAt !== null;
  const breakSeconds = isBreak ? pomodoroPhaseSeconds(cycle.phase, settings) : 0;
  // Full block length while a break waits to be started, countdown while running.
  const breakRemaining = cycle.phaseEndsAt
    ? Math.max(0, Math.ceil((cycle.phaseEndsAt - now) / 1000))
    : breakSeconds;

  // Tick while a focus block runs or a break counts down.
  useEffect(() => {
    if (!isRunning && !isBreakCounting) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isRunning, isBreakCounting]);

  const durationMinutes = clampDurationMinutes(
    Number.parseInt(durationInput, 10),
    defaultDurationFor(mode),
  );
  const parsedDurationInput = Number.parseInt(durationInput, 10);
  const isDurationClamped =
    Number.isFinite(parsedDurationInput) && parsedDurationInput !== durationMinutes;

  /** Keep the target length sensible for the mode being switched to. */
  const selectMode = (next: StudySessionMode) => {
    if (next === mode) return;
    setMode(next);
    if (next === "stopwatch") return;
    setDurationInput(String(DEFAULT_DURATION_MINUTES[next]));
  };

  const startMutation = useMutation({
    mutationFn: async () => {
      // A pomodoro runs for the configured focus block, a countdown for the custom
      // target, and a stopwatch stays open-ended.
      const targetSeconds =
        mode === "stopwatch"
          ? null
          : (mode === "pomodoro" ? settings.focusMinutes : durationMinutes) * 60;

      return startFn({
        data: {
          mode,
          subjectId: selectedSubjectId === "none" ? null : selectedSubjectId,
          targetSeconds,
        },
      });
    },
    onSuccess: ({ session }) => {
      queryClient.setQueryData(["active-study-session"], session);
      // Invalidate so the Subjects tab refetches and shows "Studying now" immediately.
      queryClient.invalidateQueries({ queryKey: ["active-study-session"] });
      hasCompletedFocusRef.current = false;
      setUserMinimized(false);
      // Starting a focus block clears any pending or running break.
      if (mode === "pomodoro") updateCycle({ phase: "focus", phaseEndsAt: null });
      toast.success(mode === "pomodoro" ? "Pomodoro started!" : "Study session started!");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to start study session");
    },
  });

  const stopMutation = useMutation({
    mutationFn: async (variables: { auto: boolean }) => {
      const res = await stopFn({
        data: {
          sessionId: activeSession?.id ?? null,
          notes: notes.trim() ? notes.trim() : null,
        },
      });
      return { session: res.session, auto: variables.auto };
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["active-study-session"], null);
      setNotes("");
      setIsNotesOpen(false);
      setUserMinimized(false);
      hasCompletedFocusRef.current = false;
      const duration = result.session?.duration_seconds ?? 0;

      if (result.auto) {
        // The block ran its full length: count the pomodoro and hand over to the
        // break it earned.
        const advanced = advancePomodoro("focus", cycle.completedFocus, settings);
        const breakLength = pomodoroPhaseSeconds(advanced.phase, settings);
        hasCompletedBreakRef.current = false;
        updateCycle({
          phase: advanced.phase,
          completedFocus: advanced.completedFocus,
          phaseEndsAt: settings.autoStartBreaks ? Date.now() + breakLength * 1000 : null,
        });
        toast.success(
          `Pomodoro ${advanced.completedFocus} done! ${pomodoroPhaseLabel(advanced.phase)} is ${Math.round(breakLength / 60)} min`,
          { icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" /> },
        );
        if (settings.soundEnabled) playPhaseChime();
      } else {
        // Stopped by hand: the block was cut short, so it is not counted and the
        // cycle position stays where it is.
        if (isPomodoro) updateCycle({ phase: "focus", phaseEndsAt: null });
        toast.success(`Session saved! (${formatDurationHuman(duration)})`, {
          icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["active-study-session"] });
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
      queryClient.invalidateQueries({ queryKey: ["history"] });
      // The Subjects tab marks a subject from this week's finished sessions.
      queryClient.invalidateQueries({ queryKey: ["study-week"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to stop study session");
    },
  });

  let elapsedSeconds = 0;
  if (isRunning && activeSession) {
    const startedMs = new Date(activeSession.started_at).getTime();
    elapsedSeconds = Math.max(0, Math.floor((now - startedMs) / 1000));
  }

  const focusTargetSeconds = settings.focusMinutes * 60;
  // While idle this previews the target the current configuration would use.
  const previewTargetSeconds =
    mode === "stopwatch" ? null : mode === "pomodoro" ? focusTargetSeconds : durationMinutes * 60;
  const activeTargetSeconds = activeSession?.target_seconds ?? previewTargetSeconds;

  let displaySeconds = elapsedSeconds;
  let progressPercent = 0;
  let isOvertime = false;

  if (isBreak) {
    displaySeconds = breakRemaining;
    progressPercent = breakSeconds
      ? Math.min(100, Math.max(0, ((breakSeconds - breakRemaining) / breakSeconds) * 100))
      : 0;
  } else if (activeMode === "stopwatch") {
    displaySeconds = elapsedSeconds;
    progressPercent = 100;
  } else if (activeMode === "pomodoro" || activeMode === "countdown") {
    const remaining = (activeTargetSeconds ?? 0) - elapsedSeconds;
    if (remaining >= 0) {
      displaySeconds = remaining;
      progressPercent = activeTargetSeconds
        ? Math.min(100, Math.max(0, (elapsedSeconds / activeTargetSeconds) * 100))
        : 0;
    } else {
      // A pomodoro block stops itself at the target; only the countdown mode
      // keeps running into overtime.
      displaySeconds = Math.abs(remaining);
      isOvertime = true;
      progressPercent = 100;
    }
  }

  const activeSubject = useMemo(() => {
    const sId = isRunning ? activeSession?.subject_id : selectedSubjectId;
    if (!sId || sId === "none") return null;
    return subjects.find((s) => s.id === sId) ?? null;
  }, [isRunning, activeSession?.subject_id, selectedSubjectId, subjects]);

  // A finished focus block saves its session, so the stored duration is the
  // server-derived elapsed time rather than the countdown position.
  useEffect(() => {
    if (!isRunning || !isPomodoro || !activeTargetSeconds) return;
    if (elapsedSeconds < activeTargetSeconds) return;
    if (hasCompletedFocusRef.current) return;
    hasCompletedFocusRef.current = true;
    stopMutation.mutate({ auto: true });
  }, [isRunning, isPomodoro, activeTargetSeconds, elapsedSeconds, stopMutation]);

  // A finished break only moves the cycle on: there is nothing to save.
  useEffect(() => {
    if (!isBreak || !cycle.phaseEndsAt) return;
    if (now < cycle.phaseEndsAt) return;
    if (hasCompletedBreakRef.current) return;
    hasCompletedBreakRef.current = true;

    const nextPomodoro = pomodoroCyclePosition(cycle.completedFocus, settings);
    updateCycle({ phase: "focus", phaseEndsAt: null });
    toast.success(`Break over! Ready for pomodoro ${nextPomodoro}`);
    if (settings.soundEnabled) playPhaseChime();
    if (settings.autoStartFocus && !isRunning) startMutation.mutate();
  }, [
    isBreak,
    cycle.phaseEndsAt,
    cycle.completedFocus,
    now,
    settings,
    isRunning,
    updateCycle,
    startMutation,
  ]);

  // Keep a glanceable countdown in the tab title while a phase runs.
  useEffect(() => {
    if (typeof document === "undefined" || !isPomodoro) return;
    const isCounting = isBreakCounting || (isRunning && !!activeTargetSeconds);
    if (!isCounting) return;
    const previousTitle = document.title;
    const remaining = isBreakCounting
      ? breakRemaining
      : Math.max(0, (activeTargetSeconds ?? 0) - elapsedSeconds);
    const label = isBreak ? pomodoroPhaseLabel(cycle.phase) : "Focus";
    document.title = `${formatClock(remaining)} - ${label}`;
    return () => {
      document.title = previousTitle;
    };
  }, [
    isPomodoro,
    isBreakCounting,
    isBreak,
    isRunning,
    activeTargetSeconds,
    elapsedSeconds,
    breakRemaining,
    cycle.phase,
  ]);

  const startBreak = useCallback(() => {
    hasCompletedBreakRef.current = false;
    setUserMinimized(false);
    const length = pomodoroPhaseSeconds(cycle.phase, settings);
    updateCycle({ phaseEndsAt: Date.now() + length * 1000 });
  }, [cycle.phase, settings, updateCycle]);

  const skipBreak = useCallback(() => {
    if (!isBreakPhase(cycle.phase)) return;
    const skipped = cycle.phase;
    hasCompletedBreakRef.current = false;
    updateCycle({ phase: "focus", phaseEndsAt: null });
    toast.info(
      `${pomodoroPhaseLabel(skipped)} skipped - ready for pomodoro ${pomodoroCyclePosition(cycle.completedFocus, settings)}`,
    );
  }, [cycle.phase, cycle.completedFocus, settings, updateCycle]);

  // Focus view is automatically active whenever a session is running or in break,
  // unless the user explicitly tapped the "Back" button to return to the standard overview.
  const isFocusViewActive = (isRunning || isBreak) && !userMinimized;

  // Request a Screen Wake Lock while the focus view is active so mobile screens
  // stay awake while propped up on a desk in landscape mode.
  useEffect(() => {
    if (!isFocusViewActive || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }
    let sentinel: { release: () => Promise<void> } | null = null;
    let cancelled = false;

    const requestLock = async () => {
      try {
        if (!cancelled && "wakeLock" in navigator) {
          sentinel = await (navigator as any).wakeLock.request("screen");
        }
      } catch {
        // Silently ignored if unsupported, low battery, or denied
      }
    };

    void requestLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isFocusViewActive && !cancelled) {
        void requestLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (sentinel) {
        sentinel.release().catch(() => {});
      }
    };
  }, [isFocusViewActive]);

  // Lock background scroll when the full focus view is mounted.
  useEffect(() => {
    if (!isFocusViewActive || typeof document === "undefined") return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [isFocusViewActive]);

  // Sync fullscreen state with document
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        // Silently ignored
      }
    } else {
      try {
        await document.exitFullscreen();
      } catch {
        // Silently ignored
      }
    }
  }, []);

  if (isSessionLoading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-border bg-card">
        <p className="text-sm text-muted-foreground animate-pulse">Loading study session...</p>
      </div>
    );
  }

  const pomodoroPosition = pomodoroCyclePosition(cycle.completedFocus, settings);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-10 text-center shadow-xs">
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          {(isRunning || isBreak) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setUserMinimized(false)}
              className="h-7 gap-1.5 rounded-full border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20 hover:text-primary transition-all"
            >
              <Maximize2 className="h-3 w-3" />
              Focus view
            </Button>
          )}

          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {activeMode === "pomodoro" && <Timer className="h-3.5 w-3.5" />}
            {activeMode === "stopwatch" && <Play className="h-3.5 w-3.5" />}
            {activeMode === "countdown" && <Hourglass className="h-3.5 w-3.5" />}
            {activeMode}
          </span>

          {isPomodoro && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              {isBreak ? <Coffee className="h-3.5 w-3.5" /> : <Timer className="h-3.5 w-3.5" />}
              {isBreak
                ? pomodoroPhaseLabel(cycle.phase)
                : `Pomodoro ${pomodoroPosition} of ${settings.longBreakAfter}`}
            </span>
          )}

          {activeSubject && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              style={{
                backgroundColor: `${subjectColorHex(activeSubject.color)}20`,
                color: subjectColorHex(activeSubject.color),
                borderColor: `${subjectColorHex(activeSubject.color)}40`,
                borderWidth: 1,
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: subjectColorHex(activeSubject.color) }}
              />
              {activeSubject.name}
            </span>
          )}

          {isOvertime && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-500">
              <AlertCircle className="h-3 w-3" />
              Overtime
            </span>
          )}
        </div>

        <div className="my-6">
          <div className="font-mono text-6xl sm:text-8xl font-bold tracking-tight text-foreground select-none">
            {formatClock(displaySeconds)}
          </div>
          {isOvertime && (
            <p className="mt-2 text-xs font-medium text-amber-500">
              Target completed! Extra study time is being tracked.
            </p>
          )}
          {isPomodoro && (
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {phaseHint(cycle.phase, isBreakCounting || isRunning)}
            </p>
          )}
        </div>

        {(isBreak || activeMode === "pomodoro" || activeMode === "countdown") && (
          <div className="mx-auto my-6 max-w-md">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full transition-all duration-500 ease-out ${
                  isOvertime ? "bg-amber-500" : isBreak ? "bg-emerald-500" : "bg-primary"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground font-mono">
              {isBreak ? (
                <>
                  <span>{formatDurationHuman(Math.max(0, breakSeconds - breakRemaining))}</span>
                  <span>{formatDurationHuman(breakSeconds)}</span>
                </>
              ) : (
                <>
                  <span>{formatDurationHuman(elapsedSeconds)}</span>
                  <span>{formatDurationHuman(activeTargetSeconds ?? 0)}</span>
                </>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          {isRunning ? (
            <Button
              size="lg"
              variant="destructive"
              className="h-12 px-8 text-base font-semibold gap-2 shadow-sm"
              onClick={() => stopMutation.mutate({ auto: false })}
              disabled={stopMutation.isPending}
            >
              <Square className="h-5 w-5 fill-current" />
              {stopMutation.isPending ? "Saving..." : "Stop & Save"}
            </Button>
          ) : isBreak ? (
            <>
              {!isBreakCounting && (
                <Button
                  size="lg"
                  className="h-12 px-8 text-base font-semibold gap-2 shadow-sm"
                  onClick={startBreak}
                >
                  <Coffee className="h-5 w-5" />
                  Start {pomodoroPhaseLabel(cycle.phase).toLowerCase()}
                </Button>
              )}
              <Button
                size="lg"
                variant="outline"
                className="h-12 px-8 text-base font-semibold gap-2 shadow-sm"
                onClick={skipBreak}
              >
                <SkipForward className="h-5 w-5" />
                {isBreakCounting ? "Skip break" : "Skip to focus"}
              </Button>
            </>
          ) : (
            <Button
              size="lg"
              className="h-12 px-8 text-base font-semibold gap-2 shadow-sm"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
            >
              <Play className="h-5 w-5 fill-current" />
              {startMutation.isPending
                ? "Starting..."
                : isPomodoro
                  ? `Start pomodoro ${pomodoroPosition}`
                  : "Start Session"}
            </Button>
          )}
        </div>
      </div>

      {isRunning && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <Label htmlFor="session-notes" className="text-sm font-medium">
            Session Notes (optional)
          </Label>
          <Textarea
            id="session-notes"
            placeholder="What are you working on or what did you accomplish?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="max-w-2xl resize-none"
          />
          <p className="text-xs text-muted-foreground">
            Notes will be saved to your session when you stop the timer.
          </p>
        </div>
      )}

      {!isRunning && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-6">
          <h2 className="text-base font-semibold">Session Configuration</h2>

          {/* Two columns once there is room: the mode/duration controls keep a
              comfortable fixed width instead of stretching thin, and the subject
              picker uses the ExamScheduleDialog form-row pattern. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10">
            <div className="space-y-6">
              <div className="w-full max-w-md space-y-2">
                <Label className="text-sm">Mode</Label>
                <div className="grid grid-cols-3 gap-2">
                  {STUDY_SESSION_MODES.map((m) => {
                    const isSelected = mode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => selectMode(m)}
                        className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10 text-primary font-medium shadow-xs"
                            : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        }`}
                      >
                        {m === "pomodoro" && <Timer className="h-5 w-5 mb-1" />}
                        {m === "stopwatch" && <Play className="h-5 w-5 mb-1" />}
                        {m === "countdown" && <Hourglass className="h-5 w-5 mb-1" />}
                        <span className="text-xs capitalize">{m}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {mode === "pomodoro" ? (
                <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Timer className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Pomodoro cycle</span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setIsSettingsOpen(true)}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Adjust
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {settings.focusMinutes} min focus, {settings.shortBreakMinutes} min break, and a{" "}
                    {settings.longBreakMinutes} min long break every {settings.longBreakAfter}{" "}
                    pomodoros.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Breaks run on this device and are never saved to your study history
                    {settings.autoStartBreaks ? " - breaks start on their own" : ""}
                    {settings.autoStartFocus ? ", and so does the next pomodoro." : "."}
                  </p>
                </div>
              ) : mode === "countdown" ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="study-duration" className="text-sm">
                      Target Duration
                    </Label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {durationPresetsFor(mode).map((minutes) => (
                      <Button
                        key={minutes}
                        type="button"
                        variant={durationMinutes === minutes ? "default" : "outline"}
                        size="sm"
                        onClick={() => setDurationInput(String(minutes))}
                      >
                        {minutes}m
                      </Button>
                    ))}
                    <Input
                      id="study-duration"
                      type="number"
                      inputMode="numeric"
                      enterKeyHint="done"
                      min={MIN_DURATION_MINUTES}
                      max={MAX_DURATION_MINUTES}
                      value={durationInput}
                      onChange={(e) => setDurationInput(e.target.value)}
                      placeholder="Custom"
                      className="h-8 w-24"
                    />
                    <span className="text-xs text-muted-foreground">min</span>
                  </div>
                  {isDurationClamped && (
                    <p className="text-xs text-amber-500">
                      Custom duration clamped to {durationMinutes} min ({MIN_DURATION_MINUTES}-
                      {MAX_DURATION_MINUTES} min allowed).
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            {/* Subject picker - ExamScheduleDialog form-row pattern. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:max-w-2xl">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="study-subject" className="text-sm">
                  Subject (optional)
                </Label>
                <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId}>
                  <SelectTrigger id="study-subject" className="w-full">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: subjectColorHex(s.color) }}
                          />
                          {s.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      )}

      <PomodoroSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        settings={settings}
        onChange={updateSettings}
        onResetSettings={resetSettings}
        onResetCycle={resetCycle}
      />

      {/* Immersive landscape focus view: automatically hides everything else when running */}
      {isFocusViewActive && (
        <div className="fixed inset-0 z-50 flex flex-col justify-between bg-background text-foreground select-none overflow-hidden pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
          {/* Top bar: Back button on left, Status badges in center, Tools on right */}
          <div className="flex items-center justify-between gap-2 shrink-0 h-10 px-2 sm:px-4">
            {/* Small return button */}
            <button
              type="button"
              onClick={() => setUserMinimized(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-secondary/80 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-95 shadow-xs cursor-pointer"
              title="Return to standard view"
              aria-label="Return to standard view"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Back</span>
            </button>

            {/* Badges / Subject / Phase */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 max-w-[70%] truncate">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/60 px-2.5 py-0.5 text-[11px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {activeMode === "pomodoro" && <Timer className="h-3 w-3 sm:h-3.5 sm:w-3.5" />}
                {activeMode === "stopwatch" && <Play className="h-3 w-3 sm:h-3.5 sm:w-3.5" />}
                {activeMode === "countdown" && <Hourglass className="h-3 w-3 sm:h-3.5 sm:w-3.5" />}
                {activeMode}
              </span>

              {isPomodoro && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/60 px-2.5 py-0.5 text-[11px] sm:text-xs font-medium text-muted-foreground">
                  {isBreak ? <Coffee className="h-3 w-3" /> : <Timer className="h-3 w-3" />}
                  {isBreak
                    ? pomodoroPhaseLabel(cycle.phase)
                    : `Pomo ${pomodoroPosition}/${settings.longBreakAfter}`}
                </span>
              )}

              {activeSubject && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] sm:text-xs font-medium truncate max-w-[140px] sm:max-w-[200px]"
                  style={{
                    backgroundColor: `${subjectColorHex(activeSubject.color)}20`,
                    color: subjectColorHex(activeSubject.color),
                    borderColor: `${subjectColorHex(activeSubject.color)}40`,
                    borderWidth: 1,
                  }}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: subjectColorHex(activeSubject.color) }}
                  />
                  <span className="truncate">{activeSubject.name}</span>
                </span>
              )}

              {isOvertime && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] sm:text-xs font-semibold text-amber-500">
                  <AlertCircle className="h-3 w-3" />
                  Overtime
                </span>
              )}
            </div>

            {/* Right controls: Notes & Fullscreen */}
            <div className="flex items-center gap-1.5">
              {isRunning && (
                <button
                  type="button"
                  onClick={() => setIsNotesOpen(true)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                    notes.trim()
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/80 bg-secondary/80 text-muted-foreground hover:text-foreground"
                  }`}
                  title="Session notes"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">{notes.trim() ? "Note added" : "Notes"}</span>
                </button>
              )}

              <button
                type="button"
                onClick={toggleFullscreen}
                className="inline-flex items-center justify-center rounded-full border border-border/80 bg-secondary/80 p-1.5 text-muted-foreground hover:text-foreground transition-all shadow-xs cursor-pointer"
                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Center hero clock */}
          <div className="flex flex-1 flex-col items-center justify-center min-h-0 py-2 sm:py-4 my-auto">
            <div className="font-mono text-7xl sm:text-8xl md:text-9xl lg:text-[10rem] landscape:text-7xl landscape:sm:text-8xl landscape:md:text-[9rem] font-bold tracking-tight text-foreground select-none leading-none tabular-nums drop-shadow-sm">
              {formatClock(displaySeconds)}
            </div>

            {/* Progress bar for Pomodoro & Countdown */}
            {(isBreak || activeMode === "pomodoro" || activeMode === "countdown") && (
              <div className="w-full max-w-sm sm:max-w-md md:max-w-lg landscape:max-w-md mt-4 sm:mt-6 px-4">
                <div className="h-2 sm:h-2.5 w-full overflow-hidden rounded-full bg-secondary/80">
                  <div
                    className={`h-full transition-all duration-500 ease-out ${
                      isOvertime ? "bg-amber-500" : isBreak ? "bg-emerald-500" : "bg-primary"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] sm:text-xs text-muted-foreground font-mono">
                  {isBreak ? (
                    <>
                      <span>{formatDurationHuman(Math.max(0, breakSeconds - breakRemaining))}</span>
                      <span>{formatDurationHuman(breakSeconds)}</span>
                    </>
                  ) : (
                    <>
                      <span>{formatDurationHuman(elapsedSeconds)}</span>
                      <span>{formatDurationHuman(activeTargetSeconds ?? 0)}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Phase hint or overtime note */}
            {isOvertime ? (
              <p className="mt-2 text-xs font-medium text-amber-500">
                Target completed! Extra study time is being tracked.
              </p>
            ) : isPomodoro ? (
              <p className="mt-2 text-xs font-medium text-muted-foreground">
                {phaseHint(cycle.phase, isBreakCounting || isRunning)}
              </p>
            ) : null}
          </div>

          {/* Bottom controls */}
          <div className="flex items-center justify-center gap-3 shrink-0 pb-1 sm:pb-3">
            {isRunning ? (
              <Button
                size="lg"
                variant="destructive"
                className="h-11 sm:h-12 px-8 text-sm sm:text-base font-semibold gap-2 shadow-lg active:scale-98 transition-transform"
                onClick={() => stopMutation.mutate({ auto: false })}
                disabled={stopMutation.isPending}
              >
                <Square className="h-4 w-4 sm:h-5 sm:w-5 fill-current" />
                {stopMutation.isPending ? "Saving..." : "Stop & Save"}
              </Button>
            ) : isBreak ? (
              <>
                {!isBreakCounting && (
                  <Button
                    size="lg"
                    className="h-11 sm:h-12 px-6 sm:px-8 text-sm sm:text-base font-semibold gap-2 shadow-lg"
                    onClick={startBreak}
                  >
                    <Coffee className="h-4 w-4 sm:h-5 sm:w-5" />
                    Start {pomodoroPhaseLabel(cycle.phase).toLowerCase()}
                  </Button>
                )}
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 sm:h-12 px-6 sm:px-8 text-sm sm:text-base font-semibold gap-2 shadow-lg"
                  onClick={skipBreak}
                >
                  <SkipForward className="h-4 w-4 sm:h-5 sm:w-5" />
                  {isBreakCounting ? "Skip break" : "Skip to focus"}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Session Notes Dialog in Focus Mode */}
      <Dialog open={isNotesOpen} onOpenChange={setIsNotesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Session Notes</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              placeholder="What are you working on or what did you accomplish?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="resize-none"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Notes will be saved to your session when you stop the timer.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsNotesOpen(false)} size="sm">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
