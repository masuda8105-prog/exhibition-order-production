begin;
set local lock_timeout='5s';

alter table public.exhibitions add column pickup_prefix text not null default '展示会'
  check (length(trim(pickup_prefix)) between 1 and 40 and pickup_prefix=trim(pickup_prefix));
update public.exhibitions set pickup_prefix=case
  when id='neo_2026' then 'NEO' when id='imf_2026' then 'IMF'
  when id='wof_2026' then 'WOF' when id='jex_2026' then 'JEX'
  else split_part(name,' ',1) end;
update public.exhibitions set venue='大阪' where id='imf_2026' and venue='';
update public.exhibitions set venue='東京' where id in ('wof_2026','jex_2026') and venue='';
insert into public.exhibitions(id,name,order_event_name,pickup_prefix,venue) values
 ('egf_2027','EGF 2027（大阪）','EGF 2027（大阪）','EGF','大阪'),
 ('wof_2027','WOF 2027（東京）','WOF 2027（東京）','WOF','東京');

alter table public.exhibition_app_orders add column pickup_prefix text not null default 'NEO';
alter table public.exhibition_app_orders drop constraint exhibition_app_orders_pickup_generation_number_unique;
alter table public.exhibition_app_orders add constraint exhibition_orders_event_pickup_unique
  unique(event_name,pickup_generation,pickup_number);

create table public.exhibition_event_pickup_counters (
  event_name text primary key references public.exhibitions(order_event_name),
  generation integer not null default 1 check(generation>0),
  next_number integer not null default 1 check(next_number>0)
);
alter table public.exhibition_event_pickup_counters enable row level security;
revoke all on public.exhibition_event_pickup_counters from public,anon,authenticated;
insert into public.exhibition_event_pickup_counters(event_name,generation,next_number)
select e.order_event_name,c.generation,greatest(coalesce(max(o.pickup_number),0)+1,
  case when e.order_event_name='NEO TOKYO 2026' then c.next_number else 1 end)
from public.exhibitions e cross join public.exhibition_pickup_counter c
left join public.exhibition_app_orders o on o.event_name=e.order_event_name and o.pickup_generation=c.generation
group by e.order_event_name,c.generation,c.next_number;

create table public.exhibition_event_pickup_resets (
  request_id uuid primary key,
  event_name text not null references public.exhibitions(order_event_name),
  generation integer not null,
  reset_by uuid not null references auth.users(id),
  reset_at timestamptz not null default now()
);
alter table public.exhibition_event_pickup_resets enable row level security;
revoke all on public.exhibition_event_pickup_resets from public,anon,authenticated;

create function public.guard_exhibition_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.id is distinct from old.id or new.order_event_name is distinct from old.order_event_name then
    raise exception 'EXHIBITION_IDENTITY_IMMUTABLE' using errcode='23514';
  end if;
  if new.pickup_prefix is distinct from old.pickup_prefix and exists(
    select 1 from public.exhibition_app_orders where event_name=old.order_event_name and pickup_number is not null
  ) then raise exception 'PICKUP_PREFIX_ALREADY_ISSUED' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function public.guard_exhibition_identity() from public,anon,authenticated;
create trigger guard_exhibition_identity_trigger before update on public.exhibitions
for each row execute function public.guard_exhibition_identity();

create or replace function public.assign_exhibition_pickup_number() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_prefix text;
begin
  if tg_op='UPDATE' then
    if new.event_name is distinct from old.event_name then raise exception 'ORDER_EVENT_IMMUTABLE' using errcode='23514'; end if;
    new.pickup_number:=old.pickup_number;new.pickup_generation:=old.pickup_generation;new.pickup_prefix:=old.pickup_prefix;
  else
    new.pickup_number:=null;new.pickup_generation:=1;
    select e.pickup_prefix into event_prefix from public.exhibitions e where e.order_event_name=new.event_name;
    new.pickup_prefix:=coalesce(event_prefix,'NEO');
  end if;
  if new.pickup_number is null and new.deleted_at is null
    and new.payload->>'type'='spot' and new.payload->>'handoff'='later' then
    if not exists(select 1 from public.exhibition_staff where user_id=auth.uid() and active) then
      raise exception 'Active staff required to allocate pickup number' using errcode='42501';
    end if;
    select e.pickup_prefix into event_prefix from public.exhibitions e where e.order_event_name=new.event_name for share;
    if found then
      new.pickup_prefix:=event_prefix;
      insert into public.exhibition_event_pickup_counters(event_name) values(new.event_name) on conflict do nothing;
      update public.exhibition_event_pickup_counters set next_number=next_number+1 where event_name=new.event_name
        returning generation,next_number-1 into new.pickup_generation,new.pickup_number;
    else
      -- Keep the unrelated application on its existing global counter.
      update public.exhibition_pickup_counter set next_number=next_number+1 where singleton
        returning generation,next_number-1 into new.pickup_generation,new.pickup_number;
      if not found then raise exception 'Pickup counter is unavailable'; end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.assign_exhibition_pickup_number() from public,anon,authenticated;

create function public.reset_exhibition_pickup_counter(p_confirmation text,p_request_id uuid,p_event_name text)
returns integer language plpgsql security definer set search_path='' as $$
declare result_generation integer;existing_event text;
begin
  if p_confirmation is distinct from 'リセット' or p_request_id is null then raise exception 'Explicit reset confirmation is required' using errcode='22023'; end if;
  if not exists(select 1 from public.exhibition_staff where user_id=auth.uid() and active) then raise exception 'Active staff required' using errcode='42501'; end if;
  if not exists(select 1 from public.exhibitions where order_event_name=p_event_name) then raise exception 'EXHIBITION_NOT_FOUND'; end if;
  insert into public.exhibition_event_pickup_counters(event_name) values(p_event_name) on conflict do nothing;
  perform 1 from public.exhibition_event_pickup_counters where event_name=p_event_name for update;
  select generation,event_name into result_generation,existing_event from public.exhibition_event_pickup_resets where request_id=p_request_id;
  if found then
    if existing_event<>p_event_name then raise exception 'RESET_EVENT_MISMATCH'; end if;
    return result_generation;
  end if;
  update public.exhibition_event_pickup_counters set generation=generation+1,next_number=1 where event_name=p_event_name returning generation into result_generation;
  insert into public.exhibition_event_pickup_resets(request_id,event_name,generation,reset_by) values(p_request_id,p_event_name,result_generation,auth.uid());
  return result_generation;
end;
$$;
revoke all on function public.reset_exhibition_pickup_counter(text,uuid,text) from public,anon,authenticated;
grant execute on function public.reset_exhibition_pickup_counter(text,uuid,text) to authenticated;

-- Old NEO clients continue to reset only their own exhibition.
create or replace function public.reset_exhibition_pickup_counter(p_confirmation text,p_request_id uuid)
returns integer language sql security invoker set search_path='' as $$
  select public.reset_exhibition_pickup_counter(p_confirmation,p_request_id,'NEO TOKYO 2026');
$$;

create or replace function public.guard_exhibition_confirmation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  requires_share boolean;
  desired text;
  content_changed boolean := false;
  was_shared boolean := false;
begin
  -- The same database hosts another app. Do not change that app's workflow.
  if not exists(select 1 from public.exhibitions where order_event_name=new.event_name) then return new; end if;
  if new.deleted_at is not null then return new; end if;
  requires_share := new.payload->>'type' = 'spot' and new.payload->>'handoff' in ('later','hotel','ship');
  if not coalesce(requires_share,false) then
    new.confirmation_state := 'confirmed';
    return new;
  end if;
  desired := coalesce(nullif(new.payload->>'confirmationState',''), 'confirmed');
  if desired not in ('draft','confirmed') then raise exception 'INVALID_CONFIRMATION_STATE' using errcode='23514'; end if;
  if tg_op = 'INSERT' then
    if desired <> 'draft' then raise exception 'SHARE_REQUIRED' using errcode='23514'; end if;
    new.payload := new.payload || '{"slackShared":false,"slackSharedAt":""}'::jsonb;
  else
    content_changed := public.exhibition_share_content(old.payload) is distinct from public.exhibition_share_content(new.payload);
    was_shared := old.payload->'slackShared' = 'true'::jsonb and coalesce(old.payload->>'slackSharedAt','') <> '';
    if content_changed and desired <> 'draft' then raise exception 'SHARED_CONTENT_CHANGED' using errcode='23514'; end if;
    if content_changed or (old.confirmation_state='confirmed' and desired='draft') then
      new.payload := new.payload || '{"slackShared":false,"slackSharedAt":""}'::jsonb;
    elsif old.confirmation_state='draft' then
      if desired='confirmed' and (not coalesce(was_shared,false) or new.payload->'slackShared' is distinct from 'true'::jsonb) then
        raise exception 'SHARE_REQUIRED' using errcode='23514';
      end if;
      if new.payload->'slackShared' = 'true'::jsonb then
        new.payload := pg_catalog.jsonb_set(new.payload,'{slackSharedAt}',
          case when was_shared then old.payload->'slackSharedAt' else pg_catalog.to_jsonb(pg_catalog.clock_timestamp()) end);
      else
        new.payload := new.payload || '{"slackShared":false,"slackSharedAt":""}'::jsonb;
      end if;
    end if;
  end if;
  new.confirmation_state := desired;
  new.payload := pg_catalog.jsonb_set(new.payload,'{confirmationState}',pg_catalog.to_jsonb(desired));
  if desired='draft' then
    new.payload := new.payload || '{"workflowStatus":"active","headOfficeShared":false,"headOfficeSharedAt":""}'::jsonb;
  elsif tg_op='UPDATE' and old.confirmation_state='draft' then
    new.payload := pg_catalog.jsonb_set(new.payload,'{workflowStatus}',pg_catalog.to_jsonb(
      case when new.payload->>'handoff'='later' and new.payload->'delivered' is distinct from 'true'::jsonb then 'waiting'::text else 'done'::text end));
  end if;
  return new;
end;
$$;
revoke all on function public.guard_exhibition_confirmation() from public, anon, authenticated;

notify pgrst,'reload schema';
commit;
