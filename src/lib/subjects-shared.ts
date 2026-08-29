export type Subject = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

/** Small preset palette for subject colors. */
export const SUBJECT_COLORS = [
  { key: "lime", label: "Lime", hex: "#a3e635" },
  { key: "sky", label: "Sky", hex: "#38bdf8" },
  { key: "rose", label: "Rose", hex: "#fb7185" },
  { key: "amber", label: "Amber", hex: "#fbbf24" },
  { key: "violet", label: "Violet", hex: "#a78bfa" },
  { key: "teal", label: "Teal", hex: "#2dd4bf" },
] as const;

export type SubjectColorKey = (typeof SUBJECT_COLORS)[number]["key"];

export function subjectColorHex(color: string): string {
  const found = SUBJECT_COLORS.find((c) => c.key === color);
  return found?.hex ?? SUBJECT_COLORS[0]!.hex;
}

export type SubjectUsage = {
  dayTasks: number;
  routineTasks: number;
};

export type SubjectBreakdownEntry = {
  subjectId: string | null;
  name: string;
  color: string;
  count: number;
};