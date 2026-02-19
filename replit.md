# Crypto Games Platform

## Overview
A gamified crypto-themed web application offering three mini-games, a wallet/deposit system, email authentication, and competitive leaderboards. The platform aims to engage users with virtual rewards through interactive games like coin tapping, Bitcoin price prediction, and a lucky wheel. It supports USDT deposits on TON and TRC-20 networks and focuses on a secure, scalable, and engaging user experience in the crypto gaming space. The project envisions significant market potential by combining popular gaming mechanics with cryptocurrency, fostering a vibrant community around play-to-earn principles.

## User Preferences
- OTP hardcoded to "123456" during testing phase
- Deposit addresses are placeholders until real payment gateway is integrated
- Dark mode preferred as default theme

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
- **Authentication**: Email-based OTP authentication (6-digit code, 10-minute expiry), with new users automatically provisioned.
- **Gamification**:
    - **Tap-to-Earn**: Coin tapping with an energy system (refills every 24 hours, visual animations). Features a multiplier upgrade system where users spend in-game currency to increase their tap multiplier.
    - **Price Prediction**: Users predict BTC price movement, with results resolving after 12 hours based on real-time data. Submissions are locked at 12:00 UTC daily to prevent last-minute sniping.
    - **Lucky Wheel**: A spin-the-wheel game offering various USDT rewards, with limited spins.
- **Wallet & Deposits**: USDT wallet functionality, supporting deposits via TON and TRC-20 networks with QR code generation.
- **Leaderboards**: Three categories (Coins, Predictions, Wheel winnings) showcasing top players.
- **Subscription System**: Tiered subscription plans (Free, Bronze, Silver, Gold) with different benefits and a sandbox payment flow via TON Pay. Features a "No-Overlap Rule" for multiplier upgrades ensuring higher tiers always offer better progression.
- **Energy System**: A hybrid energy system combining passive regeneration with a "Full Tank" rolling cooldown refill mechanism, tiered for subscribers.
- **Proof of Humanity**: A "Spatial Tap Challenge" triggers periodically to mitigate bot activity, requiring quick user interaction.
- **Database Migrations**: Drizzle ORM handles automated database schema synchronization on server startup.

**System Design Choices:**
- **Security**: A multi-layered security architecture including:
    - **Guardian Middleware**: Rate limiting, Proof of Humanity challenges, and wallet-unique filtering.
    - **Withdrawal Settlement**: Flat fees, minimum withdrawal amounts, 24-hour audit delays, and bot detection with manual admin review.
    - **Admin Pulse Dashboard**: Provides an overview of system financials and pending actions.
- **Scalability**: Batched tap processing (50 taps/2000ms) to reduce server load.
- **Reliability**: Multi-oracle BTC price system (CoinGecko, Binance, CoinMarketCap) with median calculation and retry mechanisms for robust price data.
- **Admin Control**: Admin endpoints are protected by email-based authorization (`ADMIN_EMAILS` env var).
- **Dynamic Oracle Settlement**: Prediction payouts are fully dynamic — driven by a `global_config` database table (prediction_share, tap_share, wheel_share). Each tier's prediction pot is calculated with per-subscriber pro-rating (mid-day joiners contribute proportionally), with per-tier rollover tracking in `tier_rollovers`. If no winners, the pot accumulates for the next settlement and a "Mega Pot" Telegram announcement is sent. Tier pots are fully segregated — no cross-tier sharing. Oracle payouts (wallet + ledger) are wrapped in atomic DB transactions for consistency.

## External Dependencies
- **Email Service**: Resend (for OTP delivery)
- **Real-time Data**: CoinGecko API (for live BTC prices), supplemented by Binance and CoinMarketCap for multi-oracle reliability.
- **Database**: PostgreSQL (hosted on Neon for production)
- **Payment Gateway**: TON Pay SDK (for tier subscriptions, with sandbox and mainnet modes)
- **QR Code Generation**: `qrcode.react` (for deposit addresses)