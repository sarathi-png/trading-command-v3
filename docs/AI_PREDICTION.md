# AI signal prediction (5-minute frame)

A model reads the **Chandelier Exit** and **Donchian ribbon** on a 5-minute
chart and writes one structured call: direction, its own stated certainty, the
price that would prove the call wrong, and a short rationale naming the
indicators it used. Two charts run it independently — the candlestick chart and
a separate Heikin-Ashi chart — because the smoothed series can disagree with the
raw one, and that disagreement is information.

Everything is designed for **free-tier keys** (OpenRouter, NVIDIA NIM) and for
**no keys at all**.

---

## 1. Where it appears

| Surface | What it shows |
|---|---|
| Chart workspace (`/chart`) | Candlestick pane **and** Heikin-Ashi pane, each with its own AI panel below the chart |
| Settings → AI SIGNAL PREDICTION | Enable switch, auto-run switch, preferred engine, key fields, free-tier guard rails |
| Strategy page → AI PREDICTION LOG | Every recorded call, its rationale, and how it was scored by the candles that followed |

The two panes are the *same* instrument and timeframe, drawn two ways:

* **Candlestick** — raw traded prices. This is what actually executed.
* **Heikin-Ashi** — smoothed averages. Their prices never traded; they are used
  to read direction only. The panel repeats this so the numbers are never
  mistaken for tradable prices.

Layout is ratio-aware: the two charts sit side by side on wide landscape
screens and stack on phones, portrait tablets and split windows.

## 2. What the model is actually given

The model never computes indicators and never sees raw price series. It receives
a pre-computed snapshot (`src/lib/ai/context.ts`), and the same snapshot is
stored with the prediction so the call can be audited later:

* last closed 5-minute bar's close and open time (the *decision bar*)
* ATR(20) and ATR as a percentage of price
* Chandelier Exit: trend, buy/sell/none, long stop, short stop, distance of the
  active stop in ATR units
* Donchian ribbon: trend flag, every lookback's upper/lower/mid bound, and how
  many bounds price is currently outside of
* Heikin-Ashi colour and how many candles in a row it has held
* last 20 candles: % change, range high/low, count of higher highs / lower lows

Only **closed** candles are used. A half-formed bar cannot trigger a call.

## 3. Answer validation (why you can trust the shape, not the opinion)

`src/lib/ai/prompt.ts` rejects rather than repairs. A model answer is accepted
only if:

* `direction` is exactly `LONG`, `SHORT` or `NEUTRAL`
* `confidence` parses as a number (clamped to 0–100)
* `rationale` is 20–400 characters
* a directional call **must** carry an `invalidation` price, and it must sit on
  the correct side of the decision price (below for LONG, above for SHORT) and
  within 25% of it
* `NEUTRAL` may omit the invalidation and is never scored as a hit

If the answer fails any check, the call is **rejected** and the built-in rule
engine answers instead, with the reason shown to the user. A malformed answer
never reaches the chart, and never reaches the ledger as if it were a model's
opinion.

## 4. The rule engine (works with zero keys)

`src/lib/ai/rules.ts` is a deterministic, testable algorithm — no clock, no
randomness, so the same snapshot always yields the same call:

| Check | Vote |
|---|---|
| Chandelier Exit | +1 long / −1 short / 0 none |
| Donchian, price outside **all** bounds | +1 above / −1 below |
| Donchian, trend established earlier but price back inside the ribbon | +0.5 / −0.5 |
| Heikin-Ashi colour held for 2+ candles | +1 / −1 |

* total ≥ 2.5 → directional call, stated certainty **62**
* total ≥ 1.5 → directional call with one dissenting check, **45**
* otherwise → **NEUTRAL, 30** and the rationale says the indicators disagree

The ribbon's two strengths matter: a live breakout and a pullback into an
established trend are not the same evidence, so they are not scored the same.

## 5. Adding your free-tier keys

Either environment variables (recommended for a deployment):

```
OPENROUTER_API_KEY=sk-or-v1-…
NVIDIA_API_KEY=nvapi-…
```

or paste them in **Settings → AI SIGNAL PREDICTION** (stored server-side in
`data/ai-keys.json`, which is gitignored). Keys are never sent to the browser
after saving; the UI only ever receives a 4-character hint so you can confirm
*which* key is loaded.

Default models (override in the same screen):

| Provider | Default model | Notes |
|---|---|---|
| OpenRouter | `meta-llama/llama-3.3-70b-instruct:free` | free endpoints change; swap the model if one is retired |
| NVIDIA NIM | `meta/llama-3.1-8b-instruct` | `integrate.api.nvidia.com/v1/chat/completions` |

### Free-tier guard rails

Both providers are treated as limited resources:

* **spacing** — OpenRouter 45 s between calls, NVIDIA 30 s
* **daily budget** — 90 and 180 calls per UTC day respectively
* **decision-bar cache** — one call per instrument + chart type + provider per
  5-minute bar; refreshing the page reuses the stored answer
* **graceful degradation** — when the budget is spent or the provider answers
  429/401/timeout, the rule engine answers and the panel says exactly why

Failure classification is deliberate: an HTTP 401 means "your key is wrong"
(shown loudly, not retried), a 429 means "wait, then fall back", a network error
means "transient, fall back quietly".

## 6. Accountability

Every call is written to `data/ai-predictions.json` with its evidence snapshot.
Once the horizon (default 6 × 5-minute candles = 30 minutes) has printed,
`src/lib/ai/outcomes.ts` scores it:

* **MOVED AS CALLED** — signed move at the horizon matched the direction
* **MOVED AGAINST** — it did not
* **HIT ITS OWN INVALIDATION** — price traded through the stated invalidation
  level first; recorded as *against* even if price later recovered
* **NO MEANINGFUL MOVE** — less than 0.05% either way is a coin flip, not a win
* **PENDING** — the horizon has not printed yet

The AI PREDICTION LOG shows totals by engine and by chart type, plus the sample
size warning while the sample is still small. Abstrained calls are counted
separately and never inflate a hit rate.

## 7. Honest boundaries

* A prediction is a **model estimate for study**, not advice and not a
  probability. "Stated certainty" is the model's own wording; it is not a
  measured win rate.
* Nothing here places, sizes or modifies an order. Live execution stays behind
  its own two gates and is unrelated to this feature.
* Free endpoints can be rate-limited, retired or re-pointed by the provider at
  any time; the fallback keeps the feature working and visible.
* Past behaviour of any model — or of the rule engine — is not evidence about
  the future. The log exists to keep that honest, not to sell the feature.

## 8. Tests

`npm run test:ai` compiles and runs 35 tests covering: the indicator snapshot
(including warm-up honesty), the rule engine's three tiers and the ribbon's
two-strength scoring, every validation rejection path, the provider client
against a fake `fetch` (success, 429, 401, bad output, no key), outcome scoring
(including the noise threshold and invalidation-hits-first rule), the scorecard,
and the free-tier budget guard against a temporary data directory. No test needs
network access or an API key.
