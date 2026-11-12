begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('korea-product-images', 'korea-product-images', false, 5242880, array['image/jpeg','image/png','image/webp']);

create policy korea_product_images_staff_select on storage.objects
for select to authenticated
using (
  bucket_id = 'korea-product-images'
  and exists (
    select 1 from public.exhibition_staff staff
    where staff.user_id = (select auth.uid()) and staff.active = true
  )
);

commit;
