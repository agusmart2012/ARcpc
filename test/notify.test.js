"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { clockIn, cleanPrefs, dueReminders } = require("../lib/notify");

test("el reloj de Montevideo arma la hora del recordatorio", () => {
  const clock = clockIn("UTC", new Date("2026-09-24T17:05:00Z"));
  assert.equal(clock.time, "17:05");
  assert.equal(clock.weekday, 4);
  assert.equal(clock.date, "2026-09-24");
});

test("un recordatorio sale una sola vez en el minuto elegido", () => {
  const record = {
    subscription: { endpoint: "https://push.example/1" },
    lastRemind: "",
    prefs: cleanPrefs({
      remind: true,
      time: "17:00",
      days: [4],
      timezone: "UTC",
      category: "M15",
      sessions: [{ weekday: 4, label: "Jueves", session: "Día 4", focus: "Sentadilla frontal" }],
    }),
  };
  const due = dueReminders([record], new Date("2026-09-24T17:00:00Z"));
  assert.equal(due.length, 1);
  assert.match(due[0].note.body, /M15 · Jueves · Día 4/);
  assert.match(due[0].note.body, /Sentadilla frontal/);

  record.lastRemind = "2026-09-24";
  assert.equal(dueReminders([record], new Date("2026-09-24T17:00:30Z")).length, 0);
  assert.equal(dueReminders([record], new Date("2026-09-24T17:01:00Z")).length, 0);
  record.lastRemind = "";
  record.prefs.remind = false;
  assert.equal(dueReminders([record], new Date("2026-09-24T17:00:00Z")).length, 0);
});
