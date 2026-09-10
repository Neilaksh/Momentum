import { useState, useEffect, useCallback } from "react";
import type {
  ExamSchedule,
  CreateExamScheduleInput,
  UpdateExamScheduleInput,
} from "./exam-schedules-shared";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "momentum_exam_schedules";
const EVENT_NAME = "momentum_exam_schedules_updated";

function loadFromLocalStorage(): ExamSchedule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToLocalStorage(exams: ExamSchedule[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exams));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: exams }));
  } catch (err) {
    console.error("Failed to save exam schedules to localStorage", err);
  }
}

let hasWarnedMissingTable = false;

function mergeExamsById(local: ExamSchedule[], remote: ExamSchedule[]): ExamSchedule[] {
  const mergedMap = new Map<string, ExamSchedule>();
  for (const item of local) mergedMap.set(item.id, item);
  for (const item of remote) mergedMap.set(item.id, item);
  return Array.from(mergedMap.values()).sort(
    (a, b) =>
      a.exam_date.localeCompare(b.exam_date) ||
      (a.start_time ?? "").localeCompare(b.start_time ?? ""),
  );
}

/**
 * Pulls the current user's exam schedules from Supabase.
 * Returns the remote rows, or `null` when the table isn't available yet
 * (migration not applied) or the query fails.
 */
async function fetchRemoteExams(userId: string): Promise<ExamSchedule[] | null> {
  try {
    const { data, error } = await (supabase as any)
      .from("exam_schedules")
      .select("*")
      .eq("user_id", userId)
      .order("exam_date", { ascending: true });

    if (error) {
      const code = (error as { code?: string })?.code;
      const message = (error as { message?: string })?.message ?? String(error);
      const tableMissing =
        code === "PGRST205" ||
        code === "42P01" ||
        /could not find the table|does not exist/i.test(message);
      if (tableMissing) {
        if (!hasWarnedMissingTable) {
          hasWarnedMissingTable = true;
          console.warn(
            "[exam-schedules] The 'exam_schedules' table does not exist in Supabase yet — running local-only. " +
              "Apply supabase/migrations/20260910000000_add_exam_schedules.sql to enable cloud sync across devices.",
          );
        }
      } else {
        console.warn("[exam-schedules] Supabase sync query failed", message);
      }
      return null;
    }

    return Array.isArray(data) ? (data as ExamSchedule[]) : null;
  } catch {
    return null;
  }
}

export function useExamSchedules() {
  const [exams, setExams] = useState<ExamSchedule[]>(loadFromLocalStorage);
  const [isLoading, setIsLoading] = useState(false);

  // Keep state in sync across components, tabs and the Capacitor WebView.
  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<ExamSchedule[]>;
      if (customEvent.detail) {
        setExams(customEvent.detail);
      } else {
        setExams(loadFromLocalStorage());
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setExams(loadFromLocalStorage());
      }
    };

    window.addEventListener(EVENT_NAME, handleUpdate);
    window.addEventListener("storage", handleStorage);

    // Initial load from storage to ensure consistency
    setExams(loadFromLocalStorage());

    return () => {
      window.removeEventListener(EVENT_NAME, handleUpdate);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // Cloud sync: pull remote exams into localStorage whenever the user is signed
  // in. Re-runs on auth changes and when the app regains focus, so a freshly
  // installed Android app (empty WebView localStorage) picks up exams that were
  // saved from the web app or another device.
  useEffect(() => {
    let isMounted = true;

    const runSync = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData?.session?.user?.id;
        if (!userId) return;

        const remote = await fetchRemoteExams(userId);
        if (!isMounted || remote === null) return;

        const merged = mergeExamsById(loadFromLocalStorage(), remote);
        setExams(merged);
        saveToLocalStorage(merged);
      } catch {
        // Network / auth hiccup - local storage remains the source of truth.
      }
    };

    void runSync();

    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      void runSync();
    });
    const unlisten = authListener.subscription.unsubscribe.bind(authListener.subscription);

    const handleVisible = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    const handleFocus = () => void runSync();
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleFocus);

    return () => {
      isMounted = false;
      unlisten();
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const createExam = useCallback(async (input: CreateExamScheduleInput): Promise<ExamSchedule> => {
    const now = new Date().toISOString();
    const newExam: ExamSchedule = {
      id: crypto.randomUUID(),
      subject_id: input.subject_id || null,
      title: input.title.trim(),
      exam_date: input.exam_date,
      start_time: input.start_time?.trim() || null,
      end_time: input.end_time?.trim() || null,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      created_at: now,
      updated_at: now,
    };

    setExams((prev) => {
      const next = [...prev, newExam].sort((a, b) => a.exam_date.localeCompare(b.exam_date));
      saveToLocalStorage(next);
      return next;
    });

    // Best-effort remote push
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user?.id) {
        newExam.user_id = userData.user.id;
        await (supabase as any).from("exam_schedules").insert(newExam);
      }
    } catch {
      // Ignored if remote table not yet migrated
    }

    return newExam;
  }, []);

  const updateExam = useCallback(async (input: UpdateExamScheduleInput): Promise<ExamSchedule> => {
    const now = new Date().toISOString();
    let updated: ExamSchedule | null = null;

    setExams((prev) => {
      const next: ExamSchedule[] = prev
        .map((e) => {
          if (e.id === input.id) {
            const item: ExamSchedule = {
              id: e.id,
              user_id: e.user_id,
              subject_id: input.subject_id !== undefined ? (input.subject_id ?? null) : (e.subject_id ?? null),
              title: input.title !== undefined ? input.title.trim() : e.title,
              exam_date: input.exam_date !== undefined ? input.exam_date : e.exam_date,
              start_time: input.start_time !== undefined ? (input.start_time?.trim() || null) : (e.start_time ?? null),
              end_time: input.end_time !== undefined ? (input.end_time?.trim() || null) : (e.end_time ?? null),
              location: input.location !== undefined ? (input.location?.trim() || null) : (e.location ?? null),
              notes: input.notes !== undefined ? (input.notes?.trim() || null) : (e.notes ?? null),
              created_at: e.created_at,
              updated_at: now,
            };
            updated = item;
            return item;
          }
          return e;
        })
        .sort((a, b) => a.exam_date.localeCompare(b.exam_date));

      saveToLocalStorage(next);
      return next;
    });

    // Best-effort remote update
    try {
      if (updated) {
        await (supabase as any)
          .from("exam_schedules")
          .update({
            subject_id: (updated as ExamSchedule).subject_id,
            title: (updated as ExamSchedule).title,
            exam_date: (updated as ExamSchedule).exam_date,
            start_time: (updated as ExamSchedule).start_time,
            end_time: (updated as ExamSchedule).end_time,
            location: (updated as ExamSchedule).location,
            notes: (updated as ExamSchedule).notes,
            updated_at: now,
          })
          .eq("id", input.id);
      }
    } catch {
      // Ignored
    }

    return updated!;
  }, []);

  const deleteExam = useCallback(async (id: string): Promise<void> => {
    setExams((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveToLocalStorage(next);
      return next;
    });

    // Best-effort remote delete
    try {
      await (supabase as any).from("exam_schedules").delete().eq("id", id);
    } catch {
      // Ignored
    }
  }, []);

  return {
    exams,
    isLoading,
    createExam,
    updateExam,
    deleteExam,
  };
}
