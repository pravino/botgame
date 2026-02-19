import crypto from "crypto";
import { storage } from "../storage";
import { log } from "../index";

const TON_PAY_MODE = process.env.TON_PAY_MODE || "testnet";
const TON_PAY_SECRET = process.env.TON_PAY_SECRET || "sandbox_default_secret_key_change_me";
const TON_ADMIN_PROFIT_WALLET = process.env.TON_ADMIN_PROFIT_WALLET || process.env.ADMIN_PROFITS_WALLET || "UQAdminTestnetWallet";
const TON_GAME_TREASURY_WALLET = process.env.TON_GAME_TREASURY_WALLET || process.env.GAME_TREASURY_WALLET || "UQTreasuryTestnetWallet";

const DEFAULT_ADMIN_SPLIT = 40;
const DEFAULT_TREASURY_SPLIT = 60;

async function getAdminTreasurySplitPercent(): Promise<{ adminSplit: number; treasurySplit: number }> {
  try {
    const config = await storage.getGlobalConfig();
    return {
      adminSplit: config.admin_split ? Math.round(config.admin_split * 100) : DEFAULT_ADMIN_SPLIT,
      treasurySplit: config.treasury_split ? Math.round(config.treasury_split * 100) : DEFAULT_TREASURY_SPLIT,
    };
  } catch {
    return { adminSplit: DEFAULT_ADMIN_SPLIT, treasurySplit: DEFAULT_TREASURY_SPLIT };
  }
}

const FALLBACK_TIER_PRICES: Record<string, number> = { BRONZE: 5.00, SILVER: 15.00, GOLD: 50.00 };

async function getTierPrice(tierName: string): Promise<number | undefined> {
  try {
    const allTiers = await storage.getAllTiers();
    const tier = allTiers.find(t => t.name === tierName.toUpperCase());
    return tier ? parseFloat(String(tier.price)) : FALLBACK_TIER_PRICES[tierName.toUpperCase()];
  } catch {
    return FALLBACK_TIER_PRICES[tierName.toUpperCase()];
  }
}

async function getAllTierPrices(): Promise<Record<string, number>> {
  try {
    const allTiers = await storage.getAllTiers();
    const prices: Record<string, number> = {};
    for (const t of allTiers) {
      if (t.name !== "FREE") {
        prices[t.name] = parseFloat(String(t.price));
      }
    }
    return prices;
  } catch {
    return { BRONZE: 5.00, SILVER: 15.00, GOLD: 50.00 };
  }
}

const INVOICE_EXPIRY_MINUTES = 30;

export interface InvoiceResult {
  invoiceId: string;
  payUrl: string;
  amount: number;
  currency: string;
  tierName: string;
  network: string;
  sandbox: boolean;
  splits: { address: string; percentage: number }[];
  expiresAt: string;
}

export interface WebhookPayload {
  event: string;
  data: {
    invoiceId: string;
    amount: number;
    currency: string;
    txHash: string;
    metadata: {
      userId: string;
      tierName: string;
    };
    paidAt: string;
  };
}

function isSandbox(): boolean {
  return TON_PAY_MODE === "testnet" || TON_PAY_MODE === "sandbox";
}

function generateInvoiceId(): string {
  const prefix = isSandbox() ? "inv_test_" : "inv_live_";
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

function buildPaymentLink(invoiceId: string): string {
  if (isSandbox()) {
    return `https://sandbox.tonpay.dev/pay/${invoiceId}`;
  }
  return `https://pay.tonpay.io/pay/${invoiceId}`;
}

export function generateSignature(payload: string): string {
  return crypto
    .createHmac("sha256", TON_PAY_SECRET)
    .update(payload)
    .digest("hex");
}

export function verifySignature(signature: string, rawBody: string | Buffer): boolean {
  try {
    const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
    const expected = generateSignature(payload);
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export function requireSecretConfigured(): void {
  if (!isSandbox() && (!process.env.TON_PAY_SECRET || process.env.TON_PAY_SECRET === "sandbox_default_secret_key_change_me")) {
    throw new Error("TON_PAY_SECRET must be configured for mainnet mode");
  }
}

export async function createInvoice(
  userId: string,
  tierName: string
): Promise<InvoiceResult> {
  const normalizedTier = tierName.toUpperCase();
  const amount = await getTierPrice(normalizedTier);
  if (!amount) {
    throw new Error(`Invalid tier: ${tierName}. Must be BRONZE, SILVER, or GOLD.`);
  }

  const invoiceId = generateInvoiceId();
  const payUrl = buildPaymentLink(invoiceId);
  const sandbox = isSandbox();
  const expiresAt = new Date(Date.now() + INVOICE_EXPIRY_MINUTES * 60 * 1000);

  const { adminSplit, treasurySplit } = await getAdminTreasurySplitPercent();
  const splits = [
    { address: TON_ADMIN_PROFIT_WALLET, percentage: adminSplit },
    { address: TON_GAME_TREASURY_WALLET, percentage: treasurySplit },
  ];

  await storage.createPaymentInvoice({
    invoiceId,
    userId,
    tierName: normalizedTier,
    amount: amount.toFixed(2),
    currency: "USDT",
    paymentLink: payUrl,
    network: "TON",
    sandbox,
    splits: JSON.stringify(splits),
    metadata: JSON.stringify({ userId, tierName: normalizedTier }),
    expiresAt,
  });

  log(`[TON Pay ${sandbox ? "SANDBOX" : "LIVE"}] Invoice ${invoiceId} created: ${normalizedTier} tier ($${amount}) for user ${userId}`);
  log(`[TON Pay] Splits: Admin ${adminSplit}% -> ${TON_ADMIN_PROFIT_WALLET}, Treasury ${treasurySplit}% -> ${TON_GAME_TREASURY_WALLET}`);

  return {
    invoiceId,
    payUrl,
    amount,
    currency: "USDT",
    tierName: normalizedTier,
    network: "TON",
    sandbox,
    splits,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function processWebhookPayment(
  invoiceId: string,
  txHash: string
): Promise<{ success: boolean; message: string; invoiceId: string }> {
  const invoice = await storage.getPaymentInvoiceByInvoiceId(invoiceId);
  if (!invoice) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }

  if (invoice.status === "paid") {
    return { success: true, message: "Invoice already processed (idempotent)", invoiceId };
  }

  if (invoice.status !== "pending") {
    throw new Error(`Invoice ${invoiceId} has invalid status for payment: ${invoice.status}`);
  }

  const now = new Date();
  if (now > new Date(invoice.expiresAt)) {
    await storage.updatePaymentInvoiceStatus(invoiceId, "expired");
    throw new Error(`Invoice ${invoiceId} has expired`);
  }

  const existingTx = await storage.getTransactionByTxHash(txHash);
  if (existingTx) {
    throw new Error(`Transaction hash ${txHash} has already been used`);
  }

  const { processSubscriptionPayment } = await import("../middleware/transactionSplit");

  const amount = parseFloat(invoice.amount);

  try {
    const result = await processSubscriptionPayment(
      invoice.userId,
      txHash,
      invoice.tierName,
      amount
    );

    await storage.updatePaymentInvoiceStatus(invoiceId, "paid", txHash);

    log(`[TON Pay] Invoice ${invoiceId} PAID: ${invoice.tierName} tier activated for user ${invoice.userId} (tx: ${txHash})`);

    return {
      success: result.success,
      message: result.message,
      invoiceId,
    };
  } catch (error: any) {
    await storage.updatePaymentInvoiceStatus(invoiceId, "failed");
    log(`[TON Pay] Invoice ${invoiceId} FAILED: ${error.message}`);
    throw error;
  }
}

export async function sandboxConfirmInvoice(
  invoiceId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  if (!isSandbox()) {
    throw new Error("Sandbox confirmation is only available in testnet mode");
  }

  const invoice = await storage.getPaymentInvoiceByInvoiceId(invoiceId);
  if (!invoice) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }

  if (invoice.userId !== userId) {
    throw new Error("Invoice does not belong to this user");
  }

  const sandboxTxHash = `sandbox_tx_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;

  const result = await processWebhookPayment(invoiceId, sandboxTxHash);

  log(`[TON Pay SANDBOX] Invoice ${invoiceId} confirmed by user ${userId} with sandbox tx: ${sandboxTxHash}`);

  return result;
}

export async function getPaymentConfig() {
  const { adminSplit, treasurySplit } = await getAdminTreasurySplitPercent();
  const tiers = await getAllTierPrices();
  return {
    mode: TON_PAY_MODE,
    sandbox: isSandbox(),
    adminWallet: TON_ADMIN_PROFIT_WALLET,
    treasuryWallet: TON_GAME_TREASURY_WALLET,
    adminSplit,
    treasurySplit,
    invoiceExpiryMinutes: INVOICE_EXPIRY_MINUTES,
    tiers,
  };
}
