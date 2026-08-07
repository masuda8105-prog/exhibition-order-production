// Supabase Edge Function: exhibition-slack
// Secrets: SLACK_WEBHOOK_URL を Supabase 側に設定する。ブラウザには置かない。
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const webhook = Deno.env.get('SLACK_WEBHOOK_URL');
  if (!webhook) return Response.json({ error: 'SLACK_WEBHOOK_URL_NOT_SET' }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const o = body.order || {};
  const items = (o.items || []).map((i:any) => `${i.c} ×${i.q}`).join(' / ');
  const type = o.type === 'normal' ? '国内通常注文' : ({now:'現売り',later:'後日受取',hotel:'ホテル配送',ship:'指定先配送'} as any)[o.handoff] || '現売り';
  const payment = o.type === 'spot' ? `${o.paymentMethod === 'cash' ? '現金' : 'クレジット'}・${o.paid ? '会計済み' : '未会計'}` : `帳合先: ${o.account || '-'}`;
  const text = `【${type}】${body.receiptNo ? ` ${body.receiptNo}` : ''}\n${o.customerCompany || '-'} / ${o.customerName || '-'}\n${payment}\n${items}\n合計: ¥${Number(o.total || 0).toLocaleString('ja-JP')}\n状態: ${body.event || '更新'}`;
  const r = await fetch(webhook, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text}) });
  if (!r.ok) return Response.json({ error:'SLACK_SEND_FAILED', status:r.status }, { status:502 });
  return Response.json({ ok:true });
});
