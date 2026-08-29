import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { getSubjects } from "@/lib/subjects.functions";
import { subjectColorHex, type Subject } from "@/lib/subjects-shared";

/** Shared subjects fetch — same query key/logic as the Tasks & Routines forms. */
export function useSubjects() {
  const fetchSubjectsFn = useServerFn(getSubjects);
  const { data } = useQuery({
    queryKey: ["subjects"],
    queryFn: () => fetchSubjectsFn({ data: undefined } as any) as Promise<{ subjects: Subject[] }>,
  });
  const subjects = data?.subjects ?? [];
  const subjectsMap = useMemo(() => {
    const map = new Map<string, Subject>();
    for (const s of subjects) map.set(s.id, s);
    return map;
  }, [data]);
  return { subjects, subjectsMap };
}

/** Optional subject dropdown, identical behaviour to the Tasks/Routines forms. */
export function SubjectSelect({
  value,
  onChange,
  subjects,
  className = "",
  id,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  subjects: Subject[];
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label="Subject (optional)"
      className={`rounded-lg border border-border bg-secondary/50 px-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
    >
      <option value="">No subject</option>
      {subjects.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

/** Colored dot + name badge shown next to a task. */
export function SubjectTag({ subject }: { subject: Subject | undefined | null }) {
  if (!subject) return null;
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: subjectColorHex(subject.color) }}
      />
      <span className="max-w-[100px] truncate">{subject.name}</span>
    </span>
  );
}
