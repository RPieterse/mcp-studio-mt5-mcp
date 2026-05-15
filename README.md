# MetaTrader 5 MCP

An MCP server for [MCP Studio](https://github.com/RPieterse/mcp-studio) (or any MCP-compatible host) that lets an agent **trade through a MetaTrader 5 terminal**. Position sizing is computed from account balance, stop distance, and a risk percent — so the natural way to ask is the way it works:

> "Place a 1:4 market buy in EURUSD with a 10 pip stop loss and risk 1% of the account."

The agent calls `place_risk_order(symbol="EURUSD", side="buy", stop_loss_pips=10, risk_reward_ratio=4, risk_percent=1)`. The MCP reads the live balance + symbol pricing, computes lot size so a stop-out loses exactly 1% of balance, sets the take profit at 4× the stop distance, and submits the order.

> ⚠️ **This MCP can place real trades on your real broker account.** Test against a demo account first. Use `dry_run: true` when wiring up new prompts. The authors are not responsible for losses caused by misuse, broker quirks, or unexpected agent behavior. Read the *Safety* section before using it on a live account.

## Tools

| Tool | What it does |
|---|---|
| `account_info()` | Balance, equity, margin, leverage. |
| `symbol_info(symbol)` | digits, point, tick_size, tick_value, contract_size, volume bounds, bid, ask. |
| `get_positions(symbol?)` | List open positions, optionally filtered. |
| `place_market_order(symbol, side, volume, sl?, tp?, comment?)` | Direct market order with an explicit lot size. |
| `place_risk_order(symbol, side, stop_loss_pips, risk_reward_ratio, risk_percent, dry_run?)` | The high-level entry. Computes lots so SL = `risk_percent` of balance, sets TP at `risk_reward_ratio` × SL distance. `dry_run: true` returns the plan without placing the order. |
| `close_position(ticket)` | Close by ticket. |
| `modify_position(ticket, sl?, tp?)` | Update SL/TP on an open position. |

### Quick commands

| Trigger | Action |
|---|---|
| `/mt5_account` | Show balance, equity, and margin. |
| `/mt5_positions` | List open positions on the default symbol. |
| `/mt5_plan` | Dry-run a 1:2 buy on the default symbol, 10-pip SL, default risk %. |

The "default symbol" and "default risk percent" are stored per-MCP and editable in Studio's MCP settings (default: `EURUSD`, `1%`).

## How it works

```
agent ──MCP stdio──▶ Node TS server ──stdin/stdout JSON──▶ Python (MetaTrader5 lib) ──▶ MT5 terminal
```

- Node owns the MCP protocol surface and risk math (testable in vitest).
- Python owns terminal I/O via the official `MetaTrader5` package.
- The Python child is long-lived: spawned once on MCP startup, kept alive for the session, and shut down on SIGINT/SIGTERM.

## Prerequisites

You need an MT5 terminal **and** a Python interpreter that can `import MetaTrader5`. The `MetaTrader5` Python package is Windows-only — it loads the terminal's DLLs directly.

- **Windows:** install MT5, then `pip install MetaTrader5`. Done.
- **macOS / Linux:** run MT5 inside Wine (PlayOnMac, CrossOver, etc.) and install `MetaTrader5` into the Wine prefix's Python. Set `MT5_PYTHON` to that interpreter path.

If the terminal is already logged in, you don't need to pass credentials — the MCP attaches to the running session. If it isn't, supply `MT5_LOGIN`, `MT5_PASSWORD`, `MT5_SERVER` (the manifest collects these securely).

## Install in MCP Studio

From the MCP Studio prompt panel:

```
/install https://github.com/RPieterse/mcp-studio-mt5-mcp
```

…or install from a local clone:

```
/install /path/to/mcp-studio-mt5-mcp
```

Studio will prompt for:

- **Python interpreter** — e.g. `/usr/local/bin/python3` (or your Wine-prefix python on macOS).
- **Terminal path** *(optional)* — path to `terminal64.exe` if you have multiple MT5 installs.
- **Login / password / server** *(optional)* — only if the terminal isn't already logged in.

Then say "show my MT5 balance" or "place a 1:3 buy on USDJPY with a 20 pip stop, risk 0.5%".

## Position sizing — what the math actually does

`place_risk_order` runs this on every call:

```
pip_size       = 0.0001 for 5-digit forex, 0.01 for 3-digit JPY, 10 × point otherwise
sl_distance    = stop_loss_pips × pip_size
loss_per_lot   = (sl_distance / tick_size) × tick_value          // account-currency PnL per 1.0 lot
risk_amount    = balance × (risk_percent / 100)
raw_volume     = risk_amount / loss_per_lot
volume         = round_down_to(volume_step, clamp to [volume_min, volume_max])
tp_distance    = sl_distance × risk_reward_ratio
entry          = ask (buy)   |   bid (sell)
sl             = entry − sl_distance (buy)   |   entry + sl_distance (sell)
tp             = entry + tp_distance (buy)   |   entry − tp_distance (sell)
```

`tick_value` comes from the live `symbol_info`, so it handles cross-currency conversion correctly (XAUUSD, USDJPY in a EUR account, etc.) as long as the broker reports it accurately.

## Local development

```bash
npm install
npm run build
npm test
```

The vitest suite covers the risk math and tool dispatch against a mock `Mt5Api` — no terminal needed. To iterate live against MT5 Studio:

```bash
npx tsc --watch
```

## Safety

- Every `place_risk_order` accepts `dry_run: true`. Use it when wiring up new prompts.
- The MCP refuses to submit if the computed volume after rounding is ≤ 0 (e.g. stop too tight or balance too low).
- Stops and targets are sent **with the order**, not after — so a network blip between order and SL set can't leave an unprotected position.

## Permissions declared

```
secrets: mt5_credentials
```

No filesystem or network sandbox declared — the Python child talks to MT5 over the terminal's local IPC and (when not pre-attached) to the broker's MT5 server over the broker's protocol.

---

## License

MIT.
