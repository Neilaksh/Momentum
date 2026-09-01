/**
 * Standalone rollover simulation: proves that after a chain-wide rename via
 * renameDayTask semantics, the next carryForwardIncompleteTasks pass continues
 * the chain under the NEW title (no fork, no duplicate under the old title).
 * Uses the REAL rollover engine (tracker.server.ts) with a mock Supabase client.
 */
import { carryForwardIncompleteTasks } from "../src/lib/tracker.server";
import { toISODate, addDays } from "../src/lib/tracker-shared";

type Row = Record<string, unknown> & { id: string };

function makeMockDb(tables: Record<string, Row[]>) {
  const chain = <T>(rows: Row[]) => {
    const filters: Array<(r: Row) => boolean> = [];
    const run = () => rows.filter((r) => filters.every((f) => f(r)));
    const b: Record<string, unknown> = {
      eq: (col: string, val: unknown) => {
        filters.push((r) => (r[col] ?? null) === (val ?? null));
        return b;
      },
      is: (col: string, val: unknown) => {
        filters.push((r) => (val === null ? (r[col] ?? null) === null : r[col] === val));
        return b;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return b;
      },
      gte: (col: string, val: unknown) => {
        filters.push((r) => String(r[col]) >= String(val));
        return b;
      },
      lte: (col: string, val: unknown) => {
        filters.push((r) => String(r[col]) <= String(val));
        return b;
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => (r[col] ?? null) !== (val ?? null));
        return b;
      },
      or: () => b,
      not: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      select: () => b,
      update: (patch: Row) => {
        // find matching rows at update-call time via the filters applied AFTER
        // .update(...) — supabase chains .eq after .update, so instead we patch
        // on await using filters accumulated so far (engine applies .eq after
        // .update, which is still before await — filters array covers it).
        b.__patch = patch;
        return b;
      },
      upsert: () => b,
      insert: (rowsIn: unknown) => {
        const arr = Array.isArray(rowsIn) ? rowsIn : [rowsIn];
        for (const r of arr) rows.push({ ...(r as Row), id: `new-${Math.random().toString(36).slice(2)}` });
        return Promise.resolve({ data: null, error: null });
      },
      then: (res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    // .update() stores patch; on await, apply it to filtered rows
    return new Proxy(b, {
      get(target, prop, recv) {
        if (prop === "then") {
          return (res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) => {
            const patch = target.__patch as Row | undefined;
            if (patch) for (const r of run()) Object.assign(r, patch);
            else return Promise.resolve({ data: run(), error: null }).then(res, rej);
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          };
        }
        return Reflect.get(target, prop, recv);
      },
    });
  };
  const client = {
    from: (table: string) => chain(tables[table] ?? (tables[table] = [])),
  };
  return client as unknown as Parameters<typeof carryForwardIncompleteTasks>[0];
}

const today = new Date();
const d = (n: number) => toISODate(addDays(today, n));

let failed = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failed++;
}

async function main() {
  const goalId = "g1";
  // One task rolled over 3 times (Mon-2, Mon-1, today), uncompleted:
  // rollover_count 0 -> 1 -> 2. Current copy = today's row.
  const chainRows: Row[] = [
    { id: "t0", user_id: "u1", task_date: d(-2), title: "Write chapter", goal_id: goalId, routine_task_id: null, rollover_count: 0, completed_at: null, is_stale: false },
    { id: "t1", user_id: "u1", task_date: d(-1), title: "Write chapter", goal_id: goalId, routine_task_id: null, rollover_count: 1, completed_at: null, is_stale: false },
    { id: "t2", user_id: "u1", task_date: d(0), title: "Write chapter", goal_id: goalId, routine_task_id: null, rollover_count: 2, completed_at: null, is_stale: false },
  ];
  const goals: Row[] = [{ id: goalId, user_id: "u1", status: "active" }];
  const tables: Record<string, Row[]> = { day_tasks: chainRows, goals };

  const db = makeMockDb(tables);

  // === Step 1: apply renameDayTask semantics (chain-wide, normalized) ===
  const newTitle = "  Draft chapter two  "; // deliberately unnormalized input
  const normalized = newTitle.trim();
  const oldKey = (t: Row) => String(t.title).trim().toLowerCase();
  // Chain lookup mirrors tracker.functions.ts: goal match + title match.
  const chainIds = tables.day_tasks
    .filter((r) => r.goal_id === goalId && oldKey(r) === "write chapter")
    .map((r) => r.id);
  check("rename found the whole chain (3 rows)", chainIds.length === 3);
  for (const r of tables.day_tasks) if (chainIds.includes(r.id)) r.title = normalized;

  // === Step 2: run the REAL rollover pass ===
  const insertedByPass = await carryForwardIncompleteTasks(db, "u1");
  console.log(`(rollover pass inserted ${insertedByPass} rows)`);

  // === Step 3: assert chain continued under the NEW title ===
  const newRows = tables.day_tasks.filter((r) => r.title === normalized);
  const oldRows = tables.day_tasks.filter((r) => oldKey(r) === "write chapter");
  const todays = newRows.filter((r) => r.task_date === d(0));

  check("no rows remain under the OLD title (fork impossible)", oldRows.length === 0);
  check("today still has exactly ONE copy (no duplicate)", todays.length === 1);
  check(
    "chain continued: today's copy inherited rollover_count 2 -> next would be 3",
    (todays[0]?.rollover_count as number) === 2,
  );
  check("no copy created under the old title", tables.day_tasks.every((r) => String(r.title).trim().toLowerCase() !== "write chapter"));

  // === Step 4: second pass is idempotent (no re-insert) ===
  await carryForwardIncompleteTasks(db, "u1");
  const afterSecond = tables.day_tasks.filter((r) => r.title === normalized && r.task_date === d(0)).length;
  check("second pass inserts nothing (idempotent)", afterSecond === 1 && tables.day_tasks.length === 3);

  // === Contrast: single-row rename WOULD have forked (documenting the bug avoided) ===
  const forkDbRows: Row[] = [
    { id: "f0", user_id: "u2", task_date: d(-1), title: "Old task", goal_id: goalId, routine_task_id: null, rollover_count: 0, completed_at: null, is_stale: false },
    { id: "f1", user_id: "u2", task_date: d(0), title: "New task", goal_id: goalId, routine_task_id: null, rollover_count: 1, completed_at: null, is_stale: false },
  ];
  const forkTables: Record<string, Row[]> = { day_tasks: forkDbRows, goals: [{ id: goalId, user_id: "u2", status: "active" }] };
  const insertedFork = await carryForwardIncompleteTasks(makeMockDb(forkTables), "u2").catch((e) => {
    console.log("[contrast] PASS THREW:", e?.message ?? e);
    return -1;
  });
  console.log(`(contrast pass inserted ${insertedFork} rows; total rows now ${forkTables.day_tasks.length})`);
  console.log(forkTables.day_tasks.map((r) => `${r.task_date}|${r.title}|rc=${r.rollover_count}`).join("\n"));
  const forkedOld = forkTables.day_tasks.filter((r) => r.title === "Old task" && r.task_date === d(0)).length;
  check("CONTRAST: single-row rename forks (old-title copy appears today) — the bug we prevented", forkedOld === 1);

  console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
