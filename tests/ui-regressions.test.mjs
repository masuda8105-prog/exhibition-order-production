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

test('QRは控え画像だけを共有し旧匿名注文APIを再開しない',()=>{
  assert.doesNotMatch(index,/receiptView/);
  assert.match(index,/qrcode\.min\.js/);
  assert.match(index,/html2canvas\.min\.js/);
  assert.doesNotMatch(app,/showPublicReceipt|publicToken|functions\/v1\/exhibition-order/);
  assert.match(server,/cloud_order_storage_disabled/);
  assert.match(server,/status:410/);
});

test('認証状態は端末に保持し更新トークンを安全に更新する',()=>{
  assert.match(app,/localStorage\.setItem\(PERSISTENT_SESSION_KEY/);
  assert.match(app,/navigator\.locks\.request/);
  assert.match(app,/grant_type=refresh_token/);
  assert.match(app,/logout\?scope=local/);
  assert.match(app,/\$\('loginPassword'\)\.value=''/);
});
test('注文はクラウド保存を確認してから完了し自動同期する',()=>{
  assert.match(app,/exhibition_app_orders/);
  assert.match(app,/return=representation/);
  assert.match(app,/SAVE_NOT_CONFIRMED/);
  assert.match(app,/SYNC_CONFLICT/);
  assert.match(app,/setInterval/);
  assert.match(app,/12000/);
  assert.doesNotMatch(app,/localStorage\.setItem\([^\n]*orders/i);
});
test('印刷後も保存済み注文と顧客情報を保持する',()=>{
  assert.match(app,/window\.print\(\)/);
  assert.match(app,/addEventListener\('afterprint'/);
  assert.doesNotMatch(app,/window\.print\(\);\s*\$\('printArea'\)\.innerHTML=''/);
  assert.doesNotMatch(app,/purgePrintedOrders|purgePrintedOrderData/);
  assert.match(app,/注文データは保存したままです/);
  assert.match(app,/document\.title=printFileBase\(list,\{customerCopy\}\)/);
  assert.match(app,/document\.title=printOriginalTitle/);
});

test('保存応答が途切れた再試行は重複を防ぎ変更内容を保持する',()=>{
  assert.match(app,/order\.clientSubmissionId=id/);
  assert.match(app,/error\.status!==409/);
  assert.match(app,/previousPayload=order\.pendingSavePayload/);
  assert.match(app,/patchCloudOrder\(existing,\{payload\}\)/);
});

test('別スタッフの既存注文を編集しても担当者名を保持する',()=>{
  assert.match(app,/new Set\(\[d\.staff,state\.staff\?\.display_name\]/);
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

test('3状態タブを残し検索は全状態を横断する',()=>{
  assert.match(app,/orderMatchesSearch\(order,q\)/);
  assert.match(index,/id="orderCount"/);
  assert.match(index,/id="tabs"/);
  assert.match(app,/renderTabs/);
  assert.match(app,/すべての状態から検索/);
  assert.doesNotMatch(app,/本社未共有|showShareConfirm/);
});

test('印刷レイアウトと主要タップ領域を維持する',()=>{
  assert.match(app,/sort\(compareOrdersForPrint\)/);
  assert.match(app,/<th>卸屋・帳合先<\/th>/);
  assert.match(styles,/\.batchTable\{font-size:7\.5px;line-height:1\.15;table-layout:fixed\}/);
  assert.match(styles,/html,body\{max-width:100%;overflow-x:hidden\}/);
  assert.match(styles,/\.secondary,\.primary,\.dangerBtn\{[^}]*min-height:48px/);
});

test('対象の注文だけ共有チェックを表示し、注文確定で区分に応じて状態を決める',()=>{
  assert.match(app,/slackShared:false,slackSharedAt:'',workflowStatus:'active'/);
  assert.match(app,/slackSharedField\(d,'fSlackShared'\)/);
  assert.match(app,/slackSharedField\(order,'detailSlackShared'\)/);
  assert.match(app,/変更を確定':'注文確定'/);
  assert.doesNotMatch(app,/注文を保存/);
  assert.match(app,/if\(!needsHeadOfficeShare\(order\)\)return ''/);
  assert.match(app,/d\.workflowStatus=statusOnConfirmation\(/);
});

test('Slackチェック横の共有ボタンで既存の注文書を印刷し未確定表示を加えない',()=>{
  assert.match(app,/class="slackShareRow"/);
  assert.match(app,/aria-label="Slack共有用にPDF保存・印刷">共有/);
  assert.match(app,/\$\('fSlackSharedPrint'\)\.onclick/);
  assert.match(app,/\$\('detailSlackSharedPrint'\)\.onclick=\(\)=>printOrder\(order\)/);
  assert.doesNotMatch(app,/printDraftNotice|確認用・未確定|draftPreview/);
  assert.match(styles,/\.slackShareRow\{display:flex/);
});

test('一括印刷は全注文・全期間を標準とし国内専用の選択を出さない',()=>{
  assert.match(index,/展示会の全注文データを印刷/);
  assert.match(app,/showPrintDateOptions\(mode='all'/);
  assert.doesNotMatch(app,/printNormalBatch|printAllBatch|kind==='normal'/);
});

test('日付とQRボタンの寸法を固定し日付クイック選択で画面を作り直さない',()=>{
  assert.match(styles,/input\[type="date"\][^{]*\{[^}]*min-width:0[^}]*height:48px/);
  assert.match(styles,/\.customerCopyAction\{[^}]*white-space:nowrap/);
  assert.match(app,/\$\('fPickup'\)\.value=d\.pickupDate;updateQuickDates\(\)/);
});

test('未受取の後日受取だけにお渡し済みボタンを出し、完了への直接変更を防ぐ',()=>{
  assert.match(app,/isPickupOrder\(order\)&&!order\.delivered/);
  assert.match(app,/data-handover=/);
  assert.match(app,/id="handOverBtn"/);
  assert.match(app,/markPickupDelivered\(order\)/);
  assert.match(app,/disabled=!order\.delivered/);
  assert.match(app,/pendingHandovers\.has\(id\)/);
  assert.match(styles,/\.handoverButton\{[^}]*min-height:48px/);
});
