"use strict";

const fs = require("fs");
const path = require("path");
const webpush = require("web-push");
const { cleanPrefs, dueReminders } = require("./notify");

const DATA = path.join(__dirname, "..", "data");
const SUBS = path.join(DATA, "subscriptions.json");
const VAPID = path.join(DATA, "vapid.json");

let configured = false;

function ensureDir() {
  fs.mkdirSync(DATA, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function vapidKeys() {
  const existing = readJson(VAPID, null);
  if (existing && existing.publicKey && existing.privateKey) return existing;
  const keys = webpush.generateVAPIDKeys();
  ensureDir();
  fs.writeFileSync(VAPID, JSON.stringify(keys, null, 2));
  return keys;
}

function setup() {
  if (configured) return;
  const keys = vapidKeys();
  webpush.setVapidDetails("mailto:sala@carrasco.local", keys.publicKey, keys.privateKey);
  configured = true;
}

function publicKey() {
  return vapidKeys().publicKey;
}

function subscriptions() {
  const list = readJson(SUBS, []);
  return Array.isArray(list) ? list : [];
}

function writeSubscriptions(list) {
  ensureDir();
  fs.writeFileSync(SUBS, JSON.stringify(list, null, 2));
}

function validSubscription(subscription) {
  return Boolean(
    subscription &&
      typeof subscription.endpoint === "string" &&
      subscription.endpoint.startsWith("http") &&
      subscription.keys &&
      subscription.keys.p256dh &&
      subscription.keys.auth
  );
}

function saveSubscription(subscription, prefs) {
  if (!validSubscription(subscription)) {
    const error = new Error("Falta la suscripción del teléfono.");
    error.status = 400;
    throw error;
  }
  const list = subscriptions().filter((item) => item.subscription.endpoint !== subscription.endpoint);
  list.push({
    subscription,
    prefs: cleanPrefs(prefs),
    lastRemind: "",
  });
  writeSubscriptions(list);
  return list[list.length - 1];
}

async function sendTo(record, payload) {
  setup();
  try {
    await webpush.sendNotification(record.subscription, JSON.stringify(payload));
    return true;
  } catch (error) {
    const gone = error && (error.statusCode === 404 || error.statusCode === 410);
    if (gone) {
      writeSubscriptions(subscriptions().filter((item) => item.subscription.endpoint !== record.subscription.endpoint));
    }
    return false;
  }
}

async function dispatchDue(date) {
  const list = subscriptions();
  const due = dueReminders(list, date || new Date());
  for (const item of due) {
    item.record.lastRemind = item.clock.date;
  }
  if (due.length) writeSubscriptions(list);
  for (const item of due) {
    await sendTo(item.record, { title: item.note.title, body: item.note.body, url: "/?tab=avisos" });
  }
  return due.length;
}

async function sendRoutine(title, body, exceptEndpoint) {
  const payload = {
    title: String(title || "Cambió la rutina").slice(0, 80),
    body: String(body || "Hay una planilla nueva.").slice(0, 180),
    url: "/?tab=avisos",
  };
  let sent = 0;
  for (const record of subscriptions()) {
    if (!record.prefs || record.prefs.routine === false) continue;
    if (exceptEndpoint && record.subscription.endpoint === exceptEndpoint) continue;
    if (await sendTo(record, payload)) sent += 1;
  }
  return sent;
}

async function sendTest(endpoint) {
  const record = subscriptions().find((item) => item.subscription.endpoint === endpoint);
  if (!record) return false;
  return sendTo(record, {
    title: "Prueba de la sala",
    body: "Si leés esto, los avisos llegan con la app cerrada.",
    url: "/?tab=avisos",
  });
}

module.exports = {
  publicKey,
  saveSubscription,
  dispatchDue,
  sendRoutine,
  sendTest,
};
