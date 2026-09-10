import { useState, useMemo } from "react";
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  FileText,
  Plus,
  Pencil,
  Trash2,
  AlertCircle,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import type { Subject } from "@/lib/subjects-shared";
import { subjectColorHex } from "@/lib/subjects-shared";
import {
  type ExamSchedule,
  formatExamTime,
  getDaysUntilExam,
  hasExamPassed,
} from "@/lib/exam-schedules-shared";
import { useExamSchedules } from "@/lib/exam-schedules-store";
import { toISODate, formatDayDate } from "@/lib/tracker-shared";

interface ExamScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: Subject[];
  initialSubjectId?: string | null;
  initialMode?: "list" | "create";
}

export function ExamScheduleDialog({
  open,
  onOpenChange,
  subjects,
  initialSubjectId,
  initialMode = "list",
}: ExamScheduleDialogProps) {
  const { exams, createExam, updateExam, deleteExam } = useExamSchedules();

  const [view, setView] = useState<"list" | "form">(
    initialMode === "create" ? "form" : "list",
  );
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"all" | "upcoming" | "past">("upcoming");

  // Form State
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState<string>(initialSubjectId || "none");
  const [examDate, setExamDate] = useState<string>(toISODate(new Date()));
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Subject lookup map
  const subjectsMap = useMemo(() => {
    const map = new Map<string, Subject>();
    for (const s of subjects) map.set(s.id, s);
    return map;
  }, [subjects]);

  // Reset form
  const resetForm = (subjId?: string | null) => {
    setEditingExamId(null);
    setTitle("");
    setSubjectId(subjId || initialSubjectId || "none");
    setExamDate(toISODate(new Date()));
    setStartTime("");
    setEndTime("");
    setLocation("");
    setNotes("");
  };

  const handleOpenCreate = (subjId?: string | null) => {
    resetForm(subjId);
    setView("form");
  };

  const handleStartEdit = (exam: ExamSchedule) => {
    setEditingExamId(exam.id);
    setTitle(exam.title);
    setSubjectId(exam.subject_id || "none");
    setExamDate(exam.exam_date);
    setStartTime(exam.start_time || "");
    setEndTime(exam.end_time || "");
    setLocation(exam.location || "");
    setNotes(exam.notes || "");
    setView("form");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please enter an exam title");
      return;
    }
    if (!examDate) {
      toast.error("Please select an exam date");
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedSubject = subjectId === "none" ? null : subjectId;
      if (editingExamId) {
        await updateExam({
          id: editingExamId,
          title: title.trim(),
          subject_id: selectedSubject,
          exam_date: examDate,
          start_time: startTime.trim() || null,
          end_time: endTime.trim() || null,
          location: location.trim() || null,
          notes: notes.trim() || null,
        });
        toast.success("Exam schedule updated!");
      } else {
        await createExam({
          title: title.trim(),
          subject_id: selectedSubject,
          exam_date: examDate,
          start_time: startTime.trim() || null,
          end_time: endTime.trim() || null,
          location: location.trim() || null,
          notes: notes.trim() || null,
        });
        toast.success("Exam scheduled successfully!");
      }
      resetForm();
      setView("list");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save exam schedule");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteExam(id);
      setDeleteConfirmId(null);
      toast.info("Exam removed from schedule");
    } catch (err) {
      toast.error("Failed to delete exam");
    }
  };

  // Filtered exams
  const filteredExams = useMemo(() => {
    const now = new Date();
    return exams.filter((e) => {
      const passed = hasExamPassed(e, now);
      if (filterMode === "upcoming") return !passed;
      if (filterMode === "past") return passed;
      return true;
    });
  }, [exams, filterMode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-6 sm:p-7">
        <DialogHeader className="border-b border-border/60 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <GraduationCap className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight">
                  Exam Schedule
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Manage exam timetables linked to subjects. Displays in your Tasks dashboard without cluttering your daily task list.
                </DialogDescription>
              </div>
            </div>

            {view === "list" && (
              <Button
                size="sm"
                onClick={() => handleOpenCreate()}
                className="gap-1.5 text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" /> Schedule Exam
              </Button>
            )}
          </div>
        </DialogHeader>

        {view === "form" ? (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="flex items-center justify-between pb-1">
              <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                {editingExamId ? "Edit Exam Schedule" : "Add New Exam"}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetForm();
                  setView("list");
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Back to Schedule
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="exam-title" className="text-xs font-medium">
                  Exam Title *
                </Label>
                <Input
                  id="exam-title"
                  placeholder="e.g. Midterm Examination, Calculus Final, Paper 1"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exam-subject" className="text-xs font-medium">
                  Subject
                </Label>
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger id="exam-subject" className="w-full">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">No specific subject (General)</span>
                    </SelectItem>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: subjectColorHex(s.color) }}
                          />
                          <span>{s.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exam-date" className="text-xs font-medium">
                  Exam Date *
                </Label>
                <Input
                  id="exam-date"
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exam-start-time" className="text-xs font-medium">
                  Start Time (optional)
                </Label>
                <Input
                  id="exam-start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exam-end-time" className="text-xs font-medium">
                  End Time (optional)
                </Label>
                <Input
                  id="exam-end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="exam-location" className="text-xs font-medium">
                  Location / Room (optional)
                </Label>
                <Input
                  id="exam-location"
                  placeholder="e.g. Main Hall Room 204, Online Portal, Lab B"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="exam-notes" className="text-xs font-medium">
                  Topics / Notes / Materials (optional)
                </Label>
                <Textarea
                  id="exam-notes"
                  placeholder="e.g. Modules 1 to 4. Bring scientific calculator, ID card, and blue pen."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-border/60">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  resetForm();
                  setView("list");
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !title.trim() || !examDate}>
                {isSubmitting
                  ? "Saving..."
                  : editingExamId
                    ? "Save Changes"
                    : "Create Exam Schedule"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 pt-1">
            {/* Filter Pills */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1 text-xs">
                <button
                  onClick={() => setFilterMode("upcoming")}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    filterMode === "upcoming"
                      ? "bg-card font-semibold text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Upcoming ({exams.filter((e) => !hasExamPassed(e)).length})
                </button>
                <button
                  onClick={() => setFilterMode("all")}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    filterMode === "all"
                      ? "bg-card font-semibold text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All ({exams.length})
                </button>
                <button
                  onClick={() => setFilterMode("past")}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    filterMode === "past"
                      ? "bg-card font-semibold text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Past ({exams.filter((e) => hasExamPassed(e)).length})
                </button>
              </div>

              <span className="text-xs text-muted-foreground">
                {filteredExams.length} exam{filteredExams.length !== 1 ? "s" : ""}
              </span>
            </div>

            {filteredExams.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center">
                <GraduationCap className="mx-auto h-10 w-10 text-muted-foreground opacity-30" />
                <p className="mt-2.5 text-sm font-semibold">No exams found</p>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                  {filterMode === "upcoming"
                    ? "You don't have any upcoming exams scheduled. Create one to stay ahead of test days."
                    : "No exams recorded in this view."}
                </p>
                <Button
                  size="sm"
                  onClick={() => handleOpenCreate()}
                  className="mt-4 gap-1.5 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" /> Schedule an Exam
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredExams.map((exam) => {
                  const subject = exam.subject_id ? subjectsMap.get(exam.subject_id) : null;
                  const passed = hasExamPassed(exam);
                  const countdown = getDaysUntilExam(exam.exam_date, new Date(), passed);
                  const formattedTime = formatExamTime(exam.start_time, exam.end_time);
                  const isConfirming = deleteConfirmId === exam.id;

                  return (
                    <div
                      key={exam.id}
                      className={`group relative rounded-xl border p-4 transition-all ${
                        countdown.isToday
                          ? "border-primary/60 bg-primary/5 shadow-sm shadow-primary/10 ring-1 ring-primary/40"
                          : countdown.isSoon
                            ? "border-amber-500/40 bg-amber-500/5"
                            : countdown.isPast
                              ? "border-border/60 bg-card/50 opacity-75"
                              : "border-border bg-card hover:border-border/90"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Subject Badge */}
                            {subject ? (
                              <span
                                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                                style={{
                                  backgroundColor: `${subjectColorHex(subject.color)}20`,
                                  color: subjectColorHex(subject.color),
                                  border: `1px solid ${subjectColorHex(subject.color)}40`,
                                }}
                              >
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: subjectColorHex(subject.color) }}
                                />
                                {subject.name}
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                General Exam
                              </span>
                            )}

                            {/* Countdown Badge */}
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                countdown.isToday
                                  ? "bg-primary text-primary-foreground animate-pulse"
                                  : countdown.isTomorrow
                                    ? "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                                    : countdown.isSoon
                                      ? "bg-primary/15 text-primary"
                                      : countdown.isPast
                                        ? "bg-secondary text-muted-foreground"
                                        : "bg-secondary text-foreground"
                              }`}
                            >
                              {countdown.label}
                            </span>
                          </div>

                          <h4 className="text-base font-semibold tracking-tight text-foreground">
                            {exam.title}
                          </h4>

                          {/* Date, Time, Location Meta */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-0.5">
                            <span className="flex items-center gap-1">
                              <CalendarIcon className="h-3.5 w-3.5 text-primary/70" />
                              <strong className="text-foreground/90 font-medium">
                                {formatDayDate(exam.exam_date)}
                              </strong>
                            </span>

                            {formattedTime && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5 text-primary/70" />
                                <span>{formattedTime}</span>
                              </span>
                            )}

                            {exam.location && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5 text-primary/70" />
                                <span>{exam.location}</span>
                              </span>
                            )}
                          </div>

                          {/* Notes/Topics */}
                          {exam.notes && (
                            <div className="mt-2 rounded-lg bg-secondary/30 p-2.5 text-xs text-muted-foreground border border-border/40">
                              <span className="font-semibold text-foreground/80 block mb-0.5">
                                Notes & Topics:
                              </span>
                              <p className="whitespace-pre-line">{exam.notes}</p>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 ml-auto">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(exam)}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            title="Edit exam"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>

                          {isConfirming ? (
                            <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/20 rounded-md p-1">
                              <span className="text-[10px] text-destructive font-medium px-1">
                                Delete?
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDelete(exam.id)}
                                className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-destructive/90"
                              >
                                Yes
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmId(null)}
                                className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(exam.id)}
                              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              title="Delete exam"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
