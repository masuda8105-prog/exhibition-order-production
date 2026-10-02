import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as attachments from '../order-attachments.js';
import * as flow from '../workflow.js';

const pickup={type:'spot',handoff:'later',pickupNumber:'12',pickupDate:'2099-01-02',receiptNo:'受付-別番号',localId:'fixture',customer:'架空のお客様',store:'架空店舗',items:[{code:'TEST',name:'商品',price:100,qty:1}]};
test('NEO番号は翌日・翌々日の後日受取だけに表示し、受付番号と分離する',()=>{
  assert.equal(flow.pickupNumberLabel(pickup),'NEO-12');
  for(const handoff of ['now','hotel','ship'])assert.equal(flow.pickupNumberLabel({...pickup,handoff}),'');
  assert.equal(flow.pickupNumberLabel({...pickup,type:'normal'}),'');
  for(const pickupNumber of ['',0,'-1','<script>'])assert.equal(flow.pickupNumberLabel({...pickup,pickupNumber}),'');
  assert.equal(flow.pickupNumberLabel({...pickup,delivered:true}),'NEO-12');
  for(const term of ['NEO-12','neo-12','12'])assert.equal(flow.orderMatchesSearch(pickup,term),true);
});

test('番号はDB専用列から復元し、端末の番号を送信・信頼しない',()=>{
  const payload=flow.orderPayloadForCloud(pickup);
  assert.equal(Object.hasOwn(payload,'pickupNumber'),false);
  assert.equal(Object.hasOwn(payload,'pickup_number'),false);
  const restored=flow.orderFromCloudRow({id:'fixture',pickup_number:12,payload:{...payload,pickupNumber:'999'}});
  assert.equal(restored.pickupNumber,'12');assert.equal(restored.receiptNo,pickup.receiptNo);
  assert.equal(flow.orderFromCloudRow({payload:{...payload,pickupNumber:'999'}}).pickupNumber,'');
});

test('一覧・注文書・お客様控えは同じNEO番号を表示し、送料を合計に含める',async()=>{
  const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').split("$('loginBtn').onclick=login;")[0];
  const ctx=vm.createContext({...attachments,...flow,window:{EXHIBITION_CONFIG:{}},document:{},URL,setTimeout(){},clearTimeout(){}});
  vm.runInContext(source+'\nglobalThis.subject={cardHtml,receiptDocumentHtml};',ctx);
  const order={...pickup,items:pickup.items.map(item=>({...item}))};flow.addShippingFee(order,'fee');
  for(const html of [ctx.subject.cardHtml(order),ctx.subject.receiptDocumentHtml(order),ctx.subject.receiptDocumentHtml(order,{customerCopy:true})]){
    assert.match(html,/お渡し番号/);assert.match(html,/<strong>NEO-12<\/strong>/);assert.match(html,/¥800/);assert.match(html,/1点/);
  }
  const companyCopy=ctx.subject.receiptDocumentHtml(order);
  assert.match(companyCopy,/税抜合計<\/span><span>¥800/);
  assert.match(companyCopy,/消費税（10%）<\/span><span>¥80/);
  assert.match(companyCopy,/税込合計<\/span><span>¥880/);
  assert.match(companyCopy,/^<div class="receiptCopyLabel">会社控え<\/div>/);
  assert.ok(companyCopy.indexOf('receiptInfoBand')<companyCopy.indexOf('receiptPickupNumber'));
  assert.match(companyCopy,/お受け取り時に、この番号をご提示ください。/);
  assert.match(companyCopy,/お渡し日 2099\/01\/02　13時以降/);
  const customerCopy=ctx.subject.receiptDocumentHtml(order,{customerCopy:true});
  assert.match(customerCopy,/^<div class="receiptCopyLabel">お客様控え<\/div>/);
  assert.match(customerCopy,/配送料（一律）/);
  assert.ok(customerCopy.indexOf('receiptInfoBand')<customerCopy.indexOf('receiptPickupNumber'));
  assert.match(customerCopy,/お渡し日 2099\/01\/02　13時以降/);
  assert.doesNotMatch(customerCopy,/class="receiptInfoLabel">受け渡し</);
  assert.doesNotMatch(companyCopy,/class="receiptInfoLabel">受け渡し</);
  for(const handoff of ['now','hotel','ship']){
    const other=ctx.subject.receiptDocumentHtml({...order,handoff},{customerCopy:true});
    assert.doesNotMatch(other,/receiptPickupSchedule|13時以降/);
  }
});

test('商品ごとに丸めた税込合計を会社控えとお客様控えに表示する',async()=>{
  const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').split("$('loginBtn').onclick=login;")[0];
  const ctx=vm.createContext({...attachments,...flow,window:{EXHIBITION_CONFIG:{}},document:{},URL,setTimeout(){},clearTimeout(){}});
  vm.runInContext(source+'\nglobalThis.subject={receiptDocumentHtml};',ctx);
  const order={...pickup,items:[{code:'ROUND',name:'端数計算の検証商品',price:105,qty:2}]};
  for(const html of [ctx.subject.receiptDocumentHtml(order),ctx.subject.receiptDocumentHtml(order,{customerCopy:true})]){
    assert.match(html,/税抜合計<\/span><span>¥210/);
    assert.match(html,/消費税（10%）<\/span><span>¥22/);
    assert.match(html,/税込合計<\/span><span>¥232/);
  }
});
