begin;

create table if not exists public.exhibition_app_orders (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  payload jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint exhibition_app_orders_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint exhibition_app_orders_payload_size_check
    check (pg_column_size(payload) <= 1048576)
);

create index if not exists exhibition_app_orders_event_created_idx
on public.exhibition_app_orders (event_name, created_at desc)
where deleted_at is null;

create index if not exists exhibition_app_orders_updated_idx
on public.exhibition_app_orders (updated_at desc)
where deleted_at is null;

create or replace function public.stamp_exhibition_app_order()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := pg_catalog.now();
  end if;

  new.updated_by := auth.uid();
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.stamp_exhibition_app_order() from public, anon, authenticated;

drop trigger if exists stamp_exhibition_app_order_trigger on public.exhibition_app_orders;
create trigger stamp_exhibition_app_order_trigger
before insert or update on public.exhibition_app_orders
for each row execute function public.stamp_exhibition_app_order();

alter table public.exhibition_app_orders enable row level security;

revoke all on table public.exhibition_app_orders from anon, authenticated;
grant select on table public.exhibition_app_orders to authenticated;
grant insert (id, event_name, payload) on table public.exhibition_app_orders to authenticated;
grant update (payload, deleted_at) on table public.exhibition_app_orders to authenticated;

drop policy if exists exhibition_app_orders_active_staff_select on public.exhibition_app_orders;
create policy exhibition_app_orders_active_staff_select
on public.exhibition_app_orders
for select
to authenticated
using (
  exists (
    select 1
    from public.exhibition_staff staff
    where staff.user_id = (select auth.uid())
      and staff.active = true
  )
);

drop policy if exists exhibition_app_orders_active_staff_insert on public.exhibition_app_orders;
create policy exhibition_app_orders_active_staff_insert
on public.exhibition_app_orders
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and exists (
    select 1
    from public.exhibition_staff staff
    where staff.user_id = (select auth.uid())
      and staff.active = true
  )
);

drop policy if exists exhibition_app_orders_active_staff_update on public.exhibition_app_orders;
create policy exhibition_app_orders_active_staff_update
on public.exhibition_app_orders
for update
to authenticated
using (
  exists (
    select 1
    from public.exhibition_staff staff
    where staff.user_id = (select auth.uid())
      and staff.active = true
  )
)
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1
    from public.exhibition_staff staff
    where staff.user_id = (select auth.uid())
      and staff.active = true
  )
);

commit;
