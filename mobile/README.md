# Trading Command — Mobile

A native mobile client for the Trading Command terminal
([`sarathi-png/trading-command-v3`](https://github.com/sarathi-png/trading-command-v3)).
It is a **pure API client**: it talks to that server's existing `/api` routes and
adds nothing to it. This repository is self-contained — the server is a separate
project and is never modified from here.

Two things make it more than a thin wrapper:

1. **A Pine Script runtime ships inside the app.** You paste a TradingView Pine
   script into the app; it is parsed and evaluated on the phone over the live
   candles, and its plots, shapes, alerts and simulated strategy trades are drawn
   on the mobile chart. No rebuild, no server round-trip.
2. **The chart is the real chart.** Lightweight Charts runs in a WebView with a
   local copy of the library, so it works with no network access of its own.

---

## Running it

```bash
git clone https://github.com/sarathi-png/trading-command-mobile.git
cd trading-command-mobile
npm install                 # already done in this checkout
npx expo start             # then press "a" for Android, "i" for iOS, or scan the QR code
```

A physical device needs the backend to be reachable from the phone: use your
machine's LAN address (`http://192.168.x.x:3000`) or a deployed URL — not
`localhost`, which on a phone means the phone itself.

### Running it in a browser (development)

The real backend needs Postgres and exchange credentials, so a **mock backend**
ships with the app for development:

```bash
npm run web:serve      # builds the web bundle and serves it with the mock API
```

Then open the printed address, sign in with

* **Server** — the same address the page is served from (the API is same-origin)
* **Password** — `demo`
* **Workspace** — paper

The mock (`tools/mock-server.mjs`) serves the same routes as the real server
with deterministic synthetic candles, so every screen can be clicked through.
It holds no credentials and never talks to an exchange. The server lives in
`trading-command-v3`; this mock is a development stand-in for it, not a copy
of it.

The web build is a development convenience, not a supported deployment:
`react-native-webview` has no web implementation, so the chart is hosted in an
iframe there (`src/chart/ChartView.web.tsx`) and the operator password is kept
in local storage instead of the device keystore. The device build is the
supported one.

### Checks

```bash
npm run typecheck   # tsc --noEmit over the whole app
npm run test:pine   # 23 tests for the Pine runtime
npm run test:api    # 7 tests for the API client against a mock server
npm run test:chart  # 4 tests for the chart page
npm test            # all of the above
```

---

## How it fits together

```
trading-command-mobile/
  app/                     expo-router screens
    _layout.tsx            root stack, session restore
    index.tsx              the gate: saved session → workspace, otherwise sign-in
    login.tsx              server address, operator password, workspace
    (tabs)/                overview · chart · markets · positions · more
    order.tsx              order ticket (paper + live), presented as a modal
    pine.tsx               the Pine script editor and runner
    journal.tsx            closed-trade journal
    settings.tsx           connection, workspace, data source, live arming
  src/
    api/client.ts          every call to the backend, in one place
    api/types.ts           mirror of the backend's domain types
    state/                 zustand stores: session, Pine scripts, async resources
    chart/                 Lightweight Charts WebView and its bridge
    components/ui.tsx      the shared UI kit
    pine/                  the Pine Script runtime (lexer → parser → evaluator)
      scripts/             scripts that ship with the app
  assets/charts/           the bundled chart library, for offline use
```

### Authentication

The backend issues an httpOnly session cookie, which JavaScript in a WebView
cannot read. React Native has no cookie jar either, so the app uses the
credential the backend already accepts for scripts:

```
Authorization: Bearer <API_PASSWORD>
X-TC-Workspace: paper | live
```

The password is kept in the device keystore (`expo-secure-store`) and deleted on
sign-out. The app never holds exchange credentials — the server still signs
every CoinDCX request itself.

Every workspace-scoped call carries `X-TC-Workspace`, so paper and live keep
their separate settings, risk limits and account views, and the app always knows
which one it is talking to.

### The Pine runtime

`src/pine/` is a self-contained interpreter:

| File | Role |
| --- | --- |
| `lexer.ts` | tokens, indentation, line/column tracking |
| `ast.ts` | the node types |
| `parser.ts` | indentation-aware recursive-descent parser |
| `values.ts` | the value model (series, scalars, `na`) |
| `ta.ts` | `ta.*` — stateful, keyed by call site |
| `builtins.ts` | `math.*`, `input.*`, `plot*`, `alert*`, `strategy.*` |
| `strategy.ts` | the order simulator |
| `evaluator.ts` | the per-bar evaluator |
| `index.ts` | `runPine(source, bars, options)` |

Supported today: `indicator` / `strategy` declarations, `plot`, `plotshape`,
`plotchar`, `alert` / `alertcondition`, `input.*` (with in-app overrides),
`ta.sma/ema/rma/wma/atr/tr/crossover/crossunder/highest/lowest/changes/vwap/
stdev/range/median/percentile/sum/cum/abs/pivothigh/pivotlow/barssince/
valuewhen/supertrend/dmi/sar/...`, `math.*`, `nz`, `na`, `var` / `varip`,
`if/else if/else`, `for`, `while`, `break` / `continue`, ternary, boolean
operators, user functions, tuple destructuring, series history (`close[1]`),
user `type` declarations with `X.new()`, Pine arrays (`array.new<T>()` and its
methods), the drawing family (`box.*`, `label.*`, `table.*`), and the standard
strategy calls (`strategy.entry`, `strategy.exit`, `strategy.close`,
`strategy.cancel`, `strategy.close_all`).

Pine idioms that are easy to get wrong are implemented on purpose: `not na(x)`
is true when the value is present, `na(x)` returns the value itself, `array`
elements keep their object identity (so `z.top := v` mutates the zone), and a
user type may be used in a declaration wherever it appears in the file.

Strategy semantics match TradingView's defaults: an order fills on the **next**
bar, limit and stop orders fill against the bar range and stay pending if the
bar never touches them, `strategy.exit` stop and target are checked every bar
(a bar that touches both is treated as hitting the stop first), reversals close
the opposite position first, pyramiding is one entry, and any position still
open at the end of the data is closed at the last close.

What is **not** supported yet: `request.security` (other than the chart's own
timeframe), `matrix.*` / `map.*` collections and `switch`. Unsupported calls are
reported as a runtime warning on the screen rather than crashing the app.

Send the script you actually use and it will be added to the runtime with a
regression test in `src/pine/__tests__/pine.test.ts`.

### The script this app was built for

`src/pine/scripts/confluence.ts` holds the **Crypto Confluence Signals [8x]**
indicator verbatim. It is a v6 indicator with 39 inputs, seven confluence
votes, support/resistance zones, a stop/target pair, signal labels and an info
table — and it is the app's regression fixture
(`src/pine/__tests__/confluence.test.ts`), so the runtime cannot break it
without a test failing. It ships as the first example script, so it is in the
script list on a fresh install.

### The chart bridge

`src/chart/chartHtml.ts` builds a self-contained HTML page: the bundled
`lightweight-charts` build is inlined, so the WebView never reaches out to a
CDN. The library is shipped as a **text asset**
(`assets/charts/lightweight-charts.standalone.production.txt`), not as a module:
it is browser JavaScript that assigns to `window`, so it must never run inside
the React Native runtime. React calls `window.__tcChart.setData(json)` with candles, line overlays,
price lines (support/resistance), series markers (signals, Pine trades) and the
script's drawings; crosshair moves are posted back to React.

The drawings (`box.new`, `label.new`, `table.new`) are DOM elements in an
overlay above the chart: the page converts their bar times and prices into
chart coordinates, so a support/resistance zone, a "BUY 6/7" label or the info
table lands exactly where Pine would draw it. The overlay is redrawn whenever
the visible range changes.

---

## Safety

The app is a client, so every gate stays where it belongs — on the server:

* A live order needs `LIVE_EXECUTION_ENABLED=true`, the live workspace,
  `liveArmed` in the settings profile, and valid CoinDCX credentials. The app
  surfaces each of these instead of pretending they are satisfied.
* The server re-checks risk limits, the daily loss it can actually prove, and
  the order value. An order that cannot be proven is blocked.
* `reduce_only` is not supported by CoinDCX; the app closes positions with
  `POST /api/positions/close` instead.
* An uncertain live outcome is never retried automatically — the server answers
  `409 ORDER_STATUS_UNKNOWN`, and the app shows that rather than resubmitting.
* The paper workspace cannot reach the live order routes, and the live
  workspace cannot reach the paper engine. The app states the workspace in a
  banner on every screen that can move money.

## Offline behaviour

The app is a client, so it says so rather than inventing data: a failed market
request is reported as an error, never as a stale or simulated price. The demo
simulator is only used when the server's data source is explicitly set to
`demo`.
