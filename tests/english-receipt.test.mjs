import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as attachments from '../order-attachments.js';
import * as flow from '../workflow.js';
import {receiptImagePath} from '../receipt-share.js';

const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').split("$('loginBtn').onclick=login;")[0];
const elements=new Map();
const ctx=vm.createContext({...attachments,...flow,window:{EXHIBITION_CONFIG:{},print(){}},document:{title:'展示会 注文管理',getElementById(id){if(!elements.has(id))elements.set(id,{innerHTML:'',classList:{add(){},remove(){}}});return elements.get(id)}},URL,setTimeout(){},clearTimeout(){}});
vm.runInContext(source+'\nglobalThis.subject={receiptDocumentHtml,printOrders};',ctx);
const order={localId:'00000000-0000-4000-8000-000000000001',type:'spot',handoff:'later',pickupNumber:'12',receiptNo:'RECEIPT-001',customerRegion:'overseas',customer:'Alex Tan',store:'Example Optical',phone:'+81 000',paymentMethod:'on_pickup',notes:'INTERNAL-NOTE',staff:'INTERNAL-STAFF',account:'INTERNAL-ACCOUNT',items:[{code:'TEST-001',name:'登録商品名',qty:2,price:100}]};

test('海外のお客様控えだけを英語化し国内・社内注文書は日本語を維持する',()=>{
  const en=ctx.subject.receiptDocumentHtml(order,{customerCopy:true});
  for(const text of ['Customer Copy','Order No.','Pickup No.','NEO-12','Customer','Order Details','Payment on pickup','Unit Price','Currency: JPY','Alex Tan','登録商品名'])assert.ok(en.includes(text),text);
  assert.doesNotMatch(en,/お客様控え|お渡し番号|Alex Tan 様|INTERNAL-/);
  for(const customerRegion of ['domestic','',undefined])assert.match(ctx.subject.receiptDocumentHtml({...order,customerRegion},{customerCopy:true}),/お客様控え/);
  assert.match(ctx.subject.receiptDocumentHtml(order),/展示会 注文書/);
});

test('英語の送料と支払済み表示でも番号・合計・商品点数を維持する',()=>{
  const paid={...order,paid:true,paymentMethod:'cash',items:order.items.map(item=>({...item}))};flow.addShippingFee(paid,'fee');
  const html=ctx.subject.receiptDocumentHtml(paid,{customerCopy:true});
  for(const value of ['Paid (Cash)','Shipping (flat rate)','¥700','2 items','NEO-12'])assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/配送料|受け取り時会計/);
  for(const [handoff,label] of [['now','Immediate purchase'],['hotel','Hotel delivery'],['ship','Delivery to specified address']]){
    const other=ctx.subject.receiptDocumentHtml({...paid,handoff},{customerCopy:true});assert.ok(other.includes(label));assert.doesNotMatch(other,/Pickup No.|NEO-12/);
  }
  assert.match(ctx.subject.receiptDocumentHtml({...paid,customer:'<script>alert(1)</script>'},{customerCopy:true}),/&lt;script&gt;/);
});

test('英語控えの印刷フッターとファイル名も英語になり画像を別生成する',async()=>{
  ctx.subject.printOrders([order],'',false,{customerCopy:true});
  assert.match(elements.get('printArea').innerHTML,/Customer Copy/);assert.match(elements.get('printArea').innerHTML,/Printed \(JST\)/);
  assert.match(ctx.document.title,/^Customer_Copy_Alex Tan_\d{8}_\d{4}$/);
  const ja=ctx.subject.receiptDocumentHtml({...order,customerRegion:'domestic'},{customerCopy:true});
  const en=ctx.subject.receiptDocumentHtml(order,{customerCopy:true});
  assert.notEqual(await receiptImagePath(order.localId,ja),await receiptImagePath(order.localId,en));
});
