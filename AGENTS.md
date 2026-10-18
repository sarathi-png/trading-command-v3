# Trading Command — mobile app

This repository is a **self-contained Expo/React Native client** for the Trading
Command terminal (`sarathi-png/trading-command-v3`), which is a separate project.
Read this before changing anything here.

## Hard rules

* **Never modify the server repository.** The server is a finished product; the
  mobile app is a client of its existing `/api` routes. If the app needs
  something the server does not expose, add it to the app, not to the server.
  Nothing in this repository may change the server's behaviour, and the server
  is never edited from here.
* **The server is the safety boundary.** Never work around a server gate in the
  client: no client-side "force live", no retry of an order whose outcome the
  server reported as unknown, no paper order sent while the live workspace is
  selected. If a gate blocks the user, show the gate.
* **Do not invent data.** A failed market request is an error, not a stale or
  simulated price. The demo simulator is used only when the server's data
  source is explicitly `demo`.

## Layout

```
app/            expo-router screens (root-level `app/`, not `src/app/`)
  (tabs)/       the five tabs
src/
  api/          the only place that talks to the server
  state/        zustand stores
  chart/        Lightweight Charts WebView + bridge
  components/   the UI kit
  pine/         the Pine Script runtime
```

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm run test:pine   # the Pine runtime tests
npm run test:api    # the API client tests
npm test            # everything
npx expo start      # the dev server
```

**Do not run `npx expo install`.** It fails in this environment (the React
Native Directory is unreachable over TLS) and it also tries to reinstall
`react-dom` at a version that breaks the peer dependency. To add a native
module, read the version from `node_modules/expo/bundledNativeModules.json`
and install it with `npm install --legacy-peer-deps`.

## The Pine runtime

`src/pine/` is an interpreter, not a formatter. Three rules to keep it honest:

1. **One source of truth for state.** `ta.*` and `strategy.*` are stateful and
   keyed by their parse-time call site, so a function called twice does not
   share a moving average. New stateful builtins must follow that pattern.
2. **Errors are values.** A script that fails to parse or hits an unsupported
   call returns errors in the result — it never throws out of `runPine`. The
   chart screen renders them.
3. **TradingView semantics.** Orders fill on the next bar, a bar that touches
   both a stop and a target is treated as hitting the stop first, reversals
   close the opposite position first, and an open position is closed at the
   last close of the data. New strategy behaviour must match, and be covered
   by a test in `src/pine/__tests__/pine.test.ts`.
4. **The user's script is the acceptance test.**
   `src/pine/scripts/confluence.ts` is the "Crypto Confluence Signals [8x]"
   indicator, verbatim. It must always run without errors, and it is covered
   by `src/pine/__tests__/confluence.test.ts`. A change that makes that script
   fail is a regression, not a new limitation.

## Drawings

`box.*`, `label.*` and `table.*` create live objects inside the runtime; after
the run they are normalised (`src/pine/drawings.ts`) into plain data with bar
times and prices, and the chart page draws them in an HTML overlay
(`renderDrawings` in `src/chart/chartHtml.ts`). Keep the runtime side free of
chart concerns: it hands over data, the chart page turns it into pixels.

## Charts

The chart library is bundled at
`assets/charts/lightweight-charts.standalone.production.txt` and inlined into
the WebView page. Do not point the WebView at a CDN — the chart has to work
without a network, and the inlined copy is what makes that true. After
upgrading `lightweight-charts`, copy the new standalone build over that file.

The file is a **text asset on purpose**: Metro treats `.js` as a source
extension, and this library assigns to `window`, so it must not be executed in
the React Native runtime. `metro.config.js` registers `txt` as an asset
extension. Renaming it to `.js` would silently break the chart.

## Authentication

The app authenticates with `Authorization: Bearer <API_PASSWORD>` and always
sends `X-TC-Workspace: paper|live`. The password lives in
`expo-secure-store`; the server URL and workspace live in AsyncStorage. The
app must never store CoinDCX credentials — the server signs those requests
itself.
