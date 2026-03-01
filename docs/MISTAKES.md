# Mistakes

Ledger of difficult challenges that were solved. Organized by feature/section.

---

## OANDA Executor

### Position size calculation off by 100x (2026-02-26)
**Challenge**: Orders were being placed with 100x the intended size.
**Root cause**: OANDA API expects units as integer, not lots. 1 lot = 100,000 units.
**Fix**: Multiply lot size by 100,000 before sending to API.

---

## Live Trader

### Bot not trading during market hours (2026-02-XX)
**Challenge**: Bot was connected but not executing any trades.
**Root cause**: Timezone mismatch - server was using UTC but schedule expected Zurich time.
**Fix**: Added explicit timezone conversion using `Europe/Zurich` in schedule checks.

---

## AI Agents

### Direction agent always returning WAIT (2026-02-XX)
**Challenge**: AI never recommended trades, always WAIT.
**Root cause**: Prompt was too conservative, required "strong confirmation" for every signal.
**Fix**: Adjusted prompt to allow trades with "moderate" confidence in trending markets.

---

## Connection

### IBKR disconnecting after 1 hour (2026-02-XX)
**Challenge**: Connection dropped every ~60 minutes.
**Root cause**: IBKR API has heartbeat timeout, client wasn't sending keepalive.
**Fix**: Added `setInterval` ping every 30 seconds to maintain connection.

---

## Template

```markdown
### [Short title] (YYYY-MM-DD)
**Challenge**: What went wrong
**Root cause**: Why it happened
**Fix**: How we solved it
```

---

[Back to STRUCTURE](STRUCTURE.md)
