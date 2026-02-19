# Crypto Games Platform

## Overview
A gamified crypto-themed web application featuring three mini-games, a wallet/deposit system, email-based authentication, and competitive leaderboards. Players earn virtual rewards by tapping coins, predicting Bitcoin prices, and spinning a lucky wheel. The app supports USDT deposits on TON and TRC-20 networks.

## Tech Stack
- **Frontend**: React + TypeScript, TailwindCSS, shadcn/ui, Framer Motion, wouter routing
- **Backend**: Express.js with session-based auth (express-session + connect-pg-simple)
- **Database**: PostgreSQL with Drizzle ORM (Neon-hosted for production)
- **Email**: Resend integration for OTP delivery
- **API**: CoinGecko for live BTC prices
- **QR Codes**: qrcode.react for deposit address display

## Project Structure
```
client/src/
├── pages/
│   ├── welcome.tsx        - Login page with email OTP authentication
│   ├── dashboard.tsx      - Main dashboard with stats overview
│   ├── tap-to-earn.tsx    - Coin tapping mini-game
│   ├── price-prediction.tsx - BTC price prediction game
│   ├── lucky-wheel.tsx    - Spin wheel for USDT rewards
│   ├── subscription.tsx   - Tier subscription plans with sandbox payment flow
│   ├── wallet.tsx         - USDT wallet with deposit addresses
│   ├── leaderboard.tsx    - Player rankings
│   └── not-found.tsx      - 404 page
├── components/
│   ├── app-sidebar.tsx    - Main navigation sidebar
│   ├── theme-provider.tsx - Dark/light theme context
│   ├── theme-toggle.tsx   - Theme switcher button
│   └── ui/                - shadcn UI component library
├── lib/
│   ├── queryClient.ts     - TanStack Query setup with default fetcher
│   └── game-utils.ts      - Formatters, wheel slice configs, helpers
├── hooks/
│   └── use-toast.ts       - Toast notification hook
└── App.tsx                - Root app with routing, sidebar, auth guard

server/
├── index.ts               - Server entry point
├── routes.ts              - All API endpoints
├── storage.ts             - DatabaseStorage class (Drizzle ORM)
├── email.ts               - OTP email sending via Resend
└── vite.ts                - Vite dev server middleware

shared/
└── schema.ts              - Database tables, insert schemas, TypeScript types
```

## Features

### 1. Email OTP Authentication
- Users enter their email address on the welcome screen
- A 6-digit OTP code is generated (hardcoded to "123456" for testing; Resend integration ready for production)
- OTP codes expire after 10 minutes
- New users are automatically created on first login (username derived from email)
- Session-based auth persists login across page reloads

### 2. Tap-to-Earn Clicker Game
- Tap a coin button to earn Group Coins (1 coin per tap)
- Energy system: starts at 1000, each tap costs 1 energy
- Energy refills to max every 24 hours
- Visual coin animation on tap with Framer Motion
- Real-time energy bar and coin counter display

### 3. Price Prediction Competition
- Predict whether BTC price will go higher or lower
- Predictions resolve after 12 hours using live CoinGecko API data
- Shows current BTC price fetched in real-time
- Tracks correct/total predictions per user
- Active prediction display with countdown timer
- Full prediction history with results

### 4. Lucky Wheel
- Spin a wheel for USDT rewards
- Prize tiers: 0.10, 0.25, 0.50, 1.00, 2.50, 5.00, 10.00, and 100.00 USDT (jackpot)
- Limited spins (starts with 1, can earn more)
- Animated wheel spin with Framer Motion
- Spin history with timestamps and amounts won

### 5. Wallet & Deposits
- View USDT wallet balance
- Deposit USDT via two networks:
  - **TON** (Telegram Open Network) - USDT on TON
  - **TRC-20** (Tron) - USDT on Tron network
- QR code generation for each network's deposit address
- Copy-to-clipboard for deposit addresses
- Deposit history with status tracking (pending, confirmed, failed)
- Deposit addresses are currently placeholders (real gateway integration pending)

### 6. Leaderboard
- Three leaderboard categories:
  - **Coins** - Top players by total Group Coins earned
  - **Predictions** - Top players by correct BTC predictions
  - **Wheel** - Top players by total USDT wheel winnings
- Shows top 50 players per category
- Highlights current user's position

### 7. Dashboard
- Overview of all game stats for the logged-in user
- Quick navigation cards to each mini-game
- Current BTC price display
- Total coins, predictions, and wheel winnings summary

## Database Schema

### users
- `id` (UUID, primary key)
- `username`, `email` (unique)
- `totalCoins`, `energy`, `maxEnergy`, `lastEnergyRefill`
- `spinsRemaining`, `totalSpins`
- `correctPredictions`, `totalPredictions`
- `totalWheelWinnings`, `walletBalance`

### otpCodes
- `id`, `email`, `code`, `expiresAt`, `used`, `createdAt`

### tapSessions
- `id`, `userId`, `taps`, `coinsEarned`, `createdAt`

### predictions
- `id`, `userId`, `prediction`, `btcPriceAtPrediction`
- `resolvedPrice`, `resolved`, `correct`, `createdAt`, `resolvedAt`

### wheelSpins
- `id`, `userId`, `reward`, `sliceLabel`, `createdAt`

### deposits
- `id`, `userId`, `amount`, `network`, `txHash`
- `status` (pending/confirmed/failed), `createdAt`, `confirmedAt`

## API Routes

### Authentication
- `POST /api/send-otp` - Send 6-digit OTP to email via Resend
- `POST /api/verify-otp` - Verify OTP code and login/create user
- `GET /api/user` - Get current authenticated user
- `POST /api/logout` - Destroy session and log out

### Tap-to-Earn
- `POST /api/tap` - Record taps and earn coins (body: `{ taps }`)

### Price Prediction
- `GET /api/btc-price` - Fetch live BTC price from CoinGecko
- `POST /api/predict` - Make a BTC prediction (body: `{ prediction: "higher"|"lower" }`)
- `GET /api/predictions/active` - Get user's active (unresolved) prediction
- `GET /api/predictions` - Get user's full prediction history

### Lucky Wheel
- `POST /api/spin` - Spin the wheel and get reward
- `GET /api/wheel-history` - Get user's spin history

### Wallet & Deposits
- `GET /api/wallet` - Get wallet balance and deposit addresses
- `GET /api/deposits` - Get user's deposit history

### TON Pay Payments
- `POST /api/payments/invoice` - Create a payment invoice for tier subscription (body: `{ tierName }`)
- `POST /api/payments/webhook` - TON Pay webhook endpoint with HMAC-SHA256 signature verification
- `POST /api/payments/sandbox-confirm` - Sandbox-only: confirm payment for testing (body: `{ invoiceId }`)
- `GET /api/payments/config` - Get payment configuration (mode, wallets, splits, tiers)
- `GET /api/payments/invoices` - Get user's payment invoice history

### Leaderboard
- `GET /api/leaderboard/:type` - Get leaderboard (type: coins/predictions/wheel, optional `?tier=FREE|BRONZE|SILVER|GOLD`)

## Theme & Design
- Gold/amber primary color for crypto aesthetic
- Dark mode by default, with light mode toggle
- Inter font family
- Responsive design - works on desktop, tablet, and mobile
- Shadcn sidebar collapses to overlay on mobile
- Framer Motion animations for game interactions
- Consistent card-based layout across all pages

## User Preferences
- OTP hardcoded to "123456" during testing phase
- Deposit addresses are placeholders until real payment gateway is integrated
- Dark mode preferred as default theme

## Recent Changes
- 2026-02-19: Multiplier Upgrade System ("Coin Sink"): Users spend Group Coins (cost = currentLevel * 25,000) to increase personal tap multiplier. Effective multiplier = userLevel * tierBase. New POST /api/games/upgrade-multiplier endpoint with ledger tracking. Per-user tapMultiplier column in users table. Upgrade card on Tap-to-Earn page with level display and cost info.
- 2026-02-19: Tap batch interval changed from 500ms/40 taps to 2000ms/50 taps for 4x server load reduction.
- 2026-02-19: Proof of Humanity challenge UI: Spatial Tap Challenge overlay (ChallengeOverlay component) with moving golden coin that must be tapped 3 times within 6 seconds. Triggers every 5,000 coins earned. Uses ref-based resolution to prevent timer race conditions. Bronze+ founders get +50 energy bonus on pass. Failed challenge pauses tapping for 1 hour. Integrated into tap-to-earn page via error detection from tap API 429 responses.
- 2026-02-18: Rolling cooldown Full Tank system: Replaced daily-counter refill logic with tier-specific rolling cooldowns (BRONZE 24h, SILVER 12h, GOLD ~4.8h, FREE blocked). Added refillCooldownMs to tiers table. Backend /api/energy/refill uses lastFreeRefill + cooldown window. Frontend shows live countdown timer ("Next refill: Xh Ym") and "Full Tank" button when ready. Tier config served via /api/user tierConfig from DB with 60s memory cache.
- 2026-02-18: Hybrid Recharge energy system: Passive time-based regeneration (FREE/BRONZE 1/2sec, SILVER/GOLD 1/sec). Energy calculated on-demand when user opens app (no server cron). Frontend real-time energy ticker.
- 2026-02-18: Auto-migration system: Drizzle migrations run on server startup to keep production DB schema in sync. Handles both fresh DBs (creates tables) and existing DBs (syncs journal). New schema changes just need `npx drizzle-kit generate` then push to git.
- 2026-02-18: Subscription UI page: Tier cards (Free/Bronze/Silver/Gold) with prices from backend config, current plan indicator with founder badge and pro-rate notes, sandbox auto-confirm flow, payment history section with invoice statuses. Added to sidebar navigation.
- 2026-02-18: TON Pay SDK sandbox integration: Invoice-based payment flow for tier subscriptions (Bronze $5, Silver $15, Gold $50). HMAC-SHA256 webhook verification, sandbox-confirm endpoint for testnet testing, automatic 60/40 split at source via processSubscriptionPayment. New paymentInvoices table tracks all invoices. Environment: TON_PAY_MODE=testnet, TON_PAY_SECRET for webhook signing.
- 2026-02-18: Multi-Oracle BTC price system: triple source (CoinGecko, Binance, CoinMarketCap) with median calculation, exponential backoff retries, and 5-minute freeze protocol if all sources fail. Replaces single CoinGecko dependency.
- 2026-02-18: Pro-rated daily pot system: mid-day joiners contribute proportional to hours remaining (minutesActive/1440 * dailyUnit). 4-hour minimum subscription gate on predictions prevents midnight sniping. subscriptionStartedAt timestamp tracks exact join time. Midnight Pulse reads tier pricing from DB (not hardcoded). Ledger entries use real wallet balances.
- 2026-02-18: Built 3-layer security system: Guardian Middleware (rate limiter 15 taps/sec, proof-of-humanity challenge every 5000 coins, wallet-unique filter), Withdrawal Settlement (flat $0.50 fee, $5 min, 24hr audit delay, bot detection), Admin Pulse Dashboard
- 2026-02-18: Admin endpoints now require admin authorization (ADMIN_EMAILS env var)
- 2026-02-18: Withdrawal system switched from percentage-based fees to flat $0.50 USDT fee for all tiers
- 2026-02-17: Added wallet/deposit page with QR codes for TON and TRC-20 USDT networks
- 2026-02-17: Switched login from username-only to email OTP via Resend integration
- 2026-02-17: Initial build with all three games, leaderboard, seed data

## Security Architecture

### Layer 1: Guardian Middleware (server/middleware/guardian.ts)
- **Rate Limiter**: Max 15 taps/second per user, triggers 60-second cooldown
- **Proof of Humanity**: Every 5,000 coins earned triggers a challenge flag; failed challenge pauses multiplier for 1 hour
- **Wallet-Unique Filter**: One TON wallet address per subscription account

### Layer 2: Withdrawal Settlement
- **Flat Fee**: $0.50 USDT per withdrawal (all tiers)
- **Minimum**: $5.00 USDT
- **24-Hour Audit Delay**: All withdrawals enter "pending_audit" status
- **Bot Detection**: Analyzes tap session patterns (frequency, regularity, session count); suspicious patterns → "flagged" for manual admin review
- **Admin Approval**: Flagged withdrawals require manual admin approve/reject; rejections auto-refund gross amount

### Layer 3: Admin Pulse Dashboard
- `GET /api/admin/pulse` — Total revenue, profit swept, active liability, pending/flagged withdrawals, total users, active subscriptions
- `GET /api/admin/pending-withdrawals` — List all pending_audit and flagged withdrawals
- `POST /api/admin/approve-withdrawal` — Approve or reject withdrawals

### Admin Authorization
- Admin endpoints protected by `requireAdmin` middleware
- Admin emails configured via `ADMIN_EMAILS` environment variable (comma-separated)

## Environment Variables
- `DATABASE_URL` - Development PostgreSQL connection (Replit built-in)
- `PRODUCTION_DATABASE_URL` - Production PostgreSQL connection (Neon)
- `SESSION_SECRET` - Express session encryption key
- `ADMIN_EMAILS` - Comma-separated list of admin email addresses
- `ADMIN_PROFITS_WALLET` - TON wallet for admin profits (40% split)
- `GAME_TREASURY_WALLET` - TON wallet for game treasury (60% split)
- `TON_PAY_MODE` - Payment mode: "testnet" (sandbox) or "mainnet" (live)
- `TON_PAY_SECRET` - HMAC-SHA256 secret for webhook signature verification
- `TON_ADMIN_PROFIT_WALLET` - Testnet admin wallet (overrides ADMIN_PROFITS_WALLET in payment service)
- `TON_GAME_TREASURY_WALLET` - Testnet treasury wallet (overrides GAME_TREASURY_WALLET in payment service)
- Resend API key managed via Replit integration connector
