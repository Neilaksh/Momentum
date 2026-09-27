import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Hourglass, Play, Square, Timer } from "lucide-react";

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
import { getGoals } from "@/lib/tracker.functions";
import type { Goal } from "@/lib/tracker-shared";

import { useSubjects } from "@/components/SubjectSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_POMODORO_SECONDS = 25 * 60;
const DEFAULT_COUNTDOWN_SECONDS = 30 * 60;

const COUNTDOWN_PRESETS = [
  { label: "15m", seconds: 15 * 60 },
  { label: "30m", seconds: 30 * 60 },
  { label: "45m", seconds: 45 * 60 },
  { label: "60m", seconds: 60 * 60 },
];

/**
 * Only the goals list is needed for the tag picker, so this mirrors goals.tsx's
 * GoalsResponse narrowed to the field we read.
 */
type GoalsPickerResponse = { goals: Goal[] };

function formatTime(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${mm}:${ss}`;
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

export function StudyTimer() {
  const queryClient = useQueryClient();

  const getActiveFn = useServerFn(getActiveStudySession);
  const startFn = useServerFn(startStudySession);
  const stopFn = useServerFn(stopStudySession);
  const getGoalsFn = useServerFn(getGoals);

  // Shared subjects fetch (same query key/logic as the Tasks & Routines forms).
  const { subjects } = useSubjects();

  const [mode, setMode] = useState<StudySessionMode>("pomodoro");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("none");
  const [selectedGoalId, setSelectedGoalId] = useState<string>("none");
  const [countdownTarget, setCountdownTarget] = useState<number>(DEFAULT_COUNTDOWN_SECONDS);
  const [notes, setNotes] = useState<string>("");
  const [now, setNow] = useState<number>(() => Date.now());

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

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Goal picker — shares the ["goals"] cache with the Goals page.
  const { data: goalsData } = useQuery({
    queryKey: ["goals"],
    queryFn: () => getGoalsFn({ data: undefined }) as Promise<GoalsPickerResponse>,
  });

  const activeGoals = useMemo(() => {
    return (goalsData?.goals ?? []).filter((g) => g.status === "active");
  }, [goalsData]);

  const startMutation = useMutation({
    mutationFn: async () => {
      let targetSeconds: number | null = null;
      if (mode === "pomodoro") targetSeconds = DEFAULT_POMODORO_SECONDS;
      if (mode === "countdown") targetSeconds = countdownTarget;

      const res = await startFn({
        data: {
          mode,
          subjectId: selectedSubjectId === "none" ? null : selectedSubjectId,
          goalId: selectedGoalId === "none" ? null : selectedGoalId,
          targetSeconds,
        },
      });
      return res.session;
    },
    onSuccess: (session) => {
      queryClient.setQueryData(["active-study-session"], session);
      toast.success("Study session started!");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to start study session");
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await stopFn({
        data: {
          sessionId: activeSession?.id ?? null,
          notes: notes.trim() ? notes.trim() : null,
        },
      });
      return res.session;
    },
    onSuccess: (stoppedSession) => {
      queryClient.setQueryData(["active-study-session"], null);
      setNotes("");
      const duration = stoppedSession?.duration_seconds ?? 0;
      toast.success(`Session saved! (${formatDurationHuman(duration)})`, {
        icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
      });
      queryClient.invalidateQueries({ queryKey: ["week"] });
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to stop study session");
    },
  });

  const activeMode = activeSession?.mode ?? mode;
  const activeTargetSeconds =
    activeSession?.target_seconds ??
    (mode === "pomodoro" ? DEFAULT_POMODORO_SECONDS : countdownTarget);

  let elapsedSeconds = 0;
  if (isRunning && activeSession) {
    const startedMs = new Date(activeSession.started_at).getTime();
    elapsedSeconds = Math.max(0, Math.floor((now - startedMs) / 1000));
  }

  let displaySeconds = elapsedSeconds;
  let progressPercent = 0;
  let isOvertime = false;

  if (activeMode === "stopwatch") {
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

  const activeGoal = useMemo(() => {
    const gId = isRunning ? activeSession?.goal_id : selectedGoalId;
    if (!gId || gId === "none") return null;
    return (goalsData?.goals ?? []).find((g) => g.id === gId) ?? null;
  }, [isRunning, activeSession?.goal_id, selectedGoalId, goalsData]);

  if (isSessionLoading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-border bg-card">
        <p className="text-sm text-muted-foreground animate-pulse">Loading study session...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-10 text-center shadow-xs">
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {activeMode === "pomodoro" && <Timer className="h-3.5 w-3.5" />}
            {activeMode === "stopwatch" && <Play className="h-3.5 w-3.5" />}
            {activeMode === "countdown" && <Hourglass className="h-3.5 w-3.5" />}
            {activeMode}
          </span>

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

          {activeGoal && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              🎯 {activeGoal.title}
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
            {formatTime(displaySeconds)}
          </div>
          {isOvertime && (
            <p className="mt-2 text-xs font-medium text-amber-500">
              Target completed! Extra study time is being tracked.
            </p>
          )}
        </div>

        {(activeMode === "pomodoro" || activeMode === "countdown") && (
          <div className="mx-auto my-6 max-w-md">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full transition-all duration-500 ease-out ${
                  isOvertime ? "bg-amber-500" : "bg-primary"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground font-mono">
              <span>{formatDurationHuman(elapsedSeconds)}</span>
              <span>{formatDurationHuman(activeTargetSeconds ?? 0)}</span>
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          {!isRunning ? (
            <Button
              size="lg"
              className="h-12 px-8 text-base font-semibold gap-2 shadow-sm"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
            >
              <Play className="h-5 w-5 fill-current" />
              {startMutation.isPending ? "Starting..." : "Start Session"}
            </Button>
          ) : (
            <Button
              size="lg"
              variant="destructive"
              className="h-12 px-8 text-base font-semibold gap-2 shadow-sm"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
            >
              <Square className="h-5 w-5 fill-current" />
              {stopMutation.isPending ? "Saving..." : "Stop & Save"}
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
            Notes will be saved to your session when you click &quot;Stop & Save&quot;.
          </p>
        </div>
      )}

      {!isRunning && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-6">
          <h2 className="text-base font-semibold">Session Configuration</h2>

          {/* Two columns once there is room: the mode/duration controls keep a
              comfortable fixed width instead of stretching thin, and the two
              pickers use ExamScheduleDialog's form-row pattern. */}
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
                        onClick={() => setMode(m)}
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

              {mode === "countdown" && (
                <div className="space-y-2">
                  <Label className="text-sm">Target Duration</Label>
                  <div className="flex flex-wrap gap-2">
                    {COUNTDOWN_PRESETS.map((p) => {
                      const isSelected = countdownTarget === p.seconds;
                      return (
                        <Button
                          key={p.seconds}
                          type="button"
                          variant={isSelected ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCountdownTarget(p.seconds)}
                        >
                          {p.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Subject / goal pickers — ExamScheduleDialog's grid-cols-1
              sm:grid-cols-2 form-row pattern. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:max-w-2xl">
              <div className="space-y-2">
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

              <div className="space-y-2">
                <Label htmlFor="study-goal" className="text-sm">
                  Goal (optional)
                </Label>
                <Select value={selectedGoalId} onValueChange={setSelectedGoalId}>
                  <SelectTrigger id="study-goal" className="w-full">
                    <SelectValue placeholder="Select goal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {activeGoals.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        🎯 {g.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
