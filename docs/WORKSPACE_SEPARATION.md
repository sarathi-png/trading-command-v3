# Live/Paper workspaces and focused chart navigation

**Later refinement:** `DECISION_SUMMARY_CHART_ISOLATION.md` documents the current compact, visible-by-default AI comparison, chart-specific analysis/drawings, local timeframe selectors, essential-label default, connection glows and 338-test verification. Its UI notes supersede the initially collapsed AI review described below.

## Scope and choices

The operator selected **one login with two isolated workspaces**, not multi-user accounts. Authentication remains the existing operator password/session. These workspaces are not different security identities: the authenticated operator can select either. Credentials, market research, provider budgets, delivery connections/preferences and the operational audit remain operator-wide. Balances, positions, financial journal/export/analytics views and application/strategy/display preferences are separated by workspace.

## Implemented

- Profile gate after login: choose Live or Paper before mounting trading pages. Selection is kept per browser tab in session storage (with an in-memory fallback for storage-restricted previews), not a process-global execution switch. API requests carry `X-TC-Workspace`.
- Server settings use independent `app:paper` and `app:live` repository keys/caches. Existing `app` preferences are used as an initial migration seed, without inheriting an armed live switch. Choosing a workspace saves its profile and disarms execution; entering Live does not enable live execution.
- The proxy rejects browser financial/research API access without a selected workspace (428), except the authenticated settings/bootstrap endpoint. Live cannot access `/api/paper`; Paper cannot access live order/status/close, private exchange summary or live import endpoints. Existing server execution gates still apply.
- Account aggregation branches before loading paper state. Live reads only CoinDCX, fails visibly if either balance or positions cannot be obtained, and never substitutes a simulated wallet. Available margin comes from the live wallet, not paper notional. Today's imported live FIFO estimate is explicitly not venue-booked P&L.
- Journal queries, annotations, CSV exports and analytics follow the request workspace, ignoring cross-workspace query parameters. Live responses exclude paper orders/positions; Paper excludes imported live fills/sync details. Financial rows retain their existing mode/source attribution; no destructive migration or deletion.
- Paper UI no longer shows live account balances/private credential card. Positions and order-desk sections do not overlay paper and live rows. The live order desk explicitly does not claim a complete live working-order book; imported live fills remain in the Live journal.
- `/chart`: Candlestick only. `/heikin-ashi`: Heikin-Ashi only. Separate sidebar links; no Compare controls or twin-chart sections. Each has its own prediction context. AI review is collapsed and **unmounted** initially, preventing hidden reviews from making model requests; expand it deliberately.
- Fixed plot surfaces, collapsed legend/object browser, nonshrinking sidebar cards, bounded watchlist and responsive context grid remain. The overview preview also gets a fixed 420px plot.
- `/ai-connection` is a separate navigation page instead of another large chart/settings subsection.

### Script compatibility

An explicit operator `Authorization: Bearer API_PASSWORD` request without a workspace retains the legacy administrative/script behavior. Use an explicit workspace header for normal profile-scoped API work. Browser cookies/preview sessions must select a workspace. The existing cron-secret allowance remains restricted to the two scheduler endpoints; setting `CRON_SECRET` does not install a scheduler. Workspaces are organizational separation for one operator, not an authorization boundary between different users.

## Free AI model policy

1. Fetch the provider's `/models` endpoint with the server-resolved API key. Catalogs are cached per hashed credential/provider for five minutes; keys never enter responses or cache identifiers as plaintext.
2. Only models whose catalog explicitly reports **zero prompt, zero completion and zero additional listed prices** qualify. Unpriced models, paid `:free` lookalikes, negative/blank pricing, non-text outputs and insufficient context are rejected.
3. Rank compatibility by structured-output support, then useful context (capped at 128K), then deterministic ID. This is not a claim of best trading accuracy. Old static model overrides do not override the verified-free policy.
4. OpenRouter completion requests also carry zero maximum prompt/completion price constraints. There is no paid fallback.
5. Count each completion attempt before sending it. A model-specific 429 or unavailable model (404/410) cools that model for 15 minutes; another eligible model is selected on the next permitted request, respecting provider spacing. No immediate retry storm. Account/global/daily quota or credit errors do **not** cause model rotation.
6. If discovery fails, all eligible models cool down, a daily cap is reached, or no verifiably free model exists, return the clearly labelled technical-rule result. Upstream error bodies are not shown to users.
7. NVIDIA's unpriced model listings do not establish remaining trial credit or free eligibility. With such a catalog NVIDIA safely falls back to rules; automatic NVIDIA free selection cannot be promised without verifiable pricing information.

Provider credentials and budgets are shared across both workspaces intentionally. Existing file-backed budget/memory/delivery persistence is **not Vercel-hardened** by this change. Model cooldown/catalog caches are process-local; no distributed lock or exactly-once provider budget enforcement is claimed. Do not use this as an unattended production trading guarantee.

## Verification

- `npm run typecheck`: pass, including gateway.
- `npm run lint`: pass.
- `npm test`: **329 tests passed, zero failed**, including production build and mock CoinDCX boundary checks.
- New fake-provider tests cover pricing verification, ranking, malformed catalogs, authenticated discovery, sanitized errors, model rotation, request spacing, attempt accounting and no account-quota rotation.
- Integration checks cover workspace settings independence, simultaneous profile reads, cross-workspace execution refusal, browser selection requirement, forced journal filtering and no live-to-paper account fallback.
- `scripts/check-chart-readability.mjs`: profile gate/switching, separate chart pages, closed object browser, stable plot height on legend expansion, AI toggle, 390/834/1366/1568/2560px, day/night, no card overlap, horizontal overflow or browser page errors. Demo data only; no browser test submits orders.
- Ignored local screenshots: `output/workspace-{chart,heikin-ashi}-{dark,light}.png`.
- Actual CoinDCX/OpenRouter/NVIDIA/Vercel connectivity is not verified; provider tests use mocks, browser checks use labelled demo data.

## Publication

Local changes only. This coding session is closed for remote GitHub operations. Start a new coding session to publish and deploy these updates. The Arena preview is not the Vercel production deployment.
