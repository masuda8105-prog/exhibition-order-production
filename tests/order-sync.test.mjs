import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ORDER_TYPE,HANDOFF,groupOf,setSlackShared,normalizeForSave,orderPayloadForCloud,orderFromCloudRow} from '../workflow.js';

test('Slack共有チェックで全区分を完了にし、解除で要対応に戻す',()=>{
  const stamp='2099-01-01T12:34:56Z';
  for(const order of [{type:ORDER_TYPE.NORMAL},...Object.values(HANDOFF).map(handoff=>({type:ORDER_TYPE.SPOT,handoff}))]){
    const checked=setSlackShared({...order,workflowStatus:'waiting'},true,stamp);
    assert.equal(groupOf(checked),'done');assert.equal(checked.slackShared,true);assert.equal(checked.slackSharedAt,stamp);
    const unchecked=setSlackShared(checked,false);assert.equal(groupOf(unchecked),'active');assert.equal(unchecked.slackSharedAt,'');
    assert.equal(order.slackShared,undefined);
  }
});

test('共有確認は日時ごと同期し通常編集では共有日時と手動状態を保持する',()=>{
  const checked=setSlackShared({type:ORDER_TYPE.NORMAL,items:[]},true,'2099-01-01T12:34:56Z');
  assert.equal(setSlackShared(checked,true).slackSharedAt,checked.slackSharedAt);
  const payload=orderPayloadForCloud(normalizeForSave({...checked,workflowStatus:'waiting',notes:'架空メモ'}));
  const restored=orderFromCloudRow({id:'fixture-id',payload});
  assert.equal(restored.slackShared,true);assert.equal(restored.slackSharedAt,checked.slackSharedAt);assert.equal(groupOf(restored),'waiting');
});

test('旧本社共有フラグをSlack共有とみなさず既存状態を維持する',()=>{
  const payload=orderPayloadForCloud({type:ORDER_TYPE.NORMAL,headOfficeShared:true});
  assert.equal(payload.slackShared,false);assert.equal(payload.slackSharedAt,'');assert.equal(groupOf(payload),'done');
  assert.equal(groupOf({...payload,workflowStatus:'active'}),'active');
});

test('同期する項目を限定し認証や画面状態を注文へ含めない',()=>{
  const source={store:'架空店舗',phone:'000',stage:'info',editingId:'edit',session:{access_token:'not-a-real-token'},items:[{code:'TEST',name:'架空商品',price:10,qty:2,privateExtra:'excluded'}]};
  const payload=orderPayloadForCloud(source);
  assert.equal(payload.store,'架空店舗');
  assert.equal(payload.items[0].qty,2);
  for(const key of ['stage','editingId','session'])assert.equal(key in payload,false);
  assert.equal('privateExtra' in payload.items[0],false);
});

test('サーバー日時とIDを正として注文を復元する',()=>{
  const row={id:'fixture-id',created_at:'2099-01-01T00:00:00Z',updated_at:'2099-01-02T00:00:00Z',payload:{localId:'wrong',store:'架空店舗',items:[{code:'TEST',qty:2}]}};
  const restored=orderFromCloudRow(row);
  assert.equal(restored.localId,'fixture-id');
  assert.equal(restored.cloudUpdatedAt,row.updated_at);
  assert.equal(restored.syncState,'synced');
  restored.items[0].qty=3;
  assert.equal(row.payload.items[0].qty,2);
});

test('注文同期はスタッフ限定RLS・列権限・ソフト削除で保護する',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260902070825_secure_app_order_sync.sql',import.meta.url),'utf8');
  assert.match(sql,/alter table public\.exhibition_app_orders enable row level security/);
  assert.match(sql,/revoke all on table public\.exhibition_app_orders from anon, authenticated/);
  assert.match(sql,/grant insert \(id, event_name, payload\)/);
  assert.match(sql,/grant update \(payload, deleted_at\)/);
  assert.doesNotMatch(sql,/grant delete/i);
  assert.match(sql,/staff\.active = true/);
  assert.match(sql,/security invoker/);
  assert.match(sql,/new\.updated_by := auth\.uid\(\)/);
});
