/*
 * 本番接続設定。
 * publishable/anon key はブラウザ公開用。service_role は絶対にここへ書かない。
 * onlineEnabled:true でスタッフログインと注文同期を有効にする。
 */
window.EXHIBITION_CONFIG = Object.freeze({
  onlineEnabled: true,
  supabaseUrl: 'https://qdexhwgzawisiklekfzm.supabase.co',
  anonKey: 'sb_publishable__mWzF7WQI5BimtlT4Rmglg_9IRh25LV',
  createFunctionName: 'exhibition-order',
  eventId: 'neo-tokyo-2026',
  eventName: 'NEO TOKYO 2026',
  eventDate: '2026-10-06',
  productCsv: 'product_master.csv',
  currency: 'JPY',
  pollSeconds: 3,
  accounts: ['名古屋眼鏡','内田屋','三共社','ヤブシタ','エンパイヤ','スドー','オリエント','その他'],
  staffNames: ['堂前','小野村','宮川','増田','上阪（優）','上阪（政）','徳井','尾形','植村','西村']
});
