require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const http = require("http");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const BACKEND_HOST = process.env.BACKEND_HOST || "127.0.0.1";
const BACKEND_PORT = Number(process.env.BACKEND_PORT || process.env.PORT || 3000);
const AUTHORIZED_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:3000";

if (!BOT_TOKEN) {
  console.log("Bot token not configured.");
  module.exports = null;
} else {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  function isAuthorized(msg) {
    if (!AUTHORIZED_CHAT_ID) return true;
    return String(msg.chat.id) === AUTHORIZED_CHAT_ID;
  }

  function denyIfUnauthorized(msg) {
    if (isAuthorized(msg)) return false;
    bot.sendMessage(msg.chat.id, "This bot is not authorized for this chat.");
    return true;
  }

  function sendToServer(payload) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(payload);
      const req = http.request(
        {
          hostname: BACKEND_HOST,
          port: BACKEND_PORT,
          path: "/api/demo-event",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData)
          }
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            try {
              resolve(body ? JSON.parse(body) : {});
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      req.on("error", reject);
      req.write(postData);
      req.end();
    });
  }

  bot.onText(/\/start/, (msg) => {
    if (denyIfUnauthorized(msg)) return;

    bot.sendMessage(
      msg.chat.id,
      [
        "Use these commands:",
        "/link <sessionId>",
        "/view <sessionId>",
        "/name <sessionId> <full name>",
        "/username <sessionId> <handle>",
        "/amount <sessionId> <value>",
        "/sign <sessionId> <symbol>",
        "/currency <sessionId> <code>",
        "/loading <sessionId>",
        "/approve <sessionId>",
        "/reject <sessionId>",
        "/reset <sessionId>",
        "/message <sessionId> <text>",
        "/avatar <sessionId> <url>",
        "Send a photo with caption /avatar <sessionId>"
      ].join("\n")
    );
  });

  bot.onText(/\/link\s+([A-Za-z0-9_-]+)/, (msg, match) => {
    if (denyIfUnauthorized(msg)) return;
    const sessionId = match[1];
    bot.sendMessage(msg.chat.id, `${PUBLIC_BASE_URL}/?sessionId=${encodeURIComponent(sessionId)}`);
  });

  bot.onText(/\/view\s+([A-Za-z0-9_-]+)/, async (msg, match) => {
    if (denyIfUnauthorized(msg)) return;
    const sessionId = match[1];

    try {
      const response = await fetch(`${PUBLIC_BASE_URL}/api/session?sessionId=${encodeURIComponent(sessionId)}`);
      const data = await response.json();
      bot.sendMessage(msg.chat.id, JSON.stringify(data, null, 2));
    } catch (error) {
      bot.sendMessage(msg.chat.id, `Could not load session ${sessionId}: ${error.message}`);
    }
  });

  async function handleUpdate(msg, sessionId, patch, successText) {
    if (denyIfUnauthorized(msg)) return;

    try {
      await sendToServer({ sessionId, ...patch });
      bot.sendMessage(msg.chat.id, successText);
    } catch (error) {
      bot.sendMessage(msg.chat.id, `Update failed: ${error.message}`);
    }
  }

  bot.onText(/\/name\s+([A-Za-z0-9_-]+)\s+([\s\S]+)/, (msg, match) => {
    handleUpdate(msg, match[1], { name: match[2].trim() }, `Name updated for ${match[1]}.`);
  });

  bot.onText(/\/username\s+([A-Za-z0-9_-]+)\s+(@?[\w.]+)/, (msg, match) => {
    handleUpdate(msg, match[1], { username: match[2].trim() }, `Username updated for ${match[1]}.`);
  });

  bot.onText(/\/amount\s+([A-Za-z0-9_-]+)\s+([0-9.,]+)/, (msg, match) => {
    handleUpdate(msg, match[1], { amount: match[2].trim() }, `Amount updated for ${match[1]}.`);
  });

  bot.onText(/\/sign\s+([A-Za-z0-9_-]+)\s+(\S+)/, (msg, match) => {
    handleUpdate(msg, match[1], { amountSign: match[2].trim() }, `Amount sign updated for ${match[1]}.`);
  });

  bot.onText(/\/currency\s+([A-Za-z0-9_-]+)\s+([A-Za-z]+)/, (msg, match) => {
    handleUpdate(msg, match[1], { currency: match[2].trim() }, `Currency updated for ${match[1]}.`);
  });

  bot.onText(/\/loading\s+([A-Za-z0-9_-]+)/, (msg, match) => {
    handleUpdate(msg, match[1], { reviewStatus: "loading" }, `Session ${match[1]} set to loading.`);
  });

  bot.onText(/\/approve\s+([A-Za-z0-9_-]+)/, (msg, match) => {
    handleUpdate(msg, match[1], { reviewStatus: "approved" }, `Session ${match[1]} approved.`);
  });

  bot.onText(/\/reject\s+([A-Za-z0-9_-]+)/, (msg, match) => {
    handleUpdate(msg, match[1], { reviewStatus: "rejected" }, `Session ${match[1]} rejected.`);
  });

  bot.onText(/\/reset\s+([A-Za-z0-9_-]+)/, (msg, match) => {
    handleUpdate(msg, match[1], { reviewStatus: "idle" }, `Session ${match[1]} reset.`);
  });

  bot.onText(/\/message\s+([A-Za-z0-9_-]+)\s+([\s\S]+)/, (msg, match) => {
    handleUpdate(msg, match[1], { referralMessage: match[2].trim() }, `Message updated for ${match[1]}.`);
  });

  bot.onText(/\/avatar\s+([A-Za-z0-9_-]+)\s+(https?:\/\/\S+)/, (msg, match) => {
    handleUpdate(msg, match[1], { avatarUrl: match[2].trim() }, `Avatar updated for ${match[1]}.`);
  });

  bot.on("photo", async (msg) => {
    if (denyIfUnauthorized(msg)) return;

    const caption = String(msg.caption || "").trim();
    const match = caption.match(/^\/avatar\s+([A-Za-z0-9_-]+)$/);
    if (!match || !Array.isArray(msg.photo) || !msg.photo.length) return;

    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const avatarUrl = `${PUBLIC_BASE_URL}/api/telegram-file/${encodeURIComponent(fileId)}`;
    await handleUpdate(msg, match[1], { avatarUrl }, `Avatar updated for ${match[1]}.`);
  });

  bot.on("document", async (msg) => {
    if (denyIfUnauthorized(msg)) return;

    const caption = String(msg.caption || "").trim();
    const match = caption.match(/^\/avatar\s+([A-Za-z0-9_-]+)$/);
    if (!match || !msg.document?.file_id || !String(msg.document?.mime_type || "").startsWith("image/")) return;

    const avatarUrl = `${PUBLIC_BASE_URL}/api/telegram-file/${encodeURIComponent(msg.document.file_id)}`;
    await handleUpdate(msg, match[1], { avatarUrl }, `Avatar updated for ${match[1]}.`);
  });

  console.log("Bot ready");
  module.exports = bot;
}
