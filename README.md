# BTC Market Lab

A local research terminal for comparing BTC/USDT reference moves with simulated executions against prediction market order books. Demo opens automatically with synthetic data. Live Paper uses public market data and executes only in the simulator.

## Windows PowerShell

Extract the zip and open PowerShell in the extracted project folder. The archive includes the built frontend. With Python 3.11+:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
powershell -NoProfile -ExecutionPolicy Bypass -File .\Run.ps1
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/). Press Ctrl+C to stop. Use `-Port 8766` on the launch command if 8765 is occupied. With the requirements and frontend already installed, Demo and Replay need no external connection.

To rebuild the React + TypeScript frontend after editing it, install Node.js 20+ and run:

```powershell
npm.cmd install
npm.cmd run build
.\.venv\Scripts\python.exe -m unittest -v
```

## Walkthrough

1. In **Demo**, watch the amber signal leave the BTC hub at 2.500 seconds. Select the highlighted $67,500 market and open **Paper Orders**. The first order fills at 2.600 seconds; a later order misses at 8.600 seconds. Open a row for its quote and arrival evidence. The loop resets the synthetic account.
2. Open **Replay**, choose **Latency race**, then **First difference**. Run A arrives after 100 ms and fills 20 shares at $0.54. Run B arrives after 500 ms and misses: its best ask is $0.59 against a $0.56 limit. Both runs consumed the same recording and use the same engine as Live Paper.
3. Pause, step, or seek with the shared transport. Use **Copy A → B**, then change a single setting. **Signal threshold** compares 9 bps against 11 bps. **Visible depth** compares 20 shares against 80; the larger order consumes 24 at $0.54 and 42 at $0.56, then misses the remainder. **Export JSON** saves both full simulations, the shared recording, and the current playhead.
4. In **Live Paper**, paste an active Polymarket market slug or HTTPS URL. The outcome selector maps to the market's published outcome order. The market card shows the outcome name and the book status. **Pause paper entries** leaves public feeds and pending simulation running. **Stop & save** ends the feeds and opens the recording in Replay. The SQLite database is local to the project unless `BTC_LAB_DB` points elsewhere.

## Sources and simulation

- [Binance Spot trade stream](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams): `wss://stream.binance.com:9443/ws/btcusdt@trade`. Trade price drives the signal; the WebSocket client responds to protocol pings.
- [Polymarket public market stream](https://docs.polymarket.com/market-data/realtime-data): `wss://ws-subscriptions-clob.polymarket.com/ws/market`. Subscribes by outcome token, sends text PING every 10 seconds, and applies snapshots and size updates. Disconnect or detected inconsistency invalidates the affected books until a fresh snapshot. Both feeds reconnect with bounded backoff.
- [Gamma market lookup](https://docs.polymarket.com/api-reference/markets/get-market-by-slug): `https://gamma-api.polymarket.com/markets/slug/{slug}`. [CLOB market info](https://docs.polymarket.com/api-reference/markets/get-clob-market-info) supplies fee parameters if available. When supported, the [published taker formula](https://docs.polymarket.com/trading/fees) is applied. Otherwise the configurable basis-point assumption applies to simulated notional. The fee model is recorded per order.
- SQLite stores normalized market events with monotonic elapsed milliseconds, UTC receive time, venue timestamp when present, and a sequence number. At equal elapsed milliseconds, input events are applied in sequence before scheduled arrivals, then arrivals in submission order. Replay controls advance in source sequence and step separately to arrival times. Changing playback speed does not change accounting.
- An upward move is compared with the latest reference trade at or before the lookback boundary. The baseline buys the watched outcome; choose the outcome that matches the hypothesis you want to test. Each buy needs a valid, fresh quote within the limit. Pending orders keep their configuration. A timed exit places a sell IOC with a $0.01 floor after the hold time plus configured order delay. A missed sell is not retried automatically.
- Positions start against $1,000 paper cash. Decimal accounting consumes only eligible visible displayed size, carries consumed size across unchanged levels, and enforces cash, exposure, and current session equity loss checks. A resnapshot starts a new liquidity epoch after an invalidation; cancellations and replenishment within a continuous level can be indistinguishable. Real orders can face competition and additional venue delays, so the paper fills are an estimate.
- Unrealized P&L estimates use an available fresh bid; an unavailable mark is shown separately and carried at cost in account totals. Only a published market resolution event with a winning token settles the supported binary payout. Missing resolution events and unsupported payout forms remain unresolved. Gamma end time serves as a conservative execution cutoff.
- Live settings and entry pause changes are recorded at their event boundary. A/B Replay deliberately applies each run's chosen settings to the same saved market events. This lets a fixed configuration be tested over the whole recording.

## Verification

- Production Vite build and nine simulator tests passed. Tests cover ask disappearance, equal-time ordering, late updates, book invalidation and fresh resync, close at arrival, liquidity consumption, partial fills, fees, exits, settlement, and deterministic replay.
- Desktop browser: verified Demo motion, market selection, filled and missed order evidence, all three comparison scenarios, pause, event step, and unchanged results after switching playback speed. Checked 1024×768 and 768×1024 browser viewports for iPad landscape and portrait. These were viewport checks on Windows, not tests on iPad hardware.
- 50 market fixture: 2,753 recorded inputs over 22 seconds, including 2,703 trades and books (about 123 market updates/sec at 1×, or 491/sec of recording time traversed at 4×). The browser rendered 50 nodes and completed 4× playback. The engine check found no missing sequence IDs. Canvas frame rate and individual visual pulse drops were not instrumented; updates are intentionally coalesced for display.
- Live smoke test: Binance trades and a valid book for **one** Polymarket outcome, the Up token for `bitcoin-up-or-down-on-november-17-2026`. A final short run captured 26 trades and two valid book events after both feeds connected. No actual orders were placed. The CLOB info lookup returned HTTP 403 for the smoke market; fee calculation therefore used the displayed assumption. Live multi-market load, interrupted-connection recovery against the actual venues, and live settlement were not verified.
