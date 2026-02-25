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

export async function checkTelegramMembership(telegramUserId: string, chatConfigKey: string): Promise<{ isMember: boolean; status: string }> {
  const chatId = await getChatId(chatConfigKey);
  if (!chatId) {
    log(`[Telegram] Chat ID not configured for ${chatConfigKey} — skipping membership check`);
    return { isMember: false, status: "chat_not_configured" };
  }

  const result = await callApi("getChatMember", {
    chat_id: chatId,
    user_id: parseInt(telegramUserId),
  });

  if (!result?.ok) {
    return { isMember: false, status: "not_found" };
  }

  const memberStatus = result.result?.status;
  const isMember = ["member", "administrator", "creator"].includes(memberStatus);
  return { isMember, status: memberStatus || "unknown" };
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
    name: `Volt60 Apex Access - ${new Date().toISOString().slice(0, 10)}`,
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

export async function announceWheelWinner(username: string, amount: number, tierName: string, jackpotSize?: number): Promise<void> {
  if (amount < 5) return;

  const isJackpot = amount >= 100;
  const isBigWin = amount >= 10;

  let msg: string;
  if (isJackpot) {
    msg = `<b>JACKPOT HIT!</b>\n\n` +
      `${escapeHtml(username)} just cracked the vault for <b>$${amount.toFixed(2)} USDT</b> on the Lucky Wheel!\n\n` +
      `Tier: ${tierName}\n\n` +
      `The vault is being reloaded. WHO IS NEXT?`;
  } else {
    msg = `<b>WE HAVE A WINNER!</b>\n\n` +
      `Congrats to ${escapeHtml(username)} who just hit a <b>$${amount.toFixed(2)} USDT</b> ${isBigWin ? "Big Win" : "win"} on the Lucky Wheel!\n\n` +
      `Tier: ${tierName}\n\n` +
      `How to play:\n` +
      `1. Refer 5 friends to unlock the Wheel\n` +
      `2. Use your weekly Gold/Silver spins\n\n` +
      (jackpotSize ? `Your <b>$${jackpotSize} USDT Jackpot</b> is waiting in the vault. WHO IS NEXT?` : `Spin the wheel for your chance to win big!`);
  }

  await Promise.all([
    sendToNewsChannel(msg),
    sendToLobby(msg),
  ]);
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

export async function announceMorningAlpha(btcPrice: number, change24h: number, miniAppUrl: string): Promise<void> {
  const direction = change24h >= 0 ? "UP" : "DOWN";
  const changeStr = `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`;
  const sentiment = change24h >= 0 ? "Bulls are charging" : "Bears are prowling";

  const msg = `<b>MORNING ALPHA — BTC MARKET UPDATE</b>\n\n` +
    `Bitcoin is currently trading at <b>$${btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b>\n` +
    `24h Change: <b>${changeStr}</b> ${direction}\n\n` +
    `${sentiment}. The Oracle locks at <b>12:00 UTC</b> — place your "Higher" or "Lower" prediction before then.\n\n` +
    `30% of the daily treasury goes to correct predictors. Don't miss your shot.\n\n` +
    `<a href="${miniAppUrl}">Place My Prediction</a>`;

  await Promise.all([
    sendToNewsChannel(msg),
    sendToLobby(msg),
  ]);
}

export async function announceOracleWarning(predictionPotData: { tierName: string; potSize: number }[], higherPct: number, lowerPct: number, totalVotes: number, miniAppUrl: string): Promise<void> {
  let potLines = "";
  for (const p of predictionPotData) {
    if (p.potSize > 0) {
      potLines += `  ${p.tierName}: <b>$${p.potSize.toFixed(2)} USDT</b>\n`;
    }
  }
  if (!potLines) potLines = "  Pots are building!\n";

  const sentimentLine = totalVotes > 0
    ? `Market Sentiment: <b>${higherPct}%</b> think Bitcoin is going HIGHER, <b>${lowerPct}%</b> say LOWER. Do you know something they don't?`
    : `No predictions yet — be the first to claim the pot!`;

  const msg = `<b>THE ORACLE IS CLOSING IN 2 HOURS!</b>\n\n` +
    `The BTC Prediction Pots:\n${potLines}\n` +
    `At 12:00 UTC, the price is LOCKED. If you haven't placed your "Higher" or "Lower" vote, you are forfeiting your share of the 30% Skill Pool.\n\n` +
    `${sentimentLine}\n\n` +
    `Lock in your prediction before the Oracle shuts down!\n\n` +
    `<a href="${miniAppUrl}">Place My Prediction</a>`;

  await Promise.all([
    sendToNewsChannel(msg),
    sendToLobby(msg),
  ]);
}

export async function announceTierGap(tierMultipliers: { tierName: string; maxMultiplier: number }[], miniAppUrl: string): Promise<void> {
  let multiplierLines = "";
  for (const t of tierMultipliers) {
    if (t.tierName === "FREE") continue;
    const label = t.tierName === "BRONZE" ? "Bronze" : t.tierName === "SILVER" ? "Silver" : "Gold";
    multiplierLines += `  ${label} Members: mining at up to <b>${t.maxMultiplier}x Power</b>\n`;
  }

  const msg = `<b>FEELING THE CEILING? TIME TO UPGRADE!</b>\n\n` +
    `You've maxed out your multiplier. You're a legend, but you're leaving money on the table.\n\n` +
    `${multiplierLines}\n` +
    `While you earn pennies per tap, the Gold Whales are swallowing the daily pot. Don't be a fish. Be a Whale.\n\n` +
    `Unlock higher multipliers NOW:\n\n` +
    `<a href="${miniAppUrl}">Upgrade My Tier</a>`;

  await Promise.all([
    sendToNewsChannel(msg),
    sendToLobby(msg),
  ]);
}

export async function announceFomoCountdown(potData: { tierName: string; potSize: number }[], miniAppUrl: string): Promise<void> {
  let potLines = "";
  for (const p of potData) {
    if (p.potSize > 0) {
      potLines += `  ${p.tierName}: <b>$${p.potSize.toFixed(2)} USDT</b>\n`;
    }
  }
  if (!potLines) potLines = "  Building up for tomorrow!\n";

  const msg = `<b>4 HOURS UNTIL THE VAULT LOCKS!</b>\n\n` +
    `Today's Tap Pots:\n${potLines}\n` +
    `...and they're waiting for the winners!\n\n` +
    `Check your Energy: Don't let your full tank sit idle.\n` +
    `Pro Tip: Use your Daily Full Tank refill NOW to climb the leaderboard before the 00:00 UTC settlement.\n\n` +
    `Every tap you miss is USDT left for someone else. GET TAPPING!\n\n` +
    `<a href="${miniAppUrl}">Open Volt60</a>`;

  await Promise.all([
    sendToNewsChannel(msg),
    sendToLobby(msg),
  ]);
}

export async function announceMathWarrior(inactivePct: number, topEarnerEstimate: number, miniAppUrl: string): Promise<void> {
  const msg = `<b>THE "LAZY TAX" IS ACCUMULATING!</b>\n\n` +
    `Our sensors show <b>${inactivePct}%</b> of paid members haven't tapped today. ` +
    `You know what that means? THEIR SHARE GOES TO YOU.\n\n` +
    `The USDT per Coin value is spiking right now. If you finish your energy bars in the next 2 hours, you're stealing the "Ghost" rewards.\n\n` +
    `Current Top earners are on track for <b>$${topEarnerEstimate.toFixed(4)} USDT</b> today. ` +
    `Are you going to let them take it all?\n\n` +
    `Empty your tanks now!\n\n` +
    `<a href="${miniAppUrl}">Launch Volt60</a>`;

  await Promise.all([
    sendToNewsChannel(msg),
    sendToLobby(msg),
  ]);
}

export async function announceLastCall(miniAppUrl: string): Promise<void> {
  const msg = `<b>30 MINUTE WARNING: RESET IMMINENT!</b>\n\n` +
    `In 30 minutes, the Midnight Settlement runs.\n\n` +
    `All taps today will be converted to REAL USDT in your balance.\n` +
    `Any unused energy will be WASTED.\n\n` +
    `This is your last chance to squeeze every cent out of the Volt60 60% Prize Pool.\n\n` +
    `TAP. TAP. TAP.\n\n` +
    `<a href="${miniAppUrl}">Final Sprint to Midnight</a>`;

  await Promise.all([
    sendToNewsChannel(msg),
    sendToLobby(msg),
    sendToApex(msg),
  ]);
}

export async function announceSettlementResults(topEarners: Array<{ username: string; payout: number }>, totalDistributed: number): Promise<void> {
  if (topEarners.length === 0) return;

  let msg = `<b>SETTLEMENT COMPLETE</b>\n\n`;
  msg += `While you slept, the top tappers earned REAL USDT:\n\n`;

  const medals = ["1st", "2nd", "3rd"];
  topEarners.slice(0, 3).forEach((e, i) => {
    msg += `${medals[i]}: <b>${escapeHtml(e.username)}</b> — $${e.payout.toFixed(4)} USDT\n`;
  });

  msg += `\nTotal distributed: <b>$${totalDistributed.toFixed(4)} USDT</b>\n\n`;
  msg += `Don't miss tomorrow's pot — start tapping NOW!`;

  await Promise.all([
    sendToNewsChannel(msg),
    sendToLobby(msg),
  ]);
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

  const newsRow = await storage.getGlobalConfigRow("telegram_news_channel_id");
  const lobbyRow = await storage.getGlobalConfigRow("telegram_lobby_group_id");
  const apexRow = await storage.getGlobalConfigRow("telegram_apex_group_id");

  const hasNews = newsRow?.description && newsRow.description !== "0";
  const hasLobby = lobbyRow?.description && lobbyRow.description !== "0";
  const hasApex = apexRow?.description && apexRow.description !== "0";

  if (!hasNews || !hasLobby || !hasApex) {
    log("[Telegram] Some chat IDs not configured — attempting auto-detect");
    const { detected } = await detectChatIds();
    if (detected.length > 0) {
      log(`[Telegram] Detected ${detected.length} chat(s):`);
      detected.forEach(c => log(`  - "${c.title}" (${c.chatId}, type: ${c.type})`));

      let savedNews = hasNews;
      let savedLobby = hasLobby;
      let savedApex = hasApex;

      for (const chat of detected) {
        const titleLower = chat.title.toLowerCase();
        let configKey: string | null = null;

        if ((chat.type === "channel" || titleLower.includes("news")) && !savedNews) {
          configKey = "telegram_news_channel_id";
          savedNews = true;
        } else if (titleLower.includes("lobby") && !savedLobby) {
          configKey = "telegram_lobby_group_id";
          savedLobby = true;
        } else if (titleLower.includes("apex") && !savedApex) {
          configKey = "telegram_apex_group_id";
          savedApex = true;
        }

        if (configKey) {
          await storage.setGlobalConfigValue(configKey, 0, chat.chatId);
          log(`[Telegram] Auto-saved ${configKey} = ${chat.chatId} ("${chat.title}")`);
        }
      }

      if (!savedNews || !savedLobby || !savedApex) {
        const missing = [!savedNews && "news", !savedLobby && "lobby", !savedApex && "apex"].filter(Boolean);
        log(`[Telegram] Could not auto-detect: ${missing.join(", ")}. Use /api/admin/telegram/set-chat to assign manually.`);
      }
    }
  } else {
    log("[Telegram] All chat IDs configured — bot ready");
  }
}
