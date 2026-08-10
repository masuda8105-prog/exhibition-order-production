// Supabase Edge Function: exhibition-slack
// Secrets: SLACK_WEBHOOK_URL を Supabase 側に設定する。ブラウザには置かない。

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const allowedEvents = new Set([
  'normal_order_submitted',
  'order_created',
  'status_update',
  'prepare',
  'pay',
  'deliver',
  'ship',
  'deleted',
]);

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function escapeSlack(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(value: unknown, max: number) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function yen(value: unknown) {
  return `¥${Math.round(Number(value || 0)).toLocaleString('ja-JP')}`;
}

async function authorizeStaff(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const authorization = req.headers.get('authorization') || '';
  if (!supabaseUrl || !anonKey) throw new Error('SUPABASE_ENV_NOT_SET');
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { authorization, apikey: anonKey },
  });
  if (!userResponse.ok) return null;
  const user = await userResponse.json().catch(() => null);
  if (!user?.id) return null;

  const staffResponse = await fetch(
    `${supabaseUrl}/rest/v1/exhibition_staff?select=display_name,role,active&user_id=eq.${encodeURIComponent(user.id)}&active=is.true&limit=1`,
    { headers: { authorization, apikey: anonKey } },
  );
  if (!staffResponse.ok) return null;
  const rows = await staffResponse.json().catch(() => []);
  return rows?.[0] || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (Number(req.headers.get('content-length') || 0) > 1_000_000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);

  try {
    const staff = await authorizeStaff(req);
    if (!staff) return json({ error: 'STAFF_AUTH_REQUIRED' }, 401);

    const webhook = Deno.env.get('SLACK_WEBHOOK_URL');
    if (!webhook) return json({ error: 'SLACK_WEBHOOK_URL_NOT_SET' }, 500);

    const body = await req.json().catch(() => null);
    const order = body?.order || {};
    const event = String(body?.event || '');
    if (!allowedEvents.has(event)) return json({ error: 'INVALID_EVENT' }, 400);
    if (!order?.localId || !order?.type || !Array.isArray(order?.items) || !order.items.length) {
      return json({ error: 'INVALID_ORDER' }, 400);
    }
    if (event === 'normal_order_submitted' && (
      order.type !== 'normal' ||
      !String(order.customerCompany || '').trim() ||
      !String(order.customerPhone || '').trim() ||
      !String(order.account || '').trim() ||
      !String(order.staffName || '').trim()
    )) return json({ error: 'INVALID_NORMAL_ORDER' }, 400);

    const type = order.type === 'normal'
      ? '国内通常注文'
      : ({ now: '現売り', later: '後日受取', hotel: 'ホテル配送', ship: '指定先配送' } as Record<string, string>)[order.handoff] || '現売り';
    const eventLabel = ({
      normal_order_submitted: '注文書送信',
      order_created: '注文登録',
      status_update: '状態更新',
      prepare: '商品準備更新',
      pay: '会計済み',
      deliver: '商品お渡し',
      ship: '発送完了',
      deleted: '削除',
    } as Record<string, string>)[event] || event;
    const itemLines = order.items.slice(0, 25).map((item: Record<string, unknown>) => {
      const qty = Number(item.q || 0);
      const subtotal = Number(item.p || 0) * qty;
      return `• ${escapeSlack(item.c)} ${escapeSlack(item.n)} ×${qty}　${yen(subtotal)}`;
    });
    if (order.items.length > 25) itemLines.push(`• ほか ${order.items.length - 25} 商品`);

    const receipt = body.receiptNo ? ` / ${escapeSlack(body.receiptNo)}` : '';
    const accountOrPayment = order.type === 'normal'
      ? `*帳合先:* ${escapeSlack(order.account || '-')}\n*受注担当:* ${escapeSlack(order.staffName || staff.display_name || '-')}`
      : `*会計:* ${order.paymentMethod === 'cash' ? '現金' : 'クレジット'}・${order.paid ? '会計済み' : '未会計'}`;
    const customer = order.customerName ? `\n*お客様:* ${escapeSlack(order.customerName)}` : '';
    const notes = order.notes ? `\n*備考:* ${escapeSlack(truncate(order.notes, 500))}` : '';
    const fallbackText = `【${type}】${eventLabel}${receipt} ${escapeSlack(order.customerCompany || '-')}`;
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: truncate(`【${type}】${eventLabel}${receipt}`, 150), emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*店舗:* ${escapeSlack(order.customerCompany || '-')}\n*電話:* ${escapeSlack(order.customerPhone || '-')}${customer}\n${accountOrPayment}${notes}`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: truncate(`*注文明細*\n${itemLines.join('\n')}\n\n*合計: ${yen(order.total)}*`, 2900) },
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `${escapeSlack(order.eventName || '')} / 操作: ${escapeSlack(staff.display_name || '-')} / ID: ${escapeSlack(truncate(body.idempotencyKey || order.localId, 120))}`,
        }],
      },
    ];

    const slackResponse = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fallbackText, blocks }),
    });
    if (!slackResponse.ok) return json({ error: 'SLACK_SEND_FAILED', status: slackResponse.status }, 502);
    return json({ ok: true, sentAt: new Date().toISOString() });
  } catch (error) {
    console.error('exhibition-slack failed', error instanceof Error ? error.message : 'UNKNOWN');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
