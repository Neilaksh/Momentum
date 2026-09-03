import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo, useEffect } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  BookOpen,
  Check,
  Palette,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  checkSubjectUsage,
  createSubject,
  deleteSubject,
  getSubjects,
  updateSubject,
} from "@/lib/subjects.functions";
import { SUBJECT_COLORS, subjectColorHex, type Subject } from "@/lib/subjects-shared";
import { getWeek } from "@/lib/tracker.functions";
import { startOfWeek, toISODate, type WeekData } from "@/lib/tracker-shared";

export const Route = createFileRoute("/subjects")({
  head: () => ({
    meta: [
      { title: "Manage Subjects — Momentum" },
      {
        name: "description",
        content: "Create and manage subjects to organize your tasks, each with its own color.",
      },
      { property: "og:title", content: "Manage Subjects — Momentum" },
      {
        property: "og:description",
        content: "Group your tasks and routines under color-coded subjects.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <SubjectsPage />
    </RequireAuth>
  ),
});

function SubjectActivityMiniChart({
  subjectId,
  days,
  colorHex,
}: {
  subjectId: string;
  days: Array<{ date: string; tasks: any[] }>;
  colorHex: string;
}) {
  const dayStats = days.map((d) => {
    const matching = d.tasks.filter((t) => t.subject_id === subjectId);
    const done = matching.filter((t) => t.completed_at).length;
    const total = matching.length;
    return { date: d.date, done, total };
  });

  const maxTotal = Math.max(1, ...dayStats.map((d) => d.total));
  const totalDone = dayStats.reduce((a, b) => a + b.done, 0);
  const totalTasks = dayStats.reduce((a, b) => a + b.total, 0);

  return (
    <div className="mt-3.5 pt-3 border-t border-border/50 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">This Week:</span>
        <span className="text-xs font-semibold text-foreground">
          {totalDone} / {totalTasks} tasks done
        </span>
      </div>

      {/* 7-day mini bars */}
      <div className="flex items-end gap-1.5 h-6">
        {dayStats.map((d, i) => {
          const dayName = ["M", "T", "W", "T", "F", "S", "S"][i];
          const heightPct = d.total > 0 ? Math.max(25, Math.round((d.done / maxTotal) * 100)) : 15;
          return (
            <div key={d.date} className="flex flex-col items-center gap-0.5" title={`${d.done}/${d.total} tasks done`}>
              <div className="w-2.5 h-4 bg-secondary/80 rounded-xs flex items-end overflow-hidden">
                <div
                  className="w-full transition-all rounded-xs"
                  style={{
                    height: `${heightPct}%`,
                    backgroundColor: d.done > 0 ? colorHex : d.total > 0 ? "rgba(255,255,255,0.2)" : "transparent",
                  }}
                />
              </div>
              <span className="text-[9px] text-muted-foreground">{dayName}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubjectsPage() {
  const fetchSubjectsFn = useServerFn(getSubjects);
  const fetchWeek = useServerFn(getWeek);
  const createFn = useServerFn(createSubject);
  const updateFn = useServerFn(updateSubject);
  const deleteFn = useServerFn(deleteSubject);
  const checkUsageFn = useServerFn(checkSubjectUsage);
  const qc = useQueryClient();

  const weekStart = toISODate(startOfWeek(new Date()));

  const {
    data,
    isLoading,
    isError,
    error: listError,
    refetch,
  } = useQuery({
    queryKey: ["subjects"],
    queryFn: () => fetchSubjectsFn({ data: undefined }) as Promise<{ subjects: Subject[] }>,
  });

  // Fetch week so we can pass profile to AppShell and render mini-activity charts
  const { data: weekData } = useQuery({
    queryKey: ["week", weekStart],
    queryFn: () => fetchWeek({ data: { weekStart } }) as Promise<WeekData>,
  });

  const subjects = data?.subjects ?? [];

  const [archivedIds, setArchivedIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("momentum_archived_subjects");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [filterMode, setFilterMode] = useState<"all" | "active" | "archived">("all");

  const toggleArchive = (id: string) => {
    setArchivedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem("momentum_archived_subjects", JSON.stringify(next));
      } catch {}
      toast.success(next.includes(id) ? "Subject archived" : "Subject restored to active");
      return next;
    });
  };

  const filteredSubjects = useMemo(() => {
    if (filterMode === "active") return subjects.filter((s) => !archivedIds.includes(s.id));
    if (filterMode === "archived") return subjects.filter((s) => archivedIds.includes(s.id));
    return subjects;
  }, [subjects, archivedIds, filterMode]);

  const usedColors = useMemo(() => new Set(subjects.map((s) => s.color)), [subjects]);
  const nextUnusedColor = useMemo(() => {
    const unused = SUBJECT_COLORS.find((c) => !usedColors.has(c.key));
    return unused ? unused.key : SUBJECT_COLORS[0].key;
  }, [usedColors]);

  // Create form state
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(SUBJECT_COLORS[0].key);

  useEffect(() => {
    if (nextUnusedColor && !name) {
      setColor(nextUnusedColor);
    }
  }, [nextUnusedColor, name]);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>("lime");

  // Delete flow state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [blockedDelete, setBlockedDelete] = useState<{
    id: string;
    name: string;
    dayTasks: number;
    routineTasks: number;
  } | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["subjects"] });
    void qc.invalidateQueries({ queryKey: ["week"] });
    void qc.invalidateQueries({ queryKey: ["routines"] });
  };

  const create = useMutation({
    mutationFn: (v: { name: string; color: string }) => createFn({ data: v }),
    onSuccess: (res) => {
      if (!res?.subject) {
        toast.error("Couldn't create subject — the server returned no row.");
        return;
      }
      setName("");
      setColor(nextUnusedColor);
      invalidate();
      toast.success("Subject created!");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't create subject."),
  });

  const update = useMutation({
    mutationFn: (v: { id: string; name: string; color: string }) => updateFn({ data: v }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
      toast.success("Subject updated!");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't update subject."),
  });

  const remove = useMutation({
    mutationFn: (v: { id: string }) => deleteFn({ data: v }),
    onSuccess: () => {
      setConfirmDeleteId(null);
      setBlockedDelete(null);
      invalidate();
      toast.info("Subject deleted");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't delete subject."),
  });

  /** Check usage first: block deletion when tasks reference this subject. */
  async function requestDelete(subject: Subject) {
    try {
      const res = (await checkUsageFn({ data: { id: subject.id } })) as {
        usage: { dayTasks: number; routineTasks: number };
      };
      const { dayTasks, routineTasks } = res.usage;
      if (dayTasks > 0 || routineTasks > 0) {
        setConfirmDeleteId(null);
        setBlockedDelete({ id: subject.id, name: subject.name, dayTasks, routineTasks });
        toast.error("Can't delete — this subject is still linked to tasks.");
        return;
      }
      setBlockedDelete(null);
      setConfirmDeleteId(subject.id);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't check subject usage. Try again.",
      );
    }
  }

  return (
    <AppShell profile={weekData?.profile ?? null}>
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Manage Subjects</h1>
        <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary">
          {subjects.length} subject{subjects.length !== 1 ? "s" : ""}
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Subjects are color-coded buckets you can attach to tasks and routines to keep related work
        together.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* New Subject Form */}
        <form
          className="h-fit space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create.mutate({ name: name.trim(), color });
          }}
        >
          <h2 className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">
            Create New Subject
          </h2>
          <div className="space-y-2">
            <Label htmlFor="subject-name">Subject Name *</Label>
            <Input
              id="subject-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mathematics"
              required
            />
          </div>
          <ColorPicker
            value={color}
            onChange={setColor}
            usedColors={usedColors}
            hint="Tasks with this subject show a dot in this color."
          />
          <Button
            type="submit"
            className="w-full gap-2"
            disabled={create.isPending || !name.trim()}
          >
            {create.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create Subject
          </Button>
        </form>

        {/* Subjects List */}
        <div className="min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1 text-xs">
              <button
                onClick={() => setFilterMode("all")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  filterMode === "all"
                    ? "bg-card font-semibold text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({subjects.length})
              </button>
              <button
                onClick={() => setFilterMode("active")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  filterMode === "active"
                    ? "bg-card font-semibold text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Active ({subjects.filter((s) => !archivedIds.includes(s.id)).length})
              </button>
              <button
                onClick={() => setFilterMode("archived")}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  filterMode === "archived"
                    ? "bg-card font-semibold text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Archived ({subjects.filter((s) => archivedIds.includes(s.id)).length})
              </button>
            </div>
          </div>

          {isLoading && <p className="text-sm text-muted-foreground">Loading subjects…</p>}

          {isError && !isLoading && (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-8 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
              <p className="mt-3 text-sm font-medium text-destructive">
                Couldn&apos;t load your subjects.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {listError instanceof Error
                  ? listError.message
                  : "Something went wrong. Please try again."}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 gap-2"
                onClick={() => void refetch()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !isError && filteredSubjects.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center">
              <BookOpen className="mx-auto h-10 w-10 text-muted-foreground opacity-40" />
              <p className="mt-3 text-sm font-medium">
                {filterMode === "archived" ? "No archived subjects." : "No subjects found."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {filterMode === "archived"
                  ? "Archived subjects will appear here."
                  : "Create your first subject using the form on the left."}
              </p>
            </div>
          )}

          {filteredSubjects.map((s) => {
            const isEditing = editingId === s.id;
            const isBlocked = blockedDelete?.id === s.id;
            const isConfirming = confirmDeleteId === s.id;
            const isArchived = archivedIds.includes(s.id);

            if (isEditing) {
              return (
                <div
                  key={s.id}
                  className="space-y-4 rounded-2xl border border-primary/40 bg-card p-5 shadow-sm"
                >
                  <h3 className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">
                    Edit Subject
                  </h3>
                  <div className="space-y-2">
                    <Label htmlFor={`edit-name-${s.id}`}>Subject Name</Label>
                    <Input
                      id={`edit-name-${s.id}`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g. Mathematics"
                    />
                  </div>
                  <ColorPicker value={editColor} onChange={setEditColor} />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      className="flex-1 gap-2"
                      disabled={update.isPending || !editName.trim()}
                      onClick={() => update.mutate({ id: s.id, name: editName.trim(), color: editColor })}
                    >
                      {update.isPending ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      Save Changes
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <article
                key={s.id}
                className={`rounded-2xl border p-5 shadow-sm transition-all ${
                  isBlocked
                    ? "border-destructive/50 bg-destructive/5"
                    : isArchived
                      ? "border-border/60 bg-card/60 opacity-80"
                      : "border-border bg-card"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-white/10"
                    style={{ background: subjectColorHex(s.color) }}
                  />
                  <h3 className="flex-1 truncate font-semibold tracking-tight">
                    {s.name}
                    {isArchived && (
                      <span className="ml-2 rounded-full bg-secondary/80 border border-border/80 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Archived
                      </span>
                    )}
                  </h3>

                  {/* Quick Shortcut: Log a task under this subject */}
                  {!isArchived && (
                    <Link
                      to="/"
                      search={{ subjectId: s.id }}
                      className="flex items-center gap-1 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                      title={`Log a new task under ${s.name}`}
                    >
                      <Plus className="h-3 w-3" /> Log Task
                    </Link>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(s.id);
                      setEditName(s.name);
                      setEditColor(s.color);
                      setBlockedDelete(null);
                    }}
                    className="rounded-lg bg-secondary/50 px-3.5 py-2.5 -mx-1 -my-1 md:px-3 md:py-1.5 md:mx-0 md:my-0 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleArchive(s.id)}
                    title={isArchived ? "Restore subject to active" : "Archive subject"}
                    aria-label={isArchived ? "Restore subject" : "Archive subject"}
                    className="p-3 -m-2 md:p-1 md:m-0 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {isArchived ? (
                      <ArchiveRestore className="h-4 w-4 text-primary" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                  </button>

                  {isConfirming ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-medium text-destructive">Delete?</span>
                      <button
                        type="button"
                        onClick={() => remove.mutate({ id: s.id })}
                        className="rounded-md bg-destructive px-3 py-2 -mx-1 -my-1 md:px-2 md:py-0.5 md:mx-0 md:my-0 text-[11px] font-semibold text-white transition-colors hover:bg-destructive/90"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-md bg-secondary px-3 py-2 -mx-1 -my-1 md:px-2 md:py-0.5 md:mx-0 md:my-0 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void requestDelete(s)}
                      aria-label={`Delete ${s.name}`}
                      className="p-3 -m-2 md:p-1 md:m-0 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* 7-day mini activity chart */}
                <SubjectActivityMiniChart
                  subjectId={s.id}
                  days={weekData?.days ?? []}
                  colorHex={subjectColorHex(s.color)}
                />

                {isBlocked && blockedDelete && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                    <p className="text-destructive">
                      <strong>Deletion blocked.</strong> &ldquo;{blockedDelete.name}&rdquo; is still
                      linked to {blockedDelete.dayTasks} day task
                      {blockedDelete.dayTasks !== 1 ? "s" : ""} and {blockedDelete.routineTasks}{" "}
                      routine task{blockedDelete.routineTasks !== 1 ? "s" : ""}. Unlink them first,
                      then try deleting again.
                    </p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function ColorPicker({
  value,
  onChange,
  usedColors,
  hint,
}: {
  value: string;
  onChange: (c: string) => void;
  usedColors?: Set<string>;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Color</Label>
        {usedColors && (
          <span className="text-[10px] text-muted-foreground">
            {SUBJECT_COLORS.filter((c) => !usedColors.has(c.key)).length} free colors available
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {SUBJECT_COLORS.map((c) => {
          const isUsed = usedColors?.has(c.key);
          const isSelected = value === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-label={`Pick ${c.label}${isUsed ? " (in use)" : ""}`}
              title={`${c.label}${isUsed ? " (in use by another subject)" : " (available)"}`}
              aria-pressed={isSelected}
              onClick={() => onChange(c.key)}
              className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 p-1.5 -m-1.5 md:p-0 md:m-0 transition-all ${
                isSelected
                  ? "scale-110 border-foreground shadow-sm"
                  : "border-transparent hover:scale-105"
              }`}
              style={{ background: c.hex }}
            >
              {isSelected && <Check className="h-4 w-4 text-black/70" />}
              {isUsed && !isSelected && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-background ring-1 ring-border" />
              )}
            </button>
          );
        })}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}