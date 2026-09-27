import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Timer } from "lucide-react";
import { RequireAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { StudyTimer } from "@/components/StudyTimer";
import { getWeek } from "@/lib/tracker.functions";
import { startOfWeek, toISODate, type WeekData } from "@/lib/tracker-shared";

export const Route = createFileRoute("/study")({
  head: () => ({
    meta: [
      { title: "Study Timer — Momentum" },
      {
        name: "description",
        content:
          "Run a Pomodoro, stopwatch or countdown study session and tag it to a subject or goal.",
      },
      { property: "og:title", content: "Study Timer — Momentum" },
      {
        property: "og:description",
        content: "Track focused study time and keep every session attached to your subjects.",
      },
    ],
  }),
  component: () => (
    <RequireAuth>
      <StudyPage />
    </RequireAuth>
  ),
});

function StudyPage() {
  const fetchWeek = useServerFn(getWeek);
  const weekStart = toISODate(startOfWeek(new Date()));

  // Same query key/shape as the other pages so the week cache is shared.
  const { data: weekData } = useQuery({
    queryKey: ["week", weekStart],
    queryFn: () => fetchWeek({ data: { weekStart } }) as Promise<WeekData>,
  });

  return (
    <AppShell profile={weekData?.profile ?? null}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/15 p-2.5 text-primary">
            <Timer className="h-5 w-5" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Study Timer</h1>
        </div>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Time a focused study block with a Pomodoro, an open stopwatch or a countdown, and tag it to
        a subject or goal so the hours land where they matter.
      </p>

      <div className="mt-6">
        <StudyTimer />
      </div>
    </AppShell>
  );
}
