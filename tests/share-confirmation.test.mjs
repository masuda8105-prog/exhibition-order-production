import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as attachments from '../order-attachments.js';
import * as flow from '../workflow.js';

const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').split("$('loginBtn').onclick=login;")[0];
const draft=()=>({stage:'finalize',clientSubmissionId:'00000000-0000-4000-8000-000000000123',type:'spot',handoff:'later',pickupDate:'2099-01-02',store:'TEST',phone:'000',customer:'Customer',paymentMethod:'on_pickup',items:[{code:'TEST',name:'Fixture',qty:1,price:100}]});
const reserved=()=>({...flow.prepareOrderForSharing(draft()),localId:draft().clientSubmissionId,cloudUpdatedAt:'2099-01-01T00:00:00Z',pickupNumber:'1',sharingSaved:true});

test('共有対象だけ段階確定し、番号だけ・共有だけでは未確定を維持する',()=>{
  for(const handoff of ['later','hotel','ship']){
    const order={...reserved(),handoff,paymentMethod:'credit'};
    assert.equal(flow.canConfirmSharedOrder(order),false);assert.throws(()=>flow.confirmSharedOrder(order),/SHARE_REQUIRED/);
    const shared=flow.setSlackShared(order,true,'2099-01-01T00:00:01Z');
    assert.equal(flow.groupOf(shared),'active');assert.equal(flow.isDone(shared),false);
    const confirmed=flow.confirmSharedOrder(shared);
    assert.equal(flow.groupOf(confirmed),handoff==='later'?'waiting':'done');
    assert.equal(confirmed.confirmationState,'confirmed');assert.equal(confirmed.pickupNumber,'1');
  }
  for(const order of [{type:'normal'},{type:'spot',handoff:'now'}])assert.equal(flow.needsHeadOfficeShare(order),false);
});
test('未保存・未採番・不完全な入力・送信日時なしでは確定できない',()=>{
  const shared=flow.setSlackShared(reserved(),true,'2099-01-01T00:00:01Z');
  for(const change of [{cloudUpdatedAt:''},{pickupNumber:''},{items:[]},{customer:''},{slackSharedAt:''},{slackShared:false},{confirmationState:'confirmed'}])assert.equal(flow.canConfirmSharedOrder({...shared,...change}),false);
});
test('再共有準備では番号を保ち、古い共有確認を必ず取り消す',()=>{
  const next=flow.prepareOrderForSharing({...reserved(),slackShared:true,slackSharedAt:'old',headOfficeShared:true,workflowStatus:'done'});
  assert.equal(next.pickupNumber,'1');assert.equal(next.slackShared,false);assert.equal(next.slackSharedAt,'');assert.equal(flow.groupOf(next),'active');
});
test('未確定は集計・一括印刷から除外し、状態はDB専用列を信頼する',()=>{
  const pending={...reserved(),workflowStatus:'done',delivered:true};
  assert.equal(flow.groupOf(pending),'active');assert.equal(flow.batchSummary([pending]).orders,0);assert.deepEqual(flow.filterOrdersByCreatedDate([pending]),[]);
  assert.equal(flow.orderFromCloudRow({payload:{confirmationState:'confirmed'},confirmation_state:'draft'}).confirmationState,'draft');
  assert.equal(flow.orderFromCloudRow({payload:{}}).confirmationState,'confirmed');
});

function harness({afterWrite,beforeWrite}={}){
  const elements=new Map(),calls=[],rows=new Map();let revision=0,sequence=0;
  const element=id=>{if(!elements.has(id))elements.set(id,{id,innerHTML:'',value:'',disabled:false,checked:false,textContent:'',classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[],insertAdjacentHTML(){},scrollTo(){}});return elements.get(id)};
  element('sheet').querySelectorAll=()=>[...elements.values()];
  const ctx=vm.createContext({...attachments,...flow,window:{EXHIBITION_CONFIG:{supabaseUrl:'https://fixture.invalid'},print(){}},document:{getElementById:element,title:'Test',body:{style:{}}},navigator:{},URL,AbortController,setTimeout(){},clearTimeout(){},fetch:async(url,options)=>{
    calls.push({url,options});const body=options.body?JSON.parse(options.body):null;
    if(!body)return{ok:true,json:async()=>[...rows.values()]};
    await beforeWrite?.(body,options);
    if(options.method==='POST'&&rows.has(body.id))return{ok:false,status:409,json:async()=>({message:'duplicate'})};
    const id=body.id||decodeURIComponent(new URL(url).searchParams.get('id').slice(3));const old=rows.get(id);
    if(options.method==='PATCH'&&new URL(url).searchParams.get('updated_at')!==`eq.${old.updated_at}`)return{ok:true,json:async()=>[]};
    const row={...old,id,payload:body.payload,confirmation_state:body.payload.confirmationState,pickup_number:old?.pickup_number||(body.payload.handoff==='later'?++sequence:null),created_at:old?.created_at||'2099-01-01T00:00:00Z',updated_at:`2099-01-01T00:00:${String(++revision).padStart(2,'0')}Z`};rows.set(id,row);
    await afterWrite?.(row,options);
    return{ok:true,json:async()=>[row]};
  }});
  vm.runInContext(source+"\nrender=()=>{};renderDraft=()=>{if(state.draft.stage==='finalize')renderFinalizeStep(state.draft)};globalThis.subject={state,renderFinalizeStep,resumeFinalization,cardHtml,saveNew,saveEdited,handOverFromCard,showPickupPayment,pendingFinalizations};",ctx);
  const api=ctx.subject;api.state.session={access_token:'fixture',expires_at:4102444800,user:{id:'fixture'}};api.state.draft=draft();
  return{...api,ctx,calls,rows,element,sequence:()=>sequence,render:()=>api.renderFinalizeStep(api.state.draft)};
}
test('番号発行→PDF→送信確認→確定を順番に保存し、印刷だけでは確定できない',async()=>{
  const h=harness();h.render();assert.match(h.element('sheetBody').innerHTML,/id="confirmSharedOrder"[^>]*disabled/);
  await h.element('confirmSharedOrder').onclick();assert.equal(h.calls.length,0);
  await h.element('prepareSharing').onclick();assert.equal(h.state.draft.pickupNumber,'1');assert.equal(h.state.draft.confirmationState,'draft');
  assert.match(h.cardHtml(h.state.orders[0]),/未確定/);assert.doesNotMatch(h.cardHtml(h.state.orders[0]),/data-payment|data-handover/);
  await h.element('prepareSharePdf').onclick();assert.equal(h.state.draft.slackShared,false);
  await h.element('confirmSharedOrder').onclick();assert.equal(h.calls.length,1);
  h.element('acknowledgeSlack').checked=true;await h.element('acknowledgeSlack').onchange();
  assert.equal(h.state.draft.slackShared,true);assert.equal(h.state.draft.confirmationState,'draft');assert.equal(flow.groupOf(h.state.orders[0]),'active');
  await h.element('confirmSharedOrder').onclick();assert.equal(h.state.draft.stage,'success');assert.equal(flow.groupOf(h.state.orders[0]),'waiting');assert.equal(h.sequence(),1);
});
test('番号発行の連打は1回の保存に限定する',async()=>{
  let release;const h=harness({beforeWrite:()=>new Promise(resolve=>{release=resolve})});h.render();
  const first=h.element('prepareSharing').onclick();await Promise.resolve();await Promise.resolve();await h.element('prepareSharing').onclick();
  assert.equal(h.calls.length,1);release();await first;assert.equal(h.sequence(),1);assert.equal(h.pendingFinalizations.size,0);
});
test('番号発行の応答が途切れても同じIDで照合し、番号を再発行しない',async()=>{
  let fail=true;const h=harness({afterWrite:()=>{if(fail){fail=false;throw Error('response lost')}}});h.render();
  await h.element('prepareSharing').onclick();assert.equal(h.state.draft.sharingSaved,undefined);assert.equal(h.rows.size,1);
  await h.element('prepareSharing').onclick();assert.equal(h.rows.size,1);assert.equal(h.sequence(),1);assert.equal(h.state.draft.pickupNumber,'1');
});
test('送信確認の通信失敗は確定を開放せず再試行できる',async()=>{
  let fail=false;const h=harness({beforeWrite:()=>{if(fail)throw Error('offline')}});h.render();await h.element('prepareSharing').onclick();await h.element('prepareSharePdf').onclick();
  fail=true;h.element('acknowledgeSlack').checked=true;await h.element('acknowledgeSlack').onchange();assert.equal(h.state.draft.slackShared,false);assert.equal(h.element('acknowledgeSlack').checked,false);
  await h.element('confirmSharedOrder').onclick();assert.equal(h.state.draft.confirmationState,'draft');
  fail=false;h.element('acknowledgeSlack').checked=true;await h.element('acknowledgeSlack').onchange();assert.equal(h.state.draft.slackShared,true);
});
test('未確定の再開と他端末更新の競合保護を維持する',async()=>{
  const h=harness();h.render();await h.element('prepareSharing').onclick();h.resumeFinalization(h.state.orders[0]);assert.equal(h.state.draft.sharingSaved,true);
  const row=h.rows.get(h.state.draft.localId);row.updated_at='2099-01-02T00:00:00Z';await h.element('prepareSharePdf').onclick();h.element('acknowledgeSlack').checked=true;await h.element('acknowledgeSlack').onchange();
  assert.equal(h.state.draft.slackShared,false);assert.match(h.element('sheetError').textContent,/別の端末/);
});
test('未確定の会計・お渡し、共有なしの直接保存は止める',async()=>{
  const h=harness();h.state.orders=[reserved()];await h.handOverFromCard(h.state.orders[0].localId);h.showPickupPayment(h.state.orders[0]);assert.equal(h.calls.length,0);
  await assert.rejects(h.saveNew(draft()),/SHARE_REQUIRED/);
  await assert.rejects(h.saveEdited({...reserved(),confirmationState:'confirmed',editingId:reserved().localId}),/SHARE_REQUIRED/);
});
