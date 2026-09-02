import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [index,app,styles,server,security,browserFixture]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../app.js',import.meta.url),'utf8'),
  readFile(new URL('../styles.css',import.meta.url),'utf8'),
  readFile(new URL('../supabase/functions/exhibition-order/index.ts',import.meta.url),'utf8'),
  readFile(new URL('../security.js',import.meta.url),'utf8'),
  readFile(new URL('./browser-fixture-server.mjs',import.meta.url),'utf8'),
]);

test('未認証画面はスタッフログインだけを表示する',()=>{
  assert.match(index,/id="loginEmail"/);
  assert.match(index,/id="loginPassword"/);
  assert.match(index,/id="loginBtn"/);
  assert.doesNotMatch(index,/id="demoBtn"/);
  assert.doesNotMatch(app,/local-development/);
  assert.match(app,/grant_type=password/);
  assert.match(browserFixture,/invalid_credentials/);
});

test('QR公開控えと匿名注文取得を公開画面から除去する',()=>{
  assert.doesNotMatch(index,/receiptView|qrcode\.min\.js|html2canvas\.min\.js/);
  assert.doesNotMatch(app,/showPublicReceipt|publicToken|functions\/v1\/exhibition-order/);
  assert.match(server,/cloud_order_storage_disabled/);
  assert.match(server,/status:410/);
});

test('認証セッションはタブ終了で消えるsessionStorageだけを使う',()=>{
  assert.match(app,/sessionStorage\.setItem\(SESSION_STORAGE_KEY/);
  assert.match(app,/sessionStorage\.removeItem\(SESSION_STORAGE_KEY\)/);
  assert.doesNotMatch(app,/localStorage\.setItem\([^\n]*(session|orders)/i);
  assert.match(app,/\$\('loginPassword'\)\.value=''/);
});

test('注文はメモリだけに保持しクラウド保存処理を持たない',()=>{
  assert.match(app,/syncState:'memory'/);
  assert.match(app,/注文はこのタブのみ（保存なし）/);
  assert.doesNotMatch(app,/onlineCreate|onlinePatch|onlineLoad|localSave|syncPendingOrders/);
  assert.doesNotMatch(app,/exhibition_orders/);
});

test('印刷画面を閉じると顧客情報と注文明細を消去する',()=>{
  assert.match(app,/window\.print\(\);\s*purgePrintedOrders\(list\)/);
  assert.match(app,/purgePrintedOrderData\(state\.orders,list\)/);
  assert.match(app,/for\(const order of list\)wipeOrderData\(order\)/);
  for(const field of ['store','customer','phone','notes','account','pickupDate','shipAddress','hotelName','guestName'])assert.match(security,new RegExp(`'${field}'`));
  assert.match(security,/order\.items=\[\]/);
});

test('注文作成画面を閉じてもタブ内の下書きは再開できる',()=>{
  assert.match(app,/hasResumableDraft\(\)/);
  assert.match(app,/入力途中の注文を再開/);
  assert.match(app,/d\.productQuery=String\(query\|\|''\)/);
});

test('固定入力キーと商品の渡し方のスマホUIを維持する',()=>{
  assert.match(app,/const numeric=\[\['1'\],\['2'\],\['3'\],\['4'\],\['5'\],\['6'\],\['7'\],\['8'\],\['9'\],\['-'\],\['0'\],\['⌫','backspace'\]\]/);
  assert.match(app,/\['Q','W','E','R','T','Y','U','I','O','P'\]/);
  assert.match(app,/id="keypadAlignLeft"/);
  assert.match(styles,/productKeypad\.numberKeys\{grid-template-columns:repeat\(3,1fr\)\}/);
  assert.match(app,/choiceGrid handoffChoices/);
  assert.match(styles,/\.handoffChoices\{grid-template-columns:1fr\}/);
});

test('件数・絞り込み・検索はフォルダ横断の操作感を維持する',()=>{
  assert.match(app,/\(state\.filter\|\|q\)\|\|groupOf\(order\)===state\.tab/);
  assert.match(app,/orderMatchesOperationalFilter\(order,state\.filter\)/);
  assert.match(app,/orderMatchesSearch\(order,q\)/);
  assert.match(app,/検索結果.*全フォルダ/);
});

test('印刷レイアウトと主要タップ領域を維持する',()=>{
  assert.match(app,/sort\(compareOrdersForPrint\)/);
  assert.match(app,/<th>卸屋・帳合先<\/th>/);
  assert.match(styles,/\.batchTable\{font-size:7\.5px;line-height:1\.15;table-layout:fixed\}/);
  assert.match(styles,/html,body\{max-width:100%;overflow-x:hidden\}/);
  assert.match(styles,/\.secondary,\.primary,\.dangerBtn\{[^}]*min-height:48px/);
});
