begin;

lock table public.exhibition_app_orders in share row exclusive mode;

alter table public.exhibition_app_orders
  add column pickup_number integer,
  add constraint exhibition_app_orders_pickup_number_positive check (pickup_number > 0),
  add constraint exhibition_app_orders_pickup_number_unique unique (pickup_number);

create sequence public.exhibition_pickup_number_seq
  as integer start with 1 increment by 1 no cycle;
revoke all on sequence public.exhibition_pickup_number_seq from public, anon, authenticated;
grant usage on sequence public.exhibition_pickup_number_seq to authenticated;

-- Preserve existing orders and their audit timestamps while numbering current pickup orders.
alter table public.exhibition_app_orders disable trigger stamp_exhibition_app_order_trigger;
do $$
declare target record;
begin
  for target in
    select id from public.exhibition_app_orders
    where payload->>'type' = 'spot' and payload->>'handoff' = 'later'
      and deleted_at is null
    order by created_at, id
  loop
    update public.exhibition_app_orders
    set pickup_number = nextval('public.exhibition_pickup_number_seq'::regclass)
    where id = target.id;
  end loop;
end;
$$;
alter table public.exhibition_app_orders enable trigger stamp_exhibition_app_order_trigger;

create function public.assign_exhibition_pickup_number()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A number belongs to its order forever, including cancellation and handoff changes.
  if tg_op = 'UPDATE' then
    new.pickup_number := old.pickup_number;
  else
    new.pickup_number := null;
  end if;
  if new.pickup_number is null and new.deleted_at is null
     and new.payload->>'type' = 'spot' and new.payload->>'handoff' = 'later' then
    if not exists (
      select 1 from public.exhibition_staff staff
      where staff.user_id = auth.uid() and staff.active = true
    ) then
      raise exception 'Active staff required to allocate pickup number' using errcode = '42501';
    end if;
    new.pickup_number := pg_catalog.nextval('public.exhibition_pickup_number_seq'::regclass);
  end if;
  return new;
end;
$$;
revoke all on function public.assign_exhibition_pickup_number() from public, anon, authenticated;

create trigger assign_exhibition_pickup_number_trigger
before insert or update on public.exhibition_app_orders
for each row execute function public.assign_exhibition_pickup_number();

-- Existing column-level write grants exclude pickup_number. SELECT includes it.
notify pgrst, 'reload schema';
commit;
