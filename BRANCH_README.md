# Branch: gbpusd (GBP/USD)

## Focus

This branch trades **GBP/USD** exclusively during optimal hours.

## Configuration

| Parameter | Value |
|-----------|-------|
| **Pair** | GBP/USD |
| **Trading Hours** | 09:00 - 18:00 CET |
| **Spread** | 0.00012 |
| **Pip Scale** | 10000 (1 pip = 0.0001) |

## Quick Start

```bash
# 1. Download historical data (IBKR required)
node historical_data_gbpusd.js

# 2. Backtest
node batch_trainer.js

# 3. Live trade
node live_trader.js
```

## GBP/USD Characteristics

- **Pip scale**: Same as EUR/USD (0.0001 = 1 pip)
- **Higher volatility** - larger average daily range than EUR/USD
- **London session focus** - most liquid during UK trading hours
- **High correlation** with EUR/USD (~85%)
- **News sensitive** - UK GDP, BoE decisions, Brexit-related news

## Key Files

| File | Purpose |
|------|---------|
| `historical_data_gbpusd.js` | Download 5-min data from IBKR |
| `gbpusd_5m.json` | Historical data (after download) |
| `pair_config.js` | Pair-specific settings |
| `trade_results_gbpusd.json` | Trade results |
