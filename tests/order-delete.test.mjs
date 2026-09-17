import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as attachments from '../order-attachments.js';
import * as workflow from '../workflow.js';

const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').split("$('loginBtn').onclick=login;")[0];
const order=()=>({localId:'fixture-order',store:'架空店舗',receiptNo:'TEST-001',type:workflow.ORDER_TYPE.NORMAL,workflowStatus:'done',items:[{code:'TEST',name:'架空商品',qty:2,price:100}],createdAt:'2099-01-01T00:00:00Z',cloudUpdatedAt:'2099-01-01T00:00:00Z'});
function harness({confirmed=true,fetchImpl}={}){
  const elements=new Map(),calls=[],messages=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,classList:{add(){},remove(){},toggle(){}},querySelectorAll(){return[]},style:{}});
    return elements.get(id);
  };
  const context=vm.createContext({...attachments,...workflow,window:{EXHIBITION_CONFIG:{supabaseUrl:'https://fixture.invalid',publishableKey:'fixture-key'}},document:{getElementById:element,body:{style:{}}},navigator:{},URL,AbortController,setTimeout:()=>0,clearTimeout(){},confirm:message=>{messages.push(message);return confirmed},fetch:async(url,options)=>{calls.push({url,options});return fetchImpl?fetchImpl(url,options):{ok:true,json:async()=>[{id:'fixture-order'}]}}});
  vm.runInContext(source+'\nglobalThis.subject={state,pendingDeletes,cardHtml,deleteOrderWithConfirmation,loadOrders};',context);
  context.subject.state.session={access_token:'fixture-token',expires_at:4102444800,user:{id:'fixture-user'}};
  context.subject.state.orders=[order()];
  return{...context.subject,context,calls,messages,element};
}

test('完了カードだけに削除ボタンを表示し、店舗名を安全にエスケープする',()=>{
  const h=harness();
  assert.match(h.cardHtml(order()),/data-delete="fixture-order"/);
  for(const workflowStatus of ['active','waiting'])assert.doesNotMatch(h.cardHtml({...order(),workflowStatus}),/data-delete=/);
  const html=h.cardHtml({...order(),store:'<script>"悪意"</script>'});
  assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
  h.pendingDeletes.add('fixture-order');assert.match(h.cardHtml(order()),/disabled>削除中…/);
});

test('確認を取り消すと削除リクエストも一覧変更も発生しない',async()=>{
  const h=harness({confirmed:false});await h.deleteOrderWithConfirmation(h.state.orders[0]);
  assert.equal(h.calls.length,0);assert.equal(h.state.orders.length,1);
  for(const text of ['架空店舗','TEST-001','¥200','全端末','復旧用','Slack'])assert.ok(h.messages[0].includes(text));
});

test('クラウド確認後にだけ削除し、ソフト削除・更新日時照合・二重押下防止を維持する',async()=>{
  let resolveResponse;
  const h=harness({fetchImpl:()=>new Promise(resolve=>{resolveResponse=resolve})});
  const original=h.state.orders[0];h.state.draft={editingId:original.localId};
  const first=h.deleteOrderWithConfirmation(original);await Promise.resolve();
  await h.deleteOrderWithConfirmation(original);
  assert.equal(h.calls.length,1);assert.equal(h.messages.length,1);assert.equal(h.state.orders.length,1);
  const {url,options}=h.calls[0];assert.equal(options.method,'PATCH');
  assert.ok(url.includes('deleted_at=is.null'));assert.ok(url.includes('updated_at=eq.'));
  assert.deepEqual(Object.keys(JSON.parse(options.body)),['deleted_at']);
  resolveResponse({ok:true,json:async()=>[{id:original.localId}]});await first;
  assert.equal(h.state.orders.length,0);assert.equal(h.state.draft,null);assert.equal(h.pendingDeletes.size,0);
  assert.equal(h.element('orderCount').textContent,'0件');
});

test('通信失敗では注文を残して再操作を許可する',async()=>{
  const h=harness({fetchImpl:async()=>{throw new Error('network failure')}});
  await h.deleteOrderWithConfirmation(h.state.orders[0]);
  assert.equal(h.state.orders.length,1);assert.equal(h.pendingDeletes.size,0);
  assert.match(h.element('toast').textContent,/削除を確認できませんでした/);
});

test('競合では最新内容を読み直し勝手に再削除しない',async()=>{
  const h=harness({fetchImpl:async(_url,options)=>({ok:true,json:async()=>options.method==='PATCH'?[]:[{id:'fixture-order',payload:{...order(),store:'他端末で変更済み'},updated_at:'2099-01-02T00:00:00Z'}]})});
  await h.deleteOrderWithConfirmation(h.state.orders[0]);
  assert.equal(h.calls.filter(call=>call.options.method==='PATCH').length,1);
  assert.equal(h.state.orders[0].store,'他端末で変更済み');assert.match(h.element('toast').textContent,/別の端末/);
});

test('他端末の同期で削除済み注文を除外し、古い応答でも削除した行を戻さない',async()=>{
  let resolveResponse;
  const h=harness({fetchImpl:async(_url,options)=>options.method==='PATCH'?{ok:true,json:async()=>[{id:'fixture-order'}]}:new Promise(resolve=>{resolveResponse=resolve})});
  const sync=h.loadOrders();await Promise.resolve();
  await h.deleteOrderWithConfirmation(h.state.orders[0]);
  resolveResponse({ok:true,json:async()=>[{id:'fixture-order',payload:order()}]});await sync;
  assert.equal(h.state.orders.length,0);
  const other=harness({fetchImpl:async()=>({ok:true,json:async()=>[]})});await other.loadOrders();
  assert.equal(other.state.orders.length,0);
});

test('詳細から削除中に別画面を開いてもその画面を閉じない',async()=>{
  let resolveResponse;
  const h=harness({fetchImpl:()=>new Promise(resolve=>{resolveResponse=resolve})});
  vm.runInContext('closeSheet=()=>{throw new Error("must not close the new sheet")}',h.context);
  const deleting=h.deleteOrderWithConfirmation(h.state.orders[0],{fromDetail:true});await Promise.resolve();
  h.state.sheetVersion++;resolveResponse({ok:true,json:async()=>[{id:'fixture-order'}]});await deleting;
  assert.equal(h.state.orders.length,0);assert.equal(h.element('toast').textContent,'注文を削除しました');
});
