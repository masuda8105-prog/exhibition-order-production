-- Run against the application DB; every synthetic row is rolled back.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.exhibition_staff where active order by user_id limit 1),true);
select set_config('codex.verify_actor',(select user_id::text from public.exhibition_staff where active order by user_id limit 1),true);
select set_config('codex.verify_report',gen_random_uuid()::text,true);
set local role authenticated;
do $$
declare
  report_id uuid := current_setting('codex.verify_report')::uuid;
  object_path text;
  paths text[] := '{}';
begin
  insert into public.reports(id,exhibition_id,category,comment) values(report_id,'neo_2026','venue','写真機能DB検証');
  for i in 1..7 loop
    object_path := auth.uid()::text||'/'||report_id::text||'/'||gen_random_uuid()::text||'.jpg';
    insert into storage.objects(bucket_id,name,metadata) values('exhibition-report-photos',object_path,'{"mimetype":"image/jpeg","size":100}'::jsonb);
    paths := array_append(paths,object_path);
  end loop;
  update public.reports set photo_paths=paths[1:6],comment='写真付きで書き直し' where id=report_id;
  if (select cardinality(photo_paths) from public.reports where id=report_id)<>6 then raise exception 'PHOTO_LINK_FAILED'; end if;
  begin
    update public.reports set photo_paths=paths where id=report_id;
    raise exception 'PHOTO_LIMIT_NOT_ENFORCED';
  exception when check_violation then null; end;
  begin
    update public.reports set photo_paths=array['00000000-0000-0000-0000-000000000001/'||report_id::text||'/'||gen_random_uuid()::text||'.jpg'] where id=report_id;
    raise exception 'FOREIGN_PHOTO_ACCEPTED';
  exception when others then if sqlerrm<>'INVALID_REPORT_PHOTO_PATH' then raise; end if; end;
  begin
    update public.reports set photo_paths=array[auth.uid()::text||'/'||report_id::text||'/'||gen_random_uuid()::text||'.jpg'] where id=report_id;
    raise exception 'MISSING_PHOTO_ACCEPTED';
  exception when others then if sqlerrm<>'REPORT_PHOTO_NOT_UPLOADED' then raise; end if; end;
  begin
    update public.reports set author_name='偽の記入者' where id=report_id;
    raise exception 'AUTHOR_CHANGE_ALLOWED';
  exception when insufficient_privilege then null; end;
  update public.reports set deleted_at=now() where id=report_id;
  if exists(select 1 from storage.objects where bucket_id='exhibition-report-photos' and name=any(paths)) then raise exception 'DELETED_PHOTOS_READ_ALLOWED'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare affected integer;
begin
  update public.reports set comment='権限なしの変更' where id=current_setting('codex.verify_report')::uuid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'NON_OWNER_UPDATE_ALLOWED'; end if;
  begin
    insert into storage.objects(bucket_id,name) values('exhibition-report-photos',current_setting('codex.verify_actor')||'/'||current_setting('codex.verify_report')||'/'||gen_random_uuid()::text||'.jpg');
    raise exception 'NON_OWNER_UPLOAD_ALLOWED';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
do $$ begin
  if (select public from storage.buckets where id='exhibition-report-photos') then raise exception 'PHOTO_BUCKET_PUBLIC'; end if;
end; $$;
select 'PASS: private bucket, own upload and six-photo linking, edit, owner path validation, missing object rejection, immutable author, soft-delete hides objects, other-user upload/edit denial; test data rolled back' as verification;
rollback;
