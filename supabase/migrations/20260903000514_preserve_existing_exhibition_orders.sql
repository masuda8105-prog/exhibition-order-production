begin;

-- Copy the current event's non-deleted legacy orders. Source rows are unchanged.
with source as (
  select id, order_no, created_at, order_data as data,
    coalesce(nullif(event_name,''),nullif(order_data->>'eventName',''),'展示会') as event_name
  from public.exhibition_orders
  where deleted_at is null
    and status <> 'deleted'
    and coalesce(nullif(event_name,''),order_data->>'eventName') = 'NEO TOKYO 2026'
    and jsonb_typeof(order_data->'items') = 'array'
), inserted as (
  insert into public.exhibition_app_orders(id,event_name,payload)
  select id,event_name,jsonb_build_object(
    'receiptNo',coalesce(nullif(data->>'clientReceiptNo',''),order_no),
    'type',coalesce(nullif(data->>'type',''),'normal'),
    'handoff',coalesce(data->>'handoff',''),
    'store',coalesce(data->>'customerCompany',''),
    'customer',coalesce(data->>'customerName',''),
    'phone',coalesce(data->>'customerPhone',''),
    'account',coalesce(data->>'account',data->>'distributor',''),
    'staff',coalesce(data->>'staffName',''),
    'customerRegion',coalesce(data->>'customerRegion','domestic'),
    'paymentMethod',coalesce(data->>'paymentMethod','credit'),
    'paid',coalesce(data->'paid','false'::jsonb),
    'delivered',coalesce(data->'delivered','false'::jsonb),
    'shipped',coalesce(data->'shipped','false'::jsonb),
    'prepared',coalesce(data->>'prepared','none'),
    'headOfficeShared',coalesce(data->'headOfficeShared','false'::jsonb),
    'headOfficeSharedAt',coalesce(data->>'headOfficeSharedAt',''),
    'pickupDate',coalesce(data->>'pickupDate',''),
    'notes',coalesce(data->>'notes',''),
    'hotelName',coalesce(data->>'hotelName',''),
    'guestName',coalesce(data->>'guestName',''),
    'roomNo',coalesce(data->>'roomNo',''),
    'checkoutDate',coalesce(data->>'checkoutDate',''),
    'shipAddress',coalesce(data->>'shippingAddress',''),
    'items',(select coalesce(jsonb_agg(jsonb_build_object(
      'code',item->>'c','name',item->>'n','price',item->'p','qty',item->'q',
      'imageUrl',coalesce(item->>'img',''),'orderable',true
    )),'[]'::jsonb) from jsonb_array_elements(data->'items') item)
  ) from source
  on conflict (id) do nothing
  returning id
)
select count(*) as imported_orders from inserted;

-- Preserve the original reception date for date filters and PDFs.
update public.exhibition_app_orders target
set created_at=source.created_at
from public.exhibition_orders source
where target.id=source.id
  and target.event_name='NEO TOKYO 2026'
  and target.created_by is null;

commit;
