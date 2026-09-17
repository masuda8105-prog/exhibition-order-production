import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as attachments from '../order-attachments.js';
import * as flow from '../workflow.js';

const {ORDER_TYPE,HANDOFF,PAYMENT,paymentMethodOnHandoffChange,paymentMethodLabel,isPickupPaymentRecorded,markPickupPaid,markPickupDelivered,groupOf,validate,orderPayloadForCloud,orderFromCloudRow,normalizeForSave,printFileBase}=flow;
const pickup=()=>({localId:'fixture-pickup',type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,paymentMethod:PAYMENT.ON_PICKUP,paid:false,delivered:false,workflowStatus:'waiting',slackShared:true,receiptNo:'TEST-001',store:'架空店舗',phone:'000',customer:'架空担当',pickupDate:'2099-01-02',items:[{code:'TEST',name:'検証商品',qty:2,price:100}],createdAt:'2099-01-01T00:00:00Z',cloudUpdatedAt:'2099-01-01T00:00:00Z'});

test('未会計で後日受取へ切り替えると受け取り時会計、別の渡し方へ戻すと通常の方法に戻る',()=>{
  for(const handoff of [null,HANDOFF.NOW,HANDOFF.HOTEL,HANDOFF.SHIP])assert.equal(paymentMethodOnHandoffChange({...pickup(),handoff,paymentMethod:PAYMENT.CASH},HANDOFF.LATER),PAYMENT.ON_PICKUP);
  for(const handoff of [null,HANDOFF.NOW,HANDOFF.HOTEL,HANDOFF.SHIP])assert.equal(paymentMethodOnHandoffChange(pickup(),handoff),PAYMENT.CREDIT);
  assert.equal(paymentMethodOnHandoffChange({...pickup(),paymentMethod:PAYMENT.CASH},HANDOFF.LATER),PAYMENT.CASH);
  assert.equal(paymentMethodOnHandoffChange({...pickup(),handoff:HANDOFF.NOW,paid:true,paymentMethod:PAYMENT.CASH},HANDOFF.LATER),PAYMENT.CASH);
});

test('受け取り時会計は未会計の後日受取だけに許可し、現金・クレジットは維持する',()=>{
  assert.deepEqual(validate(pickup()),[]);
  for(const handoff of [HANDOFF.NOW,HANDOFF.HOTEL,HANDOFF.SHIP])assert.ok(validate({...pickup(),handoff}).includes('会計方法を選択してください。'));
  assert.ok(validate({...pickup(),paid:true}).includes('会計方法を選択してください。'));
  for(const method of [PAYMENT.CREDIT,PAYMENT.CASH])assert.deepEqual(validate({...pickup(),paymentMethod:method}),[]);
  assert.equal(paymentMethodLabel(pickup()),'受け取り時会計');assert.equal(paymentMethodLabel({}),'未選択');
});

test('会計済の選択は方法・日時だけを記録し、受け取り待ちと共有状況を保つ',()=>{
  for(const method of [PAYMENT.CREDIT,PAYMENT.CASH]){
    const original=pickup(),paid=markPickupPaid(original,method,'2099-01-02T01:00:00Z');
    assert.equal(paid.paid,true);assert.equal(paid.paymentMethod,method);assert.equal(paid.paidAt,'2099-01-02T01:00:00Z');
    assert.equal(groupOf(paid),'waiting');assert.equal(paid.delivered,false);assert.equal(paid.slackShared,true);assert.equal(original.paid,false);
    assert.deepEqual(markPickupPaid(paid,PAYMENT.CASH,'2099-01-03T00:00:00Z'),paid);
    const delivered=markPickupDelivered(paid,'2099-01-02T02:00:00Z');assert.equal(groupOf(delivered),'done');assert.equal(delivered.paidAt,paid.paidAt);assert.equal(delivered.paymentMethod,method);
  }
});

test('未会計・不明な方法・非対象注文の誤った会計やお渡しを防ぐ',()=>{
  for(const method of ['',PAYMENT.NONE,PAYMENT.ON_PICKUP,'invalid'])assert.deepEqual(markPickupPaid(pickup(),method),pickup());
  assert.deepEqual(markPickupDelivered(pickup()),pickup());
  assert.equal(isPickupPaymentRecorded({...pickup(),paid:true}),false);
  for(const handoff of [HANDOFF.NOW,HANDOFF.HOTEL,HANDOFF.SHIP]){const order={...pickup(),handoff};assert.deepEqual(markPickupPaid(order,PAYMENT.CREDIT),order)}
  const legacy={...pickup(),delivered:true};assert.equal(groupOf(legacy),'done');assert.deepEqual(markPickupDelivered(legacy),legacy);assert.deepEqual(markPickupPaid(legacy,PAYMENT.CASH),legacy);
});

test('会計方法と日時はクラウド往復・再編集でも保持し、旧記録に架空の日時を付けない',()=>{
  const paid=markPickupPaid(pickup(),PAYMENT.CASH,'2099-01-02T01:00:00Z');
  const restored=orderFromCloudRow({id:paid.localId,payload:orderPayloadForCloud(normalizeForSave(paid))});
  assert.equal(restored.paymentMethod,PAYMENT.CASH);assert.equal(restored.paidAt,paid.paidAt);assert.equal(restored.paid,true);assert.equal(groupOf(restored),'waiting');
  assert.equal(orderPayloadForCloud(normalizeForSave({...pickup(),paid:true,paymentMethod:PAYMENT.CASH})).paidAt,'');
});

test('個別PDF名はお客様名・日本時間の日付と時刻を含み、禁止文字を除く',()=>{
  const stamp=new Date('2099-01-02T03:04:00Z');
  assert.equal(printFileBase([{customer:'山田/太郎',store:'架空店舗'}],{now:stamp}),'注文書_山田_太郎_20990102_1204');
  assert.equal(printFileBase([{customer:'山田 太郎'}],{customerCopy:true,now:stamp}),'お客様控え_山田 太郎_20990102_1204');
  assert.equal(printFileBase([{customer:'',store:'架空店舗'}],{now:stamp}),'注文書_架空店舗_20990102_1204');
  assert.equal(printFileBase([{customer:'山田'},{customer:'佐藤'}],{now:stamp}),'全注文_20990102_1204');
});

const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').split("$('loginBtn').onclick=login;")[0];
function harness(fetchImpl){
  const elements=new Map(),calls=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},querySelectorAll(){return[]},scrollTo(){},style:{}});
    return elements.get(id);
  };
  const credit=element('creditChoice'),cash=element('cashChoice');credit.dataset.paymentMethod='credit';cash.dataset.paymentMethod='cash';
  element('sheetBody').querySelectorAll=selector=>selector==='[data-payment-method]'?[credit,cash]:selector==='button'?[credit,cash,element('paymentCancel'),element('paymentConfirm')]:[];
  const context=vm.createContext({...attachments,...flow,window:{EXHIBITION_CONFIG:{supabaseUrl:'https://fixture.invalid',publishableKey:'fixture-key'}},document:{getElementById:element,body:{style:{}}},navigator:{},URL,AbortController,setTimeout:()=>0,clearTimeout(){},fetch:async(url,options)=>{
    calls.push({url,options});return fetchImpl?fetchImpl(url,options):{ok:true,json:async()=>[{id:'fixture-pickup',payload:JSON.parse(options.body).payload,updated_at:'2099-01-02T00:00:00Z'}]};
  }});
  vm.runInContext(source+'\nglobalThis.subject={state,pendingPayments,cardHtml,showPickupPayment,handOverFromCard,loadOrders,receiptDocumentHtml};',context);
  context.subject.state.session={access_token:'fixture-token',expires_at:4102444800,user:{id:'fixture-user'}};
  context.subject.state.orders=[pickup()];
  return {...context.subject,context,calls,element,credit,cash};
}

test('カードは会計済をお渡し済みの前に表示し、会計前はお渡しを無効化する',async()=>{
  const h=harness(),html=h.cardHtml(pickup());assert.ok(html.indexOf('data-payment=')<html.indexOf('data-handover='));
  assert.match(html,/data-handover="fixture-pickup" disabled/);
  await h.handOverFromCard('fixture-pickup');assert.equal(h.calls.length,0);
  const paidHtml=h.cardHtml(markPickupPaid(pickup(),PAYMENT.CREDIT));assert.match(paidHtml,/会計済（クレジット）/);assert.doesNotMatch(paidHtml,/data-payment=/);assert.doesNotMatch(paidHtml,/data-handover="fixture-pickup" disabled/);
});

test('会計方法の選択や戻るだけでは書き込まず、会計を記録してから同期する',async()=>{
  const h=harness();h.showPickupPayment(h.state.orders[0]);
  assert.match(h.element('sheetBody').innerHTML,/会計金額/);assert.match(h.element('sheetBody').innerHTML,/¥200/);
  await h.element('paymentConfirm').onclick();assert.equal(h.calls.length,0);
  h.cash.onclick();assert.equal(h.calls.length,0);h.element('paymentCancel').onclick();assert.equal(h.state.orders[0].paid,false);
  h.showPickupPayment(h.state.orders[0]);h.credit.onclick();await h.element('paymentConfirm').onclick();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.method,'PATCH');assert.ok(h.calls[0].url.includes('updated_at=eq.'));
  assert.equal(h.state.orders[0].paid,true);assert.equal(h.state.orders[0].paymentMethod,'credit');assert.ok(h.state.orders[0].paidAt);assert.equal(groupOf(h.state.orders[0]),'waiting');
  assert.match(h.receiptDocumentHtml(h.state.orders[0],{customerCopy:true}),/会計済（クレジット）/);
});

test('連打や保存完了前のお渡しで二重記録せず、応答まで会計前の状態を保持する',async()=>{
  let resolveResponse;
  const h=harness(()=>new Promise(resolve=>{resolveResponse=resolve}));h.showPickupPayment(h.state.orders[0]);h.cash.onclick();
  const first=h.element('paymentConfirm').onclick();await Promise.resolve();await h.element('paymentConfirm').onclick();await h.handOverFromCard('fixture-pickup');
  assert.equal(h.calls.length,1);assert.equal(h.state.orders[0].paid,false);assert.match(h.cardHtml(h.state.orders[0]),/保存中/);
  resolveResponse({ok:true,json:async()=>[{id:'fixture-pickup',payload:JSON.parse(h.calls[0].options.body).payload,updated_at:'2099-01-02T00:00:00Z'}]});await first;
  assert.equal(h.state.orders[0].paid,true);assert.equal(h.pendingPayments.size,0);
});

test('通信失敗で会計済みを捏造せず、同じ画面から選択済みの方法で再試行できる',async()=>{
  let fail=true;
  const h=harness(async(_url,options)=>{if(fail)throw Error('offline');return{ok:true,json:async()=>[{id:'fixture-pickup',payload:JSON.parse(options.body).payload}]}});
  h.showPickupPayment(h.state.orders[0]);h.cash.onclick();await h.element('paymentConfirm').onclick();
  assert.equal(h.state.orders[0].paid,false);assert.equal(h.element('paymentConfirm').disabled,false);assert.match(h.element('sheetError').textContent,/決済のやり直しは不要/);
  fail=false;await h.element('paymentConfirm').onclick();assert.equal(h.state.orders[0].paymentMethod,'cash');assert.equal(h.state.orders[0].paid,true);
});

test('会計記録が競合したら最新の内容を取得し、勝手に再記録しない',async()=>{
  const latest=markPickupPaid(pickup(),PAYMENT.CASH);
  const h=harness(async(_url,options)=>({ok:true,json:async()=>options.method==='PATCH'?[]:[{id:'fixture-pickup',payload:latest,updated_at:'2099-01-03T00:00:00Z'}]}));
  h.showPickupPayment(h.state.orders[0]);h.credit.onclick();await h.element('paymentConfirm').onclick();
  assert.equal(h.calls.filter(call=>call.options.method==='PATCH').length,1);assert.equal(h.state.orders[0].paymentMethod,'cash');assert.equal(h.element('paymentConfirm').disabled,true);assert.match(h.element('sheetError').textContent,/別の端末/);
});

test('会計選択中に自動同期で金額や内容が変わった場合は書き込み前に止める',async()=>{
  const h=harness();h.showPickupPayment(h.state.orders[0]);h.credit.onclick();
  h.state.orders=[{...pickup(),cloudUpdatedAt:'2099-01-03T00:00:00Z'}];await h.element('paymentConfirm').onclick();
  assert.equal(h.calls.length,0);assert.match(h.element('sheetError').textContent,/最新の注文/);
});

test('会計中に別画面へ移動しても、遅い保存応答でその画面を閉じない',async()=>{
  let resolveResponse;
  const h=harness(()=>new Promise(resolve=>{resolveResponse=resolve}));h.showPickupPayment(h.state.orders[0]);h.credit.onclick();
  const saving=h.element('paymentConfirm').onclick();await Promise.resolve();h.state.sheetVersion++;
  vm.runInContext('closeSheet=()=>{throw Error("new screen must stay open")}',h.context);
  resolveResponse({ok:true,json:async()=>[{id:'fixture-pickup',payload:JSON.parse(h.calls[0].options.body).payload}]});await saving;
  assert.equal(h.state.orders[0].paid,true);assert.equal(h.pendingPayments.size,0);
});
