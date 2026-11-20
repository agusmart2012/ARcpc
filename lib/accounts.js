"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");

const BLOB_NAME = "sala/cuentas.xlsx";
const CELL = 30000;
const MAX_JSON = 400000;
const COOKIE = "sala";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const CUENTAS_HEADER = ["id", "nombre", "email", "hash", "salt", "creado", "rol"];
const DATOS_HEADER = ["id", "parte", "json", "actualizado"];
const CLUB_HEADER = ["id", "parte", "json", "actualizado"];
const CLUB_MAX = 1500000;
const DEFAULT_ADMIN_EMAIL = "admin@cpc.uy";
const DEFAULT_ADMIN_PASSWORD = "admin1234";

let queue = Promise.resolve();
let cache = { buf: null, at: 0 };
let fallbackSecret = "";
let adminPending = null;
const attempts = new Map();

function fail(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code || "auth";
  throw error;
}

function storageKind() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  return "file";
}

function filePath() {
  if (process.env.ACCOUNTS_XLSX) return process.env.ACCOUNTS_XLSX;
  if (process.env.VERCEL) return path.join(os.tmpdir(), "cuentas.xlsx");
  return path.join(__dirname, "..", "data", "cuentas.xlsx");
}

function secret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) return process.env.SESSION_SECRET;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return crypto.createHash("sha256").update("sala:" + process.env.BLOB_READ_WRITE_TOKEN).digest("hex");
  }
  if (!fallbackSecret) fallbackSecret = crypto.randomBytes(32).toString("hex");
  return fallbackSecret;
}

function emptyWorkbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CUENTAS_HEADER]), "Cuentas");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([DATOS_HEADER]), "Datos");
  return wb;
}

function encodeWorkbook(wb) {
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

function decodeWorkbook(buf) {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  if (!wb.Sheets.Cuentas) wb.Sheets.Cuentas = XLSX.utils.aoa_to_sheet([CUENTAS_HEADER]);
  if (!wb.Sheets.Datos) wb.Sheets.Datos = XLSX.utils.aoa_to_sheet([DATOS_HEADER]);
  if (!wb.SheetNames.includes("Cuentas")) wb.SheetNames.unshift("Cuentas");
  if (!wb.SheetNames.includes("Datos")) wb.SheetNames.push("Datos");
  return wb;
}

function blobSdk() {
  try {
    return require("@vercel/blob");
  } catch {
    return null;
  }
}

function isMissingBlob(error) {
  const text = String((error && error.message) || error || "").toLowerCase();
  const status = error && (error.status || error.statusCode);
  return status === 404 || text.includes("not found") || text.includes("no such") || text.includes("does not exist");
}

async function restPut(buf, token) {
  const params = new URLSearchParams({
    access: "private",
    allowOverwrite: "1",
    addRandomSuffix: "0",
  });
  const url = "https://blob.vercel-storage.com/" + encodeURIComponent(BLOB_NAME) + "?" + params.toString();
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + token,
      "x-api-version": "7",
      "x-content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    body: buf,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("No pude guardar el Excel en Vercel Blob (" + response.status + "). " + detail.slice(0, 180));
  }
}

async function restGet(token) {
  const listUrl = "https://blob.vercel-storage.com?" + new URLSearchParams({ prefix: BLOB_NAME, limit: "20" }).toString();
  const listed = await fetch(listUrl, {
    headers: {
      Authorization: "Bearer " + token,
      "x-api-version": "7",
    },
  });
  if (listed.status === 404) return null;
  if (!listed.ok) throw new Error("No pude leer el Excel de las cuentas (" + listed.status + ").");
  const body = await listed.json();
  const hit = (body.blobs || []).find((item) => item.pathname === BLOB_NAME || String(item.pathname || "").endsWith("/" + BLOB_NAME) || String(item.pathname || "").endsWith(BLOB_NAME));
  if (!hit || !hit.url) return null;
  const url = hit.url + (hit.url.includes("?") ? "&" : "?") + "cache=0";
  const file = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (file.status === 404) return null;
  if (!file.ok) throw new Error("No pude bajar el Excel de las cuentas.");
  return Buffer.from(await file.arrayBuffer());
}

async function blobPut(buf) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const sdk = blobSdk();
  if (sdk && typeof sdk.put === "function") {
    await sdk.put(BLOB_NAME, buf, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      token,
    });
    return;
  }
  await restPut(buf, token);
}

async function blobGet() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const sdk = blobSdk();
  if (sdk && typeof sdk.get === "function") {
    try {
      const result = await sdk.get(BLOB_NAME, { access: "private", useCache: false, token });
      if (!result) return null;
      if (Buffer.isBuffer(result)) return result;
      if (typeof result.arrayBuffer === "function") return Buffer.from(await result.arrayBuffer());
      if (result.stream) {
        const chunks = [];
        for await (const chunk of result.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return Buffer.concat(chunks);
      }
      if (result.body) return Buffer.from(await new Response(result.body).arrayBuffer());
    } catch (error) {
      if (isMissingBlob(error)) return null;
      throw error;
    }
  }
  if (sdk && typeof sdk.list === "function") {
    try {
      const listed = await sdk.list({ prefix: BLOB_NAME, token, limit: 20 });
      const hit = (listed.blobs || []).find((item) => item.pathname === BLOB_NAME || String(item.pathname || "").endsWith(BLOB_NAME));
      if (!hit) return null;
      const url = hit.url + (hit.url.includes("?") ? "&" : "?") + "cache=0";
      const file = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if (file.status === 404) return null;
      if (!file.ok) throw new Error("No pude bajar el Excel de las cuentas.");
      return Buffer.from(await file.arrayBuffer());
    } catch (error) {
      if (isMissingBlob(error)) return null;
      throw error;
    }
  }
  return restGet(token);
}

function readFileStore() {
  const target = filePath();
  try {
    if (fs.existsSync(target)) return fs.readFileSync(target);
  } catch {
    /* se crea de nuevo */
  }
  return encodeWorkbook(emptyWorkbook());
}

function writeFileStore(buf) {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
}

async function readStore() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const remote = await blobGet();
    if (remote && remote.length) return remote;
    const created = encodeWorkbook(emptyWorkbook());
    await blobPut(created);
    writeFileStore(created);
    return created;
  }
  return readFileStore();
}

async function writeStore(buf) {
  writeFileStore(buf);
  if (process.env.BLOB_READ_WRITE_TOKEN) await blobPut(buf);
}

function withLock(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function loadWorkbook() {
  if (cache.buf && Date.now() - cache.at < 800) return decodeWorkbook(cache.buf);
  const buf = await readStore();
  cache = { buf, at: Date.now() };
  return decodeWorkbook(buf);
}

async function saveWorkbook(wb) {
  const buf = encodeWorkbook(wb);
  await writeStore(buf);
  cache = { buf, at: Date.now() };
}

function sheetRows(wb, name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name] || {}, { defval: "" });
}

function writeSheet(wb, name, rows, header) {
  wb.Sheets[name] = XLSX.utils.json_to_sheet(rows, { header });
  if (!wb.SheetNames.includes(name)) wb.SheetNames.push(name);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    nombre: String(row.nombre || ""),
    email: String(row.email || ""),
    rol: String(row.rol || "") === "admin" ? "admin" : "jugador",
  };
}

function adminEmail() {
  const email = String(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return DEFAULT_ADMIN_EMAIL;
  return email;
}

function adminPassword() {
  const password = String(process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD);
  if (password.length < 6 || password.length > 72) return DEFAULT_ADMIN_PASSWORD;
  return password;
}

function findByEmail(rows, email) {
  return rows.find((row) => String(row.email || "").toLowerCase() === email) || null;
}

function findById(rows, id) {
  return rows.find((row) => String(row.id) === String(id)) || null;
}

function hashPassword(password, salt) {
  const used = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, used, 32, SCRYPT).toString("hex");
  return { hash, salt: used };
}

function checkPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  let expected;
  try {
    expected = Buffer.from(String(hash), "hex");
  } catch {
    return false;
  }
  const actual = crypto.scryptSync(password, String(salt), 32, SCRYPT);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function cleanName(value) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 40) fail(400, "Poné tu nombre (2 a 40 letras).");
  return name;
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) fail(400, "Ese mail no vale.");
  return email;
}

function cleanPassword(value) {
  const password = String(value || "");
  if (password.length < 6) fail(400, "La clave tiene que tener 6 caracteres o más.");
  if (password.length > 72) fail(400, "La clave es demasiado larga.");
  return password;
}

function signSession(userId) {
  const exp = String(Date.now() + SESSION_MS);
  const payload = userId + "." + exp;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  return payload + "." + sig;
}

function readSession(token) {
  const raw = String(token || "");
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  if (!id || !exp || !sig || !/^[a-f0-9]+$/i.test(sig)) return null;
  if (Number(exp) < Date.now()) return null;
  const expected = crypto.createHmac("sha256", secret()).update(id + "." + exp).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
  return id;
}

function cookieFrom(req) {
  const header = String(req.headers && req.headers.cookie || "");
  const match = header.match(/(?:^|;\s*)sala=([^;]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function isHttps(req) {
  const proto = String((req.headers && req.headers["x-forwarded-proto"]) || "").split(",")[0].trim();
  if (proto === "https") return true;
  return Boolean(process.env.VERCEL);
}

function cookieHeader(token, maxAge, req) {
  const parts = [COOKIE + "=" + token, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=" + maxAge];
  if (isHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

function sessionCookie(userId, req) {
  return cookieHeader(signSession(userId), Math.floor(SESSION_MS / 1000), req);
}

function clearCookie(req) {
  return cookieHeader("", 0, req);
}

function clientIp(req) {
  const forwarded = String((req.headers && req.headers["x-forwarded-for"]) || "").split(",")[0].trim();
  return forwarded || (req.socket && req.socket.remoteAddress) || "local";
}

function rateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const slot = attempts.get(ip) || { n: 0, reset: now + 15 * 60 * 1000 };
  if (now > slot.reset) {
    slot.n = 0;
    slot.reset = now + 15 * 60 * 1000;
  }
  slot.n += 1;
  attempts.set(ip, slot);
  if (slot.n > 40) fail(429, "Demasiados intentos. Esperá un rato.");
}

function readPackedData(wb, userId) {
  const rows = sheetRows(wb, "Datos")
    .filter((row) => String(row.id) === String(userId))
    .sort((a, b) => Number(a.parte || 0) - Number(b.parte || 0));
  if (!rows.length) return { data: null, updated: null };
  const json = rows.map((row) => String(row.json || "")).join("");
  let data = null;
  try {
    data = json ? JSON.parse(json) : null;
  } catch {
    data = null;
  }
  return { data, updated: rows[0].actualizado || null };
}

function writePackedData(wb, userId, data) {
  const json = JSON.stringify(data == null ? {} : data);
  if (json.length > MAX_JSON) fail(413, "Hay demasiados datos para guardar.");
  const others = sheetRows(wb, "Datos").filter((row) => String(row.id) !== String(userId));
  const now = new Date().toISOString();
  if (!json.length) {
    others.push({ id: userId, parte: 0, json: "{}", actualizado: now });
  } else {
    let part = 0;
    for (let i = 0; i < json.length; i += CELL) {
      others.push({ id: userId, parte: part, json: json.slice(i, i + CELL), actualizado: now });
      part += 1;
    }
  }
  writeSheet(wb, "Datos", others, DATOS_HEADER);
}

async function register(body) {
  const nombre = cleanName(body && body.nombre);
  const email = cleanEmail(body && body.email);
  const password = cleanPassword(body && body.password);
  if (email === adminEmail()) fail(409, "Ese mail es el del admin de la sala.");
  return withLock(async () => {
    const wb = await loadWorkbook();
    const rows = sheetRows(wb, "Cuentas");
    if (findByEmail(rows, email)) fail(409, "Ese mail ya tiene cuenta. Entrá con la clave.");
    const id = "u_" + crypto.randomBytes(8).toString("hex");
    const hashed = hashPassword(password);
    rows.push({
      id,
      nombre,
      email,
      hash: hashed.hash,
      salt: hashed.salt,
      creado: new Date().toISOString(),
    });
    writeSheet(wb, "Cuentas", rows, CUENTAS_HEADER);
    await saveWorkbook(wb);
    return publicUser(rows[rows.length - 1]);
  });
}

async function login(body) {
  const email = cleanEmail(body && body.email);
  const password = cleanPassword(body && body.password);
  return withLock(async () => {
    const wb = await loadWorkbook();
    const row = findByEmail(sheetRows(wb, "Cuentas"), email);
    if (!row || !checkPassword(password, row.hash, row.salt)) fail(401, "Mail o clave incorrectos.");
    return publicUser(row);
  });
}

async function userFromRequest(req) {
  const id = readSession(cookieFrom(req));
  if (!id) return null;
  const wb = await loadWorkbook();
  return publicUser(findById(sheetRows(wb, "Cuentas"), id));
}

async function getData(userId) {
  const wb = await loadWorkbook();
  return readPackedData(wb, userId);
}

async function putData(userId, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail(400, "No pude leer los datos.");
  return withLock(async () => {
    const wb = await loadWorkbook();
    if (!findById(sheetRows(wb, "Cuentas"), userId)) fail(401, "Entrá de nuevo.");
    writePackedData(wb, userId, data);
    await saveWorkbook(wb);
    return readPackedData(wb, userId);
  });
}

async function requireUser(req) {
  const user = await userFromRequest(req);
  if (!user) fail(401, "Entrá con tu cuenta.");
  return user;
}

async function ensureAdmin() {
  if (adminPending) return adminPending;
  const email = adminEmail();
  const password = adminPassword();
  adminPending = withLock(async () => {
    const wb = await loadWorkbook();
    const rows = sheetRows(wb, "Cuentas");
    let row = findByEmail(rows, email);
    let created = false;
    let dirty = false;
    if (!row) {
      const hashed = hashPassword(password);
      row = {
        id: "u_admin",
        nombre: "Admin",
        email,
        hash: hashed.hash,
        salt: hashed.salt,
        creado: new Date().toISOString(),
        rol: "admin",
      };
      rows.push(row);
      created = true;
      dirty = true;
    } else if (String(row.rol) !== "admin") {
      row.rol = "admin";
      dirty = true;
    }
    if (dirty) {
      writeSheet(wb, "Cuentas", rows, CUENTAS_HEADER);
      await saveWorkbook(wb);
    }
    const preset = checkPassword(password, row.hash, row.salt);
    return {
      email,
      password: preset ? password : "",
      preset,
      created,
    };
  }).catch((error) => {
    adminPending = null;
    throw error;
  });
  return adminPending;
}

async function requireAdmin(req) {
  await ensureAdmin();
  const user = await userFromRequest(req);
  if (!user) fail(401, "Entrá con la cuenta admin.");
  if (user.rol !== "admin") fail(403, "Esto es solo para el admin.");
  return user;
}

async function listUsers() {
  const wb = await loadWorkbook();
  return sheetRows(wb, "Cuentas").map((row) => ({
    id: String(row.id),
    nombre: String(row.nombre || ""),
    email: String(row.email || ""),
    creado: String(row.creado || ""),
    rol: String(row.rol || "") === "admin" ? "admin" : "jugador",
  }));
}

async function removeUser(id) {
  const target = String(id || "");
  if (!target) fail(400, "Falta la cuenta.");
  return withLock(async () => {
    const wb = await loadWorkbook();
    const rows = sheetRows(wb, "Cuentas");
    const row = findById(rows, target);
    if (!row) fail(404, "Esa cuenta no está.");
    if (String(row.rol) === "admin") fail(400, "La cuenta admin no se saca.");
    writeSheet(wb, "Cuentas", rows.filter((item) => String(item.id) !== target), CUENTAS_HEADER);
    const datos = sheetRows(wb, "Datos").filter((item) => String(item.id) !== target);
    writeSheet(wb, "Datos", datos, DATOS_HEADER);
    await saveWorkbook(wb);
    return { ok: true };
  });
}

function readClubDoc(wb) {
  const rows = sheetRows(wb, "Club")
    .filter((row) => String(row.id) === "club")
    .sort((a, b) => Number(a.parte || 0) - Number(b.parte || 0));
  if (!rows.length) return null;
  const json = rows.map((row) => String(row.json || "")).join("");
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

function writeClubDoc(wb, data) {
  const json = JSON.stringify(data == null ? {} : data);
  if (json.length > CLUB_MAX) fail(413, "Hay demasiados datos en la sala.");
  const now = new Date().toISOString();
  const rows = [];
  let part = 0;
  for (let i = 0; i < json.length; i += CELL) {
    rows.push({ id: "club", parte: part, json: json.slice(i, i + CELL), actualizado: now });
    part += 1;
  }
  writeSheet(wb, "Club", rows, CLUB_HEADER);
}

async function getClubDoc() {
  const wb = await loadWorkbook();
  return readClubDoc(wb);
}

async function updateClubDoc(fn) {
  return withLock(async () => {
    const wb = await loadWorkbook();
    const next = await fn(readClubDoc(wb));
    writeClubDoc(wb, next);
    await saveWorkbook(wb);
    return next;
  });
}

module.exports = {
  storageKind,
  register,
  login,
  requireUser,
  requireAdmin,
  ensureAdmin,
  listUsers,
  removeUser,
  userFromRequest,
  getData,
  putData,
  getClubDoc,
  updateClubDoc,
  sessionCookie,
  clearCookie,
  rateLimit,
  filePath,
};
