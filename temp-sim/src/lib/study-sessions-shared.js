"use strict";
// Shared (client + server) values for the study session timer. Mirrors the
// habits-shared / subjects-shared split: pure types and helpers only — no
// Supabase or server-only imports, so this module is safe to bundle client-side.
Object.defineProperty(exports, "__esModule", { value: true });
exports.STUDY_SESSION_MODES = void 0;
exports.isSessionActive = isSessionActive;
exports.summarizeStudyBySubject = summarizeStudyBySubject;
exports.isStudiedToday = isStudiedToday;
exports.formatStudyDuration = formatStudyDuration;
exports.STUDY_SESSION_MODES = ["pomodoro", "stopwatch", "countdown"];
/** A session is active while it has not been stopped yet (ended_at IS NULL). */
function isSessionActive(session) {
    return !!session && session.ended_at === null;
}
/**
 * Local ISO date (YYYY-MM-DD) of a timestamp. Kept local to this module (rather
 * than importing tracker-shared's toISODate) so study-sessions-shared stays a
 * dependency-free, bundle-safe module.
 */
function localISODate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return null;
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
}
/**
 * Group finished sessions by subject — the data behind a subject's "mark".
 *
 * A session is credited to the local date it STARTED on (the day the block
 * belongs to, exactly like a day_task's task_date), and rows that began before
 * `weekStart` are dropped so a stale row can never leak into the totals. Running
 * timers are skipped: an unfinished block has no duration to credit yet.
 */
function summarizeStudyBySubject(sessions, options) {
    const summaries = new Map();
    for (const session of sessions) {
        const subjectId = session.subject_id;
        if (!subjectId)
            continue;
        if (!session.ended_at)
            continue;
        const day = localISODate(session.started_at);
        if (!day || day < options.weekStart)
            continue;
        const seconds = Math.max(0, Math.round(session.duration_seconds ?? 0));
        const summary = summaries.get(subjectId) ?? {
            subjectId,
            todaySeconds: 0,
            todaySessions: 0,
            weekSeconds: 0,
            weekSessions: 0,
            dailySeconds: {},
            lastStudiedAt: null,
        };
        summary.weekSeconds += seconds;
        summary.weekSessions += 1;
        summary.dailySeconds[day] = (summary.dailySeconds[day] ?? 0) + seconds;
        if (day === options.today) {
            summary.todaySeconds += seconds;
            summary.todaySessions += 1;
        }
        if (!summary.lastStudiedAt || session.started_at > summary.lastStudiedAt) {
            summary.lastStudiedAt = session.started_at;
        }
        summaries.set(subjectId, summary);
    }
    return summaries;
}
/** True when at least one finished block landed on the given day. */
function isStudiedToday(summary) {
    return !!summary && summary.todaySessions > 0;
}
/** Compact study-time label for a subject card: "0m", "<1m", "45m", "1h 20m". */
function formatStudyDuration(seconds) {
    const total = Math.max(0, Math.round(seconds));
    if (total <= 0)
        return "0m";
    const minutes = Math.floor(total / 60);
    if (minutes < 1)
        return "<1m";
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}
