import { storage } from "../storage";
import { log } from "../index";

const TELEGRAM_API = "https://api.telegram.org/bot";

function getToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN;
}

async function callApi(method: string, params: Record<string, any>): Promise<any> {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch(`${TELEGRAM_API}${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!data.ok) {
      log(`[Telegram] API error (${method}): ${data.description || "Unknown error"}`);
    }
    return data;
  } catch (e: any) {
    log(`[Telegram] Request failed (${method}): ${e.message}`);
    return null;
  }
}

async function getChatId(key: string): Promise<string | undefined> {
  const config = await storage.getGlobalConfigRow(key);
  if (!config) return undefined;
  if (config.description && key.startsWith("telegram_")) {
    return config.description;
  }
  const val = config.value;
  return val && val !== "0.0000" ? String(val) : undefined;
}

export async function sendToNewsChannel(text: string, parseMode: string = "HTML"): Promise<boolean> {
  const chatId = await getChatId("telegram_news_channel_id");
  if (!chatId) {
    log("[Telegram] News channel ID not configured — skipping");
    return false;
  }
  const result = await callApi("sendMessage", { chat_id: chatId, text, parse_mode: parseMode });
  return result?.ok === true;
}

export async function sendToLobby(text: string, parseMode: string = "HTML"): Promise<boolean> {
  const chatId = await getChatId("telegram_lobby_group_id");
  if (!chatId) {
    log("[Telegram] Lobby group ID not configured — skipping");
    return false;
  }
  const result = await callApi("sendMessage", { chat_id: chatId, text, parse_mode: parseMode });
  return result?.ok === true;
}

export async function sendToApex(text: string, parseMode: string = "HTML"): Promise<boolean> {
  const chatId = await getChatId("telegram_apex_group_id");
  if (!chatId) {
    log("[Telegram] Apex group ID not configured — skipping");
    return false;
  }
  const result = await callApi("sendMessage", { chat_id: chatId, text, parse_mode: parseMode });
  return result?.ok === true;
}

export async function sendDirectMessage(telegramUserId: string, text: string, parseMode: string = "HTML"): Promise<boolean> {
  const result = await callApi("sendMessage", { chat_id: telegramUserId, text, parse_mode: parseMode });
  return result?.ok === true;
}

export async function kickFromApex(telegramUserId: string): Promise<boolean> {
  const chatId = await getChatId("telegram_apex_group_id");
  if (!chatId) return false;

  const result = await callApi("banChatMember", {
    chat_id: chatId,
    user_id: parseInt(telegramUserId),
  });

  if (result?.ok) {
    await callApi("unbanChatMember", {
      chat_id: chatId,
      user_id: parseInt(telegramUserId),
      only_if_banned: true,
    });
  }

  return result?.ok === true;
}

export async function generateApexInviteLink(): Promise<string | null> {
  const chatId = await getChatId("telegram_apex_group_id");
  if (!chatId) return null;

  const result = await callApi("createChatInviteLink", {
    chat_id: chatId,
    member_limit: 1,
    name: `Vault60 Apex Access - ${new Date().toISOString().slice(0, 10)}`,
  });

  return result?.result?.invite_link || null;
}

export async function announcePredictionResults(tierName: string, winnersCount: number, totalPot: number, topWinners: Array<{ username: string; payout: number }>): Promise<void> {
  let msg = `<b>PREDICTION RESULTS</b>\n\n`;
  msg += `<b>${tierName} Tier</b>\n`;

  if (winnersCount > 0) {
    msg += `${winnersCount} winner${winnersCount > 1 ? "s" : ""} split the <b>$${totalPot.toFixed(2)} USDT</b> pot!\n\n`;
    if (topWinners.length > 0) {
      msg += `Top Winners:\n`;
      topWinners.forEach((w, i) => {
        msg += `${i + 1}. ${escapeHtml(w.username)} — <b>$${w.payout.toFixed(2)}</b>\n`;
      });
    }
  } else {
    msg += `No correct predictions today!\n`;
    msg += `The pot rolls over — now <b>$${totalPot.toFixed(2)} USDT</b>\n`;
  }

  msg += `\nPredict tomorrow's BTC price to win!`;

  await sendToNewsChannel(msg);
}

export async function announceMegaPot(tierName: string, totalPot: number): Promise<void> {
  const msg = `<b>MEGA POT ALERT!</b>\n\n` +
    `The <b>${tierName}</b> prediction pot has rolled over!\n\n` +
    `Accumulated Pot: <b>$${totalPot.toFixed(2)} USDT</b>\n\n` +
    `No one predicted correctly today — the entire pot carries forward. Tomorrow's winner takes it ALL.\n\n` +
    `Upgrade your tier now to compete for the biggest pots!`;

  await sendToNewsChannel(msg);
}

export async function announceWheelWinner(username: string, amount: number, tierName: string): Promise<void> {
  if (amount < 10) return;

  const msg = `<b>LUCKY WHEEL WINNER!</b>\n\n` +
    `${escapeHtml(username)} just won <b>$${amount.toFixed(2)} USDT</b> on the Lucky Wheel!\n\n` +
    `Tier: ${tierName}\n\n` +
    `Spin the wheel for your chance to win big!`;

  await sendToNewsChannel(msg);
}

export async function announceLeaderboard(category: string, leaders: Array<{ username: string; value: number }>, unit?: string): Promise<void> {
  let msg = `<b>LEADERBOARD — ${category.toUpperCase()}</b>\n\n`;

  const formatValue = (v: number) => {
    if (unit === "USDT") return `$${v.toFixed(2)}`;
    if (unit === "count") return `${v} correct`;
    return v.toLocaleString();
  };

  leaders.slice(0, 5).forEach((l, i) => {
    const medal = i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}th`;
    msg += `${medal}: <b>${escapeHtml(l.username)}</b> — ${formatValue(l.value)}\n`;
  });

  msg += `\nWill you make the top 5?`;

  await sendToNewsChannel(msg);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function announceNewSubscriber(username: string, tierName: string): Promise<void> {
  const msg = `Welcome <b>${escapeHtml(username)}</b> to the ${tierName} tier! Let's earn together.`;
  await sendToApex(msg);
}

export async function detectChatIds(): Promise<{
  detected: Array<{ title: string; chatId: string; type: string }>;
}> {
  const token = getToken();
  if (!token) return { detected: [] };

  const result = await callApi("getUpdates", { limit: 100 });
  if (!result?.ok) return { detected: [] };

  const chats = new Map<string, { title: string; chatId: string; type: string }>();

  for (const update of result.result || []) {
    const msg = update.message || update.channel_post || update.my_chat_member?.chat;
    if (msg?.chat) {
      const chat = msg.chat;
      if (chat.type !== "private") {
        chats.set(String(chat.id), {
          title: chat.title || "Unknown",
          chatId: String(chat.id),
          type: chat.type,
        });
      }
    }
    if (update.my_chat_member?.chat) {
      const chat = update.my_chat_member.chat;
      if (chat.type !== "private") {
        chats.set(String(chat.id), {
          title: chat.title || "Unknown",
          chatId: String(chat.id),
          type: chat.type,
        });
      }
    }
  }

  return { detected: Array.from(chats.values()) };
}

export async function getBotInfo(): Promise<any> {
  const result = await callApi("getMe", {});
  return result?.result || null;
}

export async function initTelegramBot(): Promise<void> {
  const token = getToken();
  if (!token) {
    log("[Telegram] Bot token not configured — Telegram features disabled");
    return;
  }

  const botInfo = await getBotInfo();
  if (botInfo) {
    log(`[Telegram] Bot connected: @${botInfo.username} (${botInfo.first_name})`);
  } else {
    log("[Telegram] Failed to connect bot — check token");
    return;
  }

  const config = await storage.getGlobalConfig();
  const hasAllIds = config.telegram_news_channel_id && config.telegram_lobby_group_id && config.telegram_apex_group_id;

  if (!hasAllIds) {
    log("[Telegram] Some chat IDs not configured — run /api/admin/telegram/detect-chats to auto-detect");
    const { detected } = await detectChatIds();
    if (detected.length > 0) {
      log(`[Telegram] Detected ${detected.length} chat(s):`);
      detected.forEach(c => log(`  - "${c.title}" (${c.chatId}, type: ${c.type})`));
    }
  } else {
    log("[Telegram] All chat IDs configured — bot ready");
  }
}
