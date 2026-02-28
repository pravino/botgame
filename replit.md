# Volt60 Grid Tycoon — Tap-to-Earn Power Generation Platform

## Overview
A gamified crypto-themed web application built around a "power generation" theme. Users generate **Watts (W)** by tapping a virtual energy orb. The platform supports Telegram authentication, tiered subscriptions, USDT wallets, and competitive leaderboards. Revenue from subscriptions is split 40% admin / 60% treasury, with the treasury funding a daily tap pot distributed proportionally to subscribers based on watts generated.

## Theme & Branding
- **Power Generation** theme throughout (not "coins")
- Users earn **Watts (W)** instead of coins
- Tapping = generating power via an energy orb
- All user-facing text uses watts/power language
- Internal DB columns remain as `totalCoins`, `coinsEarned`, etc. for stability
- Gold/amber + emerald/teal color scheme on dark mode default
- Sci-fi gaming aesthetic with glowing orbs and dark backgrounds

## Tier Structure (Power Sources)
| Internal | Display Name | Price | Status |
|----------|-------------|-------|--------|
| FREE | Hand-Crank Dynamo | $0 | Active (upgrades to "Solar Array" at 1MW / 1,000,000 watts) |
| BRONZE | Diesel V8 | $5/mo | Active (only paid tier currently available) |
| SILVER | LNG Turbine | $15/mo | **Disabled** — "Coming Soon" badge, invoice creation blocked |
| GOLD | Fusion Reactor | $50/mo | **Disabled** — "Coming Soon" badge, invoice creation blocked |

## User Preferences
- Dark mode preferred as default theme
- ALLOWED_TESTERS env var restricts login to whitelisted Telegram IDs during testing
- ADMIN_TELEGRAM_IDS env var for admin access by Telegram ID (alongside ADMIN_EMAILS)
- OK with DB data loss in testing environment

## System Architecture
The application is built with a modern web stack, featuring a React + TypeScript frontend utilizing TailwindCSS, shadcn/ui, and Framer Motion for a responsive and animated user interface. The backend is an Express.js server employing session-based authentication. Data persistence is handled by PostgreSQL with Drizzle ORM, with Neon for production hosting.

**UI/UX Design (v2 — Mobile-First Redesign):**
- **Navigation**: Bottom tab bar with 4 tabs (Grid, Dashboard, Tiers, Portal) replacing the sidebar
- **Top Header**: VOLT60 branding with lightning bolt, USDT balance pill, user avatar, tier badge and rank
- **Main Game (Grid/Power Plant)**: Dual mechanic based on tier:
  - FREE tier: **CrankWheel** — physics-based spinning wheel (drag in circle to generate watts, 360° = 1 tap). Cyan/teal glow.
  - Paid tiers: **EnergyOrb** — tap-to-earn glowing orb with watts counter displayed INSIDE the orb. Tier-specific colors:
    - BRONZE: Orange/amber orb
    - SILVER: Yellow/amber orb
    - GOLD: Purple/violet orb
- **Sci-fi Design Elements**:
  - Atmospheric gradient background (warm amber horizon fading to dark)
  - Sci-fi platform/pedestal beneath orb/wheel (CSS elliptical ring)
  - Daily Streak and Boosters flanking pills beside the main mechanic
  - Pot distribution cards with tier-themed gradient backgrounds (DIESEL=orange, LNG=yellow, FUSION=purple)
  - Horizontal scrollable live leaderboard with avatars and crowns
  - Upgrades card (amber, gear icon) and Earnings card (green, dollar amount)
- **Layout**: Single-column mobile layout optimized for Telegram mini app webview
- **Components**: `BottomTabBar`, `TopHeader`, `EnergyOrb`, `CrankWheel`, `PotCard`
- Gold/amber primary color scheme with emerald/teal accents
- Dark mode is the default and primary theme (very dark backgrounds rgb(8,8,12))
- Framer Motion for tap feedback and floating watt animations
- Custom CSS animations for orb pulsing, rotation, electric arcs, atmospheric backgrounds

**Technical Implementations:**
- **Authentication**: Telegram-based authentication supporting both Mini App (WebApp initData with HMAC verification) and browser Login Widget. Connected as @Vault60Bot. Guest landing: unauthenticated users see the energy orb immediately (guest mode, local-only watts, no API calls). "Sign in" button in header opens Telegram login modal. Mini App users auto-auth as before.
- **Power Plant (Tap-to-Earn)**: Energy orb tapping with energy system (passive refill). Features a multiplier upgrade system. This is the ONLY active game — 100% of treasury goes to tap pot.
  - FREE tier uses crank wheel (spin to generate); paid tiers use tap-on-orb mechanic
  - Tap → scale animation → floating "+X W" particle
  - Uses batched taps (max 50, flush every 2s) via POST /api/tap
  - Daily Pot Distribution cards show Diesel/LNG/Fusion pot values
  - Live Leaderboard preview shows top 3 players
  - Upgrades card and My Earnings card at bottom
  - Daily streak and booster pills flank the orb
- **Price Prediction**: DISABLED — routes and UI removed, pot allocation set to 0%.
- **Lucky Wheel**: DISABLED — routes and UI removed, pot allocation set to 0%.
- **Wallet & Deposits**: USDT wallet functionality via TON and TRC-20 networks.
- **Leaderboards**: Watts-based leaderboard showcasing top players.
- **Subscription System**: Tiered plans with sandbox payment flow via TON Pay. Silver and Gold tiers blocked server-side with "This tier is not available yet" error.
- **Energy System**: Hybrid passive regeneration with "Full Tank" rolling cooldown refill, tiered for subscribers.
- **Proof of Humanity**: "Spatial Tap Challenge" triggers periodically to mitigate bot activity.
- **Referral System**: Simple $1 USDT per referral payment model.
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
- `client/src/pages/tap-to-earn.tsx` — Power Plant (main game page with energy orb)
- `client/src/pages/subscription.tsx` — Power Plans (tier selection)
- `client/src/pages/dashboard.tsx` — Dashboard with watts stats
- `client/src/components/bottom-tab-bar.tsx` — Bottom navigation bar (4 tabs)
- `client/src/components/top-header.tsx` — Top header with VOLT60 branding, balance, avatar
