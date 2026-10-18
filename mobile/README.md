# Trading Command — Mobile

A native mobile client for the Trading Command terminal. It is a **pure API client**:
it talks to the same Next.js backend the desktop app uses and adds nothing to the
server. No file in the parent repository is modified by this package.

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
cd mobile
npm install                 # already done in this checkout
npx expo start             # then press "a" for Android, "i" for iOS, or scan the QR code
```

A physical device needs the backend to be reachable from the phone: use your
machine's LAN address (`http://192.168.x.x:3000`) or a deployed URL — not
`localhost`, which on a phone means the phone itself.

### Checks

```bash
npm run typecheck   # tsc --noEmit over the whole app
npm run test:pine   # 18 tests for the Pine runtime
npm run test:api    # 7 tests for the API client against a mock server
npm test            # all of the above
```

---

## How it fits together

```
mobile/
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
stdev/range/median/percentile/sum/cum/abs/...`, `math.*`, `nz`, `na`, `var`,
`if/else`, `for`, `while`, ternary, boolean operators, user functions, series
history (`close[1]`), and the standard strategy calls (`strategy.entry`,
`strategy.exit`, `strategy.close`, `strategy.cancel`, `strategy.close_all`).

Strategy semantics match TradingView's defaults: an order fills on the **next**
bar, limit and stop orders fill against the bar range and stay pending if the
bar never touches them, `strategy.exit` stop and target are checked every bar
(a bar that touches both is treated as hitting the stop first), reversals close
the opposite position first, pyramiding is one entry, and any position still
open at the end of the data is closed at the last close.

What is **not** supported yet: `request.security`, `array.*` / `matrix.*` /
`map.*` collections, `switch`, `varip`, and the drawing-object family
(`line.new`, `label.new`, …). Unsupported calls are reported as a runtime
warning on the screen rather than crashing the app.

Send the script you actually use and it will be added to the runtime with a
regression test in `src/pine/__tests__/pine.test.ts`.

### The chart bridge

`src/chart/chartHtml.ts` builds a self-contained HTML page: the bundled
`lightweight-charts` build is inlined, so the WebView never reaches out to a
CDN. React calls `window.__tcChart.setData(json)` with candles, line overlays,
price lines (support/resistance) and series markers (signals, Pine trades);
crosshair moves are posted back to React.

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
