\set ON_ERROR_STOP on
-- Apply only to a disposable local database named rowfish_fixture.
SELECT current_database() = 'rowfish_fixture' AS correct_database \gset
\if :correct_database
\else
  \echo 'Refusing to seed a database other than rowfish_fixture.'
  \quit 1
\endif

BEGIN;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE TABLE IF NOT EXISTS public.customers (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.orders (
  id serial PRIMARY KEY,
  customer_id integer REFERENCES public.customers(id),
  total numeric(12,2) CHECK (total >= 0),
  status text DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders(status);
TRUNCATE public.orders, public.customers RESTART IDENTITY;
INSERT INTO public.customers(email, name)
SELECT 'customer' || n || '@example.invalid', 'Customer ' || n
FROM generate_series(1,30) AS n;
INSERT INTO public.orders(customer_id,total,status)
SELECT (n % 30) + 1, n * 12.5, CASE WHEN n % 3 = 0 THEN 'pending' ELSE 'complete' END
FROM generate_series(1,300) AS n;
CREATE OR REPLACE VIEW analytics.customer_totals AS
SELECT customer_id, sum(total) AS revenue FROM public.orders GROUP BY customer_id;
COMMIT;
