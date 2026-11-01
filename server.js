require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");

const required = ["PTERO_URL", "PTERO_API_KEY", "PTERO_SERVER_ID", "PANEL_PASSWORD", "SESSION_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("Missing environment variables:", missing.join(", "));
  process.exit(1);
}
if (process.env.PANEL_PASSWORD.length < 16 || process.env.SESSION_SECRET.length < 32) {
  console.error("PANEL_PASSWORD must be at least 16 characters and SESSION_SECRET at least 32.");
  process.exit(1);
}
const panelUrl = process.env.PTERO_URL.replace(/\/+$/, "");
const serverId = process.env.PTERO_SERVER_ID;
const app = express();
const sessions = new Map();
const SESSION_TTL = 12 * 60 * 60 * 1000;
const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'", "wss:", "https:"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"]
  }}
}));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: false }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

function sign(id) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(id).digest("hex");
}
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  const entry = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}
function createSession() {
  const id = crypto.randomBytes(32).toString("hex");
  sessions.set(id, Date.now() + SESSION_TTL);
  return id + "." + sign(id);
}
function requireAuth(req, res, next) {
  const token = readCookie(req, "ptero_session");
  const [id, signature] = token.split(".");
  if (!id || !signature || signature.length !== 64 ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id)))) {
    return res.status(401).json({ error: "Sesi tidak valid. Silakan login." });
  }
  const expires = sessions.get(id);
  if (!expires || expires < Date.now()) {
    sessions.delete(id);
    return res.status(401).json({ error: "Sesi berakhir. Silakan login kembali." });
  }
  sessions.set(id, Date.now() + SESSION_TTL);
  req.sessionId = id;
  next();
}
async function ptero(endpoint, options = {}) {
  const response = await fetch(panelUrl + "/api/client/servers/" + serverId + endpoint, {
    ...options,
    headers: {
      Authorization: "Bearer " + process.env.PTERO_API_KEY,
      Accept: "Application/vnd.pterodactyl.v1+json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.errors?.[0]?.detail || body.message || "Pterodactyl API error");
    error.status = response.status;
    throw error;
  }
  return body;
}
function apiError(err, res) {
  console.error("Pterodactyl request failed:", err.message);
  const status = [400, 401, 403, 404, 429].includes(err.status) ? err.status : 502;
  res.status(status).json({
    error: status === 502 ? "Tidak dapat menghubungi Pterodactyl. Periksa URL dan koneksi backend." : err.message
  });
}

app.post("/api/login", loginLimiter, (req, res) => {
  const password = String(req.body?.password || "");
  const expected = process.env.PANEL_PASSWORD;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Password salah." });
  }
  const token = createSession();
  res.setHeader("Set-Cookie", "ptero_session=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200" + secureCookie);
  res.json({ ok: true });
});
app.post("/api/logout", requireAuth, (req, res) => {
  sessions.delete(req.sessionId);
  res.setHeader("Set-Cookie", "ptero_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" + secureCookie);
  res.json({ ok: true });
});
app.get("/api/me", requireAuth, (_req, res) => res.json({ authenticated: true }));

app.get("/api/server", requireAuth, async (_req, res) => {
  try {
    const [server, resources] = await Promise.all([ptero(""), ptero("/resources")]);
    res.json({ server: server.attributes, resources: resources.attributes });
  } catch (err) { apiError(err, res); }
});
app.post("/api/power", requireAuth, async (req, res) => {
  const signal = req.body?.signal;
  if (!["start", "stop", "restart", "kill"].includes(signal)) {
    return res.status(400).json({ error: "Power action tidak valid." });
  }
  try {
    await ptero("/power", { method: "POST", body: JSON.stringify({ signal }) });
    res.json({ ok: true });
  } catch (err) { apiError(err, res); }
});
app.post("/api/command", requireAuth, async (req, res) => {
  const command = String(req.body?.command || "").trim();
  if (!command || command.length > 500) {
    return res.status(400).json({ error: "Command harus berisi 1–500 karakter." });
  }
  try {
    await ptero("/command", { method: "POST", body: JSON.stringify({ command }) });
    res.json({ ok: true });
  } catch (err) { apiError(err, res); }
});
app.get("/api/websocket", requireAuth, async (_req, res) => {
  try { res.json(await ptero("/websocket")); }
  catch (err) { apiError(err, res); }
});
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => console.log("PteroServerPanel listening on port " + port));
