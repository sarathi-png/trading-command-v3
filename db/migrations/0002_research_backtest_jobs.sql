-- 0002_research_backtest_jobs.sql
--
-- Adds the two tables behind AI-assisted strategy research and
-- backtest history. Purely additive: no existing table, column or
-- row is touched, so existing production data is untouched.
--
-- Idempotent: every statement is IF NOT EXISTS, so it is safe to
-- run more than once (matters because `drizzle-kit push` has no
-- migrations table to consult; this file is the documented manual
-- path and `npm run db:push` sees no drift once it has run).
--
-- Run with:
--   psql "$DATABASE_URL" -f db/migrations/0002_research_backtest_jobs.sql

-- ---- AI research runs ------------------------------------------------------
CREATE TABLE IF NOT EXISTS research_runs (
  id            text PRIMARY KEY,
  workspace     text NOT NULL DEFAULT 'paper',
  symbol        text NOT NULL,
  timeframe     text NOT NULL,
  strategy_type text NOT NULL,
  objective     text NOT NULL,
  constraints   text NOT NULL DEFAULT '',
  provider      text NOT NULL,
  model         text NOT NULL,
  status        text NOT NULL CHECK (status IN ('completed', 'failed')),
  report        jsonb,
  market_evidence jsonb,
  error         text,
  revision_of   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_runs_symbol_idx ON research_runs (symbol);
CREATE INDEX IF NOT EXISTS research_runs_created_idx ON research_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS research_runs_revision_idx ON research_runs (revision_of);

-- ---- backtest jobs ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS backtest_jobs (
  id              text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  workspace       text NOT NULL DEFAULT 'paper',
  symbol          text NOT NULL,
  timeframe       text NOT NULL,
  config          jsonb NOT NULL,
  capital         real NOT NULL,
  fee_rate        real NOT NULL,
  slippage        real NOT NULL,
  candle_limit    integer NOT NULL,
  walk_forward    boolean NOT NULL DEFAULT false,
  train_window    integer,
  test_window     integer,
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  segments_total  integer NOT NULL DEFAULT 1,
  segments_done   integer NOT NULL DEFAULT 0,
  result          jsonb,
  segment_results jsonb,
  data_warnings   jsonb NOT NULL DEFAULT '[]'::jsonb,
  fill_model      text NOT NULL,
  research_run_id text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS backtest_jobs_symbol_idx ON backtest_jobs (symbol);
CREATE INDEX IF NOT EXISTS backtest_jobs_status_idx ON backtest_jobs (status);
CREATE INDEX IF NOT EXISTS backtest_jobs_created_idx ON backtest_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS backtest_jobs_research_idx ON backtest_jobs (research_run_id);

-- Audit trail of the schema change itself.
INSERT INTO audit_log (event, detail)
VALUES (
  'research_backtest_tables_added',
  jsonb_build_object(
    'tables', jsonb_build_array('research_runs', 'backtest_jobs'),
    'destructive', false
  )
)
ON CONFLICT DO NOTHING;
