"use strict";

const fs = require("fs");
const path = require("path");
const accounts = require("./accounts");

const DEFAULT_CATEGORIES = [
  { id: "m13", label: "M13" },
  { id: "m15", label: "M15" },
  { id: "m17", label: "M17" },
  { id: "m19", label: "M19" },
  { id: "pre-inter", label: "PRE-INTER" },
  { id: "inter", label: "INTER" },
  { id: "primera", label: "PRIMERA" },
];

const BUILTIN_FILES = { m15: "m15.json" };
let builtinCache = null;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function clip(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function clipNote(value, max) {
  return String(value == null ? "" : value).replace(/\r\n/g, "\n").trim().slice(0, max);
}

function emptyDoc() {
  return {
    categories: DEFAULT_CATEGORIES.map((item) => ({ id: item.id, label: item.label })),
    plans: {},
    hidden: [],
  };
}

function cleanLabel(value) {
  const label = clip(value, 24);
  if (label.length < 2) fail(400, "El nombre tiene que tener entre 2 y 24 letras.");
  if (!/^[\p{L}\p{N} .+-]+$/u.test(label)) fail(400, "Usá letras y números en el nombre.");
  return label;
}

function slug(value) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return text || "cat";
}

function categoryId(value) {
  const id = String(value || "");
  if (!/^[a-z0-9][a-z0-9-]{0,24}$/.test(id)) fail(400, "Esa categoría no está.");
  return id;
}

function findCategory(doc, id) {
  const found = doc.categories.find((item) => item.id === id);
  if (!found) fail(404, "Esa categoría no está.");
  return found;
}

function freshId(doc, label) {
  const base = slug(label);
  if (!doc.categories.some((item) => item.id === base)) return base;
  let n = 2;
  while (doc.categories.some((item) => item.id === (base + "-" + n).slice(0, 24))) n += 1;
  return (base + "-" + n).slice(0, 24);
}

function safeToken(value, max) {
  const token = String(value || "");
  if (/^[a-z0-9][a-z0-9/_:-]{0,80}$/.test(token) && token.length <= max) return token;
  return "";
}

function uniqueToken(base, seen) {
  let token = base || "item";
  if (!seen.has(token)) {
    seen.add(token);
    return token;
  }
  let n = 2;
  while (seen.has(token + "-" + n)) n += 1;
  const next = (token + "-" + n).slice(0, 80);
  seen.add(next);
  return next;
}

function cleanVideos(list) {
  if (!Array.isArray(list)) return [];
  const videos = [];
  for (const item of list) {
    const url = String(item && item.url || "").trim().slice(0, 300);
    if (!/^https:\/\/\S+$/.test(url)) continue;
    const video = { url };
    const label = clip(item.label, 80);
    if (label) video.label = label;
    videos.push(video);
    if (videos.length >= 4) break;
  }
  return videos;
}

function cleanTips(list) {
  if (!Array.isArray(list)) return undefined;
  const tips = [];
  for (const item of list) {
    const label = clip(item && item.label, 40);
    const text = clip(item && item.text, 400);
    if (!label || !text) continue;
    tips.push({ label, text });
    if (tips.length >= 8) break;
  }
  return tips.length ? tips : undefined;
}

function cleanReference(list) {
  if (!Array.isArray(list)) return undefined;
  const rows = [];
  for (const item of list) {
    const rpe = clip(item && item.rpe, 12);
    if (!rpe) continue;
    rows.push({
      rpe,
      feel: clip(item && item.feel, 160),
      rir: clip(item && item.rir, 16),
      rm: clip(item && item.rm, 24),
    });
    if (rows.length >= 12) break;
  }
  return rows.length ? rows : undefined;
}

function cleanRanges(list) {
  if (!Array.isArray(list)) return undefined;
  const rows = [];
  for (const item of list) {
    const label = clip(item && item.label, 80);
    const load = clip(item && item.load, 80);
    if (!label || !load) continue;
    rows.push({ label, load });
    if (rows.length >= 8) break;
  }
  return rows.length ? rows : undefined;
}

function normalizePlan(input, categoryIdValue) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "La planilla no vale.");
  const daysIn = Array.isArray(input.days) ? input.days.slice(0, 21) : [];
  const seenDays = new Set();
  const seenExercises = new Set();
  const days = [];

  for (const day of daysIn) {
    if (!day || typeof day !== "object") continue;
    const label = clip(day.label, 40) || "Día";
    let weekday = null;
    if (day.weekday != null && day.weekday !== "") {
      const number = Number(day.weekday);
      if (Number.isInteger(number) && number >= 0 && number <= 6) weekday = number;
    }
    const rawBlocks = Array.isArray(day.blocks) && day.blocks.length
      ? day.blocks
      : [{ title: "", exercises: Array.isArray(day.exercises) ? day.exercises : [] }];
    const blocks = [];
    let room = 80;
    for (const block of rawBlocks.slice(0, 8)) {
      if (!block || typeof block !== "object" || room <= 0) continue;
      const exercises = [];
      const source = Array.isArray(block.exercises) ? block.exercises : [];
      for (const ex of source) {
        if (!ex || typeof ex !== "object" || room <= 0) continue;
        const name = clip(ex.name, 140);
        if (!name) continue;
        const sets = Math.max(0, Math.min(30, Math.round(Number(ex.sets) || 0)));
        const exercise = { name };
        const id = uniqueToken(safeToken(ex.id, 80) || slug(label) + "/" + slug(name), seenExercises);
        exercise.id = id;
        if (sets) exercise.sets = sets;
        const reps = clip(ex.reps, 80);
        const intensity = clip(ex.intensity, 40);
        const weight = clip(ex.weight, 40);
        const rest = clip(ex.rest, 40);
        const notes = clipNote(ex.notes, 400);
        if (reps) exercise.reps = reps;
        if (intensity && intensity !== "X") exercise.intensity = intensity;
        if (weight) exercise.weight = weight;
        if (rest) exercise.rest = rest;
        if (notes) exercise.notes = notes;
        if (ex.check === true) exercise.check = true;
        const videos = cleanVideos(ex.videos);
        if (videos.length) exercise.videos = videos;
        exercises.push(exercise);
        room -= 1;
      }
      if (!exercises.length) continue;
      const cleanBlock = {
        title: clip(block.title, 80),
        exercises,
      };
      const note = clipNote(block.note, 400);
      if (note) cleanBlock.note = note;
      blocks.push(cleanBlock);
    }
    if (!blocks.length) continue;
    const key = uniqueToken(safeToken(day.key, 60) || (weekday == null ? "c:" : "w" + weekday + ":") + slug(label), seenDays);
    const cleanDay = { key, label, blocks };
    if (weekday != null) cleanDay.weekday = weekday;
    const session = clip(day.session, 40);
    if (session) cleanDay.session = session;
    days.push(cleanDay);
  }

  const exercises = days.reduce(
    (sum, day) => sum + day.blocks.reduce((inner, block) => inner + block.exercises.length, 0),
    0
  );
  const plan = {
    version: 1,
    sourceName: clip(input.sourceName, 140) || "Sala",
    category: categoryIdValue,
    importedAt: clip(input.importedAt, 40) || new Date().toISOString(),
    days,
    warnings: Array.isArray(input.warnings)
      ? input.warnings.map((item) => clip(item, 180)).filter(Boolean).slice(0, 8)
      : [],
    stats: { days: days.length, exercises },
  };
  const week = clip(input.week, 40);
  const period = clip(input.period, 80);
  const notice = clipNote(input.notice, 600);
  const tempo = clipNote(input.tempo, 400);
  if (week) plan.week = week;
  if (period) plan.period = period;
  if (notice) plan.notice = notice;
  if (tempo) plan.tempo = tempo;
  const tips = cleanTips(input.tips);
  const reference = cleanReference(input.reference);
  const ranges = cleanRanges(input.ranges);
  if (tips) plan.tips = tips;
  if (reference) plan.reference = reference;
  if (ranges) plan.ranges = ranges;
  return plan;
}

function normalizeDoc(raw) {
  const base = emptyDoc();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const categories = [];
  const seen = new Set();
  const source = Array.isArray(raw.categories) && raw.categories.length ? raw.categories : base.categories;
  for (const item of source) {
    const id = String(item && item.id || "");
    const label = clip(item && item.label, 24);
    if (!/^[a-z0-9][a-z0-9-]{0,24}$/.test(id) || label.length < 2 || seen.has(id)) continue;
    seen.add(id);
    categories.push({ id, label });
    if (categories.length >= 24) break;
  }
  if (!categories.length) return base;
  const plans = {};
  const hidden = [];
  const hide = new Set(Array.isArray(raw.hidden) ? raw.hidden.map((item) => String(item)) : []);
  for (const cat of categories) {
    if (hide.has(cat.id)) hidden.push(cat.id);
    const plan = raw.plans && raw.plans[cat.id];
    if (!plan || typeof plan !== "object") continue;
    try {
      plans[cat.id] = normalizePlan(plan, cat.id);
    } catch {
      /* planilla rota */
    }
  }
  return { categories, plans, hidden };
}

function loadBuiltins() {
  if (builtinCache) return builtinCache;
  const dir = path.join(__dirname, "..", "public", "routines");
  const builtins = {};
  for (const [id, file] of Object.entries(BUILTIN_FILES)) {
    try {
      const plan = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (plan && plan.version === 1 && Array.isArray(plan.days)) builtins[id] = plan;
    } catch {
      /* sin archivo */
    }
  }
  builtinCache = builtins;
  return builtins;
}

function pack(doc) {
  return {
    categories: doc.categories,
    plans: doc.plans,
    hidden: doc.hidden,
    builtins: loadBuiltins(),
  };
}

async function publicView() {
  const doc = normalizeDoc(await accounts.getClubDoc());
  return {
    categories: doc.categories,
    plans: doc.plans,
    hidden: doc.hidden,
  };
}

async function adminView() {
  return pack(normalizeDoc(await accounts.getClubDoc()));
}

function mutate(fn) {
  return accounts.updateClubDoc(async (raw) => fn(normalizeDoc(raw)));
}

async function addCategory(label) {
  const name = cleanLabel(label);
  return pack(await mutate((doc) => {
    if (doc.categories.some((item) => item.label.toLowerCase() === name.toLowerCase())) {
      fail(409, "Ya hay una categoría con ese nombre.");
    }
    if (doc.categories.length >= 24) fail(400, "Ya hay demasiadas categorías.");
    doc.categories.push({ id: freshId(doc, name), label: name });
    return doc;
  }));
}

async function renameCategory(id, label) {
  const key = categoryId(id);
  const name = cleanLabel(label);
  return pack(await mutate((doc) => {
    const found = findCategory(doc, key);
    if (doc.categories.some((item) => item.id !== key && item.label.toLowerCase() === name.toLowerCase())) {
      fail(409, "Ya hay una categoría con ese nombre.");
    }
    found.label = name;
    return doc;
  }));
}

async function moveCategory(id, dir) {
  const key = categoryId(id);
  const step = Number(dir) < 0 ? -1 : 1;
  return pack(await mutate((doc) => {
    const index = doc.categories.findIndex((item) => item.id === key);
    if (index < 0) fail(404, "Esa categoría no está.");
    const next = index + step;
    if (next < 0 || next >= doc.categories.length) return doc;
    const [item] = doc.categories.splice(index, 1);
    doc.categories.splice(next, 0, item);
    return doc;
  }));
}

async function removeCategory(id) {
  const key = categoryId(id);
  return pack(await mutate((doc) => {
    if (doc.categories.length <= 1) fail(400, "Tiene que quedar al menos una categoría.");
    if (!doc.categories.some((item) => item.id === key)) fail(404, "Esa categoría no está.");
    doc.categories = doc.categories.filter((item) => item.id !== key);
    delete doc.plans[key];
    doc.hidden = doc.hidden.filter((item) => item !== key);
    return doc;
  }));
}

async function savePlan(id, plan) {
  const key = categoryId(id);
  const clean = normalizePlan(plan, key);
  return pack(await mutate((doc) => {
    findCategory(doc, key);
    doc.plans[key] = clean;
    doc.hidden = doc.hidden.filter((item) => item !== key);
    return doc;
  }));
}

async function clearPlan(id) {
  const key = categoryId(id);
  return pack(await mutate((doc) => {
    findCategory(doc, key);
    delete doc.plans[key];
    if (BUILTIN_FILES[key]) {
      if (!doc.hidden.includes(key)) doc.hidden.push(key);
    } else {
      doc.hidden = doc.hidden.filter((item) => item !== key);
    }
    return doc;
  }));
}

async function restorePlan(id) {
  const key = categoryId(id);
  if (!BUILTIN_FILES[key]) fail(400, "Esta categoría no tiene planilla original.");
  return pack(await mutate((doc) => {
    findCategory(doc, key);
    delete doc.plans[key];
    doc.hidden = doc.hidden.filter((item) => item !== key);
    return doc;
  }));
}

module.exports = {
  publicView,
  adminView,
  addCategory,
  renameCategory,
  moveCategory,
  removeCategory,
  savePlan,
  clearPlan,
  restorePlan,
};
