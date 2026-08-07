/*
 * 本番接続設定。
 * publishable/anon key はブラウザ公開用。service_role や Slack webhook は絶対にここへ書かない。
 * 最初は onlineEnabled:false で操作確認し、本番切替時に true にする。
 */
window.EXHIBITION_CONFIG = Object.freeze({
  onlineEnabled: false,
  supabaseUrl: 'https://qdexhwgzawisiklekfzm.supabase.co',
  anonKey: 'sb_publishable__mWzF7WQI5BimtlT4Rmglg_9IRh25LV',
  createFunctionName: 'exhibition-order',
  slackFunctionName: 'exhibition-slack',
  eventId: 'neo-tokyo-2026',
  eventName: 'NEO TOKYO 2026',
  eventDate: '2026-10-06',
  productCsv: 'product_master.csv',
  currency: 'JPY',
  pollSeconds: 8,
  accounts: ['名古屋眼鏡','内田屋','三共社','ヤブシタ','エンパイヤ','スドー','オリエント','その他'],
  staffNames: ['堂前','小野村','宮川','増田','上阪（優）','上阪（政）','徳井','尾形','植村','西村']
});
