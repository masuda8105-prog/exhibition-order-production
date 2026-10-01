import test from 'node:test';
import assert from 'node:assert/strict';
import {addShippingFee,isShippingItem,totalOf,orderTaxSummary,itemCountOf,batchSummary,validate,orderPayloadForCloud,orderFromCloudRow} from '../workflow.js';

const order=()=>({type:'spot',handoff:'hotel',store:'架空店舗',phone:'000',customer:'架空のお客様',paymentMethod:'credit',items:[{code:'TEST',name:'検証商品',price:100,qty:2}]});

test('別紙へ記入する配送情報は空欄でもホテル・指定先配送を確定できる',()=>{
  for(const handoff of ['hotel','ship'])assert.deepEqual(validate({...order(),handoff,hotelName:'',guestName:'',roomNo:'',checkoutDate:'',shipAddress:''}),[]);
  assert.ok(validate({...order(),customer:''}).includes('お客様名は必須です。'));
});

test('送料は連打しても700円（税抜）を1回だけ加算し、商品点数に含めずクラウド往復で保持する',()=>{
  const draft=order();
  assert.equal(addShippingFee(draft,'fee-1'),true);
  assert.equal(addShippingFee(draft,'fee-2'),false);
  const saved=orderFromCloudRow({id:'test',payload:orderPayloadForCloud(draft)});
  assert.equal(totalOf(saved),900);
  assert.equal(itemCountOf(saved),2);
  assert.deepEqual(orderTaxSummary(saved),{subtotal:900,tax:90,total:990});
  assert.equal(batchSummary([saved]).total,900);
  assert.equal(batchSummary([saved]).items,2);
  assert.deepEqual(validate(saved),[]);
  saved.items=saved.items.filter(item=>!isShippingItem(item));
  assert.equal(totalOf(saved),200);
  assert.equal(addShippingFee(saved,'fee-3'),true);
  assert.equal(totalOf(saved),900);
});

test('送料だけの注文や送料の二重計上・数量変更を保存しない',()=>{
  const draft=order();addShippingFee(draft,'fee');
  const fee=draft.items.find(isShippingItem);
  assert.ok(validate({...draft,items:[fee]}).includes('商品を1点以上追加してください。'));
  for(const items of [[...draft.items,fee],[draft.items[0],{...fee,qty:2}],[draft.items[0],{...fee,price:600}]])assert.ok(validate({...draft,items}).some(message=>message.includes('送料は1注文につき700円')));
});

test('旧送料500円・600円の注文は元の金額を保持し、追加送料を重複させない',()=>{
  for(const amount of [500,600]){
    const old=order();old.items.push({productId:`service-shipping-${amount}`,code:'送料',name:'配送料（一律）',price:amount,qty:1});
    assert.deepEqual(validate(old),[]);
    assert.equal(totalOf(old),200+amount);
    assert.deepEqual(orderTaxSummary(old),{subtotal:200+amount,tax:Math.round((200+amount)*0.1),total:Math.round((200+amount)*1.1)});
    assert.equal(addShippingFee(old,'new-fee'),false);
  }
});
