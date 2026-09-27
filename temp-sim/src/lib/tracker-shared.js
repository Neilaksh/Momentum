"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAMPLE_WEEKLY_ROUTINE = exports.ROUTINE_SLEEP_MORNING_END_MIN = exports.ROUTINE_SLEEP_NIGHT_CUTOFF_MIN = exports.DEFAULT_CATEGORIES = exports.COLOR_PALETTE = exports.SAMPLE_TIME_SLOTS = exports.ROUTINE_VARIANTS = exports.XP_PERFECT_DAY = exports.XP_PER_TASK = exports.WEEKDAY_NAMES = void 0;
exports.goalLinkKey = goalLinkKey;
exports.buildRolloverChains = buildRolloverChains;
exports.getSupersededRolloverIds = getSupersededRolloverIds;
exports.routineDaysOffFor = routineDaysOffFor;
exports.routineWeekdays = routineWeekdays;
exports.routineDaysOffBlob = routineDaysOffBlob;
exports.routineDaysOffLabel = routineDaysOffLabel;
exports.toISODate = toISODate;
exports.parseISODate = parseISODate;
exports.startOfWeek = startOfWeek;
exports.addDays = addDays;
exports.parseTaskDescription = parseTaskDescription;
exports.formatTaskDescription = formatTaskDescription;
exports.formatMinutes = formatMinutes;
exports.parseGoalTitle = parseGoalTitle;
exports.formatGoalTitle = formatGoalTitle;
exports.weekDates = weekDates;
exports.formatDayDate = formatDayDate;
exports.levelFromXp = levelFromXp;
exports.xpForLevel = xpForLevel;
exports.levelProgress = levelProgress;
exports.pctComplete = pctComplete;
exports.parseRoutineTitle = parseRoutineTitle;
exports.formatRoutineTitle = formatRoutineTitle;
exports.calculateSlotDurationMinutes = calculateSlotDurationMinutes;
exports.timeSlotStartMinutes = timeSlotStartMinutes;
exports.routineSlotEndMinutes = routineSlotEndMinutes;
exports.computeRoutineSleepMinutes = computeRoutineSleepMinutes;
exports.WEEKDAY_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];
exports.XP_PER_TASK = 10;
exports.XP_PERFECT_DAY = 50;
/**
 * Dedupe key for a goal-linked day_tasks row. The rollover, weekly
 * materialization and goal-schedule paths all insert goal-linked rows, and each
 * path may use a different routine_task_id (or none). They must agree on what
 * counts as "the same task on the same day", so they all key on
 * (task_date, goal_id, normalized title) here.
 */
function goalLinkKey(date, t) {
    return `goal|${date}|${t.goal_id ?? ""}|${(t.title ?? "").trim().toLowerCase()}`;
}
/**
 * Partition day_tasks into rollover chains — the display-only chain identity
 * shared by the Goal Tasks list collapse and the week board's "Completed late"
 * badge. Uses the same rules as the server's superseded detection in getGoals
 * (tracker.functions.ts):
 *   1. a later copy with rollover_count === count + 1 supersedes the row, or
 *   2. a later copy with the SAME count >= 1 supersedes it (the rollover pass
 *      stamps the source row and its fresh copy with one count), or
 *   3. the OLDEST row of a multi-row group with rollover_count >= 1 is the
 *      chain's original — it chains forward to the next later row even when
 *      the counts drifted past the exact +1/same pattern (stale-limit jumps).
 *
 * Rows are keyed by (goal_id, normalized title) like the server, and rules
 * 1 & 2 only ever link a row to the earliest qualifying LATER copy, so two
 * independently-created same-title tasks that never rolled (both count 0)
 * stay separate chains. Every input row appears in exactly one returned
 * chain (singleton chains included), so callers can render one row per chain
 * or read per-chain status (e.g. "any copy completed?").
 */
function buildRolloverChains(tasks) {
    const groups = new Map();
    for (const t of tasks) {
        const key = `${t.goal_id ?? ""}|${(t.title ?? "").trim().toLowerCase()}`;
        const list = groups.get(key) ?? [];
        list.push(t);
        groups.set(key, list);
    }
    // Union-find so rule-linked rows merge into whole chains.
    const parent = new Map();
    for (const t of tasks)
        parent.set(t.id, t.id);
    const find = (id) => {
        const p = parent.get(id) ?? id;
        if (p === id)
            return id;
        const root = find(p);
        parent.set(id, root);
        return root;
    };
    const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb)
            parent.set(ra, rb);
    };
    for (const list of groups.values()) {
        if (list.length < 2)
            continue;
        const sorted = [...list].sort((a, b) => a.task_date.localeCompare(b.task_date));
        for (let i = 0; i < sorted.length; i++) {
            const r = sorted[i];
            const rCount = r.rollover_count ?? 0;
            let linked = false;
            // Rules 1 & 2 — identical to the server's superseded detection.
            for (let j = i + 1; j < sorted.length; j++) {
                const c = sorted[j];
                const cCount = c.rollover_count ?? 0;
                if (cCount === rCount + 1 || (cCount === rCount && rCount >= 1)) {
                    union(r.id, c.id);
                    linked = true;
                    break;
                }
            }
            // Rule 3 — only the group's OLDEST row is the chain original: it still
            // collapses forward when no copy matches the exact count pattern
            // (stale-limit count jumps). Later rows with a >= 1 count but no
            // successor are NOT chain-linked, so a new independent task sharing the
            // title stays its own chain.
            if (!linked && i === 0 && rCount >= 1 && sorted.length > 1) {
                union(r.id, sorted[1].id);
            }
        }
        // Completion bridge — manual re-creation resets rollover_count to 0, so a
        // chain can end without its completed copy (real-world pattern 2/0/0:
        // engine-stamped original, then hand re-added rows the engine never
        // stamped). If the chain's newest row is uncompleted and a LATER
        // same-key row is completed, bridge the chain's newest row to that
        // completed row so the whole thing identifies as one chain again.
        // Gated on the chain already being multi-row (formed by the count rules
        // above — e.g. via the oldest-row rule) so genuinely independent
        // same-title tasks — singleton rows with no chain history — never merge.
        const byRoot = new Map();
        for (const t of sorted) {
            const root = find(t.id);
            const members = byRoot.get(root) ?? [];
            members.push(t);
            byRoot.set(root, members);
        }
        for (const members of byRoot.values()) {
            if (members.length < 2)
                continue;
            const newest = members.reduce((a, b) => (b.task_date > a.task_date ? b : a));
            if (newest.completed_at)
                continue;
            const target = sorted.find((t) => t.task_date > newest.task_date && !!t.completed_at && find(t.id) !== find(newest.id));
            if (target)
                union(newest.id, target.id);
        }
    }
    const chains = new Map();
    for (const t of tasks) {
        const root = find(t.id);
        const list = chains.get(root) ?? [];
        list.push(t);
        chains.set(root, list);
    }
    return [...chains.values()];
}
/**
 * Ids of rollover rows that are superseded: every row of a multi-row chain
 * EXCEPT the chain's newest (live) copy. Only the newest copy of each chain
 * contributes to a goal's total/done — frozen history does not. Shares
 * buildRolloverChains' linking (including the completion bridge) so the
 * server's goal-counting math and the client's badge/chain-collapse can never
 * disagree with each other.
 */
function getSupersededRolloverIds(tasks) {
    const superseded = new Set();
    for (const chain of buildRolloverChains(tasks)) {
        if (chain.length < 2)
            continue;
        const newest = chain.reduce((a, b) => (b.task_date > a.task_date ? b : a));
        for (const t of chain)
            if (t.id !== newest.id)
                superseded.add(t.id);
    }
    return superseded;
}
/** The two whole-week routines a profile can edit (routine_tasks.week_variant). */
exports.ROUTINE_VARIANTS = ["primary", "alternate"];
/**
 * Weekdays (0=Mon … 6=Sun) switched off for one week-variant, read out of the
 * profiles.routine_days_off jsonb blob. A day switched off is never deleted —
 * its routine_tasks rows stay put and come straight back when it is switched on
 * again — it is only excluded from the derived numbers (weekly hours, per-day
 * load, category breakdown, planned-sleep estimate).
 *
 * Unrecognised values are dropped, so a malformed or pre-migration blob degrades
 * to "no days off" instead of breaking the page.
 */
function routineDaysOffFor(value, variant) {
    const raw = value?.[variant];
    return routineWeekdays(raw);
}
/**
 * Normalise any raw weekday list (0=Mon … 6=Sun): keeps only real weekday
 * numbers, de-duplicates and sorts. Shared by the server (reading the jsonb
 * blob) and the client (reading the server response), so both sides can never
 * disagree about what a valid day list is.
 */
function routineWeekdays(value) {
    if (!Array.isArray(value))
        return [];
    const days = value.filter((d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6);
    return [...new Set(days)].sort((a, b) => a - b);
}
/**
 * Normalised {primary, alternate} days-off blob, ready to be written back to
 * profiles.routine_days_off. Always carries BOTH variants so a read-modify-write
 * of one week never drops the other week's days off.
 */
function routineDaysOffBlob(value) {
    return {
        primary: routineDaysOffFor(value, "primary"),
        alternate: routineDaysOffFor(value, "alternate"),
    };
}
/**
 * Human label for a set of disabled weekdays, e.g. ["Sun off"] or ["Sun, Mon off"].
 * Weekday names share the app's Monday-first convention (0=Mon).
 */
function routineDaysOffLabel(daysOff) {
    if (daysOff.length === 0)
        return null;
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return `${daysOff.map((d) => names[d] ?? d).join(", ")} off`;
}
/** ISO date string (YYYY-MM-DD) in local time. */
function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function parseISODate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
}
/** Monday-based week start for a given date. */
function startOfWeek(d) {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = (copy.getDay() + 6) % 7; // 0 = Monday
    copy.setDate(copy.getDate() - day);
    return copy;
}
function addDays(d, n) {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() + n);
    return copy;
}
/**
 * Parse the task `description` field which may contain both a human-readable
 * note and an embedded effort estimate encoded as `\n---est:N---` at the end.
 * Returns the clean note and the estimated minutes (or null if not set).
 */
function parseTaskDescription(raw) {
    if (!raw)
        return { note: "", estMinutes: null };
    const match = raw.match(/(?:^|\n)---est:(\d+)---$/);
    if (match) {
        const est = parseInt(match[1], 10);
        const note = raw.slice(0, match.index).trimEnd();
        return {
            note,
            estMinutes: Number.isInteger(est) && est > 0 ? est : null,
        };
    }
    return { note: raw, estMinutes: null };
}
/** Serialize note + estMinutes back into the `description` field. */
function formatTaskDescription(note, estMinutes) {
    const cleanNote = note.trim();
    if (!cleanNote && estMinutes === null)
        return null;
    if (estMinutes === null)
        return cleanNote || null;
    return cleanNote ? `${cleanNote}\n---est:${estMinutes}---` : `\n---est:${estMinutes}---`;
}
/** Format minutes as "Xh Ym" / "Xm" / "Xh" for display. */
function formatMinutes(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0)
        return `${h}h ${m}m`;
    if (h > 0)
        return `${h}h`;
    return `${m}m`;
}
/**
 * Parse a goal title that may contain an encoded priority prefix `[p:High]`.
 * Returns the clean title and the priority (or null if unset).
 */
function parseGoalTitle(raw) {
    if (!raw)
        return { cleanTitle: "", priority: null };
    const match = raw.match(/^\[p:(High|Med|Low)\]\s*(.*)$/);
    if (!match)
        return { cleanTitle: raw, priority: null };
    return { cleanTitle: (match[2] ?? "").trim(), priority: match[1] };
}
/** Serialize a clean goal title + priority back into the stored title string. */
function formatGoalTitle(cleanTitle, priority) {
    const clean = parseGoalTitle(cleanTitle).cleanTitle.trim();
    if (!priority)
        return clean;
    return `[p:${priority}] ${clean}`;
}
function weekDates(weekStartISO) {
    const start = parseISODate(weekStartISO);
    return Array.from({ length: 7 }, (_, i) => toISODate(addDays(start, i)));
}
function formatDayDate(iso) {
    const d = parseISODate(iso);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function levelFromXp(xp) {
    return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}
function xpForLevel(level) {
    return Math.pow(Math.max(0, level - 1), 2) * 100;
}
function levelProgress(xp) {
    const level = levelFromXp(xp);
    const base = xpForLevel(level);
    const next = xpForLevel(level + 1);
    const span = next - base;
    const into = xp - base;
    return { level, into, span, pct: span > 0 ? Math.round((into / span) * 100) : 0 };
}
function pctComplete(tasks) {
    if (tasks.length === 0)
        return 0;
    const done = tasks.filter((t) => t.completed_at).length;
    return Math.round((done / tasks.length) * 100);
}
exports.SAMPLE_TIME_SLOTS = [
    "5:45–6:00 AM",
    "6:00–7:00 AM",
    "6:45–7:00 AM",
    "7:00–7:30 AM",
    "7:30–8:00 AM",
    "8:00–8:30 AM",
    "8:30–9:00 AM",
    "9:00–9:30 AM",
    "9:30–10:00 AM",
    "10:00–10:30 AM",
    "10:30–12:30 PM",
    "12:30–1:00 PM",
    "1:00–2:00 PM",
    "3:00–4:00 PM",
    "4:00–5:30 PM",
    "5:30–6:00 PM",
    "6:00–6:30 PM",
    "6:30–8:00 PM",
    "8:00–8:30 PM",
    "8:30–9:00 PM",
    "9:00–10:00 PM",
    "10:00–10:20 PM",
    "10:30 PM",
];
exports.COLOR_PALETTE = {
    emerald: {
        bg: "bg-emerald-500/15",
        text: "text-emerald-400",
        border: "border-emerald-500/30",
        label: "Emerald",
    },
    cyan: {
        bg: "bg-cyan-500/15",
        text: "text-cyan-400",
        border: "border-cyan-500/30",
        label: "Cyan",
    },
    amber: {
        bg: "bg-amber-500/15",
        text: "text-amber-400",
        border: "border-amber-500/30",
        label: "Amber",
    },
    purple: {
        bg: "bg-purple-500/15",
        text: "text-purple-400",
        border: "border-purple-500/30",
        label: "Purple",
    },
    indigo: {
        bg: "bg-indigo-500/15",
        text: "text-indigo-400",
        border: "border-indigo-500/30",
        label: "Indigo",
    },
    rose: {
        bg: "bg-rose-500/15",
        text: "text-rose-400",
        border: "border-rose-500/30",
        label: "Rose",
    },
    blue: {
        bg: "bg-blue-500/15",
        text: "text-blue-400",
        border: "border-blue-500/30",
        label: "Blue",
    },
    fuchsia: {
        bg: "bg-fuchsia-500/15",
        text: "text-fuchsia-400",
        border: "border-fuchsia-500/30",
        label: "Fuchsia",
    },
    teal: {
        bg: "bg-teal-500/15",
        text: "text-teal-400",
        border: "border-teal-500/30",
        label: "Teal",
    },
    orange: {
        bg: "bg-orange-500/15",
        text: "text-orange-400",
        border: "border-orange-500/30",
        label: "Orange",
    },
    slate: { bg: "bg-secondary", text: "text-foreground", border: "border-border", label: "Slate" },
};
exports.DEFAULT_CATEGORIES = [
    { name: "Fitness", colorKey: "emerald" },
    { name: "Study", colorKey: "cyan" },
    { name: "Meals", colorKey: "amber" },
    { name: "Recreation", colorKey: "purple" },
    { name: "Unwind", colorKey: "indigo" },
    { name: "Personal", colorKey: "rose" },
    { name: "Work", colorKey: "blue" },
    { name: "General", colorKey: "slate" },
];
/** Parse structured metadata from routine_tasks.title */
function parseRoutineTitle(rawTitle) {
    if (!rawTitle) {
        return {
            timeSlot: "",
            category: "General",
            colorKey: "slate",
            emoji: "📌",
            cleanTitle: "",
            displayTitle: "",
            habitId: null,
            taskId: null,
            rawTitle: "",
        };
    }
    // Check for extended pattern: [timeSlot|category|emoji|colorKey|habitId|taskId] title
    const match = rawTitle.match(/^\[([^\]]*)\]\s*(.*)$/);
    if (match) {
        const parts = (match[1] ?? "").split("|");
        const timeSlot = parts[0] ?? "";
        const category = parts[1] || "General";
        let emoji = parts[2] || "📌";
        let colorKey = parts[3] || "slate";
        const habitId = parts[4] && parts[4] !== "none" ? parts[4] : null;
        const taskId = parts[5] && parts[5] !== "none" ? parts[5] : null;
        let cleanTitle = (match[2] || "").trim();
        // Check if cleanTitle has its own leading emoji
        const leadingEmojiMatch = cleanTitle.match(/^(\p{Extended_Pictographic}|\u2705|\u2728|\u2b50)\s*(.*)$/u);
        if (leadingEmojiMatch) {
            if (!emoji || emoji === "📌" || emoji === "🎯") {
                emoji = leadingEmojiMatch[1];
            }
            cleanTitle = (leadingEmojiMatch[2] || "").trim();
        }
        if (!exports.COLOR_PALETTE[colorKey]) {
            // Fall back through the category's own palette key (kept mapping from the
            // removed CATEGORY_COLORS), else slate.
            const fallbackColorKey = (exports.DEFAULT_CATEGORIES.find((c) => c.name === category)?.colorKey ??
                "slate");
            colorKey = exports.COLOR_PALETTE[fallbackColorKey] ? fallbackColorKey : "slate";
        }
        return {
            timeSlot,
            category,
            colorKey,
            emoji,
            cleanTitle,
            displayTitle: emoji ? `${emoji} ${cleanTitle}`.trim() : cleanTitle,
            habitId,
            taskId,
            rawTitle,
        };
    }
    // Legacy title parsing: check leading emoji if any
    const emojiMatch = rawTitle.match(/^(\p{Extended_Pictographic}|\u2705|\u2728|\u2b50)\s*(.*)$/u);
    if (emojiMatch) {
        return {
            timeSlot: "",
            category: "General",
            colorKey: "slate",
            emoji: emojiMatch[1] || "📌",
            cleanTitle: (emojiMatch[2] || rawTitle).trim(),
            displayTitle: rawTitle.trim(),
            habitId: null,
            taskId: null,
            rawTitle,
        };
    }
    return {
        timeSlot: "",
        category: "General",
        colorKey: "slate",
        emoji: "📌",
        cleanTitle: rawTitle,
        displayTitle: rawTitle,
        habitId: null,
        taskId: null,
        rawTitle,
    };
}
/** Format structured routine task title into storage string. */
function formatRoutineTitle(cleanTitle, timeSlot = "", category = "General", emoji = "📌", colorKey = "slate", habitId = null, taskId = null) {
    const trimmed = cleanTitle.trim();
    const emo = emoji || "📌";
    const hId = habitId ?? "none";
    const tId = taskId ?? "none";
    if (!timeSlot &&
        category === "General" &&
        emo === "📌" &&
        colorKey === "slate" &&
        !habitId &&
        !taskId) {
        return trimmed;
    }
    return `[${timeSlot}|${category}|${emo}|${colorKey}|${hId}|${tId}] ${trimmed}`;
}
/** Calculate duration in minutes from a time slot string like "6:00–7:00 AM" or "10:30–12:30 PM" */
function calculateSlotDurationMinutes(timeSlot) {
    if (!timeSlot)
        return 30; // default 30 mins
    // Normalize delimiters (en-dash, em-dash, hyphen, to)
    const normalized = timeSlot.replace(/[–—]/g, "-").replace(/\s+to\s+/i, "-");
    const parts = normalized.split("-");
    if (parts.length < 2)
        return 30;
    const parseTimePart = (part, fallbackAmPm) => {
        const trimmed = part.trim().toUpperCase();
        const isPm = trimmed.includes("PM");
        const isAm = trimmed.includes("AM");
        const rawTime = trimmed.replace(/[^\d:]/g, "");
        if (!rawTime)
            return null;
        const [hStr, mStr] = rawTime.split(":");
        let h = parseInt(hStr ?? "0", 10);
        const m = parseInt(mStr ?? "0", 10);
        if (isNaN(h))
            return null;
        let pm = isPm;
        if (!isPm && !isAm && fallbackAmPm) {
            pm = fallbackAmPm.includes("PM");
        }
        if (pm && h < 12)
            h += 12;
        if (!pm && isAm && h === 12)
            h = 0;
        return h * 60 + (isNaN(m) ? 0 : m);
    };
    const endPart = parts[1] ?? "";
    const endAmPm = endPart.toUpperCase().includes("PM")
        ? "PM"
        : endPart.toUpperCase().includes("AM")
            ? "AM"
            : undefined;
    const startMins = parseTimePart(parts[0] ?? "", endAmPm);
    const endMins = parseTimePart(endPart, endAmPm);
    if (startMins !== null && endMins !== null) {
        let diff = endMins - startMins;
        if (diff < 0)
            diff += 24 * 60; // wraps around midnight
        return diff > 0 ? diff : 30;
    }
    return 30;
}
/**
 * Parse one clock part ("6:00", "12:00 AM", "21:45") into minutes since
 * midnight. An omitted AM/PM is inherited from the sibling part of the range
 * (`fallbackAmPm`), so "12:00–6:30 AM" resolves 12:00 to midnight rather than
 * noon. Returns null when the part is unparseable or out of range.
 */
function parseClockPart(part, fallbackAmPm) {
    const trimmed = part.trim().toUpperCase();
    const isPm = trimmed.includes("PM");
    const isAm = trimmed.includes("AM");
    const rawTime = trimmed.replace(/[^\d:]/g, "");
    if (!rawTime)
        return null;
    const [hStr, mStr] = rawTime.split(":");
    let h = parseInt(hStr ?? "0", 10);
    const m = parseInt(mStr ?? "0", 10);
    if (isNaN(h))
        return null;
    let pm = isPm;
    if (!isPm && !isAm && fallbackAmPm)
        pm = fallbackAmPm.includes("PM");
    if (pm && h < 12)
        h += 12;
    // 12 o'clock: PM stays noon; AM — explicit or inherited from the end part —
    // is midnight.
    if (!pm && (isAm || fallbackAmPm === "AM") && h === 12)
        h = 0;
    if (h < 0 || h > 23 || m < 0 || m > 59)
        return null;
    return h * 60 + (isNaN(m) ? 0 : m);
}
/** "PM" / "AM" when a clock part states it explicitly, else undefined. */
function explicitAmPm(part) {
    const upper = part.toUpperCase();
    if (upper.includes("PM"))
        return "PM";
    if (upper.includes("AM"))
        return "AM";
    return undefined;
}
/**
 * Start time of a time slot in minutes since midnight (0–1439), or null if the
 * slot's start can't be parsed. Handles 12-hour ("6:00–7:00 AM", with the
 * AM/PM inherited from the end part when the start omits it, and 12:00 AM
 * correctly resolving to midnight), 24-hour ("21:45–23:30"), and the en-dash /
 * em-dash / hyphen / "to" delimiters accepted by calculateSlotDurationMinutes.
 * Used to keep time-slot rows sorted chronologically regardless of the order
 * slots were created in.
 */
function timeSlotStartMinutes(timeSlot) {
    if (!timeSlot)
        return null;
    // Normalize delimiters (en-dash, em-dash, hyphen, to) — same as duration calc.
    const normalized = timeSlot.replace(/[–—]/g, "-").replace(/\s+to\s+/i, "-");
    const parts = normalized.split("-");
    if (parts.length < 2) {
        // Bare single time (no range) — parse it on its own.
        return parseClockPart(parts[0] ?? "");
    }
    return parseClockPart(parts[0] ?? "", explicitAmPm(parts[1] ?? ""));
}
/**
 * End time of a real time RANGE in absolute minutes, or null for a bare point
 * time ("10:30 PM") which carries no duration. A range that runs past midnight
 * wraps beyond 1440 ("11:00 PM–06:00 AM" → 1800), so end > start always holds
 * for spans. Used by the sleep estimate, where the bedtime anchor is the end of
 * the last evening activity.
 */
function routineSlotEndMinutes(timeSlot) {
    if (!timeSlot)
        return null;
    const normalized = timeSlot.replace(/[–—]/g, "-").replace(/\s+to\s+/i, "-");
    const parts = normalized.split("-");
    const startPart = (parts[0] ?? "").trim();
    const endPart = (parts[1] ?? "").trim();
    if (parts.length < 2 || !startPart || !endPart)
        return null;
    const start = parseClockPart(startPart, explicitAmPm(endPart));
    const end = parseClockPart(endPart, explicitAmPm(startPart));
    if (start === null || end === null)
        return null;
    return end < start ? end + 24 * 60 : end;
}
/**
 * Boundary (minutes since midnight) between "late night of the previous day"
 * and "this morning". Routine bars that start before 4:00 AM are treated as the
 * tail of the previous night: a "😴 Sleep 12:00–6:30 AM" or a bare "12:30 AM"
 * bedtime bar closes out the evening before the day it is filed under, instead
 * of being mistaken for that morning's first bar.
 */
exports.ROUTINE_SLEEP_NIGHT_CUTOFF_MIN = 4 * 60;
/**
 * End of the morning band (minutes since midnight). A wake anchor is a bar of
 * the next day that starts at/after the night cutoff but BEFORE noon: on a day
 * whose only bar is an evening one (no morning bars at all) there is no wake
 * time, and the night is reported as unmeasured instead of as a 16–24h phantom
 * that would wreck the average.
 */
exports.ROUTINE_SLEEP_MORNING_END_MIN = 12 * 60;
/**
 * When a bar puts you to sleep.
 *
 * A block's END is the bedtime — the closing activity finishes and you go to
 * sleep — so "10:05–11:00 PM Recreational" anchors at 11:00 PM, not 10:05 PM.
 * `limit` is the moment the night is over for that bar: cutoff + 24h for an
 * evening bar of day D, and plain cutoff for an after-midnight bar of D+1. A bar
 * whose end reaches or passes that limit is itself the sleep block ("11:00 PM–
 * 06:00 AM", "12:00–6:30 AM"), so its end is the wake-up side and its START is
 * the bedtime; a bare point-time bar ("10:30 PM") has no duration and does the
 * same. Because every anchor therefore stays below `limit`, and the wake anchor
 * is always at/after the plain cutoff, wake − bed stays strictly positive.
 */
function bedAnchorMinutes(bar, limit) {
    if (bar.end !== null && bar.end < limit)
        return bar.end;
    return bar.start;
}
/**
 * Planned sleep per weekday (0=Mon … 6=Sun) in minutes, or null for a night
 * that can't be measured. For day D:
 *
 *   bed  = latest of (the END of each of D's bars starting at/after the cutoff,
 *          falling back to its start — see bedAnchorMinutes) and (D+1's bars
 *          starting before the cutoff, shifted +24h — the after-midnight bars
 *          that close out D's night, anchored at their start);
 *   wake = first bar of D+1 starting at/after the cutoff and before noon (the
 *          real morning bar);
 *   sleep = wake + 24h − bed.
 *
 * So "the last thing you do → the first thing you do next morning" holds even
 * when the bedtime bar itself sits after midnight: 10:30 PM wind-down, a
 * 12:00–6:30 AM Sleep bar and a 6:30 AM wake-up bar measure 6h 30m, and an
 * evening ending with 10:05–11:00 PM followed by a 6:00 AM wake-up bar measures
 * 7h 00m (not the 7h 55m you get by anchoring at the block's start). Null when
 * the night has no bedtime anchor or no next-morning bar.
 */
function computeRoutineSleepMinutes(bars, cutoffMin = exports.ROUTINE_SLEEP_NIGHT_CUTOFF_MIN, morningEndMin = exports.ROUTINE_SLEEP_MORNING_END_MIN) {
    const byDay = Array.from({ length: 7 }, () => []);
    for (const bar of bars) {
        if (bar.startMinutes === null || bar.weekday < 0 || bar.weekday > 6)
            continue;
        byDay[bar.weekday].push({ start: bar.startMinutes, end: bar.endMinutes ?? null });
    }
    const sleepMinutes = [];
    for (let d = 0; d < 7; d++) {
        const today = byDay[d];
        const next = byDay[(d + 1) % 7];
        const bedCandidates = [
            ...today
                .filter((b) => b.start >= cutoffMin)
                .map((b) => bedAnchorMinutes(b, cutoffMin + 24 * 60)),
            // After-midnight bars of D+1 belong to D's night: their anchors move a day
            // later. A bar that runs to/into the morning is the sleep block itself, so
            // it anchors at its start (see bedAnchorMinutes).
            ...next
                .filter((b) => b.start < cutoffMin)
                .map((b) => bedAnchorMinutes(b, cutoffMin) + 24 * 60),
        ];
        const wakeCandidates = next
            .filter((b) => b.start >= cutoffMin && b.start < morningEndMin)
            .map((b) => b.start);
        if (bedCandidates.length === 0 || wakeCandidates.length === 0) {
            sleepMinutes.push(null);
            continue;
        }
        // Every bed value is < cutoff+24h and every wake value is ≥ cutoff+24h, so
        // the difference is always strictly positive.
        const bed = Math.max(...bedCandidates);
        const wake = Math.min(...wakeCandidates) + 24 * 60;
        sleepMinutes.push(wake - bed);
    }
    return sleepMinutes;
}
/** Sample Routine Schedule matching reference spreadsheet */
exports.SAMPLE_WEEKLY_ROUTINE = [
    {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeSlot: "5:45–6:00 AM",
        title: "Wake Up & Hydrate",
        emoji: "🌅",
        category: "Personal",
    },
    {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeSlot: "6:00–7:00 AM",
        title: "Exercise",
        emoji: "🏋️",
        category: "Fitness",
    },
    {
        weekdays: [2, 3, 4, 5, 6],
        timeSlot: "6:45–7:00 AM",
        title: "Getting ready for swimming",
        emoji: "🏄",
        category: "Fitness",
    },
    {
        weekdays: [0, 1],
        timeSlot: "7:00–7:30 AM",
        title: "Freshen Up",
        emoji: "🚿",
        category: "Personal",
    },
    {
        weekdays: [2, 3, 4, 5, 6],
        timeSlot: "7:00–7:30 AM",
        title: "Swimming Class",
        emoji: "🏊",
        category: "Fitness",
    },
    {
        weekdays: [0, 1],
        timeSlot: "7:30–8:00 AM",
        title: "Breakfast",
        emoji: "🍳",
        category: "Meals",
    },
    {
        weekdays: [2, 3, 4, 5, 6],
        timeSlot: "7:30–8:00 AM",
        title: "Swimming Class",
        emoji: "🏊",
        category: "Fitness",
    },
    {
        weekdays: [0, 1],
        timeSlot: "8:00–8:30 AM",
        title: "Study Block 1",
        emoji: "📚",
        category: "Study",
    },
    {
        weekdays: [2, 3, 4, 5, 6],
        timeSlot: "8:00–8:30 AM",
        title: "Swimming Class",
        emoji: "🏊",
        category: "Fitness",
    },
    {
        weekdays: [0, 1],
        timeSlot: "8:30–9:00 AM",
        title: "Study Block 1",
        emoji: "📚",
        category: "Study",
    },
    {
        weekdays: [2, 3, 4, 5, 6],
        timeSlot: "8:30–9:00 AM",
        title: "Freshen Up After Swim",
        emoji: "🚿",
        category: "Personal",
    },
    {
        weekdays: [0, 1],
        timeSlot: "9:00–9:30 AM",
        title: "Study Block 1",
        emoji: "📚",
        category: "Study",
    },
    {
        weekdays: [2, 3, 4, 5, 6],
        timeSlot: "9:00–9:30 AM",
        title: "Breakfast",
        emoji: "🍳",
        category: "Meals",
    },
    {
        weekdays: [0, 1, 2, 3, 4],
        timeSlot: "9:30–10:00 AM",
        title: "Study Block 1",
        emoji: "📚",
        category: "Study",
    },
    {
        weekdays: [5],
        timeSlot: "9:30–10:00 AM",
        title: "Study Block 1",
        emoji: "📚",
        category: "Study",
    },
    {
        weekdays: [6],
        timeSlot: "9:30–10:00 AM",
        title: "Leisure Reading",
        emoji: "📖",
        category: "Recreation",
    },
    {
        weekdays: [0, 1],
        timeSlot: "10:00–10:30 AM",
        title: "Short Break",
        emoji: "☕",
        category: "Unwind",
    },
    {
        weekdays: [2, 3, 4],
        timeSlot: "10:00–10:30 AM",
        title: "Study Block 1",
        emoji: "📚",
        category: "Study",
    },
    {
        weekdays: [5],
        timeSlot: "10:00–10:30 AM",
        title: "Study Block 1",
        emoji: "📚",
        category: "Study",
    },
    {
        weekdays: [6],
        timeSlot: "10:00–10:30 AM",
        title: "Hobby / Project",
        emoji: "🎨",
        category: "Recreation",
    },
    {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeSlot: "10:30–12:30 PM",
        title: "Study Block 2",
        emoji: "💻",
        category: "Study",
    },
    {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeSlot: "12:30–1:00 PM",
        title: "Quality Time",
        emoji: "🌺",
        category: "Personal",
    },
    {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeSlot: "1:00–2:00 PM",
        title: "Lunch & Rest",
        emoji: "🍱",
        category: "Meals",
    },
    {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeSlot: "3:00–4:00 PM",
        title: "Study Block 3",
        emoji: "💻",
        category: "Study",
    },
    {
        weekdays: [0, 1, 2, 3, 4],
        timeSlot: "4:00–5:30 PM",
        title: "Gaming / Recreation",
        emoji: "🎮",
        category: "Recreation",
    },
    {
        weekdays: [5, 6],
        timeSlot: "4:00–5:30 PM",
        title: "Outing / Social Time",
        emoji: "🏄",
        category: "Recreation",
    },
    {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeSlot: "5:30–6:00 PM",
        title: "Unwind / Meditation",
        emoji: "🧘",
        category: "Unwind",
    },
    {
        weekdays: [0, 1, 2, 3, 5],
        timeSlot: "6:00–6:30 PM",
        title: "Evening Study",
        emoji: "📚",
        category: "Study",
    },
    {
        weekdays: [4, 6],
        timeSlot: "6:00–6:30 PM",
        title: "Get Ready for Karate",
        emoji: "🥋",
        category: "Fitness",
    },
    {
        weekdays: [0, 1, 2, 3, 5],
        timeSlot: "6:30–8:00 PM",
        title: "Evening Study",
        emoji: "📚",
        category: "Study",
    },
    {
        weekdays: [4, 6],
        timeSlot: "6:30–8:00 PM",
        title: "Karate Class",
        emoji: "🥋",
        category: "Fitness",
    },
    {
        weekdays: [4, 6],
        timeSlot: "8:00–8:30 PM",
        title: "Free Time / Relax",
        emoji: "🎮",
        category: "Recreation",
    },
    {
        weekdays: [0, 1, 2, 3, 5],
        timeSlot: "8:00–8:30 PM",
        title: "Evening Study",
        emoji: "📚",
        category: "Study",
    },
    {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeSlot: "8:30–9:00 PM",
        title: "Dinner",
        emoji: "🍲",
        category: "Meals",
    },
    {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeSlot: "9:00–10:00 PM",
        title: "Gaming / Free Time",
        emoji: "🎮",
        category: "Recreation",
    },
    {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeSlot: "10:00–10:20 PM",
        title: "Wind Down",
        emoji: "🌙",
        category: "Unwind",
    },
    {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeSlot: "10:30 PM",
        title: "Sleep",
        emoji: "😴",
        category: "Unwind",
    },
];
