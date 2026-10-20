-- 0003_paper_fill_ledger.sql
--
-- Adds the immutable paper fill ledger. Each position-changing event (open,
-- add, reduce, close) writes one row with its fee and realised P&L, so paper
-- accounting can be audited without replaying the mutable position row or the
-- close-only journal. Additive and idempotent; safe on a fresh database.

CREATE TABLE IF NOT EXISTS paper_fills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  position_id uuid,
  symbol text NOT NULL,
  side text NOT NULL,
  kind text NOT NULL,
  qty real NOT NULL,
  price real NOT NULL,
  fee real NOT NULL DEFAULT 0,
  realized_pnl real NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_fills_created_at_idx
  ON paper_fills (created_at DESC);

CREATE INDEX IF NOT EXISTS paper_fills_symbol_idx
  ON paper_fills (symbol, created_at DESC);
