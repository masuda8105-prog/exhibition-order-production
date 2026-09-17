-- Run after the migration inside a transaction that ends in ROLLBACK.
-- No sequence allocation: hotel fixtures and an already-numbered pickup order only.
do $$
begin
  perform set_config('request.jwt.claim.sub', (select user_id::text from public.exhibition_staff where active limit 1), true);
end;
$$;
set local role authenticated;
do $$
declare
  target uuid := gen_random_uuid();
  ordinary uuid := gen_random_uuid();
  pickup uuid;
  p jsonb := '{"type":"spot","handoff":"hotel","store":"QA fixture","phone":"000","customer":"Test","items":[{"code":"QA","name":"Fixture","qty":1,"price":100}],"confirmationState":"draft","slackShared":false,"slackSharedAt":"","workflowStatus":"active"}'::jsonb;
  r public.exhibition_app_orders;
  number_before integer;
begin
  begin
    insert into public.exhibition_app_orders(id,event_name,payload) values (target,'NEO TOKYO 2026',p||'{"confirmationState":"confirmed"}');
    raise exception 'FAIL: direct confirmation accepted';
  exception when check_violation then null; end;
  insert into public.exhibition_app_orders(id,event_name,payload) values(target,'NEO TOKYO 2026',p||'{"slackShared":true,"slackSharedAt":"fake"}');
  select * into r from public.exhibition_app_orders where id=target;
  assert r.confirmation_state='draft' and r.payload->'slackShared'='false'::jsonb, 'insert cannot claim shared';
  assert r.pickup_number is null, 'hotel must not allocate';
  begin
    update public.exhibition_app_orders set payload=payload||'{"confirmationState":"confirmed","slackShared":true,"slackSharedAt":"fake"}' where id=target;
    raise exception 'FAIL: simultaneous share and confirmation accepted';
  exception when check_violation then null; end;
  update public.exhibition_app_orders set payload=payload||'{"slackShared":true,"slackSharedAt":"fake","workflowStatus":"done"}' where id=target;
  select * into r from public.exhibition_app_orders where id=target;
  assert r.confirmation_state='draft' and r.payload->>'workflowStatus'='active', 'share alone stays draft';
  assert r.payload->>'slackSharedAt'<>'fake', 'acknowledgement timestamp is server assigned';
  begin
    update public.exhibition_app_orders set payload=payload||'{"confirmationState":"confirmed","customer":"Changed"}' where id=target;
    raise exception 'FAIL: changed content confirmed without reshare';
  exception when check_violation then null; end;
  update public.exhibition_app_orders set payload=payload||'{"confirmationState":"confirmed"}' where id=target;
  select * into r from public.exhibition_app_orders where id=target;
  assert r.confirmation_state='confirmed' and r.payload->>'workflowStatus'='done', 'shared hotel confirms';
  update public.exhibition_app_orders set payload=payload||'{"confirmationState":"draft","customer":"Changed"}' where id=target;
  select * into r from public.exhibition_app_orders where id=target;
  assert r.confirmation_state='draft' and r.payload->'slackShared'='false'::jsonb, 'editing invalidates sharing';
  begin
    update public.exhibition_app_orders set confirmation_state='confirmed' where id=target;
    raise exception 'FAIL: client wrote authoritative state';
  exception when insufficient_privilege then null; end;
  insert into public.exhibition_app_orders(id,event_name,payload) values(ordinary,'NEO TOKYO 2026',p||'{"type":"normal","confirmationState":"confirmed"}');
  select * into r from public.exhibition_app_orders where id=ordinary;
  assert r.confirmation_state='confirmed','normal orders do not require sharing';
  update public.exhibition_app_orders set payload=payload||'{"type":"spot","handoff":"now"}' where id=ordinary;
  select * into r from public.exhibition_app_orders where id=ordinary;
  assert r.confirmation_state='confirmed','immediate orders do not require sharing';
  select id,pickup_number into pickup,number_before from public.exhibition_app_orders
    where event_name='NEO TOKYO 2026' and pickup_number is not null and deleted_at is null limit 1;
  assert pickup is not null, 'existing numbered pickup needed for non-allocating test';
  update public.exhibition_app_orders set payload=payload||'{"type":"spot","handoff":"later","confirmationState":"draft","slackShared":false,"delivered":false}' where id=pickup;
  update public.exhibition_app_orders set payload=payload||'{"slackShared":true}' where id=pickup;
  update public.exhibition_app_orders set payload=payload||'{"confirmationState":"confirmed"}' where id=pickup;
  select * into r from public.exhibition_app_orders where id=pickup;
  assert r.confirmation_state='confirmed' and r.payload->>'workflowStatus'='waiting' and r.pickup_number=number_before, 'pickup confirms without renumbering';
  update public.exhibition_app_orders set payload=payload||'{"paid":true,"paymentMethod":"cash","paidAt":"2099-01-01","delivered":true,"workflowStatus":"done"}' where id=pickup;
  select * into r from public.exhibition_app_orders where id=pickup;
  assert r.confirmation_state='confirmed' and r.pickup_number=number_before, 'payment and handover remain possible';
  update public.exhibition_app_orders set deleted_at=now() where id=target;
  select * into r from public.exhibition_app_orders where id=target;
  assert r.deleted_at is not null, 'draft cancellation remains possible';
end;
$$;
reset role;
select 'PASS: sharing guard, legacy preservation, permissions, pickup and payment transitions (rollback)' as result;
