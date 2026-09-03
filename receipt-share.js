export const RECEIPT_BUCKET='exhibition-receipts';
export const RECEIPT_LINK_SECONDS=7*24*60*60;
export const RECEIPT_MAX_BYTES=10*1024*1024;

export async function receiptImagePath(orderId,html){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId))throw new Error('INVALID_ORDER_ID');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(html));
  const hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
  return `${orderId}/${hash.slice(0,32)}.png`;
}

export function signedReceiptUrl(supabaseUrl,signedPath){
  if(typeof signedPath!=='string'||!signedPath.startsWith(`/object/sign/${RECEIPT_BUCKET}/`))throw new Error('INVALID_RECEIPT_LINK');
  const base=new URL(supabaseUrl),url=new URL(`${base.origin}/storage/v1${signedPath}`);
  if(url.origin!==base.origin||!url.pathname.startsWith(`/storage/v1/object/sign/${RECEIPT_BUCKET}/`)||!url.searchParams.get('token'))throw new Error('INVALID_RECEIPT_LINK');
  return url.href;
}
