import type { SupabaseClient } from "@supabase/supabase-js";
import type { Subject, SubjectBreakdownEntry, SubjectUsage } from "./subjects-shared";

type DB = SupabaseClient<any, "public", any>;

export async function listSubjects(supabase: DB, userId: string): Promise<Subject[]> {
  const { data, error } = await supabase
    .from("subjects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load subjects: ${error.message}`);
  return (data ?? []) as Subject[];
}

export async function insertSubject(
  supabase: DB,
  userId: string,
  name: string,
  color: string,
): Promise<Subject | null> {
  const { data, error } = await supabase
    .from("subjects")
    .insert({ user_id: userId, name: name.trim(), color })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to create subject: ${error.message}`);
  return (data ?? null) as Subject | null;
}

export async function updateSubjectRow(
  supabase: DB,
  userId: string,
  id: string,
  patch: { name?: string; color?: string },
): Promise<Subject | null> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update["name"] = patch.name.trim();
  if (patch.color !== undefined) update["color"] = patch.color;
  if (Object.keys(update).length === 0) return null;
  const { data, error } = await supabase
    .from("subjects")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to update subject: ${error.message}`);
  return (data ?? null) as Subject | null;
}

export async function countSubjectUsage(supabase: DB, userId: string, id: string): Promise<SubjectUsage> {
  const [dayTasks, routineTasks] = await Promise.all([
    supabase
      .from("day_tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("subject_id", id),
    supabase
      .from("routine_tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("subject_id", id),
  ]);
  if (dayTasks.error) throw new Error(`Failed to check subject usage: ${dayTasks.error.message}`);
  if (routineTasks.error)
    throw new Error(`Failed to check subject usage: ${routineTasks.error.message}`);
  return {
    dayTasks: dayTasks.count ?? 0,
    routineTasks: routineTasks.count ?? 0,
  };
}

export async function deleteSubjectRow(supabase: DB, userId: string, id: string): Promise<void> {
  const { error } = await supabase.from("subjects").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(`Failed to delete subject: ${error.message}`);
}

/**
 * Completed tasks grouped by subject. Only tasks with an actual subject assigned
 * (subject_id NOT NULL and resolving to a subject) are counted — untagged tasks
 * are excluded entirely and no "General" bucket is produced.
 */
export async function getSubjectBreakdown(
  supabase: DB,
  userId: string,
  fromDate: string,
): Promise<SubjectBreakdownEntry[]> {
  const { data, error } = await supabase
    .from("day_tasks")
    .select("id, subject_id, subjects(name, color)")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .gte("task_date", fromDate);
  if (error) throw new Error(`Failed to load subject breakdown: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    subject_id: string | null;
    subjects: { name: string; color: string } | null;
  }>;

  const map = new Map<string, SubjectBreakdownEntry>();

  for (const r of rows) {
    // Skip untagged tasks (no subject_id) and any rows that fail to join a subject.
    if (!r.subject_id || !r.subjects) continue;
    const entry = map.get(r.subject_id) ?? {
      subjectId: r.subject_id,
      name: r.subjects.name,
      color: r.subjects.color,
      count: 0,
    };
    entry.count += 1;
    map.set(r.subject_id, entry);
  }

  return [...map.values()].sort((a, b) => b.count - a.count);
}
