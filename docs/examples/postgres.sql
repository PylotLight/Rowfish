-- Fictional Rowfish demo orders. Run only in a disposable/local demo database.
-- Creates a table if needed and adds only these IDs; existing rows are not deleted.
CREATE TABLE IF NOT EXISTS public.orders (
  order_id integer PRIMARY KEY,
  customer text NOT NULL,
  status text NOT NULL,
  total_usd numeric(10, 2) NOT NULL,
  ordered_at date NOT NULL
);

INSERT INTO public.orders (order_id, customer, status, total_usd, ordered_at)
VALUES
  (4101, 'Cedar House Supply',  'ready',      143.20, '2026-10-05'),
  (4102, 'North Loop Workshop', 'processing',  87.50, '2026-10-05'),
  (4103, 'Quiet Current Works', 'shipped',    318.40, '2026-10-06'),
  (4104, 'Blue Fern Market',    'ready',      452.75, '2026-10-06'),
  (4105, 'Juniper Paper Co.',   'processing',  96.00, '2026-10-07'),
  (4106, 'Copperfield Studio',  'ready',     1275.25, '2026-10-07'),
  (4107, 'Moss Harbor Goods',   'processing', 219.00, '2026-10-08'),
  (4108, 'Willow & Finch',      'ready',      684.50, '2026-10-08')
ON CONFLICT (order_id) DO NOTHING;
