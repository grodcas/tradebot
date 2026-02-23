# Naming Conventions & Standards

## Model Naming

### Format
```
{base_model}_{iteration}_{YYYYMMDD}
```

### Examples
- `gpt4_baseline_20260221` - GPT-4 baseline model, created Feb 21, 2026
- `gpt5_iter4_20260221` - GPT-5 iteration 4, created Feb 21, 2026
- `gpt5_iter5_20260221` - GPT-5 iteration 5, created Feb 21, 2026

### Components
- **base_model**: `gpt4` or `gpt5` (the underlying LLM)
- **iteration**: `baseline`, `iter1`, `iter2`, etc. (improvement cycle)
- **YYYYMMDD**: Date when model was validated/saved

## Result Naming

### Format
```
{YYYYMMDD}_{model}_{dataset}.json
```

### Examples
- `20260221_gpt5_iter5_recent.json`
- `20260221_gpt4_baseline_old.json`
- `20260222_gpt5_iter6_recent.json`

### Components
- **YYYYMMDD**: Date test was run
- **model**: Model identifier (matches model folder name without date)
- **dataset**: `recent` or `old` (which data file was used)

## Data File Naming

### Format
```
{pair}_{timeframe}_{qualifier}.json
```

### Examples
- `eurusd_5m_recent.json` - Recent EUR/USD 5-minute data
- `eurusd_5m_old.json` - Older EUR/USD 5-minute data

### Qualifiers
- `recent`: Data from last 3 months
- `old`: Data from 3-6 months ago

## Model Folder Structure

Each saved model must contain:

```
models/{name}_{YYYYMMDD}/
├── metadata.json         # REQUIRED: Model info & test results
├── direction_agent.js    # REQUIRED: Direction analysis prompt
├── confidence_agent.js   # REQUIRED: Probability assessment prompt
├── levels_agent.js       # REQUIRED: Level setting prompt
├── orchestrator.js       # REQUIRED: Agent coordination
├── ai_client.js          # OPTIONAL: Custom API client
└── README.md             # OPTIONAL: Detailed notes
```

## Metadata.json Schema

```json
{
  "name": "gpt5_iter5",
  "version": "iteration_5",
  "date_created": "2026-02-21",
  "base_model": "gpt-5.2",
  "iteration": 5,
  "description": "Brief description of model improvements",
  "test_results": {
    "recent_data": {
      "dataset": "eurusd_5m_recent.json",
      "date_range": "Nov 2025 - Feb 2026",
      "trades": 29,
      "win_rate": 86.2,
      "total_r": 20.82,
      "max_losing_streak": 2
    },
    "old_data": {
      "dataset": "eurusd_5m_old.json",
      "date_range": "Aug 2025 - Nov 2025",
      "trades": 30,
      "win_rate": 70.0,
      "total_r": 21.80,
      "max_losing_streak": 3
    },
    "combined": {
      "trades": 59,
      "win_rate": 78.0,
      "total_r": 42.62,
      "max_losing_streak": 3
    }
  },
  "key_features": [
    "Feature 1",
    "Feature 2"
  ],
  "files": [
    "direction_agent.js",
    "confidence_agent.js",
    "levels_agent.js",
    "orchestrator.js",
    "ai_client.js"
  ],
  "known_limitations": [
    "Limitation 1"
  ],
  "notes": "Additional notes"
}
```

## Git Conventions

### Branches
- `main`: Production-ready code
- `base_trainer`: Development branch for model training

### Tags
- `v1.0`, `v1.1`, etc.: Major releases
- Tags should point to commits with validated models

### Commit Messages
- Use imperative mood: "Add feature" not "Added feature"
- Reference model iterations when applicable
