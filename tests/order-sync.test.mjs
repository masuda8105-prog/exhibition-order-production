import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ORDER_TYPE,HANDOFF,groupOf,setSlackShared,statusOnConfirmation,isPickupOrder,markPickupDelivered,needsHeadOfficeShare,normalizeForSave,orderPayloadForCloud,orderFromCloudRow} from '../workflow.js';

test('Slack共有チェックは後日受取と配送だけに適用し、解除で要対応に戻す',()=>{
  const stamp='2099-01-01T12:34:56Z';
  for(const order of [{type:ORDER_TYPE.NORMAL},...Object.values(HANDOFF).map(handoff=>({type:ORDER_TYPE.SPOT,handoff}))]){
    if(!needsHeadOfficeShare(order)){assert.deepEqual(setSlackShared(order,true,stamp),order);continue}
    const checked=setSlackShared({...order,workflowStatus:'waiting'},true,stamp);
    assert.equal(groupOf(checked),isPickupOrder(order)?'waiting':'done');assert.equal(checked.slackShared,true);assert.equal(checked.slackSharedAt,stamp);
    const unchecked=setSlackShared(checked,false);assert.equal(groupOf(unchecked),'active');assert.equal(unchecked.slackSharedAt,'');
    assert.equal(order.slackShared,undefined);
  }
});

test('共有確認は日時ごと同期し通常編集では共有日時と手動状態を保持する',()=>{
  const checked=setSlackShared({type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,items:[]},true,'2099-01-01T12:34:56Z');
  assert.equal(setSlackShared(checked,true).slackSharedAt,checked.slackSharedAt);
  const payload=orderPayloadForCloud(normalizeForSave({...checked,workflowStatus:'waiting',notes:'架空メモ'}));
  const restored=orderFromCloudRow({id:'fixture-id',payload});
  assert.equal(restored.slackShared,true);assert.equal(restored.slackSharedAt,checked.slackSharedAt);assert.equal(groupOf(restored),'waiting');
});

test('通常とその場渡しは確定で完了、共有後の後日受取は待ち、配送は完了',()=>{
  for(const order of [{type:ORDER_TYPE.NORMAL},...Object.values(HANDOFF).map(handoff=>({type:ORDER_TYPE.SPOT,handoff}))]){
    assert.equal(statusOnConfirmation({...order,workflowStatus:'active'}),needsHeadOfficeShare(order)?'active':'done');
    assert.equal(statusOnConfirmation({...order,slackShared:true}),isPickupOrder(order)?'waiting':'done');
  }
  const waiting={type:ORDER_TYPE.SPOT,handoff:HANDOFF.HOTEL,workflowStatus:'waiting'};
  assert.equal(statusOnConfirmation(waiting,waiting),'waiting');
  assert.equal(statusOnConfirmation({...waiting,workflowStatus:'done'},{type:ORDER_TYPE.NORMAL}),'active');
});

test('旧版で共有だけで完了になった後日受取はデータを書き換えず待ちへ表示する',()=>{
  for(const shared of [false,true]){
    const original={type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,slackShared:shared,workflowStatus:'done',delivered:false};
    assert.equal(groupOf(original),'waiting');assert.equal(original.workflowStatus,'done');
    assert.notEqual(statusOnConfirmation(original,original),'done');
  }
  assert.equal(groupOf({type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,slackShared:true}),'waiting');
});

test('会計済みの後日受取をお渡し完了し、会計や共有状態は勝手に変えない',()=>{
  const original={type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,slackShared:false,paid:true,paymentMethod:'cash',workflowStatus:'active',items:[]};
  const delivered=markPickupDelivered(original,'2099-01-02T12:00:00Z');
  assert.equal(delivered.delivered,true);assert.equal(groupOf(delivered),'done');assert.equal(statusOnConfirmation(delivered,original),'done');
  assert.equal(delivered.paid,true);assert.equal(delivered.paymentMethod,'cash');assert.equal(delivered.slackShared,false);assert.equal(original.delivered,undefined);
  assert.equal(markPickupDelivered(delivered).deliveredAt,delivered.deliveredAt);
  for(const shared of [false,true])assert.equal(groupOf(setSlackShared(delivered,shared)),'done');
  for(const handoff of [HANDOFF.NOW,HANDOFF.HOTEL,HANDOFF.SHIP]){const order={type:ORDER_TYPE.SPOT,handoff};assert.deepEqual(markPickupDelivered(order),order)}
});

test('お渡し状況と日時を同期し、旧注文には架空のお渡し日時を付けない',()=>{
  const payload=orderPayloadForCloud(markPickupDelivered({type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,paid:true,paymentMethod:'credit'},'2099-01-02T12:00:00Z'));
  const restored=orderFromCloudRow({id:'fixture-id',payload});
  assert.equal(restored.delivered,true);assert.equal(restored.deliveredAt,'2099-01-02T12:00:00Z');assert.equal(groupOf(restored),'done');
  assert.equal(orderPayloadForCloud({delivered:true}).deliveredAt,'');
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
