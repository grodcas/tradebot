# Diary

Session history and commit tracking.

---

## 2026-02-28

### Repository Restructure
- Deleted dead code: IBKR files, batch_trainer, Python scripts, old duplicates
- Created `src/`, `models/`, `tools/`, `data/` directory structure
- Moved all files via `git mv` to preserve history
- Updated all import paths (`require()`, `dotenv.config()`, file I/O)
- Added `metadata.json` to each model directory
- Removed `@stoqey/ib` dependency, added `npm start` script
- Rewrote documentation as hub-and-spoke centered on STRUCTURE.md
- Tags: `v2.0-pre-restructure` (rollback), `v2.1-restructured` (verified), `v3.0` (final)

---

## 2026-02-26

### Session 1
- Migrated from IBKR to OANDA executor
- Fixed position sizing calculations
- Added limit order support with `test_oanda_limit.js`

### Commits
- `TODO: add commit hash` - OANDA integration

### Pending
- Test overnight position handling
- Verify margin calculations

---

## 2026-02-25

### Session 1
- Set up OANDA API connection
- Created `check_account.py` for balance verification
- Added `margin_demo.py` for margin testing

---

## 2026-02-18

### Session 1 - First Live Session
- **7 trades executed**
- Win Rate: 57.1% (4/7)
- Total R: +3.31R weighted
- SHORT bias performed better (80% WR vs 0% LONG)

### Notes
- System ran stable for 10 hours
- Dashboard accessible via ngrok
- See `LIVE_SESSION_ANALYSIS_20260218.md` for details
