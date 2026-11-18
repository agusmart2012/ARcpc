"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const selfsigned = require("selfsigned");
const { parseUpload } = require("./lib/parse");
const { searchVideos } = require("./lib/youtube");
const pushhub = require("./lib/pushhub");
const accounts = require("./lib/accounts");

const ROOT = [path.join(__dirname, "public"), path.join(process.cwd(), "public"), path.join(__dirname, "..", "public")]
  .find((dir) => fs.existsSync(path.join(dir, "index.html"))) || path.join(__dirname, "public");
const MODEL = "grok-4.7";
const MAX_IMPORT = 8 * 1024 * 1024;
const MAX_JSON = 200 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
};

loadEnv(path.join(__dirname, ".env"));

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(res, status, body, extra) {
  const payload = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  }, extra || {}));
  res.end(payload);
}

function sendAuth(res, status, body, cookie) {
  sendJson(res, status, body, cookie ? { "Set-Cookie": cookie } : undefined);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error("El archivo es demasiado grande (máximo 8 MB).");
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeFile(urlPath) {
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  if (rel.includes("\0")) return null;
  const filePath = path.resolve(ROOT, rel);
  const fromRoot = path.relative(ROOT, filePath);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return null;
  return filePath;
}

function filenameFrom(req) {
  const raw = req.headers["x-filename"];
  if (!raw) return "rutina.xlsx";
  try {
    return decodeURIComponent(String(raw)).replace(/[\r\n]/g, "").slice(0, 140) || "rutina.xlsx";
  } catch {
    return "rutina.xlsx";
  }
}

function coachMessages(body) {
  const list = Array.isArray(body.messages) ? body.messages : [];
  return list
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .slice(-12)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 4000) }))
    .filter((item) => item.content.trim());
}

function systemPrompt(context) {
  return [
    "Sos el coach de Tanda, una app de rutina de gym. Hablás en español rioplatense, de vos, concreto y corto.",
    "Ayudás con la sesión de hoy: para qué sirve cada ejercicio, cómo acomodar el cuerpo, cuánto descansar, cómo reemplazar una máquina ocupada y si el peso anotado tiene sentido para seguir.",
    "No das diagnósticos, ni dietas, ni un plan médico. Si la persona describe un dolor agudo, hinchazón o un tirón, le decís que pare y lo vea alguien de salud.",
    "No abras con un descargo. Respondé en prosa breve. Como mucho una lista corta si te piden pasos.",
    "No inventes ejercicios que no estén en la rutina salvo que te pidan un reemplazo.",
    "",
    "Rutina y marcas de hoy:",
    context || "Sin rutina cargada.",
  ].join("\n");
}

async function handleCoach(req, res) {
  const key = process.env.XAI_API_KEY;
  if (!key) {
    sendJson(res, 503, {
      error: "missing_key",
      message: "Falta la clave del coach. En la carpeta gym, copiá .env.example a .env, pegá XAI_API_KEY y reiniciá.",
    });
    return;
  }

  let body;
  try {
    body = JSON.parse((await readBody(req, MAX_JSON)).toString("utf8") || "{}");
  } catch (error) {
    sendJson(res, error.status || 400, { error: "bad_json", message: error.status ? error.message : "No pude leer el mensaje." });
    return;
  }

  const messages = coachMessages(body);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    sendJson(res, 400, { error: "empty", message: "Escribí qué querés preguntar." });
    return;
  }

  const context = String(body.context || "").slice(0, 6000);
  let upstream;
  try {
    upstream = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        reasoning_effort: "low",
        messages: [{ role: "system", content: systemPrompt(context) }, ...messages],
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch {
    sendJson(res, 502, { error: "upstream", message: "No llegué a xAI. Revisá la conexión de esta compu." });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    let detail = "El coach no pudo responder.";
    try {
      const errBody = await upstream.json();
      if (errBody && errBody.error && errBody.error.message) detail = "xAI: " + String(errBody.error.message).slice(0, 240);
    } catch {
      /* el cuerpo no era JSON */
    }
    sendJson(res, 502, { error: "upstream", message: detail });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        const token = delta && typeof delta.content === "string" ? delta.content : "";
        if (token) res.write("data: " + JSON.stringify({ t: token }) + "\n\n");
      }
    }
    res.write("data: " + JSON.stringify({ done: true }) + "\n\n");
  } catch {
    res.write("data: " + JSON.stringify({ error: "Se cortó la respuesta del coach." }) + "\n\n");
  }
  res.end();
}

async function handleImport(req, res) {
  let buffer;
  try {
    buffer = await readBody(req, MAX_IMPORT);
  } catch (error) {
    sendJson(res, error.status || 400, { error: "upload", message: error.message || "No pude recibir el archivo." });
    return;
  }
  if (!buffer.length) {
    sendJson(res, 400, { error: "empty", message: "El archivo está vacío." });
    return;
  }
  try {
    sendJson(res, 200, await parseUpload(buffer, filenameFrom(req)));
  } catch (error) {
    sendJson(res, error.status || 400, {
      error: "parse",
      message: error.message || "No pude leer ese archivo.",
    });
  }
}

function lanAddresses() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (v4 && !net.internal && /^\d+\.\d+\.\d+\.\d+$/.test(net.address)) ips.push(net.address);
    }
  }
  return [...new Set(ips)];
}

async function ensureCert(ips) {
  const dir = path.join(__dirname, "data");
  fs.mkdirSync(dir, { recursive: true });
  const names = ["localhost", "127.0.0.1", ...ips];
  const marker = names.join(",");
  const markerFile = path.join(dir, "cert-ips.txt");
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  if (fs.existsSync(keyFile) && fs.existsSync(certFile) && fs.existsSync(markerFile) && fs.readFileSync(markerFile, "utf8") === marker) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  }
  const altNames = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
  ];
  for (const ip of ips) altNames.push({ type: 7, ip });
  const pems = await selfsigned.generate([{ name: "commonName", value: "Sala de Alto Rendimiento" }], {
    days: 825,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [{ name: "subjectAltName", altNames }],
  });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(markerFile, marker);
  return { key: pems.private, cert: pems.cert };
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req, MAX_JSON)).toString("utf8") || "{}");
  } catch (error) {
    const failure = new Error(error.status ? error.message : "No pude leer el mensaje.");
    failure.status = error.status || 400;
    throw failure;
  }
}

async function handleNotifyKey(res) {
  sendJson(res, 200, { publicKey: pushhub.publicKey() });
}

async function handleNotifySubscribe(req, res) {
  const body = await readJson(req);
  pushhub.saveSubscription(body.subscription, body.prefs);
  sendJson(res, 200, { ok: true });
}

async function handleNotifyTest(req, res) {
  const body = await readJson(req);
  const sent = await pushhub.sendTest(String(body.endpoint || ""));
  sendJson(res, sent ? 200 : 404, sent ? { ok: true } : { error: "missing", message: "Este teléfono todavía no está suscrito." });
}

async function handleNotifyRoutine(req, res) {
  const body = await readJson(req);
  const sent = await pushhub.sendRoutine(body.title, body.body, String(body.endpoint || ""));
  sendJson(res, 200, { ok: true, sent });
}

async function handleRegister(req, res) {
  accounts.rateLimit(req);
  const user = await accounts.register(await readJson(req));
  sendAuth(res, 201, { user, data: { data: null, updated: null } }, accounts.sessionCookie(user.id, req));
}

async function handleLogin(req, res) {
  accounts.rateLimit(req);
  const user = await accounts.login(await readJson(req));
  const data = await accounts.getData(user.id);
  sendAuth(res, 200, { user, data }, accounts.sessionCookie(user.id, req));
}

async function handleLogout(req, res) {
  sendAuth(res, 200, { ok: true }, accounts.clearCookie(req));
}

async function handleMe(req, res) {
  const user = await accounts.userFromRequest(req);
  if (!user) {
    sendJson(res, 200, { user: null, data: null });
    return;
  }
  sendJson(res, 200, { user, data: await accounts.getData(user.id) });
}

async function handleAuthData(req, res) {
  const user = await accounts.requireUser(req);
  if (req.method === "GET") {
    sendJson(res, 200, await accounts.getData(user.id));
    return;
  }
  const body = await readJson(req);
  sendJson(res, 200, await accounts.putData(user.id, body.data));
}

async function handleVideos(req, res, url) {
  try {
    const videos = await searchVideos(url.searchParams.get("q") || "");
    sendJson(res, 200, { videos });
  } catch (error) {
    sendJson(res, error.status || 502, {
      error: "videos",
      message: error.message || "No pude buscar videos.",
    });
  }
}

function serveStatic(res, urlPath) {
  const filePath = safeFile(urlPath);
  if (!filePath) {
    sendJson(res, 403, { error: "forbidden", message: "No." });
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, error.code === "ENOENT" ? 404 : 500, {
        error: error.code === "ENOENT" ? "not_found" : "read",
        message: error.code === "ENOENT" ? "No está." : "No pude leer el archivo.",
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

let securePort = 0;

function handleRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  return Promise.resolve()
    .then(async () => {
      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, {
          ok: true,
          ai: Boolean(process.env.XAI_API_KEY),
          model: MODEL,
          httpsPort: securePort || null,
          accounts: accounts.storageKind(),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/register") {
        await handleRegister(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/login") {
        await handleLogin(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/logout") {
        await handleLogout(req, res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/auth/me") {
        await handleMe(req, res);
        return;
      }
      if ((req.method === "GET" || req.method === "PUT") && url.pathname === "/api/auth/data") {
        await handleAuthData(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/import") {
        await handleImport(req, res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/videos") {
        await handleVideos(req, res, url);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/coach") {
        await handleCoach(req, res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/notifications/key") {
        await handleNotifyKey(res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/notifications/subscribe") {
        await handleNotifySubscribe(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/notifications/test") {
        await handleNotifyTest(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/notifications/routine") {
        await handleNotifyRoutine(req, res);
        return;
      }
      if (req.method === "GET") {
        serveStatic(res, url.pathname);
        return;
      }
      sendJson(res, 405, { error: "method", message: "Método no permitido." });
    })
    .catch((error) => {
      if (!res.headersSent) {
        sendJson(res, error.status || 500, {
          error: "server",
          message: error.status ? error.message : "Se rompió algo en el servidor.",
        });
      } else res.end();
      if (!error.status) console.error(error);
    });
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res);
  });
}

function lanUrls(port) {
  const urls = [];
  const skipped = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    const virtual = /vmware|virtual|vbox|hyper-?v|wsl|bluetooth|loopback|tunnel|tailscale|zerotier|\bvpn\b|tap|tun/i.test(name);
    for (const net of list || []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (!v4 || net.internal) continue;
      const hostOnly = net.address.startsWith("192.168.56.");
      const url = "http://" + net.address + ":" + port;
      if (virtual || hostOnly) skipped.push(url);
      else urls.push(url);
    }
  }
  return urls.length ? urls : skipped;
}

function listen(port = Number(process.env.PORT) || 4173) {
  const server = createServer();
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error("El puerto " + port + " está ocupado. Cerrá la otra ventana de la app o cambiá PORT en .env.");
      process.exit(1);
    }
    throw error;
  });
  const nextSecure = Number(process.env.HTTPS_PORT) || port + 1;
  ensureCert(lanAddresses()).then((tls) => {
    const secure = https.createServer(tls, (req, res) => {
      handleRequest(req, res);
    });
    secure.on("error", (error) => {
      console.error(error.code === "EADDRINUSE"
        ? "El puerto " + nextSecure + " está ocupado. Las notificaciones del iPhone necesitan ese https."
        : error);
    });
    secure.listen(nextSecure, "0.0.0.0", () => {
      securePort = nextSecure;
    });
  }).catch((error) => {
    console.error("No pude abrir el https de las notificaciones.");
    console.error(error);
  });
  setInterval(() => {
    pushhub.dispatchDue(new Date()).catch((error) => console.error(error));
  }, 20000);
  pushhub.dispatchDue(new Date()).catch(() => {});
  server.listen(port, "0.0.0.0", () => {
    console.log("");
    console.log("  Sala de Alto Rendimiento · Carrasco Polo Club");
    console.log("  En esta compu:  http://localhost:" + port);
    for (const url of lanUrls(port)) {
      console.log("  En el iPhone:   " + url);
      console.log("  Avisos iPhone:  " + url.replace("http://", "https://").replace(":" + port, ":" + nextSecure));
    }
    console.log("  Cuentas:        " + (accounts.storageKind() === "blob" ? "Excel en Vercel Blob" : "Excel en data/cuentas.xlsx"));
    console.log("  Coach:          " + (process.env.XAI_API_KEY ? "listo (Grok)" : "falta XAI_API_KEY en .env"));
    console.log("");
  });
  return server;
}

if (require.main === module) listen();

module.exports = { createServer, listen, handleRequest };
