const WEEKDAYS = [
  ["", "Sin día fijo"],
  ["1", "Lunes"],
  ["2", "Martes"],
  ["3", "Miércoles"],
  ["4", "Jueves"],
  ["5", "Viernes"],
  ["6", "Sábado"],
  ["0", "Domingo"],
];

const root = document.getElementById("admin-app");
const state = {
  user: null,
  hint: null,
  tab: "planilla",
  categories: [],
  plans: {},
  hidden: [],
  builtins: {},
  players: [],
  categoryId: "m15",
  plan: null,
  dirty: false,
  error: "",
};

let saveTimer = 0;
let saving = null;

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

function uid(prefix) {
  return prefix + "-" + Math.random().toString(16).slice(2, 10);
}

async function api(path, options) {
  const response = await fetch(path, Object.assign({ credentials: "same-origin" }, options || {}));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "No pude completar eso.");
  return data;
}

function setStatus(text, ok) {
  const node = document.getElementById("save-status");
  if (!node) return;
  node.textContent = text;
  node.classList.toggle("ok", Boolean(ok));
}

function editablePlan(id) {
  if (state.hidden.includes(id)) return null;
  const saved = state.plans[id];
  if (saved) return structuredClone(saved);
  const builtin = state.builtins[id];
  if (builtin) return structuredClone(builtin);
  return null;
}

function origin(id) {
  if (state.hidden.includes(id)) return "hidden";
  if (state.plans[id]) return "saved";
  if (state.builtins[id]) return "builtin";
  return "empty";
}

function exerciseTotal(plan) {
  if (!plan || !Array.isArray(plan.days)) return 0;
  return plan.days.reduce(
    (sum, day) => sum + (day.blocks || []).reduce((inner, block) => inner + ((block.exercises || []).length), 0),
    0
  );
}

function visiblePlan(id) {
  if (state.hidden.includes(id)) return null;
  return state.plans[id] || state.builtins[id] || null;
}

function applyPayload(data) {
  state.categories = data.categories || [];
  state.plans = data.plans || {};
  state.hidden = data.hidden || [];
  state.builtins = data.builtins || {};
  state.players = data.players || [];
  if (!state.categories.some((item) => item.id === state.categoryId)) {
    state.categoryId = (state.categories[0] && state.categories[0].id) || "";
  }
}

function blankExercise() {
  return {
    id: uid("ej"),
    name: "Nuevo ejercicio",
    sets: 3,
    reps: "10",
    rest: "",
    notes: "",
    videos: [],
    check: false,
  };
}

function ensurePlan() {
  if (state.plan) return state.plan;
  state.plan = {
    version: 1,
    sourceName: "Sala",
    category: state.categoryId,
    days: [],
    warnings: [],
    stats: { days: 0, exercises: 0 },
  };
  return state.plan;
}

async function flush() {
  clearTimeout(saveTimer);
  if (saving) await saving.catch(() => {});
  if (!state.dirty || !state.plan) return;
  const id = state.categoryId;
  const snapshot = structuredClone(state.plan);
  state.dirty = false;
  setStatus("Guardando…");
  saving = api("/api/admin/plans", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, plan: snapshot }),
  }).then((data) => {
    const same = state.categoryId === id;
    applyPayload(data);
    if (same && !state.dirty) {
      state.categoryId = id;
      const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (!typing) {
        state.plan = editablePlan(state.categoryId);
        render();
      } else {
        const banner = document.querySelector(".panel .banner");
        if (banner) banner.textContent = "Esta planilla es la que ven los teléfonos.";
      }
    }
    setStatus("Guardado", true);
  }).catch((error) => {
    state.dirty = true;
    setStatus(error.message || "No pude guardar.");
    throw error;
  }).finally(() => {
    saving = null;
  });
  await saving;
  if (state.dirty) await flush();
}

function touch() {
  state.dirty = true;
  setStatus("Sin guardar");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flush().catch(() => {});
  }, 450);
}

async function run(action) {
  state.error = "";
  try {
    await flush();
    const data = await action();
    applyPayload(data);
    state.plan = editablePlan(state.categoryId);
    state.dirty = false;
    render();
  } catch (error) {
    state.error = error.message || "No pude.";
    render();
  }
}

function field(label, value, oninput, attrs) {
  return el("label", {}, [
    label,
    el("input", Object.assign({ value: value == null ? "" : String(value), oninput }, attrs || {})),
  ]);
}

function renderLogin() {
  const hint = state.hint;
  const form = el("form", { class: "card" }, [
    el("div", { class: "brand" }, [
      el("img", { src: "/crest.png", alt: "" }),
      el("div", {}, [
        el("p", { class: "kicker" }, "Carrasco Polo Club"),
        el("h1", {}, "Admin de la sala"),
      ]),
    ]),
    el("p", { class: "hint" }, hint && hint.password
      ? "Usuario precargado: " + hint.email + " · Clave: " + hint.password
      : "Entrá con el usuario del club" + (hint && hint.email ? ": " + hint.email : ".")),
    el("p", { class: "error", id: "login-error" }, state.error),
    el("label", {}, ["Mail", el("input", {
      type: "email",
      name: "email",
      autocomplete: "username",
      required: true,
      value: hint && hint.email ? hint.email : "",
    })]),
    el("label", {}, ["Clave", el("input", {
      type: "password",
      name: "password",
      autocomplete: "current-password",
      required: true,
      value: hint && hint.password ? hint.password : "",
    })]),
    el("button", { class: "btn full", type: "submit" }, "Entrar"),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.error = "";
    const email = form.email.value.trim();
    const password = form.password.value;
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      state.user = data.user;
      await loadState();
    } catch (error) {
      state.error = error.message || "No pude entrar.";
      const node = document.getElementById("login-error");
      if (node) node.textContent = state.error;
    }
  });
  root.replaceChildren(el("div", { class: "login-wrap" }, form));
}

function categoryButtons() {
  return state.categories.map((item) => {
    const plan = visiblePlan(item.id);
    const count = exerciseTotal(plan);
    return el("button", {
      type: "button",
      class: "cat",
      "aria-selected": item.id === state.categoryId ? "true" : "false",
      onclick: () => openCategory(item.id),
    }, [
      el("span", {}, item.label),
      el("small", {}, count ? String(count) : "vacía"),
    ]);
  });
}

function sidebar() {
  return el("aside", { class: "side" }, [
    el("p", { class: "kicker" }, "Categorías"),
    el("div", { class: "cat-list" }, categoryButtons()),
  ]);
}

function exerciseEditor(ex, block, index) {
  return el("article", { class: "ex" }, [
    field("Ejercicio", ex.name, (event) => {
      ex.name = event.target.value;
      touch();
    }),
    el("div", { class: "grid" }, [
      field("Series", ex.sets || "", (event) => {
        ex.sets = event.target.value === "" ? "" : Number(event.target.value);
        touch();
      }, { inputmode: "numeric" }),
      field("Reps", ex.reps || "", (event) => {
        ex.reps = event.target.value;
        touch();
      }),
      field("Intensidad", ex.intensity || "", (event) => {
        ex.intensity = event.target.value;
        touch();
      }),
      field("Peso", ex.weight || "", (event) => {
        ex.weight = event.target.value;
        touch();
      }),
      field("Descanso", ex.rest || "", (event) => {
        ex.rest = event.target.value;
        touch();
      }),
    ]),
    field("Notas", ex.notes || "", (event) => {
      ex.notes = event.target.value;
      touch();
    }),
    field("Video (https)", (ex.videos && ex.videos[0] && ex.videos[0].url) || "", (event) => {
      const url = event.target.value.trim();
      ex.videos = url ? [{ url }] : [];
      touch();
    }, { placeholder: "https://", inputmode: "url" }),
    el("label", { class: "check" }, [
      el("input", {
        type: "checkbox",
        checked: ex.check ? "checked" : null,
        onchange: (event) => {
          ex.check = event.target.checked;
          touch();
        },
      }),
      "Solo marcar, sin kilos",
    ]),
    el("div", { class: "row" }, [
      el("button", { type: "button", class: "text", onclick: () => moveExercise(block, index, -1) }, "Subir"),
      el("button", { type: "button", class: "text", onclick: () => moveExercise(block, index, 1) }, "Bajar"),
      el("button", { type: "button", class: "danger", onclick: () => removeExercise(block, index) }, "Sacar"),
    ]),
  ]);
}

function moveExercise(block, index, dir) {
  const next = index + dir;
  if (next < 0 || next >= block.exercises.length) return;
  const [item] = block.exercises.splice(index, 1);
  block.exercises.splice(next, 0, item);
  touch();
  render();
}

function removeExercise(block, index) {
  block.exercises.splice(index, 1);
  touch();
  render();
}

function blockEditor(day, block, index) {
  return el("section", { class: "block" }, [
    el("div", { class: "head" }, [
      el("h3", {}, block.title || "Bloque"),
      el("button", {
        type: "button",
        class: "danger",
        onclick: () => {
          day.blocks.splice(index, 1);
          touch();
          render();
        },
      }, "Sacar bloque"),
    ]),
    field("Título del bloque", block.title || "", (event) => {
      block.title = event.target.value;
      touch();
    }, { placeholder: "Opcional" }),
    el("label", {}, [
      "Nota del bloque",
      el("textarea", {
        oninput: (event) => {
          block.note = event.target.value;
          touch();
        },
      }, block.note || ""),
    ]),
    ...(block.exercises || []).map((ex, exIndex) => exerciseEditor(ex, block, exIndex)),
    el("button", {
      type: "button",
      class: "ghost",
      onclick: () => {
        block.exercises.push(blankExercise());
        touch();
        render();
      },
    }, "Agregar ejercicio"),
  ]);
}

function moveDay(index, dir) {
  const next = index + dir;
  if (!state.plan || next < 0 || next >= state.plan.days.length) return;
  const [item] = state.plan.days.splice(index, 1);
  state.plan.days.splice(next, 0, item);
  touch();
  render();
}

function dayEditor(day, index) {
  const total = (day.blocks || []).reduce((sum, block) => sum + (block.exercises || []).length, 0);
  return el("section", { class: "day" }, [
    el("div", { class: "head" }, [
      el("h2", {}, day.label || "Día"),
      el("span", { class: "meta" }, total + (total === 1 ? " ejercicio" : " ejercicios")),
    ]),
    el("div", { class: "grid" }, [
      field("Nombre", day.label || "", (event) => {
        day.label = event.target.value;
        touch();
      }),
      el("label", {}, [
        "Día de la semana",
        el("select", {
          onchange: (event) => {
            day.weekday = event.target.value === "" ? null : Number(event.target.value);
            if (day.weekday == null) delete day.weekday;
            touch();
          },
        }, WEEKDAYS.map(([value, label]) => el("option", {
          value,
          selected: String(day.weekday == null ? "" : day.weekday) === value ? "selected" : null,
        }, label))),
      ]),
      field("Sesión", day.session || "", (event) => {
        day.session = event.target.value;
        touch();
      }, { placeholder: "Día 1" }),
    ]),
    ...(day.blocks || []).map((block, blockIndex) => blockEditor(day, block, blockIndex)),
    el("div", { class: "row" }, [
      el("button", {
        type: "button",
        class: "ghost",
        onclick: () => {
          day.blocks.push({ title: "", note: "", exercises: [blankExercise()] });
          touch();
          render();
        },
      }, "Agregar bloque"),
      el("button", { type: "button", class: "text", onclick: () => moveDay(index, -1) }, "Subir día"),
      el("button", { type: "button", class: "text", onclick: () => moveDay(index, 1) }, "Bajar día"),
      el("button", {
        type: "button",
        class: "danger",
        onclick: () => {
          if (!window.confirm("¿Sacar " + (day.label || "este día") + "?")) return;
          state.plan.days.splice(index, 1);
          touch();
          render();
        },
      }, "Sacar día"),
    ]),
  ]);
}

function planPanel() {
  const cat = state.categories.find((item) => item.id === state.categoryId);
  const kind = origin(state.categoryId);
  const file = el("input", {
    type: "file",
    accept: ".xlsx,.xls,.csv,.txt,.pdf",
    hidden: true,
    onchange: () => importFile(file.files && file.files[0]),
  });
  const banner = kind === "builtin"
    ? "Estás viendo la planilla original. Cuando cambies algo, queda para todos los teléfonos."
    : kind === "saved"
      ? "Esta planilla es la que ven los teléfonos."
      : kind === "hidden"
        ? "Esta categoría no muestra planilla en los teléfonos."
        : "Esta categoría todavía no tiene planilla.";
  const nodes = [
    el("div", { class: "head" }, [
      el("div", {}, [
        el("p", { class: "kicker" }, "Planilla"),
        el("h2", {}, cat ? cat.label : "Categoría"),
      ]),
      el("div", { class: "row" }, [
        el("span", { class: "meta" }, exerciseTotal(state.plan) + " ejercicios"),
      ]),
    ]),
    state.error ? el("p", { class: "error" }, state.error) : null,
    el("p", { class: "banner" }, banner),
    field("Nombre en la app", cat ? cat.label : "", (event) => {
      state.rename = event.target.value;
    }),
    el("div", { class: "row" }, [
      el("button", { type: "button", class: "ghost", onclick: renameCurrent }, "Guardar nombre"),
      el("button", { type: "button", class: "ghost", onclick: () => file.click() }, "Subir Excel o PDF"),
      file,
    ]),
  ];
  if (state.plan) {
    nodes.push(field("Semana", state.plan.week || "", (event) => {
      state.plan.week = event.target.value;
      touch();
    }));
    nodes.push(field("Periodo", state.plan.period || "", (event) => {
      state.plan.period = event.target.value;
      touch();
    }));
    nodes.push(el("label", {}, [
      "Aviso",
      el("textarea", {
        oninput: (event) => {
          state.plan.notice = event.target.value;
          touch();
        },
      }, state.plan.notice || ""),
    ]));
    nodes.push(el("div", { class: "days" }, state.plan.days.map((day, index) => dayEditor(day, index))));
  }
  nodes.push(el("div", { class: "row" }, [
    el("button", { type: "button", class: "btn", onclick: addDay }, "Agregar día"),
    kind === "hidden" || kind === "empty" ? null : el("button", { type: "button", class: "danger", onclick: clearCurrent }, "Sacar planilla"),
    state.builtins[state.categoryId] && kind !== "builtin" ? el("button", { type: "button", class: "ghost", onclick: restoreCurrent }, "Volver a la original") : null,
  ]));
  nodes.push(el("div", { class: "savebar" }, [
    el("span", { class: "status", id: "save-status" }, state.dirty ? "Sin guardar" : "Guardado"),
    el("button", { type: "button", class: "btn", onclick: () => flush().catch(() => {}) }, "Guardar planilla"),
  ]));
  return el("section", { class: "panel" }, nodes);
}

function playersPanel() {
  const rows = state.players.length
    ? state.players.map((player) => el("div", { class: "player" }, [
      el("div", {}, [
        el("strong", {}, player.nombre || player.email),
        el("span", {}, player.email + (player.rol === "admin" ? " · admin" : "")),
      ]),
      player.rol === "admin" ? null : el("button", {
        type: "button",
        class: "danger",
        onclick: () => removePlayer(player),
      }, "Sacar"),
    ]))
    : [el("p", { class: "empty" }, "Todavía no hay cuentas.")];
  return el("section", { class: "panel" }, [
    el("p", { class: "kicker" }, "Cuentas"),
    el("h2", {}, "Jugadores"),
    state.error ? el("p", { class: "error" }, state.error) : null,
    el("p", { class: "hint" }, "Acá se sacan las cuentas que ya no van. La del admin queda."),
    el("div", { class: "players" }, rows),
  ]);
}

function shell() {
  return el("div", { class: "shell" }, [
    el("header", { class: "topbar" }, [
      el("div", { class: "brand" }, [
        el("img", { src: "/crest.png", alt: "" }),
        el("div", {}, [
          el("p", { class: "kicker" }, "Sala de alto rendimiento"),
          el("h1", {}, "Admin"),
          el("div", { class: "tabs" }, [
            el("button", {
              type: "button",
              class: "ghost",
              "aria-selected": state.tab === "planilla" ? "true" : "false",
              onclick: () => { state.tab = "planilla"; render(); },
            }, "Planillas"),
            el("button", {
              type: "button",
              class: "ghost",
              "aria-selected": state.tab === "jugadores" ? "true" : "false",
              onclick: () => { state.tab = "jugadores"; render(); },
            }, "Jugadores"),
          ]),
        ]),
      ]),
      el("div", { class: "who" }, [
        el("p", { class: "hint" }, state.user ? state.user.email : ""),
        el("p", { class: "hint" }, "Lo que guardás lo ven todos los teléfonos."),
        el("button", { type: "button", class: "ghost", onclick: logout }, "Salir"),
      ]),
    ]),
    state.tab === "jugadores"
      ? el("div", { class: "layout", style: "grid-template-columns: 1fr" }, playersPanel())
      : el("div", { class: "layout" }, [sidebar(), planPanel()]),
  ]);
}

function render() {
  if (!state.user) {
    renderLogin();
    return;
  }
  root.replaceChildren(shell());
}

async function openCategory(id) {
  if (id === state.categoryId) return;
  try {
    await flush();
  } catch (error) {
    state.error = error.message || "No pude guardar.";
    render();
    return;
  }
  state.categoryId = id;
  state.plan = editablePlan(id);
  state.dirty = false;
  state.error = "";
  state.rename = state.plan ? "" : "";
  const cat = state.categories.find((item) => item.id === id);
  state.rename = cat ? cat.label : "";
  render();
}

function addDay() {
  const plan = ensurePlan();
  plan.days.push({
    key: uid("dia"),
    weekday: 1,
    label: "Lunes",
    session: "",
    blocks: [{ title: "", note: "", exercises: [blankExercise()] }],
  });
  touch();
  render();
}

async function importFile(file) {
  if (!file) return;
  state.error = "";
  try {
    await flush();
    const data = await api("/api/admin/import?category=" + encodeURIComponent(state.categoryId), {
      method: "POST",
      headers: { "X-Filename": encodeURIComponent(file.name) },
      body: file,
    });
    applyPayload(data);
    state.plan = data.plan ? structuredClone(data.plan) : editablePlan(state.categoryId);
    state.dirty = false;
    render();
  } catch (error) {
    state.error = error.message || "No pude leer ese archivo.";
    render();
  }
}

function renameCurrent() {
  const cat = state.categories.find((item) => item.id === state.categoryId);
  const label = state.rename || (cat && cat.label);
  run(() => api("/api/admin/categories", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: state.categoryId, label }),
  }));
}

function clearCurrent() {
  if (!window.confirm("¿Sacar la planilla de esta categoría en todos los teléfonos?")) return;
  run(() => api("/api/admin/plans/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: state.categoryId }),
  }));
}

function restoreCurrent() {
  run(() => api("/api/admin/plans/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: state.categoryId }),
  }));
}

function removePlayer(player) {
  if (!window.confirm("¿Sacar la cuenta de " + (player.nombre || player.email) + "?")) return;
  run(() => api("/api/admin/players?id=" + encodeURIComponent(player.id), { method: "DELETE" }));
}

async function logout() {
  await flush().catch(() => {});
  await api("/api/admin/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  state.user = null;
  state.plan = null;
  render();
}

async function loadState() {
  const data = await api("/api/admin/state");
  applyPayload(data);
  if (state.categories.some((item) => item.id === "m15")) state.categoryId = "m15";
  state.plan = editablePlan(state.categoryId);
  const cat = state.categories.find((item) => item.id === state.categoryId);
  state.rename = cat ? cat.label : "";
  state.dirty = false;
  render();
}

async function boot() {
  try {
    state.hint = await api("/api/admin/hint");
  } catch {
    state.hint = null;
  }
  try {
    const me = await api("/api/admin/me");
    if (me.user && me.user.rol === "admin") {
      state.user = me.user;
      await loadState();
      return;
    }
  } catch {
    /* muestra el login */
  }
  render();
}

boot();
