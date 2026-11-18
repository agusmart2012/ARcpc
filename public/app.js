const KEYS = {
  category: "cpc.category",
  overrides: "cpc.overrides",
  log: "cpc.log",
  cycle: "cpc.cycle",
  chat: "cpc.chat",
  notify: "cpc.notify",
  notices: "cpc.notices",
  stamp: "cpc.m15stamp",
  profile: "cpc.profile",
};
const DAY_PICKS = [
  [1, "L"],
  [2, "M"],
  [3, "X"],
  [4, "J"],
  [5, "V"],
  [6, "S"],
  [0, "D"],
];
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
const ROLES = [
  { id: "jugador", label: "Jugador/a" },
  { id: "hincha", label: "Hincha" },
  { id: "cuerpo", label: "Cuerpo técnico" },
];
const POSICIONES = [
  "Pilar",
  "Hooker",
  "Segunda línea",
  "Ala",
  "Octavo",
  "Medio scrum",
  "Apertura",
  "Centro",
  "Wing",
  "Fullback",
];
const STATS = [
  { id: "tackle", label: "Tackle" },
  { id: "velocidad", label: "Velocidad" },
  { id: "resistencia", label: "Resistencia" },
  { id: "pase", label: "Pase" },
  { id: "patada", label: "Patada" },
  { id: "individualidad", label: "Individualidad" },
  { id: "equipo", label: "Equipo" },
];

const fileInput = document.getElementById("file");
const importBtn = document.getElementById("import-btn");
const main = document.getElementById("main");
const overlay = document.getElementById("overlay");
const sheetTitle = document.getElementById("sheet-title");
const sheetBody = document.getElementById("sheet-body");
const app = document.getElementById("app");
const phone = document.getElementById("phone");

const storedCategory = load(KEYS.category);
const storedOverrides = load(KEYS.overrides);
const storedLog = load(KEYS.log);
const storedChat = load(KEYS.chat);
const storedNotices = load(KEYS.notices);
const openingTab = new URLSearchParams(location.search).get("tab");

const state = {
  tab: openingTab === "semana" || openingTab === "avisos" || openingTab === "cuenta" ? openingTab : "hoy",
  category: CATEGORIES.some((item) => item.id === storedCategory) ? storedCategory : "m15",
  overrides: objectBag(storedOverrides),
  builtins: {},
  plan: null,
  log: objectBag(storedLog),
  cycle: objectBag(load(KEYS.cycle)),
  chat: objectBag(storedChat),
  notify: defaultNotify(objectBag(load(KEYS.notify))),
  notices: Array.isArray(storedNotices) ? storedNotices.filter((item) => item && item.title).slice(0, 20) : [],
  pushEndpoint: "",
  httpsPort: 0,
  focusKey: null,
  ai: false,
  importing: false,
  ready: false,
  loadError: "",
  profile: defaultProfile(load(KEYS.profile)),
};

let importLock = false;
let dismissSheet = null;
let videoToken = 0;
let toastTimer = 0;
let fichaStep = 1;

function objectBag(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clampStat(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(99, Math.round(n)));
}

function clampNum(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) return 0;
  return rounded;
}

function defaultProfile(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const stats = source.stats && typeof source.stats === "object" ? source.stats : {};
  const rol = ROLES.some((item) => item.id === source.rol) ? source.rol : "";
  return {
    nombre: String(source.nombre || "").replace(/\s+/g, " ").trim().slice(0, 40),
    rol,
    posicion: POSICIONES.includes(source.posicion) ? source.posicion : "",
    edad: clampNum(source.edad, 6, 80),
    altura: clampNum(source.altura, 120, 220),
    peso: clampNum(source.peso, 30, 180),
    ciudad: String(source.ciudad || "").replace(/\s+/g, " ").trim().slice(0, 40),
    stats: {
      tackle: clampStat(stats.tackle, 50),
      velocidad: clampStat(stats.velocidad, 50),
      resistencia: clampStat(stats.resistencia, 50),
      pase: clampStat(stats.pase, 50),
      patada: clampStat(stats.patada, 50),
      individualidad: clampStat(stats.individualidad, 50),
      equipo: clampStat(stats.equipo, 50),
    },
  };
}

function profileReady(profile) {
  const p = profile || state.profile;
  if (!p || String(p.nombre || "").trim().length < 2) return false;
  if (!p.rol) return false;
  if (p.rol === "jugador" && !p.posicion) return false;
  if (!p.edad || !p.altura || !p.peso) return false;
  if (!String(p.ciudad || "").trim()) return false;
  return true;
}

function roleLabel(id) {
  const found = ROLES.find((item) => item.id === id);
  return found ? found.label : "";
}

function mediaOf(stats) {
  const bag = stats || {};
  const vals = STATS.map((item) => Number(bag[item.id]) || 0);
  return Math.round(vals.reduce((sum, n) => sum + n, 0) / vals.length);
}

function rankedStats(stats) {
  return STATS
    .map((item) => ({ id: item.id, label: item.label, value: Number(stats && stats[item.id]) || 0 }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"));
}

function initialOf(name) {
  const text = String(name || "").trim();
  return text ? text.charAt(0).toUpperCase() : "J";
}

function defaultNotify(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const days = Array.isArray(source.days) ? source.days.map(Number).filter((day) => day >= 0 && day <= 6) : [];
  return {
    remind: source.remind !== false,
    routine: source.routine !== false,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(source.time) ? source.time : "17:00",
    days: days.length ? [...new Set(days)] : [1, 2, 3, 4, 5],
    categoryId: CATEGORIES.some((item) => item.id === source.categoryId) ? source.categoryId : "m15",
    lastLocal: typeof source.lastLocal === "string" ? source.lastLocal : "",
  };
}

function load(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast("No pude guardar en este teléfono.");
  }
}

function save(key, value) {
  saveLocal(key, value);
}

function closeFicha() {
  app.classList.remove("gated");
  const gate = document.getElementById("gate");
  if (gate) gate.hidden = true;
}

function showFichaGate() {
  app.classList.add("gated");
  const gate = document.getElementById("gate");
  if (gate) {
    gate.hidden = false;
    gate.classList.add("ficha-open");
  }
  fichaStep = 1;
  renderFicha();
}

function pickButtons(name, options, current, onpick) {
  return el("div", { class: "picks", role: "group", "aria-label": name }, options.map((item) => {
    const id = typeof item === "string" ? item : item.id;
    const label = typeof item === "string" ? item : item.label;
    const on = current === id;
    return el("button", {
      type: "button",
      class: "pick",
      "aria-pressed": on ? "true" : "false",
      onclick: () => onpick(id),
    }, label);
  }));
}

function identityCard(opts) {
  const compact = Boolean(opts && opts.compact);
  const p = defaultProfile(state.profile);
  const rol = roleLabel(p.rol);
  const chips = [
    p.rol === "jugador" ? "Jugador/a" : "",
    p.posicion,
    p.edad ? p.edad + " años" : "",
    p.altura ? p.altura + " cm" : "",
    p.peso ? p.peso + " kg" : "",
    p.ciudad,
  ].filter(Boolean);
  return el(compact ? "button" : "section", {
    class: "id-card" + (compact ? " compact" : ""),
    type: compact ? "button" : undefined,
    onclick: compact ? openAccount : undefined,
  }, [
    el("div", { class: "id-top" }, [
      el("span", { class: "id-avatar" }, initialOf(p.nombre)),
      el("div", { class: "id-who" }, [
        el("strong", {}, p.nombre || "Jugador"),
      ]),
      rol ? el("span", { class: "id-badge" }, rol) : null,
    ]),
    el("p", { class: "id-club" }, [el("span", { class: "id-star", "aria-hidden": "true" }, "★"), " Carrasco Polo"]),
    chips.length ? el("div", { class: "id-chips" }, chips.map((chip) => el("span", { class: "id-chip" }, chip))) : null,
  ]);
}

function playerCard(profile, opts) {
  const compact = Boolean(opts && opts.compact);
  const p = defaultProfile(profile);
  const media = mediaOf(p.stats);
  const order = rankedStats(p.stats);
  const high = order.slice(0, 2);
  const low = order.slice(-2).reverse();
  const meta = [p.posicion, p.altura ? p.altura + " cm" : "", p.peso ? p.peso + " kg" : ""].filter(Boolean).join(" · ");
  return el("section", { class: "player-card" + (compact ? " mini" : "") }, [
    el("img", { class: "player-mark", src: "/crest.png", alt: "" }),
    el("div", { class: "player-head" }, [
      el("div", { class: "player-id" }, [
        el("div", { class: "player-brand" }, [
          el("img", { class: "player-crest", src: "/crest.png", alt: "" }),
          el("div", {}, [
            el("p", { class: "player-kicker" }, "SALA AR PLAYER CARD"),
            el("p", { class: "player-club" }, "Carrasco Polo"),
          ]),
        ]),
        el("h2", { class: "player-name" }, p.nombre || "Jugador"),
        meta ? el("p", { class: "player-meta" }, meta) : null,
      ]),
      el("div", { class: "media-box" }, [
        el("b", {}, String(media)),
        el("span", {}, "MEDIA"),
      ]),
    ]),
    el("div", { class: "stat-grid" }, STATS.map((item) => el("div", { class: "stat-cell" }, [
      el("span", {}, item.label),
      el("b", {}, String(p.stats[item.id] || 0)),
    ]))),
    compact ? null : el("div", { class: "duo" }, [
      el("div", { class: "duo-box" }, [
        el("p", { class: "duo-label" }, "Fortalezas"),
        ...high.map((item) => el("p", {}, item.label + " · " + item.value)),
      ]),
      el("div", { class: "duo-box" }, [
        el("p", { class: "duo-label" }, "A mejorar"),
        ...low.map((item) => el("p", {}, item.label + " · " + item.value)),
      ]),
    ]),
  ]);
}

function openAccount() {
  if (!profileReady(state.profile)) {
    showFichaGate();
    return;
  }
  state.tab = "cuenta";
  render({ resetScroll: true, morphTabs: true });
}

function viewCuenta() {
  const ready = profileReady(state.profile);
  const nodes = [
    el("header", { class: "hero" }, [
      el("p", { class: "kicker" }, "Carrasco Polo Club"),
      el("h1", {}, "Perfil"),
    ]),
    ready ? identityCard() : null,
    ready ? playerCard(state.profile) : el("p", { class: "lead" }, "Falta armar tu ficha."),
    el("div", { class: "sheet-actions" }, [
      el("button", { class: "btn ghost", type: "button", onclick: showFichaGate }, ready ? "Editar ficha" : "Armar ficha"),
    ]),
  ];
  return nodes.filter(Boolean);
}

function renderFicha() {
  const box = document.getElementById("gate-ficha");
  if (!box) return;
  const p = defaultProfile(state.profile);
  if (fichaStep === 2) {
    box.replaceChildren(
      el("p", { class: "gate-kicker" }, "Carrasco Polo Club"),
      el("h1", {}, "Tu carta"),
      el("p", { class: "gate-copy" }, "Poné cómo te ves en la cancha. Después lo podés cambiar."),
      el("div", { id: "ficha-live" }, playerCard(p, { compact: true })),
      el("div", { class: "stat-edits" }, STATS.map((item) => {
        const value = p.stats[item.id];
        return el("label", { class: "stat-edit" }, [
          el("span", {}, item.label),
          el("b", { id: "stat-val-" + item.id }, String(value)),
          el("input", {
            type: "range",
            min: "1",
            max: "99",
            value: String(value),
            "aria-label": item.label,
            oninput: (event) => {
              state.profile = defaultProfile(state.profile);
              state.profile.stats[item.id] = clampStat(event.target.value, 50);
              const label = document.getElementById("stat-val-" + item.id);
              if (label) label.textContent = String(state.profile.stats[item.id]);
              const live = document.getElementById("ficha-live");
              if (live) live.replaceChildren(playerCard(state.profile, { compact: true }));
            },
          }),
        ]);
      })),
      el("p", { class: "gate-error", id: "ficha-error", hidden: true }),
      el("button", { type: "button", class: "btn primary", onclick: saveFicha }, "Listo"),
      el("button", { type: "button", class: "btn ghost", onclick: () => { fichaStep = 1; renderFicha(); } }, "Volver"),
    );
    return;
  }
  const posWrap = el("div", { id: "ficha-pos-wrap" }, [
    el("p", { class: "gate-label" }, "Posición"),
    pickButtons("Posición", POSICIONES, p.posicion, (id) => {
      stashFichaBio();
      state.profile.posicion = id;
      renderFicha();
    }),
  ]);
  if (p.rol && p.rol !== "jugador") posWrap.hidden = true;
  box.replaceChildren(
    el("p", { class: "gate-kicker" }, "Carrasco Polo Club"),
    el("h1", {}, "Tu ficha"),
    el("p", { class: "gate-copy" }, "Así te van a ver en la sala."),
    el("label", { class: "gate-field" }, [
      el("span", {}, "Nombre"),
      el("input", {
        id: "ficha-nombre",
        type: "text",
        maxlength: "40",
        autocomplete: "name",
        placeholder: "Tu nombre",
        value: p.nombre || "",
      }),
    ]),
    el("p", { class: "gate-label" }, "En el club sos"),
    pickButtons("Rol", ROLES, p.rol, (id) => {
      stashFichaBio();
      state.profile.rol = id;
      renderFicha();
    }),
    posWrap,
    el("div", { class: "gate-row" }, [
      el("label", { class: "gate-field" }, [
        el("span", {}, "Edad"),
        el("input", {
          id: "ficha-edad",
          type: "number",
          inputmode: "numeric",
          min: "6",
          max: "80",
          placeholder: "14",
          value: p.edad ? String(p.edad) : "",
        }),
      ]),
      el("label", { class: "gate-field" }, [
        el("span", {}, "Altura"),
        el("input", {
          id: "ficha-altura",
          type: "number",
          inputmode: "numeric",
          min: "120",
          max: "220",
          placeholder: "175",
          value: p.altura ? String(p.altura) : "",
        }),
      ]),
      el("label", { class: "gate-field" }, [
        el("span", {}, "Peso"),
        el("input", {
          id: "ficha-peso",
          type: "number",
          inputmode: "numeric",
          min: "30",
          max: "180",
          placeholder: "84",
          value: p.peso ? String(p.peso) : "",
        }),
      ]),
    ]),
    el("label", { class: "gate-field" }, [
      el("span", {}, "Ciudad"),
      el("input", {
        id: "ficha-ciudad",
        type: "text",
        maxlength: "40",
        placeholder: "Montevideo",
        value: p.ciudad || "Montevideo",
      }),
    ]),
    el("p", { class: "gate-error", id: "ficha-error", hidden: true }),
    el("button", { type: "button", class: "btn primary", onclick: nextFicha }, "Siguiente"),
    el("button", { type: "button", class: "btn ghost", onclick: closeFicha }, "Ahora no"),
  );
}

function readFichaBio() {
  const nombre = String((document.getElementById("ficha-nombre") && document.getElementById("ficha-nombre").value) || "").replace(/\s+/g, " ").trim();
  const edad = clampNum(document.getElementById("ficha-edad") && document.getElementById("ficha-edad").value, 6, 80);
  const altura = clampNum(document.getElementById("ficha-altura") && document.getElementById("ficha-altura").value, 120, 220);
  const peso = clampNum(document.getElementById("ficha-peso") && document.getElementById("ficha-peso").value, 30, 180);
  const ciudad = String((document.getElementById("ficha-ciudad") && document.getElementById("ficha-ciudad").value) || "").replace(/\s+/g, " ").trim();
  state.profile = defaultProfile(Object.assign({}, state.profile, { nombre, edad, altura, peso, ciudad }));
  return state.profile;
}

function stashFichaBio() {
  if (!document.getElementById("ficha-edad")) return;
  readFichaBio();
}

function fichaMessage(text) {
  const node = document.getElementById("ficha-error");
  if (!node) return;
  if (!text) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.textContent = text;
}

function nextFicha() {
  readFichaBio();
  if (!state.profile.nombre || state.profile.nombre.length < 2) return fichaMessage("Poné tu nombre.");
  if (!state.profile.rol) return fichaMessage("Elegí si sos jugador, hincha o cuerpo técnico.");
  if (state.profile.rol === "jugador" && !state.profile.posicion) return fichaMessage("Elegí tu posición.");
  if (!state.profile.edad) return fichaMessage("Poné tu edad.");
  if (!state.profile.altura) return fichaMessage("Poné tu altura en cm.");
  if (!state.profile.peso) return fichaMessage("Poné tu peso en kg.");
  if (!state.profile.ciudad) return fichaMessage("Poné tu ciudad.");
  fichaMessage("");
  fichaStep = 2;
  renderFicha();
}

function saveFicha() {
  if (fichaStep === 1) readFichaBio();
  if (!profileReady(state.profile)) {
    fichaStep = 1;
    renderFicha();
    fichaMessage("Falta completar la ficha.");
    return;
  }
  save(KEYS.profile, state.profile);
  closeFicha();
  state.tab = "cuenta";
  render({ resetScroll: true, morphTabs: true });
  toast("Ficha lista.");
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
    else if (key.slice(0, 2) === "on" && typeof value === "function") node.addEventListener(key.slice(2), value);
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
  requestAnimationFrame(() => node.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.remove("show");
    setTimeout(() => {
      if (!node.classList.contains("show")) node.hidden = true;
    }, 360);
  }, 2800);
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

let sheetClosing = false;

function closeSheet() {
  if (overlay.hidden || sheetClosing) {
    const finish = dismissSheet;
    dismissSheet = null;
    if (finish) finish();
    return;
  }
  sheetClosing = true;
  overlay.classList.remove("open");
  const done = () => {
    if (!sheetClosing) return;
    sheetClosing = false;
    overlay.hidden = true;
    app.inert = false;
    sheetBody.replaceChildren();
    const finish = dismissSheet;
    dismissSheet = null;
    if (finish) finish();
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    done();
    return;
  }
  const sheet = overlay.querySelector(".sheet");
  const onEnd = (event) => {
    if (event.target !== sheet || (event.propertyName && event.propertyName !== "transform")) return;
    sheet.removeEventListener("transitionend", onEnd);
    done();
  };
  sheet.addEventListener("transitionend", onEnd);
  setTimeout(done, 560);
}

function openSheet(title, nodes, onDismiss) {
  videoToken += 1;
  sheetClosing = false;
  dismissSheet = onDismiss || null;
  sheetTitle.textContent = title;
  sheetBody.replaceChildren(...nodes);
  overlay.hidden = false;
  app.inert = true;
  overlay.classList.remove("open");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add("open"));
  });
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

function progressRing(progress) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return el("div", {
    class: "ring",
    style: "--p:" + pct,
    "aria-hidden": "true",
  }, el("b", {}, String(pct)));
}

function sessionPills(bits) {
  if (!bits.length) return null;
  return el("div", { class: "pills" }, bits.map((bit) => el("span", { class: "pill" }, bit)));
}

function loadingState() {
  return [
    el("header", { class: "hero" }, [
      el("p", { class: "kicker" }, "Carrasco Polo Club"),
      el("h1", {}, categoryLabel()),
      el("p", { class: "lead" }, "Cargando la planilla…"),
    ]),
  ];
}

function emptyCategory() {
  if (state.category === "m15" && state.loadError) {
    return [
      el("header", { class: "hero" }, [
        el("p", { class: "kicker" }, "Sala de alto rendimiento"),
        el("h1", {}, "M15"),
        el("p", { class: "lead" }, "No llegué a leer la planilla de M15. La compu tiene que estar prendida."),
      ]),
      el("button", { class: "btn primary", type: "button", onclick: () => location.reload() }, "Reintentar"),
    ];
  }
  const nodes = [
    el("header", { class: "hero" }, [
      el("p", { class: "kicker" }, "Sala de alto rendimiento"),
      el("h1", {}, categoryLabel()),
      el("p", { class: "lead" }, "Esta categoría todavía no tiene planilla. Cuando esté, va a aparecer día por día, igual que M15."),
    ]),
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
  const nodes = [];
  if (!day) {
    const next = nextTraining(state.plan);
    nodes.push(el("header", { class: "hero" }, [
      el("p", { class: "kicker" }, categoryLabel() + " · " + cap(longDate())),
      el("h1", {}, "Descanso"),
      el("p", { class: "lead" }, next
        ? (next.inDays === 1 ? "Mañana" : "En " + next.inDays + " días") + " toca " + next.day.label + "."
        : "Este día de la semana no tiene ejercicios."),
    ]));
    if (next) {
      nodes.push(el("button", {
        class: "next-card",
        type: "button",
        onclick: () => {
          state.focusKey = next.day.key;
          render({ resetScroll: true });
        },
      }, [
        el("span", { class: "kicker" }, next.inDays === 1 ? "Próxima sesión" : "En " + next.inDays + " días"),
        el("strong", {}, next.day.label),
        el("span", {}, [next.day.session, state.plan.period].filter(Boolean).join(" · ")),
      ]));
    }
    return nodes;
  }

  const different = !auto.day || day.key !== auto.day.key;
  if (different) {
    nodes.push(el("div", { class: "banner" }, [
      el("p", {}, "Estás viendo " + day.label + ". Las series se anotan en el día de hoy."),
      el("button", { type: "button", onclick: () => { state.focusKey = null; render({ resetScroll: true }); } }, "Volver a hoy"),
    ]));
  }
  const sessionBits = [day.session, state.plan.week ? "Semana " + state.plan.week : "", state.plan.period].filter(Boolean);
  const progress = seriesOf(day);
  nodes.push(el("header", { class: "hero" }, [
    el("p", { class: "kicker" }, categoryLabel() + " · " + cap(longDate())),
    el("div", { class: "hero-row" }, [
      el("div", {}, [
        el("h1", {}, day.label),
        sessionPills(sessionBits),
        el("p", { class: "tally" }, tallyText(progress)),
      ]),
      progressRing(progress),
    ]),
  ]));
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
    return el("div", { class: "day rest" + (isToday ? " today" : "") }, [
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
    class: "day" + (isToday ? " today" : ""),
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
    announceRoutine("Volvió la planilla del club.");
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
  announceRoutine("Se borró la planilla de esta categoría.");
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
    el("header", { class: "hero" }, [
      el("p", { class: "kicker" }, [state.plan.week ? "Semana " + state.plan.week : "Plan", state.plan.period].filter(Boolean).join(" · ")),
      el("h1", {}, categoryLabel()),
      el("p", { class: "fine" }, "Tocá un día para abrir la sesión."),
    ]),
  ];
  nodes.push(el("div", { class: "week" }, agenda(state.plan).map((row) => dayRow(row, auto))));
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

function sessionsOf(plan) {
  if (!plan) return [];
  return plan.days.filter((day) => day.weekday != null).map((day) => {
    const central = day.blocks.find((block) => /parte central/i.test(block.title || ""));
    const pool = central ? central.exercises : day.blocks.flatMap((block) => block.exercises);
    const focus = (pool || []).find((item) => item && !item.check);
    return {
      weekday: day.weekday,
      label: day.label,
      session: day.session || "",
      focus: focus ? focus.name : "",
    };
  });
}

function notifyPayload() {
  const prefs = state.notify;
  const found = CATEGORIES.find((item) => item.id === prefs.categoryId);
  let timezone = "America/Montevideo";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
  } catch {
    /* queda Montevideo */
  }
  return {
    remind: prefs.remind,
    routine: prefs.routine,
    time: prefs.time,
    days: prefs.days,
    timezone,
    category: found ? found.label : "M15",
    sessions: sessionsOf(planFor(prefs.categoryId)),
  };
}

function decodeKey(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) out[index] = raw.charCodeAt(index);
  return out;
}

let syncTimer = 0;

function saveNotify() {
  save(KEYS.notify, state.notify);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    publishNotify().catch(() => {});
  }, 250);
}

async function publishNotify() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    const response = await fetch("/api/notifications/key");
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.publicKey) return;
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeKey(data.publicKey),
    });
  }
  state.pushEndpoint = subscription.endpoint;
  await fetch("/api/notifications/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), prefs: notifyPayload() }),
  });
}

function recordNotice(title, body) {
  state.notices = [{ title, body, at: new Date().toISOString() }, ...state.notices].slice(0, 20);
  save(KEYS.notices, state.notices);
  if (state.tab === "avisos") render();
}

async function showSystemNotice(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options = { body, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: "/?tab=avisos" } };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, { body });
  } catch {
    try { new Notification(title, { body }); } catch { /* el teléfono no mostró el aviso */ }
  }
}

async function deliverNotice(title, body, options) {
  recordNotice(title, body);
  await showSystemNotice(title, body);
  if (options && options.localOnly) return;
  fetch("/api/notifications/routine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, endpoint: state.pushEndpoint || "" }),
  }).catch(() => {});
}

function announceRoutine(text) {
  if (!state.notify.routine) return;
  deliverNotice("Cambió la rutina de " + categoryLabel(), text).catch(() => {});
}

async function enableNotifications() {
  if (!window.isSecureContext) {
    toast("En el iPhone abrí la dirección https de la compu y aceptá el certificado.");
    return;
  }
  if (!("Notification" in window)) {
    toast("Este navegador no muestra notificaciones.");
    return;
  }
  const result = await Notification.requestPermission();
  if (result !== "granted") {
    toast("Las notificaciones quedaron bloqueadas en el teléfono.");
    render();
    return;
  }
  try {
    await publishNotify();
  } catch {
    toast("Quedaron activadas en el teléfono. El aviso con la pantalla bloqueada necesita la compu prendida.");
  }
  await deliverNotice("Avisos activados", "Te vamos a recordar la sala y los cambios de rutina.", { localOnly: true });
  render();
}

async function testNotice() {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    await enableNotifications();
    return;
  }
  if (state.pushEndpoint) {
    const response = await fetch("/api/notifications/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: state.pushEndpoint }),
    }).catch(() => null);
    if (response && response.ok) {
      recordNotice("Prueba de la sala", "Si leés esto, los avisos llegan con la app cerrada.");
      toast("Mandé un aviso de prueba.");
      return;
    }
  }
  await deliverNotice("Prueba de la sala", "Si leés esto, los avisos están llegando.", { localOnly: true });
}

function checkLocalReminder() {
  const prefs = state.notify;
  if (!prefs.remind || state.pushEndpoint) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = new Date();
  const time = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  if (time !== prefs.time || !prefs.days.includes(now.getDay())) return;
  if (prefs.lastLocal === todayKey()) return;
  state.notify.lastLocal = todayKey();
  save(KEYS.notify, state.notify);
  const label = CATEGORIES.find((item) => item.id === prefs.categoryId);
  const session = sessionsOf(planFor(prefs.categoryId)).find((item) => item.weekday === now.getDay());
  const head = [label && label.label, session && session.label, session && session.session].filter(Boolean).join(" · ");
  const body = head
    ? head + "." + (session && session.focus ? " Arranca por " + session.focus + "." : "")
    : "Hoy no hay planilla cargada para " + (label ? label.label : "esa categoría") + ".";
  deliverNotice("Hoy toca sala", body, { localOnly: true }).catch(() => {});
}

function planStamp(plan) {
  if (!plan) return "";
  return plan.days.map((day) => day.label + ":" + day.blocks.map((block) => block.exercises.map((item) => item.name).join(",")).join("|")).join("\n");
}

function watchPlanStamp() {
  const stamp = planStamp(state.builtins.m15);
  if (!stamp) return;
  const previous = load(KEYS.stamp);
  if (previous && previous !== stamp) announceRoutine("Se actualizó la planilla de M15" + (state.builtins.m15.week ? ", semana " + state.builtins.m15.week : "") + ".");
  save(KEYS.stamp, stamp);
}

function switchRow(label, on, onclick) {
  return el("div", { class: "switch-row" }, [
    el("span", {}, label),
    el("button", {
      type: "button",
      class: "switch",
      role: "switch",
      "aria-pressed": on ? "true" : "false",
      "aria-label": label,
      onclick,
    }, el("i")),
  ]);
}

function reminderSummary() {
  const prefs = state.notify;
  const names = DAY_PICKS.filter(([day]) => prefs.days.includes(day)).map(([, label]) => label);
  if (!prefs.remind) return "El recordatorio está apagado.";
  if (!names.length) return "Elegí al menos un día.";
  return "Días " + names.join(" ") + ", a las " + prefs.time + ".";
}

function viewAvisos() {
  const prefs = state.notify;
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const granted = permission === "granted";
  const status = el("section", { class: "notify-card" }, [
    el("h2", {}, granted ? "Notificaciones activadas" : "Notificaciones apagadas"),
    el("p", {}, granted
      ? "Te avisan para ir a la sala y cuando cambia una planilla."
      : "Activálas en este teléfono. En el iPhone salen desde el ícono de inicio."),
  ]);
  if (!window.isSecureContext) {
    const port = state.httpsPort || (location.port === "4173" ? "4174" : "");
    status.append(el("p", { class: "fine", style: "margin-top:10px" }, "En el iPhone abrí la dirección https y aceptá el certificado. Recién ahí se pueden activar."));
    if (port) {
      const href = "https://" + location.hostname + ":" + port + "/";
      status.append(el("a", { class: "text-btn", href }, href));
    }
  } else if (iphone && !standalone) {
    status.append(el("p", { class: "fine", style: "margin-top:10px" }, "En Safari: Compartir, y después Agregar a inicio. Los avisos suenan desde ese ícono."));
  }
  status.append(el("button", {
    class: "btn primary",
    type: "button",
    style: "margin-top:12px",
    onclick: () => { granted ? testNotice() : enableNotifications(); },
  }, granted ? "Probar aviso" : "Activar notificaciones"));
  const categoryName = CATEGORIES.find((item) => item.id === prefs.categoryId);
  const history = state.notices.length
    ? el("div", { class: "notice-list" }, state.notices.map((item) => el("div", { class: "notice-item" }, [
        el("strong", {}, item.title),
        el("span", {}, item.body),
      ])))
    : el("p", { class: "fine", style: "margin-top:8px" }, "Cuando haya un aviso, queda anotado acá.");
  return [
    el("header", { class: "hero" }, [
      el("p", { class: "kicker" }, "Sala"),
      el("h1", {}, "Avisos"),
    ]),
    status,
    el("section", { class: "notify-card" }, [
      el("h2", {}, "Recordatorio de sala"),
      el("p", {}, "Los días que elijas, a la hora que elijas."),
      switchRow("Avisame para ir", prefs.remind, () => {
        state.notify.remind = !state.notify.remind;
        saveNotify();
        render();
      }),
      el("div", { class: "time-row" }, [
        el("span", {}, "Hora"),
        el("input", {
          type: "time",
          value: prefs.time,
          "aria-label": "Hora del recordatorio",
          oninput: (event) => {
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.target.value)) return;
            state.notify.time = event.target.value;
            saveNotify();
          },
        }),
      ]),
      el("div", { class: "day-picks" }, DAY_PICKS.map(([weekday, label]) => el("button", {
        type: "button",
        class: "day-pick",
        "aria-pressed": prefs.days.includes(weekday) ? "true" : "false",
        "aria-label": label,
        onclick: () => {
          const days = new Set(state.notify.days);
          if (days.has(weekday)) days.delete(weekday);
          else days.add(weekday);
          state.notify.days = [...days];
          saveNotify();
          render();
        },
      }, label))),
      el("p", { class: "fine", style: "margin-top:10px" }, reminderSummary()),
    ]),
    el("section", { class: "notify-card" }, [
      el("h2", {}, "Cambios de rutina"),
      el("p", {}, "Cuando se carga una planilla nueva o se actualiza la del club."),
      switchRow("Avisame si cambia", prefs.routine, () => {
        state.notify.routine = !state.notify.routine;
        saveNotify();
        render();
      }),
    ]),
    el("section", { class: "notify-card" }, [
      el("h2", {}, "Categoría del aviso"),
      el("p", {}, "El recordatorio usa la planilla de " + (categoryName ? categoryName.label : "M15") + "."),
      el("div", { class: "day-picks" }, CATEGORIES.map((item) => el("button", {
        type: "button",
        class: "day-pick wide",
        "aria-pressed": prefs.categoryId === item.id ? "true" : "false",
        onclick: () => {
          state.notify.categoryId = item.id;
          saveNotify();
          render();
        },
      }, item.label))),
    ]),
    el("section", { class: "notify-card" }, [
      el("h2", {}, "Últimos avisos"),
      history,
    ]),
  ];
}

function view() {
  if (state.tab === "semana") return viewSemana();
  if (state.tab === "avisos") return viewAvisos();
  if (state.tab === "cuenta") return viewCuenta();
  return viewHoy();
}

function syncTabBlob(morph) {
  const blob = document.getElementById("tab-blob");
  const shell = document.getElementById("tabs-shell");
  const on = shell && shell.querySelector('.tab[aria-selected="true"]');
  if (!blob || !shell) return;
  if (!on) {
    blob.style.opacity = "0";
    return;
  }
  blob.style.opacity = "";
  const nav = shell.getBoundingClientRect();
  const r = on.getBoundingClientRect();
  const left = r.left - nav.left;
  const width = r.width;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (morph && !reduce) {
    const prevLeft = Number.parseFloat(blob.style.left) || left;
    const prevWidth = Number.parseFloat(blob.style.width) || width;
    const minL = Math.min(prevLeft, left);
    const maxR = Math.max(prevLeft + prevWidth, left + width);
    blob.style.transition = "none";
    blob.style.left = minL + "px";
    blob.style.width = Math.max(8, maxR - minL) + "px";
    void blob.offsetWidth;
    blob.style.transition = "";
  }
  blob.style.left = left + "px";
  blob.style.width = width + "px";
}

function setGlassLight(x, y) {
  const px = Math.max(6, Math.min(94, x * 100));
  const py = Math.max(0, Math.min(48, y * 42));
  app.style.setProperty("--gx", px + "%");
  app.style.setProperty("--gy", py + "%");
  const ambient = app.querySelector(".ambient");
  if (ambient) ambient.style.transform = "translate(" + ((x - 0.5) * 14).toFixed(1) + "px," + ((y - 0.5) * 10).toFixed(1) + "px)";
}

function tickStatus() {
  const node = document.getElementById("status-time");
  if (!node) return;
  node.textContent = new Date().toLocaleTimeString("es-UY", { hour: "numeric", minute: "2-digit", hour12: false });
}

function render(options) {
  const keep = options && options.resetScroll ? 0 : main.scrollTop;
  const tabChanged = app.dataset.screen !== state.tab;
  app.dataset.screen = state.tab;
  if (options && options.resetScroll) app.classList.remove("tabs-min");
  main.replaceChildren(...view());
  main.scrollTop = options && options.stick ? main.scrollHeight : keep;
  if (tabChanged) {
    main.classList.remove("enter");
    void main.offsetWidth;
    main.classList.add("enter");
  }
  for (const button of document.querySelectorAll(".tab[data-tab]")) {
    button.setAttribute("aria-selected", button.dataset.tab === state.tab ? "true" : "false");
  }
  for (const button of document.querySelectorAll("[data-cat]")) {
    const on = button.dataset.cat === state.category;
    button.setAttribute("aria-selected", on ? "true" : "false");
    if (on && options && options.centerCat) button.scrollIntoView({ inline: "center", block: "nearest" });
  }
  importBtn.setAttribute("aria-busy", state.importing ? "true" : "false");
  syncTabBlob(Boolean(options && options.morphTabs));
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
  announceRoutine(plan.sourceName ? "Quedó cargada " + plan.sourceName + "." : "Quedó cargada una planilla nueva.");
  publishNotify().catch(() => {});
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

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) importFile(file);
});
const accountBtn = document.getElementById("account-btn");
if (accountBtn) accountBtn.addEventListener("click", openAccount);

importBtn.addEventListener("click", () => fileInput.click());

for (const button of document.querySelectorAll(".tab[data-tab]")) {
  button.addEventListener("click", () => {
    if (state.tab === button.dataset.tab) return;
    if (button.dataset.tab === "cuenta") {
      openAccount();
      return;
    }
    state.tab = button.dataset.tab;
    render({ resetScroll: true, morphTabs: true });
  });
}

let lastScroll = 0;
main.addEventListener("scroll", () => {
  const y = main.scrollTop;
  app.classList.toggle("is-scrolled", y > 10);
  if (y > lastScroll + 8 && y > 56) app.classList.add("tabs-min");
  else if (y < lastScroll - 8) app.classList.remove("tabs-min");
  lastScroll = y;
}, { passive: true });

for (const button of document.querySelectorAll("[data-cat]")) {
  button.addEventListener("click", () => selectCategory(button.dataset.cat));
}

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

window.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  setGlassLight(event.clientX / window.innerWidth, event.clientY / window.innerHeight);
}, { passive: true });

window.addEventListener("deviceorientation", (event) => {
  if (event.gamma == null) return;
  const x = 0.5 + Math.max(-1, Math.min(1, event.gamma / 45)) * 0.42;
  const y = 0.18 + Math.max(-1, Math.min(1, (event.beta || 0) / 90)) * 0.22;
  setGlassLight(x, y);
}, { passive: true });

window.addEventListener("resize", () => syncTabBlob(false));
if (window.ResizeObserver) {
  new ResizeObserver(() => syncTabBlob(false)).observe(document.getElementById("tabs-shell"));
}

tickStatus();
setInterval(tickStatus, 20000);

state.plan = planFor(state.category);
ensureCycle();
render();
requestAnimationFrame(() => syncTabBlob(false));

async function boot() {
  const builtins = Promise.all(Object.entries(BUILTIN_FILES).map(async ([id, url]) => {
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
  await builtins;
  state.ready = true;
  if (!validPlan(state.overrides[state.category])) state.plan = planFor(state.category);
  ensureCycle();
  watchPlanStamp();
  render();
  if (state.loadError && state.category === "m15" && !state.plan) toast(state.loadError);
  publishNotify().catch(() => {});
}

boot();

fetch("/api/health")
  .then((response) => response.json())
  .then((data) => {
    state.ai = Boolean(data && data.ai);
    state.httpsPort = data && data.httpsPort ? data.httpsPort : 0;
    if (state.tab === "avisos") render();
  })
  .catch(() => {});

setInterval(checkLocalReminder, 20000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (!event.data || event.data.type !== "open-avisos") return;
    state.tab = "avisos";
    render({ resetScroll: true });
  });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
