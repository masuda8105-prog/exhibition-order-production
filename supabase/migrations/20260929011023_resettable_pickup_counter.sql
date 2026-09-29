begin;
set local lock_timeout = '5s';

-- Existing pickup numbers stay on their orders. A new generation can reuse 1.
lock table public.exhibition_app_orders in share row exclusive mode;
alter table public.exhibition_app_orders
  add column pickup_generation integer not null default 1
    check (pickup_generation > 0);
alter table public.exhibition_app_orders
  drop constraint exhibition_app_orders_pickup_number_unique;
alter table public.exhibition_app_orders
  add constraint exhibition_app_orders_pickup_generation_number_unique
    unique (pickup_generation, pickup_number);

create table public.exhibition_pickup_counter (
  singleton boolean primary key default true check (singleton),
  generation integer not null check (generation > 0),
  next_number integer not null check (next_number > 0)
);
insert into public.exhibition_pickup_counter (singleton, generation, next_number)
select true, 1, greatest(
  coalesce((select max(pickup_number) from public.exhibition_app_orders), 0) + 1,
  (select case when is_called then last_value + 1 else last_value end
     from public.exhibition_pickup_number_seq)
);
alter table public.exhibition_pickup_counter enable row level security;
revoke all on public.exhibition_pickup_counter from public, anon, authenticated;
revoke all on sequence public.exhibition_pickup_number_seq from authenticated;

create table public.exhibition_pickup_resets (
  generation integer primary key check (generation > 1),
  request_id uuid not null unique,
  reset_by uuid not null references auth.users(id),
  reset_at timestamptz not null default now()
);
alter table public.exhibition_pickup_resets enable row level security;
revoke all on public.exhibition_pickup_resets from public, anon, authenticated;

create or replace function public.assign_exhibition_pickup_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.pickup_number := old.pickup_number;
    new.pickup_generation := old.pickup_generation;
  else
    new.pickup_number := null;
    new.pickup_generation := 1;
  end if;

  if new.pickup_number is null and new.deleted_at is null
     and new.payload->>'type' = 'spot' and new.payload->>'handoff' = 'later' then
    if not exists (
      select 1 from public.exhibition_staff staff
      where staff.user_id = auth.uid() and staff.active = true
    ) then
      raise exception 'Active staff required to allocate pickup number' using errcode = '42501';
    end if;
    update public.exhibition_pickup_counter
      set next_number = next_number + 1
      where singleton = true
      returning generation, next_number - 1
      into new.pickup_generation, new.pickup_number;
    if not found then
      raise exception 'Pickup counter is unavailable';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.assign_exhibition_pickup_number() from public, anon, authenticated;

create function public.reset_exhibition_pickup_counter(
  p_confirmation text, p_request_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare result_generation integer;
begin
  if p_confirmation is distinct from 'リセット' or p_request_id is null then
    raise exception 'Explicit reset confirmation is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.exhibition_staff staff
    where staff.user_id = auth.uid() and staff.active = true
  ) then
    raise exception 'Active staff required to reset pickup counter' using errcode = '42501';
  end if;

  -- Both issuance and reset lock the same row, so the next order starts at 1.
  perform 1 from public.exhibition_pickup_counter where singleton = true for update;
  if not found then raise exception 'Pickup counter is unavailable'; end if;
  select generation into result_generation
    from public.exhibition_pickup_resets where request_id = p_request_id;
  if found then return result_generation; end if;

  update public.exhibition_pickup_counter
    set generation = generation + 1, next_number = 1
    where singleton = true
    returning generation into result_generation;
  insert into public.exhibition_pickup_resets(generation, request_id, reset_by)
    values(result_generation, p_request_id, auth.uid());
  return result_generation;
end;
$$;
revoke all on function public.reset_exhibition_pickup_counter(text, uuid) from public, anon, authenticated;
grant execute on function public.reset_exhibition_pickup_counter(text, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
