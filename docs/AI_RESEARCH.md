# AI-assisted strategy research & backtesting

Two connected tools for the operator who wants to test an idea before
arming it:

1. **Research** (`/research`) — describe an objective in plain English; the
   configured AI provider returns a *structured* strategy hypothesis that is
   validated against strict allowlists before anything is shown or run.
2. **Backtests** (`/backtests`) — run the existing TypeScript
   Chandelier + Donchian engine over **real** market candles, with a full
   metric set, an explicit fill model, and optional walk-forward
   (out-of-sample) separation.

A research run can be handed off to a backtest, and a validated config can be
**enabled for paper trading** — by an explicit button, never automatically, and
never into the live workspace.

Everything is designed for **free-tier keys** (OpenRouter, NVIDIA NIM) and for
**no keys at all**.

---

## 1. Where it appears

| Surface | What it shows |
|---|---|
| `/research` | Research form, structured report, history tab |
| `/backtests` | Backtest config form, results, OOS fold table, trade history, history tab |
| Settings → AI CONNECTION | The provider key the research call uses (unchanged) |

## 2. What the model is actually given

The model never computes indicators and never invents prices. It receives the
same pre-computed evidence snapshot the charts use (`src/lib/ai/context.ts`),
built from **real closed candles** fetched through the market facade
(`src/lib/market/service.ts`):

* the symbol and timeframe the operator picked
* ATR, the Chandelier Exit state, Donchian ribbon alignment, Heikin-Ashi colour,
  and recent price action
* how many closed bars the evidence covers

The evidence is stored on the run (`marketEvidence`) so a report can be
re-opened and audited. Only **closed** candles are used — a half-formed bar
cannot ground a hypothesis. If there are fewer than 60 closed bars, the run
fails cleanly with a plain-English message rather than guessing.

If the data source is the **demo simulator**, the report says so. Demo candles
are a deterministic function of time, not real market history, and are always
labelled `source: "demo"`.

## 3. Answer validation (why you can trust the shape, not the opinion)

The model's answer is **untrusted input** (`src/lib/research/validate.ts`).
It is parsed into a plain object and checked field-by-field:

* mandatory narrative fields (summary, hypothesis, assumptions, entry/exit
  rules, stop/take-profit/sizing logic, rationale, risks, concerns, validation
  steps) must be present and non-empty, or the whole report is rejected
* every string is bounded (no runaway output flooding storage) and single-line
* indicator types must be in the allowlist (`chandelier`, `donchian`, `rsi`,
  `sma`, `atr`); unknown types are **dropped** with a visible warning
* indicator periods and every config number must be in range; out-of-range
  values are **reset to safe defaults** (never clamped to the boundary the
  model asked for), with a warning
* a proposed strategy config that names none of the strategy's real parts is
  treated as "not proposed", and the report is marked **research-only** rather
  than silently running a default config

The model is asked for **one JSON object**. It is never asked to write code,
and its output is **never executed** — there is no eval, no dynamic import of
model content, and no shell access from the research path.

A failed or malformed answer does **not** discard the operator's input: the run
is persisted with `status: "failed"` and the error, so the objective can be
revised and re-run.

## 4. The backtest engine (real numbers, stated assumptions)

Backtests run the **existing** TypeScript engine
(`src/lib/strategy/v2/backtest.ts`), extended additively. Every result
(`BacktestResult`) now carries:

* initial capital, ending equity, net P&L and net return %
* gross profit, gross loss, profit factor, win rate, expectancy
* average win, average loss, average bars held, Sharpe ratio
* **fees** and **slippage** totals (charged per side at the configured rates)
* max drawdown (absolute and %), and the full equity curve
* the complete trade history (entry/exit time, price, side, qty, P&L, reason)
* the engine's **config version** and the **fill model** description
* **data-quality warnings** from candle sanitisation

**Fill model (stated on every result):** closed-bar signals; the next real open
fills; trailing stops use the *prior* bar's value so the current bar cannot move
its own stop; a gap through the stop fills at the worse opening price; fees and
slippage are charged per side. No synthetic fills, no look-ahead.

**No look-ahead:** a signal at bar *i* is computed from `candles[0..i-1]` only.
Appending future candles to a series cannot change any trade that closed before
them (covered by a test).

**Data hygiene:** raw candles are sanitised before a run — non-finite values,
impossible geometry (`high < low`, non-positive prices), duplicate timestamps
and non-monotonic ordering are dropped, and every drop is reported as a
`dataWarning` on the result. Data is never invented to fill gaps.

**Honesty:** the engine reports what happened; it does not claim a strategy is
profitable. Walk-forward aggregates **do not** compound per-fold equity curves
into one fake curve — they pool trades and report the **worst** window drawdown,
and say so in `dataWarnings`. DSR (deflated Sharpe) is reported as `null`
because the trial count needed to compute it honestly is not available.

## 5. Walk-forward / out-of-sample separation

When the operator opts in, the candle range is split into fixed-parameter
folds: each fold trains on a trailing window and is evaluated on a disjoint,
later test window. Test windows never overlap. Each fold is an independent
engine run over its own slice; the aggregate pools trades and reports the worst
window drawdown. Parameters are **not** fitted across folds — the config is
fixed for the whole run.

Because each fold is a bounded, synchronous engine run, a walk-forward job is
**stepped**: the API runs the first fold and persists progress; the frontend
polls and advances one fold at a time (`POST /api/backtests/[id]/step`). A
retried step re-runs the same deterministic fold rather than skipping ahead, so
a fold is never double-counted.

## 6. Persistence (Neon PostgreSQL, additive migration)

Research runs and backtest jobs are persisted through the repository
abstraction (`src/lib/repo/`), which selects **PostgreSQL** (Neon) when
`DATABASE_URL` is reachable and falls back to the JSON **file** mirror
otherwise — the same backend choice every other feature uses.

`db/migrations/0002_research_backtest_jobs.sql` adds two tables,
`research_runs` and `backtest_jobs`. It is **purely additive** (no existing
table, column or row is touched) and **idempotent** (every statement is
`IF NOT EXISTS`), so running it twice is safe. Apply it with:

```sh
psql "$DATABASE_URL" -f db/migrations/0002_research_backtest_jobs.sql
```

**Backtest jobs are persisted rows, not an in-memory queue.** There is no
Redis, no Kafka, no background worker process and no assumption of a long-lived
server — each request is self-contained against Postgres, which is what a
serverless deployment requires.

## 7. Serverless shape (bounded work per request)

Vercel functions are bounded in time and memory, so the workload is split:

* a **plain** backtest is a single synchronous engine run over a hard-capped
  candle set (≤ 500 candles) and completes within the request;
* a **walk-forward** run is a persisted job advanced one fold per request;
* every backtest is addressed by a deterministic **idempotency key** derived
  from its parameters and **scoped to the workspace**, so a retried or
  duplicated request returns the same job instead of running twice.

## 8. Paper-trading handoff (explicit, gated, never live)

`POST /api/research/[id]/promote` writes a validated config into the
**paper** workspace's strategy setting — the same setting the existing paper
engine already reads. It is refused unless:

* the run is **completed** and carries a **validated executable** config
  (a "research-only" hypothesis cannot be promoted);
* the active workspace is **paper** — promotion from the **live** workspace is
  refused outright, so research can never arm a live strategy;
* the config passes the engine's own validator immediately before the write.

The action **never places an order** and **never switches the terminal to
live**. The operator still places orders by hand, and the existing risk
evaluator still governs every order. Every promotion is written to the audit
log.

## 9. Rate limits

* `POST /api/research` — 10 requests/minute per client (each spends real
  free-tier provider quota)
* `POST /api/backtests` — 30/minute; `POST /api/backtests/[id]/step` — 60/minute

All routes sit behind the existing `src/proxy.ts` auth choke point, which
requires a valid session and a `x-tc-workspace` header.
