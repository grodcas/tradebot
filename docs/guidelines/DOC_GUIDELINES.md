# Documentation Guidelines

How to add and maintain documentation in TRADEBOT_live.

---

## Hub-and-Spoke Model

All documentation radiates from a single hub: [`docs/STRUCTURE.md`](../STRUCTURE.md).

- **STRUCTURE.md** is the only entry point. Every doc links back to it.
- **Feature docs** (`docs/features/`) describe how a subsystem works.
- **Reports** (`docs/reports/`) are timestamped analysis snapshots.
- **Guidelines** (`docs/guidelines/`) are how-to guides.

---

## Adding a New Feature Doc

1. Create `docs/features/your-feature.md` (kebab-case)
2. Include `[Back to STRUCTURE](../STRUCTURE.md)` at the bottom
3. Add a row to the Features table in STRUCTURE.md

---

## Adding a Report

1. Create `docs/reports/description_YYYYMMDD.md` (snake_case with date)
2. Add a row to the Reports table in STRUCTURE.md
3. Include `[Back to STRUCTURE](../STRUCTURE.md)` at the bottom

---

## Adding a Model

1. Copy agents to `models/{llm}_{pair}[_iter{N}]/`
2. Create `metadata.json` in the model directory (see [model-system.md](../features/model-system.md))
3. Create or update the strategy selector in `src/`
4. Add a row to the Models table in STRUCTURE.md

---

## Updating DIARY.md

Add entries in reverse chronological order:

```markdown
## YYYY-MM-DD

### Session N
- What was done
- Key results

### Commits
- `hash` - Commit message
```

---

## Style Rules

- No emojis in documentation
- Use Mermaid diagrams for architecture and flows
- Use tables for structured data
- Every page links back to STRUCTURE.md
- Keep pages focused on one topic

---

[Back to STRUCTURE](../STRUCTURE.md)
