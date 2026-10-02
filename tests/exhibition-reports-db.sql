-- Live integration check: all test rows/settings are rolled back.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.exhibition_staff where active order by user_id limit 1),true);
set local role authenticated;
do $$
declare
  report_id uuid := gen_random_uuid();
  expected_name text;
  actual_record public.reports;
  product text;
begin
  select display_name into expected_name from public.exhibition_staff where user_id=auth.uid() and active;
  if expected_name is null then raise exception 'TEST_REQUIRES_ACTIVE_STAFF'; end if;
  select product_no into product from public.products order by id limit 1;
  if product is null then raise exception 'TEST_REQUIRES_PRODUCT'; end if;
  perform public.save_exhibition_report_settings(
    jsonb_build_object('id','codex_report_verification','name','検証用（ロールバック）','order_event_name','codex_report_verification','participants',jsonb_build_array(expected_name)),array[product]);
  if (select count(*) from public.exhibition_products where exhibition_id='codex_report_verification')<>1 then raise exception 'FOCUS_SAVE_FAILED'; end if;
  insert into public.reports(id,exhibition_id,user_id,author_name,product_code,category,comment,created_at)
  values(report_id,'codex_report_verification','00000000-0000-0000-0000-000000000001','偽の記入者',product,'positive','  DB保存確認  ','2000-01-01');
  select * into actual_record from public.reports where id=report_id;
  if actual_record.user_id<>auth.uid() or actual_record.author_name<>expected_name or actual_record.comment<>'DB保存確認'
    or actual_record.created_at<'2026-01-01' then raise exception 'SERVER_AUTHOR_OR_TIMESTAMP_FAILED'; end if;
  insert into public.reports(exhibition_id,product_code,category,comment)
  values('codex_report_verification',null,'venue','商品なしの保存確認');
  begin
    insert into public.reports(exhibition_id,product_code,category,comment)
    values('codex_report_verification','codex_nonexistent_product','positive','不正な品番');
    raise exception 'INVALID_PRODUCT_ACCEPTED';
  exception when others then if sqlerrm<>'PRODUCT_NOT_FOUND' then raise; end if; end;
  begin
    insert into public.reports(exhibition_id,category,comment) values('codex_report_verification','bad_category','不正カテゴリー');
    raise exception 'INVALID_CATEGORY_ACCEPTED';
  exception when check_violation then null; end;
  begin
    insert into public.reports(exhibition_id,category,comment) values('codex_report_verification','positive','   ');
    raise exception 'EMPTY_COMMENT_ACCEPTED';
  exception when check_violation then null; end;
  begin
    update public.reports set comment='変更' where id=report_id;
    raise exception 'REPORT_UPDATE_ACCEPTED';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.reports where id=report_id;
    raise exception 'REPORT_DELETE_ACCEPTED';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.reports(id,exhibition_id,category,comment) values(report_id,'codex_report_verification','positive','重複');
    raise exception 'DUPLICATE_ACCEPTED';
  exception when unique_violation then null; end;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
begin
  if exists(select 1 from public.reports) or exists(select 1 from public.exhibitions)
    or exists(select 1 from public.exhibition_products) then raise exception 'NON_STAFF_READ_ALLOWED'; end if;
  begin
    insert into public.reports(exhibition_id,category,comment) values('neo_2026','positive','権限なし');
    raise exception 'NON_STAFF_WRITE_ALLOWED';
  exception when others then if sqlerrm<>'STAFF_REQUIRED' then raise; end if; end;
  begin
    perform public.save_exhibition_report_settings(jsonb_build_object('id','forbidden','name','権限なし','order_event_name','forbidden'),array[]::text[]);
    raise exception 'NON_STAFF_SETTINGS_ALLOWED';
  exception when others then if sqlerrm<>'STAFF_REQUIRED' then raise; end if; end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.reports;
    raise exception 'ANON_READ_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.reports(exhibition_id,category,comment) values('neo_2026','positive','匿名');
    raise exception 'ANON_WRITE_ALLOWED';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'PASS: staff save/read, server author/time, product validation, categories, empty text, duplicates, immutable reports, focus settings, non-staff denial, anonymous denial; test data rolled back' as verification;
rollback;
