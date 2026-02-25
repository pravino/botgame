# Vault60 — Tap-to-Earn Power Generation Platform

## Overview
A gamified crypto-themed web application built around a "power generation" theme. Users generate **Watts (W)** by tapping/cranking a virtual generator. The platform supports Telegram authentication, tiered subscriptions, USDT wallets, and competitive leaderboards. Revenue from subscriptions is split 40% admin / 60% treasury, with the treasury funding a daily tap pot distributed proportionally to subscribers based on watts generated.

## Theme & Branding
- **Power Generation** theme throughout (not "coins")
- Users earn **Watts (W)** instead of coins
- Tapping = "cranking" a generator
- All user-facing text uses watts/power language
- Internal DB columns remain as `totalCoins`, `coinsEarned`, etc. for stability
- Gold/amber + emerald/teal color scheme on dark mode default

## Tier Structure (Power Sources)
| Internal | Display Name | Price | Status |
|----------|-------------|-------|--------|
| FREE | Crank Generator | $0 | Active (upgrades to "Solar Panels" at 1MW / 1,000,000 watts) |
| BRONZE | Diesel Generator | $5/mo | Active (only paid tier currently available) |
| SILVER | LNG Turbine | $15/mo | **Disabled** — "Coming Soon" badge, invoice creation blocked |
| GOLD | Fusion Reactor | $50/mo | **Disabled** — "Coming Soon" badge, invoice creation blocked |

## User Preferences
- Dark mode preferred as default theme
- ALLOWED_TESTERS env var restricts login to whitelisted Telegram IDs during testing
- ADMIN_TELEGRAM_IDS env var for admin access by Telegram ID (alongside ADMIN_EMAILS)
- OK with DB data loss in testing environment

## System Architecture
The application is built with a modern web stack, featuring a React + TypeScript frontend utilizing TailwindCSS, shadcn/ui, and Framer Motion for a responsive and animated user interface. The backend is an Express.js server employing session-based authentication. Data persistence is handled by PostgreSQL with Drizzle ORM, with Neon for production hosting.

**UI/UX Decisions:**
- Gold/amber primary color scheme with emerald/teal accents for the power generation theme.
- Dark mode is the default theme, with a toggle for light mode.
- The Inter font family is used throughout for consistent typography.
- Fully responsive design with a collapsing sidebar for mobile navigation.
- Framer Motion provides fluid animations for game interactions and transitions.
- Consistent card-based layout across all pages.

**Technical Implementations:**
- **Authentication**: Telegram-based authentication supporting both Mini App (WebApp initData with HMAC verification) and browser Login Widget. Connected as @Vault60Bot.
- **Power Plant (Tap-to-Earn)**: Generator cranking with an energy system (passive refill). Features a multiplier upgrade system. This is the ONLY active game — 100% of treasury goes to tap pot.
  - **Free tier**: Circular crank wheel mechanic — user drags in a circle to spin a generator wheel. Physics-based (friction=0.975, NO_ENERGY_FRICTION=0.9, STOP_THRESHOLD=0.3 deg/frame). Each full 360° rotation = 1 tap equivalent. 8-spoke SVG wheel with handle, glow scales with speed, RPM display. Uses requestAnimationFrame loop + pointer events with capture.
  - **Paid tiers**: Standard tap-on-circle mechanic (unchanged). Tap → scale animation → floating "+X W" particle.
  - Both paths use same backend contract: POST /api/tap with batched taps (max 50, flush every 2s).
  - Free users see "Crank Generator" label, upgrading to "Solar Panels" display at 1MW (1,000,000 totalCoins)
  - Paid users see tier-based generator names (Diesel/LNG/Fusion)
  - Progress bar shows free users their path to Solar upgrade
- **Price Prediction**: DISABLED — routes and UI removed, pot allocation set to 0%.
- **Lucky Wheel**: DISABLED — routes and UI removed, pot allocation set to 0%.
- **Wallet & Deposits**: USDT wallet functionality via TON and TRC-20 networks.
- **Leaderboards**: Watts-based leaderboard showcasing top players.
- **Subscription System**: Tiered plans with sandbox payment flow via TON Pay. Silver and Gold tiers blocked server-side with "This tier is not available yet" error.
- **Energy System**: Hybrid passive regeneration with "Full Tank" rolling cooldown refill, tiered for subscribers.
- **Proof of Humanity**: "Spatial Tap Challenge" triggers periodically to mitigate bot activity.
- **Referral System**: Simple $1 USDT per referral payment model.
  - Auto-generated referral codes on user creation.
  - $1 USDT credited to referrer on each subscription payment (initial + renewals).
  - No milestone bonuses — flat $1 per payment only.
- **Task Verification System**: Social tasks with Telegram membership verification and external link visit-then-claim flow.
- **League System**: Bronze → Silver → Gold → Platinum → Diamond leagues based on lifetime watts generated. Higher leagues get bigger payout multipliers.

**Revenue Split:**
- 40% admin (`admin_split`), 60% treasury (`treasury_split`)
- From treasury: $1 referral reward deducted per payment, remainder goes 100% to tap pot
- Prediction and wheel pots set to 0%

## External Dependencies
- **Email Service**: Resend (for OTP delivery)
- **Real-time Data**: CoinGecko API (for live BTC prices), supplemented by Binance and CoinMarketCap
- **Database**: PostgreSQL (hosted on Neon for production)
- **Payment Gateway**: TON Pay SDK (sandbox and mainnet modes)
- **QR Code Generation**: `qrcode.react`
- **Telegram Bot**: Vault60Bot via `TELEGRAM_BOT_TOKEN` secret

## Key Files
- `shared/schema.ts` — DB schema (internal field names: totalCoins, coinsEarned, tapMultiplier, etc.)
- `server/routes.ts` — All API routes including tier gating for Silver/Gold
- `server/cron/settlementCron.ts` — Daily midnight settlement, withdrawal batching, retention checks
- `server/services/referralTracker.ts` — Flat $1/payment referral tracking
- `server/middleware/transactionSplit.ts` — 40/60 revenue split logic
- `client/src/pages/tap-to-earn.tsx` — Power Plant (main game page)
- `client/src/pages/subscription.tsx` — Power Plans (tier selection)
- `client/src/pages/dashboard.tsx` — Dashboard with watts stats
- `client/src/components/app-sidebar.tsx` — Navigation sidebar
