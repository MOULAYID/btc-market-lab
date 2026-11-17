# BTC Market Lab 🧪⚡

An interactive research terminal and replay simulator for studying latency arbitrage between **Bitcoin spot price moves (Binance)** and **prediction market order books (Polymarket)**.

Designed for quantitative researchers, algorithm developers, and curious beginners alike, BTC Market Lab lets you visualize, test, and measure how execution speed, order size, and depth liquidity impact trading outcomes—all in a 100% risk-free, local paper trading environment.

---

## 📖 Table of Contents
- [What Problem Does This Solve?](#-what-problem-does-this-solve)
- [Key Concepts for Beginners](#-key-concepts-for-beginners)
- [Quickstart Guide](#-quickstart-guide)
- [Step-by-Step Beginner Tutorial](#-step-by-step-beginner-tutorial)
  - [Example 1: The Latency Race (100 ms vs 500 ms)](#example-1-the-latency-race-100-ms-vs-500-ms)
  - [Example 2: Order Book Depth & Partial Fills](#example-2-order-book-depth--partial-fills)
- [Dashboard Features & Controls](#-dashboard-features--controls)
- [Live Paper Mode](#-live-paper-mode)
- [Project Architecture](#-project-architecture)
- [Running the Test Suite](#-running-the-test-suite)
- [Safety & Scope](#-safety--scope)

---

## 🎯 What Problem Does This Solve?

Imagine Bitcoin suddenly surges by **+0.15% in 2 seconds** on Binance. 

Prediction markets like Polymarket offer binary event contracts (e.g. *"Bitcoin above $68,000 today?"*). Before market makers update their quotes to reflect Bitcoin's new price, existing "Yes" contracts on the order book may temporarily be underpriced.

However, trading this difference in real life is a race against time and market depth:
1. **Network & System Latency:** By the time your order reaches the market (e.g. after 500 ms), did someone else already take the cheap shares? Did the quote update?
2. **Order Book Depth:** If you want to buy 100 shares, are there actually 100 shares at the attractive price, or only 20? What will your average execution price be?
3. **Execution Limits:** What happens if the market closes right as your order arrives?

**BTC Market Lab** gives you an animated, deterministic sandbox to replay historical market conditions with millisecond precision and observe exactly why orders fill, partially fill, or miss.

---

## 🧠 Key Concepts for Beginners

| Term | What It Means | Simple Analogy |
| :--- | :--- | :--- |
| **Reference Move / Signal** | A fast price change on a liquid spot exchange (e.g. Binance BTC/USDT) exceeding a threshold (e.g. 9 bps = 0.09%). | Thunder: you see the lightning flash on Binance first. |
| **Binary Contract** | A market contract that settles to **$1.00** if an event happens (True) or **$0.00** if it doesn't (False). | A digital raffle ticket trading between $0.01 and $0.99. |
| **Ask / Offer** | The lowest price at which someone is currently willing to sell shares to you. | The sticker price on the store shelf. |
| **Order Delay (Latency)** | The delay between when the signal occurs and when your order physically arrives at the matching engine. | Shipping time: the difference between ordering online and arrival. |
| **Limit Price** | The maximum price you are willing to pay (e.g. $0.56). If the ask is higher, the order is rejected. | "I won't pay more than $0.56 for this." |
| **Order Book Depth** | The quantity of shares available at each price level (e.g. 24 shares at $0.54, 42 shares at $0.56). | Inventory on the shelves. |
| **Fill / Partial / Miss** | **Fill:** You got all requested shares. <br>**Partial:** Only some shares were available within your price limit. <br>**Miss:** The price was too high, liquidity was gone, or the market closed. | Buying groceries: getting everything, getting some, or store was sold out. |

---

## 🚀 Quickstart Guide

### Prerequisites
- **Python 3.11+** installed ([python.org](https://www.python.org/downloads/))
- **Git** installed ([git-scm.com](https://git-scm.com/))
- *(Optional)* **Node.js 20+** (only needed if you want to modify and rebuild the frontend)

### Installation & Launch

#### On Windows (PowerShell)
```powershell
# 1. Clone the repository
git clone https://github.com/MOULAYID/btc-market-lab.git
cd btc-market-lab

# 2. Create and activate a Python virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 3. Install backend dependencies
pip install -r requirements.txt

# 4. Run the application
powershell -NoProfile -ExecutionPolicy Bypass -File .\Run.ps1
```

*Alternatively, run Uvicorn directly:*
```powershell
python -m uvicorn server:app --host 127.0.0.1 --port 8765 --reload
```

#### On macOS / Linux (Bash)
```bash
# 1. Clone the repository
git clone https://github.com/MOULAYID/btc-market-lab.git
cd btc-market-lab

# 2. Create and activate a Python virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install backend dependencies
pip install -r requirements.txt

# 4. Start the server
python3 -m uvicorn server:app --host 127.0.0.1 --port 8765 --reload
```

Open your browser and navigate to:  
👉 **[http://127.0.0.1:8765/](http://127.0.0.1:8765/)**

---

## 🎓 Step-by-Step Beginner Tutorial

### Example 1: The Latency Race (100 ms vs 500 ms)

This bundled scenario illustrates how execution delay determines trading success.

1. In the top navigation bar, click **Replay**.
2. Make sure the scenario dropdown is set to **Latency race**.
3. Notice that **Run A** is configured with `delay = 100 ms` and **Run B** has `delay = 500 ms`.
4. Click the **"First difference"** button. The simulator jumps straight to the exact moment where the two runs diverge:
   - **At timestamp 2.500s:** A sudden upward move in BTC is detected on Binance. Signal `#49` is triggered to buy market `m0` ("Bitcoin above $67,500 today?") with an entry limit of **$0.56**.
   - **At timestamp 2.600s (Run A arrives after 100 ms):** The best ask on `m0` is still **$0.54** (24 shares available). Since $\$0.54 \le \$0.56$, Run A **Fills 20 shares @ $0.54**!
   - **At timestamp 2.740s:** A market event arrives; another participant buys out the cheap shares and the best ask jumps to **$0.59**.
   - **At timestamp 3.000s (Run B arrives after 500 ms):** The best ask is now **$0.59**. Since $\$0.59 > \$0.56$, Run B **Misses** (`No visible liquidity within limit`).
5. **Key Takeaway:** Run A and Run B saw the exact same initial signal, but Run B was 400 ms too slow and missed the fill completely.

---

### Example 2: Order Book Depth & Partial Fills

What happens if you want to buy more shares than are available at the top of the book?

1. In **Replay**, select **Visible depth** from the scenario list.
2. In this scenario, **Run A** orders **20 shares**, while **Run B** orders **80 shares** with a limit price of **$0.56**.
3. Let's look at the order book ladder at order arrival ($t = 2.600\text{s}$):
   - Level 1: Ask **$0.54** — 24 shares available
   - Level 2: Ask **$0.56** — 42 shares available
   - Level 3: Ask **$0.58** — 14 shares available
4. **Execution breakdown for Run B (80 shares):**
   - It takes all **24 shares at $0.54** ($24 \times 0.54 = \$12.96$)
   - It takes all **42 shares at $0.56** ($42 \times 0.56 = \$23.52$)
   - Total shares obtained = $24 + 42 = \mathbf{66\text{ shares}}$
   - Total cost = $\$12.96 + \$23.52 = \$36.48$
   - Weighted average price = $\$36.48 / 66 = \mathbf{\$0.5527}$
   - The remaining 14 shares cannot be filled because Level 3 is priced at **$0.58**, which exceeds our limit of **$0.56**.
5. **Outcome:** Run B receives a **Partial Fill of 66 shares @ avg $0.5527** with the reason `"Visible size or risk budget exhausted"`.

---

## 🖥️ Dashboard Features & Controls

```
┌──────────────────────────────────────┬──────────────────────────────────────┐
│  GLOWING MOVING NETWORK (Canvas)     │  COMPACT TELEMETRY PANEL             │
│                                      │                                      │
│  • Central Hub: Binance BTC/USDT     │  • Top KPI Banner: Cash, Equity,     │
│  • Outer Nodes: Prediction Markets   │    Fees, Realized & Unrealized P&L   │
│  • Glowing Edges: Signal pulses      │  • Order Book Depth Ladder           │
│  • Click node: Focus & pin telemetry │  • Real-Time Signal & Execution Log  │
└──────────────────────────────────────┴──────────────────────────────────────┘
│  TRANSPORT BAR: [Play/Pause] [▷│ Step] [Seek Slider] [Speed: 0.25x - 4x]     │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Visual State Indicators:**
  - 🔵 **Cyan Pulse:** Order book quote update.
  - 🟡 **Amber Beacon:** Trade signal triggered on BTC move.
  - 🟢 **Green Tag:** Paper order filled or partially filled.
  - 🔴 **Rose/Slate Tag:** Order missed (hover to see exact reason).
  - 🟠 **Orange Pill:** Disconnected / stale feed indicator.
- **Transport Bar:**
  - **Play / Pause (`Space`):** Run or pause replay simulation.
  - **Step (`▷│`):** Advance exactly one event or scheduled arrival at a time.
  - **Speed Selector ($0.25\times$ to $4\times$):** Speed up playback without affecting engine determinism or accounting calculations.
  - **Export JSON (`↓`):** Download full session recordings and telemetry for offline analysis.

---

## 📡 Live Paper Mode

Want to test against current real-world markets?

1. Click **Live Paper** in the top navigation bar.
2. Click **Start**. The simulator connects live to the **Binance WebSocket trade stream** (`btcusdt@trade`), updating real-time Bitcoin prices and calculating threshold moves.
3. *(Optional)* Paste a public **Polymarket market slug or URL** (e.g. `bitcoin-above-68000-on-december-31-2026`).
4. The dashboard streams live depth from Polymarket's CLOB WebSocket and simulates executions as price signals fire.
5. Click **Pause Paper Entries** to pause order submissions while keeping live feeds connected, or **Stop & Save** to persist the recording into the local SQLite database for replay.

> [!NOTE]
> **Strict Paper-Only Guarantee:** Live Paper mode connects only to public, read-only market data feeds. No private keys, wallet connections, or real capital are ever used.

---

## 🏗️ Project Architecture

```
btc-market-lab/
├── engine.py           # Core simulation engine: deterministic event queue, book depth,
│                       # quote freshness checks, fee models, and P&L accounting
├── server.py           # FastAPI backend: WebSocket connectors (Binance, Polymarket),
│                       # SQLite storage, and REST endpoints for comparison and live paper
├── test_engine.py      # Unit & regression test suite (12 tests covering edge cases)
├── requirements.txt    # Python dependencies (FastAPI, Uvicorn, WebSockets, Pydantic)
├── Run.ps1             # One-click Windows PowerShell startup script
├── src/                # Frontend source (React 18, TypeScript, Tailwind CSS)
│   ├── App.tsx         # Main UI application layout and routing
│   ├── components/     # UI components: Network graph canvas, telemetry, book depth
│   └── styles/         # CSS and styling rules
└── dist/               # Pre-built production frontend assets (served automatically)
```

### Key Engineering Features in `engine.py`
- **Zero Lookahead Bias:** Prevents optimistic fills caused by future-dated quotes or clock drift (`0 <= arrival - quote_time <= freshness`).
- **Liquidity Tracking Across Updates:** Consumed shares are decremented and carried forward across identical snapshots, preventing double-counted depth.
- **Strict Decimal Accounting:** All P&L, fees, and cost basis calculations adhere to Python `Decimal`, enforcing the identity:
  $$\text{Total Equity} \equiv \text{Cash} + \text{Cost Basis} + \text{Unrealized P&L} \equiv \$1,000 + \text{Realized P&L} + \text{Unrealized P&L}$$

---

## 🧪 Running the Test Suite

The test suite validates engine correctness across race conditions, stale books, partial fills, settlement payouts, and replay determinism:

```powershell
python -m unittest -v test_engine.py
```

Expected output:
```text
test_after_arrival_and_equal_time_ordering ... ok
test_close_at_arrival ... ok
test_close_none_and_after_close ... ok
test_delay_race_and_identical_recording ... ok
test_examples_and_dense_sequence ... ok
test_exit_and_settlement ... ok
test_future_quote_prevention ... ok
test_partial_disabled ... ok
test_pl_reconciliation_identity ... ok
test_repeated_orders_and_fees ... ok
test_seek_and_presentation_speed ... ok
test_stale_and_invalid ... ok

Ran 12 tests in 0.078s — OK
```

---

## 🔒 Safety & Scope

- **Paper Trading Only:** This project is purely an educational and quantitative research tool.
- **No Financial Advice:** Replay results and simulation outputs do not constitute trading advice or guarantees of live market profitability.
- **Sanctioned Public APIs Only:** Relies exclusively on public WebSocket feeds from Binance and Polymarket with graceful rate limiting and reconnect backoff.

---

## 📄 License

MIT License. Feel free to use, modify, and build upon this tool for your own research and quantitative analysis!
