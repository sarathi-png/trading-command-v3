# MOBILE-001 — Implementation plan (rev 2)

- **Status:** BACKEND PHASE COMPLETE (B1–B4 committed). App phase (T1–T8) not started.
- **Branch:** `mobile-app` (from `master` @ `0128278`). Never `master`.
- **Spec:** `.opencode/plans/MOBILE-001.md` · **Constraints:** `.opencode/plans/TCV3-001.md`
- **Config:** `allow_production_deploy=false`, `max_review_cycles=3`
- **Date:** 2026-10-20
- **Revision log:** rev 1 → rev 2 adopts the `check` + `simplify` reviews (see §7).

---

## 0. Confirmed decisions

| # | Decision | Choice | Consequence |
|---|---|---|---|
| 1 | Repository layout | `apps/mobile` in this repo, **not** an npm workspace | Shared TS types are reachable; root `tsconfig`, ESLint and Vercel must exclude `apps/**` |
| 2 | Pine v1 scope | Webhook signal inbox → user-confirmed paper order | Pine is **never executed**. The subset translator is deferred to M3/v2 |
| 3 | Mobile auth | Bearer signed-session token from `POST /api/auth/mobile` | Password is sent once, never stored; token in `expo-secure-store`; 12 h TTL, re-login on expiry |
| 4 | Push | None in v1 | Foreground polling + unread badge only. Expo push is M4 and must not be claimed as done |

### Non-negotiable rules carried into every task

1. No live order without `LIVE_EXECUTION_ENABLED=true` + `mode=live` + `liveArmed=true` + credentials + explicit confirmation.
2. Paper is the default path. The **server default mode is `read_only`**, so the app must show mode and require an explicit `PAPER` switch before any ticket is enabled.
3. `API_PASSWORD` never enters the bundle, logs, crash reports or SecureStore. Only the derived session token is stored.
4. No fabricated prices/news/macro. Missing or stale renders as `unavailable` / `stale`.
5. Webhook → signal only. The webhook never places an order, paper or live.
6. No production deploy in this run.

---

## 1. Target layout

```
Trading_V3/
  src/…                      # existing Next.js app (unchanged runtime)
  apps/mobile/
    app/                     # expo-router routes
    src/api/client.ts        # REST client, bearer auth, timeout, error envelope
    src/api/types.ts         # API response types (first: copy from src/lib/types.ts)
    src/auth/session.ts      # SecureStore read/write/clear, expiry check
    src/state/               # workspace + query state
    src/components/          # badges, tickets, lists
    app.json / eas.json / tsconfig.json / package.json
  packages/shared/           # later: extracted types. Not in v1.
```

### Monorepo hygiene (required in the bootstrap task)

The root `tsconfig.json` includes `**/*.ts(x)` and `npm run lint` runs `eslint .`.
Without excludes the web typecheck and lint start checking Expo code.

- root `tsconfig.json` → `"exclude": [..., "apps"]`
- root `eslint.config.mjs` → `globalIgnores([..., "apps/**"])`
- add `.vercelignore` with `apps/` so mobile sources are not uploaded to the web deployment
- **no** npm `workspaces` field: a root install must not pull React Native/Expo into the Vercel web build. `apps/mobile` keeps its own lockfile and is installed with `npm --prefix apps/mobile install`.

---

## 2. Backend changes (this phase)

Four additive changes. No existing response key changes, no migration.

### B1 — Login throttling (new, from review)

Both login endpoints are public password oracles. `API_PASSWORD` is meant to be a long random value, but a second, faster oracle is not free.

- `src/lib/authRateLimit.ts` (new): fixed-window failure counter per client IP, 10 failures / 15 min → `429` with `Retry-After`. In-process only (documented best-effort on Vercel).
- `POST /api/auth/login` and `POST /api/auth/mobile`: reject a body > 4 KiB, throttle before parsing, record a failure on a wrong password, clear the counter on success. Never log the attempted value.
- Success must reset the counter, so a legitimate operator cannot lock themselves out after a typo followed by a correct login.

### B2 — Mobile bearer session auth

| Item | Change |
|---|---|
| `POST /api/auth/mobile` (new) | Verifies the password, returns `{ token, expiresAt }` from the existing `signSession`. No cookie. `Cache-Control: no-store`. 503 unconfigured / 400 malformed / 401 wrong password / 429 throttled. |
| `src/lib/auth.ts` | `isAuthenticated` accepts `Authorization: Bearer <signed-session>` **always**, not only when `EMBEDDED_PREVIEW_COOKIES=true`. Password bearer and cookie paths unchanged. |
| `src/proxy.ts` | `/api/auth/mobile` added to `PUBLIC_API`; a **session bearer** is subject to the same workspace rule as a cookie browser (`/api/settings` exempt); a **password bearer** keeps today's behaviour so scripts and existing tests are unaffected. |

Why the workspace rule stays (review conflict, `check` wins): with a cookie, `proxy.ts` already forces `x-tc-workspace`, and that is what keeps paper requests out of `/api/orders` and live requests out of `/api/paper`. A new bearer path that skipped it would let the mobile client declare no workspace and quietly bypass the separation. The live chain still blocks real orders, but the guard must not weaken. Cost is one `verifySession` on bearer requests.

**Token contract:** `v1.<expiresAtMs>.<hex-hmac>` (existing `signSession`). Opaque to the app. Any `401` → clear storage and show login. No refresh endpoint in v1. Deployments **must set `SESSION_SECRET` separately from `API_PASSWORD`**: the token is signed with `SESSION_SECRET`, which falls back to `API_PASSWORD`, and a captured token would otherwise leak offline verification material about the password itself.

### B3 — Webhook payload validation and normalization

The webhook currently stores `0` when a real alert sends `"price": "64123.5"`, accepts any string as a timeframe, and compares the secret with `!==`.

- Constant-time secret comparison (`timingSafeEqual`).
- Numbers and numeric strings both accepted for `price`/`entry`/`stop`/`target`. Empty/null counts as absent. Non-finite or `<= 0` is rejected — never stored as `0`.
- `price` is **required and positive for every action**, including `WATCH`. Storing an invented `0` is worse. `docs/WEBHOOKS.md` states the alert template must include `{{close}}` and that a rejected alert is lost (TradingView does not retry).
- Symbol normalized: uppercase, leading `EXCHANGE:` stripped, must match `^[A-Z0-9._-]{2,30}$`.
- Timeframe normalized from TradingView `{{interval}}`: `1/3/5/15/30/60/120/240` → `1m/3m/5m/15m/30m/1H/2H/4H`, `D`/`1D` → `1D`, `W`/`1W` → `1W`. Absent → `15m`. Unmappable → 400 (never relabel another interval's data).
- `strategy` sanitized to `[A-Za-z0-9._:-]`, max 64; `message` truncated to 500.
- Parsing extracted to `src/lib/integrations/tradingview/payload.ts` so it is unit-testable without a database.

### B4 — Webhook idempotency by deterministic signal id

The per-instance `seen` Map cannot dedupe across Vercel instances; a retried alert creates two inbox rows and therefore two different `client_order_id`s on two taps.

- `src/lib/signalId.ts` (new): `deterministicUuid(input)` — SHA-256 → 16 bytes → UUIDv5-shaped string via Web Crypto.
- Webhook id = `deterministicUuid("tv:" + strategy + ":" + symbol + ":" + action + ":" + ts)`.
- `Repo.insertSignalOnce(value & { id: string }): Promise<{ row, created }>` (new method):
  - `postgres.ts`: `insert … onConflictDoNothing({ target: id }).returning()`, then select the existing row by id.
  - `file.ts`: check-and-insert inside the existing per-document mutex (same pattern as `insertPaperOrder`; single-process only, as documented for that backend).
- The `seen` Map is deleted. The DB primary key is the single source of truth.
- Strategy-engine signals keep random ids and keep calling `insertSignal` — no type changes to `SignalInsert`.

Why not a `source_key` column: review showed a migration + schema + both backends for the same guarantee. The primary key already provides uniqueness, is indexed, and needs no Neon migration ordering.

---

## 3. Milestones and acceptance criteria

### M0 — Bootstrap + auth (no trading)

- [ ] Root typecheck/lint/build still pass with `apps/mobile` present (excludes correct).
- [ ] `apps/mobile` builds for iOS and Android in Expo Go / simulator.
- [ ] App opens on a **login** screen; password is entered, sent to `/api/auth/mobile`, token stored in SecureStore, password variable discarded.
- [ ] Cold start with a valid token lands on the home screen without re-entry; expired/tampered token clears storage and returns to login.
- [ ] `GET /api/health` and `GET /api/system` render backend + capabilities.
- [ ] Workspace selector defaults to **Paper**; every non-settings request sends `x-tc-workspace`.
- [ ] Ticker list renders `provider`, `asOf`, and a visible `stale` badge. A failed fetch renders "unavailable", never `0`.
- [ ] Logout clears SecureStore and pops to login.

### M1 — Paper trading

- [ ] Mode is read from `/api/settings`; ticket is disabled unless mode is `paper`, with the server's reason shown.
- [ ] Positions and paper orders list with P&L; closed trades appear in `/api/journal` and `/api/analytics`.
- [ ] Paper ticket requires explicit review-and-confirm; `client_order_id` is generated once per ticket and reused on retry.
- [ ] A duplicate submit returns the original order (no second fill).
- [ ] Live order entry is not rendered at all. When `LIVE_EXECUTION_ENABLED=false`, the UI states live is unavailable — it does not show a button that later arms.
- [ ] Closing a position requires confirmation and shows the server's resulting events.

### M2 — Pine signal inbox

- [ ] `GET /api/signals` list with symbol, action, timeframe, price, age; newest first.
- [ ] Unread badge from foreground polling; no push permission prompt.
- [ ] One tap → paper ticket prefilled with symbol/entry/stop/target from the signal, still requiring confirmation.
- [ ] Paper order uses `client_order_id = "sig:" + signalId` (matches `isValidClientOrderId`), so repeat taps dedupe.
- [ ] A retried webhook produces one row (`deduplicated: true`), verified end-to-end.
- [ ] The app never auto-places from a signal and never offers a live trade from the inbox.
- [ ] Price is always a real positive value or the alert was rejected; the inbox cannot show `0`.

### M3 — Deferred (documented, not v1)

Pine subset translator (`ema`/`sma`/`rsi`/`atr`/`cross`/`plot`/`longCondition`) into `src/lib/indicators.ts`, translated overlays, journal markers, and the candle chart. Unsupported syntax must fail with a clear message, never approximate. M4: Expo push, biometrics, offline cache.

---

## 4. Task split

### 4.1 Backend tasks (this phase, sequential)

| ID | Task | Files | Acceptance | Verify |
|---|---|---|---|---|
| **B1** | Login throttling | `src/lib/authRateLimit.ts` (create), `src/app/api/auth/login/route.ts`, `src/lib/auth.test.ts`, `tsconfig.auth.json`, `tests/paper-api.test.mjs` | 10 failures → 429 + `Retry-After`; success clears the counter; expired window clears; body > 4 KiB rejected; no attempted value logged | `npm run typecheck`, `npm run test:auth`, `npm run test:paper` |
| **B2** | Mobile bearer session | `src/lib/auth.ts`, `src/app/api/auth/mobile/route.ts` (create), `src/proxy.ts`, `src/lib/auth.test.ts`, `tests/paper-api.test.mjs` | Session bearer accepted outside preview mode; expired/tampered/wrong-secret rejected; cookie and password bearer unchanged; unconfigured refuses all; **matrix:** session bearer without workspace → 428, session bearer + `paper` on `/api/orders` → 403, password bearer without workspace → 200, `/api/settings` exempt; `/api/auth/mobile` returns a token and no `Set-Cookie` | `npm run typecheck`, `npm run test:auth`, `npm run test:paper` |
| **B3** | Webhook payload validation | `src/lib/integrations/tradingview/payload.ts` (create) + test (create), `src/app/api/integrations/tradingview/webhook/route.ts`, `docs/WEBHOOKS.md`, `tsconfig.safety.json`, `package.json` | Numeric strings accepted for price/entry/stop/target; `0`, `-1`, `"abc"`, missing price → 400; interval `60` → `1H`; `BINANCE:BTCUSDT` → `BTCUSDT`; unmappable interval → 400; oversized strategy/message bounded; secret compared in constant time | `npm run test:safety`, `npm run typecheck` |
| **B4** | Deterministic signal id | `src/lib/signalId.ts` + test (create), `src/lib/repo/{types,postgres,file}.ts`, webhook route, `tests/paper-api.test.mjs` | Same alert twice → one row, second response `deduplicated: true` with the same `signalId`; different timestamp → two rows; strategy signals unaffected; no `seen` Map | `npm run test:safety`, `npm run test:paper`, `npm run typecheck` |

Integration contract for B1–B4:

```
- New endpoint: POST /api/auth/mobile -> 200 {token, expiresAt} | 400 | 401 | 429 | 503
- Auth: Authorization: Bearer <signed-session> accepted on /api/* (public set unchanged + /api/auth/mobile)
- Header: session-bearer callers MUST send x-tc-workspace: paper|live (/api/settings exempt)
- Repo: +insertSignalOnce(value & {id}) -> {row, created}; insertSignal unchanged
- Webhook: price required (>0). Rejecting is intentional; see docs/WEBHOOKS.md
- Invariant: webhook still never calls placePaperOrder or /api/orders
```

### 4.2 App tasks (next phase — not started)

| ID | Task | Depends |
|---|---|---|
| T1 | Scaffold `apps/mobile` (Expo + expo-router + TS), root excludes, `.vercelignore` | B2 |
| T2 | API client: base URL from env, bearer, `x-tc-workspace`, 8 s timeout, typed error envelope, no secret logging | T1 |
| T3 | Session + login flow: SecureStore adapter, expiry, 401 → clear + redirect, health/system status | T2, B2 |
| T4 | Workspace (Paper default) + mode banner; settings read is the only workspace-less call | T3 |
| T5 | Tickers/watchlist with `stale`/`asOf`/`provider` badges and honest `unavailable` | T2 |
| T6 | Positions, orders, P&L, journal summary | T4 |
| T7 | Paper ticket with review/confirm + stable `client_order_id`, plus close-position confirmation | T6 |
| T8 | Signal inbox + unread badge + foreground polling + one-tap prefilled ticket | T5, B4 |

Charting is deferred to M3 with the Pine overlays; no v1 task depends on `/api/market/candles`.

Every app task additionally requires: `npm --prefix apps/mobile run typecheck`, `lint`, `test`, plus root `npm test` when shared types or backend code changed.

---

## 5. Verification gate

Per commit (backend):

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm run typecheck
npm run lint
npm run test:auth        # B1, B2
npm run test:safety      # B3, B4
npm run test:paper       # B1, B2, B4 (server-level, file backend)
```

Before the final commit of this phase: `npm test` (full offline suite + `next build`).
Deployment: **verification-only**. No production deploy (`allow_production_deploy=false`).

---

## 6. Risks and honest limitations

1. **No token revocation.** Rotating `SESSION_SECRET` invalidates every mobile token and browser session. Acceptable for a single-operator app; documented.
2. **12 h re-login.** No refresh endpoint in v1; the password is not kept on the device, so expiry means typing it again.
3. **Throttling is per instance.** Vercel runs several instances, and the counter is in memory, so it is best-effort. It still removes the trivial unlimited-rate oracle. The real control remains a long random `API_PASSWORD`.
4. **Rejected alerts are lost.** TradingView does not retry a 400. The contract (price required, mappable interval) is documented so alert templates can be fixed rather than silently degraded.
5. **Signals are not workspace-scoped.** `/api/signals` is shared between paper and live views. Correct for an inbox, but the UI must not imply a signal belongs to a workspace.
6. **No journal attribution to a signal.** The link is the paper order's `client_order_id = sig:<id>`; the closed journal row still records `strategy: "paper"`. A `paper_orders.signal_id` column is a follow-up, not an M2 requirement.
7. **Push is absent.** Do not claim background notifications. Foreground polling only.
8. **`apps/mobile` inside the Vercel repo** increases clone size. `.vercelignore` prevents upload; it does not shrink git history.

---

## 7. Review outcomes (rev 1 → rev 2)

| Reviewer | Verdict | Adopted |
|---|---|---|
| `check` | NEEDS REVISION | Login throttling (B1); three-leg bearer/workspace test matrix; optional `sourceKey`/no type break for strategy inserts (moot after B4 change); migration-ordering detection (moot); numeric strings for entry/stop/target; bounded strategy/message; `/api/settings` exemption; `SESSION_SECRET` note; removed the false "login throttling already exists" claim |
| `simplify` | MOSTLY APPROPRIATE | Deterministic UUID instead of a `source_key` migration (drops migration, schema change, and Neon ordering risk); drop the redundant `seen` Map; timeframe/symbol **normalization** instead of rejection (real TradingView sends `60`, `D`, `BINANCE:BTCUSDT`); merge 12 app tasks to 8; defer the chart to M3; drop `expiresInMs` |

**Conflict:** `simplify` recommended dropping server-side workspace enforcement for session bearers. `check` classified it as a safety weakening. `check` wins; the rule stays, with the test matrix that makes it unambiguous.

---

## 8. Implementation log (backend phase)

| Commit | Scope | Verification |
|---|---|---|
| `962b3e2` | Plan rev 1 | — |
| `c076ab5` | B1 login throttling | `typecheck`, `lint`, `test:auth` (13 pass), `build`, `test:paper` (429 + `Retry-After` asserted end-to-end) |
| `4c51193` | B2 mobile bearer session | `typecheck`, `lint`, `test:auth` (17 pass), `build`, `test:paper` (mobile token issues no cookie; 428 without workspace; 403 paper→`/api/orders`; 401 tampered; password bearer still 200) |
| `182a047` | B3 webhook payload validation | `typecheck`, `lint`, `test:safety` (48 pass), `build`, `test:paper` |
| `088f8a0` | B4 deterministic signal id | `typecheck`, `lint`, `test:safety` (51 pass), `build`, `test:paper` (same alert twice → one row, same `signalId`, no order), full `npm test` PASS |

Toolchain: Node 22.14 at `~/.local/node/bin` (not on default PATH).
Deployment: **not attempted**. `allow_production_deploy=false`; this phase is verification-only.

### What the mobile client can now rely on

- `POST /api/auth/mobile` → `{ token, expiresAt }`; no cookie, no password retention.
- Any `/api/*` call with `Authorization: Bearer <token>` plus `x-tc-workspace: paper`.
- `/api/settings` works without a workspace header (cold-start mode read).
- `/api/signals` returns deduplicated alerts with real prices and normalized symbols/timeframes.

### Open items recorded at the end of the backend phase

1. `apps/mobile` scaffold and the root excludes (T1) — the only task that touches the web build config.
2. Decide whether the app ships inside this Vercel project's repo or is deployed separately (layout decision 1 answered in-repo, deployment still local/dev only).
3. No production deploy until explicit approval.

All three are addressed in §9: the app is in-repo with an isolated install, and nothing was deployed.

---

## 9. Implementation log (app phase)

| Commit | Scope | Verification |
|---|---|---|
| `04da5cb` | T1 scaffold + core (`apps/mobile`, root excludes, API client, SecureStore session, ticket intent, formatting) | `apps/mobile` typecheck, eslint, `npm test` (23 pass); root `typecheck`, `lint` |
| `1f4a50c` | T2–T8 screens (login, home, trade, inbox, providers, README) | `apps/mobile` typecheck, eslint, `npm test` (23 pass), `expo export --platform ios`; full root `npm test` PASS |

### What the app phase actually verified

- **Bundle:** `npx expo export --platform ios` produced a 2.6 MB Hermes bundle and 23 assets (1165 modules). This compiles every route and provider, so a missing import or invalid JSX fails the check.
- **Platform-free tests:** `src/api/client.ts`, `src/lib/intent.ts`, and `src/lib/format.ts` compile with `tsconfig.test.json` and run under `node --test`. Coverage includes workspace-header exemptions, 401 sign-out, timeout aborts, signal→ticket mapping, `sig:<id>` ids, paper-mode blocking, and the "never render zero for missing" rule.
- **Root isolation:** the Next.js `typecheck`, `lint`, `next build`, and paper/live API tests pass with `apps/mobile` present. `apps/` is excluded from the root tsconfig, ESLint, and the Vercel upload.

### Honest limits of this verification

- No simulator or physical device was available in this environment, so the Expo Go / device smoke test (M0's "builds for iOS and Android") is **not** ticked. The iOS bundle export is the strongest check performed.
- The deployed `https://trading-command-v3.vercel.app` does not yet include `POST /api/auth/mobile`; the app defaults to `http://localhost:3000` until that deployment ships.
- No production deploy, no EAS build, no push permission prompt.

### Device-run checklist (remaining)

1. Start the API (`npm run dev`) and confirm `POST /api/auth/mobile` returns `{ token, expiresAt }`.
2. `cd apps/mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start`, open in Expo Go or a dev build.
3. Sign in, switch the server to PAPER from the trade screen, place and close a paper order, then open an inbox signal and confirm the ticket is pre-filled but not placed.
4. Kill and relaunch the app: the session should restore; after 12 h (or a server-side token invalidation) it should return to login.
