-- Review and apply separately after confirming the operational impact.
-- Existing order rows are preserved; this only removes browser/API access.
begin;

revoke all on table public.exhibition_orders from anon, authenticated;
revoke all on table public.exhibition_order_counters from anon, authenticated;
revoke all on table public.order_revisions from anon, authenticated;
revoke all on table public.order_activity_logs from anon, authenticated;
revoke all on table public.order_batch_counters from anon, authenticated;
revoke all on table public.order_batches from anon, authenticated;
revoke all on table public.order_batch_items from anon, authenticated;

drop policy if exists exhibition_orders_staff_select on public.exhibition_orders;
drop policy if exists exhibition_orders_staff_update on public.exhibition_orders;
drop policy if exists order_activity_logs_staff_insert on public.order_activity_logs;
drop policy if exists order_activity_logs_staff_select on public.order_activity_logs;
drop policy if exists order_batch_items_staff_select on public.order_batch_items;
drop policy if exists order_batches_staff_select on public.order_batches;
drop policy if exists order_revisions_staff_insert on public.order_revisions;
drop policy if exists order_revisions_staff_select on public.order_revisions;
drop policy if exists business_cards_staff_read on storage.objects;

revoke execute on function public.cancel_exhibition_order_batch(text) from public, anon, authenticated;
revoke execute on function public.create_exhibition_order_batch(text,text,date,uuid[],text,text) from public, anon, authenticated;
revoke execute on function public.is_active_exhibition_staff() from public, anon, authenticated;
revoke execute on function public.is_exhibition_admin() from public, anon, authenticated;
revoke execute on function public.mark_exhibition_order_batch_sent(text,text) from public, anon, authenticated;
revoke execute on function public.next_korea_order_no() from public, anon, authenticated;
revoke execute on function public.set_exhibition_order_updated_at() from public, anon, authenticated;

commit;
