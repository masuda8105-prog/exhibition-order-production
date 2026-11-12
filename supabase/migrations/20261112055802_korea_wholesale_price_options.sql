alter table public.korea_products add column wholesale_price_165 numeric(14,2)
  check (wholesale_price_165 is null or wholesale_price_165 > 0);
