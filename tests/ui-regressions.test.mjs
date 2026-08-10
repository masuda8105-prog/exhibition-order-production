import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [index,app,styles]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../app.js',import.meta.url),'utf8'),
  readFile(new URL('../styles.css',import.meta.url),'utf8'),
]);

test('お客様控えは長押し保存用の画像として表示する',()=>{
  assert.match(index,/id="receiptImagePreview"/);
  assert.doesNotMatch(index,/id="downloadReceiptImage"/);
  assert.match(app,/preview\.src=dataUrl/);
  assert.match(styles,/-webkit-touch-callout:default/);
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
