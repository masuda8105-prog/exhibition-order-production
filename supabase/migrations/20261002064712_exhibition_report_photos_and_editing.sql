begin;
alter table public.reports add column photo_paths text[] not null default '{}';
alter table public.reports add column updated_at timestamptz not null default now();
alter table public.reports add column deleted_at timestamptz;
alter table public.reports add constraint reports_max_photos check (cardinality(photo_paths)<=6);
grant update(product_code,category,comment,photo_paths,deleted_at) on public.reports to authenticated;
create policy reports_owner_photos_update on public.reports for update to authenticated
using (user_id=(select auth.uid()) and exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active))
with check (user_id=(select auth.uid()) and exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active));

create function public.validate_exhibition_report_photos() returns trigger
language plpgsql security invoker set search_path='' as $$
declare object_path text;
begin
  new.updated_at := now();
  new.comment := trim(new.comment);
  if new.product_code is not null and not exists(select 1 from public.products p where p.product_no=new.product_code)
  then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if cardinality(new.photo_paths)<> (select count(distinct p) from unnest(new.photo_paths) p) then raise exception 'DUPLICATE_PHOTO'; end if;
  foreach object_path in array new.photo_paths loop
    if object_path is null or object_path !~ ('^'||new.user_id::text||'/'||new.id::text||'/[0-9a-f-]{36}\.jpg$')
    then raise exception 'INVALID_REPORT_PHOTO_PATH'; end if;
    if not exists(select 1 from storage.objects o where o.bucket_id='exhibition-report-photos' and o.name=object_path)
    then raise exception 'REPORT_PHOTO_NOT_UPLOADED'; end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.validate_exhibition_report_photos() from public,anon,authenticated;
create trigger reports_validate_photos before insert or update on public.reports
for each row execute function public.validate_exhibition_report_photos();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('exhibition-report-photos','exhibition-report-photos',false,10485760,array['image/jpeg']);
create policy report_photos_staff_read on storage.objects for select to authenticated
using (bucket_id='exhibition-report-photos'
  and exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active)
  and exists(select 1 from public.reports r where r.id::text=(storage.foldername(name))[2] and r.user_id::text=(storage.foldername(name))[1] and r.deleted_at is null));
create policy report_photos_owner_upload on storage.objects for insert to authenticated
with check (bucket_id='exhibition-report-photos'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active)
  and exists(select 1 from public.reports r where r.id::text=(storage.foldername(name))[2] and r.user_id=(select auth.uid()) and r.deleted_at is null));
commit;
