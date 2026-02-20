import { log } from "../index";

interface PriceResult {
  price: number;
  change24h: number;
  source: string;
}

interface ValidatedPrice {
  price: number;
  change24h: number;
  sources: string[];
  median: boolean;
  fetchedAt: number;
}

let cachedPrice: ValidatedPrice | null = null;
const CACHE_TTL_MS = 5 * 60_000;

let priceFrozen = false;
let frozenAt: Date | null = null;

export function isPriceFrozen(): boolean {
  return priceFrozen;
}

export function getFreezeInfo(): { frozen: boolean; frozenAt: Date | null } {
  return { frozen: priceFrozen, frozenAt };
}

export function setPriceFrozen(frozen: boolean): void {
  priceFrozen = frozen;
  frozenAt = frozen ? new Date() : null;
  if (frozen) {
    log(`[PriceOracle] FREEZE ACTIVATED: Prediction payouts frozen until price is verified.`);
  } else {
    log(`[PriceOracle] FREEZE LIFTED: Price verified, payouts can resume.`);
  }
}

async function fetchCoinGeckoPrice(): Promise<PriceResult> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.bitcoin?.usd) throw new Error("CoinGecko: missing price data");
  return {
    price: data.bitcoin.usd,
    change24h: data.bitcoin.usd_24h_change ?? 0,
    source: "coingecko",
  };
}

async function fetchBinancePrice(): Promise<PriceResult> {
  const [tickerRes, statsRes] = await Promise.all([
    fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", {
      signal: AbortSignal.timeout(8000),
    }),
    fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT", {
      signal: AbortSignal.timeout(8000),
    }),
  ]);
  if (!tickerRes.ok) throw new Error(`Binance ticker HTTP ${tickerRes.status}`);
  const ticker = await tickerRes.json();
  const price = parseFloat(ticker.price);
  if (!price || isNaN(price)) throw new Error("Binance: invalid price");

  let change24h = 0;
  if (statsRes.ok) {
    const stats = await statsRes.json();
    change24h = parseFloat(stats.priceChangePercent) || 0;
  }

  return { price, change24h, source: "binance" };
}

async function fetchCMCPrice(): Promise<PriceResult> {
  const apiKey = process.env.CMC_API_KEY;
  if (!apiKey) throw new Error("CMC API key not configured");

  const res = await fetch(
    "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=BTC&convert=USD",
    {
      headers: { "X-CMC_PRO_API_KEY": apiKey },
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!res.ok) throw new Error(`CMC HTTP ${res.status}`);
  const data = await res.json();
  const quote = data?.data?.BTC?.quote?.USD;
  if (!quote?.price) throw new Error("CMC: missing price data");
  return {
    price: quote.price,
    change24h: quote.percent_change_24h ?? 0,
    source: "coinmarketcap",
  };
}

function calculateMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export async function getValidatedBTCPrice(): Promise<ValidatedPrice> {
  if (cachedPrice && Date.now() - cachedPrice.fetchedAt < CACHE_TTL_MS) {
    return cachedPrice;
  }

  const sources = [
    fetchCoinGeckoPrice(),
    fetchBinancePrice(),
    fetchCMCPrice(),
  ];

  const results = await Promise.allSettled(sources);
  const fulfilled: PriceResult[] = [];
  const failed: string[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      fulfilled.push(r.value);
    } else {
      failed.push(r.reason?.message || "unknown");
    }
  }

  if (failed.length > 0) {
    log(`[PriceOracle] ${failed.length} source(s) failed: ${failed.join("; ")}`);
  }

  if (fulfilled.length === 0) {
    throw new Error("All price sources unavailable");
  }

  const prices = fulfilled.map((f) => f.price);
  const medianPrice = calculateMedian(prices);
  const avgChange = fulfilled.reduce((s, f) => s + f.change24h, 0) / fulfilled.length;

  const validated: ValidatedPrice = {
    price: parseFloat(medianPrice.toFixed(2)),
    change24h: parseFloat(avgChange.toFixed(2)),
    sources: fulfilled.map((f) => f.source),
    median: fulfilled.length > 1,
    fetchedAt: Date.now(),
  };

  cachedPrice = validated;

  log(
    `[PriceOracle] BTC $${validated.price} (${validated.sources.join(", ")})${
      validated.median ? " [median]" : ""
    }`
  );

  return validated;
}

export async function getValidatedBTCPriceWithRetry(
  maxAttempts = 5,
  timeoutMs = 300_000
): Promise<ValidatedPrice> {
  const backoffDelays = [0, 1000, 5000, 30000, 60000];
  const deadline = Date.now() + timeoutMs;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (Date.now() > deadline) break;

    const delay = backoffDelays[attempt] || 60000;
    if (attempt > 0) {
      log(`[PriceOracle] Retry attempt ${attempt + 1} after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      return await getValidatedBTCPrice();
    } catch (err: any) {
      log(`[PriceOracle] Attempt ${attempt + 1}/${maxAttempts} failed: ${err.message}`);
    }
  }

  throw new Error(
    "BTC Price Settlement Delayed: all oracle sources failed after retries. Payouts frozen until price is verified."
  );
}

export function clearPriceCache(): void {
  cachedPrice = null;
}
