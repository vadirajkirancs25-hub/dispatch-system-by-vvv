# Solution Document: Smart Delivery Dispatch System
## Code2Create Challenge – Round 2

---

## 1. Problem Statement Summary

Design a **real-time delivery dispatch system** that assigns delivery agents to incoming orders while:
- Minimizing average delivery time
- Minimizing SLA violations
- Ensuring fair workload distribution across agents
- Prioritizing high-priority orders

### Inputs
| Entity | Fields |
|--------|--------|
| Orders | `order_id`, `timestamp`, `location`, `prep_time`, `priority` |
| Agents | `agent_id`, `current_location`, `availability`, `rating` |
| Environment | 10×10 grid (Manhattan distance), dynamic traffic delays |

### Constraints
| Constraint | Value |
|-----------|-------|
| Max active orders per agent | 2 |
| Decision latency target | ≤ 5 seconds |
| SLA window | 50 minutes (default) |
| Order arrival | Continuous (real-time) |

---

## 2. Our Approach: Weighted Multi-Criteria Heuristic Scoring

### 2.1 Why a Heuristic Over Optimization Solvers?

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Linear Programming (LP/ILP) | Globally optimal | Too slow for 5s latency target; scaling issues | ❌ Rejected |
| Machine Learning model | Learns patterns | Needs training data; black-box decisions | ❌ Rejected |
| Greedy heuristic scoring | O(n·m) = instant; explainable; tunable | May miss global optimum | ✅ Selected |
| Auction-based | Decentralized | Complex; latency unpredictable | ❌ Rejected |

**Decision:** A weighted scoring model gives sub-millisecond decisions, is fully explainable (critical for a demo), and can be tuned per business needs.

### 2.2 Scoring Formula

```
score(rider, order) = 0.4·distance + 0.35·sla_penalty + 0.2·fairness - 0.2·rating_bonus - 0.3·priority_boost
```

**The lowest score wins** (best rider for this order).

### 2.3 Weight Justification

| Factor | Weight | Rationale |
|--------|--------|-----------|
| **Distance** | +40% | Directly correlates to delivery time (primary objective). Manhattan distance on grid. |
| **SLA risk** | +35% | `max(0, ETA - SLA) × 4`. Heavy penalty prevents breach cascades. Nearly equal to distance because late delivery = failed delivery. |
| **Fairness** | +20% | `|rider_load + 1 - avg_load| × 10`. Prevents one rider getting overloaded while others sit idle. |
| **Rating** | −20% | `rider.rating × 3`. Rewards consistent riders but doesn't dominate — a 5★ rider far away shouldn't beat a 3.5★ rider next door. |
| **Priority boost** | −30% | Scaled per priority level (urgent: 53, high: 30, standard: 10, low: 8). Ensures urgent orders attract the best available rider. |

### 2.4 Priority Weights (from constraints.csv)

| Priority | Multiplier | Boost Value | Effect |
|----------|-----------|-------------|--------|
| Urgent | 1.5× | 53 | Strongest pull toward best rider |
| High | 1.5× | 30 | Strong pull |
| Standard | 1.0× | 10 | Neutral |
| Low | 0.8× | 8 | Deprioritized |

---

## 3. What We Implemented

### 3.1 Core Decision Engine

| Feature | Implementation | Maps to Objective |
|---------|---------------|-------------------|
| **Single dispatch** | Score all eligible riders for one order, pick lowest | Min delivery time |
| **Batch dispatch** | Sort pending orders by priority → assign greedily in order | Prioritize urgent orders |
| **Capacity enforcement** | Riders capped at 2 active orders | Constraint compliance |
| **Fairness penalty** | Variance-based load balancing in score function | Fair distribution |
| **SLA monitoring** | ETA vs SLA threshold → On Track / At Risk / Breached | Min SLA violations |
| **Re-assignment** | Detect SLA-breached orders → swap to closer rider if 30%+ better | Dynamic correction |

### 3.2 Time Simulation

| Feature | Purpose |
|---------|---------|
| Simulation clock (1×/2×/5× speed) | Demonstrates orders progressing toward SLA deadlines |
| Auto-breach detection | Orders exceeding 120% SLA get flagged |
| Elapsed time counter | Makes temporal dynamics visible to judges |

### 3.3 Dynamic Environment

| Feature | Purpose |
|---------|---------|
| Traffic delay slider (0–20 min) | Simulates real-world congestion |
| Delay feeds into ETA calculation | Score adapts to changing conditions |
| Re-assignment on breach | System self-corrects when conditions change |

### 3.4 Observability Dashboard

| Component | What it shows |
|-----------|---------------|
| **KPI cards** | Pending, In Transit, Delivered, SLA Breaches, Load Variance, Active Riders |
| **Live grid map** | Real-time positions of riders and orders on 10×10 city grid |
| **Score analysis panel** | Full breakdown of scoring for any order (distance, ETA, load, SLA) |
| **Activity feed** | Chronological log of all dispatch decisions |
| **System constraints panel** | Live display of all CSV config values |
| **Approach justification** | In-UI explanation of the scoring model |

---

## 4. Trade-offs Acknowledged

| Trade-off | Our Choice | Why |
|-----------|-----------|-----|
| Global optimality vs speed | Speed (greedy) | 5-second latency target makes LP impractical |
| Simplicity vs accuracy | Simplicity | Clear weighted formula > opaque neural net for a demo |
| Static weights vs adaptive | Static | Tunable and explainable; adaptive adds complexity without proven benefit here |
| Single assignment vs re-assignment | Both | Initial greedy + correction for dynamic changes covers both scenarios |
| Rider preference vs system optimal | System optimal | Riders don't choose orders; system assigns based on multi-criteria score |

---

## 5. How Each Evaluation Criterion Is Met

### 5.1 Average Delivery Time → Minimized
- Distance is the **highest-weighted factor** (40%)
- ETA calculation includes: `prep_time + distance + load_penalty + traffic_delay`
- Closest capable rider naturally gets the best (lowest) score

### 5.2 SLA Breach Rate → Minimized
- SLA penalty applies a **4× multiplier** when ETA exceeds SLA
- "At Risk" warning triggers at 80% of SLA window
- Re-assignment kicks in when breach exceeds 120%
- Batch dispatch processes urgent/high orders **first**

### 5.3 Load Variance → Minimized
- Fairness penalty: `|rider_load + 1 - avg_load| × 10`
- A rider already at capacity (2 orders) is excluded entirely
- Variance is computed and displayed as a live KPI
- System actively avoids piling orders on one rider

### 5.4 Code Quality & Modularity
- **Pure utility functions**: `dist()`, `eta()`, `score()`, `fairnessPenalty()`, `variance()` — all testable in isolation
- **Separation**: Constants → Utilities → Data generators → UI atoms → Composite components → Main app
- **No side effects** in scoring logic
- **React best practices**: `useMemo`, `useCallback`, `useRef` for performance

### 5.5 Soundness of Decision Logic
- Scoring model is **mathematically grounded** — weighted linear combination
- Each weight has **explicit business justification**
- Batch dispatch sorts by **priority then timestamp** (FIFO within same priority)
- Re-assignment uses a **30% improvement threshold** to avoid unnecessary churn

---

## 6. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    DeliveryDispatch (Main)                │
├──────────────┬──────────────┬──────────────┬────────────┤
│  State Mgmt  │  Decision    │  Simulation  │    UI      │
│              │  Engine      │  Engine      │            │
│ • orders[]   │ • score()    │ • elapsed    │ • GridMap  │
│ • riders[]   │ • eta()      │ • simClock   │ • KPIs     │
│ • delay      │ • dispatch() │ • breach     │ • Orders   │
│ • elapsed    │ • reassign() │   detection  │ • Riders   │
│ • log[]      │ • batchAll() │              │ • Scores   │
└──────────────┴──────────────┴──────────────┴────────────┘
         │              │              │
         ▼              ▼              ▼
┌──────────────────────────────────────────────────────────┐
│            Pure Utility Functions (Testable)              │
│  dist() · eta() · score() · fairnessPenalty() · variance│
└──────────────────────────────────────────────────────────┘
```

---

## 7. Complexity Analysis

| Operation | Time Complexity | Practical Impact |
|-----------|----------------|------------------|
| Single dispatch | O(R) where R = riders | ~6 comparisons → instant |
| Batch dispatch | O(P × R) where P = pending | ~10 × 6 = 60 ops → instant |
| Re-assignment | O(B × R) where B = breached | Worst case same as batch |
| Variance calculation | O(R) | Negligible |

All operations complete in **< 1ms**, well under the 5-second target.

---

## 8. Future Enhancements (If More Time)

1. **Predictive ETA** — Use historical delivery times instead of Manhattan distance
2. **Clustering** — Group nearby orders for the same rider (batched deliveries)
3. **Adaptive weights** — Tune scoring weights based on observed SLA performance
4. **Multi-stop routing** — Optimize pickup sequence when a rider has 2 orders
5. **Agent preferences** — Consider rider zone familiarity and vehicle type matching

---

## 9. Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| UI Framework | React 18 | Component model, hooks for state |
| Build Tool | Vite 5 | Instant HMR, fast startup |
| Language | JavaScript (JSX) | Rapid prototyping, no compile step |
| Styling | Inline styles | Zero config, no CSS dependencies |
| State | React useState/useMemo | Simple, sufficient for demo scale |

---

## 10. How to Run

```bash
cd C:\Users\RAASCLOUD\DeliveryDispatch
npm install
npx vite
# Open http://localhost:5173
```

### Controls:
- **+ New Order** — Add a random order to the queue
- **⚡ Dispatch All** — Auto-assign all pending orders by priority
- **🔄 Re-assign** — Check for SLA-breached orders and swap riders
- **▶ Start** — Begin time simulation
- **Traffic delay slider** — Simulate congestion (0–20 min)
- **Click any order** → Switch to Analysis tab for full score breakdown

---

*Document prepared for Code2Create Challenge – Round 2*
*System: SwiftDispatch – Smart Delivery Dispatch System*
