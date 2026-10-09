begin;
set local lock_timeout='5s';

alter table public.exhibitions
  add column previous_exhibition_id text unique references public.exhibitions(id),
  add column superseded_by text unique references public.exhibitions(id),
  add constraint exhibition_occurrence_not_self check
    (id is distinct from previous_exhibition_id and id is distinct from superseded_by);

-- Only the atomic start-next operation can change occurrence links.
revoke insert,update on public.exhibitions from authenticated;
grant insert(id,name,order_event_name,start_date,end_date,venue,participants,pickup_prefix),
  update(id,name,order_event_name,start_date,end_date,venue,participants,pickup_prefix)
  on public.exhibitions to authenticated;

create schema exhibition_ops_private;
revoke all on schema exhibition_ops_private from public,anon,authenticated;
grant usage on schema exhibition_ops_private to authenticated;

create function exhibition_ops_private.start_next_exhibition(
  p_exhibition_id text,p_request_id uuid,p_confirmation text
) returns public.exhibitions
language plpgsql security definer set search_path='' as $$
declare
  original public.exhibitions;
  successor public.exhibitions;
  next_id text := 'event_' || replace(p_request_id::text,'-','');
begin
  if auth.uid() is null or not exists(
    select 1 from public.exhibition_staff where user_id=auth.uid() and active
  ) then raise exception 'STAFF_REQUIRED' using errcode='42501'; end if;
  if p_request_id is null or p_confirmation is distinct from 'リセット' then
    raise exception 'CONFIRMATION_REQUIRED' using errcode='23514';
  end if;
  select * into original from public.exhibitions where id=p_exhibition_id for update;
  if not found then raise exception 'EXHIBITION_NOT_FOUND' using errcode='23514'; end if;
  -- Retries and concurrent staff return the same successor, never another reset.
  if original.superseded_by is not null then
    select * into successor from public.exhibitions where id=original.superseded_by;
    return successor;
  end if;
  if exists(select 1 from public.exhibitions where id=next_id or order_event_name=next_id) then
    raise exception 'REQUEST_ID_REUSED' using errcode='23514';
  end if;
  insert into public.exhibitions(id,name,order_event_name,venue,pickup_prefix,previous_exhibition_id)
  values(next_id,original.name,next_id,original.venue,original.pickup_prefix,original.id)
  returning * into successor;
  insert into public.exhibition_products(exhibition_id,product_code,display_order)
  select next_id,product_code,display_order from public.exhibition_products where exhibition_id=original.id;
  update public.exhibitions set superseded_by=next_id where id=original.id;
  return successor;
end;
$$;
revoke all on function exhibition_ops_private.start_next_exhibition(text,uuid,text) from public,anon,authenticated;
grant execute on function exhibition_ops_private.start_next_exhibition(text,uuid,text) to authenticated;

create function public.start_next_exhibition(p_exhibition_id text,p_request_id uuid,p_confirmation text)
returns public.exhibitions language sql security invoker set search_path='' as $$
  select exhibition_ops_private.start_next_exhibition(p_exhibition_id,p_request_id,p_confirmation);
$$;
revoke all on function public.start_next_exhibition(text,uuid,text) from public,anon,authenticated;
grant execute on function public.start_next_exhibition(text,uuid,text) to authenticated;

-- Read-only sales links: no copying, modifying or double-counting legacy orders.
create table public.exhibition_sales_sources (
  exhibition_id text not null references public.exhibitions(id),
  event_name text not null unique check(length(trim(event_name)) between 1 and 200),
  label text not null,
  primary key(exhibition_id,event_name)
);
alter table public.exhibition_sales_sources enable row level security;
revoke all on public.exhibition_sales_sources from public,anon,authenticated;
grant select on public.exhibition_sales_sources to authenticated;
create policy exhibition_sales_sources_staff_read on public.exhibition_sales_sources
for select to authenticated using(exists(
  select 1 from public.exhibition_staff where user_id=(select auth.uid()) and active
));

-- The owner confirmed these 77 live orders belong to this year's JEX.
insert into public.exhibition_sales_sources(exhibition_id,event_name,label)
select id,'exhibition-order-simple','今年のJEX・旧注文ツール'
from public.exhibitions where id='jex_2026';

commit;
