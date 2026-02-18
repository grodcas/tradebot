# Branch: other_pairs

## Purpose
Train and run the trading system on **different forex pairs** (GBP/USD, USD/JPY, etc.)

## Configuration

Set the pair in `.env`:
```
TRADING_PAIR=GBPUSD
```

Or modify `pair_config.js` directly.

## Supported Pairs

| Pair | Symbol | Currency | Spread | Notes |
|------|--------|----------|--------|-------|
| EUR/USD | EUR | USD | 0.00008 | Base pair (use base_trainer) |
| GBP/USD | GBP | USD | 0.00012 | Higher volatility |
| USD/JPY | USD | JPY | 0.008 | Yen pairs have different pip scale |
| AUD/USD | AUD | USD | 0.00010 | Commodity currency |
| USD/CHF | USD | CHF | 0.00012 | Safe haven |

## Key Differences from base_trainer
- Configurable pair via environment or config
- Pair-specific spread and pip calculations
- Separate historical data files per pair
- Independent trade results per pair

## Usage
```bash
# Set pair and run
TRADING_PAIR=GBPUSD node live_trader.js

# Or use the Claude agent to iterate
node claude_agent.js "Train the system on GBP/USD using historical data"
```

## Correlation Warning
Pairs like EUR/USD and GBP/USD are ~85% correlated. Running both simultaneously effectively doubles exposure to the same trade.

Uncorrelated alternatives:
- EUR/USD + USD/JPY (inverse correlation)
- EUR/USD + AUD/USD (moderate correlation)
