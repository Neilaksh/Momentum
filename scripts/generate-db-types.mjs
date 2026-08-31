// Regenerates src/integrations/supabase/types.ts from the live database schema.
//
// Schema truth:   supabase/migrations/*.sql — all 12 migrations were verified
//                 applied to the live project (schema audit, 2026-08-31).
// Live check:     before writing, every generated column is probed against the
//                 live PostgREST endpoint (GET /rest/v1/<table>?select=<cols>&limit=1
//                 with the publishable key). HTTP 200 proves every column exists in
//                 the live table; any 4xx aborts the run without writing.
// Regression guard: habits.goal_id (added by migration 20260830150000, dropped by
//                 20260830190000) is probed and must NOT exist.
//
// Output format:  byte-compatible with `supabase gen types typescript` (v2 layout),
//                 so `git diff` against the committed file shows exactly the schema
//                 delta (currently: the four day_tasks columns lost in commit d4bf9cd).
//
// Usage: node scripts/generate-db-types.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "src", "integrations", "supabase", "types.ts");

// ---------------------------------------------------------------------------
// Live schema — column: [pg type, nullable, has default] (alphabetical)
// Derived from supabase/migrations (20260824150755 … 20260830190000).
// ---------------------------------------------------------------------------
const schema = {
  day_tasks: {
    completed_at: ["timestamptz", true, false],
    created_at: ["timestamptz", false, true],
    description: ["text", true, false],
    goal_id: ["uuid", true, false],
    id: ["uuid", false, true],
    is_stale: ["boolean", false, true],
    progress_pct: ["integer", false, true],
    rollover_count: ["integer", false, true],
    routine_task_id: ["uuid", true, false],
    sort_order: ["integer", false, true],
    source: ["text", false, true],
    subject_id: ["uuid", true, false],
    task_date: ["date", false, false],
    title: ["text", false, false],
    updated_at: ["timestamptz", false, true],
    user_id: ["uuid", false, false],
  },
  goal_habit_links: {
    created_at: ["timestamptz", false, true],
    goal_id: ["uuid", false, false],
    habit_id: ["uuid", false, false],
    id: ["uuid", false, true],
  },
  goal_habit_snapshots: {
    goal_id: ["uuid", false, false],
    habit_id: ["uuid", false, false],
    hit_rate_pct: ["integer", false, false],
    id: ["uuid", false, true],
    snapshotted_at: ["timestamptz", false, true],
    total_weeks: ["integer", false, false],
    weeks_on_target: ["integer", false, false],
  },
  goals: {
    color: ["text", false, true],
    created_at: ["timestamptz", false, true],
    description: ["text", true, false],
    id: ["uuid", false, true],
    last_overall_pct: ["integer", true, false],
    status: ["text", false, true],
    target_date: ["date", true, false],
    title: ["text", false, false],
    updated_at: ["timestamptz", false, true],
    user_id: ["uuid", false, false],
  },
  habit_logs: {
    created_at: ["timestamptz", false, true],
    habit_id: ["uuid", false, false],
    id: ["uuid", false, true],
    log_date: ["date", false, false],
    user_id: ["uuid", false, false],
  },
  habits: {
    color: ["text", false, true],
    created_at: ["timestamptz", false, true],
    id: ["uuid", false, true],
    is_archived: ["boolean", false, true],
    sort_order: ["integer", false, true],
    target_per_week: ["smallint", false, true],
    title: ["text", false, false],
    updated_at: ["timestamptz", false, true],
    user_id: ["uuid", false, false],
  },
  profiles: {
    best_streak: ["integer", false, true],
    created_at: ["timestamptz", false, true],
    current_streak: ["integer", false, true],
    display_name: ["text", true, false],
    id: ["uuid", false, false],
    last_active_day: ["date", true, false],
    last_seen_review_week: ["date", true, false],
    level: ["integer", false, true],
    total_xp: ["integer", false, true],
    updated_at: ["timestamptz", false, true],
  },
  routine_tasks: {
    created_at: ["timestamptz", false, true],
    goal_id: ["uuid", true, false],
    id: ["uuid", false, true],
    is_active: ["boolean", false, true],
    sort_order: ["integer", false, true],
    subject_id: ["uuid", true, false],
    title: ["text", false, false],
    updated_at: ["timestamptz", false, true],
    user_id: ["uuid", false, false],
    weekday: ["smallint", false, false],
  },
  subjects: {
    color: ["text", false, true],
    created_at: ["timestamptz", false, true],
    id: ["uuid", false, true],
    name: ["text", false, false],
    updated_at: ["timestamptz", false, true],
    user_id: ["uuid", false, false],
  },
  weekly_reviews: {
    created_at: ["timestamptz", false, true],
    id: ["uuid", false, true],
    reflection_text: ["text", true, false],
    user_id: ["uuid", false, false],
    week_start_date: ["date", false, false],
  },
};

// Foreign keys between public-schema tables (auth.users FKs are excluded by
// `supabase gen types`, mirroring the committed file).
const relationships = {
  day_tasks: [
    { foreignKeyName: "day_tasks_goal_id_fkey", columns: ["goal_id"], isOneToOne: false, referencedRelation: "goals", referencedColumns: ["id"] },
    { foreignKeyName: "day_tasks_routine_task_id_fkey", columns: ["routine_task_id"], isOneToOne: false, referencedRelation: "routine_tasks", referencedColumns: ["id"] },
    { foreignKeyName: "day_tasks_subject_id_fkey", columns: ["subject_id"], isOneToOne: false, referencedRelation: "subjects", referencedColumns: ["id"] },
  ],
  goal_habit_links: [
    { foreignKeyName: "goal_habit_links_goal_id_fkey", columns: ["goal_id"], isOneToOne: false, referencedRelation: "goals", referencedColumns: ["id"] },
    { foreignKeyName: "goal_habit_links_habit_id_fkey", columns: ["habit_id"], isOneToOne: false, referencedRelation: "habits", referencedColumns: ["id"] },
  ],
  goal_habit_snapshots: [
    { foreignKeyName: "goal_habit_snapshots_goal_id_fkey", columns: ["goal_id"], isOneToOne: false, referencedRelation: "goals", referencedColumns: ["id"] },
    { foreignKeyName: "goal_habit_snapshots_habit_id_fkey", columns: ["habit_id"], isOneToOne: false, referencedRelation: "habits", referencedColumns: ["id"] },
  ],
  goals: [],
  habit_logs: [
    { foreignKeyName: "habit_logs_habit_id_fkey", columns: ["habit_id"], isOneToOne: false, referencedRelation: "habits", referencedColumns: ["id"] },
  ],
  habits: [],
  profiles: [],
  routine_tasks: [
    { foreignKeyName: "routine_tasks_goal_id_fkey", columns: ["goal_id"], isOneToOne: false, referencedRelation: "goals", referencedColumns: ["id"] },
    { foreignKeyName: "routine_tasks_subject_id_fkey", columns: ["subject_id"], isOneToOne: false, referencedRelation: "subjects", referencedColumns: ["id"] },
  ],
  subjects: [],
  weekly_reviews: [],
};

const PG_TO_TS = {
  uuid: "string",
  text: "string",
  date: "string",
  timestamptz: "string",
  integer: "number",
  smallint: "number",
  boolean: "boolean",
};

function tsType(pg, nullable) {
  const base = PG_TO_TS[pg];
  if (!base) throw new Error(`Unknown pg type: ${pg}`);
  return nullable ? `${base} | null` : base;
}

function tableBlock(name, cols, rels) {
  const names = Object.keys(cols).sort();
  const row = names.map((c) => `          ${c}: ${tsType(...cols[c])}`).join("\n");
  const insert = names
    .map((c) => {
      const [pg, nullable, hasDefault] = cols[c];
      const t = tsType(pg, nullable);
      return hasDefault || nullable ? `          ${c}?: ${t}` : `          ${c}: ${t}`;
    })
    .join("\n");
  const update = names.map((c) => `          ${c}?: ${tsType(...cols[c])}`).join("\n");
  const relSrc = rels.length
    ? `        Relationships: [\n${rels
        .map(
          (r) =>
            `          {\n            foreignKeyName: "${r.foreignKeyName}"\n            columns: [${r.columns
              .map((c) => `"${c}"`)
              .join(", ")}]\n            isOneToOne: ${r.isOneToOne}\n            referencedRelation: "${r.referencedRelation}"\n            referencedColumns: [${r.referencedColumns
              .map((c) => `"${c}"`)
              .join(", ")}]\n          },`,
        )
        .join("\n")}\n        ]`
    : "        Relationships: []";
  return `      ${name}: {\n        Row: {\n${row}\n        }\n        Insert: {\n${insert}\n        }\n        Update: {\n${update}\n        }\n${relSrc}\n      }`;
}

// ---------------------------------------------------------------------------
// Live verification (read-only PostgREST probes with the publishable key)
// ---------------------------------------------------------------------------
const envSrc = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const env = Object.fromEntries(
  [...envSrc.matchAll(/^\s*([A-Za-z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/gm)].map((m) => [m[1], m[2]]),
);
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const PUBLISHABLE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !PUBLISHABLE_KEY) throw new Error("Missing Supabase URL/key in .env");

async function probe(table, cols) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${cols.join(",")}&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${PUBLISHABLE_KEY}` },
  });
  return { status: res.status, body: res.ok ? null : await res.text() };
}

for (const table of Object.keys(schema).sort()) {
  const cols = Object.keys(schema[table]);
  const { status, body } = await probe(table, cols);
  if (status !== 200) {
    console.error(`LIVE CHECK FAILED: ${table} (HTTP ${status}) ${body ?? ""}`);
    process.exit(1);
  }
  console.log(`live ok: ${table} (${cols.length} columns)`);
}
{
  // habits.goal_id was dropped by migration 20260830190000 — must NOT exist.
  const { status } = await probe("habits", ["goal_id"]);
  if (status === 200) {
    console.error("LIVE CHECK FAILED: habits.goal_id unexpectedly exists");
    process.exit(1);
  }
  console.log("live ok: habits.goal_id absent (dropped) as expected");
}

// ---------------------------------------------------------------------------
// Regenerate the Tables section, preserving header + helper exports byte-for-byte
// ---------------------------------------------------------------------------
const current = fs.readFileSync(OUT, "utf8");
const NL = current.includes("\r\n") ? "\r\n" : "\n";
const headMarker = `    Tables: {${NL}`;
const tailMarker = `    }${NL}    Views: {`;
const headEnd = current.indexOf(headMarker);
const tailStart = current.indexOf(tailMarker);
if (headEnd < 0 || tailStart < 0) throw new Error("Could not locate Tables/Views markers in types.ts");
const head = current.slice(0, headEnd + headMarker.length);
const tail = current.slice(tailStart);

const tablesSrc = Object.keys(schema)
  .sort()
  .map((t) => tableBlock(t, schema[t], relationships[t] ?? []))
  .join("\n")
  .split("\n")
  .join(NL);

fs.writeFileSync(OUT, `${head}${tablesSrc}${NL}${tail}`);
console.log(`\nWrote ${OUT}`);


