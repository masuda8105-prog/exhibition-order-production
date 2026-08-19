import test from 'node:test';import assert from 'node:assert/strict';
import {ORDER_TYPE,HANDOFF,PAYMENT,needsHeadOfficeShare,needsReceipt,customerNameWithHonorific,receiptInternalInfo,validate,isDone,groupOf,nextAction,compareOrdersForPrint,applyAction} from '../workflow.js';

const item={code:'1054',name:'x',price:100,qty:1};

test('控えのお客様名へ敬称を重複なく付ける',()=>{
  assert.equal(customerNameWithHonorific('山田 太郎'),'山田 太郎 様');
  assert.equal(customerNameWithHonorific('山田 太郎 様'),'山田 太郎 様');
  assert.equal(customerNameWithHonorific('株式会社テスト 御中'),'株式会社テスト 御中');
  assert.equal(customerNameWithHonorific(''),'-');
});

test('お客様控えには本社共有済み・未共有を表示しない',()=>{
  const shared={type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,headOfficeShared:true};
  const unshared={...shared,headOfficeShared:false};
  assert.deepEqual(receiptInternalInfo(shared,{customerCopy:true}),{showStatus:false,showHandoff:false,showCreatedAt:false,showGuide:false,headOfficeShare:''});
  assert.deepEqual(receiptInternalInfo(unshared,{customerCopy:true}),{showStatus:false,showHandoff:false,showCreatedAt:false,showGuide:false,headOfficeShare:''});
  assert.equal(receiptInternalInfo(shared).headOfficeShare,'共有済み');
  assert.equal(receiptInternalInfo(unshared).headOfficeShare,'未共有');
});

test('国内通常注文は卸屋・帳合先と担当必須',()=>{
  const order={type:ORDER_TYPE.NORMAL,items:[item],store:'A',phone:'1',account:'',staff:''};
  assert.equal(validate(order).length,2);
});

test('国内通常注文は登録時点で完了',()=>{
  const order={type:ORDER_TYPE.NORMAL,items:[item],store:'A',phone:'1',account:'卸屋',staff:'担当'};
  assert.equal(isDone(order),true);
  assert.equal(groupOf(order),'done');
});

test('一括印刷は区分順、その中で卸屋・帳合先順に並ぶ',()=>{
  const orders=[
    {localId:'later',type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,store:'C'},
    {localId:'normal-b',type:ORDER_TYPE.NORMAL,account:'中央卸',store:'B'},
    {localId:'normal-a',type:ORDER_TYPE.NORMAL,account:'あおば卸',store:'A'},
    {localId:'now',type:ORDER_TYPE.SPOT,handoff:HANDOFF.NOW,store:'D'},
    {localId:'normal-empty',type:ORDER_TYPE.NORMAL,account:'',store:'Z'},
  ];
  assert.deepEqual(orders.sort(compareOrdersForPrint).map(order=>order.localId),['normal-a','normal-b','normal-empty','now','later']);
});

test('その場渡しは受付番号も本社共有も不要',()=>{
  const order={type:ORDER_TYPE.SPOT,handoff:HANDOFF.NOW};
  assert.equal(needsReceipt(order),false);
  assert.equal(needsHeadOfficeShare(order),false);
});

test('その場渡しは会計・お渡し完了で完了',()=>{
  const order={type:ORDER_TYPE.SPOT,handoff:HANDOFF.NOW,paid:true,delivered:true};
  assert.equal(isDone(order),true);
  assert.equal(groupOf(order),'done');
});

test('後日受取は本社未共有なら要対応',()=>{
  const order={type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,headOfficeShared:false,paid:false,delivered:false};
  assert.equal(needsReceipt(order),true);
  assert.equal(needsHeadOfficeShare(order),true);
  assert.equal(groupOf(order),'active');
  assert.deepEqual(nextAction(order),{key:'share',label:'本社共有済みにする'});
});

test('後日受取は本社共有後に受取待ち',()=>{
  const order=applyAction({type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,headOfficeShared:false},'share');
  assert.equal(groupOf(order),'waiting');
  assert.equal(nextAction(order).key,'deliver');
});

test('後日受取は会計・商品お渡し後に完了',()=>{
  let order=applyAction({type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,headOfficeShared:false},'share');
  order=applyAction(order,'deliver');
  assert.equal(order.paid,true);
  assert.equal(order.delivered,true);
  assert.equal(isDone(order),true);
});

test('ホテル配送は本社共有済みで完了',()=>{
  let order={type:ORDER_TYPE.SPOT,handoff:HANDOFF.HOTEL,headOfficeShared:false};
  assert.equal(groupOf(order),'active');
  order=applyAction(order,'share');
  assert.equal(isDone(order),true);
  assert.equal(groupOf(order),'done');
});

test('指定先配送も本社共有済みで完了',()=>{
  const order=applyAction({type:ORDER_TYPE.SPOT,handoff:HANDOFF.SHIP,headOfficeShared:false},'share');
  assert.equal(isDone(order),true);
});

test('価格未定の商品は受注できない',()=>{
  const order={type:ORDER_TYPE.NORMAL,items:[{code:'141-802',name:'x',price:null,qty:1}],store:'A',phone:'1',account:'X',staff:'Y'};
  assert.equal(validate(order).includes('価格未定の商品は注文できません。'),true);
});

test('数量0の商品は受注できない',()=>{
  const order={type:ORDER_TYPE.NORMAL,items:[{code:'1054',name:'x',price:100,qty:0}],store:'A',phone:'1',account:'X',staff:'Y'};
  assert.equal(validate(order).includes('商品数量が不正です。'),true);
});

test('現売りはお客様名と会計方法が必須',()=>{
  const order={type:ORDER_TYPE.SPOT,handoff:HANDOFF.NOW,items:[item],store:'A',phone:'1',customer:'',paymentMethod:PAYMENT.NONE};
  assert.equal(validate(order).includes('お客様名は必須です。'),true);
  assert.equal(validate(order).includes('会計方法を選択してください。'),true);
});
