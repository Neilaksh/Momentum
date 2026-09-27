"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Standalone simulation for the subject "study mark": proves that
 * summarizeStudyBySubject credits the right subject, on the right local day,
 * inside the right week, and ignores the rows that must never mark a subject
 * (no subject linked, still running, or belonging to an earlier week). Uses the
 * REAL helpers from src/lib/study-sessions-shared.ts — no mocks, no DB.
 */
const study_sessions_shared_1 = require("../src/lib/study-sessions-shared");
let failed = 0;
function check(label, ok) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok)
        failed++;
}
/** Local wall-clock time -> ISO instant, so local-date bucketing round trips. */
function iso(y, m, d, h = 0, min = 0) {
    return new Date(y, m - 1, d, h, min).toISOString();
}
/** Monday 2026-09-21 .. Sunday 2026-09-27; "today" is the Wednesday. */
const WEEK_START = "2026-09-21";
const TODAY = "2026-09-23";
const OPTIONS = { today: TODAY, weekStart: WEEK_START };
function session(over) {
    return {
        subject_id: "s1",
        started_at: iso(2026, 9, 23, 9, 0),
        ended_at: iso(2026, 9, 23, 9, 25),
        duration_seconds: 1500,
        mode: "pomodoro",
        ...over,
    };
}
function main() {
    // S1 — two subjects never bleed into each other's totals.
    {
        const rows = [
            session({ id: "a", subject_id: "s1" }),
            session({ id: "b", subject_id: "s2", duration_seconds: 600 }),
        ];
        const map = (0, study_sessions_shared_1.summarizeStudyBySubject)(rows, OPTIONS);
        const s1 = map.get("s1");
        const s2 = map.get("s2");
        check("S1 one summary per subject", map.size === 2);
        check("S1 s1 gets only its own 1500s today", s1?.todaySeconds === 1500);
        check("S1 s2 gets only its own 600s today", s2?.todaySeconds === 600);
        check("S1 week totals match today for a single-week session", s1?.weekSeconds === 1500);
    }
    // S2 — an untagged session marks nobody.
    {
        const map = (0, study_sessions_shared_1.summarizeStudyBySubject)([session({ id: "a", subject_id: null })], OPTIONS);
        check("S2 untagged session produces no summary", map.size === 0);
    }
    // S3 — a running timer has nothing to credit yet.
    {
        const map = (0, study_sessions_shared_1.summarizeStudyBySubject)([session({ id: "a", ended_at: null, duration_seconds: null })], OPTIONS);
        check("S3 unfinished session produces no summary", map.size === 0);
    }
    // S4 — a row from a previous week never leaks into this week.
    {
        const rows = [
            session({
                id: "old",
                started_at: iso(2026, 9, 20, 23, 0),
                ended_at: iso(2026, 9, 20, 23, 30),
            }),
            session({ id: "now" }),
        ];
        const map = (0, study_sessions_shared_1.summarizeStudyBySubject)(rows, OPTIONS);
        const s1 = map.get("s1");
        check("S4 pre-week session dropped", s1?.weekSeconds === 1500 && s1?.weekSessions === 1);
        check("S4 pre-week date absent from dailySeconds", s1?.dailySeconds["2026-09-20"] === undefined);
    }
    // S5 — several blocks on one day sum into that day's bar.
    {
        const rows = [
            session({ id: "a", started_at: iso(2026, 9, 23, 8, 0), duration_seconds: 1500 }),
            session({ id: "b", started_at: iso(2026, 9, 23, 11, 0), duration_seconds: 900 }),
            session({ id: "c", started_at: iso(2026, 9, 22, 19, 0), duration_seconds: 1200 }),
        ];
        const s1 = (0, study_sessions_shared_1.summarizeStudyBySubject)(rows, OPTIONS).get("s1");
        check("S5 today sums both of today's blocks", s1?.todaySeconds === 2400);
        check("S5 day bar keyed by local date", s1?.dailySeconds["2026-09-23"] === 2400);
        check("S5 earlier day kept separately", s1?.dailySeconds["2026-09-22"] === 1200);
        check("S5 week is the sum of every block", s1?.weekSeconds === 3600 && s1?.weekSessions === 3);
    }
    // S6 — a block with no recorded duration still marks the day.
    {
        const map = (0, study_sessions_shared_1.summarizeStudyBySubject)([session({ id: "a", duration_seconds: null })], OPTIONS);
        const s1 = map.get("s1");
        check("S6 null duration still marks today", (0, study_sessions_shared_1.isStudiedToday)(s1) && s1?.todaySeconds === 0);
        check("S6 null duration counts as one session", s1?.todaySessions === 1);
    }
    // S7 — lastStudiedAt tracks the newest start, regardless of input order.
    {
        const rows = [
            session({
                id: "late",
                started_at: iso(2026, 9, 24, 20, 0),
                ended_at: iso(2026, 9, 24, 20, 30),
            }),
            session({
                id: "early",
                started_at: iso(2026, 9, 21, 7, 0),
                ended_at: iso(2026, 9, 21, 7, 30),
            }),
        ];
        const s1 = (0, study_sessions_shared_1.summarizeStudyBySubject)(rows, OPTIONS).get("s1");
        check("S7 lastStudiedAt is the newest start", s1?.lastStudiedAt === iso(2026, 9, 24, 20, 0));
    }
    // S8 — the Sunday of the visible week counts for the week, not for today.
    {
        const rows = [
            session({
                id: "sun",
                started_at: iso(2026, 9, 27, 14, 0),
                ended_at: iso(2026, 9, 27, 14, 45),
                duration_seconds: 2700,
            }),
        ];
        const s1 = (0, study_sessions_shared_1.summarizeStudyBySubject)(rows, OPTIONS).get("s1");
        check("S8 Sunday block is in the week", s1?.weekSeconds === 2700);
        check("S8 Sunday block is not today", s1?.todaySeconds === 0 && !(0, study_sessions_shared_1.isStudiedToday)(s1));
        check("S8 Sunday lands on its own bar", s1?.dailySeconds["2026-09-27"] === 2700 && s1?.dailySeconds["2026-09-23"] === undefined);
    }
    // S9 — the card's duration labels.
    {
        check("S9 zero renders 0m", (0, study_sessions_shared_1.formatStudyDuration)(0) === "0m");
        check("S9 sub-minute renders <1m", (0, study_sessions_shared_1.formatStudyDuration)(30) === "<1m");
        check("S9 negative clamps to 0m", (0, study_sessions_shared_1.formatStudyDuration)(-120) === "0m");
        check("S9 45m renders 45m", (0, study_sessions_shared_1.formatStudyDuration)(45 * 60) === "45m");
        check("S9 80m renders 1h 20m", (0, study_sessions_shared_1.formatStudyDuration)(80 * 60) === "1h 20m");
        check("S9 2h renders 2h", (0, study_sessions_shared_1.formatStudyDuration)(120 * 60) === "2h");
    }
    // S10 — an unmarked subject: no summary, or a summary with no session today.
    {
        const empty = (0, study_sessions_shared_1.summarizeStudyBySubject)([], OPTIONS);
        check("S10 undefined summary is not studied today", !(0, study_sessions_shared_1.isStudiedToday)(empty.get("nope")));
        const yesterdayOnly = (0, study_sessions_shared_1.summarizeStudyBySubject)([
            session({
                id: "y",
                started_at: iso(2026, 9, 22, 10, 0),
                ended_at: iso(2026, 9, 22, 10, 25),
            }),
        ], OPTIONS);
        check("S10 a study day that is not today leaves the mark off", !(0, study_sessions_shared_1.isStudiedToday)(yesterdayOnly.get("s1")) && yesterdayOnly.get("s1")?.weekSeconds === 1500);
    }
    console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
    process.exit(failed === 0 ? 0 : 1);
}
void main();
