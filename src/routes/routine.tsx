import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addRoutineTask, deleteRoutineTask, getRoutine } from "@/lib/tracker.functions";
import { WEEKDAY_NAMES, type RoutineTask } from "@/lib/tracker-shared";

export const Route = createFileRoute("/routine")({
  head: () => ({
    meta: [
      { title: "Weekly Routine — Momentum" },
      {
        name: "description",
        content:
          "Define the recurring tasks for each weekday once and let Momentum drop them into every new week automatically.",
      },
      { property: "og:title", content: "Weekly Routine — Momentum" },
      {
        property: "og:description",
        content: "Build the recurring template that powers your weekly tracker.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <RoutinePage />
    </RequireAuth>
  ),
});

function RoutinePage() {
  const fetchRoutine = useServerFn(getRoutine);
  const addFn = useServerFn(addRoutineTask);
  const delFn = useServerFn(deleteRoutineTask);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["routine"],
    queryFn: () => fetchRoutine({ data: undefined }) as Promise<{ tasks: RoutineTask[] }>,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["routine"] });
    void qc.invalidateQueries({ queryKey: ["week"] });
  };

  const add = useMutation({
    mutationFn: (v: { weekday: number; title: string }) => addFn({ data: v }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (v: { id: string }) => delFn({ data: v }),
    onSuccess: invalidate,
  });

  const tasks = data?.tasks ?? [];

  return (
    <AppShell>
      <h1 className="text-3xl font-semibold tracking-tight">Weekly routine</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        These tasks repeat every week. Changes appear on weeks you haven't opened yet — already
        ticked history stays untouched.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {WEEKDAY_NAMES.map((name, weekday) => (
          <WeekdayColumn
            key={name}
            name={name}
            tasks={tasks.filter((t) => t.weekday === weekday)}
            onAdd={(title) => add.mutate({ weekday, title })}
            onDelete={(id) => remove.mutate({ id })}
          />
        ))}
      </div>
    </AppShell>
  );
}

function WeekdayColumn({
  name,
  tasks,
  onAdd,
  onDelete,
}: {
  name: string;
  tasks: RoutineTask[];
  onAdd: (title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <article className="flex flex-col rounded-2xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold tracking-tight">{name}</h2>
      <p className="num text-xs text-muted-foreground">{tasks.length} recurring</p>
      <ul className="mt-4 flex-1 space-y-1">
        {tasks.length === 0 && <li className="text-xs text-muted-foreground">Nothing scheduled.</li>}
        {tasks.map((t) => (
          <li
            key={t.id}
            className="group flex items-start gap-2 rounded-lg px-1 py-1 text-sm hover:bg-secondary/60"
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span className="flex-1 leading-snug">{t.title}</span>
            <button
              onClick={() => onDelete(t.id)}
              aria-label={`Delete ${t.title}`}
              className="opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onAdd(draft.trim());
          setDraft("");
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add recurring task"
          className="h-8 text-sm"
        />
        <Button type="submit" size="icon" variant="secondary" className="h-8 w-8 shrink-0" aria-label="Add">
          <Plus className="h-4 w-4" />
        </Button>
      </form>
    </article>
  );
}
