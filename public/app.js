const KEYS = {
  category: "cpc.category",
  overrides: "cpc.overrides",
  log: "cpc.log",
  cycle: "cpc.cycle",
  chat: "cpc.chat",
};
const CATEGORIES = [
  { id: "m13", label: "M13" },
  { id: "m15", label: "M15" },
  { id: "m17", label: "M17" },
  { id: "m19", label: "M19" },
  { id: "pre-inter", label: "PRE-INTER" },
  { id: "inter", label: "INTER" },
  { id: "primera", label: "PRIMERA" },
];
const BUILTIN_FILES = { m15: "/routines/m15.json" };
const WEEK = [
  [1, "Lunes"],
  [2, "Martes"],
  [3, "Miércoles"],
  [4, "Jueves"],
  [5, "Viernes"],
  [6, "Sábado"],
  [0, "Domingo"],
];
const SUGGESTIONS = [
  "¿Cómo caliento esta sesión?",
  "Explicame la parte central de hoy",
  "¿Qué hago si no llego al porcentaje?",
  "¿El peso que anoté está bien para el RIR?",
];

const fileInput = document.getElementById("file");
const importBtn = document.getElementById("import-btn");
const main = document.getElementById("main");
const composer = document.getElementById("composer");
const chips = document.getElementById("chips");
const coachInput = document.getElementById("coach-input");
const coachSend = document.getElementById("coach-send");
const overlay = document.getElementById("overlay");
const sheetTitle = document.getElementById("sheet-title");
const sheetBody = document.getElementById("sheet-body");
const app = document.getElementById("app");
const phone = document.getElementById("phone");

const storedCategory = load(KEYS.category);
const storedOverrides = load(KEYS.overrides);
const storedLog = load(KEYS.log);
const storedChat = load(KEYS.chat);

const state = {
  tab: "hoy",
  category: CATEGORIES.some((item) => item.id === storedCategory) ? storedCategory : "m15",
  overrides: objectBag(storedOverrides),
  builtins: {},
  plan: null,
  log: objectBag(storedLog),
  cycle: objectBag(load(KEYS.cycle)),
  chat: objectBag(storedChat),
  focusKey: null,
  ai: false,
  importing: false,
  coachBusy: false,
  ready: false,
  loadError: "",
};

let importLock = false;
let dismissSheet = null;
let videoToken = 0;
let toastTimer = 0;

function objectBag(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function load(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast("No pude guardar en este teléfono.");
  }
}

function validPlan(plan) {
  return Boolean(plan && plan.version === 1 && Array.isArray(plan.days));
}

function categoryLabel() {
  const found = CATEGORIES.find((item) => item.id === state.category);
  return found ? found.label : "Categoría";
}

function planFor(id) {
  const override = state.overrides[id];
  if (validPlan(override)) return override;
  const builtin = state.builtins[id];
  if (validPlan(builtin)) return builtin;
  return null;
}

function messages() {
  if (!Array.isArray(state.chat[state.category])) state.chat[state.category] = [];
  return state.chat[state.category];
}

function currentCycle() {
  const cycle = state.cycle[state.category];
  return cycle && cycle.anchor ? cycle : null;
}

function todayKey(date = new Date()) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function daysBetween(start, end) {
  const a = start.split("-").map(Number);
  const b = end.split("-").map(Number);
  const from = Date.UTC(a[0], a[1] - 1, a[2]);
  const to = Date.UTC(b[0], b[1] - 1, b[2]);
  return Math.round((to - from) / 86400000);
}

function cap(text) {
  const value = String(text || "");
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function longDate(date = new Date()) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function shortDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" }).format(date);
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "onclick" || key === "oninput") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, String(value));
  }
  const list = Array.isArray(children) ? children : children == null ? [] : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function humanError(error, fallback) {
  if (error && error.message === "Failed to fetch") return "No llegué a la compu donde corre la app.";
  return (error && error.message) || fallback;
}

function toast(text) {
  const node = document.getElementById("toast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 3200);
}

function logBag() {
  if (!state.log[state.category] || typeof state.log[state.category] !== "object") state.log[state.category] = {};
  const bag = state.log[state.category];
  const key = todayKey();
  if (!bag[key] || typeof bag[key] !== "object") bag[key] = {};
  return bag[key];
}

function entryFor(id) {
  const entry = logBag()[id];
  if (!entry || typeof entry !== "object") return { sets: [], weight: "" };
  return {
    sets: Array.isArray(entry.sets) ? entry.sets : [],
    weight: typeof entry.weight === "string" ? entry.weight : "",
  };
}

function ensureCycle() {
  if (!state.plan || state.plan.days.some((day) => day.weekday != null)) return;
  if (currentCycle()) return;
  state.cycle[state.category] = { anchor: todayKey(), offset: 0 };
  save(KEYS.cycle, state.cycle);
}

function automaticDay(plan) {
  if (!plan || !plan.days.length) return { day: null, cycle: false, index: -1 };
  if (plan.days.some((day) => day.weekday != null)) {
    return {
      day: plan.days.find((day) => day.weekday === new Date().getDay()) || null,
      cycle: false,
      index: -1,
    };
  }
  const cycle = currentCycle() || { anchor: todayKey(), offset: 0 };
  const delta = daysBetween(cycle.anchor, todayKey()) + Number(cycle.offset || 0);
  const index = ((delta % plan.days.length) + plan.days.length) % plan.days.length;
  return { day: plan.days[index], cycle: true, index };
}

function nextTraining(plan) {
  const weekday = new Date().getDay();
  for (let step = 1; step <= 7; step += 1) {
    const day = plan.days.find((item) => item.weekday === (weekday + step) % 7);
    if (day) return { day, inDays: step };
  }
  return null;
}

function repText(reps) {
  const specified = /[A-Za-zÁÉÍÓÚáéíóú]/.test(reps) || /["'′″×+]/.test(reps) || /rep/i.test(reps);
  return specified ? reps : reps + " reps";
}

function intensityText(value) {
  if (/rir|%|int/i.test(value)) return value;
  return "Int. " + value;
}

function meta(ex) {
  const parts = [];
  if (ex.sets) {
    const label = ex.setsLabel && ex.setsLabel !== String(ex.sets) ? ex.setsLabel : String(ex.sets);
    parts.push(label + (Number(ex.sets) === 1 ? " serie" : " series"));
  }
  if (ex.reps) parts.push(repText(ex.reps));
  if (ex.intensity && ex.intensity !== "X") parts.push(intensityText(ex.intensity));
  else if (ex.weight) parts.push(ex.weight);
  if (ex.rest) parts.push(/pausa|descanso/i.test(ex.rest) ? ex.rest : "descanso " + ex.rest);
  return parts.join(" · ");
}

function videosOf(ex) {
  return (Array.isArray(ex.videos) ? ex.videos : []).filter((item) => item && /^https:\/\//.test(item.url));
}

function seriesOf(day) {
  let total = 0;
  let done = 0;
  for (const block of day.blocks) {
    for (const ex of block.exercises) {
      const count = ex.sets || 1;
      total += count;
      done += Math.min(count, entryFor(ex.id).sets.filter(Boolean).length);
    }
  }
  return { total, done };
}

function tallyText(progress) {
  const noun = progress.total === 1 ? " serie" : " series";
  if (progress.total > 0 && progress.done === progress.total) return "Listo · " + progress.total + noun;
  return progress.done + " de " + progress.total + noun;
}

function exerciseCount(day) {
  return day.blocks.reduce((sum, block) => sum + block.exercises.length, 0);
}

function agenda(plan) {
  if (!plan.days.some((day) => day.weekday != null)) {
    return plan.days.map((day) => ({ day, rest: false, label: day.label, weekday: null }));
  }
  const rows = WEEK.map(([weekday, label]) => {
    const day = plan.days.find((item) => item.weekday === weekday);
    return day ? { day, rest: false, label: day.label, weekday } : { day: null, rest: true, label, weekday };
  });
  const shown = new Set(rows.filter((row) => row.day).map((row) => row.day.key));
  for (const day of plan.days) {
    if (!shown.has(day.key)) rows.push({ day, rest: false, label: day.label, weekday: day.weekday });
  }
  return rows;
}

function routineContext() {
  const head = "Categoría " + categoryLabel() + ". Rugby, sala de alto rendimiento del Carrasco Polo Club.";
  if (!state.plan) return head + " Todavía no hay una rutina cargada en esta categoría.";
  const auto = automaticDay(state.plan);
  const picked = state.focusKey ? state.plan.days.find((day) => day.key === state.focusKey) : null;
  const day = picked || auto.day;
  if (!day) {
    const next = nextTraining(state.plan);
    return head + (next ? " Hoy no hay rutina. La próxima es " + next.day.label + "." : " Hoy no hay rutina cargada.");
  }
  const lines = [head];
  if (state.plan.week || state.plan.period) {
    lines.push(["Semana " + (state.plan.week || ""), state.plan.period].filter(Boolean).join(" · "));
  }
  if (state.plan.tempo) lines.push(state.plan.tempo);
  lines.push("Día: " + [day.session, day.label].filter(Boolean).join(" · "));
  let number = 1;
  for (const block of day.blocks) {
    if (block.title) lines.push(block.title);
    for (const ex of block.exercises) {
      const entry = entryFor(ex.id);
      const done = entry.sets.filter(Boolean).length;
      const total = ex.sets || 1;
      let line = number + ". " + ex.name + " — " + (meta(ex) || "sin detalle") + ". Marcadas hoy: " + done + "/" + total;
      if (entry.weight) line += ". Kilos anotados: " + entry.weight;
      if (ex.notes) line += ". Obs: " + ex.notes;
      lines.push(line);
      number += 1;
    }
  }
  return lines.join("\n").slice(0, 5000);
}

function closeSheet() {
  overlay.hidden = true;
  app.inert = false;
  sheetBody.replaceChildren();
  const finish = dismissSheet;
  dismissSheet = null;
  if (finish) finish();
}

function openSheet(title, nodes, onDismiss) {
  videoToken += 1;
  dismissSheet = onDismiss || null;
  sheetTitle.textContent = title;
  sheetBody.replaceChildren(...nodes);
  overlay.hidden = false;
  app.inert = true;
}

function ask(title, copy, okLabel) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dismissSheet = null;
      closeSheet();
      resolve(value);
    };
    openSheet(
      title,
      [
        el("p", { class: "sheet-copy" }, copy),
        el("div", { class: "sheet-actions" }, [
          el("button", { class: "btn ghost", type: "button", onclick: () => finish(false) }, "Cancelar"),
          el("button", { class: "btn primary", type: "button", onclick: () => finish(true) }, okLabel),
        ]),
      ],
      () => finish(false)
    );
  });
}

function videoCard(video) {
  return el("li", {}, el("a", {
    class: "video",
    href: "https://www.youtube.com/watch?v=" + video.id,
    target: "_blank",
    rel: "noopener noreferrer",
  }, [
    el("img", {
      src: "https://i.ytimg.com/vi/" + video.id + "/hqdefault.jpg",
      alt: "",
      referrerpolicy: "no-referrer",
    }),
    el("span", {}, [
      el("strong", {}, video.title),
      el("small", {}, [video.author, video.length].filter(Boolean).join(" · ")),
    ]),
  ]));
}

async function openVideos(ex) {
  openSheet(ex.name, [el("p", { class: "sheet-copy" }, "Buscando videos de la técnica…")]);
  const token = videoToken;
  try {
    const response = await fetch("/api/videos?q=" + encodeURIComponent(ex.name));
    const data = await response.json().catch(() => ({}));
    if (token !== videoToken || overlay.hidden) return;
    if (!response.ok) throw new Error(data.message || "No pude buscar videos.");
    const videos = (data.videos || []).filter((video) => video && /^[\w-]{11}$/.test(video.id) && video.title);
    if (!videos.length) {
      sheetBody.replaceChildren(el("p", { class: "sheet-copy" }, "No encontré videos para este nombre."));
      return;
    }
    sheetBody.replaceChildren(el("ul", { class: "videos" }, videos.map(videoCard)));
  } catch (error) {
    if (token !== videoToken || overlay.hidden) return;
    sheetBody.replaceChildren(el("p", { class: "sheet-copy" }, error.message || "Sin conexión con la compu."));
  }
}

function toggleSet(ex, index) {
  const current = entryFor(ex.id);
  const total = ex.sets || 1;
  const sets = Array.from({ length: total }, (_, i) => Boolean(current.sets[i]));
  sets[index] = !sets[index];
  logBag()[ex.id] = { sets, weight: current.weight };
  save(KEYS.log, state.log);
  render();
}

function setWeight(ex, value) {
  const current = entryFor(ex.id);
  const total = ex.sets || 1;
  const sets = Array.from({ length: total }, (_, i) => Boolean(current.sets[i]));
  logBag()[ex.id] = { sets, weight: value.slice(0, 24) };
  save(KEYS.log, state.log);
}

function videoAction(ex) {
  const videos = videosOf(ex);
  if (videos.length === 1) {
    return el("a", {
      class: "tech",
      href: videos[0].url,
      target: "_blank",
      rel: "noopener noreferrer",
    }, "Video");
  }
  if (videos.length > 1) {
    return el("button", { type: "button", class: "tech", onclick: () => openLinks(ex, videos) }, "Videos");
  }
  if (ex.check) return null;
  return el("button", { type: "button", class: "tech", onclick: () => openVideos(ex) }, "Técnica");
}

function openLinks(ex, videos) {
  openSheet(ex.name, [
    el("ul", { class: "link-list" }, videos.map((video) => el("li", {}, el("a", {
      href: video.url,
      target: "_blank",
      rel: "noopener noreferrer",
    }, video.label || "Video")))),
  ]);
}

function exerciseCard(ex, number) {
  const entry = entryFor(ex.id);
  const total = ex.sets || 1;
  const done = Array.from({ length: total }, (_, i) => Boolean(entry.sets[i])).every(Boolean);
  const buttons = [];
  for (let i = 0; i < total; i += 1) {
    const on = Boolean(entry.sets[i]);
    buttons.push(el("button", {
      type: "button",
      class: "set" + (on ? " on" : "") + (ex.sets ? "" : " wide"),
      "aria-pressed": on ? "true" : "false",
      "aria-label": ex.sets ? "Serie " + (i + 1) + (on ? " hecha" : " pendiente") : (on ? "Ejercicio hecho" : "Marcar hecho"),
      onclick: () => toggleSet(ex, i),
    }, ex.sets ? String(i + 1) : "Hecho"));
  }
  const foot = [el("div", { class: "sets" }, buttons)];
  if (!ex.check) {
    foot.push(el("input", {
      class: "weight",
      type: "text",
      inputmode: "decimal",
      maxlength: "24",
      placeholder: "kg",
      value: entry.weight,
      autocomplete: "off",
      autocorrect: "off",
      spellcheck: "false",
      "aria-label": "Kilos de hoy para " + ex.name,
      oninput: (event) => setWeight(ex, event.target.value),
    }));
  }
  return el("article", { class: "card" + (done ? " done" : "") }, [
    el("div", { class: "card-top" }, [
      el("span", { class: "idx" }, String(number).padStart(2, "0")),
      el("h3", { class: "name" }, ex.name),
      videoAction(ex),
    ]),
    meta(ex) ? el("p", { class: "meta" }, meta(ex)) : null,
    ex.notes ? el("p", { class: "note-line" }, ex.notes) : null,
    el("div", { class: "card-foot" }, foot),
  ]);
}

function progressBar(progress) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const bar = el("div", {
    class: "progress",
    role: "progressbar",
    "aria-valuemin": "0",
    "aria-valuemax": String(progress.total),
    "aria-valuenow": String(progress.done),
    "aria-label": "Series de hoy",
  });
  const fill = document.createElement("span");
  fill.style.width = pct + "%";
  bar.append(fill);
  return bar;
}

function loadingState() {
  return [
    el("p", { class: "kicker" }, "Carrasco Polo Club"),
    el("h1", {}, categoryLabel()),
    el("p", { class: "lead" }, "Cargando la planilla…"),
  ];
}

function emptyCategory() {
  if (state.category === "m15" && state.loadError) {
    return [
      el("p", { class: "kicker" }, "Sala de alto rendimiento"),
      el("h1", {}, "M15"),
      el("p", { class: "lead" }, "No llegué a leer la planilla de M15. La compu tiene que estar prendida."),
      el("button", { class: "btn primary", type: "button", onclick: () => location.reload() }, "Reintentar"),
    ];
  }
  const nodes = [
    el("p", { class: "kicker" }, "Sala de alto rendimiento"),
    el("h1", {}, categoryLabel()),
    el("p", { class: "lead" }, "Esta categoría todavía no tiene planilla. Cuando esté, va a aparecer día por día, igual que M15."),
  ];
  if (state.category !== "m15" && state.builtins.m15) {
    nodes.push(el("button", { class: "btn primary", type: "button", onclick: () => selectCategory("m15") }, "Ver M15"));
  }
  nodes.push(el("button", {
    class: "btn ghost",
    type: "button",
    disabled: state.importing ? "" : null,
    onclick: () => fileInput.click(),
  }, state.importing ? "Leyendo…" : "Subir planilla de " + categoryLabel()));
  return nodes;
}

function openPlanilla() {
  const plan = state.plan;
  if (!plan) return;
  const nodes = [];
  if (plan.notice) nodes.push(el("p", { class: "sheet-copy" }, plan.notice));
  if (plan.tempo) {
    nodes.push(el("h3", { class: "sheet-label" }, "Tempo"));
    nodes.push(el("p", { class: "sheet-copy" }, plan.tempo));
  }
  for (const tip of plan.tips || []) {
    nodes.push(el("h3", { class: "sheet-label" }, tip.label));
    nodes.push(el("p", { class: "sheet-copy" }, tip.text));
  }
  if (Array.isArray(plan.reference) && plan.reference.length) {
    nodes.push(el("h3", { class: "sheet-label" }, "RPE"));
    nodes.push(el("table", { class: "rpe" }, [
      el("thead", {}, el("tr", {}, ["RPE", "Percepción", "RIR", "RM"].map((label) => el("th", {}, label)))),
      el("tbody", {}, plan.reference.map((row) => el("tr", {}, [
        el("td", {}, row.rpe),
        el("td", {}, row.feel),
        el("td", {}, row.rir),
        el("td", {}, row.rm),
      ]))),
    ]));
  }
  if (Array.isArray(plan.ranges) && plan.ranges.length) {
    nodes.push(el("h3", { class: "sheet-label" }, "Rango de repetición"));
    nodes.push(el("ul", { class: "range-list" }, plan.ranges.map((row) => el("li", {}, row.label + " · " + row.load))));
  }
  openSheet(categoryLabel() + " · planilla", nodes);
}

function clearVisibleMarks(day) {
  const bag = logBag();
  for (const block of day.blocks) {
    for (const ex of block.exercises) delete bag[ex.id];
  }
  save(KEYS.log, state.log);
  render();
}

function shiftCycle(by) {
  const current = currentCycle() || { anchor: todayKey(), offset: 0 };
  current.offset = Number(current.offset || 0) + by;
  state.cycle[state.category] = current;
  save(KEYS.cycle, state.cycle);
  state.focusKey = null;
  render();
}

function selectCategory(id) {
  if (!CATEGORIES.some((item) => item.id === id) || id === state.category) return;
  state.category = id;
  state.focusKey = null;
  state.plan = planFor(id);
  save(KEYS.category, id);
  ensureCycle();
  render({ resetScroll: true, centerCat: true });
}

function viewHoy() {
  if (!state.plan) {
    if (!state.ready && state.category === "m15" && !state.overrides.m15) return loadingState();
    return emptyCategory();
  }
  const auto = automaticDay(state.plan);
  const picked = state.focusKey ? state.plan.days.find((day) => day.key === state.focusKey) : null;
  const day = picked || auto.day;
  const nodes = [el("p", { class: "kicker" }, categoryLabel() + " · " + cap(longDate()))];
  if (!day) {
    nodes.push(el("h1", {}, "Descanso"));
    const next = nextTraining(state.plan);
    if (!next) {
      nodes.push(el("p", { class: "lead" }, "Este día de la semana no tiene ejercicios."));
      return nodes;
    }
    const when = next.inDays === 1 ? "Mañana" : "En " + next.inDays + " días";
    nodes.push(el("p", { class: "lead" }, when + " toca " + next.day.label + "."));
    nodes.push(el("button", {
      class: "btn primary",
      type: "button",
      onclick: () => {
        state.focusKey = next.day.key;
        render({ resetScroll: true });
      },
    }, "Ver " + next.day.label));
    return nodes;
  }

  const different = !auto.day || day.key !== auto.day.key;
  if (different) {
    nodes.push(el("div", { class: "banner" }, [
      el("p", {}, "Estás viendo " + day.label + ". Las series se anotan en el día de hoy."),
      el("button", { type: "button", onclick: () => { state.focusKey = null; render({ resetScroll: true }); } }, "Volver a hoy"),
    ]));
  }
  nodes.push(el("h1", {}, day.label));
  const sessionBits = [day.session, state.plan.week ? "Semana " + state.plan.week : "", state.plan.period].filter(Boolean);
  if (sessionBits.length) nodes.push(el("p", { class: "fine" }, sessionBits.join(" · ")));
  const progress = seriesOf(day);
  nodes.push(el("p", { class: "tally" }, tallyText(progress)));
  nodes.push(progressBar(progress));
  if (state.plan.tempo || (state.plan.tips && state.plan.tips.length) || (state.plan.reference && state.plan.reference.length)) {
    nodes.push(el("button", { class: "text-btn planilla-link", type: "button", onclick: () => openPlanilla() }, "Tempo, cargas y RPE"));
  }
  if (auto.cycle && !different) {
    nodes.push(el("div", { class: "cycle" }, [
      el("span", {}, "Día " + (auto.index + 1) + " de " + state.plan.days.length),
      el("button", { class: "text-btn", type: "button", onclick: () => shiftCycle(-1) }, "Anterior"),
      el("button", { class: "text-btn", type: "button", onclick: () => shiftCycle(1) }, "Saltear"),
    ]));
  }
  let number = 0;
  for (const block of day.blocks) {
    if (block.title) nodes.push(el("h2", { class: "block-title" }, block.title));
    if (block.note) nodes.push(el("p", { class: "block-note" }, block.note));
    for (const ex of block.exercises) {
      number += 1;
      nodes.push(exerciseCard(ex, number));
    }
  }
  if (progress.done > 0) {
    nodes.push(el("button", { class: "text-btn", type: "button", onclick: () => clearVisibleMarks(day) }, "Borrar marcas de hoy"));
  }
  return nodes;
}

function dayRow(row, auto) {
  const isToday = (row.day && auto.day && row.day.key === auto.day.key) || (row.rest && row.weekday === new Date().getDay());
  if (row.rest) {
    return el("div", { class: "day rest" }, [
      el("strong", {}, row.label),
      el("em", {}, isToday ? "Hoy" : "Descanso"),
    ]);
  }
  const count = exerciseCount(row.day);
  const titles = row.day.blocks.map((block) => block.title).filter(Boolean);
  const preview = titles.length
    ? titles.slice(0, 3).join(" · ")
    : row.day.blocks[0].exercises.slice(0, 2).map((ex) => ex.name).join(" · ");
  const session = row.day.session ? row.day.session + " · " : "";
  return el("button", {
    class: "day",
    type: "button",
    onclick: () => {
      state.focusKey = row.day.key;
      state.tab = "hoy";
      render({ resetScroll: true });
    },
  }, [
    el("strong", {}, row.label),
    el("em", {}, isToday ? "Hoy · " + (row.day.session || count + " ejercicios") : session + count + (count === 1 ? " ejercicio" : " ejercicios")),
    el("span", {}, preview),
  ]);
}

async function deletePlan() {
  const builtin = validPlan(state.builtins[state.category]);
  const override = validPlan(state.overrides[state.category]);
  if (override && builtin) {
    const ok = await ask(
      "Volver a la planilla",
      "Se quita el archivo subido en " + categoryLabel() + " y vuelve la rutina del club.",
      "Restaurar"
    );
    if (!ok) return;
    delete state.overrides[state.category];
    save(KEYS.overrides, state.overrides);
    state.plan = planFor(state.category);
    state.focusKey = null;
    render({ resetScroll: true });
    return;
  }
  if (!override && builtin) {
    toast("La planilla de " + categoryLabel() + " es la del club.");
    return;
  }
  const ok = await ask("Borrar rutina", "Se borra de este teléfono la planilla de " + categoryLabel() + ".", "Borrar");
  if (!ok) return;
  delete state.overrides[state.category];
  save(KEYS.overrides, state.overrides);
  state.plan = null;
  state.focusKey = null;
  state.tab = "hoy";
  render({ resetScroll: true });
}

function viewSemana() {
  if (!state.plan) {
    if (!state.ready && state.category === "m15" && !state.overrides.m15) return loadingState();
    return emptyCategory();
  }
  const auto = automaticDay(state.plan);
  const override = validPlan(state.overrides[state.category]);
  const when = override ? shortDate(state.plan.importedAt) : "";
  const nodes = [
    el("p", { class: "kicker" }, [state.plan.week ? "Semana " + state.plan.week : "Plan", state.plan.period].filter(Boolean).join(" · ")),
    el("h1", {}, categoryLabel()),
    el("p", { class: "fine" }, "Cada fila es un día de la planilla."),
  ];
  for (const row of agenda(state.plan)) nodes.push(dayRow(row, auto));
  if (state.plan.warnings && state.plan.warnings.length) {
    nodes.push(el("p", { class: "fine" }, state.plan.warnings.join(" ")));
  }
  const foot = [
    el("p", { class: "fine" }, [state.plan.sourceName, when].filter(Boolean).join(" · ")),
    el("button", { class: "text-btn", type: "button", onclick: () => fileInput.click() }, "Subir otra planilla"),
  ];
  if (override) {
    foot.push(el("button", {
      class: "text-btn danger",
      type: "button",
      onclick: () => deletePlan(),
    }, validPlan(state.builtins[state.category]) ? "Volver a la planilla del club" : "Borrar rutina"));
  }
  nodes.push(el("footer", { class: "plan-foot" }, foot));
  return nodes;
}

function formatCoach(text) {
  const frag = document.createDocumentFragment();
  for (const block of String(text || "").split(/\n{2,}/)) {
    if (!block.trim()) continue;
    const p = document.createElement("p");
    block.split("\n").forEach((line, index) => {
      if (index) p.append(document.createElement("br"));
      const pattern = /\*\*(.+?)\*\*/g;
      let last = 0;
      let match;
      while ((match = pattern.exec(line))) {
        p.append(line.slice(last, match.index));
        const strong = document.createElement("strong");
        strong.textContent = match[1];
        p.append(strong);
        last = match.index + match[0].length;
      }
      p.append(line.slice(last));
    });
    frag.append(p);
  }
  if (!frag.childNodes.length) frag.append(document.createElement("p"));
  return frag;
}

function viewCoach() {
  const nodes = [
    el("p", { class: "kicker" }, state.ai ? "Grok" : "Sin conectar"),
    el("h1", {}, "Coach"),
  ];
  if (!state.ai) {
    nodes.push(el("section", { class: "setup" }, [
      el("h2", {}, "El coach corre en la compu"),
      el("p", {}, "La rutina y las series funcionan igual. Para preguntar, creá una clave en console.x.ai, copiá .env.example a .env dentro de la carpeta gym y pegá XAI_API_KEY. Reiniciá la app."),
      el("a", { class: "text-btn", href: "https://console.x.ai", target: "_blank", rel: "noopener noreferrer" }, "Abrir console.x.ai"),
    ]));
  }
  const thread = messages();
  if (!thread.length && !state.coachBusy) {
    nodes.push(el("p", { class: "lead" }, state.plan ? "Sabe la planilla de " + categoryLabel() + " y las series que marcaste hoy." : "Cuando " + categoryLabel() + " tenga planilla, la tiene en cuenta."));
  }
  for (const message of thread) {
    const kind = message.role === "user" ? "user" : message.role === "note" ? "note" : "coach";
    nodes.push(el("div", { class: "msg " + kind }, formatCoach(message.content)));
  }
  if (state.coachBusy) {
    nodes.push(el("div", { class: "msg coach", id: "coach-stream" }, el("p", { class: "fine" }, "Pensando…")));
  }
  if (thread.length && !state.coachBusy) {
    nodes.push(el("button", {
      class: "text-btn",
      type: "button",
      onclick: () => {
        state.chat[state.category] = [];
        save(KEYS.chat, state.chat);
        render();
      },
    }, "Borrar conversación"));
  }
  return nodes;
}

function view() {
  if (state.tab === "semana") return viewSemana();
  if (state.tab === "coach") return viewCoach();
  return viewHoy();
}

function render(options) {
  const keep = options && options.resetScroll ? 0 : main.scrollTop;
  main.replaceChildren(...view());
  main.scrollTop = options && options.stick ? main.scrollHeight : keep;
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.setAttribute("aria-selected", button.dataset.tab === state.tab ? "true" : "false");
  }
  for (const button of document.querySelectorAll("[data-cat]")) {
    const on = button.dataset.cat === state.category;
    button.setAttribute("aria-selected", on ? "true" : "false");
    if (on && options && options.centerCat) button.scrollIntoView({ inline: "center", block: "nearest" });
  }
  composer.hidden = state.tab !== "coach";
  coachSend.disabled = Boolean(state.coachBusy);
  importBtn.setAttribute("aria-busy", state.importing ? "true" : "false");
  chips.replaceChildren();
  const showChips = state.tab === "coach" && !state.coachBusy && !messages().some((message) => message.role === "user");
  if (showChips) {
    for (const text of SUGGESTIONS) {
      chips.append(el("button", { type: "button", class: "chip", onclick: () => sendCoach(text) }, text));
    }
  }
}

function applyPlan(plan) {
  state.overrides[state.category] = plan;
  save(KEYS.overrides, state.overrides);
  state.plan = plan;
  state.focusKey = null;
  if (!plan.days.some((day) => day.weekday != null)) {
    state.cycle[state.category] = { anchor: todayKey(), offset: 0 };
    save(KEYS.cycle, state.cycle);
  }
  state.tab = "hoy";
  const extra = plan.warnings && plan.warnings.length ? " Revisá la semana." : "";
  toast(categoryLabel() + " · " + plan.stats.days + " días · " + plan.stats.exercises + " ejercicios." + extra);
}

async function upload(buffer, name) {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "X-Filename": encodeURIComponent(name) },
    body: buffer,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "No pude importar ese archivo.");
  return data;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No pude leer el archivo en el teléfono."));
    reader.readAsArrayBuffer(file);
  });
}

async function importFile(file) {
  if (!file || importLock) return;
  if (!/\.(xlsx|xls|csv|txt|pdf)$/i.test(file.name)) {
    toast("Tiene que ser un Excel, un CSV o un PDF.");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast("El archivo pasa de 8 MB.");
    return;
  }
  importLock = true;
  let applied = false;
  try {
    if (state.plan) {
      const ok = await ask(
        "Reemplazar " + categoryLabel(),
        "La planilla de " + categoryLabel() + " en este teléfono se cambia por este archivo. Las otras categorías no se tocan.",
        "Reemplazar"
      );
      if (!ok) return;
    }
    state.importing = true;
    toast(file.name.toLowerCase().endsWith(".pdf") ? "Leyendo el PDF…" : "Leyendo el archivo…");
    render();
    applyPlan(await upload(await readFile(file), file.name));
    applied = true;
  } catch (error) {
    toast(humanError(error, "No pude importar."));
  } finally {
    importLock = false;
    state.importing = false;
    fileInput.value = "";
    render(applied ? { resetScroll: true } : undefined);
  }
}

async function sendCoach(text) {
  const content = String(text || "").trim();
  if (!content || state.coachBusy) return;
  const thread = messages();
  thread.push({ role: "user", content: content.slice(0, 2000) });
  state.chat[state.category] = thread.slice(-30);
  state.coachBusy = true;
  save(KEYS.chat, state.chat);
  render({ stick: true });
  let acc = "";
  let failed = "";
  try {
    const response = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages().filter((message) => message.role === "user" || message.role === "assistant").slice(-12),
        context: routineContext(),
      }),
    });
    if (!response.ok || !response.body) {
      const data = response.ok ? {} : await response.json().catch(() => ({}));
      throw new Error(data.message || "El coach no respondió.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        let payload;
        try {
          payload = JSON.parse(trimmed.slice(5).trim());
        } catch {
          continue;
        }
        if (!payload || payload.error) throw new Error((payload && payload.error) || "Se cortó la respuesta.");
        if (!payload.t) continue;
        acc += payload.t;
        const box = document.getElementById("coach-stream");
        if (box) {
          box.replaceChildren(formatCoach(acc));
          const distance = main.scrollHeight - main.scrollTop - main.clientHeight;
          if (distance < 140) main.scrollTop = main.scrollHeight;
        }
      }
    }
    if (!acc) throw new Error("El coach no mandó texto.");
  } catch (error) {
    failed = humanError(error, "Se cortó la respuesta.");
  } finally {
    const thread = messages();
    if (acc) thread.push({ role: "assistant", content: acc });
    if (failed) thread.push({ role: "note", content: failed });
    state.chat[state.category] = thread.slice(-30);
    state.coachBusy = false;
    save(KEYS.chat, state.chat);
    render({ stick: true });
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) importFile(file);
});
importBtn.addEventListener("click", () => fileInput.click());

for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => {
    state.tab = button.dataset.tab;
    render({ resetScroll: true });
  });
}

for (const button of document.querySelectorAll("[data-cat]")) {
  button.addEventListener("click", () => selectCategory(button.dataset.cat));
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = coachInput.value;
  coachInput.value = "";
  coachInput.style.height = "auto";
  sendCoach(text);
});

coachInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const text = coachInput.value;
    coachInput.value = "";
    coachInput.style.height = "auto";
    sendCoach(text);
  }
});

coachInput.addEventListener("input", () => {
  coachInput.style.height = "auto";
  coachInput.style.height = Math.min(coachInput.scrollHeight, 120) + "px";
});

document.getElementById("sheet-close").addEventListener("click", closeSheet);
document.getElementById("backdrop").addEventListener("click", closeSheet);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !overlay.hidden) closeSheet();
});

let dragDepth = 0;
phone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  phone.classList.add("dropping");
});
phone.addEventListener("dragover", (event) => event.preventDefault());
phone.addEventListener("dragleave", () => {
  dragDepth -= 1;
  if (dragDepth <= 0) {
    dragDepth = 0;
    phone.classList.remove("dropping");
  }
});
phone.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  phone.classList.remove("dropping");
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) importFile(file);
});

state.plan = planFor(state.category);
ensureCycle();
render();

async function boot() {
  await Promise.all(Object.entries(BUILTIN_FILES).map(async ([id, url]) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      const plan = await response.json();
      if (!validPlan(plan)) throw new Error("incompleta");
      state.builtins[id] = plan;
    } catch {
      if (id === "m15") state.loadError = "No pude cargar la planilla de M15.";
    }
  }));
  state.ready = true;
  if (!validPlan(state.overrides[state.category])) state.plan = planFor(state.category);
  ensureCycle();
  render();
  if (state.loadError && state.category === "m15" && !state.plan) toast(state.loadError);
}

boot();

fetch("/api/health")
  .then((response) => response.json())
  .then((data) => {
    state.ai = Boolean(data && data.ai);
    if (state.tab === "coach") render();
  })
  .catch(() => {});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
