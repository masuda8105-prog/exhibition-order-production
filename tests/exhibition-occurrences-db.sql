begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.exhibition_staff where active order by user_id limit 1),true);
set local role authenticated;
do $$
declare
  original_id text := 'qa_occurrence_'||replace(gen_random_uuid()::text,'-','');
  request_id uuid := gen_random_uuid();
  next_event public.exhibitions;
  old_order uuid := gen_random_uuid();
  new_order uuid := gen_random_uuid();
  p jsonb := '{"type":"spot","handoff":"later","store":"QA","items":[{"code":"QA","qty":2,"price":100}],"confirmationState":"draft"}';
begin
  insert into public.exhibitions(id,name,order_event_name,pickup_prefix,venue,start_date,participants)
  values(original_id,'QA Exhibition',original_id,'JEX','QA Venue','2026-10-07',array['QA']);
  insert into public.exhibition_products(exhibition_id,product_code,display_order)
  select original_id,product_no,1 from public.products limit 1;
  insert into public.reports(exhibition_id,category,comment,author_name) values(original_id,'other','Original observation','QA');
  insert into public.exhibition_app_orders(id,event_name,payload) values(old_order,original_id,p);
  begin
    perform public.start_next_exhibition(original_id,request_id,'wrong');
    raise exception 'WRONG_CONFIRMATION_ALLOWED';
  exception when check_violation then null;end;
  begin
    update public.exhibitions set superseded_by=original_id where id=original_id;
    raise exception 'DIRECT_LINK_UPDATE_ALLOWED';
  exception when insufficient_privilege then null;end;
  begin
    insert into public.exhibition_sales_sources(exhibition_id,event_name,label) values(original_id,'QA','QA');
    raise exception 'DIRECT_SALES_LINK_ALLOWED';
  exception when insufficient_privilege then null;end;
  next_event := public.start_next_exhibition(original_id,request_id,'リセット');
  assert next_event.previous_exhibition_id=original_id and next_event.name='QA Exhibition' and next_event.pickup_prefix='JEX','identity copied';
  assert next_event.start_date is null and cardinality(next_event.participants)=0,'next settings blank';
  assert (select superseded_by=next_event.id from public.exhibitions where id=original_id),'archived link';
  assert (select count(*)=1 from public.reports where exhibition_id=original_id),'old reports preserved';
  assert (select count(*)=0 from public.reports where exhibition_id=next_event.id),'new reports empty';
  assert (select count(*)=1 from public.exhibition_app_orders where event_name=original_id),'old orders preserved';
  assert (select count(*)=0 from public.exhibition_app_orders where event_name=next_event.order_event_name),'new orders empty';
  assert (select count(*) from public.exhibition_products where exhibition_id=original_id)=(select count(*) from public.exhibition_products where exhibition_id=next_event.id),'focus copied';
  perform public.save_exhibition_report_settings(to_jsonb(next_event)||'{"start_date":"2027-10-07","end_date":"2027-10-08","participants":["QA Next"]}'::jsonb,
    array(select product_code from public.exhibition_products where exhibition_id=next_event.id));
  assert (select start_date='2027-10-07' and participants=array['QA Next'] from public.exhibitions where id=next_event.id),'next settings editable';
  assert (select start_date='2026-10-07' and participants=array['QA'] from public.exhibitions where id=original_id),'old settings unchanged';
  assert (public.start_next_exhibition(original_id,request_id,'リセット')).id=next_event.id,'retry idempotent';
  assert (public.start_next_exhibition(original_id,gen_random_uuid(),'リセット')).id=next_event.id,'second staff request same successor';
  insert into public.exhibition_app_orders(id,event_name,payload) values(new_order,next_event.order_event_name,p);
  assert (select pickup_number=1 and pickup_prefix='JEX' from public.exhibition_app_orders where id=new_order),'new JEX-1';
  assert (select pickup_number=1 and pickup_prefix='JEX' from public.exhibition_app_orders where id=old_order),'old JEX-1 unchanged';
  -- An already-open tab can still save its unfinished observation to the old event.
  insert into public.reports(exhibition_id,category,comment,author_name) values(original_id,'other','Late draft','QA');
  assert (select count(*)=2 from public.reports where exhibition_id=original_id),'old draft survives reset';
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
  assert (select count(*)=0 from public.exhibition_sales_sources),'inactive source read denied';
  begin perform public.start_next_exhibition('jex_2026',gen_random_uuid(),'リセット');raise exception 'INACTIVE_RESET_ALLOWED';exception when insufficient_privilege then null;end;
end; $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.start_next_exhibition('jex_2026',gen_random_uuid(),'リセット');raise exception 'ANON_RESET_ALLOWED';exception when insufficient_privilege then null;end;
  begin perform count(*) from public.exhibition_sales_sources;raise exception 'ANON_SALES_ALLOWED';exception when insufficient_privilege then null;end;
end; $$;
reset role;
select 'PASS: archive preservation, settings, idempotent reset, JEX-1, late drafts, and access control' as result;
rollback;
