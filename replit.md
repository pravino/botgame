# Crypto Games Platform

## Overview
A gamified crypto-themed web application offering three mini-games, a wallet/deposit system, Telegram authentication, and competitive leaderboards. The platform aims to engage users with virtual rewards through interactive games like coin tapping, Bitcoin price prediction, and a lucky wheel. It supports USDT deposits on TON and TRC-20 networks and focuses on a secure, scalable, and engaging user experience in the crypto gaming space. The project envisions significant market potential by combining popular gaming mechanics with cryptocurrency, fostering a vibrant community around play-to-earn principles.

## User Preferences
- Deposit addresses are placeholders until real payment gateway is integrated
- Dark mode preferred as default theme
- ALLOWED_TESTERS env var restricts login to whitelisted Telegram IDs during testing
- ADMIN_TELEGRAM_IDS env var for admin access by Telegram ID (alongside ADMIN_EMAILS)

## System Architecture
The application is built with a modern web stack, featuring a React + TypeScript frontend utilizing TailwindCSS, shadcn/ui, and Framer Motion for a responsive and animated user interface. The backend is an Express.js server employing session-based authentication. Data persistence is handled by PostgreSQL with Drizzle ORM, with Neon for production hosting.

**UI/UX Decisions:**
- A gold/amber primary color scheme is used to evoke a crypto aesthetic.
- Dark mode is the default theme, with a toggle for light mode.
- The Inter font family is used throughout for consistent typography.
- The design is fully responsive, adapting to desktop, tablet, and mobile devices, with a collapsing sidebar for mobile navigation.
- Framer Motion provides fluid animations for game interactions and transitions.
- A consistent card-based layout is used across all pages for a unified look and feel.

**Technical Implementations:**
- **Authentication**: Telegram-based authentication supporting both Mini App (WebApp initData with HMAC verification) and browser Login Widget. New users are auto-provisioned with Telegram profile data. ALLOWED_TESTERS env var gates access during testing.
- **Gamification**:
    - **Tap-to-Earn**: Coin tapping with an energy system (refills every 24 hours, visual animations). Features a multiplier upgrade system where users spend in-game currency to increase their tap multiplier.
    - **Price Prediction**: Users predict BTC price movement, with results resolving after 12 hours based on real-time data. Submissions are locked at 12:00 UTC daily to prevent last-minute sniping.
    - **Lucky Wheel**: A spin-the-wheel game offering various USDT rewards, with limited spins.
- **Wallet & Deposits**: USDT wallet functionality, supporting deposits via TON and TRC-20 networks with QR code generation.
- **Leaderboards**: Three categories (Coins, Predictions, Wheel winnings) showcasing top players.
- **Subscription System**: Tiered subscription plans (Free, Bronze, Silver, Gold) with different benefits and a sandbox payment flow via TON Pay. Features a "No-Overlap Rule" for multiplier upgrades ensuring higher tiers always offer better progression.
- **Energy System**: A hybrid energy system combining passive regeneration with a "Full Tank" rolling cooldown refill mechanism, tiered for subscribers.
- **Proof of Humanity**: A "Spatial Tap Challenge" triggers periodically to mitigate bot activity, requiring quick user interaction.
- **Referral System**: Referral-gated wheel unlock with milestone rewards, fully DB-driven.
    - Auto-generated referral codes (REF{userId}{random}) on user creation.
    - Referral code input on signup (welcome page).
    - Wheel unlock gates per tier: Bronze=5 paid friends, Silver=2, Gold=0 (instant, stored in `global_config`).
    - Milestone rewards defined in `referral_milestones` table: 1 friend=$1, 3 friends=$5, 5 friends=$10+unlock, 50 friends=$100.
    - Per-friend USDT reward ($1) credited on each paid subscription.
    - Milestone checker triggers on subscription payment, awards bonuses + wallet credits via ledger.
    - Frontend: `/referrals` page with code sharing, progress bar, milestone tracker, squad list.
    - Wheel page shows referral lock overlay with progress when locked for paid subscribers.
    - Referral leaderboard endpoint at `/api/leaderboard/referrals`.
- **Task Verification System**: Social tasks use verification before awarding coins.
    - Telegram tasks (join channel/group): Backend verifies membership via bot `getChatMember` API. If chat IDs aren't configured, verification is skipped with a log.
    - External link tasks (Twitter/YouTube): Frontend enforces a "Visit → 30-second countdown → Claim" flow to ensure users visit the page.
    - Verification error messages from the server are properly parsed and displayed to users.
- **Database Migrations**: Drizzle ORM handles automated database schema synchronization on server startup.

**System Design Choices:**
- **Security**: A multi-layered security architecture including:
    - **Guardian Middleware**: Rate limiting, Proof of Humanity challenges, and wallet-unique filtering.
    - **Withdrawal Settlement**: Flat fees, minimum withdrawal amounts, 24-hour audit delays, and bot detection with manual admin review.
    - **Admin Pulse Dashboard**: Provides an overview of system financials and pending actions.
- **Scalability**: Batched tap processing (50 taps/2000ms) to reduce server load.
- **Reliability**: Multi-oracle BTC price system (CoinGecko, Binance, CoinMarketCap) with median calculation and retry mechanisms for robust price data.
- **Admin Control**: Admin endpoints are protected by email-based authorization (`ADMIN_EMAILS` env var).
- **Revenue Split**: Subscription payments are split via `global_config`: 40% admin (`admin_split`), 60% treasury (`treasury_split`). From the treasury, `referral_reward_amount` ($1 default) is deducted for the referrer on each payment (including renewals), with the remainder distributed to game pots. If no referrer, the full treasury goes to pots. Both transactionSplit and referralTracker cap the reward at grossTreasury for accounting integrity.
- **Dynamic Oracle Settlement**: Prediction payouts are fully dynamic — driven by a `global_config` database table (prediction_share, tap_share, wheel_share). Each tier's prediction pot is calculated with per-subscriber pro-rating (mid-day joiners contribute proportionally), with per-tier rollover tracking in `tier_rollovers`. If no winners, the pot accumulates for the next settlement and a "Mega Pot" Telegram announcement is sent. Tier pots are fully segregated — no cross-tier sharing. Oracle payouts (wallet + ledger) are wrapped in atomic DB transactions for consistency.
- **Lucky Wheel Fortress (Layer 3)**: Vault-backed gacha system with mathematical EV control.
    - PRNG range 0-10,000 with jackpot trigger at exactly 7777 ("Double-Lock" verification).
    - Per-tier EV calibration: common win ceiling adjusted per tier so average payout = exactly 0.15 USDT/spin regardless of jackpot size (Bronze $100, Silver $200, Gold $500).
    - `FOR UPDATE` row locking on vault reads inside transactions to prevent concurrent jackpot double-payouts.
    - Safe Fallback: If RNG hits but vault balance insufficient, downgrades to coins/energy prize.
    - Tiered Spin Allocation (DB-driven via `global_config`): Free=1/month, Bronze=4, Silver=12, Gold=40.
    - Free tier spins restricted to coins/energy only — no USDT payouts. Locked USDT slices show upgrade popup.
    - Spin tickets expire with subscription, unused spins stay as vault liquidity.
    - Admin vault seeding endpoint (`POST /api/admin/seed-vault`) for marketing float injection.

- **Telegram Bot Integration**: Centralized bot service (`server/services/telegramBot.ts`) replacing scattered API calls.
    - Three-channel system: News (public announcements), Lobby (public community), Apex (private paid members).
    - Chat IDs stored in `global_config` (`telegram_news_channel_id`, `telegram_lobby_group_id`, `telegram_apex_group_id`).
    - Bot initialization runs after seeding in routes.ts startup sequence with auto-detection of chats.
    - Service provides: `sendToNewsChannel`, `sendToLobby`, `sendToApex`, `sendDirectMessage`, `kickFromApex`, `generateApexInviteLink`, `announcePredictionResults`, `announceMegaPot`, `announceWheelWinner`, `announceLeaderboard`, `announceNewSubscriber`, `announceFomoCountdown`, `announceMathWarrior`, `announceLastCall`, `announceSettlementResults`, `announceMorningAlpha`, `announceOracleWarning`, `announceTierGap`.
    - Admin endpoints: `/api/admin/telegram/status`, `/api/admin/telegram/detect-chats`, `/api/admin/telegram/set-chat`, `/api/admin/telegram/send`, `/api/admin/telegram/announce-leaderboard`.
    - Oracle service uses bot for prediction results and mega pot announcements.
    - Wheel service uses bot for jackpot/big-win announcements (wins >= $5), with referral unlock CTA and jackpot teaser.
    - Settlement cron uses bot for expiry DMs, Apex group kicks on expired subscriptions, and post-settlement "Proof" announcements (top 3 earners + total distributed).
    - **3-Stage Promo System**: UTC-aware scheduler fires at 8PM (FOMO Countdown with live pot data), 10PM (Math-Warrior with inactive % and top earner estimates using league multipliers), and 11:30PM (Last Call). All use prorated pool calculations matching settlement formulas. Self-rescheduling via recursive setTimeout.
    - **3-Stage Psychological Promo System**: 8AM (Morning Alpha — live BTC price + 24h change + prediction CTA), 10AM (Oracle Warning — prediction pot sizes + group sentiment Higher/Lower % + 2h countdown), 2PM (Tier Gap Push — shows multiplier gaps between tiers, aspirational upgrade push).

## External Dependencies
- **Email Service**: Resend (for OTP delivery)
- **Real-time Data**: CoinGecko API (for live BTC prices), supplemented by Binance and CoinMarketCap for multi-oracle reliability.
- **Database**: PostgreSQL (hosted on Neon for production)
- **Payment Gateway**: TON Pay SDK (for tier subscriptions, with sandbox and mainnet modes)
- **QR Code Generation**: `qrcode.react` (for deposit addresses)
- **Telegram Bot**: Vault60Bot via `TELEGRAM_BOT_TOKEN` secret — manages notifications, Apex membership, and admin broadcasts.