import {ORDER_TYPE,HANDOFF,PAYMENT,PREP,ORDER_STATUS,groupOf,needsReceipt,totalOf,itemCountOf,phoneHasUnexpectedCharacters,createdDateInTokyo,filterOrdersByCreatedDate,orderMatchesSearch,batchSummary,customerNameWithHonorific,receiptInternalInfo,validate,labelOrder,compareOrdersForPrint,handoffLabel,normalizeForSave,orderPayloadForCloud,orderFromCloudRow} from './workflow.js?v=20260903-qr1';
import {PERSISTENT_SESSION_KEY,SESSION_STORAGE_KEY,LEGACY_LOCAL_STORAGE_KEYS,wipeOrderData} from './security.js?v=20260903-qr1';
import {RECEIPT_BUCKET,RECEIPT_LINK_SECONDS,RECEIPT_MAX_BYTES,receiptImagePath,signedReceiptUrl} from './receipt-share.js?v=20260903-qr1';

const cfg=window.EXHIBITION_CONFIG||{};
const $=id=>document.getElementById(id);
const LS_STAFF='exhibitionOps.staff.v2',LS_KEYPAD_ALIGN='exhibitionOps.keypadAlign.v1';
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
    rows=await fetchJson(`${sbBase()}/rest/v1/exhibition_app_orders?select=id,payload,created_at,updated_at&id=eq.${encodeURIComponent(id)}&deleted_at=is.null`,{headers:sbHeaders()});
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
    const page=await fetchJson(`${sbBase()}/rest/v1/exhibition_app_orders?select=id,payload,created_at,updated_at&event_name=eq.${encodeURIComponent(cfg.eventName||'展示会')}&deleted_at=is.null&order=created_at.desc,id.desc&limit=${pageSize}&offset=${offset}`,{headers:sbHeaders()});
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
  const all=state.orders.filter(order=>!order.deleted);
  $('orderCount').textContent=`${all.length}件`;
  $('todayOrderCount').textContent=`${all.filter(order=>createdDateInTokyo(order)===today()).length}件`;
  $('searchSummary').textContent=currentSearch()?`すべての状態から検索：${filteredOrders().length}件`:`${ORDER_STATUS[state.tab]}の注文を、新しい順に表示しています`;
}
function renderOrders(){
  const list=filteredOrders(),wrap=$('orders');
  if(!list.length){wrap.innerHTML=`<div class="empty">${currentSearch()?'該当する注文はありません。':`${ORDER_STATUS[state.tab]}の注文はありません。`}<br><small>${currentSearch()?'店舗名・電話・品番などで検索できます。':'別のタブを選ぶか、下の「新しい注文」から始めてください。'}</small></div>`;return}
  wrap.innerHTML=list.map(cardHtml).join('');
  wrap.querySelectorAll('[data-detail]').forEach(button=>button.onclick=()=>showDetail(button.dataset.detail));
}
function cardHtml(order){
  return `<article class="orderCard"><div class="orderTop"><div>${order.receiptNo?`<div class="receiptNo">${esc(order.receiptNo)}</div>`:''}<div class="store">${esc(order.store)}</div></div><div class="amount">${yen(totalOf(order))}</div></div><div class="chips"><span class="chip">${esc(labelOrder(order))}</span><span class="chip">${itemCountOf(order)}点</span></div><div class="cardNote">${order.customer?`${esc(order.customer)} ／ `:''}${esc(handoffLabel(order))}</div><div class="cardBottom"><span class="receivedAt">${esc(formatDateTime(order.createdAt,true))}</span><button class="secondary compact" data-detail="${esc(order.localId)}">詳細・印刷</button></div></article>`;
}

function clearReceiptPreview(){if(state.receiptBlobUrl)URL.revokeObjectURL(state.receiptBlobUrl);state.receiptBlobUrl=null;state.sheetVersion++}
function openSheet(title,step=''){clearReceiptPreview();state.rememberDraftInput=null;$('sheetTitle').textContent=title;$('stepLabel').textContent=step;$('sheet').classList.remove('hidden');document.body.style.overflow='hidden';clearError()}
function hasResumableDraft(){return Boolean(state.draft&&state.draft.stage!=='success'&&!state.draft.editingId)}
function updateNewOrderButton(){const resumable=hasResumableDraft();$('newOrderBtn').textContent=resumable?'↩ 入力途中の注文を再開':'＋ 新しい注文';$('discardDraftBtn').classList.toggle('hidden',!resumable)}
function closeSheet(){state.rememberDraftInput?.();state.rememberDraftInput=null;clearReceiptPreview();$('sheet').classList.add('hidden');$('sheet').classList.remove('productFullscreen');document.body.style.overflow='';updateNewOrderButton()}
function showError(msg){$('sheetError').textContent=msg;$('sheetError').classList.remove('hidden');$('sheetPanel')?.scrollTo({top:0,behavior:'smooth'})}
function clearError(){$('sheetError').classList.add('hidden');$('sheetError').textContent=''}
function savedKeypadAlign(){try{return localStorage.getItem(LS_KEYPAD_ALIGN)==='left'?'left':'right'}catch{return'right'}}
function freshDraft(){return{stage:'products',productQuery:'',keypadMode:'number',keypadAlign:savedKeypadAlign(),type:null,handoff:null,customerRegion:'domestic',items:[],store:'',phone:'',customer:'',account:'',accountChoice:'',accountOther:'',staff:state.staff?.display_name||'',paymentMethod:PAYMENT.CREDIT,paid:false,delivered:false,shipped:false,prepared:PREP.NONE,headOfficeShared:false,headOfficeSharedAt:'',pickupDate:dateOffset(1),notes:'',clientSubmissionId:newUuid()}}
function startOrder(){const resume=hasResumableDraft();if(!resume)state.draft=freshDraft();openSheet('新しい注文','1 / 3');renderDraft();if(resume)toast('入力途中の注文を再開しました')}
function showDiscardDraftConfirm(){if(!hasResumableDraft())return startOrder();state.rememberDraftInput?.();const d=state.draft,count=itemCountOf(d),store=String(d.store||'').trim();openSheet('入力途中の注文を破棄','確認');$('sheetBody').innerHTML=`<div class="step"><div class="shareConfirm"><div class="successMark pending">!</div><h3>入力途中の内容を破棄しますか？</h3><p>破棄を確定した場合だけ新しい注文へ切り替わります。</p></div><div class="section"><div class="summaryRow"><span>追加済み商品</span><b>${count}点</b></div>${store?`<div class="summaryRow"><span>入力済み店舗</span><b>${esc(store)}</b></div>`:''}</div></div><div class="stickyActions"><button id="discardCancel" class="secondary">キャンセル</button><button id="discardConfirm" class="dangerBtn">破棄して新規開始</button></div>`;$('discardCancel').onclick=renderDraft;$('discardConfirm').onclick=()=>{state.draft=null;startOrder();toast('入力途中の注文を破棄しました')}}
function startEditOrder(order){if(!(state.draft?.editingId===order.localId&&state.draft.stage!=='success'))state.draft={...order,productQuery:'',keypadMode:'number',keypadAlign:savedKeypadAlign(),items:(order.items||[]).map(item=>({...item,lineId:item.lineId||newUuid()})),stage:'products',editingId:order.localId};openSheet('注文を修正','1 / 3');renderDraft()}
function renderDraft(){state.rememberDraftInput=null;clearError();if(!state.draft)return;const d=state.draft;$('sheet').classList.toggle('productFullscreen',d.stage==='products');if(d.stage==='products')renderProductStep(d);else if(d.stage==='type')renderTypeStep(d);else if(d.stage==='info')renderInfoStep(d);else if(d.stage==='success')renderSuccess(d)}
function renderProductStep(d){const align=d.keypadAlign==='left'?'left':'right';$('stepLabel').textContent=`1 / 3　${d.editingId?'修正':'商品'}`;$('sheetTitle').textContent=d.editingId?'注文を修正':'商品を追加';$('sheetBody').innerHTML=`<div class="step productStep"><div class="productSearch"><div class="productSearchRow"><input id="productQ" type="search" inputmode="search" placeholder="品番・商品名" autocomplete="off"><button id="clearPQ" class="secondary" aria-label="検索をクリア">×</button></div><div id="productKeypadDock" class="productKeypadDock align-${align}"><div class="keypadTitle"><div class="keypadTitleMain"><b>固定入力キー</b><span id="keypadModeLabel" class="keypadModeLabel">数字・記号</span></div><div class="keypadAlignSwitch" aria-label="キーボードの位置"><button id="keypadAlignLeft" type="button" aria-label="キーボードを左寄せにする">◀ 左</button><button id="keypadAlignRight" type="button" aria-label="キーボードを右寄せにする">右 ▶</button></div></div><div id="productKeypad" class="productKeypad numberKeys"></div></div><div id="productResults" class="productResults" role="listbox"></div></div><div class="section productCartSection"><div class="sectionTitle">注文明細 <span id="cartCount">${itemCountOf(d)}点</span></div><div id="cartLines" class="cart"></div></div></div><div class="stickyActions one"><button id="toType" class="primary" ${d.items.length?'':'disabled'}>注文内容へ進む</button></div>`;const q=$('productQ');q.value=d.productQuery||'';q.oninput=()=>renderProductResults(d,q.value);$('clearPQ').onclick=()=>{q.value='';renderProductResults(d,'')};bindProductKeypad(d,q);$('toType').onclick=()=>{if(!d.items.length)return showError('商品を1点以上追加してください。');d.stage='type';renderDraft()};renderCart(d);renderProductResults(d,q.value)}
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
  const wrap=$('cartLines'),count=d.items.reduce((sum,item)=>sum+Number(item.qty||0),0);if($('cartCount'))$('cartCount').textContent=`${count}点`;
  if($('toType'))$('toType').disabled=!d.items.length;if(!d.items.length){wrap.innerHTML='<div class="empty" style="padding:22px">まだ商品がありません。</div>';return}
  wrap.innerHTML=d.items.map(item=>`<div class="cartLine"><div><b>${esc(item.code)} ${esc(item.name)}</b><small>${yen(item.price)} × ${esc(item.qty)}</small></div><div class="qty"><button data-minus="${esc(item.lineId)}" aria-label="数量を減らす">−</button><b>${esc(item.qty)}</b><button data-plus="${esc(item.lineId)}" aria-label="数量を増やす">＋</button></div></div>`).join('')+`<div class="totalRow"><span>合計</span><span>${yen(totalOf(d))}</span></div>`;
  wrap.querySelectorAll('[data-plus]').forEach(button=>button.onclick=()=>{const item=d.items.find(value=>value.lineId===button.dataset.plus);if(item)item.qty++;renderCart(d)});
  wrap.querySelectorAll('[data-minus]').forEach(button=>button.onclick=()=>{const item=d.items.find(value=>value.lineId===button.dataset.minus);if(!item)return;item.qty--;if(item.qty<=0)d.items=d.items.filter(value=>value!==item);renderCart(d)});
}
function renderTypeStep(d){const canContinue=Boolean(d.type&&(d.type!==ORDER_TYPE.SPOT||d.handoff));$('stepLabel').textContent='2 / 3　注文方法';$('sheetTitle').textContent='どの対応ですか？';$('sheetBody').innerHTML=`<div class="step"><p class="stepIntro">実際の対応に一番近いものを選んでください。</p><div class="choiceGrid"><button class="choice ${d.type===ORDER_TYPE.NORMAL?'on':''}" data-type="normal"><b>国内通常注文</b><small>卸屋・電話番号を入力して受注完了。帰社後にまとめて印刷します。</small></button><button class="choice ${d.type===ORDER_TYPE.SPOT?'on':''}" data-type="spot"><b>現売り対応</b><small>会場での会計・受け渡し、後日受取、配送です。</small></button></div>${d.type===ORDER_TYPE.SPOT?`<div class="section topGap"><div class="sectionTitle">商品の渡し方 *</div><div class="choiceGrid handoffChoices"><button class="choice ${d.handoff===HANDOFF.NOW?'on':''}" data-handoff="now"><b>1　在庫あり・その場渡し</b><small>会計して、その場で商品をお渡しします。</small></button><button class="choice ${d.handoff===HANDOFF.LATER?'on':''}" data-handoff="later"><b>2　翌日・翌々日に受取</b><small>お受け取り予定日を入力します。</small></button><button class="choice ${d.handoff===HANDOFF.HOTEL?'on':''}" data-handoff="hotel"><b>3　ホテルへ配送</b><small>お届け先の情報を入力します。</small></button><button class="choice ${d.handoff===HANDOFF.SHIP?'on':''}" data-handoff="ship"><b>4　指定住所へ配送</b><small>お届け先の情報を入力します。</small></button></div></div>`:''}</div><div class="stickyActions"><button id="backProducts" class="secondary">戻る</button><button id="toInfo" class="primary" ${canContinue?'':'disabled'}>入力へ進む</button></div>`;document.querySelectorAll('[data-type]').forEach(button=>button.onclick=()=>{const previous=d.type;d.type=button.dataset.type;if(d.type===ORDER_TYPE.SPOT&&previous!==ORDER_TYPE.SPOT)d.handoff=null;if(d.type===ORDER_TYPE.NORMAL){d.handoff=null;d.headOfficeShared=false}renderDraft()});document.querySelectorAll('[data-handoff]').forEach(button=>button.onclick=()=>{d.handoff=button.dataset.handoff;if(d.handoff===HANDOFF.NOW){d.headOfficeShared=false;d.headOfficeSharedAt=''}renderDraft()});$('backProducts').onclick=()=>{d.stage='products';renderDraft()};$('toInfo').onclick=()=>{if(!d.type)return showError('注文方法を選択してください。');if(d.type===ORDER_TYPE.SPOT&&!d.handoff)return showError('商品の渡し方を選択してください。');d.stage='info';renderDraft()}}
function renderInfoStep(d){
  const normal=d.type===ORDER_TYPE.NORMAL,now=d.handoff===HANDOFF.NOW;
  $('stepLabel').textContent='3 / 3　入力・確認';$('sheetTitle').textContent=d.editingId?'注文を修正':normal?'通常注文を受ける':'現売りを登録';
  const accounts=state.accounts,staffNames=[...new Set([d.staff,state.staff?.display_name].filter(Boolean))];
  const accountChoice=d.accountChoice||(d.account?(accounts.includes(d.account)?d.account:'その他'):''),accountOther=d.accountOther||(accountChoice==='その他'&&d.account!=='その他'?d.account:'');d.accountChoice=accountChoice;d.accountOther=accountOther;
  const accountOptions=accounts.map(value=>`<option value="${esc(value)}" ${accountChoice===value?'selected':''}>${esc(value)}</option>`).join('');
  const staffOptions=staffNames.map(value=>`<option value="${esc(value)}" ${d.staff===value?'selected':''}>${esc(value)}</option>`).join('');
  const normalFields=`<div class="field"><label for="fAccount">卸屋・帳合先 *</label><select id="fAccount"><option value="">選択してください</option>${accountOptions}</select></div>${accountChoice==='その他'?`<div class="field"><label for="fAccountOther">卸屋・帳合先名 *</label><input id="fAccountOther" value="${esc(accountOther)}" placeholder="具体名を入力"></div>`:''}<div class="field"><label for="fStaff">受注担当者 *</label><select id="fStaff"><option value="">選択してください</option>${staffOptions}</select></div><div class="field"><label for="fCustomer">お客様名（任意）</label><input id="fCustomer" value="${esc(d.customer)}"></div>`;
  const pickupFields=d.handoff===HANDOFF.LATER?`<div class="field"><label for="fPickup">受取予定日 *</label><div class="quickDates"><button type="button" data-day="1" class="${d.pickupDate===dateOffset(1)?'on':''}">明日</button><button type="button" data-day="2" class="${d.pickupDate===dateOffset(2)?'on':''}">明後日</button></div><input id="fPickup" type="date" min="${dateOffset(1)}" value="${esc(d.pickupDate)}"></div>`:'';
  const destinationFields=d.handoff===HANDOFF.HOTEL?`<div class="field"><label for="fHotel">ホテル名 *</label><input id="fHotel" value="${esc(d.hotelName||'')}"></div><div class="two"><div class="field"><label for="fGuest">宿泊者名 *</label><input id="fGuest" value="${esc(d.guestName||d.customer||'')}"></div><div class="field"><label for="fRoom">部屋番号（任意）</label><input id="fRoom" value="${esc(d.roomNo||'')}"></div></div><div class="field"><label for="fCheckout">チェックアウト予定日</label><input id="fCheckout" type="date" value="${esc(d.checkoutDate||'')}"></div>`:d.handoff===HANDOFF.SHIP?`<div class="field"><label for="fShip">配送先住所 *</label><textarea id="fShip">${esc(d.shipAddress||'')}</textarea></div>`:'';
  const spotFields=`<div class="field"><label for="fCustomer">お客様名 *</label><input id="fCustomer" value="${esc(d.customer)}"></div><div class="two"><div class="field"><label for="fRegion">お客様</label><select id="fRegion"><option value="domestic" ${d.customerRegion==='domestic'?'selected':''}>国内</option><option value="overseas" ${d.customerRegion==='overseas'?'selected':''}>海外</option></select></div><div class="field"><label for="fPayment">会計方法 *</label><select id="fPayment"><option value="credit" ${d.paymentMethod===PAYMENT.CREDIT?'selected':''}>クレジット</option><option value="cash" ${d.paymentMethod===PAYMENT.CASH?'selected':''}>現金</option></select></div></div>${pickupFields}${destinationFields}`;
  const operationHint='<div class="hintBox sendHint">保存した注文はスタッフ間で共有され、印刷後も残ります。</div>';
  const saveLabel=d.editingId?'変更を保存':'注文を保存';
  $('sheetBody').innerHTML=`<div class="step"><div class="section"><div class="field"><label for="fStore">店舗名 *</label><input id="fStore" value="${esc(d.store)}" placeholder="〇〇眼鏡店"></div><div class="field"><label for="fPhone">電話番号 *</label><input id="fPhone" inputmode="tel" autocomplete="tel" value="${esc(d.phone)}"><div id="phoneWarning" class="fieldWarning ${phoneHasUnexpectedCharacters(d.phone)?'':'hidden'}">数字、+、-、空白、括弧以外が含まれています。入力内容を確認してください。</div></div>${normal?normalFields:spotFields}<div class="field"><label for="fNotes">備考（任意）</label><textarea id="fNotes" placeholder="納期・連絡事項など">${esc(d.notes||'')}</textarea></div></div><div class="section"><div class="sectionTitle">注文確認</div>${d.items.map(item=>`<div class="summaryRow"><span>${esc(item.code)} ${esc(item.name)} × ${esc(item.qty)}</span><b>${yen(item.price*item.qty)}</b></div>`).join('')}<div class="summaryRow"><span>合計</span><b>${yen(totalOf(d))}</b></div></div>${operationHint}${d.paymentMethod===PAYMENT.CASH?'<div class="hintBox topGap">現金は釣銭を用意しない運用です。受取金額を確認してください。</div>':''}</div><div class="stickyActions"><button id="backType" class="secondary">戻る</button><button id="saveBtn" class="primary">${saveLabel}</button></div>`;
  bindInfo(d,normal,now);
}
function bindInfo(d,normal,now){
  const remember=()=>{
    d.store=$('fStore').value.trim();d.phone=$('fPhone').value.trim();d.customer=$('fCustomer')?.value.trim()||'';d.notes=$('fNotes')?.value.trim()||'';
    if(normal){d.accountChoice=$('fAccount').value;d.accountOther=$('fAccountOther')?.value.trim()||'';d.account=d.accountChoice==='その他'?d.accountOther:d.accountChoice;d.staff=$('fStaff').value}
    else{d.customerRegion=$('fRegion').value;d.paymentMethod=$('fPayment').value;if($('fPickup'))d.pickupDate=$('fPickup').value;if($('fHotel'))d.hotelName=$('fHotel').value.trim();if($('fGuest'))d.guestName=$('fGuest').value.trim();if($('fRoom'))d.roomNo=$('fRoom').value.trim();if($('fCheckout'))d.checkoutDate=$('fCheckout').value;if($('fShip'))d.shipAddress=$('fShip').value.trim()}
  };
  state.rememberDraftInput=remember;
  document.querySelectorAll('#sheetBody input,#sheetBody select,#sheetBody textarea').forEach(element=>element.onchange=()=>{remember();clearError()});
  $('fPhone').oninput=()=>{remember();$('phoneWarning').classList.toggle('hidden',!phoneHasUnexpectedCharacters($('fPhone').value));clearError()};
  if($('fAccount'))$('fAccount').onchange=()=>{remember();renderDraft()};





  document.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{remember();d.pickupDate=dateOffset(Number(button.dataset.day));renderDraft()});
  $('backType').onclick=()=>{remember();d.stage='type';renderDraft()};
  $('saveBtn').onclick=async()=>{
    remember();if(now){d.paid=true;d.delivered=true;d.prepared=PREP.READY}
    const errors=validate(d);if(errors.length)return showError(errors[0]);$('saveBtn').disabled=true;
    try{const order=d.editingId?await saveEdited(d):await saveNew(d);if(d.editingId){state.draft=null;closeSheet();revealOrder(order);toast('変更を保存し、同期しました')}else{state.draft={...order,stage:'success'};renderDraft()}}
    catch(error){showError(error.message==='SYNC_CONFLICT'?'別の端末で更新されています。入力内容は残しています。一覧の最新内容を確認してください。':'まだ保存できていません。入力内容はこの画面に残っています。接続を確認して再度保存してください。');$('saveBtn').disabled=false}
  };
}
function renderSuccess(d){
  $('stepLabel').textContent='保存完了';$('sheetTitle').textContent='注文を保存しました';
  $('sheetBody').innerHTML=`<div class="success"><div class="successMark">✓</div><h3>保存・同期が完了しました</h3><p>画面を閉じても、印刷しても注文は残ります。別の端末からも確認できます。</p><div class="summary"><div class="summaryRow"><span>店舗</span><b>${esc(d.store)}</b></div><div class="summaryRow"><span>区分</span><b>${esc(labelOrder(d))}</b></div>${d.receiptNo?`<div class="summaryRow"><span>受付番号</span><b>${esc(d.receiptNo)}</b></div>`:''}<div class="summaryRow"><span>合計</span><b>${yen(totalOf(d))}</b></div></div></div><div class="stickyActions"><button id="successPrint" class="secondary">PDF・印刷</button><button id="continueOrder" class="primary">次の注文を作る</button></div><div class="underActions"><button id="backDash" class="secondary">注文一覧へ戻る</button></div>`;
  $('backDash').insertAdjacentHTML('beforebegin','<button id="successCustomerCopy" class="secondary">お客様控え（QR・画像）</button>');
  $('successCustomerCopy').onclick=()=>showCustomerReceipt(d);
  $('backDash').onclick=()=>{state.draft=null;closeSheet();revealOrder(d)};$('successPrint').onclick=()=>printOrder(d);$('continueOrder').onclick=()=>{state.draft=null;closeSheet();startOrder()};
}

function showDetail(id){
  const order=state.orders.find(item=>item.localId===id);if(!order)return;openSheet('注文詳細','保存済み');
  const rows=[['店舗',order.store],['区分',labelOrder(order)],['電話',order.phone],['お客様',order.customer],['卸屋・帳合先',order.account],['担当',order.staff],['受付番号',order.receiptNo],['受け渡し',handoffLabel(order)],['会計方法',order.type===ORDER_TYPE.SPOT?(order.paymentMethod===PAYMENT.CASH?'現金':'クレジット'):''],['ホテル',order.hotelName],['宿泊者',order.guestName],['部屋番号',order.roomNo],['チェックアウト',order.checkoutDate],['配送先',order.shipAddress],['作成日時',formatDateTime(order.createdAt)],['最終更新',formatDateTime(order.updatedAt)],['備考',order.notes]];
  $('sheetBody').innerHTML=`<div class="step"><div class="section">${rows.filter(([,value])=>value).map(([label,value])=>`<div class="summaryRow"><span>${esc(label)}</span><b class="multiline">${esc(value)}</b></div>`).join('')}</div><div class="section"><div class="sectionTitle">商品</div>${order.items.map(item=>`<div class="summaryRow"><span>${esc(item.code)} ${esc(item.name)} × ${esc(item.qty)}</span><b>${yen(item.price*item.qty)}</b></div>`).join('')}<div class="summaryRow total"><span>合計</span><b>${yen(totalOf(order))}</b></div></div><button id="editOrderBtn" class="primary fullButton">注文を修正</button><div class="two"><button id="customerCopyBtn" class="secondary">お客様控え</button><button id="printBtn" class="secondary">注文書を印刷</button></div><button id="deleteBtn" class="linkBtn hideOrderButton">この注文を一覧から非表示</button></div><div class="stickyActions one"><button id="detailClose" class="secondary">閉じる</button></div>`;
  $('sheetBody').querySelector('.step').insertAdjacentHTML('afterbegin',`<div class="orderStatusEditor"><div class="field"><label for="orderStatus">注文の状態</label><select id="orderStatus">${Object.entries(ORDER_STATUS).map(([key,label])=>`<option value="${key}" ${groupOf(order)===key?'selected':''}>${label}</option>`).join('')}</select></div><button id="saveStatus" class="secondary" disabled>変更</button></div>`);
  $('orderStatus').onchange=()=>{$('saveStatus').disabled=$('orderStatus').value===groupOf(order)};
  $('saveStatus').onclick=async()=>{
    const status=$('orderStatus').value;if(!Object.hasOwn(ORDER_STATUS,status))return;
    $('saveStatus').disabled=true;$('orderStatus').disabled=true;
    try{const updated=await updateOrder({...order,workflowStatus:status});if(state.draft?.localId===order.localId)state.draft=null;revealOrder(updated);showDetail(updated.localId);toast(`${ORDER_STATUS[status]}に変更しました`)}
    catch(error){showError(error.message==='SYNC_CONFLICT'?'別の端末で更新されています。一覧から開き直してください。':'状態を変更できませんでした。接続を確認してください。');$('saveStatus').disabled=false;$('orderStatus').disabled=false}
  };
  $('customerCopyBtn').textContent='お客様控え（QR・画像）';
  $('detailClose').onclick=closeSheet;$('editOrderBtn').onclick=()=>startEditOrder(order);$('customerCopyBtn').onclick=()=>showCustomerReceipt(order);$('printBtn').onclick=()=>printOrder(order);
  $('deleteBtn').onclick=async()=>{
    if(!confirm('この注文を全端末の一覧から非表示にしますか？\n復旧用のデータはSupabaseに残ります。'))return;
    $('deleteBtn').disabled=true;
    try{await hideOrder(order);if(state.draft?.localId===order.localId)state.draft=null;closeSheet();toast('一覧から非表示にしました')}
    catch(error){showError(error.message==='SYNC_CONFLICT'?'別の端末で更新されました。一覧から開き直してください。':'非表示にできませんでした。接続を確認してください。');$('deleteBtn').disabled=false}
  };
}
function printOrder(order){
  printOrders([order],'展示会 注文書',false);
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
    $('sheetBody').innerHTML=`<div class="step"><div class="qrReceipt"><div class="qrOrderNo">注文番号 ${esc(receiptOrderNumber(current))}</div><p>お客様のスマートフォンでQRを読み取ると、控え画像が開きます。<br><b>画像を長押しして保存できます。</b></p><div id="customerQrCode"></div><p class="receiptExpiry">リンク有効期限：${esc(formatDateTime(expires))}<br>このQR・リンクを知っている方が控えを閲覧できます。対象のお客様にだけお渡しください。</p><a id="openReceiptImage" class="secondary fullButton receiptLink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">お客様が開く画像を確認</a><div class="two"><a id="downloadReceiptImage" class="secondary receiptLink" href="${esc(state.receiptBlobUrl)}" download="customer-copy-${esc(current.localId.slice(0,8))}.png">画像を保存</a><button id="printCustomerReceipt" class="secondary">控えを印刷</button></div><details><summary>控え画像のプレビュー</summary><img class="sharedReceiptPreview" src="${esc(state.receiptBlobUrl)}" alt="お客様控えの画像"></details></div></div><div class="stickyActions one"><button id="qrClose" class="primary">閉じる</button></div>`;
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
  const orderNumber=receiptOrderNumber(order);
  const itemCount=(order.items||[]).reduce((sum,item)=>sum+Number(item.qty||0),0);
  const customerName=customerCopy?customerNameWithHonorific(order.customer):order.customer||'-';
  const internalInfo=receiptInternalInfo(order,{customerCopy});
  const info=[['店舗名',order.store],['電話番号',order.phone],['お客様名',customerName],['注文区分',labelOrder(order)]];if(!customerCopy)info.push(['卸屋・帳合先',order.account||'-'],['担当',order.staff||state.staff?.display_name||'-']);if(internalInfo.showHandoff)info.push(['受け渡し',handoffLabel(order)]);
  const createdAtHtml=internalInfo.showCreatedAt?`<br><b>作成日時</b> ${new Date(order.createdAt||Date.now()).toLocaleString('ja-JP')}`:'';
  const infoHtml=info.map(([label,value])=>`<div class="receiptInfoCard"><div class="receiptInfoLabel">${esc(label)}</div><div class="receiptInfoValue">${esc(value||'-')}</div></div>`).join('');
  const itemsHtml=(order.items||[]).map(item=>`<tr><td><b>${esc(item.code)}</b></td><td>${esc(item.name)}</td><td class="num">${esc(item.qty)}</td><td class="num">${yen(item.price)}</td><td class="num"><b>${yen(item.price*item.qty)}</b></td></tr>`).join('');
  const notesHtml=`${!customerCopy&&order.notes?`<div class="receiptNote"><b>備考</b>${esc(order.notes).replace(/\n/g,'<br>')}</div>`:''}${internalInfo.showGuide?'<div class="receiptNote"><b>ご案内</b>内容を確認し、必要に応じて印刷またはPDF保存してください。</div>':''}${internalInfo.headOfficeShare?`<div class="receiptNote"><b>本社共有</b>${esc(internalInfo.headOfficeShare)}</div>`:''}`;
  return `<div class="receiptHeaderSimple"><div class="receiptBrandBlock"><img class="receiptBrandLogo" src="assets/sun_nishimura_logo.jpg" alt="株式会社サンニシムラ"><div><div class="receiptBrandName">株式会社サンニシムラ</div><div class="receiptBrandSub">SAN NISHIMURA CO., LTD.${customerCopy?'':`<br>${esc(cfg.eventName||'展示会')}`}</div></div></div><div class="receiptDocMeta"><div class="receiptDocTitle">${customerCopy?'お客様控え':'展示会 注文書'}</div><div class="receiptDocSub">Exhibition Order Receipt</div><div class="receiptMetaLine"><b>注文番号</b> ${esc(orderNumber)}${createdAtHtml}</div></div></div><div class="receiptInfoBand">${infoHtml}</div><div class="receiptSection"><div class="receiptSectionHead"><div class="receiptSectionTitle">注文明細</div><div class="receiptSectionHint">${itemCount}点</div></div><table class="receiptTable"><colgroup><col class="code"><col><col class="qty"><col class="unit"><col class="subtotal"></colgroup><thead><tr><th>品番</th><th>商品名</th><th class="num">数量</th><th class="num">単価</th><th class="num">金額</th></tr></thead><tbody>${itemsHtml}</tbody></table></div><div class="receiptFooterGrid"><div class="receiptMemoStack">${notesHtml}</div><div><div class="receiptSummaryBox"><div class="receiptSummaryRow"><span>点数</span><span>${itemCount}</span></div><div class="receiptSummaryRow total"><span>合計</span><span>${yen(totalOf(order))}</span></div></div><div class="receiptCurrencyNote">通貨：JPY</div></div></div><div class="receiptFooterMini"><span>株式会社サンニシムラ</span><span>${customerCopy?`注文番号 ${esc(orderNumber)}`:`${esc(cfg.eventName||'展示会')}・${esc(orderNumber)}`}</span></div>`;
}
function printSheetHtml(order,{customerCopy=false}={}){return `<article class="printSheet printPage receiptSheet">${receiptDocumentHtml(order,{customerCopy})}</article>`}

function printOrders(orders,title,withCover=true,{targetLabel='全期間',customerCopy=false}={}){
  const list=orders.filter(order=>!order.deleted).sort(compareOrdersForPrint);
  if(!list.length)return toast('印刷する注文がありません');
  const totalQty=list.reduce((sum,order)=>sum+(order.items||[]).reduce((value,item)=>value+Number(item.qty||0),0),0),grandTotal=list.reduce((sum,order)=>sum+totalOf(order),0);
  const cover=withCover?`<section class="printBatchCover"><div class="eyebrow">${esc(cfg.eventName||'展示会')}</div><h1>${esc(title)}</h1><p><b>対象受付日 ${esc(targetLabel)}</b><br>出力日時 ${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'medium'}).format(new Date())}</p><div class="printStats"><div><small>注文数</small><b>${list.length}件</b></div><div><small>商品点数</small><b>${totalQty}点</b></div><div><small>合計</small><b>${yen(grandTotal)}</b></div></div><table class="batchTable"><thead><tr><th>No.</th><th>受付日時</th><th>区分</th><th>卸屋・帳合先</th><th>店舗・お客様</th><th>合計</th></tr></thead><tbody>${list.map((order,index)=>`<tr><td>${index+1}</td><td>${esc(formatDateTime(order.createdAt||order.created_at,true))}</td><td>${esc(labelOrder(order))}</td><td>${esc(order.account||'-')}</td><td>${esc(order.store)}${order.customer?` / ${esc(order.customer)}`:''}</td><td>${yen(totalOf(order))}</td></tr>`).join('')}</tbody></table></section>`:'';
  $('printArea').innerHTML=`${cover}${list.map(order=>printSheetHtml(order,{customerCopy})).join('')}<div class="printFoot">出力日時 ${new Date().toLocaleString('ja-JP')}</div>`;
  window.print();
  toast('注文データは保存したままです');
}
function showPrintMenu(){
  const orders=state.orders.filter(order=>!order.deleted),normal=orders.filter(order=>order.type===ORDER_TYPE.NORMAL);
  openSheet('まとめて印刷','対象を選択');
  $('sheetBody').innerHTML=`<div class="step"><p class="stepIntro">印刷する注文と受付日を選びます。印刷後も注文は保存されます。</p><div class="printChoices"><button id="printNormalBatch" class="choice full ${normal.length?'':'disabled'}" ${normal.length?'':'disabled'}><b>国内通常注文をまとめて印刷</b><small>伝票打ちへ提出する注文書です。保存済み ${normal.length}件。</small></button><button id="printAllBatch" class="choice full ${orders.length?'':'disabled'}" ${orders.length?'':'disabled'}><b>展示会の全注文データをPDF・印刷</b><small>すべての保存済み注文です。${orders.length}件。</small></button></div></div><div class="stickyActions one"><button id="printMenuClose" class="secondary">閉じる</button></div>`;
  $('printMenuClose').onclick=closeSheet;if($('printNormalBatch'))$('printNormalBatch').onclick=()=>showPrintDateOptions('normal');if($('printAllBatch'))$('printAllBatch').onclick=()=>showPrintDateOptions('final');
}

function showPrintDateOptions(kind,mode='today',start=today(),end=today()){
  const all=state.orders.filter(order=>!order.deleted),base=kind==='normal'?all.filter(order=>order.type===ORDER_TYPE.NORMAL):all,list=filterOrdersByCreatedDate(base,{mode,today:today(),start,end}),summary=batchSummary(list);
  const targetLabel=mode==='all'?'全期間':mode==='today'?today():start===end?start:`${start} ～ ${end}`,dateInvalid=mode==='range'&&(!start||!end||start>end);
  $('stepLabel').textContent=kind==='normal'?'国内通常注文':'すべての注文';$('sheetTitle').textContent='印刷する受付日';
  $('sheetBody').innerHTML=`<div class="step"><div class="dateModeChoices"><button data-date-mode="today" class="${mode==='today'?'on':''}">本日</button><button data-date-mode="range" class="${mode==='range'?'on':''}">日付を指定</button><button data-date-mode="all" class="${mode==='all'?'on':''}">全期間</button></div>${mode==='range'?`<div class="two topGap"><div class="field"><label for="printStart">開始日</label><input id="printStart" type="date" value="${esc(start)}"></div><div class="field"><label for="printEnd">終了日</label><input id="printEnd" type="date" value="${esc(end)}"></div></div>`:''}<div class="section topGap"><div class="summaryRow"><span>対象受付日</span><b>${esc(targetLabel)}</b></div><div class="summaryRow"><span>注文数</span><b>${summary.orders}件</b></div><div class="summaryRow"><span>商品点数</span><b>${summary.items}点</b></div><div class="summaryRow"><span>合計金額</span><b>${yen(summary.total)}</b></div></div>${dateInvalid?'<div class="blockingWarning">開始日と終了日を正しく指定してください。</div>':''}<div class="hintBox">印刷・PDF保存後も注文は残ります。</div></div><div class="stickyActions"><button id="printDateBack" class="secondary">戻る</button><button id="executeBatchPrint" class="primary" ${dateInvalid||!summary.orders?'disabled':''}>PDF・印刷</button></div>`;
  document.querySelectorAll('[data-date-mode]').forEach(button=>button.onclick=()=>showPrintDateOptions(kind,button.dataset.dateMode,start,end));
  if($('printStart'))$('printStart').onchange=()=>showPrintDateOptions(kind,'range',$('printStart').value,$('printEnd').value);
  if($('printEnd'))$('printEnd').onchange=()=>showPrintDateOptions(kind,'range',$('printStart').value,$('printEnd').value);
  $('printDateBack').onclick=showPrintMenu;$('executeBatchPrint').onclick=()=>printOrders(list,kind==='normal'?'国内通常注文 一括注文書':'展示会 全注文データ',true,{targetLabel});
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
  window.addEventListener('beforeunload',event=>{state.rememberDraftInput?.();if(state.draft&&state.draft.stage!=='success'&&(state.draft.items?.length||state.draft.store)){event.preventDefault();event.returnValue=''}});
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
window.addEventListener('afterprint',()=>{$('printArea').innerHTML=''});
$('logoutBtn').onclick=logout;$('refreshBtn').onclick=refreshPrivateData;$('newOrderBtn').onclick=startOrder;$('discardDraftBtn').onclick=showDiscardDraftConfirm;$('closeSheet').onclick=closeSheet;$('sheet').onclick=event=>{if(event.target===$('sheet'))closeSheet()};$('printMenuBtn').onclick=showPrintMenu;$('orderSearch').oninput=render;

purgeLegacyLocalData();if(location.hash.startsWith('#receipt='))history.replaceState(null,'',`${location.pathname}${location.search}`);await bootOnline();
