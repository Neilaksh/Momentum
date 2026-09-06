/**
 * Standalone rollover identity-merge simulation for the plain <-> goal-linked
 * split (Option C). Uses the REAL rollover engine (tracker.server.ts) with a
 * mock Supabase client, mirroring scripts/simulate-rollover-rename.ts.
 *
 * Proves:
 *   S1  only ONE copy per title lands on today when both a plain and a
 *       goal-linked identity are overdue (goal-linked wins)
 *   S2  completing the plain identity on a later day stops the goal chain
 *   S3  completing the goal identity on a later day stops the plain chain
 *   S4  different goals sharing a title stay independent (two copies allowed)
 *   S5  the pass is idempotent (no re-insert)
 *   S6  a plain chain with N overdue copies still makes exactly one copy
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
const NOW = today.toISOString();

let failed = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failed++;
}

function task(id: string, date: string, title: string, fields: Partial<Row> = {}): Row {
  return {
    id,
    user_id: "u1",
    task_date: date,
    title,
    description: null,
    source: "oneoff",
    sort_order: 0,
    routine_task_id: null,
    goal_id: null,
    subject_id: null,
    priority: null,
    completed_at: null,
    progress_pct: 0,
    rollover_count: 0,
    is_stale: false,
    created_at: NOW,
    ...fields,
  };
}

const todayRowsFor = (tables: Record<string, Row[]>, title: string) =>
  (tables.day_tasks ?? []).filter(
    (r) => r.task_date === d(0) && String(r.title).trim().toLowerCase() === title.toLowerCase(),
  );

async function main() {
  const goalId = "g1";
  const title = "Finish the chapter";

  // === S1: plain + goal overdue, only ONE copy for today (goal wins) ===
  {
    const tables: Record<string, Row[]> = {
      day_tasks: [
        task("p1", d(-1), title, { id: "p1" }),
        task("g1r", d(-1), title, { id: "g1r", goal_id: goalId }),
      ],
      goals: [{ id: goalId, user_id: "u1", status: "active" }],
    };
    const db = makeMockDb(tables);
    const inserted = await carryForwardIncompleteTasks(db, "u1");
    const todayRows = todayRowsFor(tables, title);
    check("S1 exact one copy lands on today", inserted === 1 && todayRows.length === 1);
    check("S1 copy is goal-linked (goal identity wins)", todayRows[0]?.goal_id === goalId);
  }

  // === S2: plain completed on a later day stops the goal chain ===
  {
    const tables: Record<string, Row[]> = {
      day_tasks: [
        task("g0", d(-2), title, { id: "g0", goal_id: goalId }),
        task("p1", d(-1), title, { id: "p1", completed_at: NOW, progress_pct: 100 }),
      ],
      goals: [{ id: goalId, user_id: "u1", status: "active" }],
    };
    const db = makeMockDb(tables);
    const inserted = await carryForwardIncompleteTasks(db, "u1");
    check("S2 goal chain suppressed by later-plain completion", inserted === 0 && todayRowsFor(tables, title).length === 0);
  }

  // === S3: goal completed on a later day stops the plain chain ===
  {
    const tables: Record<string, Row[]> = {
      day_tasks: [
        task("p0", d(-2), title, { id: "p0" }),
        task("g1r", d(-1), title, { id: "g1r", goal_id: goalId, completed_at: NOW, progress_pct: 100 }),
      ],
      goals: [{ id: goalId, user_id: "u1", status: "active" }],
    };
    const db = makeMockDb(tables);
    const inserted = await carryForwardIncompleteTasks(db, "u1");
    check("S3 plain chain suppressed by later-goal completion", inserted === 0 && todayRowsFor(tables, title).length === 0);
  }

  // === S4: different goals sharing a title stay independent ===
  {
    const idB = "g2";
    const tables: Record<string, Row[]> = {
      day_tasks: [
        task("ga", d(-1), title, { id: "ga", goal_id: goalId }),
        task("gb", d(-1), title, { id: "gb", goal_id: idB }),
      ],
      goals: [
        { id: goalId, user_id: "u1", status: "active" },
        { id: idB, user_id: "u1", status: "active" },
      ],
    };
    const db = makeMockDb(tables);
    const inserted = await carryForwardIncompleteTasks(db, "u1");
    const todayRows = todayRowsFor(tables, title);
    check("S4 different-goal same-title rows both roll (independent)", inserted === 2 && todayRows.length === 2);
    check("S4 both goal identities present on today", todayRows.some((r) => r.goal_id === goalId) && todayRows.some((r) => r.goal_id === idB));
  }

  // === S5: second pass is idempotent (no duplicate re-insert) ===
  {
    const tables: Record<string, Row[]> = {
      day_tasks: [
        task("p1", d(-1), title, { id: "p1" }),
        task("g1r", d(-1), title, { id: "g1r", goal_id: goalId }),
      ],
      goals: [{ id: goalId, user_id: "u1", status: "active" }],
    };
    const db = makeMockDb(tables);
    const first = await carryForwardIncompleteTasks(db, "u1");
    const second = await carryForwardIncompleteTasks(db, "u1");
    check("S5 first pass inserts, second inserts nothing", first === 1 && second === 0);
    check("S5 still exactly one copy for today", todayRowsFor(tables, title).length === 1);
  }

  // === S6: plain chain with two overdue copies still lands ONE copy ===
  {
    const tables: Record<string, Row[]> = {
      day_tasks: [
        task("p0", d(-2), title, { id: "p0", rollover_count: 1 }),
        task("p1", d(-1), title, { id: "p1", rollover_count: 2 }),
      ],
      goals: [],
    };
    const db = makeMockDb(tables);
    const inserted = await carryForwardIncompleteTasks(db, "u1");
    const todayRows = todayRowsFor(tables, title);
    check("S6 one copy for today from a multi-row plain chain", inserted === 1 && todayRows.length === 1);
    check("S6 today copy inherits the chain's next count (oldest rc 1 -> 2)", todayRows[0]?.rollover_count === 2);
  }

  console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();