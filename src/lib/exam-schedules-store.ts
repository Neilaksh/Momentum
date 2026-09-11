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

function warn(context: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[exam-schedules] ${context}: ${message}`, err);
}

// ---------------------------------------------------------------------------
// Shared two-way sync with Supabase.
//
// Four components mount useExamSchedules() on the dashboard alone (glance bar,
// manage dialog, dashboard route, subjects route), so the sync runs once per
// page load at module level and broadcasts its result through localStorage +
// the custom event. Without sharing, concurrent instances race: each pushes
// the same local-only rows (duplicated inserts) and overwrites the others.
//
// The previous design was local-first and pull-only: exams created on one
// device never reached another because nothing pushed local-only rows upward
// and every remote error was swallowed silently. The sync now both pulls
// (merging remote over local by id) and pushes (uploading local-only rows),
// so schedules converge across devices, including the Android PWA.
// ---------------------------------------------------------------------------

let sharedSync: Promise<void> | null = null;
// Ids known to exist remotely (pushed in this session or raced by another
// device/tab), so one row is never inserted twice within a page session.
const pushedIds = new Set<string>();

async function fetchRemote(): Promise<{ userId: string; remote: ExamSchedule[] } | null> {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) {
      warn("auth.getUser failed", userError);
      return null;
    }
    const userId = userData?.user?.id;
    if (!userId) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("exam_schedules")
      .select("*")
      .eq("user_id", userId)
      .order("exam_date", { ascending: true });

    if (error) {
      warn("remote pull failed", error);
      return null;
    }
    return { userId, remote: Array.isArray(data) ? (data as ExamSchedule[]) : [] };
  } catch (err) {
    warn("remote pull threw", err);
    return null;
  }
}

function mergeExams(local: ExamSchedule[], remote: ExamSchedule[]): ExamSchedule[] {
  const mergedMap = new Map<string, ExamSchedule>();
  for (const item of local) mergedMap.set(item.id, item);
  // Remote wins for shared ids: it reflects the latest saves from every device.
  for (const item of remote) mergedMap.set(item.id, item);
  return Array.from(mergedMap.values()).sort((a, b) => a.exam_date.localeCompare(b.exam_date));
}

function signatureOf(list: ExamSchedule[]): string {
  return list
    .map((e) => `${e.id}:${e.updated_at}`)
    .sort()
    .join("|");
}

async function runSync(): Promise<void> {
  const local = loadFromLocalStorage();
  const fetched = await fetchRemote();
  if (!fetched) return;
  const { userId, remote } = fetched;

  // Push local-only rows upward (one attempt per id per page session).
  const remoteIds = new Set(remote.map((r) => r.id));
  const pushedRows: ExamSchedule[] = [];
  for (const item of local) {
    if (remoteIds.has(item.id) || pushedIds.has(item.id)) continue;
    const row: ExamSchedule = { ...item, user_id: userId };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("exam_schedules").insert(row);
      if (error) {
        // 23505 = duplicate key: another device already pushed this row.
        if (error.code === "23505") {
          pushedIds.add(item.id);
        } else {
          warn("remote push failed", error);
        }
        continue;
      }
      pushedIds.add(item.id);
      pushedRows.push(row);
    } catch (err) {
      warn("remote push threw", err);
    }
  }

  const merged = mergeExams(local, [...remote, ...pushedRows]);
  // Persist (and broadcast) only when something actually changed, so an idle
  // re-sync does not re-render every listener.
  if (signatureOf(merged) !== signatureOf(local)) saveToLocalStorage(merged);
}

// Deduped entry point: concurrent requests (multiple hook mounts, window
// focus, network recovery) share one in-flight run instead of racing.
function requestExamSync(): Promise<void> {
  if (!sharedSync) {
    sharedSync = runSync().finally(() => {
      sharedSync = null;
    });
  }
  return sharedSync;
}

export function useExamSchedules() {
  const [exams, setExams] = useState<ExamSchedule[]>(loadFromLocalStorage);
  const [isLoading, setIsLoading] = useState(false);

  // Sync state across components and browser tabs
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

    // Initial pull + push, then re-sync when the app regains focus or the
    // network returns, so a resumed PWA picks up other-device saves without
    // a full reload.
    setIsLoading(true);
    let cancelled = false;
    requestExamSync()
      .catch((err) => warn("sync failed", err))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    const onRegain = () => {
      void requestExamSync();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onRegain();
    };

    window.addEventListener("focus", onRegain);
    window.addEventListener("online", onRegain);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener(EVENT_NAME, handleUpdate);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", onRegain);
      window.removeEventListener("online", onRegain);
      document.removeEventListener("visibilitychange", onVisibility);
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
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        warn("auth.getUser failed", userError);
      } else if (userData?.user?.id) {
        newExam.user_id = userData.user.id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).from("exam_schedules").insert(newExam);
        if (error) {
          warn("remote push failed", error);
        } else {
          pushedIds.add(newExam.id);
        }
      }
    } catch (err) {
      warn("remote push threw", err);
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
              subject_id:
                input.subject_id !== undefined
                  ? (input.subject_id ?? null)
                  : (e.subject_id ?? null),
              title: input.title !== undefined ? input.title.trim() : e.title,
              exam_date: input.exam_date !== undefined ? input.exam_date : e.exam_date,
              start_time:
                input.start_time !== undefined
                  ? input.start_time?.trim() || null
                  : (e.start_time ?? null),
              end_time:
                input.end_time !== undefined
                  ? input.end_time?.trim() || null
                  : (e.end_time ?? null),
              location:
                input.location !== undefined
                  ? input.location?.trim() || null
                  : (e.location ?? null),
              notes: input.notes !== undefined ? input.notes?.trim() || null : (e.notes ?? null),
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
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
        if (error) warn("remote update failed", error);
      }
    } catch (err) {
      warn("remote update threw", err);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("exam_schedules").delete().eq("id", id);
      if (error) warn("remote delete failed", error);
    } catch (err) {
      warn("remote delete threw", err);
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
