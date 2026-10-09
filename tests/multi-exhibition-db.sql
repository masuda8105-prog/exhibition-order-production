begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.exhibition_staff where active order by user_id limit 1),true);
set local role authenticated;
do $$
declare
  first_id uuid:=gen_random_uuid();second_id uuid:=gen_random_uuid();third_id uuid:=gen_random_uuid();
  reset_id uuid:=gen_random_uuid();reset_generation integer;
  p jsonb:='{"type":"spot","handoff":"later","store":"QA fixture","phone":"000","customer":"Test","items":[{"code":"QA","name":"Fixture","qty":1,"price":100}],"confirmationState":"draft","slackShared":false,"slackSharedAt":"","workflowStatus":"active"}'::jsonb;
begin
  insert into public.exhibitions(id,name,order_event_name,pickup_prefix) values
    ('codex_event_a','QA A','codex_event_a','IMF'),('codex_event_b','QA B','codex_event_b','WOF');
  insert into public.exhibition_app_orders(id,event_name,payload) values(first_id,'codex_event_a',p),(second_id,'codex_event_b',p),(third_id,'codex_event_a',p);
  assert (select pickup_number=1 and pickup_prefix='IMF' and confirmation_state='draft' from public.exhibition_app_orders where id=first_id),'A-1';
  assert (select pickup_number=1 and pickup_prefix='WOF' from public.exhibition_app_orders where id=second_id),'B-1';
  assert (select pickup_number=2 from public.exhibition_app_orders where id=third_id),'A-2';
  begin
    update public.exhibition_app_orders set event_name='codex_event_b' where id=first_id;
    raise exception 'EVENT_MOVED';
  exception when check_violation or insufficient_privilege then null;end;
  begin
    update public.exhibitions set pickup_prefix='BAD' where id='codex_event_a';
    raise exception 'PREFIX_CHANGED';
  exception when check_violation then null;end;
  begin
    update public.exhibitions set order_event_name='BAD' where id='codex_event_a';
    raise exception 'IDENTITY_CHANGED';
  exception when check_violation then null;end;
  begin
    insert into public.exhibition_app_orders(id,event_name,payload) values(gen_random_uuid(),'codex_event_b',p||'{"confirmationState":"confirmed"}');
    raise exception 'UNSHARED_CONFIRMED';
  exception when check_violation then null;end;
  reset_generation:=public.reset_exhibition_pickup_counter('リセット',reset_id,'codex_event_a');
  assert public.reset_exhibition_pickup_counter('リセット',reset_id,'codex_event_a')=reset_generation,'idempotent reset';
  insert into public.exhibition_app_orders(id,event_name,payload) values(gen_random_uuid(),'codex_event_a',p),(gen_random_uuid(),'codex_event_b',p);
  assert (select max(pickup_number)=2 from public.exhibition_app_orders where event_name='codex_event_b'),'reset isolated';
  assert (select count(*)=2 from public.exhibition_app_orders where event_name='codex_event_a' and pickup_number=1),'old number preserved';
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
begin
  assert (select count(*)=0 from public.exhibitions),'inactive staff cannot read';
  begin
    insert into public.exhibitions(id,name,order_event_name,pickup_prefix) values('codex_denied','Denied','codex_denied','X');
    raise exception 'INACTIVE_INSERT_ALLOWED';
  exception when insufficient_privilege then null;end;
  begin
    perform public.reset_exhibition_pickup_counter('リセット',gen_random_uuid(),'codex_event_a');
    raise exception 'INACTIVE_RESET_ALLOWED';
  exception when insufficient_privilege then null;end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin perform count(*) from public.exhibitions;raise exception 'ANON_READ_ALLOWED';exception when insufficient_privilege then null;end;
  begin perform public.reset_exhibition_pickup_counter('リセット',gen_random_uuid(),'codex_event_a');raise exception 'ANON_RESET_ALLOWED';exception when insufficient_privilege then null;end;
end;
$$;
rollback;
