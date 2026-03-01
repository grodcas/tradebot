# Mermaid Showcase

All diagram types you can use in your docs.

---

## 1. Flowchart (Top-Bottom)

```mermaid
flowchart TB
    A[Start] --> B{Decision}
    B -->|Yes| C[Do Something]
    B -->|No| D[Do Other]
    C --> E[End]
    D --> E
```

---

## 2. Flowchart (Left-Right)
**Better for horizontal layouts**

```mermaid
flowchart LR
    A[Input] --> B[Process] --> C[Output]
```

---

## 3. Sequence Diagram
**Great for API calls, interactions**

```mermaid
sequenceDiagram
    participant U as User
    participant A as App
    participant DB as Database

    U->>A: Click button
    A->>DB: Query data
    DB-->>A: Return results
    A-->>U: Show results
```

---

## 4. State Diagram
**Perfect for status/lifecycle**

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Running: Start
    Running --> Paused: Pause
    Paused --> Running: Resume
    Running --> Stopped: Stop
    Stopped --> [*]
```

---

## 5. Entity Relationship (ER)
**Database schemas**

```mermaid
erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ ITEM : contains
    USER {
        int id
        string name
        string email
    }
    ORDER {
        int id
        date created
        float total
    }
```

---

## 6. Gantt Chart
**Timelines, schedules**

```mermaid
gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Phase 1
        Research    :a1, 2026-01-01, 30d
        Design      :a2, after a1, 20d
    section Phase 2
        Development :a3, after a2, 60d
        Testing     :a4, after a3, 14d
```

---

## 7. Pie Chart

```mermaid
pie title Trade Distribution
    "EUR/USD" : 45
    "GBP/USD" : 30
    "USD/JPY" : 25
```

---

## 8. Class Diagram
**Code architecture**

```mermaid
classDiagram
    class Executor {
        +apiKey: string
        +execute(signal)
        +close(tradeId)
    }
    class Agent {
        +prompt: string
        +analyze(data)
    }
    Executor <-- Agent : uses
```

---

## 9. Git Graph
**Branch visualization**

```mermaid
gitGraph
    commit id: "init"
    branch feature
    commit id: "add feature"
    commit id: "fix bug"
    checkout main
    merge feature
    commit id: "release"
```

---

## 10. Mind Map

```mermaid
mindmap
    root((Trading Bot))
        Data
            OANDA
            IBKR
        Agents
            Direction
            Confidence
            Levels
        Execution
            Orders
            Positions
```

---

## 11. Timeline

```mermaid
timeline
    title Bot Development
    2026-01 : Research
            : Prototype
    2026-02 : Live Testing
            : OANDA Integration
    2026-03 : Multi-pair
            : Production
```

---

## 12. Quadrant Chart

```mermaid
quadrantChart
    title Trading Strategies
    x-axis Low Risk --> High Risk
    y-axis Low Return --> High Return
    quadrant-1 Scale up
    quadrant-2 Ideal
    quadrant-3 Avoid
    quadrant-4 Reconsider
    Scalping: [0.7, 0.6]
    Swing: [0.4, 0.5]
    HODL: [0.2, 0.3]
```

---

## Fixing Horizontal Cropping

Add this to the top of your markdown file to make diagrams wider:

```html
<style>
.mermaid {
    max-width: 100% !important;
}
</style>
```

Or use `flowchart LR` (left-right) instead of `TB` (top-bottom) for narrower, wider diagrams.

---

## More Advanced Tools

| Tool | Best For | Notes |
|------|----------|-------|
| **Mermaid** | Docs, flowcharts | Built into Obsidian |
| **PlantUML** | Complex UML | Needs plugin |
| **D2** | Modern diagrams | CLI tool, very clean |
| **Excalidraw** | Hand-drawn style | Obsidian plugin, interactive |
| **Plotly/Chart.js** | Data plots, graphs | Needs HTML/JS |
| **draw.io** | Everything | Export as PNG/SVG |

### For actual data plots (price charts, PnL):
Mermaid can't do this. Options:
1. **Excalidraw plugin** - Draw charts manually in Obsidian
2. **Export from Python** - Use matplotlib, save as PNG, embed in markdown
3. **Obsidian Charts plugin** - Basic charts from data

---

[← Back to Structure](../STRUCTURE.md)
