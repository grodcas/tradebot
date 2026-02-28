# Documentation Guidelines

This document explains how documentation is organized in this repository. Follow these rules when creating or updating documentation.

---

## Core Principle

**STRUCTURE.md is the single entry point.** Everything must be accessible from STRUCTURE.md through hyperlinks. If a document exists but isn't linked from STRUCTURE.md, it doesn't exist.

---

## Folder Structure

```
docs/
├── STRUCTURE.md           # Master entry point (READ THIS FIRST)
├── DIARY.md               # Development log (chronological)
├── MISTAKES.md            # Difficult challenges solved
├── CONVENTIONS.md         # Naming standards
│
├── features/              # Feature documentation
│   ├── agents.md          # AI agent system
│   ├── batch-trainer.md   # Backtest engine
│   ├── iteration-loop.md  # Auto-improvement
│   ├── live-trader.md     # Live/paper trading
│   └── model-system.md    # Model versioning
│
├── guidelines/            # HOW-TO documentation
│   ├── DOC_GUIDELINES.md  # This file
│   └── ITERATION_GUIDELINES.md  # How to improve models
│
└── reports/               # Test result reports
    └── {model}_report.md  # Performance reports per model
```

---

## Document Types

### STRUCTURE.md
- **Purpose**: Master overview and navigation hub
- **Contents**:
  - Purpose and tech stack
  - Architecture diagrams (Mermaid)
  - Folder structure
  - Features table with links
  - Current best model metrics
  - Quick commands
  - Links to all other docs
- **Rule**: Every other doc must be linked from here

### DIARY.md
- **Purpose**: Chronological development log
- **Contents**:
  - Date headers (## Feb 21, 2026)
  - What was done that day
  - Decisions made
  - Tasks for next session
- **Rule**: Append only, never edit past entries

### MISTAKES.md
- **Purpose**: Document difficult challenges that were solved
- **Contents**:
  - Problem description
  - Why it was hard
  - The solution
  - Lesson learned
- **Rule**: Only add SOLVED problems, not open issues

### CONVENTIONS.md
- **Purpose**: Naming standards for models, files, branches
- **Rule**: Keep short and prescriptive

### features/*.md
- **Purpose**: Detailed documentation for each major feature
- **Contents**:
  - What it does
  - How to use it
  - Configuration options
  - Examples
- **Rule**: One file per feature, linked from STRUCTURE.md Features table

### guidelines/*.md
- **Purpose**: Step-by-step HOW-TO instructions
- **Contents**:
  - When to use this process
  - Step-by-step instructions
  - Common pitfalls
  - Examples
- **Rule**: Process-focused, not feature-focused

### reports/*.md
- **Purpose**: Performance reports for specific model runs
- **Contents**:
  - Test date and model version
  - Metrics (WR, R, trades)
  - Win/loss analysis
  - Recommendations
- **Naming**: `{model}_{date}_report.md` (e.g., `gpt5_iter5_20260221_report.md`)

---

## How to Add New Documentation

### Adding a New Feature Doc
1. Create `docs/features/{feature-name}.md`
2. Add row to Features table in STRUCTURE.md:
   ```markdown
   | Feature Name | Brief description | [feature-name.md](features/feature-name.md) |
   ```

### Adding a New Guideline
1. Create `docs/guidelines/{PROCESS}_GUIDELINES.md`
2. Add link to Guidelines section in STRUCTURE.md

### Adding a Test Report
1. Create `docs/reports/{model}_{date}_report.md`
2. Add link to Reports section in STRUCTURE.md

### Logging Development Work
1. Open DIARY.md
2. Add new date header if new day
3. Document what was done
4. Add tasks for next session

### Documenting a Solved Challenge
1. Open MISTAKES.md
2. Add new section with:
   - Problem
   - Why it was hard
   - Solution
   - Lesson learned

---

## Linking Rules

### Internal Links
Use relative paths from the document's location:
```markdown
# From STRUCTURE.md
[agents.md](features/agents.md)
[DIARY.md](DIARY.md)

# From features/agents.md
[Back to Structure](../STRUCTURE.md)
```

### External Links
Always use full URLs:
```markdown
[IBKR API Docs](https://interactivebrokers.github.io/tws-api/)
```

---

## Mermaid Diagrams

Use Mermaid for all diagrams in STRUCTURE.md:
- `flowchart TB` for architecture
- `flowchart LR` for decision flows
- `xychart-beta` for performance charts

Keep diagrams in STRUCTURE.md only - feature docs should be text-focused.

---

## Model Documentation

Each saved model in `models/` should have:
1. `metadata.json` - Machine-readable test results
2. `README.md` - Human-readable overview and key changes
3. Agent `.js` files - The actual prompts

When a new model is saved:
1. Update Models table in STRUCTURE.md
2. Add entry to DIARY.md explaining what changed
3. Optionally create report in `docs/reports/`

---

## Quick Reference

| Task | Action |
|------|--------|
| Understand the system | Read STRUCTURE.md |
| Find feature details | STRUCTURE.md → Features table → feature doc |
| Learn how to do X | STRUCTURE.md → Guidelines section → guideline doc |
| See development history | Read DIARY.md |
| See solved problems | Read MISTAKES.md |
| Add new feature doc | Create in features/, link from STRUCTURE.md |
| Log today's work | Append to DIARY.md |
| Document a solved bug | Add to MISTAKES.md |

---

[Back to STRUCTURE](../STRUCTURE.md)
