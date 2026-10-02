-- Additive V1 schema applied via Supabase MCP; version recorded by the server.
begin;
create table public.exhibitions (
  id text primary key check (id ~ '^[a-z0-9_]+$'),
  name text not null check (length(trim(name)) between 1 and 200),
  order_event_name text not null unique check (length(trim(order_event_name)) between 1 and 200),
  start_date date,
  end_date date,
  venue text not null default '',
  participants text[] not null default '{}',
  created_at timestamptz not null default now(),
  check (start_date is null or end_date is null or end_date >= start_date)
);
create table public.exhibition_products (
  exhibition_id text not null references public.exhibitions(id),
  product_code text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (exhibition_id,product_code)
);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  exhibition_id text not null references public.exhibitions(id),
  user_id uuid not null default auth.uid() references auth.users(id),
  author_name text not null,
  product_code text,
  category text not null check (category in ('positive','negative','venue','other')),
  comment text not null check (length(trim(comment)) between 1 and 5000),
  created_at timestamptz not null default now(),
  check (product_code is null or length(trim(product_code)) > 0)
);
create index reports_exhibition_created_idx on public.reports(exhibition_id,created_at,id);
create index reports_user_idx on public.reports(user_id);

-- Same active-staff access model as the existing order app; settings are shared by staff.
alter table public.exhibitions enable row level security;
alter table public.exhibition_products enable row level security;
alter table public.reports enable row level security;
revoke all on public.exhibitions,public.exhibition_products,public.reports from public,anon,authenticated;
grant select,insert,update on public.exhibitions to authenticated;
grant select,insert,delete on public.exhibition_products to authenticated;
grant select,insert on public.reports to authenticated;

create policy exhibitions_staff_read on public.exhibitions for select to authenticated
using (exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active));
create policy exhibitions_staff_insert on public.exhibitions for insert to authenticated
with check (exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active));
create policy exhibitions_staff_update on public.exhibitions for update to authenticated
using (exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active))
with check (exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active));
create policy exhibition_products_staff_read on public.exhibition_products for select to authenticated
using (exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active));
create policy exhibition_products_staff_insert on public.exhibition_products for insert to authenticated
with check (exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active));
create policy exhibition_products_staff_delete on public.exhibition_products for delete to authenticated
using (exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active));
create policy reports_staff_read on public.reports for select to authenticated
using (exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active));
create policy reports_staff_insert on public.reports for insert to authenticated
with check (user_id=(select auth.uid()) and exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active));

create function public.prepare_exhibition_report() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.user_id := auth.uid();
  select s.display_name into new.author_name from public.exhibition_staff s
  where s.user_id=auth.uid() and s.active;
  if new.author_name is null then raise exception 'STAFF_REQUIRED'; end if;
  new.created_at := now();
  new.comment := trim(new.comment);
  if new.product_code is not null and not exists(select 1 from public.products p where p.product_no=new.product_code)
  then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return new;
end;
$$;
revoke all on function public.prepare_exhibition_report() from public,anon,authenticated;
create trigger reports_prepare before insert on public.reports for each row execute function public.prepare_exhibition_report();

create function public.save_exhibition_report_settings(p_event jsonb,p_codes text[])
returns void language plpgsql security invoker set search_path = '' as $$
declare event_id text := p_event->>'id';
begin
  if not exists(select 1 from public.exhibition_staff s where s.user_id=auth.uid() and s.active)
  then raise exception 'STAFF_REQUIRED'; end if;
  if exists(select 1 from unnest(p_codes) c where not exists(select 1 from public.products p where p.product_no=c))
  then raise exception 'PRODUCT_NOT_FOUND'; end if;
  insert into public.exhibitions(id,name,order_event_name,start_date,end_date,venue,participants)
  values(event_id,p_event->>'name',p_event->>'order_event_name',nullif(p_event->>'start_date','')::date,
    nullif(p_event->>'end_date','')::date,coalesce(p_event->>'venue',''),
    array(select jsonb_array_elements_text(coalesce(p_event->'participants','[]'::jsonb))))
  on conflict(id) do update set name=excluded.name,order_event_name=excluded.order_event_name,
    start_date=excluded.start_date,end_date=excluded.end_date,venue=excluded.venue,participants=excluded.participants;
  delete from public.exhibition_products where exhibition_id=event_id;
  insert into public.exhibition_products(exhibition_id,product_code,display_order)
  select event_id,c,ordinality::integer from unnest(p_codes) with ordinality as codes(c,ordinality);
end;
$$;
revoke all on function public.save_exhibition_report_settings(jsonb,text[]) from public,anon,authenticated;
grant execute on function public.save_exhibition_report_settings(jsonb,text[]) to authenticated;

-- Only confirmed identifiers/names are seeded. Dates/venue stay blank until verified.
insert into public.exhibitions(id,name,order_event_name) values
  ('wof_2026','WOF 2026','WOF 2026'),
  ('jex_2026','JEX 2026','JEX 2026'),
  ('neo_2026','NEO TOKYO 2026','NEO TOKYO 2026'),
  ('imf_2026','IMF 2026','IMF 2026');
insert into public.exhibition_products(exhibition_id,product_code,display_order)
select 'jex_2026',code,ordinality::integer
from unnest(array['1064','1065','1067','1053','1054']) with ordinality as codes(code,ordinality)
where exists(select 1 from public.products p where p.product_no=code);
commit;
