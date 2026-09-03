begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('exhibition-receipts','exhibition-receipts',false,10485760,array['image/png'])
on conflict (id) do nothing;

-- This bucket is deliberately private. Customer access uses one signed image URL.
do $$
begin
  if exists(select 1 from storage.buckets where id='exhibition-receipts' and public) then
    raise exception 'Receipt bucket must be private';
  end if;
end;
$$;

drop policy if exists exhibition_receipts_staff_read on storage.objects;
create policy exhibition_receipts_staff_read on storage.objects
for select to authenticated
using (
  bucket_id='exhibition-receipts'
  and exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active=true)
  and exists(select 1 from public.exhibition_app_orders o where o.id::text=(storage.foldername(name))[1] and o.deleted_at is null)
);

drop policy if exists exhibition_receipts_staff_upload on storage.objects;
create policy exhibition_receipts_staff_upload on storage.objects
for insert to authenticated
with check (
  bucket_id='exhibition-receipts'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f]{32}\.png$'
  and exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active=true)
  and exists(select 1 from public.exhibition_app_orders o where o.id::text=(storage.foldername(name))[1] and o.deleted_at is null)
);

-- Staff may revoke a receipt image, never overwrite it or delete an order.
drop policy if exists exhibition_receipts_staff_revoke on storage.objects;
create policy exhibition_receipts_staff_revoke on storage.objects
for delete to authenticated
using (
  bucket_id='exhibition-receipts'
  and exists(select 1 from public.exhibition_staff s where s.user_id=(select auth.uid()) and s.active=true)
  and exists(select 1 from public.exhibition_app_orders o where o.id::text=(storage.foldername(name))[1])
);

commit;
