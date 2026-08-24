import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [index,app,styles,server]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../app.js',import.meta.url),'utf8'),
  readFile(new URL('../styles.css',import.meta.url),'utf8'),
  readFile(new URL('../supabase/functions/exhibition-order/index.ts',import.meta.url),'utf8'),
]);

test('お客様控えは長押し保存用の画像として表示する',()=>{
  assert.match(index,/id="receiptImagePreview"/);
  assert.doesNotMatch(index,/id="downloadReceiptImage"/);
  assert.doesNotMatch(index,/id="printPublicReceipt"/);
  assert.match(app,/preview\.src=dataUrl/);
  assert.doesNotMatch(app,/manualReceiptUrl/);
  assert.doesNotMatch(app,/copyReceiptUrl/);
  assert.doesNotMatch(app,/qrPrintBtn/);
  assert.match(app,/internalInfo\.showCreatedAt/);
  assert.match(app,/internalInfo\.showGuide/);
  assert.match(app,/internalInfo\.showHandoff/);
  assert.match(styles,/-webkit-touch-callout:default/);
  assert.match(app,/if\(!customerCopy\)info\.push\(\['卸屋・帳合先'/);
  assert.match(app,/!customerCopy&&order\.notes/);
});

test('注文作成画面を閉じても入力途中の下書きを保持する',()=>{
  const closeSheet=app.match(/function closeSheet\(\)\{([^}]+)\}/)?.[1]||'';
  assert.doesNotMatch(closeSheet,/state\.draft=null/);
  assert.match(app,/hasResumableDraft\(\)/);
  assert.match(app,/入力途中の注文を再開/);
  assert.match(app,/d\.productQuery=String\(query\|\|''\)/);
});

test('固定入力キーは検索欄直下のスマホ配列で左右を切り替えられる',()=>{
  const start=app.indexOf('function renderProductStep');
  const end=app.indexOf('function bindProductKeypad',start);
  const renderProductStep=app.slice(start,end);
  assert.ok(renderProductStep.indexOf('productSearchRow')<renderProductStep.indexOf('productKeypadDock'));
  assert.ok(renderProductStep.indexOf('productKeypadDock')<renderProductStep.indexOf('productResults'));
  assert.match(app,/const numeric=\[\['1'\],\['2'\],\['3'\],\['4'\],\['5'\],\['6'\],\['7'\],\['8'\],\['9'\],\['-'\],\['0'\],\['⌫','backspace'\]\]/);
  assert.match(app,/\['Q','W','E','R','T','Y','U','I','O','P'\]/);
  assert.match(app,/id="keypadAlignLeft"/);
  assert.match(app,/id="keypadAlignRight"/);
  assert.match(styles,/productKeypad\.numberKeys\{grid-template-columns:repeat\(3,1fr\)\}/);
  assert.match(styles,/productKeypadDock\.align-left/);
  assert.match(styles,/productKeypadDock\.align-right/);
});

test('商品の渡し方はすべて1列で表示する',()=>{
  assert.match(app,/choiceGrid handoffChoices/);
  assert.match(styles,/\.handoffChoices\{grid-template-columns:1fr\}/);
});

test('注文カードには不要な印刷対象ラベルを表示しない',()=>{
  assert.doesNotMatch(app,/印刷対象/);
  assert.match(styles,/\.batchTable\{font-size:7\.5px;line-height:1\.15;table-layout:fixed\}/);
  assert.match(styles,/\.batchTable th,\.batchTable td\{padding:2\.5px 3px\}/);
  assert.match(app,/sort\(compareOrdersForPrint\)/);
  assert.match(app,/<th>卸屋・帳合先<\/th>/);
});

test('本番ログイン画面に匿名の端末モード入口がない',()=>{
  assert.doesNotMatch(index,/id="demoBtn"/);
  assert.doesNotMatch(index,/端末モード/);
  assert.match(index,/id="loginNetworkGuide"/);
  assert.match(app,/location\.hostname==='127\.0\.0\.1'/);
  assert.match(app,/if\(cfg\.onlineEnabled&&!localDevelopment\)await bootOnline\(\);else startLocalDevelopment\(\)/);
});

test('件数カード・絞り込み・検索はタブより先に全フォルダを対象にする',()=>{
  assert.match(app,/\(state\.filter\|\|q\)\|\|groupOf\(order\)===state\.tab/);
  assert.match(app,/orderMatchesOperationalFilter\(order,state\.filter\)/);
  assert.match(app,/orderMatchesSearch\(order,q\)/);
  assert.match(app,/検索結果.*全フォルダ/);
  assert.match(app,/絞り込み結果/);
});

test('状態変更後は検索・絞り込みを解除して移動先を表示する',()=>{
  assert.match(app,/function revealOrder\(order\)\{clearListModes\(\);state\.tab=groupOf\(order\);render\(\)\}/);
  assert.match(app,/head_office_shared[\s\S]{0,120}revealOrder\(order\)/);
  assert.match(app,/delivered[\s\S]{0,120}revealOrder\(order\)/);
});

test('下書きは再開・破棄キャンセル・破棄確定を選べる',()=>{
  assert.match(index,/id="discardDraftBtn"/);
  assert.match(app,/追加済み商品/);
  assert.match(app,/入力済み店舗/);
  assert.match(app,/discardCancel'\)\.onclick=renderDraft/);
  assert.match(app,/discardConfirm'\)\.onclick=\(\)=>\{state\.draft=null;startOrder\(\)/);
});

test('現売りの渡し方は初期未選択で番号は1から4',()=>{
  assert.doesNotMatch(app,/d\.handoff=HANDOFF\.NOW/);
  assert.match(app,/1　在庫あり・その場渡し/);
  assert.match(app,/2　翌日・翌々日に受取/);
  assert.match(app,/3　ホテルへ配送/);
  assert.match(app,/4　指定住所へ配送/);
  assert.match(app,/商品の渡し方を選択してください/);
});

test('その他の卸屋名は具体名を保存し既存候補外も復元する',()=>{
  assert.match(app,/id="fAccountOther"/);
  assert.match(app,/d\.account=d\.accountChoice==='その他'\?d\.accountOther:d\.accountChoice/);
  assert.match(app,/accounts\.includes\(d\.account\)\?d\.account:'その他'/);
});

test('QR失敗は保存済み注文から同じ送信IDで再試行する',()=>{
  assert.match(app,/注文は保存済み・QRは未発行/);
  assert.match(app,/retryQr'\)\.onclick=\(\)=>showReceiptQr\(saved\)/);
  assert.match(app,/state\.orders\.find\(item=>item\.localId===order\.localId\)\|\|order/);
  assert.match(server,/\.eq\("client_submission_id", clientSubmissionId\)/);
  assert.match(server,/duplicatePrevented: true/);
});

test('修正保存は既存の公開トークンと注文識別子を維持する',()=>{
  assert.match(app,/publicToken:current\.publicToken/);
  assert.match(app,/clientSubmissionId:current\.clientSubmissionId/);
  assert.match(app,/localId:current\.localId/);
  assert.match(app,/createdAt:current\.createdAt/);
});

test('提出前確認は日付・件数・未同期を表示し最終提出を停止する',()=>{
  assert.match(app,/対象受付日と出力前確認/);
  assert.match(app,/本日[\s\S]*日付を指定[\s\S]*全期間/);
  assert.match(app,/summary\.pending>0/);
  assert.match(app,/最終提出を停止しました/);
  assert.match(app,/受付日時/);
});

test('受付日時をカードと詳細へ表示する',()=>{
  assert.match(app,/class="receivedAt">受付/);
  assert.match(app,/<span>作成日時<\/span>/);
  assert.match(app,/<span>最終更新日時<\/span>/);
});

test('小さい端末の主要操作は横にはみ出さず十分なタップ高さを持つ',()=>{
  assert.match(styles,/html,body\{max-width:100%;overflow-x:hidden\}/);
  assert.match(styles,/productKeypad\.numberKeys \.keypadKey[^{]*\{min-height:40px\}/);
  assert.match(styles,/discardDraftBtn\{min-height:44px/);
  assert.match(styles,/\.secondary,\.primary,\.dangerBtn\{[^}]*min-height:48px/);
  assert.match(app,/\['英字','alpha'\]/);
});
