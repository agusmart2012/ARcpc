"use strict";

const WEEKDAY_NAMES = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function pad(value) {
  return String(value).padStart(2, "0");
}

function clockIn(timeZone, date) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "America/Montevideo",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    return clockIn("UTC", date);
  }
  const get = (type) => {
    const found = parts.find((part) => part.type === type);
    return found ? found.value : "";
  };
  const hour = pad(get("hour") === "24" ? "00" : get("hour"));
  return {
    weekday: WEEKDAY_NAMES[get("weekday")],
    date: get("year") + "-" + get("month") + "-" + get("day"),
    time: hour + ":" + pad(get("minute")),
  };
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function cleanPrefs(raw) {
  const prefs = raw && typeof raw === "object" ? raw : {};
  const days = Array.isArray(prefs.days)
    ? [...new Set(prefs.days.map(Number).filter((day) => day >= 0 && day <= 6))]
    : [1, 2, 3, 4, 5];
  const sessions = Array.isArray(prefs.sessions)
    ? prefs.sessions
        .filter((item) => item && Number.isInteger(Number(item.weekday)))
        .slice(0, 14)
        .map((item) => ({
          weekday: Number(item.weekday),
          label: String(item.label || "").slice(0, 40),
          session: String(item.session || "").slice(0, 40),
          focus: String(item.focus || "").slice(0, 80),
        }))
    : [];
  return {
    remind: Boolean(prefs.remind),
    routine: prefs.routine !== false,
    time: validTime(prefs.time) ? prefs.time : "17:00",
    days: days.length ? days : [1, 2, 3, 4, 5],
    timezone: String(prefs.timezone || "America/Montevideo").slice(0, 80),
    category: String(prefs.category || "M15").slice(0, 40),
    sessions,
  };
}

function reminderText(prefs, clock) {
  const session = (prefs.sessions || []).find((item) => item.weekday === clock.weekday);
  const head = [prefs.category, session && session.label, session && session.session].filter(Boolean).join(" · ");
  const focus = session && session.focus ? " Arranca por " + session.focus + "." : "";
  return {
    title: "Hoy toca sala",
    body: (head || "Te toca entrenar") + "." + focus,
  };
}

function dueReminders(records, date) {
  const due = [];
  for (const record of records || []) {
    if (!record || !record.subscription || !record.prefs || !record.prefs.remind) continue;
    const clock = clockIn(record.prefs.timezone, date);
    if (clock.weekday == null || clock.time !== record.prefs.time) continue;
    if (!record.prefs.days.includes(clock.weekday)) continue;
    if (record.lastRemind === clock.date) continue;
    due.push({ record, clock, note: reminderText(record.prefs, clock) });
  }
  return due;
}

module.exports = { clockIn, cleanPrefs, reminderText, dueReminders, validTime };
