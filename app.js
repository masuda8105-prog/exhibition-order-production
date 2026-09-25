import {createOrderPdf} from './order-pdf.js?v=20260924-pdf1';
import {isUnconfirmed,prepareOrderForSharing,canConfirmSharedOrder,confirmSharedOrder,pickupNumberLabel,isShippingItem,addShippingFee,ORDER_TYPE,HANDOFF,PAYMENT,PREP,ORDER_STATUS,groupOf,setSlackShared,statusOnConfirmation,isPickupOrder,isPickupPaymentRecorded,paymentMethodOnHandoffChange,paymentMethodLabel,markPickupPaid,markPickupDelivered,needsHeadOfficeShare,needsReceipt,totalOf,itemCountOf,phoneHasUnexpectedCharacters,createdDateInTokyo,filterOrdersByCreatedDate,orderMatchesSearch,batchSummary,customerNameWithHonorific,receiptInternalInfo,validate,labelOrder,compareOrdersForPrint,printFileBase,handoffLabel,normalizeForSave,orderPayloadForCloud,orderFromCloudRow} from './workflow.js?v=20260916-number1';
import {PERSISTENT_SESSION_KEY,SESSION_STORAGE_KEY,LEGACY_LOCAL_STORAGE_KEYS,wipeOrderData} from './security.js?v=20260903-pickup4';
import {RECEIPT_BUCKET,RECEIPT_LINK_SECONDS,RECEIPT_MAX_BYTES,receiptImagePath,signedReceiptUrl} from './receipt-share.js?v=20260903-pickup4';
import {MAX_PHOTOS,createAttachmentStore,preparePhoto} from './order-attachments.js?v=20260917-photo1';

const cfg=window.EXHIBITION_CONFIG||{};
const $=id=>document.getElementById(id);
const LS_STAFF='exhibitionOps.staff.v2',LS_KEYPAD_ALIGN='exhibitionOps.keypadAlign.v1';
const pendingHandovers=new Set(),pendingDeletes=new Set(),pendingPayments=new Set();
const pendingFinalizations=new Set();
const attachmentStore=createAttachmentStore();
let attachmentOperation=null,attachmentPrintBusy=false,printGeneration=0;
let printOriginalTitle='';
const state={online:false,session:null,staff:null,orders:[],products:[],accounts:[],draft:null,rememberDraftInput:null,signalsBound:false,syncTimer:null,syncInFlight:null,refreshPromise:null,lastSyncedAt:null,dataEpoch:0,tab:'active',sheetVersion:0,receiptBlobUrl:null};
const yen=n=>Number.isFinite(Number(n))?`¥${Math.round(Number(n)).toLocaleString('ja-JP')}`:'価格未定';
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const isoDate=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(d);
const today=()=>isoDate(new Date());
const dateOffset=n=>{const d=new Date();d.setDate(d.getDate()+n);return isoDate(d)};
const newUuid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now().toString(16).padStart(8,'0')}-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12,'0').slice(0,12)}`;

function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2600)}
function setSync(mode,text){$('syncDot').className=`syncDot${mode?` ${mode}`:''}`;$('syncText').textContent=text}
function purgeLegacyLocalData(){for(const key of LEGACY_LOCAL_STORAGE_KEYS){try{localStorage.removeItem(key)}catch{}}}
function permanentReceipt(id){return `受付-${today().replaceAll('-','')}-${id.slice(0,8).toUpperCase()}`}

async function fetchJson(url,opts={},timeout=30000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch(url,{...opts,signal:controller.signal});
    const json=await response.json().catch(()=>null);
    if(!response.ok){const error=new Error(json?.message||json?.error||`HTTP_${response.status}`);error.status=response.status;error.storageCode=json?.statusCode;throw error}
    return json;
  }finally{clearTimeout(timer)}
}
function sbBase(){return String(cfg.supabaseUrl||'').replace(/\/$/,'')}
function sbHeaders(auth=true){const headers={apikey:String(cfg.publishableKey||''),'Content-Type':'application/json'};if(auth&&state.session?.access_token)headers.Authorization=`Bearer ${state.session.access_token}`;return headers}
function storedSession(){try{return JSON.parse(localStorage.getItem(PERSISTENT_SESSION_KEY)||sessionStorage.getItem(SESSION_STORAGE_KEY)||'null')}catch{return null}}
function clearStoredSession(){localStorage.removeItem(PERSISTENT_SESSION_KEY);sessionStorage.removeItem(SESSION_STORAGE_KEY)}
function saveSession(session){session.expires_at=session.expires_at||Math.floor(Date.now()/1000)+Number(session.expires_in||3600);localStorage.setItem(PERSISTENT_SESSION_KEY,JSON.stringify(session));sessionStorage.removeItem(SESSION_STORAGE_KEY);state.session=session;return session}
async function signIn(email,password){return saveSession(await fetchJson(`${sbBase()}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:cfg.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})}))}
async function refreshSession(){
  if(state.refreshPromise)return state.refreshPromise;
  const refresh=async()=>{
    const latest=storedSession();if(latest?.refresh_token)state.session=latest;
    if(!state.session?.refresh_token)throw new Error('SESSION_EXPIRED');
    if(Number(state.session.expires_at||0)>Math.floor(Date.now()/1000)+60)return state.session;
    const token=state.session.refresh_token;
    const refreshed=await fetchJson(`${sbBase()}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:cfg.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:token})});
    if(storedSession()?.refresh_token!==token)throw new Error('SESSION_EXPIRED');
    return saveSession(refreshed);
  };
  state.refreshPromise=(navigator.locks?.request?navigator.locks.request('exhibition-auth-refresh',refresh):refresh()).finally(()=>{state.refreshPromise=null});
  return state.refreshPromise;
}
async function ensureFreshSession(){if(Number(state.session?.expires_at||0)<=Math.floor(Date.now()/1000)+60)await refreshSession()}
async function loadStaff(){const id=state.session?.user?.id;if(!id)throw new Error('LOGIN_REQUIRED');const rows=await fetchJson(`${sbBase()}/rest/v1/exhibition_staff?select=display_name,role,active&user_id=eq.${encodeURIComponent(id)}&active=is.true&limit=1`,{headers:sbHeaders()});if(!rows?.[0])throw new Error('スタッフ権限がありません。');state.staff=rows[0];try{localStorage.setItem(LS_STAFF,String(state.staff.display_name||''))}catch{}}

async function loadAllRows(table,select,order){
  const pageSize=1000,rows=[];
  for(let offset=0;;offset+=pageSize){
    await ensureFreshSession();
    const query=`select=${encodeURIComponent(select)}&order=${encodeURIComponent(order)}&limit=${pageSize}&offset=${offset}`;
    const page=await fetchJson(`${sbBase()}/rest/v1/${table}?${query}`,{headers:sbHeaders()});
    rows.push(...(page||[]));
    if(!page||page.length<pageSize)break;
  }
  return rows;
}
async function loadPrivateReferenceData(){
  const userId=state.session?.user?.id;
  const [products,accounts]=await Promise.all([
    loadAllRows('products','id,product_no,product_name,wholesale_price,image_url,is_active','display_order.asc,id.asc'),
    loadAllRows('exhibition_accounts','id,account_name,display_order,is_active','display_order.asc,id.asc'),
  ]);
  if(!state.session||state.session.user?.id!==userId)return;
  state.products=products.map(row=>({productId:`product-${row.id}`,code:String(row.product_no||''),name:String(row.product_name||''),price:row.wholesale_price===null?NaN:Number(row.wholesale_price),imageUrl:row.image_url||'',status:row.is_active?'active':'price_pending',orderable:Boolean(row.is_active)&&Number(row.wholesale_price)>0})).filter(product=>product.code&&product.name);
  state.accounts=accounts.filter(row=>row.is_active).map(row=>String(row.account_name||'')).filter(Boolean);
  if(!state.products.length)throw new Error('PRODUCT_MASTER_EMPTY');
}

async function saveNew(order){
  if(needsHeadOfficeShare(order)&&!isUnconfirmed(order))throw new Error('SHARE_REQUIRED');
  await ensureFreshSession();
  const id=order.clientSubmissionId||newUuid(),saved=normalizeForSave({...order,localId:id,clientSubmissionId:id,syncState:'synced'});
  if(needsReceipt(saved)&&!saved.receiptNo)saved.receiptNo=permanentReceipt(id);
  order.clientSubmissionId=id;
  const payload=orderPayloadForCloud(saved);
  const previousPayload=order.pendingSavePayload;
  order.pendingSavePayload=payload;
  let rows;
  try{rows=await fetchJson(`${sbBase()}/rest/v1/exhibition_app_orders`,{method:'POST',headers:{...sbHeaders(),Prefer:'return=representation'},body:JSON.stringify({id,event_name:cfg.eventName||'展示会',payload})})}
  catch(error){
    if(error.status!==409)throw error;
    rows=await fetchJson(`${sbBase()}/rest/v1/exhibition_app_orders?select=id,payload,pickup_number,confirmation_state,created_at,updated_at&id=eq.${encodeURIComponent(id)}&deleted_at=is.null`,{headers:sbHeaders()});
    if(rows?.[0]){
      const existing=orderFromCloudRow(rows[0]),existingPayload=JSON.stringify(orderPayloadForCloud(existing));
      if(existingPayload!==JSON.stringify(payload)){
        if(existingPayload!==JSON.stringify(previousPayload)){await loadOrders();throw new Error('SYNC_CONFLICT')}
        rows=[await patchCloudOrder(existing,{payload})];
      }
    }
  }
  if(!rows?.[0])throw new Error('SAVE_NOT_CONFIRMED');
  const result=orderFromCloudRow(rows[0]);state.dataEpoch++;state.orders=[result,...state.orders.filter(item=>item.localId!==id)];markSynced();render();return result;
}
async function saveEdited(draft){
  const current=state.orders.find(order=>order.localId===draft.editingId);
  if(!current)throw new Error('EDIT_TARGET_NOT_FOUND');
  if(needsHeadOfficeShare(draft)&&!isUnconfirmed(draft))throw new Error('SHARE_REQUIRED');
  const updated=normalizeForSave({...current,...draft,localId:current.localId,createdAt:current.createdAt,clientSubmissionId:current.clientSubmissionId,syncState:'synced'});
  delete updated.stage;delete updated.editingId;
  return updateOrder(updated);
}
async function patchCloudOrder(order,changes){
  await ensureFreshSession();
  const revision=order.cloudUpdatedAt?`&updated_at=eq.${encodeURIComponent(order.cloudUpdatedAt)}`:'';
  const rows=await fetchJson(`${sbBase()}/rest/v1/exhibition_app_orders?id=eq.${encodeURIComponent(order.localId)}&deleted_at=is.null${revision}`,{method:'PATCH',headers:{...sbHeaders(),Prefer:'return=representation'},body:JSON.stringify(changes)});
  if(!rows?.[0]){await loadOrders();throw new Error('SYNC_CONFLICT')}
  return rows[0];
}
async function updateOrder(order){const result=orderFromCloudRow(await patchCloudOrder(order,{payload:orderPayloadForCloud(order)}));state.dataEpoch++;state.orders=state.orders.map(item=>item.localId===result.localId?result:item);markSynced();render();return result}
async function hideOrder(order){await patchCloudOrder(order,{deleted_at:new Date().toISOString()});state.dataEpoch++;state.orders=state.orders.filter(item=>item.localId!==order.localId);markSynced();render()}
function markSynced(){state.lastSyncedAt=new Date();setSync('online',`保存済み・自動同期 ${formatDateTime(state.lastSyncedAt,true)}`)}
async function loadOrders(){
  const rows=[],pageSize=500,epoch=state.dataEpoch,userId=state.session?.user?.id;
  for(let offset=0;;offset+=pageSize){
    await ensureFreshSession();
    const page=await fetchJson(`${sbBase()}/rest/v1/exhibition_app_orders?select=id,payload,pickup_number,confirmation_state,created_at,updated_at&event_name=eq.${encodeURIComponent(cfg.eventName||'展示会')}&deleted_at=is.null&order=created_at.desc,id.desc&limit=${pageSize}&offset=${offset}`,{headers:sbHeaders()});
    rows.push(...(page||[]));if(!page||page.length<pageSize)break;
  }
  if(epoch!==state.dataEpoch||!state.session||state.session.user?.id!==userId)return;
  state.orders=rows.map(orderFromCloudRow);markSynced();render();
}
async function syncOrders(){
  if(!state.online||!navigator.onLine||state.syncInFlight)return state.syncInFlight;
  state.syncInFlight=loadOrders().catch(error=>{setSync('error','同期できません。接続後に再試行します');throw error}).finally(()=>{state.syncInFlight=null});
  return state.syncInFlight;
}

function render(){renderMetrics();renderTabs();renderOrders()}
function currentSearch(){return $('orderSearch').value.trim()}
function filteredOrders(){const q=currentSearch();return state.orders.filter(order=>!order.deleted).filter(order=>q?orderMatchesSearch(order,q):groupOf(order)===state.tab)}
function clearListModes(){$('orderSearch').value=''}
function revealOrder(order){clearListModes();if(order)state.tab=groupOf(order);render()}
function renderTabs(){
  const query=currentSearch();
  $('tabs').innerHTML=Object.entries(ORDER_STATUS).map(([key,label])=>{const count=state.orders.filter(order=>!order.deleted&&groupOf(order)===key).length;return `<button type="button" role="tab" aria-selected="${!query&&state.tab===key}" class="${!query&&state.tab===key?'active':''}" data-tab="${key}">${label}<span>${count}</span></button>`}).join('');
  $('tabs').querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{state.tab=button.dataset.tab;clearListModes();render()});
}
function formatDateTime(value,short=false){const date=new Date(value||'');if(Number.isNaN(date.getTime()))return '日時不明';return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:short?undefined:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(date)}
function renderMetrics(){
  const all=state.orders.filter(order=>!order.deleted&&!isUnconfirmed(order));
  $('orderCount').textContent=`${all.length}件`;
  $('todayOrderCount').textContent=`${all.filter(order=>createdDateInTokyo(order)===today()).length}件`;
  $('searchSummary').textContent=currentSearch()?`すべての状態から検索：${filteredOrders().length}件`:`${ORDER_STATUS[state.tab]}の注文を、新しい順に表示しています`;
}
function renderOrders(){
  const list=filteredOrders(),wrap=$('orders');
  if(!list.length){wrap.innerHTML=`<div class="empty">${currentSearch()?'該当する注文はありません。':`${ORDER_STATUS[state.tab]}の注文はありません。`}<br><small>${currentSearch()?'店舗名・電話・品番などで検索できます。':'別のタブを選ぶか、下の「新しい注文」から始めてください。'}</small></div>`;return}
  wrap.innerHTML=list.map(cardHtml).join('');
  wrap.querySelectorAll('[data-detail]').forEach(button=>button.onclick=()=>showDetail(button.dataset.detail));
  wrap.querySelectorAll('[data-handover]').forEach(button=>button.onclick=()=>handOverFromCard(button.dataset.handover));
  wrap.querySelectorAll('[data-payment]').forEach(button=>button.onclick=()=>showPickupPayment(state.orders.find(order=>order.localId===button.dataset.payment)));
  wrap.querySelectorAll('[data-delete]').forEach(button=>button.onclick=()=>deleteOrderWithConfirmation(state.orders.find(order=>order.localId===button.dataset.delete)));
}
function pickupNumberHtml(order){const label=pickupNumberLabel(order);return label?`<div class="pickupNumber"><span>お渡し番号</span><strong>${esc(label)}</strong></div>`:''}
function cardHtml(order){
  if(isUnconfirmed(order))return `<article class="orderCard unconfirmedCard"><div class="unconfirmedBadge">未確定・${order.slackShared?'最後の確定待ち':'Slack共有待ち'}</div>${pickupNumberHtml(order)}<div class="orderTop"><div class="store">${esc(order.store)}</div><div class="amount">${yen(totalOf(order))}</div></div><div class="cardNote">${esc(order.customer)} ／ ${esc(handoffLabel(order))}</div><p>まだ受注件数・一括印刷には含まれていません。</p><button class="primary fullButton" data-detail="${esc(order.localId)}">${order.slackShared?'注文確定へ進む':'Slack共有・確定を続ける'}</button></article>`;
  const paid=isPickupPaymentRecorded(order),paymentBusy=pendingPayments.has(order.localId);
  const handover=isPickupOrder(order)&&!order.delivered?`<div class="pickupCardActions">${paid?`<div class="pickupPaidStatus">✓ 会計済（${esc(paymentMethodLabel(order))}）</div>`:`<button type="button" class="secondary paymentButton" data-payment="${esc(order.localId)}" ${paymentBusy?'disabled':''}>${paymentBusy?'保存中…':'会計済'}</button>`}<button class="primary handoverButton" data-handover="${esc(order.localId)}" ${!paid||pendingHandovers.has(order.localId)||paymentBusy?'disabled':''}>${pendingHandovers.has(order.localId)?'保存中…':'お渡し済み'}</button>${!paid?'<small>会計後に「会計済」で現金・クレジットを記録してください。</small>':''}</div>`:'';
  const deleting=pendingDeletes.has(order.localId);
  const deleteButton=groupOf(order)==='done'?`<button type="button" class="dangerBtn compact deleteOrderButton" data-delete="${esc(order.localId)}" aria-label="${esc(order.store)}の注文を削除" ${deleting?'disabled':''}>${deleting?'削除中…':'削除'}</button>`:'';
  return `<article class="orderCard">${pickupNumberHtml(order)}<div class="orderTop"><div>${order.receiptNo?`<div class="receiptNo">${esc(order.receiptNo)}</div>`:''}<div class="store">${esc(order.store)}</div></div><div class="amount">${yen(totalOf(order))}</div></div><div class="chips"><span class="chip">${esc(labelOrder(order))}</span><span class="chip">${itemCountOf(order)}点</span></div><div class="cardNote">${order.customer?`${esc(order.customer)} ／ `:''}${esc(handoffLabel(order))}</div><div class="cardBottom"><span class="receivedAt">${esc(formatDateTime(order.createdAt,true))}</span><div class="cardButtons"><button class="secondary compact" data-detail="${esc(order.localId)}" ${deleting?'disabled':''}>詳細・印刷</button>${deleteButton}</div></div>${handover}</article>`;
}

async function deleteOrderWithConfirmation(order,{fromDetail=false}={}){
  if(!order||pendingDeletes.has(order.localId))return;
  if(!confirm(`この注文を削除しますか？\n\n店舗：${order.store||'未入力'}\n${order.receiptNo?`受付番号：${order.receiptNo}\n`:''}合計：${yen(totalOf(order))}\n\n全端末の一覧・集計・一括印刷から除外します。\n復旧用のデータはSupabaseに残ります。\n共有済みのPDF・控え画像やSlack投稿は取り消されません。`))return;
  const version=state.sheetVersion,id=order.localId;
  const controls=fromDetail?[...$('sheetBody').querySelectorAll('button,input,select')].map(element=>({element,disabled:element.disabled})):[];
  controls.forEach(({element})=>element.disabled=true);
  pendingDeletes.add(id);renderOrders();
  try{
    await hideOrder(order);attachmentStore.clearOrder(id);
    if(state.draft?.localId===id||state.draft?.editingId===id)state.draft=null;
    if(fromDetail&&version===state.sheetVersion)closeSheet();
    updateNewOrderButton();toast('注文を削除しました');
  }catch(error){
    const message=error.message==='SYNC_CONFLICT'?'別の端末で更新・削除されています。最新の注文を確認してください。':'削除を確認できませんでした。接続後に同期し、注文が残っていればもう一度お試しください。';
    if(fromDetail&&version===state.sheetVersion)showError(message);else toast(message);
  }finally{
    controls.forEach(({element,disabled})=>element.disabled=disabled);
    pendingDeletes.delete(id);renderOrders();
  }
}

async function handOverFromCard(id){
  const order=state.orders.find(item=>item.localId===id);if(!order||!isPickupOrder(order)||order.delivered||pendingHandovers.has(id))return;
  if(isUnconfirmed(order))return toast('先にSlack共有と注文確定を完了してください。');
  if(!isPickupPaymentRecorded(order)||pendingPayments.has(id))return toast('先に「会計済」で会計方法を記録してください。');
  const version=state.sheetVersion;pendingHandovers.add(id);renderOrders();
  try{
    const updated=await updateOrder(markPickupDelivered(order));
    if(version===state.sheetVersion){if(state.draft?.localId===id)state.draft=null;revealOrder(updated)}toast('お渡し済みとして完了しました');
  }catch(error){toast(error.message==='SYNC_CONFLICT'?'別の端末で更新されています。最新の注文を確認してください。':'保存できませんでした。接続を確認して、もう一度お押しください。')}
  finally{pendingHandovers.delete(id);renderOrders()}
}

function showPickupPayment(order,{fromDetail=false}={}){
  if(!order||!isPickupOrder(order)||order.delivered||isPickupPaymentRecorded(order)||pendingPayments.has(order.localId))return;
  if(isUnconfirmed(order))return toast('先にSlack共有と注文確定を完了してください。');
  openSheet('会計済を記録',pickupNumberLabel(order)||'受け取り時会計');
  const version=state.sheetVersion,id=order.localId;
  let method='';
  $('sheetBody').innerHTML=`<div class="step"><div class="section"><div class="summaryRow"><span>店舗</span><b>${esc(order.store)}</b></div>${order.receiptNo?`<div class="summaryRow"><span>受付番号</span><b>${esc(order.receiptNo)}</b></div>`:''}<div class="summaryRow total"><span>会計金額</span><b>${yen(totalOf(order))}</b></div></div><p class="stepIntro">実際のお会計を済ませてから、会計方法を選んで記録してください。この操作で決済や請求は行いません。</p><div class="choiceGrid paymentChoices" role="group" aria-label="実際の会計方法"><button type="button" class="choice" data-payment-method="credit" aria-pressed="false"><b>クレジット</b></button><button type="button" class="choice" data-payment-method="cash" aria-pressed="false"><b>現金</b></button></div><div id="paymentCashHint" class="hintBox topGap hidden">現金の受取金額を確認してください。</div><p class="stepIntro topGap">会計を記録しても「受け取り待ち」のままです。商品を渡した後に「お渡し済み」を押してください。</p></div><div class="stickyActions"><button id="paymentCancel" class="secondary">戻る</button><button id="paymentConfirm" class="primary" disabled>会計済を記録</button></div>`;
  const confirmButton=$('paymentConfirm'),controls=[...$('sheetBody').querySelectorAll('button')];
  $('sheetBody').querySelectorAll('[data-payment-method]').forEach(button=>button.onclick=()=>{
    method=button.dataset.paymentMethod;
    $('sheetBody').querySelectorAll('[data-payment-method]').forEach(choice=>{const selected=choice.dataset.paymentMethod===method;choice.classList.toggle('on',selected);choice.setAttribute('aria-pressed',String(selected))});
    $('paymentCashHint').classList.toggle('hidden',method!==PAYMENT.CASH);confirmButton.disabled=false;clearError();
  });
  $('paymentCancel').onclick=()=>{if(fromDetail)showDetail(id);else closeSheet()};
  confirmButton.onclick=async()=>{
    if(pendingPayments.has(id)||![PAYMENT.CREDIT,PAYMENT.CASH].includes(method))return;
    const current=state.orders.find(item=>item.localId===id);
    if(!current||current.cloudUpdatedAt!==order.cloudUpdatedAt){confirmButton.disabled=true;return showError('別の端末で更新・削除されています。戻って最新の注文を確認してください。')}
    pendingPayments.add(id);controls.forEach(button=>button.disabled=true);confirmButton.textContent='保存中…';renderOrders();
    let conflict=false;
    try{
      const updated=await updateOrder(markPickupPaid(order,method));
      if(version!==state.sheetVersion)return;
      if(state.draft?.localId===id||state.draft?.editingId===id)state.draft=null;
      revealOrder(updated);if(fromDetail)showDetail(id);else closeSheet();toast(`会計済（${paymentMethodLabel(updated)}）を記録しました`);
    }catch(error){
      conflict=error.message==='SYNC_CONFLICT';
      if(version===state.sheetVersion)showError(conflict?'別の端末で更新・削除されています。戻って最新の注文を確認してください。':'会計を記録できませんでした。接続を確認して再試行してください。決済のやり直しは不要です。');
    }finally{
      pendingPayments.delete(id);renderOrders();
      if(version===state.sheetVersion){controls.forEach(button=>button.disabled=false);confirmButton.disabled=conflict;confirmButton.textContent='会計済を記録'}
    }
  };
}

function clearReceiptPreview(){if(state.receiptBlobUrl)URL.revokeObjectURL(state.receiptBlobUrl);state.receiptBlobUrl=null;state.sheetVersion++}
function openSheet(title,step=''){clearReceiptPreview();state.rememberDraftInput=null;$('sheetTitle').textContent=title;$('stepLabel').textContent=step;$('sheet').classList.remove('hidden');document.body.style.overflow='hidden';clearError()}
function hasResumableDraft(){return Boolean(state.draft&&state.draft.stage!=='success'&&!state.draft.editingId)}
function updateNewOrderButton(){const resumable=hasResumableDraft();$('newOrderBtn').textContent=resumable?'↩ 入力途中の注文を再開':'＋ 新しい注文';$('discardDraftBtn').classList.toggle('hidden',!resumable)}
function closeSheet(){state.rememberDraftInput?.();state.rememberDraftInput=null;clearReceiptPreview();$('sheet').classList.add('hidden');$('sheet').classList.remove('productFullscreen');document.body.style.overflow='';updateNewOrderButton()}
function showError(msg){$('sheetError').textContent=msg;$('sheetError').classList.remove('hidden');$('sheetPanel')?.scrollTo({top:0,behavior:'smooth'})}
function clearError(){$('sheetError').classList.add('hidden');$('sheetError').textContent=''}
function savedKeypadAlign(){try{return localStorage.getItem(LS_KEYPAD_ALIGN)==='left'?'left':'right'}catch{return'right'}}
function freshDraft(){return{stage:'products',productQuery:'',keypadMode:'number',keypadAlign:savedKeypadAlign(),type:null,handoff:null,customerRegion:'domestic',items:[],store:'',phone:'',customer:'',account:'',accountChoice:'',accountOther:'',staff:state.staff?.display_name||'',paymentMethod:PAYMENT.CREDIT,paid:false,delivered:false,shipped:false,prepared:PREP.NONE,headOfficeShared:false,headOfficeSharedAt:'',slackShared:false,slackSharedAt:'',workflowStatus:'active',pickupDate:dateOffset(1),notes:'',clientSubmissionId:newUuid()}}
function startOrder(){const resume=hasResumableDraft();if(!resume){attachmentStore.clear();state.draft=freshDraft()}openSheet('新しい注文','1 / 3');renderDraft();if(resume)toast('入力途中の注文を再開しました')}
function showDiscardDraftConfirm(){if(!hasResumableDraft())return startOrder();state.rememberDraftInput?.();const d=state.draft,count=itemCountOf(d),store=String(d.store||'').trim();openSheet('入力途中の注文を破棄','確認');$('sheetBody').innerHTML=`<div class="step"><div class="shareConfirm"><div class="successMark pending">!</div><h3>入力途中の内容を破棄しますか？</h3><p>破棄を確定した場合だけ新しい注文へ切り替わります。</p></div><div class="section"><div class="summaryRow"><span>追加済み商品</span><b>${count}点</b></div>${store?`<div class="summaryRow"><span>入力済み店舗</span><b>${esc(store)}</b></div>`:''}</div></div><div class="stickyActions"><button id="discardCancel" class="secondary">キャンセル</button><button id="discardConfirm" class="dangerBtn">破棄して新規開始</button></div>`;$('discardCancel').onclick=renderDraft;$('discardConfirm').onclick=()=>{state.draft=null;startOrder();toast('入力途中の注文を破棄しました')}}
function startEditOrder(order){if(!(state.draft?.editingId===order.localId&&state.draft.stage!=='success'))state.draft={...order,productQuery:'',keypadMode:'number',keypadAlign:savedKeypadAlign(),items:(order.items||[]).map(item=>({...item,lineId:item.lineId||newUuid()})),stage:'products',editingId:order.localId};openSheet('注文を修正','1 / 3');renderDraft()}
function renderDraft(){state.rememberDraftInput=null;clearError();if(!state.draft)return;const d=state.draft;$('sheet').classList.toggle('productFullscreen',d.stage==='products');if(d.stage==='products')renderProductStep(d);else if(d.stage==='type')renderTypeStep(d);else if(d.stage==='info')renderInfoStep(d);else if(d.stage==='finalize')renderFinalizeStep(d);else if(d.stage==='success')renderSuccess(d)}
function renderProductStep(d){const align=d.keypadAlign==='left'?'left':'right';$('stepLabel').textContent=`1 / 3　${d.editingId?'修正':'商品'}`;$('sheetTitle').textContent=d.editingId?'注文を修正':'商品を追加';$('sheetBody').innerHTML=`<div class="step productStep"><div class="productSearch"><div class="productSearchRow"><input id="productQ" type="search" inputmode="search" placeholder="品番・商品名" autocomplete="off"><button id="clearPQ" class="secondary" aria-label="検索をクリア">×</button></div><div id="productKeypadDock" class="productKeypadDock align-${align}"><div class="keypadTitle"><div class="keypadTitleMain"><b>固定入力キー</b><span id="keypadModeLabel" class="keypadModeLabel">数字・記号</span></div><div class="keypadAlignSwitch" aria-label="キーボードの位置"><button id="keypadAlignLeft" type="button" aria-label="キーボードを左寄せにする">◀ 左</button><button id="keypadAlignRight" type="button" aria-label="キーボードを右寄せにする">右 ▶</button></div></div><div id="productKeypad" class="productKeypad numberKeys"></div><button id="addShippingFee" type="button" class="secondary shippingFeeButton">＋ 送料 ¥500</button></div><div id="productResults" class="productResults" role="listbox"></div></div><div class="section productCartSection"><div class="sectionTitle">注文明細 <span id="cartCount">${itemCountOf(d)}点</span></div><div id="cartLines" class="cart"></div></div></div><div class="stickyActions one"><button id="toType" class="primary" ${d.items.length?'':'disabled'}>注文内容へ進む</button></div>`;const q=$('productQ');q.value=d.productQuery||'';q.oninput=()=>renderProductResults(d,q.value);$('clearPQ').onclick=()=>{q.value='';renderProductResults(d,'')};bindProductKeypad(d,q);$('addShippingFee').onclick=()=>{if(addShippingFee(d,newUuid())){clearError();renderCart(d);toast('送料500円を追加しました')}};$('toType').onclick=()=>{if(!itemCountOf(d))return showError('商品を1点以上追加してください。');d.stage='type';renderDraft()};renderCart(d);renderProductResults(d,q.value)}
function bindProductKeypad(d,q){
  const wrap=$('productKeypad'),dock=$('productKeypadDock'),modeLabel=$('keypadModeLabel'),left=$('keypadAlignLeft'),right=$('keypadAlignRight');let mode=d.keypadMode==='alpha'?'alpha':'number';
  const numeric=[['1'],['2'],['3'],['4'],['5'],['6'],['7'],['8'],['9'],['-'],['0'],['⌫','backspace']],numericUtility=[['英字','alpha'],['クリア','clear']];
  const qwerty=[['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['Z','X','C','V','B','N','M']],alphaUtility=[['-'],['⌫','backspace'],['数字','number'],['クリア','clear']];
  const keyHtml=([label,action='insert'])=>`<button type="button" class="keypadKey" data-key-action="${action}" data-key-value="${esc(label)}" aria-label="${label==='⌫'?'1文字削除':esc(label)}">${esc(label)}</button>`;
  const setAlign=align=>{d.keypadAlign=align==='left'?'left':'right';dock.classList.toggle('align-left',d.keypadAlign==='left');dock.classList.toggle('align-right',d.keypadAlign==='right');left.classList.toggle('on',d.keypadAlign==='left');right.classList.toggle('on',d.keypadAlign==='right');try{localStorage.setItem(LS_KEYPAD_ALIGN,d.keypadAlign)}catch{}};
  const draw=()=>{
    d.keypadMode=mode;wrap.className=`productKeypad ${mode==='number'?'numberKeys':'alphaKeys'}`;modeLabel.textContent=mode==='number'?'数字・記号':'英字 QWERTY';
    wrap.innerHTML=mode==='number'?`${numeric.map(keyHtml).join('')}<div class="keypadUtility">${numericUtility.map(keyHtml).join('')}</div>`:`${qwerty.map((row,index)=>`<div class="alphaKeyRow row-${index+1}">${row.map(value=>keyHtml([value])).join('')}</div>`).join('')}<div class="keypadUtility">${alphaUtility.map(keyHtml).join('')}</div>`;
    wrap.querySelectorAll('[data-key-action]').forEach(button=>{button.onpointerdown=event=>event.preventDefault();button.onclick=()=>{const action=button.dataset.keyAction,value=button.dataset.keyValue;if(action==='alpha'){mode='alpha';draw();return}if(action==='number'){mode='number';draw();return}if(action==='clear')q.value='';else if(action==='backspace')q.value=q.value.slice(0,-1);else q.value+=value;renderProductResults(d,q.value)}});
  };
  [left,right].forEach(button=>button.onpointerdown=event=>event.preventDefault());left.onclick=()=>setAlign('left');right.onclick=()=>setAlign('right');setAlign(d.keypadAlign);draw();
}
function renderProductResults(d,query){
  d.productQuery=String(query||'');const q=d.productQuery.trim().toLowerCase(),wrap=$('productResults');
  if(!q){wrap.innerHTML='';wrap.classList.remove('open');return}
  const list=state.products.map((product,index)=>({product,index,rank:productRank(product,q)})).filter(result=>result.rank<9).sort((a,b)=>a.rank-b.rank||a.index-b.index).slice(0,35);
  wrap.classList.add('open');
  wrap.innerHTML=list.length?list.map(({product,rank})=>{const ordered=d.items.find(item=>item.productId===product.productId);return `<div class="productRow ${rank===0?'exact':''} ${product.orderable?'':'unavailable'}" role="option"><div><div class="productCodeLine"><b>${esc(product.code)}</b>${rank===0?'<span class="matchBadge">完全一致</span>':''}</div><small>${esc(product.name)} ／ ${product.orderable?yen(product.price):'価格未定・注文不可'}</small></div><button class="addBtn" data-product-id="${esc(product.productId)}" ${product.orderable?'':'disabled'}>${product.orderable?(ordered?`追加済み ${ordered.qty}・＋`:'追加'):'追加不可'}</button></div>`}).join(''):'<div class="empty">該当商品がありません。</div>';
  wrap.querySelectorAll('[data-product-id]').forEach(button=>button.onclick=()=>{
    const product=state.products.find(item=>item.productId===button.dataset.productId);if(!product?.orderable)return;
    const existing=d.items.find(item=>item.productId===product.productId);
    if(existing)existing.qty++;else d.items.push({...product,lineId:`line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`,qty:1});
    clearError();renderCart(d);renderProductResults(d,$('productQ').value);toast(`${product.code} を追加`);
  });
}
function productRank(p,q){const c=String(p.code).toLowerCase(),n=String(p.name).toLowerCase();const qn=q.replace(/-/g,''),cn=c.replace(/-/g,'');if(c===q||cn===qn)return 0;if(c.startsWith(q)||cn.startsWith(qn))return 1;if(c.includes(q)||cn.includes(qn))return 2;if(n.includes(q))return 3;return 9}
function renderCart(d){
  const wrap=$('cartLines'),count=itemCountOf(d);const shippingAdded=d.items.some(isShippingItem);if($('addShippingFee')){$('addShippingFee').disabled=shippingAdded;$('addShippingFee').textContent=shippingAdded?'✓ 送料 ¥500 追加済み':'＋ 送料 ¥500'}if($('cartCount'))$('cartCount').textContent=`${count}点`;
  if($('toType'))$('toType').disabled=!count;if(!d.items.length){wrap.innerHTML='<div class="empty" style="padding:22px">まだ商品がありません。</div>';return}
  wrap.innerHTML=d.items.map(item=>`<div class="cartLine"><div><b>${esc(item.code)} ${esc(item.name)}</b><small>${yen(item.price)} × ${esc(item.qty)}</small></div><div class="qty">${isShippingItem(item)?`<button data-remove-shipping="${esc(item.lineId)}" aria-label="送料を取り消す">取消</button>`:`<button data-minus="${esc(item.lineId)}" aria-label="数量を減らす">−</button><b>${esc(item.qty)}</b><button data-plus="${esc(item.lineId)}" aria-label="数量を増やす">＋</button>`}</div></div>`).join('')+`<div class="totalRow"><span>合計</span><span>${yen(totalOf(d))}</span></div>`;
  wrap.querySelectorAll('[data-remove-shipping]').forEach(button=>button.onclick=()=>{d.items=d.items.filter(item=>item.lineId!==button.dataset.removeShipping);renderCart(d)});
  wrap.querySelectorAll('[data-plus]').forEach(button=>button.onclick=()=>{const item=d.items.find(value=>value.lineId===button.dataset.plus);if(item)item.qty++;renderCart(d)});
  wrap.querySelectorAll('[data-minus]').forEach(button=>button.onclick=()=>{const item=d.items.find(value=>value.lineId===button.dataset.minus);if(!item)return;item.qty--;if(item.qty<=0)d.items=d.items.filter(value=>value!==item);renderCart(d)});
}
function renderTypeStep(d){const canContinue=Boolean(d.type&&(d.type!==ORDER_TYPE.SPOT||d.handoff));$('stepLabel').textContent='2 / 3　注文方法';$('sheetTitle').textContent='どの対応ですか？';$('sheetBody').innerHTML=`<div class="step"><p class="stepIntro">実際の対応に一番近いものを選んでください。</p><div class="choiceGrid"><button class="choice ${d.type===ORDER_TYPE.NORMAL?'on':''}" data-type="normal"><b>国内通常注文</b><small>卸屋・電話番号を入力して受注完了。帰社後にまとめて印刷します。</small></button><button class="choice ${d.type===ORDER_TYPE.SPOT?'on':''}" data-type="spot"><b>現売り対応</b><small>会場での会計・受け渡し、後日受取、配送です。</small></button></div>${d.type===ORDER_TYPE.SPOT?`<div class="section topGap"><div class="sectionTitle">商品の渡し方 *</div><div class="choiceGrid handoffChoices"><button class="choice ${d.handoff===HANDOFF.NOW?'on':''}" data-handoff="now"><b>1　在庫あり・その場渡し</b><small>会計して、その場で商品をお渡しします。</small></button><button class="choice ${d.handoff===HANDOFF.LATER?'on':''}" data-handoff="later"><b>2　翌日・翌々日に受取</b><small>お受け取り予定日を入力します。</small></button><button class="choice ${d.handoff===HANDOFF.HOTEL?'on':''}" data-handoff="hotel"><b>3　ホテルへ配送</b><small>配送先は別紙に記入できます。</small></button><button class="choice ${d.handoff===HANDOFF.SHIP?'on':''}" data-handoff="ship"><b>4　指定住所へ配送</b><small>配送先は別紙に記入できます。</small></button></div></div>`:''}</div><div class="stickyActions"><button id="backProducts" class="secondary">戻る</button><button id="toInfo" class="primary" ${canContinue?'':'disabled'}>入力へ進む</button></div>`;document.querySelectorAll('[data-type]').forEach(button=>button.onclick=()=>{const previous=d.type;d.type=button.dataset.type;if(d.type===ORDER_TYPE.SPOT&&previous!==ORDER_TYPE.SPOT)d.handoff=null;if(d.type===ORDER_TYPE.NORMAL){d.paymentMethod=paymentMethodOnHandoffChange(d,null);d.handoff=null;d.headOfficeShared=false}renderDraft()});document.querySelectorAll('[data-handoff]').forEach(button=>button.onclick=()=>{d.paymentMethod=paymentMethodOnHandoffChange(d,button.dataset.handoff);if(button.dataset.handoff===HANDOFF.LATER&&d.handoff!==HANDOFF.LATER){d.delivered=false;d.deliveredAt='';d.workflowStatus=d.slackShared?'waiting':'active'}d.handoff=button.dataset.handoff;if(d.handoff===HANDOFF.NOW){d.headOfficeShared=false;d.headOfficeSharedAt=''}renderDraft()});$('backProducts').onclick=()=>{d.stage='products';renderDraft()};$('toInfo').onclick=()=>{if(!d.type)return showError('注文方法を選択してください。');if(d.type===ORDER_TYPE.SPOT&&!d.handoff)return showError('商品の渡し方を選択してください。');d.stage='info';renderDraft()}}
function slackSharedField(order,id){
  if(!needsHeadOfficeShare(order))return '';
  return `<div class="slackSharePanel"><b>${order.slackShared?'✓ Slack送信確認済み':'Slack送信の確認が必要です'}</b>${order.slackSharedAt?`<small>確認日時：${esc(formatDateTime(order.slackSharedAt))}</small>`:''}<p>共有内容を変える場合は「注文を修正」から、PDFを作り直して再共有してください。</p>${!order.slackShared?`<button id="${id}Resume" class="primary fullButton">Slack共有・確定へ進む</button>`:''}</div>`;
}
function renderInfoStep(d){
  const normal=d.type===ORDER_TYPE.NORMAL,now=d.handoff===HANDOFF.NOW;
  $('stepLabel').textContent='3 / 3　入力・確認';$('sheetTitle').textContent=d.editingId?'注文を修正':normal?'通常注文を受ける':'現売りを登録';
  const accounts=state.accounts,staffNames=[...new Set([d.staff,state.staff?.display_name].filter(Boolean))];
  const accountChoice=d.accountChoice||(d.account?(accounts.includes(d.account)?d.account:'その他'):''),accountOther=d.accountOther||(accountChoice==='その他'&&d.account!=='その他'?d.account:'');d.accountChoice=accountChoice;d.accountOther=accountOther;
  const accountOptions=accounts.map(value=>`<option value="${esc(value)}" ${accountChoice===value?'selected':''}>${esc(value)}</option>`).join('');
  const staffOptions=staffNames.map(value=>`<option value="${esc(value)}" ${d.staff===value?'selected':''}>${esc(value)}</option>`).join('');
  const normalFields=`<div class="field"><label for="fAccount">卸屋・帳合先 *</label><select id="fAccount"><option value="">選択してください</option>${accountOptions}</select></div>${accountChoice==='その他'?`<div class="field"><label for="fAccountOther">卸屋・帳合先名 *</label><input id="fAccountOther" value="${esc(accountOther)}" placeholder="具体名を入力"></div>`:''}<div class="field"><label for="fStaff">受注担当者 *</label><select id="fStaff"><option value="">選択してください</option>${staffOptions}</select></div><div class="field"><label for="fCustomer">お客様名（任意）</label><input id="fCustomer" value="${esc(d.customer)}"></div>`;
  const pickupFields=d.handoff===HANDOFF.LATER?`<div class="field pickupDateField"><label for="fPickup">受け取り予定日 *</label><input id="fPickup" type="date" min="${dateOffset(1)}" value="${esc(d.pickupDate)}"><div class="quickDates"><button type="button" data-day="1" aria-pressed="${d.pickupDate===dateOffset(1)}" class="${d.pickupDate===dateOffset(1)?'on':''}">明日</button><button type="button" data-day="2" aria-pressed="${d.pickupDate===dateOffset(2)}" class="${d.pickupDate===dateOffset(2)?'on':''}">明後日</button></div></div>`:'';
  const destinationFields=d.handoff===HANDOFF.HOTEL?`<p class="stepIntro">配送先は別紙にご記入いただけます。以下はすべて任意です。</p><div class="field"><label for="fHotel">ホテル名（任意）</label><input id="fHotel" value="${esc(d.hotelName||'')}"></div><div class="two"><div class="field"><label for="fGuest">宿泊者名（任意）</label><input id="fGuest" value="${esc(d.guestName||'')}"></div><div class="field"><label for="fRoom">部屋番号（任意）</label><input id="fRoom" value="${esc(d.roomNo||'')}"></div></div><div class="field"><label for="fCheckout">チェックアウト予定日（任意）</label><input id="fCheckout" type="date" value="${esc(d.checkoutDate||'')}"></div>`:d.handoff===HANDOFF.SHIP?`<p class="stepIntro">配送先は別紙にご記入いただけます。</p><div class="field"><label for="fShip">配送先住所（任意）</label><textarea id="fShip">${esc(d.shipAddress||'')}</textarea></div>`:'';
  const spotFields=`<div class="field"><label for="fCustomer">お客様名 *</label><input id="fCustomer" value="${esc(d.customer)}"></div><div class="two"><div class="field"><label for="fRegion">お客様</label><select id="fRegion"><option value="domestic" ${d.customerRegion==='domestic'?'selected':''}>国内</option><option value="overseas" ${d.customerRegion==='overseas'?'selected':''}>海外</option></select><small>海外のお客様の控えは英語で発行します。</small></div><div class="field"><label for="fPayment">会計方法 *</label><select id="fPayment">${isPickupOrder(d)&&!d.paid?`<option value="on_pickup" ${d.paymentMethod===PAYMENT.ON_PICKUP?'selected':''}>受け取り時会計</option>`:''}<option value="credit" ${d.paymentMethod===PAYMENT.CREDIT?'selected':''}>クレジット</option><option value="cash" ${d.paymentMethod===PAYMENT.CASH?'selected':''}>現金</option></select></div></div>${pickupFields}${destinationFields}`;
  const operationHint=`${isPickupOrder(d)?pickupNumberHtml(d):''}<div class="hintBox sendHint">${isPickupOrder(d)?'下のボタンでお渡し番号を発行します。番号発行 → Slack共有 → 注文確定の順に進めます。'+(pickupNumberLabel(d)?'発行済みの番号は変わりません。':''):needsHeadOfficeShare(d)?'次の画面で、Slack共有 → 注文確定の順に進めます。':'確定した注文はスタッフ間で同期され、印刷後も残ります。'}</div>`;
  const saveLabel=isPickupOrder(d)?pickupNumberLabel(d)?'同じ番号で保存して進む':'お渡し番号を発行':needsHeadOfficeShare(d)?'共有・確定へ進む':d.editingId?'変更を確定':'注文確定';
  $('sheetBody').innerHTML=`<div class="step"><div class="section"><div class="field"><label for="fStore">店舗名 *</label><input id="fStore" value="${esc(d.store)}" placeholder="〇〇眼鏡店"></div><div class="field"><label for="fPhone">電話番号 *</label><input id="fPhone" inputmode="tel" autocomplete="tel" value="${esc(d.phone)}"><div id="phoneWarning" class="fieldWarning ${phoneHasUnexpectedCharacters(d.phone)?'':'hidden'}">数字、+、-、空白、括弧以外が含まれています。入力内容を確認してください。</div></div>${normal?normalFields:spotFields}<div class="field"><label for="fNotes">備考（任意）</label><textarea id="fNotes" placeholder="納期・連絡事項など">${esc(d.notes||'')}</textarea></div></div><div class="section"><div class="sectionTitle">注文確認</div>${d.items.map(item=>`<div class="summaryRow"><span>${esc(item.code)} ${esc(item.name)} × ${esc(item.qty)}</span><b>${yen(item.price*item.qty)}</b></div>`).join('')}<div class="summaryRow"><span>合計</span><b>${yen(totalOf(d))}</b></div></div>${operationHint}${d.paymentMethod===PAYMENT.CASH?'<div class="hintBox topGap">現金は釣銭を用意しない運用です。受取金額を確認してください。</div>':''}</div><div class="stickyActions"><button id="backType" class="secondary">戻る</button><button id="saveBtn" class="primary">${saveLabel}</button></div>`;
  $('saveBtn').parentElement.classList.toggle('issueNumberActions',isPickupOrder(d));
  bindInfo(d,normal,now);
}
function bindInfo(d,normal,now){
  const remember=()=>{
    d.store=$('fStore').value.trim();d.phone=$('fPhone').value.trim();d.customer=$('fCustomer')?.value.trim()||'';d.notes=$('fNotes')?.value.trim()||'';
    if(normal){d.accountChoice=$('fAccount').value;d.accountOther=$('fAccountOther')?.value.trim()||'';d.account=d.accountChoice==='その他'?d.accountOther:d.accountChoice;d.staff=$('fStaff').value}
    else{d.customerRegion=$('fRegion').value;d.paymentMethod=$('fPayment').value;if($('fPickup'))d.pickupDate=$('fPickup').value;if($('fHotel'))d.hotelName=$('fHotel').value.trim();if($('fGuest'))d.guestName=$('fGuest').value.trim();if($('fRoom'))d.roomNo=$('fRoom').value.trim();if($('fCheckout'))d.checkoutDate=$('fCheckout').value;if($('fShip'))d.shipAddress=$('fShip').value.trim()}
  };
  state.rememberDraftInput=remember;
  const updateQuickDates=()=>document.querySelectorAll('[data-day]').forEach(button=>{const selected=d.pickupDate===dateOffset(Number(button.dataset.day));button.classList.toggle('on',selected);button.setAttribute('aria-pressed',String(selected))});
  document.querySelectorAll('#sheetBody input,#sheetBody select,#sheetBody textarea').forEach(element=>element.onchange=()=>{remember();updateQuickDates();clearError()});
  $('fPhone').oninput=()=>{remember();$('phoneWarning').classList.toggle('hidden',!phoneHasUnexpectedCharacters($('fPhone').value));clearError()};
  if($('fAccount'))$('fAccount').onchange=()=>{remember();renderDraft()};
  document.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{remember();d.pickupDate=dateOffset(Number(button.dataset.day));$('fPickup').value=d.pickupDate;updateQuickDates();clearError()});
  $('backType').onclick=()=>{remember();d.stage='type';renderDraft()};
  $('saveBtn').onclick=async()=>{
    remember();if(now){if(!d.paid)d.paidAt=new Date().toISOString();d.paid=true;d.delivered=true;d.prepared=PREP.READY}
    const errors=validate(d);if(errors.length)return showError(errors[0]);
    if(needsHeadOfficeShare(d)){
      d.sharingSaved=false;d.pdfPrepared=false;d.stage='finalize';renderDraft();
      if(isPickupOrder(d))return runFinalization(d,()=>prepareSharingDraft(d));
      return;
    }
    d.confirmationState='confirmed';$('saveBtn').disabled=true;
    d.workflowStatus=statusOnConfirmation(d,state.orders.find(order=>order.localId===d.editingId));
    try{const order=d.editingId?await saveEdited(d):await saveNew(d);if(d.editingId){state.draft=null;closeSheet();revealOrder(order);toast('変更を確定し、同期しました')}else{state.draft={...order,stage:'success'};renderDraft()}}
    catch(error){showError(error.message==='SYNC_CONFLICT'?'別の端末で更新されています。入力内容は残しています。一覧の最新内容を確認してください。':'まだ確定できていません。入力内容はこの画面に残っています。接続を確認して再度確定してください。');$('saveBtn').disabled=false}
  };
}
function resumeFinalization(order){
  state.draft={...order,items:order.items.map(item=>({...item})),editingId:order.localId,stage:'finalize',sharingSaved:isUnconfirmed(order),pdfPrepared:Boolean(order.slackShared)};
  openSheet('Slack共有・注文確定');renderDraft();
}
async function prepareSharingDraft(d){
  const errors=validate(d);if(errors.length)throw new Error(errors[0]);
  // Reuse the submission ID and payload if the save response is lost.
  Object.assign(d,prepareOrderForSharing(d));
  return d.editingId?saveEdited(d):saveNew(d);
}
async function runFinalization(d,action){
  const version=state.sheetVersion,key=d.clientSubmissionId||d.localId;
  if(pendingFinalizations.has(key)||attachmentOperation||attachmentPrintBusy)return;
  pendingFinalizations.add(key);clearError();
  const controls=[...$('sheet').querySelectorAll('button,input,select')].map(element=>({element,disabled:element.disabled}));controls.forEach(({element})=>element.disabled=true);
  const issueButton=$('prepareSharing');if(issueButton)issueButton.textContent=isPickupOrder(d)?'番号を確認・保存中…':'保存中…';
  try{
    const result=await action();
    if(version!==state.sheetVersion||state.draft!==d)return;
    Object.assign(d,result,{editingId:result.localId,sharingSaved:true});
    if(!isUnconfirmed(result)){d.stage='success';revealOrder(result)}
    renderDraft();
  }catch(error){
    if(version!==state.sheetVersion||state.draft!==d)return;
    renderDraft();
    showError(error.message==='SYNC_CONFLICT'?'別の端末で更新されたか、直前の保存が完了している可能性があります。この画面を閉じ、一覧から最新の注文を開き直してください。':'保存結果を確認できませんでした。入力内容は残っています。接続を確認して再試行してください。');
  }finally{pendingFinalizations.delete(key);controls.forEach(({element,disabled})=>element.disabled=disabled)}
}

const sharePdfCache=new WeakMap();
async function generateSharePdf(order){
  const card=document.createElement('div');
  card.innerHTML=printSheetHtml(order)+attachmentPagesHtml(order);
  return createOrderPdf(card,true);
}
function offerSharePdf(order){
  const {blob,pages}=sharePdfCache.get(order),panel=$('pdfOutput');
  const message=document.createElement('p');message.textContent=`PDFを作成しました（${pages}ページ）。`;panel.append(message);
  const filename=printFileBase([order])+'.pdf',file=new File([blob],filename,{type:'application/pdf'});
  const button=document.createElement('button');button.type='button';button.className='primary';button.textContent='PDFを共有する';
  button.onclick=async()=>{
    if(attachmentPrintBusy||attachmentOperation||state.draft!==order||!order.pdfPrepared)return;
    if(!navigator.canShare?.({files:[file]})){
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;panel.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      message.textContent='この端末では直接共有に対応していないため、PDFを保存します。保存したPDFをSlackなどへ添付してください。';return;
    }
    button.disabled=true;
    try{await navigator.share({files:[file]})}catch(error){if(error.name!=='AbortError')message.textContent='共有できませんでした。もう一度「PDFを共有する」を押してください。'}finally{button.disabled=false}
  };
  panel.append(button);
}

function renderFinalizeStep(d){
  const pickup=isPickupOrder(d),saved=d.sharingSaved&&isUnconfirmed(d),shared=saved&&d.slackShared,ready=saved&&canConfirmSharedOrder(d);
  const stepOne=pickup?'お渡し番号を発行':'共有の準備';
  $('stepLabel').textContent='最後の手順：上から順に進めてください';$('sheetTitle').textContent='Slack共有 → 注文確定';
  $('sheetBody').innerHTML=`<div class="step finalizeFlow"><div class="finalizeSummary"><b>${esc(d.store)} / ${esc(d.customer)}</b><span>${esc(handoffLabel(d))}</span><strong>${yen(totalOf(d))} · ${itemCountOf(d)}点</strong><button id="finalizeEdit" class="linkBtn">入力内容を修正する</button></div><section class="finalizeStep ${saved?'complete':'current'}"><div class="finalizeHeading"><span class="stepNumber">${saved?'✓':'1'}</span><h3>${stepOne}</h3><small>${saved?'準備済み':'まずここから'}</small></div>${saved?pickup?pickupNumberHtml(d):'<p>共有用の注文を保存しました。</p>':`<p>${pickup?'注文確定前に、重複しないNEO番号を発行します。':'PDFにする注文内容を先に保存します。'}<br>この時点では、まだ注文は確定しません。</p><button id="prepareSharing" class="primary fullButton">${pickup?pickupNumberLabel(d)?'同じお渡し番号で変更を保存':'お渡し番号を発行する':'共有用の注文を保存する'}</button>`}</section><section class="finalizeStep ${shared?'complete':saved?'current':'locked'}"><div class="finalizeHeading"><span class="stepNumber">${shared?'✓':'2'}</span><h3>Slackに共有</h3><small>${shared?'送信確認済み':saved?'次にここ':'1のあと'}</small></div><p>会社控え・添付写真を1つのPDFにまとめます。PDFを作成したら、下に表示される「PDFを共有する」からSlackへ投稿してください。会社控えは常に日本語です。</p><button id="prepareSharePdf" class="secondary fullButton" ${saved?'':'disabled'}>PDFを作成する</button><div id="pdfOutput" class="pdfOutput" role="status"></div><label class="flowShareCheck" ${d.pdfPrepared||shared?'':'hidden'}><input id="acknowledgeSlack" type="checkbox" ${shared?'checked':''} ${saved&&(d.pdfPrepared||shared)?'':'disabled'}><span>Slackに共有済み<br><small>投稿できたことを確認してチェック</small></span></label>${shared?`<small>確認日時：${esc(formatDateTime(d.slackSharedAt))}</small>`:''}</section><section class="finalizeStep ${ready?'current':'locked'}"><div class="finalizeHeading"><span class="stepNumber">3</span><h3>注文確定</h3><small>${ready?'あと1回':'2のあと'}</small></div><p>${pickup?'確定すると「受け取り待ち」に移ります。会計・お渡しは受け取り時に行います。':'確定すると「完了」に移ります。'}</p><button id="confirmSharedOrder" class="primary fullButton" ${ready?'':'disabled'}>Slack共有を完了して、注文確定</button>${!ready?'<small>Slackへの送信確認が済むと押せます。</small>':''}</section><p class="draftRetentionNote">${saved?'保存済みのため、閉じても「要対応」から再開できます。未確定の注文は受注件数・一括印刷に含めません。':'手順1を完了すると、入力内容がスタッフ間で保存・同期されます。'}</p>${d.localId?'<button id="cancelReservedOrder" class="linkBtn">この注文をキャンセルする</button>':''}</div><div class="stickyActions one"><button id="finalizeClose" class="secondary">閉じる・あとで続ける</button></div>`;
  $('prepareSharePdf').insertAdjacentHTML('beforebegin',attachmentPickerHtml(d,saved));
  bindAttachmentPicker(d,saved);
  if(d.pdfPrepared&&sharePdfCache.has(d))offerSharePdf(d);
  const key=d.clientSubmissionId||d.localId,run=action=>runFinalization(d,action);
  $('finalizeEdit').onclick=()=>{d.stage='info';d.sharingSaved=false;d.pdfPrepared=false;renderDraft()};
  $('finalizeClose').onclick=closeSheet;
  if($('prepareSharing'))$('prepareSharing').onclick=()=>run(()=>prepareSharingDraft(d));
  $('prepareSharePdf').onclick=async()=>{
    if(!saved||pendingFinalizations.has(key)||attachmentOperation||attachmentPrintBusy)return;
    const current=state.orders.find(order=>order.localId===d.localId);
    if(!current||current.cloudUpdatedAt!==d.cloudUpdatedAt)return showError('注文が更新されています。閉じて一覧から最新の内容を開き直してください。');
    const version=state.sheetVersion;attachmentPrintBusy=true;
    const controls=[...$('sheet').querySelectorAll('button,input,select')].map(element=>({element,disabled:element.disabled}));controls.forEach(({element})=>element.disabled=true);
    let failure='';
    try{toast('PDFを作成しています…');const result=await generateSharePdf(d);if(version===state.sheetVersion&&state.draft===d){sharePdfCache.set(d,result);d.pdfPrepared=true;toast('PDFを作成しました。')}}catch(error){console.error('PDF作成エラー',error.message);failure='PDFを作成できませんでした。写真の枚数や通信を確認して再度お試しください。'}
    finally{attachmentPrintBusy=false;controls.forEach(({element,disabled})=>element.disabled=disabled);if(version===state.sheetVersion&&state.draft===d){renderDraft();if(failure)showError(failure)}}
  };
  $('acknowledgeSlack').onchange=()=>{
    const checked=$('acknowledgeSlack').checked;
    if(!saved||(!d.pdfPrepared&&!shared))return;
    // Acknowledgement is persisted separately from final confirmation.
    $('acknowledgeSlack').checked=Boolean(d.slackShared);
    return run(()=>updateOrder(setSlackShared(d,checked)));
  };
  $('confirmSharedOrder').onclick=()=>{if(ready)return run(()=>updateOrder(confirmSharedOrder(d)))};
  if($('cancelReservedOrder'))$('cancelReservedOrder').onclick=()=>deleteOrderWithConfirmation(state.orders.find(order=>order.localId===d.localId),{fromDetail:true});
}

function attachmentPickerHtml(order,saved){
  const photos=attachmentStore.list(order.localId),locked=!saved||order.slackShared||Boolean(attachmentOperation)||attachmentPrintBusy;
  return `<div class="attachmentPicker"><h4>別紙・写真を添付（任意）</h4><p>ホテル送りの記入用紙などを追加できます。共有用PDFでは、注文書の後に写真を1枚ずつ載せます。</p><div class="attachmentButtons"><button id="choosePhotos" type="button" class="secondary" ${locked||photos.length>=MAX_PHOTOS?'disabled':''}>写真フォルダから選ぶ</button><button id="takePhoto" type="button" class="secondary" ${locked||photos.length>=MAX_PHOTOS?'disabled':''}>カメラで撮影</button></div><input id="photoFiles" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden><input id="cameraPhoto" type="file" accept="image/*" capture="environment" hidden><p class="attachmentPrivacy">最大${MAX_PHOTOS}枚・1枚20MBまで。写真はこの端末で一時保持します。再読み込み・ログアウト・新しい注文で消えるので、先にPDF保存・共有してください。写真は他の端末には同期されません。</p>${order.slackShared?'<p>写真を変更する場合は、下の送信確認チェックを外してください。</p>':''}<div class="attachmentList">${photos.map((photo,index)=>`<div class="attachmentItem"><details><summary><img src="${esc(photo.url)}" alt="添付写真 ${index+1}"><span>写真${index+1}を大きく確認</span></summary><img class="attachmentLarge" src="${esc(photo.url)}" alt="${esc(photo.name)}"></details><button type="button" class="secondary" data-remove-photo="${esc(photo.id)}" ${locked?'disabled':''}>写真${index+1}を削除</button></div>`).join('')}</div><p id="attachmentStatus" role="status">${photos.length}枚添付済み</p></div>`;
}
function bindAttachmentPicker(order,saved){
  $('choosePhotos').onclick=()=>$('photoFiles').click();$('takePhoto').onclick=()=>$('cameraPhoto').click();
  for(const id of ['photoFiles','cameraPhoto'])$(id).onchange=async event=>{
    const files=[...event.target.files];event.target.value='';
    if(!files.length||!saved||order.slackShared||attachmentOperation||attachmentPrintBusy||state.draft!==order)return;
    const operation={id:order.localId,generation:attachmentStore.generation},version=state.sheetVersion;attachmentOperation=operation;
    const controls=[...$('sheet').querySelectorAll('button,input,select')].map(element=>({element,disabled:element.disabled}));controls.forEach(({element})=>element.disabled=true);
    $('attachmentStatus').textContent='写真を読み込んでいます…';const errors=[];let added=0;
    try{
      for(const file of files){
        if(attachmentStore.generation!==operation.generation)break;
        if(attachmentStore.list(order.localId).length>=MAX_PHOTOS){errors.push(`最大${MAX_PHOTOS}枚までです。残りは追加していません。`);break}
        try{if(attachmentStore.add(order.localId,await preparePhoto(file),operation.generation))added++}catch(error){errors.push(`${file.name}: ${error.message}`)}
      }
    }finally{
      if(attachmentOperation===operation)attachmentOperation=null;
      controls.forEach(({element,disabled})=>element.disabled=disabled);
      if(added)order.pdfPrepared=false;
      if(version===state.sheetVersion&&state.draft===order){renderDraft();$('attachmentStatus').textContent=`${attachmentStore.list(order.localId).length}枚添付済み。${errors.join(' ')||'写真を開いて文字が読めるか確認してください。'}`}
    }
  };
  $('sheetBody').querySelectorAll('[data-remove-photo]').forEach(button=>button.onclick=()=>{
    if(state.draft!==order||order.slackShared||attachmentOperation||attachmentPrintBusy)return;
    attachmentStore.remove(order.localId,button.dataset.removePhoto);order.pdfPrepared=false;renderDraft();
  });
}
function attachmentPagesHtml(order){
  return attachmentStore.list(order.localId).map((photo,index)=>`<section class="shareAttachmentPage"><div class="receiptCopyLabel">会社控え・添付資料 ${index+1}</div><p>注文番号 ${esc(receiptOrderNumber(order))}${pickupNumberLabel(order)?` ／ お渡し番号 ${esc(pickupNumberLabel(order))}`:''}</p><img src="${esc(photo.url)}" alt="添付資料 ${index+1}"></section>`).join('');
}

function renderSuccess(d){
  $('stepLabel').textContent='確定済み';$('sheetTitle').textContent='注文を確定しました';
  $('sheetBody').innerHTML=`<div class="success"><div class="successMark">✓</div><h3>保存・同期が完了しました</h3><p>画面を閉じても、印刷しても注文は残ります。別の端末からも確認できます。</p><div class="summary"><div class="summaryRow"><span>店舗</span><b>${esc(d.store)}</b></div><div class="summaryRow"><span>区分</span><b>${esc(labelOrder(d))}</b></div>${d.receiptNo?`<div class="summaryRow"><span>受付番号</span><b>${esc(d.receiptNo)}</b></div>`:''}<div class="summaryRow"><span>合計</span><b>${yen(totalOf(d))}</b></div></div></div><div class="stickyActions"><button id="successPrint" class="secondary">PDF・印刷</button><button id="continueOrder" class="primary">次の注文を作る</button></div><div class="underActions"><button id="backDash" class="secondary">注文一覧へ戻る</button></div>`;
  $('sheetBody').querySelector('.success h3').textContent='注文確定・同期が完了しました';
  $('sheetBody').querySelector('.success').insertAdjacentHTML('afterbegin',pickupNumberHtml(d));
  $('sheetBody').querySelector('.summary').insertAdjacentHTML('afterbegin',`<div class="summaryRow"><span>注文の状態</span><b>${ORDER_STATUS[groupOf(d)]}</b></div>`);
  $('backDash').insertAdjacentHTML('beforebegin','<button id="successCustomerCopy" class="secondary customerCopyAction">お客様控え（QR・画像）</button>');
  $('successCustomerCopy').onclick=()=>showCustomerReceipt(d);
  $('backDash').onclick=()=>{state.draft=null;closeSheet();revealOrder(d)};$('successPrint').onclick=()=>printOrder(d);$('continueOrder').onclick=()=>{state.draft=null;closeSheet();startOrder()};
}

function showDetail(id){
  const order=state.orders.find(item=>item.localId===id);if(!order)return;if(isUnconfirmed(order))return resumeFinalization(order);openSheet('注文詳細','保存済み');
  const rows=[['店舗',order.store],['区分',labelOrder(order)],['電話',order.phone],['お客様',order.customer],['卸屋・帳合先',order.account],['担当',order.staff],['受付番号',order.receiptNo],['受け渡し',handoffLabel(order)],['会計方法',order.type===ORDER_TYPE.SPOT?paymentMethodLabel(order):''],['ホテル',order.hotelName],['宿泊者',order.guestName],['部屋番号',order.roomNo],['チェックアウト',order.checkoutDate],['配送先',order.shipAddress],['作成日時',formatDateTime(order.createdAt)],['最終更新',formatDateTime(order.updatedAt)],['備考',order.notes]];
  $('sheetBody').innerHTML=`<div class="step"><div class="section">${rows.filter(([,value])=>value).map(([label,value])=>`<div class="summaryRow"><span>${esc(label)}</span><b class="multiline">${esc(value)}</b></div>`).join('')}</div><div class="section"><div class="sectionTitle">商品</div>${order.items.map(item=>`<div class="summaryRow"><span>${esc(item.code)} ${esc(item.name)} × ${esc(item.qty)}</span><b>${yen(item.price*item.qty)}</b></div>`).join('')}<div class="summaryRow total"><span>合計</span><b>${yen(totalOf(order))}</b></div></div><button id="editOrderBtn" class="primary fullButton">注文を修正</button><div class="two"><button id="customerCopyBtn" class="secondary">お客様控え</button><button id="printBtn" class="secondary">注文書を印刷</button></div><button id="deleteBtn" class="linkBtn hideOrderButton">この注文を一覧から非表示</button></div><div class="stickyActions one"><button id="detailClose" class="secondary">閉じる</button></div>`;
  $('sheetBody').querySelector('.step').insertAdjacentHTML('afterbegin',`<div class="orderStatusEditor"><div class="field"><label for="orderStatus">注文の状態</label><select id="orderStatus">${Object.entries(ORDER_STATUS).map(([key,label])=>`<option value="${key}" ${groupOf(order)===key?'selected':''}>${label}</option>`).join('')}</select></div><button id="saveStatus" class="secondary" disabled>変更</button></div>`);
  $('sheetBody').querySelector('.step').insertAdjacentHTML('afterbegin',pickupNumberHtml(order));
  $('sheetBody').querySelector('.orderStatusEditor').insertAdjacentHTML('afterend',slackSharedField(order,'detailSlackShared'));
  if(isPickupOrder(order)){
    $('orderStatus').querySelector('[value="done"]').disabled=!order.delivered;
    const paid=isPickupPaymentRecorded(order);
    $('sheetBody').querySelector('.orderStatusEditor').insertAdjacentHTML('afterend',`<div class="pickupHandoverPanel">${paid?`<b class="pickupPaidStatus">✓ 会計済（${esc(paymentMethodLabel(order))}）</b>${order.paidAt?`<small>会計日時：${esc(formatDateTime(order.paidAt))}</small>`:''}`:!order.delivered?'<p>会計を済ませてから、実際の会計方法を記録してください。</p><button id="recordPaymentBtn" class="secondary paymentButton">会計済</button>':''}${order.delivered?`<b>お渡し済み</b>${order.deliveredAt?`<small>お渡し日時：${esc(formatDateTime(order.deliveredAt))}</small>`:''}`:`<p>${paid?'商品のお渡し後に押してください。':'先に「会計済」を記録すると、お渡し済みにできます。'}</p><button id="handOverBtn" class="primary handoverButton" ${!paid?'disabled':''}>お渡し済み</button>`}</div>`);
  }
  const version=state.sheetVersion;
  const changeDetailOrder=async(next,message)=>{
    const controls=[...$('sheetBody').querySelectorAll('button,input,select')].map(element=>({element,disabled:element.disabled}));
    controls.forEach(({element})=>element.disabled=true);
    try{
      const updated=await updateOrder(next);
      if(version!==state.sheetVersion)return;
      if(state.draft?.localId===order.localId)state.draft=null;
      revealOrder(updated);showDetail(updated.localId);toast(message);
    }catch(error){
      if(version!==state.sheetVersion)return;
      controls.forEach(({element,disabled})=>element.disabled=disabled);
      if($('detailSlackShared'))$('detailSlackShared').checked=Boolean(order.slackShared);
      showError(error.message==='SYNC_CONFLICT'?'別の端末で更新されています。一覧から開き直してください。':'変更できませんでした。接続を確認して、もう一度お試しください。');
    }
  };
  $('orderStatus').onchange=()=>{$('saveStatus').disabled=$('orderStatus').value===groupOf(order)};
  $('saveStatus').onclick=()=>{
    const status=$('orderStatus').value;if(!Object.hasOwn(ORDER_STATUS,status))return;
    if(isPickupOrder(order)&&!order.delivered&&status==='done')return showError('お渡しが終わってから「お渡し済み」を押してください。');
    const next={...order,workflowStatus:status};if(isPickupOrder(order)&&status!=='done'){next.delivered=false;next.deliveredAt=''}
    return changeDetailOrder(next,isPickupOrder(order)&&order.delivered&&status!=='done'?'お渡し済みを取り消して状態を戻しました':`${ORDER_STATUS[status]}に変更しました`);
  };
  if($('recordPaymentBtn'))$('recordPaymentBtn').onclick=()=>showPickupPayment(order,{fromDetail:true});
  if($('handOverBtn'))$('handOverBtn').onclick=()=>{
    if(!isPickupPaymentRecorded(order))return showError('先に「会計済」で会計方法を記録してください。');
    return changeDetailOrder(markPickupDelivered(order),'お渡し済みとして完了しました');
  };
  if($('detailSlackSharedResume'))$('detailSlackSharedResume').onclick=()=>resumeFinalization(order);
  $('customerCopyBtn').textContent='お客様控え（QR・画像）';
  $('customerCopyBtn').classList.add('customerCopyAction');$('customerCopyBtn').parentElement.className='detailReceiptActions';
  $('detailClose').onclick=closeSheet;$('editOrderBtn').onclick=()=>startEditOrder(order);$('customerCopyBtn').onclick=()=>showCustomerReceipt(order);$('printBtn').onclick=()=>printOrder(order);
  $('deleteBtn').textContent='この注文を削除（キャンセル）';
  $('deleteBtn').onclick=()=>deleteOrderWithConfirmation(order,{fromDetail:true});
}
function printOrder(order,{inputOnly=false}={}){
  return printOrders([order],'展示会 注文書',false,{inputOnly,includeAttachments:true});
}
function printCustomerCopy(order){printOrders([order],'お客様控え',false,{customerCopy:true})}

async function customerReceiptPng(html){
  if(!window.html2canvas)throw new Error('IMAGE_LIBRARY_UNAVAILABLE');
  await document.fonts?.ready;
  const stage=document.createElement('div');stage.className='receiptCaptureStage';stage.setAttribute('aria-hidden','true');
  stage.innerHTML=`<article class="receiptSheet captureMode">${html}</article>`;document.body.appendChild(stage);
  try{
    await Promise.all([...stage.querySelectorAll('img')].map(img=>img.decode()));
    const card=stage.firstElementChild,area=Math.max(1,card.scrollWidth*card.scrollHeight),scale=Math.min(2,Math.sqrt(4000000/area),8192/card.scrollHeight);
    const canvas=await window.html2canvas(card,{backgroundColor:'#ffffff',scale,useCORS:true,logging:false,windowWidth:960});
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob||blob.size>RECEIPT_MAX_BYTES)throw new Error('IMAGE_TOO_LARGE');
    return blob;
  }finally{stage.remove()}
}

async function showCustomerReceipt(order){
  openSheet('お客様控え','QR・画像');
  const view=state.sheetVersion;
  $('sheetBody').innerHTML='<div class="step"><div class="receiptImagePreparing">控え画像とQRコードを準備しています…</div></div>';
  const isCurrent=()=>view===state.sheetVersion&&Boolean(state.session);
  try{
    await loadOrders();
    const current=state.orders.find(item=>item.localId===order.localId);if(!current)throw new Error('ORDER_NOT_AVAILABLE');
    const html=receiptDocumentHtml(current,{customerCopy:true}),path=await receiptImagePath(current.localId,html),blob=await customerReceiptPng(html);
    if(!isCurrent())return;
    await ensureFreshSession();
    const storageBase=`${sbBase()}/storage/v1`;
    try{await fetchJson(`${storageBase}/object/${RECEIPT_BUCKET}/${path}`,{method:'POST',headers:{...sbHeaders(),'Content-Type':'image/png','Cache-Control':'max-age=0','x-upsert':'false'},body:blob})}
    catch(error){if(error.status!==409&&Number(error.storageCode)!==409)throw error}
    if(!isCurrent())return;
    const signed=await fetchJson(`${storageBase}/object/sign/${RECEIPT_BUCKET}/${path}`,{method:'POST',headers:sbHeaders(),body:JSON.stringify({expiresIn:RECEIPT_LINK_SECONDS})});
    if(!isCurrent())return;
    const url=signedReceiptUrl(sbBase(),signed.signedURL),expires=new Date(Date.now()+RECEIPT_LINK_SECONDS*1000);
    state.receiptBlobUrl=URL.createObjectURL(blob);
    $('sheetBody').innerHTML=`<div class="step"><div class="qrReceipt">${pickupNumberHtml(current)}<div class="qrOrderNo">注文番号 ${esc(receiptOrderNumber(current))}</div><p>お客様のスマートフォンでQRを読み取ると、控え画像が開きます。<br><b>画像を長押しして保存できます。</b></p><div id="customerQrCode"></div><p class="receiptExpiry">リンク有効期限：${esc(formatDateTime(expires))}<br>このQR・リンクを知っている方が控えを閲覧できます。対象のお客様にだけお渡しください。</p><a id="openReceiptImage" class="secondary fullButton receiptLink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">お客様が開く画像を確認</a><div class="two"><a id="downloadReceiptImage" class="secondary receiptLink" href="${esc(state.receiptBlobUrl)}" download="customer-copy-${esc(current.localId.slice(0,8))}.png">画像を保存</a><button id="printCustomerReceipt" class="secondary">控えを印刷</button></div><details><summary>控え画像のプレビュー</summary><img class="sharedReceiptPreview" src="${esc(state.receiptBlobUrl)}" alt="お客様控えの画像"></details></div></div><div class="stickyActions one"><button id="qrClose" class="primary">閉じる</button></div>`;
    new window.QRCode($('customerQrCode'),{text:url,width:280,height:280,correctLevel:window.QRCode.CorrectLevel.M});
    $('printCustomerReceipt').onclick=()=>printCustomerCopy(current);$('qrClose').onclick=()=>showDetail(current.localId);
  }catch(error){
    if(!isCurrent())return;
    $('sheetBody').innerHTML='<div class="step"><div class="receiptError">控え画像を準備できませんでした。注文データは保存されています。接続を確認して再試行してください。</div><button id="retryCustomerReceipt" class="primary fullButton">もう一度準備する</button><button id="receiptBack" class="secondary fullButton">注文詳細へ戻る</button></div>';
    $('retryCustomerReceipt').onclick=()=>showCustomerReceipt(order);$('receiptBack').onclick=()=>showDetail(order.localId);
  }
}
function receiptOrderNumber(order){return order.receiptNo||order.orderNo||order.localId||'登録前'}
function receiptDocumentHtml(order,{customerCopy=false}={}){
  if(customerCopy&&order.customerRegion==='overseas')return englishCustomerReceiptHtml(order);
  const orderNumber=receiptOrderNumber(order);
  const itemCount=itemCountOf(order);
  const customerName=customerCopy?customerNameWithHonorific(order.customer):order.customer||'-';
  const internalInfo=receiptInternalInfo(order,{customerCopy});
  const info=[['店舗名',order.store],['電話番号',order.phone],['お客様名',customerName],['注文区分',labelOrder(order)]];if(!customerCopy)info.push(['卸屋・帳合先',order.account||'-'],['担当',order.staff||state.staff?.display_name||'-']);if(internalInfo.showHandoff)info.push(['受け渡し',handoffLabel(order)]);
  if(isPickupOrder(order))info.push(['会計',isPickupPaymentRecorded(order)?`会計済（${paymentMethodLabel(order)}）`:order.paid?'会計済':order.paymentMethod===PAYMENT.ON_PICKUP?'受け取り時会計':`未会計（${paymentMethodLabel(order)}予定）`]);
  const createdAtHtml=internalInfo.showCreatedAt?`<br><b>作成日時</b> ${new Date(order.createdAt||Date.now()).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}`:'';
  const pickupHtml=pickupNumberLabel(order)?`<div class="receiptPickupNumber"><span>お渡し番号</span><strong>${esc(pickupNumberLabel(order))}</strong><small>お受け取り時に、この番号をご提示ください。</small></div>`:'';
  const infoHtml=info.map(([label,value])=>`<div class="receiptInfoCard"><div class="receiptInfoLabel">${esc(label)}</div><div class="receiptInfoValue">${esc(value||'-')}</div></div>`).join('');
  const itemsHtml=(order.items||[]).map(item=>`<tr><td><b>${esc(item.code)}</b></td><td>${esc(item.name)}</td><td class="num">${esc(item.qty)}</td><td class="num">${yen(item.price)}</td><td class="num"><b>${yen(item.price*item.qty)}</b></td></tr>`).join('');
  const notesHtml=`${!customerCopy&&order.notes?`<div class="receiptNote"><b>備考</b>${esc(order.notes).replace(/\n/g,'<br>')}</div>`:''}${internalInfo.showGuide?'<div class="receiptNote"><b>ご案内</b>内容を確認し、必要に応じて印刷またはPDF保存してください。</div>':''}${internalInfo.headOfficeShare?`<div class="receiptNote"><b>本社共有</b>${esc(internalInfo.headOfficeShare)}</div>`:''}`;
  return `${customerCopy?'':'<div class="receiptCopyLabel">会社控え</div>'}<div class="receiptHeaderSimple"><div class="receiptBrandBlock"><img class="receiptBrandLogo" src="assets/sun_nishimura_logo.jpg" alt="株式会社サンニシムラ"><div><div class="receiptBrandName">株式会社サンニシムラ</div><div class="receiptBrandSub">SAN NISHIMURA CO., LTD.</div></div></div><div class="receiptDocMeta"><div class="receiptDocTitle">${customerCopy?'お客様控え':'展示会 注文書'}</div><div class="receiptDocSub">Exhibition Order Receipt</div><div class="receiptMetaLine"><b>注文番号</b> ${esc(orderNumber)}${createdAtHtml}</div></div></div><div class="receiptInfoBand">${infoHtml}</div>${pickupHtml}<div class="receiptSection"><div class="receiptSectionHead"><div class="receiptSectionTitle">注文明細</div><div class="receiptSectionHint">${itemCount}点</div></div><table class="receiptTable"><colgroup><col class="code"><col><col class="qty"><col class="unit"><col class="subtotal"></colgroup><thead><tr><th>品番</th><th>商品名</th><th class="num">数量</th><th class="num">単価</th><th class="num">金額</th></tr></thead><tbody>${itemsHtml}</tbody></table></div><div class="receiptFooterGrid"><div class="receiptMemoStack">${notesHtml}</div><div><div class="receiptSummaryBox"><div class="receiptSummaryRow"><span>点数</span><span>${itemCount}</span></div><div class="receiptSummaryRow total"><span>合計</span><span>${yen(totalOf(order))}</span></div></div><div class="receiptCurrencyNote">通貨：JPY</div></div></div><div class="receiptFooterMini"><span>株式会社サンニシムラ ／ ${customerCopy?'お客様控え':'会社控え'}</span><span>注文番号 ${esc(orderNumber)}</span></div>`;
}
function printSheetHtml(order,{customerCopy=false}={}){return `<article class="printSheet printPage receiptSheet">${receiptDocumentHtml(order,{customerCopy})}</article>`}

function englishCustomerReceiptHtml(order){
  const orderNumber=receiptOrderNumber(order),count=itemCountOf(order),pickup=pickupNumberLabel(order);
  const orderType=order.type===ORDER_TYPE.NORMAL?'Wholesale order':({now:'Immediate purchase',later:'Pickup at the venue',hotel:'Hotel delivery',ship:'Delivery to specified address'}[order.handoff]||'On-site purchase');
  const info=[['Store',order.store],['Phone',order.phone],['Customer',order.customer],['Order type',orderType]];
  if(isPickupOrder(order)){
    const method={credit:'Credit card',cash:'Cash',on_pickup:'Payment on pickup'}[order.paymentMethod]||'Not specified';
    info.push(['Payment',isPickupPaymentRecorded(order)?`Paid (${method})`:order.paid?'Paid':order.paymentMethod===PAYMENT.ON_PICKUP?'Payment on pickup':`Unpaid (${method})`]);
  }
  const infoHtml=info.map(([label,value])=>`<div class="receiptInfoCard"><div class="receiptInfoLabel">${esc(label)}</div><div class="receiptInfoValue">${esc(value||'-')}</div></div>`).join('');
  const itemsHtml=(order.items||[]).map(item=>`<tr><td><b>${esc(isShippingItem(item)?'-':item.code)}</b></td><td>${esc(isShippingItem(item)?'Shipping (flat rate)':item.name)}</td><td class="num">${esc(item.qty)}</td><td class="num">${yen(item.price)}</td><td class="num"><b>${yen(item.price*item.qty)}</b></td></tr>`).join('');
  return `<div lang="en"><div class="receiptHeaderSimple"><div class="receiptBrandBlock"><img class="receiptBrandLogo" src="assets/sun_nishimura_logo.jpg" alt="SAN NISHIMURA CO., LTD."><div><div class="receiptBrandName">SAN NISHIMURA CO., LTD.</div></div></div><div class="receiptDocMeta"><div class="receiptDocTitle">Customer Copy</div><div class="receiptDocSub">Exhibition Order Receipt</div><div class="receiptMetaLine"><b>Order No.</b> ${esc(orderNumber)}</div></div></div>${pickup?`<div class="pickupNumber"><span>Pickup No.</span><strong>${esc(pickup)}</strong></div>`:''}<div class="receiptInfoBand">${infoHtml}</div><div class="receiptSection"><div class="receiptSectionHead"><div class="receiptSectionTitle">Order Details</div><div class="receiptSectionHint">${count} ${count===1?'item':'items'}</div></div><table class="receiptTable"><colgroup><col class="code"><col><col class="qty"><col class="unit"><col class="subtotal"></colgroup><thead><tr><th>Item No.</th><th>Product</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Amount</th></tr></thead><tbody>${itemsHtml}</tbody></table></div><div class="receiptFooterGrid"><div class="receiptMemoStack"></div><div><div class="receiptSummaryBox"><div class="receiptSummaryRow"><span>Items</span><span>${count}</span></div><div class="receiptSummaryRow total"><span>Total</span><span>${yen(totalOf(order))}</span></div></div><div class="receiptCurrencyNote">Currency: JPY</div></div></div><div class="receiptFooterMini"><span>SAN NISHIMURA CO., LTD.</span><span>Order No. ${esc(orderNumber)}</span></div></div>`;
}

function printOrders(orders,title,withCover=true,{targetLabel='全期間',customerCopy=false,inputOnly=false,includeAttachments=false}={}){
  if(attachmentOperation){toast('写真の読み込みが終わるまでお待ちください。');return false}
  const list=orders.filter(order=>!order.deleted&&(!withCover||!isUnconfirmed(order))).sort(compareOrdersForPrint);
  if(!list.length)return toast('印刷する注文がありません');
  if(list.some(order=>isPickupOrder(order)&&!pickupNumberLabel(order)))return toast('お渡し番号が未発行です。「お渡し番号を発行する」を先に押してください。');
  const totalQty=list.reduce((sum,order)=>sum+itemCountOf(order),0),grandTotal=list.reduce((sum,order)=>sum+totalOf(order),0);
  const cover=withCover?`<section class="printBatchCover"><div class="eyebrow">${esc(cfg.eventName||'展示会')}</div><h1>${esc(title)}</h1><p><b>対象受付日 ${esc(targetLabel)}</b><br>出力日時 ${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'medium'}).format(new Date())}</p><div class="printStats"><div><small>注文数</small><b>${list.length}件</b></div><div><small>商品点数</small><b>${totalQty}点</b></div><div><small>合計</small><b>${yen(grandTotal)}</b></div></div><table class="batchTable"><thead><tr><th>No.</th><th>受付日時</th><th>区分</th><th>卸屋・帳合先</th><th>店舗・お客様</th><th>合計</th></tr></thead><tbody>${list.map((order,index)=>`<tr><td>${index+1}</td><td>${esc(formatDateTime(order.createdAt||order.created_at,true))}</td><td>${esc(labelOrder(order))}</td><td>${esc(order.account||'-')}</td><td>${pickupNumberLabel(order)?`<b>${esc(pickupNumberLabel(order))}</b><br>`:''}${esc(order.store)}${order.customer?` / ${esc(order.customer)}`:''}</td><td>${yen(totalOf(order))}</td></tr>`).join('')}</tbody></table></section>`:'';
  const englishCopy=customerCopy&&list.every(order=>order.customerRegion==='overseas');
  const printedAt=new Intl.DateTimeFormat(englishCopy?'en-GB':'ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date());
  const photosIncluded=includeAttachments&&!customerCopy&&!withCover&&list.some(order=>attachmentStore.list(order.localId).length);
  $('printArea').innerHTML=`${cover}${list.map(order=>printSheetHtml(order,{customerCopy})+(photosIncluded?attachmentPagesHtml(order):'')).join('')}<div class="printFoot">${englishCopy?'Printed (JST)':'出力日時'} ${esc(printedAt)}</div>`;
  const generation=++printGeneration,version=state.sheetVersion;
  const finish=()=>{
    if(generation!==printGeneration||version!==state.sheetVersion)return false;
    if(!printOriginalTitle)printOriginalTitle=document.title;document.title=printFileBase(list,{customerCopy});
    window.print();
    toast(inputOnly?'PDFをSlackへ送った後、共有済みにチェックしてください。':'注文データは保存したままです');return true;
  };
  if(!photosIncluded)return finish();
  return preparePrintImages().then(finish).catch(()=>{if(generation===printGeneration){$('printArea').innerHTML='';toast('写真を印刷用に準備できませんでした。写真を確認して、もう一度お試しください。')}return false});
}
async function preparePrintImages(){
  const images=[...$('printArea').querySelectorAll('.shareAttachmentPage img')];
  let timeout;
  const ready=image=>new Promise((resolve,reject)=>{
    if(image.complete&&image.naturalWidth){resolve();return}
    image.onload=()=>resolve();image.onerror=()=>reject(new Error('PHOTO_PRINT_LOAD'));
  });
  try{
    await Promise.race([Promise.all(images.map(async image=>{
      // Blob URLs can be dropped by Safari/iOS while the print snapshot is taken.
      // Embed a data URL in the print-only DOM so the PDF renderer has stable bytes.
      if((image.currentSrc||image.src).startsWith('blob:')){
        const blob=await fetch(image.currentSrc||image.src).then(response=>{if(!response.ok)throw new Error('PHOTO_PRINT_FETCH');return response.blob()});
        image.src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('PHOTO_PRINT_READ'));reader.readAsDataURL(blob)});
      }
      try{await image.decode()}catch{await ready(image)}
      if(!(image.complete&&image.naturalWidth))await ready(image);
    })),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('PHOTO_PRINT_TIMEOUT')),20000)})]);
  }finally{clearTimeout(timeout)}
}
function showPrintMenu(){
  openSheet('全注文データを印刷','展示会');
  showPrintDateOptions();
}

function showPrintDateOptions(mode='all',start=today(),end=today()){
  const all=state.orders.filter(order=>!order.deleted),list=filterOrdersByCreatedDate(all,{mode,today:today(),start,end}),summary=batchSummary(list);
  const targetLabel=mode==='all'?'全期間':mode==='today'?today():start===end?start:`${start} ～ ${end}`,dateInvalid=mode==='range'&&(!start||!end||start>end);
  $('stepLabel').textContent='展示会の全注文';$('sheetTitle').textContent='全注文データを印刷';
  $('sheetBody').innerHTML=`<div class="step"><div class="dateModeChoices"><button data-date-mode="today" class="${mode==='today'?'on':''}">本日</button><button data-date-mode="range" class="${mode==='range'?'on':''}">日付を指定</button><button data-date-mode="all" class="${mode==='all'?'on':''}">全期間</button></div>${mode==='range'?`<div class="two topGap"><div class="field"><label for="printStart">開始日</label><input id="printStart" type="date" value="${esc(start)}"></div><div class="field"><label for="printEnd">終了日</label><input id="printEnd" type="date" value="${esc(end)}"></div></div>`:''}<div class="section topGap"><div class="summaryRow"><span>対象受付日</span><b>${esc(targetLabel)}</b></div><div class="summaryRow"><span>注文数</span><b>${summary.orders}件</b></div><div class="summaryRow"><span>商品点数</span><b>${summary.items}点</b></div><div class="summaryRow"><span>合計金額</span><b>${yen(summary.total)}</b></div></div>${dateInvalid?'<div class="blockingWarning">開始日と終了日を正しく指定してください。</div>':''}<div class="hintBox">印刷・PDF保存後も注文は残ります。</div></div><div class="stickyActions"><button id="printDateBack" class="secondary">戻る</button><button id="executeBatchPrint" class="primary" ${dateInvalid||!summary.orders?'disabled':''}>PDF・印刷</button></div>`;
  document.querySelectorAll('[data-date-mode]').forEach(button=>button.onclick=()=>showPrintDateOptions(button.dataset.dateMode,start,end));
  if($('printStart'))$('printStart').onchange=()=>showPrintDateOptions('range',$('printStart').value,$('printEnd').value);
  if($('printEnd'))$('printEnd').onchange=()=>showPrintDateOptions('range',$('printStart').value,$('printEnd').value);
  $('printDateBack').textContent='閉じる';$('printDateBack').onclick=closeSheet;$('executeBatchPrint').onclick=()=>printOrders(list,'展示会 全注文データ',true,{targetLabel});
}

async function bootOnline(){
  const saved=storedSession();bindConnectivitySignals();
  if(!saved?.access_token){showLogin();return}
  state.session=saved;
  try{saveSession(saved);await ensureFreshSession();await loadStaff();await Promise.all([loadPrivateReferenceData(),loadOrders()]);state.online=true;showApp()}
  catch(error){
    state.online=false;
    if(error.status===400||error.status===401||error.message==='SESSION_EXPIRED'){clearStoredSession();state.session=null}
    showLogin();$('loginMsg').textContent='接続またはログイン情報を確認できません。再接続後に更新するか、ログインしてください。';
  }
}
function showLogin(){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden');$('loginNetworkGuide').classList.toggle('hidden',navigator.onLine);$('loginBtn').disabled=!navigator.onLine}
function showApp(){$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('eventName').textContent=cfg.eventName||'EXHIBITION';$('logoutBtn').classList.remove('hidden');markSynced();render();updateNewOrderButton();if(!state.syncTimer)state.syncTimer=setInterval(()=>{if(document.visibilityState==='visible')syncOrders().catch(()=>{})},12000)}
function bindConnectivitySignals(){
  if(state.signalsBound)return;state.signalsBound=true;
  window.addEventListener('online',()=>{if(state.online)syncOrders().catch(()=>{});else if(storedSession())bootOnline();else showLogin()});
  window.addEventListener('offline',()=>{if(state.online)setSync('error','オフライン・保存は接続後に行ってください');else showLogin()});
  window.addEventListener('focus',()=>syncOrders().catch(()=>{}));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncOrders().catch(()=>{})});
  window.addEventListener('storage',event=>{if(event.key===PERSISTENT_SESSION_KEY){if(!event.newValue)clearLocalApp();else state.session=storedSession()}});
  window.addEventListener('beforeunload',event=>{state.rememberDraftInput?.();if(attachmentStore.hasPhotos()||(state.draft&&state.draft.stage!=='success'&&(state.draft.items?.length||state.draft.store))){event.preventDefault();event.returnValue=''}});
}
async function refreshPrivateData(){
  if(!state.online||!navigator.onLine)return toast('オンライン接続が必要です');
  $('refreshBtn').disabled=true;setSync('busy','注文と商品を同期中…');
  try{await Promise.all([loadPrivateReferenceData(),syncOrders()]);markSynced();toast('最新の注文と商品に更新しました')}
  catch(error){setSync('error','同期できません。接続を確認してください');toast('更新できませんでした')}
  finally{$('refreshBtn').disabled=false}
}
async function login(){
  const email=$('loginEmail').value.trim(),password=$('loginPassword').value;
  if(!navigator.onLine)return $('loginMsg').textContent='接続してからログインしてください。';
  if(!email||!password)return $('loginMsg').textContent='メールとパスワードを入力してください。';
  $('loginMsg').textContent='';$('loginBtn').disabled=true;
  try{await signIn(email,password);await loadStaff();await Promise.all([loadPrivateReferenceData(),loadOrders()]);state.online=true;showApp();bindConnectivitySignals()}
  catch(error){clearStoredSession();state.session=null;state.online=false;$('loginMsg').textContent='ログインできませんでした。アカウントまたは通信を確認してください。'}
  finally{$('loginPassword').value='';$('loginBtn').disabled=!navigator.onLine}
}
function clearLocalApp(){
  attachmentStore.clear();attachmentOperation=null;attachmentPrintBusy=false;printGeneration++;
  state.dataEpoch++;
  for(const order of state.orders)wipeOrderData(order);state.orders=[];
  if(state.draft)wipeOrderData(state.draft);state.draft=null;state.rememberDraftInput=null;state.products=[];state.accounts=[];
  clearStoredSession();state.session=null;state.staff=null;state.online=false;clearInterval(state.syncTimer);state.syncTimer=null;
  $('loginPassword').value='';closeSheet();$('sheetBody').innerHTML='';$('orders').innerHTML='';$('printArea').innerHTML='';showLogin();
}
async function logout(){
  if(state.draft&&state.draft.stage!=='success'&&!confirm('未保存の入力内容は失われます。ログアウトしますか？'))return;
  try{if(state.session?.access_token)await fetchJson(`${sbBase()}/auth/v1/logout?scope=local`,{method:'POST',headers:sbHeaders()})}catch{}
  clearLocalApp();
}
$('loginBtn').onclick=login;$('loginPassword').onkeydown=event=>{if(event.key==='Enter')login()};
window.addEventListener('afterprint',()=>{$('printArea').innerHTML='';if(printOriginalTitle){document.title=printOriginalTitle;printOriginalTitle=''}});
$('logoutBtn').onclick=logout;$('refreshBtn').onclick=refreshPrivateData;$('newOrderBtn').onclick=startOrder;$('discardDraftBtn').onclick=showDiscardDraftConfirm;$('closeSheet').onclick=closeSheet;$('sheet').onclick=event=>{if(event.target===$('sheet'))closeSheet()};$('printMenuBtn').onclick=showPrintMenu;$('orderSearch').oninput=render;

purgeLegacyLocalData();if(location.hash.startsWith('#receipt='))history.replaceState(null,'',`${location.pathname}${location.search}`);await bootOnline();
