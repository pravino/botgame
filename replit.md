# Crypto Games Platform

## Overview
A gamified web app with three mini-games: Tap-to-Earn, Price Prediction, and Lucky Wheel. Users pick a username (no password), play games, earn virtual rewards, and compete on leaderboards.

## Tech Stack
- **Frontend**: React + TypeScript, TailwindCSS, shadcn/ui, Framer Motion, wouter routing
- **Backend**: Express.js with session-based auth
- **Database**: PostgreSQL with Drizzle ORM
- **API**: CoinGecko for live BTC prices

## Project Structure
- `client/src/pages/` - Dashboard, TapToEarn, PricePrediction, LuckyWheel, Leaderboard, Welcome
- `client/src/components/` - AppSidebar, ThemeProvider, ThemeToggle, shadcn UI components
- `client/src/lib/` - queryClient, game-utils (formatters, wheel slices)
- `server/routes.ts` - All API endpoints
- `server/storage.ts` - DatabaseStorage class with Drizzle
- `shared/schema.ts` - users, tapSessions, predictions, wheelSpins tables

## Key Features
1. **Tap-to-Earn**: Tap a coin to earn Group Coins, energy depletes and refills every 24h
2. **Price Prediction**: Predict BTC higher/lower in 12h, auto-resolves via CoinGecko
3. **Lucky Wheel**: Spin for USDT rewards (0.10 to 100 USDT jackpot), limited spins
4. **Leaderboard**: Top players by coins, predictions, and wheel winnings

## API Routes
- POST /api/send-otp - Send 6-digit OTP to email via Resend
- POST /api/verify-otp - Verify OTP code and login/create user
- GET /api/user - Get current user
- POST /api/logout - Destroy session
- POST /api/tap - Record taps
- GET /api/btc-price - Live BTC price
- POST /api/predict - Make a prediction
- GET /api/predictions/active - Active prediction
- GET /api/predictions - User prediction history
- POST /api/spin - Spin the wheel
- GET /api/wheel-history - Spin history
- GET /api/leaderboard/:type - Leaderboard (coins/predictions/wheel)

## Theme
- Gold/amber primary color for crypto feel
- Dark mode default
- Inter font family

## Recent Changes
- 2026-02-17: Switched login from username-only to email OTP via Resend integration
- 2026-02-17: Initial build with all three games, leaderboard, seed data
