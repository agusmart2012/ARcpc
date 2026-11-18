"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server");
const { sampleBuffer } = require("../scripts/make-sample");

function listen() {
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(server, { method = "GET", path = "/", body = null, headers = {} }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = require("http").request(
      { hostname: "127.0.0.1", port, path, method, headers },
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
          });
        });
      }
    );
    req.on("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

test("importa el ejemplo, sirve la app y el coach explica si falta la clave", async () => {
  const server = await listen();
  try {
    const health = await request(server, { path: "/api/health" });
    assert.equal(health.status, 200);
    assert.equal(typeof health.json.ai, "boolean");

    const page = await request(server, { path: "/" });
    assert.equal(page.status, 200);
    const html = page.raw.toString("utf8");
    assert.match(html, /Carrasco Polo Club/);
    assert.match(html, /data-cat="m15"/);
    assert.match(html, /PRE-INTER/);
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /id="gate"/);
    assert.match(html, /id="gate-ficha"/);
    assert.match(html, /data-tab="cuenta"/);
    assert.match(html, />Perfil</);
    assert.doesNotMatch(html, /data-tab="coach"/);

    const routine = await request(server, { path: "/routines/m15.json" });
    assert.equal(routine.status, 200);
    assert.equal(routine.json.days.length, 4);
    assert.equal(routine.json.category, "m15");
    assert.equal(routine.json.week, "47-50");
    assert.deepEqual(routine.json.days.map((day) => day.label), ["Lunes", "Martes", "Jueves", "Viernes"]);

    const imported = await request(server, {
      method: "POST",
      path: "/api/import",
      body: sampleBuffer(),
      headers: { "X-Filename": encodeURIComponent("rutina-ejemplo.xlsx") },
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.json.stats.days, 4);
    assert.ok(imported.json.stats.exercises >= 16);

    if (!process.env.XAI_API_KEY) {
      const coach = await request(server, {
        method: "POST",
        path: "/api/coach",
        body: Buffer.from(JSON.stringify({ messages: [{ role: "user", content: "¿Cómo caliento?" }], context: "Lunes" })),
        headers: { "Content-Type": "application/json" },
      });
      assert.equal(coach.status, 503);
      assert.match(coach.json.message, /XAI_API_KEY/);
    }

    const rewrittenHealth = await request(server, { path: "/api?route=/api/health" });
    assert.equal(rewrittenHealth.status, 200);
    assert.equal(rewrittenHealth.json.ok, true);

    const rewrittenLogin = await request(server, {
      method: "POST",
      path: "/api?route=/api/auth/login",
      body: Buffer.from(JSON.stringify({ email: "lu@cpc.uy", password: "clave123" })),
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(rewrittenLogin.status, 401);
    assert.match(rewrittenLogin.json.message, /Mail o clave/);

    const forwardedHealth = await request(server, {
      path: "/api/index.js",
      headers: { "x-forwarded-uri": "/api/health" },
    });
    assert.equal(forwardedHealth.status, 200);
    assert.equal(forwardedHealth.json.ok, true);

    const actionLogin = await request(server, {
      method: "POST",
      path: "/api/auth?action=login",
      body: Buffer.from(JSON.stringify({ email: "lu@cpc.uy", password: "clave123" })),
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(actionLogin.status, 401);
    assert.match(actionLogin.json.message, /Mail o clave/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
