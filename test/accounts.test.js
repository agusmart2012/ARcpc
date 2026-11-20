"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");

const xlsxPath = path.join(os.tmpdir(), "tanda-cuentas-" + process.pid + "-" + Date.now() + ".xlsx");
process.env.ACCOUNTS_XLSX = xlsxPath;
process.env.SESSION_SECRET = "test-session-secret-tanda";
delete process.env.BLOB_READ_WRITE_TOKEN;

const { createServer } = require("../server");

function listen() {
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function cookieHeader(res) {
  const raw = res.headers["set-cookie"];
  if (!raw) return "";
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first).split(";")[0];
}

function request(server, { method = "GET", path = "/", body = null, headers = {}, cookie = "" }) {
  const { port } = server.address();
  const extra = Object.assign({}, headers);
  if (cookie) extra.Cookie = cookie;
  if (body && !extra["Content-Type"]) extra["Content-Type"] = "application/json";
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method, headers: extra },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          const type = res.headers["content-type"] || "";
          resolve({
            status: res.statusCode,
            raw,
            json: type.includes("json") ? JSON.parse(raw.toString("utf8")) : null,
            cookie: cookieHeader(res),
            headers: res.headers,
          });
        });
      }
    );
    req.on("error", reject);
    if (body) req.end(Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
    else req.end();
  });
}

test("registro, login, Excel y datos viajan con la cuenta", async () => {
  const server = await listen();
  try {
    const page = await request(server, { path: "/" });
    assert.equal(page.status, 200);
    const html = page.raw.toString("utf8");
    assert.match(html, /Carrasco Polo Club/);
    assert.doesNotMatch(html, /Crear cuenta/);

    const health = await request(server, { path: "/api/health" });
    assert.equal(health.status, 200);
    assert.equal(health.json.accounts, "file");

    const me0 = await request(server, { path: "/api/auth/me" });
    assert.equal(me0.status, 200);
    assert.equal(me0.json.user, null);

    const badMail = await request(server, {
      method: "POST",
      path: "/api/auth/register",
      body: { nombre: "Juan", email: "no-es-mail", password: "clave123" },
    });
    assert.equal(badMail.status, 400);

    const short = await request(server, {
      method: "POST",
      path: "/api/auth/register",
      body: { nombre: "Juan", email: "juan@cpc.uy", password: "123" },
    });
    assert.equal(short.status, 400);

    const created = await request(server, {
      method: "POST",
      path: "/api/auth/register",
      body: { nombre: "Juan Pérez", email: "Juan@cpc.uy", password: "clave123" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.user.email, "juan@cpc.uy");
    assert.equal(created.json.user.nombre, "Juan Pérez");
    assert.match(created.cookie, /^sala=/);
    assert.match(String(created.headers["set-cookie"]), /HttpOnly/i);

    const dup = await request(server, {
      method: "POST",
      path: "/api/auth/register",
      body: { nombre: "Otro", email: "juan@cpc.uy", password: "clave123" },
    });
    assert.equal(dup.status, 409);

    const me = await request(server, { path: "/api/auth/me", cookie: created.cookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, "juan@cpc.uy");

    const saved = await request(server, {
      method: "PUT",
      path: "/api/auth/data",
      cookie: created.cookie,
      body: { data: { category: "m15", log: { m15: { "2026-01-01": { squat: { sets: [true], weight: "80" } } } }, profile: { rol: "jugador", posicion: "Pilar", edad: 14, altura: 175, peso: 84, ciudad: "Montevideo", stats: { tackle: 11, velocidad: 47, resistencia: 39, pase: 50, patada: 54, individualidad: 69, equipo: 68 } } } },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.data.category, "m15");
    assert.equal(saved.json.data.log.m15["2026-01-01"].squat.weight, "80");
    assert.equal(saved.json.data.profile.posicion, "Pilar");
    assert.equal(saved.json.data.profile.stats.tackle, 11);

    const denied = await request(server, {
      method: "PUT",
      path: "/api/auth/data",
      body: { data: { category: "primera" } },
    });
    assert.equal(denied.status, 401);

    const wrong = await request(server, {
      method: "POST",
      path: "/api/auth/login",
      body: { email: "juan@cpc.uy", password: "otra-clave" },
    });
    assert.equal(wrong.status, 401);

    const logged = await request(server, {
      method: "POST",
      path: "/api/auth/login",
      body: { email: "JUAN@cpc.uy", password: "clave123" },
    });
    assert.equal(logged.status, 200);
    assert.equal(logged.json.user.nombre, "Juan Pérez");
    assert.equal(logged.json.data.data.log.m15["2026-01-01"].squat.weight, "80");
    assert.equal(logged.json.data.data.profile.posicion, "Pilar");
    assert.match(logged.cookie, /^sala=/);

    const wb = XLSX.readFile(xlsxPath);
    assert.ok(wb.SheetNames.includes("Cuentas"));
    assert.ok(wb.SheetNames.includes("Datos"));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Cuentas);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "juan@cpc.uy");
    assert.ok(rows[0].hash);
    assert.notEqual(String(rows[0].hash), "clave123");
    assert.ok(rows[0].salt);
    const dataRows = XLSX.utils.sheet_to_json(wb.Sheets.Datos);
    assert.ok(String(dataRows[0].json).includes("80"));

    const out = await request(server, { method: "POST", path: "/api/auth/logout", cookie: logged.cookie, body: {} });
    assert.equal(out.status, 200);
    assert.match(String(out.headers["set-cookie"] || ""), /Max-Age=0/i);
    const after = await request(server, { path: "/api/auth/me" });
    assert.equal(after.json.user, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try { fs.unlinkSync(xlsxPath); } catch { /* tmp */ }
  }
});

test("el admin guarda la planilla y la app pública la ve, solo en M15 y M17", async () => {
  const club = require("../lib/club");
  const accounts = require("../lib/accounts");
  await accounts.updateClubDoc(() => ({
    categories: [
      { id: "m13", label: "M13" },
      { id: "m15", label: "M15" },
      { id: "fisico-m15", label: "FISICO M15" },
      { id: "m17", label: "M17" },
    ],
    plans: {},
    hidden: [],
  }));
  const server = await listen();
  try {
    const before = await request(server, { path: "/api/club" });
    assert.equal(before.status, 200);
    assert.deepEqual(before.json.categories.map((item) => item.id), ["m15", "m17"]);

    const login = await request(server, {
      method: "POST",
      path: "/api/admin/login",
      body: { email: "admin@cpc.uy", password: "admin1234" },
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.rol, "admin");

    const saved = await request(server, {
      method: "PUT",
      path: "/api/admin/plans",
      cookie: login.cookie,
      body: {
        id: "m17",
        plan: {
          version: 1,
          sourceName: "Post-Temp A (M17)",
          week: "47-50",
          days: [{
            key: "w1:lunes",
            weekday: 1,
            label: "Lunes",
            session: "Día 1",
            blocks: [{ title: "Parte central", exercises: [{ id: "m17/d1/pecho", name: "Pecho editado", sets: 4, reps: "12" }] }],
          }],
        },
      },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.plans.m17.days[0].blocks[0].exercises[0].name, "Pecho editado");
    assert.deepEqual(saved.json.categories.map((item) => item.id), ["m15", "m17"]);

    const after = await request(server, { path: "/api/club" });
    assert.equal(after.json.plans.m17.days[0].blocks[0].exercises[0].name, "Pecho editado");
    assert.equal(after.json.plans.m13, undefined);
    assert.deepEqual(after.json.categories.map((item) => item.label), ["M15", "M17"]);

    const blocked = await request(server, {
      method: "POST",
      path: "/api/admin/categories",
      cookie: login.cookie,
      body: { label: "FISICO M15" },
    });
    assert.equal(blocked.status, 400);

    const view = await club.publicView();
    assert.deepEqual(view.categories.map((item) => item.id), ["m15", "m17"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try { fs.unlinkSync(xlsxPath); } catch { /* tmp */ }
  }
});
