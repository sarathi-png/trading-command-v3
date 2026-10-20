-- 0002_paper_order_idempotency.sql
--
-- Paper orders previously had no idempotency key: a double-click or a retried
-- request created two rows and, for market orders, two fills. This adds a
-- nullable client_order_id with a unique index. PostgreSQL treats NULLs as
-- distinct, so legacy rows (and any caller that omits the key) remain valid,
-- while every non-null key can be claimed exactly once.
--
-- Idempotent: safe to run repeatedly. Run BEFORE `npm run db:push` so drizzle
-- sees no drift:
--   psql "$DATABASE_URL" -f db/migrations/0002_paper_order_idempotency.sql
--   npm run db:push

ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS client_order_id text;

CREATE UNIQUE INDEX IF NOT EXISTS paper_orders_client_order_id_uidx
  ON paper_orders (client_order_id)
  WHERE client_order_id IS NOT NULL;
