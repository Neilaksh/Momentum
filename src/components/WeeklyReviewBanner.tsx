import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CalendarRange, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getReviewPromptStatus, markReviewSeen } from "@/lib/weekly-review.functions";
import type { ReviewPromptStatus } from "@/lib/weekly-review-shared";
import { WeeklyReviewDialog } from "@/components/WeeklyReviewDialog";

export function WeeklyReviewBanner() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getReviewPromptStatus);
  const markSeenFn = useServerFn(markReviewSeen);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["review-prompt"],
    queryFn: () => fetchStatus({ data: undefined }) as Promise<{ status: ReviewPromptStatus }>,
  });

  const status = data?.status;

  const markSeen = useMutation({
    mutationFn: (weekStart: string) => markSeenFn({ data: { weekStart } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["review-prompt"] }),
  });

  if (!status?.shouldShow) return null;

  const confirm = () => {
    markSeen.mutate(status.weekStart);
    setOpen(true);
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4">
        <div className="flex items-center gap-3">
          <CalendarRange className="h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold">Your weekly review is ready</p>
            <p className="text-xs text-muted-foreground">
              See how last week went — completions, XP, streak and habits.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => markSeen.mutate(status.weekStart)} className="gap-1.5">
            <X className="h-4 w-4" />
            Not now
          </Button>
          <Button size="sm" onClick={confirm}>
            View review
          </Button>
        </div>
      </div>

      {status && (
        <WeeklyReviewDialog weekStart={status.weekStart} open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}
