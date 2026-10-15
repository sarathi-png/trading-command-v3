# Design benchmark — premium trading interfaces, goods, bads, and our audit

Deliverable for request #2: collect what the world's leading trading products do well and badly,
compare our workspace against each pattern, adopt the good ones, and check whether the bad ones
were already present in our project.
Companion documents: `FUTURE_ROADMAP.md` (request #3), `AUDIT_2026-10.md` (bug audit, request #1).

## 1. Who was benchmarked and why

| Product | Why it is in the set | Source reviewed |
|---|---|---|
| TradingView Supercharts | The reference charting workspace; toolbar/watchlist/panel conventions copied industry-wide | TradingView Supercharts documentation |
| Coinbase Advanced | Clean pro layout: chart + order book + ticket, sticky per-market settings | Coinbase Advanced dashboard documentation |
| Kraken Pro | Widget-based dashboards, consolidated portfolio, advanced order instructions | Kraken Pro product page |
| Bybit | Widely praised as the cleanest derivatives trading UI of the major exchanges | Exchange comparisons, 2026 |
| Binance (Lite + Pro) | Largest audience; the Lite/Pro split is the industry's answer to complexity | Exchange comparisons, 2026 |
| Zerodha Kite | India's most-used retail terminal; simplicity plus TradingView charts and education | Kite reviews and product analyses |
| Bloomberg Terminal | The professional benchmark for information density, keyboard speed and colour semantics | Bloomberg UX material and industry analyses |

## 2. Goods collected (and what we did about each)

| Good pattern | Where it comes from | Our status |
|---|---|---|
| Chart is the centre of gravity; surrounding chrome is contextual | TradingView, Kraken | **Adopted** — overview now chart-and-signal first; integration ledger demoted below |
| Separate ticket / book / portfolio areas instead of one scroll | Coinbase Advanced, Kraken | Already present; kept |
| Watchlist rail beside the chart for quick instrument switching | TradingView, Kraken, Bybit | **Adopted now** — new watchlist rail on `/chart` with price, direction glyph and one-click switch |
| Progressively disclosed complexity (a simple mode and a pro mode) | Binance Lite/Pro, Kite | Partly present via GitHub-style layout presets + module toggles; **density control now actually works** (it previously did nothing) |
| Compact density rows for professionals who want more per screen | Bloomberg, TradingView | **Adopted now** — `data-density="compact"` reduces panel headers, metric sizes and table padding |
| One-line "what do I do next" without hunting | Kite (GTT/order flow), Kraken portfolio | **Adopted** — Decision readiness strip on the overview |
| Plain-language education inside the product | Kite + Zerodha Varsity | **Adopted now** — inline `HelpTip` glossary on 30+ terms (equity, R:R, MFE/MAE, funding, mark price, execution modes…) |
| Semantic colour that survives colour-vision deficiency | Bloomberg colour-accessibility work | **Adopted now** — direction glyphs everywhere numbers move, plus a blue/orange palette toggle |
| Honest provenance of data (what is live, what is simulated) | Kraken/Coinbase account labels | **Adopted** — explicit SIMULATED / EXCHANGE labels and per-panel source chips |
| Keyboard-first navigation and command palette | Bloomberg, TradingView | Already present (⌘K palette, shortcuts); kept |
| Sticky per-market view settings | Coinbase Advanced | Already present (per symbol+timeframe chart persistence) |
| Advanced order instructions (reduce-only, trigger, OCO-style brackets) | Kraken, Bybit | Partly present — paper engine supports reduce-only and brackets; live stays gated |
| Depth visualisation (order book bars / depth chart) | Coinbase Advanced | Already present |

## 3. Bads collected (anti-patterns) and whether our project had them

| Anti-pattern | Seen in | Did we have it? | Action |
|---|---|---|---|
| Product-tab sprawl; trading buried inside an ecosystem of menus | Binance | Mildly — 11 nav items, some thin pages | Kept the pages but re-grouped with breadcrumb headers and a lighter nav; no new top-level items added |
| No guided onboarding for beginners; assumes derivatives literacy | Bybit | **Yes** — heavy jargon, no explanations | Fixed with the glossary/`HelpTip` layer and clearer verbs ("Review setup", "Open workspace") |
| Illegible micro-type and edge-to-edge density as a status symbol | Bloomberg (acknowledged trade-off) | Partly — 10px labels at 0.14em tracking, 11–12px body | Fixed: larger label tracking, page rhythm, 23px metrics; density is now a user choice, not the default |
| Colour as the only carrier of meaning | Universal problem | **Yes** — green/red only in most tables and metrics | Fixed with direction glyphs + CVD palette |
| Decorative depth (gradients, glows, lift-on-hover) that adds no information | Consumer crypto apps | **Yes** — grid background, card-lift hover, duplicated panel shadows, glow dots | Fixed: flat workspace, static surfaces, one panel definition, glow reserved for live state |
| Settings that do nothing | Very common | **Yes** — `density` was stored and applied as a data attribute with no CSS behind it; `displayCurrency`/`usdInrRate` were unreferenced by the main UI | Density now has real CSS; currency is described as INR valuation in the exchange panel; the unused field is documented rather than silently dead |
| Numbers that look more authoritative than they are (unlabelled Sharpe-like statistics) | Common in retail backtesting UIs | **Yes** — annualised, clamped "Sharpe" and a placeholder "DSR" | Fixed: honest label, DSR reported as not estimated |
| Silent data-quality ambiguity (demo vs live muddled) | Common in demo/testnet apps | **Yes** — demo mode was unreachable and labels said "COINDCX FUTURES" in demo | Fixed end-to-end |
| Tiny tap targets on mobile | Almost every desktop-first terminal | **Yes** | Fixed: 24px minimums on coarse pointers, 44px toolbar, drawer nav |
| Unbounded alerting (every repaint pings the user) | Alert-tool spam is a frequent complaint | **Yes** — every recorded setup notified, regardless of rules | Fixed: notifications require an enabled matching rule, with capped dedupe sets |
| Copy-trading / social feeds / reward gamification | Bybit, Binance | No | Deliberately not added (see §5) |

## 4. Design system decisions after the benchmark

Kept deliberately, because they already match or beat the benchmark: **Inter** for UI text and
**JetBrains Mono** for numerals (tabular figures are exactly what financial tables need), the
teal accent with blue/purple/amber alternatives, the dark-first palette with a light theme, and
the module-toggle workspace concept.

Changed in this pass:

- **Surfaces**: one `.panel` definition, 10px radius, flat background, shadow only on overlays.
- **Type scale**: 10px micro-labels (tracking tightened from 0.14em to 0.09em for legibility),
  11–12px body, 15px panel values, 23px metrics, 24px page titles.
- **Rhythm**: 16/24px page padding, 12–16px panel gaps, 44px toolbar, 88px expanded sidebar.
- **Semantics**: gain/loss colour plus glyph; CVD palette; warn/err tones reserved for state.
- **Interaction**: visible focus rings, skip link, 24px touch minimums, `prefers-reduced-motion`
  honoured in addition to the manual toggle, and help popovers that work on tap as well as hover.

## 5. Deliberately not copied

News/social feeds, idea marketplaces, copy trading, reward gamification, AI "trade signals",
extra indicators for parity's sake, and always-on animated decoration. Each either needs licensed
content we cannot verify, adds a trust surface without evidence, or increases noise without
answering a question the operator actually asks.

## 6. Capability comparison (✔ present · ◐ partial · — absent)

| Capability | TradingView | Coinbase Adv. | Kraken Pro | Bybit | Binance | Kite | Bloomberg | Ours |
|---|---|---|---|---|---|---|---|---|
| Multi-timeframe candles + drawings | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Watchlist beside chart | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (new) |
| Order book with depth | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ✔ |
| Paper trading | ✔ | — | ◐ | ◐ | ◐ | ◐ | — | ✔ |
| Trade journal | ◐ | — | — | ◐ | — | — | — | ✔ |
| Risk calculator tied to the signal | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ✔ | ✔ |
| Strategy backtest in-product | ✔ (Pine) | — | — | ◐ | ◐ | ◐ | ◐ | ✔ |
| Signal outcome accountability (MFE/MAE per recorded setup) | — | — | — | ◐ copy-trading stats | — | — | ◐ | **✔ unique** |
| Plain-language glossary inline | ◐ | ◐ | ◐ | ◐ | ◐ | ✔ | — | ✔ (new) |
| Colour-vision-safe mode | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ✔ | ✔ (new) |
| Explicit demo/live provenance labels | ◐ | n/a | n/a | ◐ | ◐ | ◐ | n/a | ✔ |
| Trust progression read-only → paper → live | — | — | ◐ | ◐ | ◐ | ◐ | n/a | ✔ |
| Copy trading / social feeds | ✔ | ◐ | ◐ | ✔ | ✔ | ◐ | — | — (intentional) |

"Unique" here means we did not find the capability documented in the sources in §1 — not a claim
that no product anywhere has something similar.

## 7. Verification of the design work

- Headless sweep of all 12 routes at 1440×1000 and 390×844: 0 page exceptions, 0 console errors,
  0 horizontal overflow.
- All interactive controls in our own UI meet a 24px minimum at mobile width (the only smaller
  element is the chart library's own attribution link).
- `HelpTip` verified interactively (tap/click opens, blur closes, `aria-expanded` set).
- CVD palette verified by computed style (`--up` resolves to `#4d9cff` when enabled) and the
  density attribute now changes rendered padding.
- Screenshots for review: `output/v3-chart.png`, `output/v3-overview-help.png`,
  `output/v3-strategy.png` (dev-only artefacts, not committed).
