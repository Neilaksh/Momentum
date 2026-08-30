import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDayDate } from "@/lib/tracker-shared";
import { WeeklyReviewView } from "@/components/WeeklyReviewView";

export function WeeklyReviewDialog({
  weekStart,
  open,
  onOpenChange,
}: {
  weekStart: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {weekStart ? (
          <>
            <DialogHeader>
              <DialogTitle>Weekly Review</DialogTitle>
              <DialogDescription>
                Week of {formatDayDate(weekStart)} – your past week at a glance.
              </DialogDescription>
            </DialogHeader>
            <WeeklyReviewView weekStart={weekStart} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
