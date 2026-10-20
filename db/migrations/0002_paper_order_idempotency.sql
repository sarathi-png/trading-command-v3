-- 0002_paper_order_idempotency.sql
--
-- Paper orders previously had no idempotency key: a double-click or a retried
-- request created two rows and, for market orders, two fills. This adds a
-- NOT NULL client_order_id with a unique constraint. Legacy rows are backfilled
-- from their primary key, so the column can be enforced immediately without
-- losing data and without leaving a nullable hole that looks idempotent.
--
-- Idempotent and safe on a fresh database (no paper_orders table yet), which is
-- important because `drizzle-kit push` has no migrations table. Run BEFORE
-- `npm run db:push`:
--   psql "$DATABASE_URL" -f db/migrations/0002_paper_order_idempotency.sql
--   npm run db:push
--
-- The constraint is a FULL unique one (not partial): `ON CONFLICT
-- (client_order_id)` cannot infer a partial index, and a failed inference makes
-- every paper insert error with 42P10.

DO $$
BEGIN
  IF to_regclass('public.paper_orders') IS NOT NULL THEN
    ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS client_order_id text;

    -- Legacy rows predate client keys. Their primary key is unique already, so
    -- it is a safe, traceable backfill (prefix distinguishes it from new ids).
    UPDATE paper_orders
       SET client_order_id = 'legacy-' || id::text
     WHERE client_order_id IS NULL;

    ALTER TABLE paper_orders ALTER COLUMN client_order_id SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'paper_orders_client_order_id_key'
    ) THEN
      ALTER TABLE paper_orders
        ADD CONSTRAINT paper_orders_client_order_id_key UNIQUE (client_order_id);
    END IF;
  END IF;
END $$;
