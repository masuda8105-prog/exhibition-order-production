import test from 'node:test';import assert from 'node:assert/strict';
import {ORDER_TYPE,HANDOFF,PAYMENT,needsHeadOfficeShare,needsReceipt,totalOf,itemCountOf,phoneHasUnexpectedCharacters,createdDateInTokyo,filterOrdersByCreatedDate,orderMatchesOperationalFilter,orderMatchesSearch,batchSummary,customerNameWithHonorific,receiptInternalInfo,validate,isDone,groupOf,nextAction,compareOrdersForPrint,applyAction} from '../workflow.js';

const item={code:'TEST-001',name:'テスト商品',price:100,qty:1};

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
  const order={type:ORDER_TYPE.NORMAL,items:[{code:'TEST-PENDING',name:'テスト商品',price:null,qty:1}],store:'A',phone:'1',account:'X',staff:'Y'};
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

test('未会計は要対応と受取待ちを横断して件数と一覧が一致する',()=>{
  const active={type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,headOfficeShared:false,paid:false,delivered:false};
  const waiting={type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,headOfficeShared:true,paid:false,delivered:false};
  const done={type:ORDER_TYPE.SPOT,handoff:HANDOFF.NOW,headOfficeShared:false,paid:true,delivered:true};
  const result=[active,waiting,done].filter(order=>orderMatchesOperationalFilter(order,'unpaid'));
  assert.equal(result.length,2);
  assert.deepEqual(result.map(groupOf),['active','waiting']);
});

test('検索は店舗・受付番号・電話・品番・商品名を全フォルダから探す',()=>{
  const orders=[
    {store:'テスト店舗A',receiptNo:'N-001',phone:'03-1111',items:[{code:'TEST-001',name:'テスト商品A'}],type:ORDER_TYPE.NORMAL},
    {store:'テスト店舗B',receiptNo:'N-002',phone:'+81 6 2222',items:[{code:'TEST-002',name:'テスト商品B'}],type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,headOfficeShared:true},
  ];
  for(const query of ['店舗A','N-002','+81','TEST-001','商品B'])assert.equal(orders.filter(order=>orderMatchesSearch(order,query)).length,1);
});

test('電話番号は海外番号を許容し、想定外文字だけを警告する',()=>{
  for(const value of ['03-1234-5678','+81 (0)3 1234 5678','+82（2）123-4567'])assert.equal(phoneHasUnexpectedCharacters(value),false);
  assert.equal(phoneHasUnexpectedCharacters('03-ABCD-5678'),true);
  assert.equal(phoneHasUnexpectedCharacters('03/1234/5678'),true);
});

test('その他の卸屋・帳合先は具体名が必須',()=>{
  const base={type:ORDER_TYPE.NORMAL,items:[item],store:'A',phone:'1',staff:'担当',accountChoice:'その他',accountOther:'',account:''};
  assert.ok(validate(base).includes('卸屋・帳合先名を入力してください。'));
  const named={...base,accountOther:'地域卸A',account:'地域卸A'};
  assert.equal(validate(named).length,0);
});

test('日本時間の23:59と00:01は別の受付日になる',()=>{
  assert.equal(createdDateInTokyo({createdAt:'2099-01-01T14:59:00.000Z'}),'2099-01-01');
  assert.equal(createdDateInTokyo({created_at:'2099-01-01T15:01:00.000Z'}),'2099-01-02');
});

test('本日・指定期間・全期間の件数、点数、金額が一致する',()=>{
  const orders=[
    {createdAt:'2099-01-01T01:00:00Z',items:[{price:100,qty:2}],syncState:'synced',type:ORDER_TYPE.NORMAL},
    {created_at:'2099-01-02T01:00:00Z',items:[{price:250,qty:1}],syncState:'synced',type:ORDER_TYPE.NORMAL},
    {createdAt:'',items:[{price:500,qty:3}],syncState:'pending',type:ORDER_TYPE.NORMAL},
  ];
  const todayList=filterOrdersByCreatedDate(orders,{mode:'today',today:'2099-01-01'});
  const rangeList=filterOrdersByCreatedDate(orders,{mode:'range',start:'2099-01-01',end:'2099-01-02'});
  const allList=filterOrdersByCreatedDate(orders,{mode:'all'});
  assert.deepEqual(batchSummary(todayList),{orders:1,items:2,total:200,pending:0,unshared:0,active:0,waiting:0,unpaid:0});
  assert.equal(batchSummary(rangeList).orders,2);
  assert.deepEqual([batchSummary(allList).orders,batchSummary(allList).items,batchSummary(allList).total,batchSummary(allList).pending],[3,6,1950,1]);
  assert.equal(totalOf(orders[0]),200);assert.equal(itemCountOf(orders[2]),3);
});

test('指定日の開始日と終了日は両方を含む',()=>{
  const orders=['2098-12-31T12:00:00+09:00','2099-01-01T00:00:00+09:00','2099-01-02T23:59:00+09:00','2099-01-03T00:00:00+09:00'].map(createdAt=>({createdAt}));
  assert.equal(filterOrdersByCreatedDate(orders,{mode:'range',start:'2099-01-01',end:'2099-01-02'}).length,2);
});
