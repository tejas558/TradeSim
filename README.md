# TradeSim

A real-time stock and options trading simulator built with plain HTML, CSS, and JavaScript — no frameworks, no dependencies.

**Live demo:** https://tejas558.github.io/TradeSim/

## Features

- Live price chart with configurable market modes (Bull / Neutral / Bear)
- Stock trading — buy and sell shares with real-time P&L
- Options chain powered by Black-Scholes pricing
  - Buy (long) or sell/write (short) calls and puts
  - 1-minute and 3-minute expiries
  - Live bid/ask spreads, breakeven prices, and per-position P&L
  - Early close at market bid/ask; auto-settlement at expiry
- Portfolio breakdown — cash, shares, and options mark-to-market
- Activity log for all trades and expirations
