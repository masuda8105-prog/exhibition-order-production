export const PERSISTENT_SESSION_KEY='exhibitionOps.session.v3';
export const SESSION_STORAGE_KEY='exhibitionOps.session.v2';

export const LEGACY_LOCAL_STORAGE_KEYS=Object.freeze([
  'exhibitionOps.orders.v1',
  'exhibitionOps.session.v1',
  'exhibitionOps.counter.v1',
]);

export const ORDER_SENSITIVE_FIELDS=Object.freeze([
  'store',
  'customer',
  'phone',
  'notes',
  'account',
  'accountChoice',
  'accountOther',
  'pickupDate',
  'shipAddress',
  'hotelName',
  'guestName',
  'roomNo',
  'checkoutDate',
]);

export function wipeOrderData(order){
  if(!order||typeof order!=='object')return order;
  for(const key of ORDER_SENSITIVE_FIELDS)order[key]='';
  order.items=[];
  return order;
}
