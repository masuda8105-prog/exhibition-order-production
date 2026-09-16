begin;
set local lock_timeout = '3s';

-- Existing orders stay confirmed. The new workflow applies only to this app's event.
alter table public.exhibition_app_orders
  add column confirmation_state text not null default 'confirmed'
  check (confirmation_state in ('draft','confirmed'));

-- Pure normalization: no table access, no elevated privileges, no customer data reads.
create function public.exhibition_share_content(p jsonb)
returns jsonb language sql immutable security invoker set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'fields', (select pg_catalog.jsonb_object_agg(k, coalesce(p->>k, ''))
      from pg_catalog.unnest(array['receiptNo','type','handoff','customerRegion','store','phone','customer',
        'account','staff','pickupDate','notes','hotelName','guestName','roomNo','checkoutDate','shipAddress']) as keys(k)),
    'items', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'code',i->>'code','name',i->>'name','price',(i->>'price')::numeric,'qty',(i->>'qty')::numeric) order by n), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) with ordinality as lines(i,n))
  );
$$;
revoke all on function public.exhibition_share_content(jsonb) from public, anon;
grant execute on function public.exhibition_share_content(jsonb) to authenticated;

create function public.guard_exhibition_confirmation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  requires_share boolean;
  desired text;
  content_changed boolean := false;
  was_shared boolean := false;
begin
  -- The same database hosts another app. Do not change that app's workflow.
  if new.event_name is distinct from 'NEO TOKYO 2026' then return new; end if;
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
create trigger guard_exhibition_confirmation_trigger
before insert or update on public.exhibition_app_orders
for each row execute function public.guard_exhibition_confirmation();

-- Existing column-level INSERT/UPDATE grants deliberately exclude confirmation_state.
notify pgrst, 'reload schema';
commit;
