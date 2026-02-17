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

### Leaderboard
- `GET /api/leaderboard/:type` - Get leaderboard (type: coins/predictions/wheel)

## Theme & Design
- Gold/amber primary color for crypto aesthetic
- Dark mode by default, with light mode toggle
- Inter font family
- Responsive design - works on desktop, tablet, and mobile
- Shadcn sidebar collapses to overlay on mobile
- Framer Motion animations for game interactions
- Consistent card-based layout across all pages

## Environment Variables
- `DATABASE_URL` - Development PostgreSQL connection (Replit built-in)
- `PRODUCTION_DATABASE_URL` - Production PostgreSQL connection (Neon)
- `SESSION_SECRET` - Express session encryption key
- Resend API key managed via Replit integration connector

## User Preferences
- OTP hardcoded to "123456" during testing phase
- Deposit addresses are placeholders until real payment gateway is integrated
- Dark mode preferred as default theme

## Recent Changes
- 2026-02-17: Added wallet/deposit page with QR codes for TON and TRC-20 USDT networks
- 2026-02-17: Switched login from username-only to email OTP via Resend integration
- 2026-02-17: Initial build with all three games, leaderboard, seed data
