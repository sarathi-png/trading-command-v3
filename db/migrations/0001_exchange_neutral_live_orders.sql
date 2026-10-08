-- 0001_exchange_neutral_live_orders.sql
--
-- Makes the live-order idempotency ledger exchange-neutral ahead of the
-- CoinDCX migration, WITHOUT destroying data:
--
--   delta_order_id   ->  exchange_order_id   (rename: values are preserved)
--   (new)                exchange            venue the row was sent to
--   (new)                exchange_symbol     the venue's own pair identifier
--
-- Why a rename and not a drop/add: existing rows record orders that were really
-- submitted to Delta, and losing their venue ids would make them impossible to
-- reconcile. After the rename, rows that already carry an order id are labelled
-- exchange='delta' so an operator can tell the two eras apart; rows that never
-- left 'pending' were never submitted to anyone and default to 'coindcx'.
--
-- Idempotent: safe to run more than once (the DO block checks first), which
-- matters because `drizzle-kit push` has no migrations table to consult.
--
-- Run with:
--   psql "$DATABASE_URL" -f db/migrations/0001_exchange_neutral_live_orders.sql
--
-- After running it, `npm run db:push` sees no drift. Running db:push BEFORE
-- this file would propose dropping delta_order_id and adding the new columns,
-- which would DELETE the recorded venue order ids — run this one first.

DO $$
BEGIN
  -- 1. Rename the venue-specific column, keeping every recorded value.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'live_orders' AND column_name = 'delta_order_id'
  ) THEN
    ALTER TABLE live_orders RENAME COLUMN delta_order_id TO exchange_order_id;
  END IF;

  -- 2. Add the neutral columns if they are not there yet.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'live_orders' AND column_name = 'exchange'
  ) THEN
    ALTER TABLE live_orders ADD COLUMN exchange text NOT NULL DEFAULT 'coindcx';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'live_orders' AND column_name = 'exchange_symbol'
  ) THEN
    ALTER TABLE live_orders ADD COLUMN exchange_symbol text;
  END IF;
END $$;

-- 3. Historical rows: anything that reached a venue is Delta-era. Rows still
--    'pending'/'failed' never produced an order id, so the default stands.
UPDATE live_orders
   SET exchange = 'delta'
 WHERE exchange_order_id IS NOT NULL
   AND exchange = 'coindcx';

-- 4. Audit trail of the change itself (the table exists in every deployment).
INSERT INTO audit_log (event, detail)
VALUES (
  'exchange_neutral_live_orders_migrated',
  jsonb_build_object(
    'renamed', 'delta_order_id -> exchange_order_id',
    'added', jsonb_build_array('exchange', 'exchange_symbol'),
    'deltaRowsLabelled', (SELECT count(*) FROM live_orders WHERE exchange = 'delta')
  )
)
ON CONFLICT DO NOTHING;
