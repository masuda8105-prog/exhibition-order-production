import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {receiptImagePath,signedReceiptUrl,RECEIPT_LINK_SECONDS} from '../receipt-share.js';
import {groupOf,orderPayloadForCloud} from '../workflow.js';

test('3状態は明示的に変更でき、同期対象に含まれる',()=>{
  for(const workflowStatus of ['active','waiting','done']){
    const order={type:'normal',workflowStatus};
    assert.equal(groupOf(order),workflowStatus);
    assert.equal(orderPayloadForCloud(order).workflowStatus,workflowStatus);
  }
  assert.equal(groupOf({type:'normal',workflowStatus:'invalid'}),'done');
});

test('画像パスは個人情報を含まず同じ控えを重複アップロードしない',async()=>{
  const id='00000000-0000-4000-8000-000000000001';
  const path=await receiptImagePath(id,'架空店舗の控え');
  assert.match(path,/^[0-9a-f-]{36}\/[a-f0-9]{32}\.png$/);
  assert.equal(path,await receiptImagePath(id,'架空店舗の控え'));
  assert.notEqual(path,await receiptImagePath(id,'更新された控え'));
  await assert.rejects(()=>receiptImagePath('../invalid','test'));
});

test('共有URLは同じSupabaseの署名付き控え画像に限定する',()=>{
  const base='https://fixture.supabase.co';
  assert.equal(RECEIPT_LINK_SECONDS,604800);
  assert.equal(signedReceiptUrl(base,'/object/sign/exhibition-receipts/test.png?token=fixture'),'https://fixture.supabase.co/storage/v1/object/sign/exhibition-receipts/test.png?token=fixture');
  for(const input of ['https://invalid.example','//invalid.example','/object/public/exhibition-receipts/test.png','/object/sign/exhibition-receipts/test.png','/object/sign/exhibition-receipts/../../products?token=test'])assert.throws(()=>signedReceiptUrl(base,input));
});

test('控えはPNGだけを非公開保存し社内情報を含めない',async()=>{
  const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
  assert.match(app,/receiptDocumentHtml\(current,\{customerCopy:true\}\)/);
  assert.match(app,/canvas\.toBlob\(resolve,'image\/png'\)/);
  assert.match(app,/'Cache-Control':'max-age=0'/);
  assert.match(app,/expiresIn:RECEIPT_LINK_SECONDS/);
  assert.doesNotMatch(app,/object\/public\/|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(app,/\$\{item\.qty\}/);
});

test('控え画像の保存先は非公開・有効スタッフ限定・注文に紐づく',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260903004533_private_customer_receipt_images.sql',import.meta.url),'utf8');
  assert.match(sql,/'exhibition-receipts','exhibition-receipts',false/);
  assert.match(sql,/array\['image\/png'\]/);
  assert.match(sql,/for insert to authenticated/);
  assert.match(sql,/for select to authenticated/);
  assert.match(sql,/s\.active=true/);
  assert.match(sql,/o\.deleted_at is null/);
  assert.doesNotMatch(sql,/to anon|security definer|for update/i);
});
