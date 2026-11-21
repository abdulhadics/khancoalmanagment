\set ON_ERROR_STOP on
\timing on

BEGIN;
SET LOCAL TIME ZONE 'Asia/Karachi';

-- This script is invoked only inside a freshly migrated benchmark cluster.
DO $$
BEGIN
  IF current_database() <> 'khancoal_benchmark_test'
    OR EXISTS (SELECT FROM orders) OR EXISTS (SELECT FROM users) THEN
    RAISE EXCEPTION 'Benchmark fixtures require a fresh benchmark database.';
  END IF;
END $$;

CREATE FUNCTION pg_temp.fixture_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT overlay(overlay(md5(seed) PLACING '4' FROM 13 FOR 1) PLACING '8' FROM 17 FOR 1)::uuid
$$;

INSERT INTO users (id, username, email, display_name, role_code)
VALUES (pg_temp.fixture_uuid('benchmark-fixture-author'), 'benchmark-fixture',
  'benchmark-fixture@example.test', 'Benchmark fixture author', 'ACCOUNTANT');

INSERT INTO customers (id, code, name, name_key, is_active, created_by_id, updated_by_id)
SELECT pg_temp.fixture_uuid('benchmark-customer-' || n), 'C-BENCH-' || n,
  'Benchmark Customer ' || n, 'benchmark customer ' || n, n % 19 <> 0,
  pg_temp.fixture_uuid('benchmark-fixture-author'), pg_temp.fixture_uuid('benchmark-fixture-author')
FROM generate_series(1, 4000) AS seed(n);

INSERT INTO suppliers (id, code, name, name_key, is_active, created_by_id, updated_by_id)
SELECT pg_temp.fixture_uuid('benchmark-supplier-' || n), 'S-BENCH-' || n,
  'Benchmark Supplier ' || n, 'benchmark supplier ' || n, n % 19 <> 0,
  pg_temp.fixture_uuid('benchmark-fixture-author'), pg_temp.fixture_uuid('benchmark-fixture-author')
FROM generate_series(1, 500) AS seed(n);

INSERT INTO mines (id, supplier_id, code, code_key, name, is_default)
SELECT pg_temp.fixture_uuid('benchmark-mine-' || n), pg_temp.fixture_uuid('benchmark-supplier-' || n),
  'Bench-1', 'bench-1', 'Benchmark Mine ' || n, true
FROM generate_series(1, 500) AS seed(n);

CREATE TEMP TABLE fixture_orders ON COMMIT DROP AS
WITH data AS (
  SELECT n, current_date - (n * 97 % 1095) AS business_date,
    CASE WHEN n % 5 = 0 THEN 1 ELSE 2 + n * 149 % 3999 END AS customer,
    CASE WHEN n % 5 = 0 THEN 1 ELSE 2 + n * 151 % 499 END AS supplier,
    CASE WHEN n % 97 = 0 THEN 'PENDING_PRICING'::order_status
      WHEN n % 157 = 0 THEN 'VOIDED'::order_status ELSE 'POSTED'::order_status END AS final_status,
    18 + (n * 719 % 42000)::numeric / 1000 AS weight,
    16200 + n * 379 % 5000 AS purchase_rate, 22200 + n * 353 % 5000 AS sell_rate
  FROM generate_series(1, :order_count) AS seed(n)
), numbered AS (
  SELECT data.*, extract(year FROM business_date)::integer AS number_year,
    row_number() OVER (PARTITION BY extract(year FROM business_date) ORDER BY n) AS ordinal
  FROM data
)
SELECT pg_temp.fixture_uuid('benchmark-order-' || n) AS id, pg_temp.fixture_uuid('benchmark-revision-' || n) AS revision_id,
  'ORD-' || number_year || '-' || lpad(ordinal::text, greatest(4, length(ordinal::text)), '0') AS order_no,
  business_date, number_year, ordinal, final_status, weight, purchase_rate, sell_rate,
  pg_temp.fixture_uuid('benchmark-customer-' || customer) AS customer_id,
  pg_temp.fixture_uuid('benchmark-supplier-' || supplier) AS supplier_id,
  pg_temp.fixture_uuid('benchmark-mine-' || supplier) AS mine_id, 'BENCH-' || n AS vehicle_no
FROM numbered;

-- Insert the projection and first revision in one statement so PostgreSQL can
-- verify both foreign keys without a second write of the projection.
WITH issued_orders AS (
  INSERT INTO orders (id, order_no, number_year, ordinal, status, current_revision_no,
    business_date, customer_id, supplier_id, mine_id, vehicle_no, created_by_id, updated_by_id,
    deleted_by_id, deleted_at, delete_reason)
  SELECT id, order_no, number_year, ordinal, final_status, 1, business_date,
    customer_id, supplier_id, mine_id, vehicle_no,
    pg_temp.fixture_uuid('benchmark-fixture-author'), pg_temp.fixture_uuid('benchmark-fixture-author'),
    CASE WHEN final_status = 'VOIDED' THEN pg_temp.fixture_uuid('benchmark-fixture-author') END,
    CASE WHEN final_status = 'VOIDED' THEN CURRENT_TIMESTAMP END,
    CASE WHEN final_status = 'VOIDED' THEN 'Benchmark void' END
  FROM fixture_orders
  RETURNING id
)
INSERT INTO order_revisions (id, order_id, revision_no, business_date, customer_id, supplier_id,
  mine_id, vehicle_no, weight, purchase_rate, sell_rate, buy_amount, sell_amount, profit,
  document_profile_id, actor_id)
SELECT revision_id, fixture.id, 1, business_date, customer_id, supplier_id, mine_id, vehicle_no,
  weight, CASE WHEN final_status <> 'PENDING_PRICING' THEN purchase_rate END, sell_rate,
  CASE WHEN final_status <> 'PENDING_PRICING' THEN round(weight * purchase_rate, 2) END,
  CASE WHEN final_status <> 'PENDING_PRICING' THEN round(weight * sell_rate, 2) END,
  CASE WHEN final_status <> 'PENDING_PRICING'
    THEN round(weight * sell_rate, 2) - round(weight * purchase_rate, 2) END,
  company.document_profile_id, pg_temp.fixture_uuid('benchmark-fixture-author')
FROM fixture_orders AS fixture JOIN issued_orders ON issued_orders.id = fixture.id
CROSS JOIN company_settings AS company;

ANALYZE fixture_orders;

INSERT INTO number_sequences (kind, scope, next_ordinal)
SELECT 'ORDER', number_year, max(ordinal) + 1 FROM fixture_orders GROUP BY number_year;

INSERT INTO ledger_entries (kind, business_date, customer_id, supplier_id, order_revision_id, amount, actor_id)
SELECT kind, business_date,
  CASE WHEN kind = 'ORDER_SALE' THEN customer_id END,
  CASE WHEN kind = 'ORDER_PURCHASE' THEN supplier_id END, id,
  CASE WHEN kind = 'ORDER_SALE' THEN sell_amount ELSE buy_amount END, actor_id
FROM order_revisions CROSS JOIN (VALUES ('ORDER_SALE'::ledger_entry_kind), ('ORDER_PURCHASE')) AS side(kind)
WHERE purchase_rate IS NOT NULL;

INSERT INTO ledger_entries (kind, business_date, customer_id, supplier_id, order_revision_id, amount, reverses_id, actor_id, reason)
SELECT entry.kind, entry.business_date, entry.customer_id, entry.supplier_id,
  entry.order_revision_id, -entry.amount, entry.id, entry.actor_id, 'Benchmark void'
FROM ledger_entries AS entry
JOIN order_revisions AS revision ON revision.id = entry.order_revision_id
JOIN fixture_orders AS fixture ON fixture.id = revision.order_id
WHERE fixture.final_status = 'VOIDED';

INSERT INTO banks (name, name_key, category)
VALUES ('Benchmark Bank', 'benchmark bank', 'BANK');

INSERT INTO payments (id, voucher_no, ordinal, business_date, customer_id, supplier_id,
  direction, method, bank_id, bank_name, reference_no, amount, document_profile_id, created_by_id, status)
SELECT pg_temp.fixture_uuid('benchmark-voucher-' || n), 'VCH-' || lpad(n::text, greatest(4, length(n::text)), '0'),
  n, current_date - (n * 103 % 1095),
  CASE WHEN n % 2 = 0 THEN pg_temp.fixture_uuid('benchmark-customer-' || (1 + n * 149 % 4000)) END,
  CASE WHEN n % 2 = 1 THEN pg_temp.fixture_uuid('benchmark-supplier-' || (1 + n * 151 % 500)) END,
  CASE WHEN n % 2 = 0 THEN 'IN'::payment_direction ELSE 'OUT'::payment_direction END,
  CASE WHEN n % 3 = 0 THEN 'CHEQUE'::payment_method ELSE 'CASH'::payment_method END,
  bank.id, bank.name, CASE WHEN n % 3 = 0 THEN 'CHEQUE-BENCH-' || n END,
  1000 + (n * 193 % 300000), company.document_profile_id, pg_temp.fixture_uuid('benchmark-fixture-author'),
  CASE WHEN n % 3 <> 0 THEN 'POSTED'::payment_status WHEN n % 12 = 0 THEN 'RECEIVED'
    WHEN n % 12 = 3 THEN 'DEPOSITED' WHEN n % 12 = 6 THEN 'CLEARED' ELSE 'BOUNCED' END
FROM generate_series(1, :payment_count) AS seed(n)
CROSS JOIN company_settings AS company
JOIN banks AS bank ON bank.name_key = CASE WHEN n % 3 = 0 THEN 'benchmark bank' ELSE 'cash' END;

INSERT INTO number_sequences (kind, scope, next_ordinal)
SELECT 'VOUCHER', 0, max(ordinal) + 1 FROM payments HAVING count(*) > 0;

INSERT INTO cheque_events (payment_id, previous, resulting, business_date, actor_id, reason)
SELECT id, 'RECEIVED'::payment_status, 'DEPOSITED'::payment_status, business_date, created_by_id, NULL
FROM payments WHERE status IN ('DEPOSITED', 'CLEARED', 'BOUNCED')
UNION ALL
SELECT id, 'DEPOSITED', status, business_date, created_by_id,
  CASE WHEN status = 'BOUNCED' THEN 'Benchmark bounce' END
FROM payments WHERE status IN ('CLEARED', 'BOUNCED');

INSERT INTO ledger_entries (kind, business_date, customer_id, supplier_id, payment_id, amount, actor_id)
SELECT CASE WHEN direction = 'IN' THEN 'CUSTOMER_RECEIPT'::ledger_entry_kind ELSE 'SUPPLIER_PAYMENT' END,
  business_date, customer_id, supplier_id, id, -amount, created_by_id
FROM payments;

INSERT INTO ledger_entries (kind, business_date, customer_id, supplier_id, payment_id, amount, reverses_id, actor_id, reason)
SELECT entry.kind, entry.business_date, entry.customer_id, entry.supplier_id,
  entry.payment_id, -entry.amount, entry.id, entry.actor_id, 'Benchmark bounce'
FROM ledger_entries AS entry JOIN payments ON payments.id = entry.payment_id
WHERE payments.status = 'BOUNCED';

COMMIT;
ANALYZE;
