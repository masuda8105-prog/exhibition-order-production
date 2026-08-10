import {ORDER_TYPE,HANDOFF,PAYMENT,PREP,needsHeadOfficeShare,needsReceipt,totalOf,validate,isDone,groupOf,nextAction,labelOrder,handoffLabel,normalizeForSave,applyAction} from './workflow.js';

const cfg=window.EXHIBITION_CONFIG||{};
const $=id=>document.getElementById(id);
const LS_ORDERS='exhibitionOps.orders.v1',LS_SESSION='exhibitionOps.session.v1',LS_COUNTER='exhibitionOps.counter.v1';
const state={online:false,demo:false,session:null,staff:null,orders:[],products:[],tab:'active',filter:'',draft:null,poll:null,loading:false,syncing:false};
const yen=n=>Number.isFinite(Number(n))?`¥${Math.round(Number(n)).toLocaleString('ja-JP')}`:'価格未定';
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const isoDate=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(d);
const today=()=>isoDate(new Date());
const dateOffset=n=>{const d=new Date();d.setDate(d.getDate()+n);return isoDate(d)};

function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2600)}
function setSync(mode,text){$('syncDot').className=`syncDot${mode?` ${mode}`:''}`;$('syncText').textContent=text}
function migrateOrder(order){if(needsHeadOfficeShare(order)&&typeof order.headOfficeShared!=='boolean'){order.headOfficeShared=false;order.headOfficeSharedAt=''}return order}
function localLoad(){try{return JSON.parse(localStorage.getItem(LS_ORDERS)||'[]').map(migrateOrder)}catch{return[]}}
function localSave(){localStorage.setItem(LS_ORDERS,JSON.stringify(state.orders.slice(0,1000)))}
function localCounter(){const n=Number(localStorage.getItem(LS_COUNTER)||0)+1;localStorage.setItem(LS_COUNTER,String(n));return n}
function temporaryReceipt(){return `仮-${String(localCounter()).padStart(3,'0')}`}

async function fetchJson(url,opts={},timeout=30000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch(url,{...opts,signal:controller.signal});
    const json=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(json?.message||json?.error||`HTTP_${response.status}`);
    return json;
  }finally{clearTimeout(timer)}
}
function sbBase(){return String(cfg.supabaseUrl||'').replace(/\/$/,'')}
function sbHeaders(auth=true){const headers={apikey:String(cfg.anonKey||''),'Content-Type':'application/json'};if(auth&&state.session?.access_token)headers.Authorization=`Bearer ${state.session.access_token}`;return headers}
function saveSession(session){session.expires_at=Math.floor(Date.now()/1000)+Number(session.expires_in||3600);state.session=session;localStorage.setItem(LS_SESSION,JSON.stringify(session));return session}
async function signIn(email,password){return saveSession(await fetchJson(`${sbBase()}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})}))}
async function refreshSession(){
  if(!state.session?.refresh_token)throw new Error('SESSION_EXPIRED');
  return saveSession(await fetchJson(`${sbBase()}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:state.session.refresh_token})}));
}
async function ensureFreshSession(){if(Number(state.session?.expires_at||0)<=Math.floor(Date.now()/1000)+60)await refreshSession()}
async function loadStaff(){const id=state.session?.user?.id;if(!id)throw new Error('LOGIN_REQUIRED');const rows=await fetchJson(`${sbBase()}/rest/v1/exhibition_staff?select=display_name,role,active&user_id=eq.${encodeURIComponent(id)}&active=is.true&limit=1`,{headers:sbHeaders()});if(!rows?.[0])throw new Error('スタッフ権限がありません。');state.staff=rows[0]}

async function onlineCreate(order){
  const form=new FormData();
  form.append('order',JSON.stringify(toOnlineOrder(order)));
  const response=await fetch(`${sbBase()}/functions/v1/${cfg.createFunctionName||'exhibition-order'}`,{method:'POST',headers:{apikey:cfg.anonKey},body:form});
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(json.error||`UPLOAD_${response.status}`);
  return json;
}
async function onlinePatch(order){
  if(!order.remoteId)throw new Error('REMOTE_ID_REQUIRED');
  const body={order_data:toOnlineOrder(order),status:order.deleted?'deleted':isDone(order)?'completed':'in_progress',updated_by_name:state.staff?.display_name||'',updated_at:new Date().toISOString()};
  await fetchJson(`${sbBase()}/rest/v1/exhibition_orders?id=eq.${encodeURIComponent(order.remoteId)}`,{method:'PATCH',headers:{...sbHeaders(),Prefer:'return=minimal'},body:JSON.stringify(body)});
}
function toOnlineOrder(order){return {
  schemaVersion:4,eventId:cfg.eventId,eventName:cfg.eventName,eventDate:cfg.eventDate,
  localId:order.localId,type:order.type,handoff:order.handoff,customerRegion:order.customerRegion||'domestic',
  customerCompany:order.store,customerName:order.customer||'',customerPhone:order.phone,account:order.account||'',staffName:order.staff||state.staff?.display_name||'',
  paymentMethod:order.paymentMethod||'',paid:!!order.paid,prepared:order.prepared,delivered:!!order.delivered,shipped:!!order.shipped,
  headOfficeShared:!!order.headOfficeShared,headOfficeSharedAt:order.headOfficeSharedAt||'',
  pickupDate:order.pickupDate||'',hotelName:order.hotelName||'',guestName:order.guestName||'',roomNo:order.roomNo||'',checkoutDate:order.checkoutDate||'',shippingAddress:order.shipAddress||'',notes:order.notes||'',
  items:(order.items||[]).map(item=>({c:item.code,n:item.name,p:Number(item.price||0),q:Number(item.qty||0)})),total:totalOf(order),receiptRequired:needsReceipt(order),clientReceiptNo:order.receiptNo||'',workflowGroup:groupOf(order)
}}
function fromRemote(row){
  const data=row.order_data||{};
  if(Number(data.schemaVersion||0)<2||!data.type)return null;
  const order=normalizeForSave({
    ...data,localId:data.localId||`R-${row.id}`,remoteId:String(row.id),publicToken:row.public_token||'',serverOrderNo:row.order_no||'',receiptNo:data.receiptRequired?(row.order_no||data.clientReceiptNo||''):null,
    store:data.customerCompany||'',customer:data.customerName||'',phone:data.customerPhone||'',shipAddress:data.shippingAddress||'',
    headOfficeShared:!!data.headOfficeShared,headOfficeSharedAt:data.headOfficeSharedAt||'',
    items:(data.items||[]).map((item,index)=>({lineId:`remote-${index}`,code:item.c,name:Array.isArray(item.n)?item.n[0]:item.n,price:Number(item.p||0),qty:Number(item.q||0)})),syncState:'synced'
  });
  order.createdAt=row.created_at||order.createdAt;
  order.updatedAt=row.updated_at||order.updatedAt;
  return order;
}
async function ensureRemoteCreate(order){
  if(order.remoteId)return order;
  const online=await onlineCreate(order);
  order.remoteId=String(online.id||'');order.publicToken=String(online.token||'');order.serverOrderNo=String(online.orderNo||'');
  if(!order.remoteId)throw new Error('REMOTE_CREATE_INVALID_RESPONSE');
  if(needsReceipt(order)&&order.serverOrderNo)order.receiptNo=order.serverOrderNo;
  order.syncState='synced';
  localSave();
  return order;
}
async function saveNew(order){
  const saved=normalizeForSave({...order,syncState:state.online?'pending':'local'});
  if(needsReceipt(saved))saved.receiptNo=temporaryReceipt();
  state.orders.unshift(saved);localSave();render();
  if(state.online){
    try{setSync('busy','注文を登録中…');await ensureRemoteCreate(saved)}catch(error){console.error(error);saved.syncState='pending';localSave();setSync('error','未同期データあり')}
  }
  render();return saved;
}
async function updateOrder(order,event='status_update'){
  order.updatedAt=new Date().toISOString();
  if(state.online){
    order.syncState='pending';localSave();
    try{await ensureFreshSession();await ensureRemoteCreate(order);await onlinePatch(order);order.syncState='synced'}
    catch(error){console.error(error);order.syncState='pending';toast('更新は端末に保存しました')}
  }
  localSave();render();return order;
}
async function syncPendingOrders(){
  if(!state.online||state.syncing)return;
  state.syncing=true;
  try{
    for(const order of state.orders.filter(item=>item.syncState!=='synced')){
      try{
        if(order.deleted){if(order.remoteId){await onlinePatch(order);order.syncState='synced';localSave()}continue}
        await ensureRemoteCreate(order);
        await onlinePatch(order);order.syncState='synced';localSave()
      }catch(error){console.warn('pending sync failed',order.localId,error)}
    }
  }finally{state.syncing=false}
}
async function onlineLoad(){
  if(!state.online||state.loading)return;
  state.loading=true;setSync('busy','同期中…');
  try{
    await ensureFreshSession();await syncPendingOrders();
    const select='id,public_token,order_no,order_data,status,created_at,updated_at,event_id,event_name,event_date';
    const rows=await fetchJson(`${sbBase()}/rest/v1/exhibition_orders?select=${encodeURIComponent(select)}&event_id=eq.${encodeURIComponent(cfg.eventId)}&status=neq.deleted&order=created_at.desc&limit=1000`,{headers:sbHeaders()});
    const remote=(rows||[]).map(fromRemote).filter(Boolean);
    const localPending=state.orders.filter(order=>order.syncState!=='synced');
    const pendingByRemote=new Map(localPending.filter(order=>order.remoteId).map(order=>[String(order.remoteId),order]));
    const merged=remote.map(order=>pendingByRemote.get(String(order.remoteId))||order);
    const remoteIds=new Set(merged.map(order=>String(order.remoteId||'')));
    localPending.filter(order=>!order.remoteId||!remoteIds.has(String(order.remoteId))).forEach(order=>merged.push(order));
    state.orders=merged;localSave();setSync('online',`オンライン・${state.staff?.display_name||'スタッフ'}`);render();
  }catch(error){console.error(error);setSync('error','同期エラー・端末データを表示');toast('オンライン同期に失敗しました')}
  finally{state.loading=false}
}

async function loadProducts(){
  state.products=[];
  try{
    const response=await fetch(cfg.productCsv||'product_master.csv',{cache:'no-store'});
    if(!response.ok)throw new Error(`PRODUCT_MASTER_${response.status}`);
    const text=await response.text();
    const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
    const head=splitCsv(lines.shift()).map(value=>value.toLowerCase());
    const codeIndex=head.indexOf('code'),nameIndex=head.indexOf('name'),priceIndex=head.indexOf('price'),statusIndex=head.indexOf('status');
    if(codeIndex<0||nameIndex<0||priceIndex<0)throw new Error('PRODUCT_MASTER_COLUMNS');
    state.products=lines.map((line,index)=>{
      const cells=splitCsv(line),code=String(cells[codeIndex]||'').trim(),name=String(cells[nameIndex]||'').trim();
      const rawPrice=String(cells[priceIndex]||'').replace(/,/g,'').trim(),price=rawPrice===''?NaN:Number(rawPrice),status=statusIndex>=0?String(cells[statusIndex]||'active').trim():'active';
      return{productId:`product-${index}`,code,name,price,status,orderable:status==='active'&&Number.isFinite(price)&&price>0};
    }).filter(product=>product.code&&product.name);
    if(!state.products.length)throw new Error('PRODUCT_MASTER_EMPTY');
  }catch(error){
    console.error('product master load failed',error);
    state.products=[{productId:'fallback-1054',code:'1054',name:'クリングス調整ヤットコ',price:6800,status:'active',orderable:true}];
    toast('商品マスターを読み込めませんでした');
  }
}
function splitCsv(line){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(ch===','&&!q){out.push(cur);cur=''}else cur+=ch}out.push(cur);return out}

function render(){renderMetrics();renderOrders()}
function filteredOrders(){const q=$('orderSearch').value.trim().toLowerCase();return state.orders.filter(o=>!o.deleted&&groupOf(o)===state.tab).filter(o=>{
  if(state.filter==='unshared')return needsHeadOfficeShare(o)&&!o.headOfficeShared;
  if(state.filter==='pickup')return o.handoff===HANDOFF.LATER&&o.headOfficeShared&&!o.delivered;
  if(state.filter==='unpaid')return o.type===ORDER_TYPE.SPOT&&!o.paid;
  return true;
}).filter(o=>!q||[o.receiptNo,o.store,o.customer,o.phone,...(o.items||[]).flatMap(i=>[i.code,i.name])].join(' ').toLowerCase().includes(q))}
function renderMetrics(){const open=state.orders.filter(o=>!o.deleted&&!isDone(o));$('metricUnshared').textContent=open.filter(o=>needsHeadOfficeShare(o)&&!o.headOfficeShared).length;$('metricPickup').textContent=open.filter(o=>o.handoff===HANDOFF.LATER&&o.headOfficeShared&&!o.delivered).length;$('metricUnpaid').textContent=open.filter(o=>o.type===ORDER_TYPE.SPOT&&!o.paid).length;['active','waiting','done'].forEach(k=>{$(`count${k[0].toUpperCase()+k.slice(1)}`).textContent=state.orders.filter(o=>!o.deleted&&groupOf(o)===k).length});document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));if(state.filter){$('activeFilter').classList.remove('hidden');$('activeFilter').innerHTML=`絞込中：<b>${{unshared:'本社未共有',pickup:'受取待ち',unpaid:'未会計'}[state.filter]}</b><button id="clearFilter">解除</button>`;$('clearFilter').onclick=()=>{state.filter='';render()}}else $('activeFilter').classList.add('hidden')}
function renderOrders(){const list=filteredOrders(),wrap=$('orders');if(!list.length){wrap.innerHTML='<div class="empty">該当する注文はありません。</div>';return}wrap.innerHTML=list.map(cardHtml).join('');wrap.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>handleCardAction(b.dataset.id,b.dataset.action));wrap.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>showDetail(b.dataset.detail))}
function cardHtml(order){
  const action=nextAction(order);
  const payment=order.type===ORDER_TYPE.SPOT&&[HANDOFF.NOW,HANDOFF.LATER].includes(order.handoff)?(order.paid?'<span class="chip ok">会計済み</span>':'<span class="chip warn">会計待ち</span>'):'';
  const sharing=needsHeadOfficeShare(order)?(order.headOfficeShared?'<span class="chip ok">本社共有済み</span>':'<span class="chip danger">本社未共有</span>'):'';
  const normal=order.type===ORDER_TYPE.NORMAL?'<span class="chip ok">印刷対象</span>':'';
  const sync=order.syncState==='pending'?'<span class="syncBadge">● 未同期</span>':'';
  return `<article class="orderCard ${!order.headOfficeShared&&needsHeadOfficeShare(order)?'needsShare':''}"><div class="orderTop"><div>${order.receiptNo?`<div class="receiptNo">${esc(order.receiptNo)}</div>`:''}<div class="store">${esc(order.store)}</div></div><div class="amount">${yen(totalOf(order))}</div></div><div class="chips"><span class="chip">${esc(labelOrder(order))}</span>${payment}${sharing}${normal}${sync}</div><div class="cardNote">${esc(handoffLabel(order))}${order.customer?` ／ ${esc(order.customer)}`:''}</div><button class="cardAction ${action.key==='done'?'soft':action.key==='share'?'shareAction':''}" data-action="${action.key}" data-id="${esc(order.localId)}">${esc(action.label)}</button><button class="linkBtn detailLink" data-detail="${esc(order.localId)}">詳細</button></article>`;
}
async function handleCardAction(id,action){const order=state.orders.find(item=>item.localId===id);if(!order)return;if(action==='done'||action==='detail')return showDetail(id);if(action==='share')return showShareConfirm(order);if(action==='deliver')return showDeliveryConfirm(order)}

function showShareConfirm(order){
  openSheet('本社共有の確認',labelOrder(order));
  const destination=order.handoff===HANDOFF.LATER?'共有後、この注文は「受取待ち」へ移動します。':'共有後、この注文は「完了」へ移動します。以後の配送対応は本社へ引き継ぎます。';
  $('sheetBody').innerHTML=`<div class="step"><div class="shareConfirm"><div class="shareIcon">本社</div><h3>Slackなどで本社へ共有しましたか？</h3><p>このツールからSlackへは送信されません。実際に共有したことを確認してから押してください。</p></div><div class="hintBox topGap">${esc(destination)}</div><div class="section topGap"><div class="summaryRow"><span>店舗</span><b>${esc(order.store)}</b></div><div class="summaryRow"><span>お客様</span><b>${esc(order.customer)}</b></div><div class="summaryRow"><span>受け渡し</span><b>${esc(handoffLabel(order))}</b></div></div></div><div class="stickyActions"><button id="shareCancel" class="secondary">まだ共有していない</button><button id="shareDone" class="primary">本社共有済みにする</button></div>`;
  $('shareCancel').onclick=closeSheet;$('shareDone').onclick=async()=>{$('shareDone').disabled=true;Object.assign(order,applyAction(order,'share'));await updateOrder(order,'head_office_shared');closeSheet();state.tab=groupOf(order);render();toast(order.handoff===HANDOFF.LATER?'受取待ちへ移動しました':'本社対応として完了しました')};
}

function showDeliveryConfirm(order){
  openSheet('お渡し完了の確認','受取待ち');
  $('sheetBody').innerHTML=`<div class="step"><div class="shareConfirm"><div class="successMark">✓</div><h3>会計と商品のお渡しは完了しましたか？</h3><p>完了にすると「完了」フォルダへ移動します。</p></div><div class="section topGap"><div class="summaryRow"><span>受付番号</span><b>${esc(order.receiptNo||'-')}</b></div><div class="summaryRow"><span>お客様</span><b>${esc(order.customer)}</b></div><div class="summaryRow"><span>受取予定</span><b>${esc(order.pickupDate||'-')}</b></div></div></div><div class="stickyActions"><button id="deliveryCancel" class="secondary">戻る</button><button id="deliveryDone" class="primary">会計・お渡し完了</button></div>`;
  $('deliveryCancel').onclick=closeSheet;$('deliveryDone').onclick=async()=>{$('deliveryDone').disabled=true;Object.assign(order,applyAction(order,'deliver'));await updateOrder(order,'delivered');closeSheet();state.tab='done';render();toast('完了へ移動しました')};
}

function openSheet(title,step=''){ $('sheetTitle').textContent=title;$('stepLabel').textContent=step;$('sheet').classList.remove('hidden');document.body.style.overflow='hidden';clearError()}
function closeSheet(){ $('sheet').classList.add('hidden');document.body.style.overflow='';state.draft=null}
function showError(msg){$('sheetError').textContent=msg;$('sheetError').classList.remove('hidden');$('sheetPanel')?.scrollTo({top:0,behavior:'smooth'})}
function clearError(){$('sheetError').classList.add('hidden');$('sheetError').textContent=''}
function freshDraft(){return{stage:'products',type:null,handoff:null,customerRegion:'domestic',items:[],store:'',phone:'',customer:'',account:'',staff:state.staff?.display_name||'',paymentMethod:PAYMENT.CREDIT,paid:false,delivered:false,shipped:false,prepared:PREP.NONE,headOfficeShared:false,headOfficeSharedAt:'',pickupDate:dateOffset(1),notes:''}}
function startOrder(){state.draft=freshDraft();openSheet('新しい注文','1 / 3');renderDraft()}
function renderDraft(){clearError();if(!state.draft)return;const d=state.draft;if(d.stage==='products')renderProductStep(d);else if(d.stage==='type')renderTypeStep(d);else if(d.stage==='info')renderInfoStep(d);else if(d.stage==='success')renderSuccess(d)}
function renderProductStep(d){$('stepLabel').textContent='1 / 3　商品';$('sheetTitle').textContent='商品を追加';$('sheetBody').innerHTML=`<div class="step productStep"><div class="productSearch"><div class="productSearchRow"><input id="productQ" type="search" inputmode="search" placeholder="品番・商品名" autocomplete="off"><button id="clearPQ" class="secondary" aria-label="検索をクリア">×</button></div><div id="productResults" class="productResults" role="listbox"></div></div><div class="section productCartSection"><div class="sectionTitle">注文明細 <span id="cartCount">${d.items.reduce((s,i)=>s+i.qty,0)}点</span></div><div id="cartLines" class="cart"></div></div><div class="productKeypadDock"><div class="keypadTitle"><div><b>固定入力キー</b><small>画面を動かさず品番を入力</small></div><span id="keypadModeLabel">数字・記号</span></div><div id="productKeypad" class="productKeypad numberKeys"></div></div></div><div class="stickyActions one"><button id="toType" class="primary">注文内容へ進む</button></div>`;const q=$('productQ');q.oninput=()=>renderProductResults(d,q.value);$('clearPQ').onclick=()=>{q.value='';renderProductResults(d,'')};bindProductKeypad(d,q);$('toType').onclick=()=>{if(!d.items.length)return showError('商品を1点以上追加してください。');d.stage='type';renderDraft()};renderCart(d)}
function bindProductKeypad(d,q){
  const wrap=$('productKeypad'),modeLabel=$('keypadModeLabel');let mode='number';
  const numeric=[['1'],['2'],['3'],['⌫','backspace'],['4'],['5'],['6'],['-'],['7'],['8'],['9'],['A字','alpha'],['0','insert','wide'],['クリア','clear','wide']];
  const alpha='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(value=>[value]).concat([['-'],['⌫','backspace'],['数字','number'],['クリア','clear']]);
  const draw=()=>{
    const keys=mode==='number'?numeric:alpha;wrap.className=`productKeypad ${mode==='number'?'numberKeys':'alphaKeys'}`;modeLabel.textContent=mode==='number'?'数字・記号':'英字 A–Z';
    wrap.innerHTML=keys.map(([label,action='insert',size=''])=>`<button type="button" class="keypadKey ${size}" data-key-action="${action}" data-key-value="${esc(label)}" aria-label="${label==='⌫'?'1文字削除':esc(label)}">${esc(label)}</button>`).join('');
    wrap.querySelectorAll('[data-key-action]').forEach(button=>{button.onpointerdown=event=>event.preventDefault();button.onclick=()=>{const action=button.dataset.keyAction,value=button.dataset.keyValue;if(action==='alpha'){mode='alpha';draw();return}if(action==='number'){mode='number';draw();return}if(action==='clear')q.value='';else if(action==='backspace')q.value=q.value.slice(0,-1);else q.value+=value;renderProductResults(d,q.value)}});
  };
  draw();
}
function renderProductResults(d,query){
  const q=String(query||'').trim().toLowerCase(),wrap=$('productResults');
  if(!q){wrap.innerHTML='';wrap.classList.remove('open');return}
  const list=state.products.map((product,index)=>({product,index,rank:productRank(product,q)})).filter(result=>result.rank<9).sort((a,b)=>a.rank-b.rank||a.index-b.index).slice(0,35);
  wrap.classList.add('open');
  wrap.innerHTML=list.length?list.map(({product,rank})=>`<div class="productRow ${rank===0?'exact':''} ${product.orderable?'':'unavailable'}" role="option"><div><div class="productCodeLine"><b>${esc(product.code)}</b>${rank===0?'<span class="matchBadge">完全一致</span>':''}</div><small>${esc(product.name)} ／ ${product.orderable?yen(product.price):'価格未定・注文不可'}</small></div><button class="addBtn" data-product-id="${esc(product.productId)}" ${product.orderable?'':'disabled'}>${product.orderable?'追加':'追加不可'}</button></div>`).join(''):'<div class="empty">該当商品がありません。</div>';
  wrap.querySelectorAll('[data-product-id]').forEach(button=>button.onclick=()=>{
    const product=state.products.find(item=>item.productId===button.dataset.productId);if(!product?.orderable)return;
    const existing=d.items.find(item=>item.productId===product.productId);
    if(existing)existing.qty++;else d.items.push({...product,lineId:`line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`,qty:1});
    renderCart(d);$('productQ').value='';renderProductResults(d,'');toast(`${product.code} を追加`);
  });
}
function productRank(p,q){const c=String(p.code).toLowerCase(),n=String(p.name).toLowerCase();const qn=q.replace(/-/g,''),cn=c.replace(/-/g,'');if(c===q||cn===qn)return 0;if(c.startsWith(q)||cn.startsWith(qn))return 1;if(c.includes(q)||cn.includes(qn))return 2;if(n.includes(q))return 3;return 9}
function renderCart(d){
  const wrap=$('cartLines'),count=d.items.reduce((sum,item)=>sum+Number(item.qty||0),0);if($('cartCount'))$('cartCount').textContent=`${count}点`;
  if(!d.items.length){wrap.innerHTML='<div class="empty" style="padding:22px">まだ商品がありません。</div>';return}
  wrap.innerHTML=d.items.map(item=>`<div class="cartLine"><div><b>${esc(item.code)} ${esc(item.name)}</b><small>${yen(item.price)} × ${item.qty}</small></div><div class="qty"><button data-minus="${esc(item.lineId)}" aria-label="数量を減らす">−</button><b>${item.qty}</b><button data-plus="${esc(item.lineId)}" aria-label="数量を増やす">＋</button></div></div>`).join('')+`<div class="totalRow"><span>合計</span><span>${yen(totalOf(d))}</span></div>`;
  wrap.querySelectorAll('[data-plus]').forEach(button=>button.onclick=()=>{const item=d.items.find(value=>value.lineId===button.dataset.plus);if(item)item.qty++;renderCart(d)});
  wrap.querySelectorAll('[data-minus]').forEach(button=>button.onclick=()=>{const item=d.items.find(value=>value.lineId===button.dataset.minus);if(!item)return;item.qty--;if(item.qty<=0)d.items=d.items.filter(value=>value!==item);renderCart(d)});
}
function renderTypeStep(d){$('stepLabel').textContent='2 / 3　注文方法';$('sheetTitle').textContent='どの対応ですか？';$('sheetBody').innerHTML=`<div class="step"><p class="stepIntro">実際の対応に一番近いものを選んでください。</p><div class="choiceGrid"><button class="choice ${d.type===ORDER_TYPE.NORMAL?'on':''}" data-type="normal"><b>国内通常注文</b><small>卸屋・電話番号を入力して受注完了。帰社後にまとめて印刷します。</small></button><button class="choice ${d.type===ORDER_TYPE.SPOT?'on':''}" data-type="spot"><b>現売り対応</b><small>会場での会計・受け渡し、後日受取、配送です。</small></button></div>${d.type===ORDER_TYPE.SPOT?`<div class="section topGap"><div class="sectionTitle">商品の渡し方</div><div class="choiceGrid handoffChoices"><button class="choice ${d.handoff===HANDOFF.NOW?'on':''}" data-handoff="now"><b>1　在庫あり・その場渡し</b><small>会計して、その場で商品をお渡しします。</small></button><button class="choice ${d.handoff===HANDOFF.LATER?'on':''}" data-handoff="later"><b>2　翌日・翌々日に受取</b><small>本社共有が必要。共有後は「受取待ち」で管理します。</small></button><button class="choice ${d.handoff===HANDOFF.HOTEL?'on':''}" data-handoff="hotel"><b>3　ホテルへ配送</b><small>本社共有が必要。共有済みになれば対応完了です。</small></button><button class="choice ${d.handoff===HANDOFF.SHIP?'on':''}" data-handoff="ship"><b>3　指定住所へ配送</b><small>本社共有が必要。共有済みになれば対応完了です。</small></button></div></div>`:''}</div><div class="stickyActions"><button id="backProducts" class="secondary">戻る</button><button id="toInfo" class="primary">入力へ進む</button></div>`;document.querySelectorAll('[data-type]').forEach(button=>button.onclick=()=>{d.type=button.dataset.type;if(d.type===ORDER_TYPE.SPOT&&!d.handoff)d.handoff=HANDOFF.NOW;if(d.type===ORDER_TYPE.NORMAL){d.handoff=null;d.headOfficeShared=false}renderDraft()});document.querySelectorAll('[data-handoff]').forEach(button=>button.onclick=()=>{d.handoff=button.dataset.handoff;if(d.handoff===HANDOFF.NOW){d.headOfficeShared=false;d.headOfficeSharedAt=''}renderDraft()});$('backProducts').onclick=()=>{d.stage='products';renderDraft()};$('toInfo').onclick=()=>{if(!d.type)return showError('注文方法を選択してください。');d.stage='info';renderDraft()}}
function renderInfoStep(d){
  const normal=d.type===ORDER_TYPE.NORMAL,now=d.handoff===HANDOFF.NOW;
  $('stepLabel').textContent='3 / 3　入力・確認';$('sheetTitle').textContent=normal?'通常注文を受ける':'現売りを登録';
  const accounts=cfg.accounts||[],staffNames=[...new Set([...(cfg.staffNames||[]),state.staff?.display_name].filter(Boolean))];
  const accountOptions=accounts.map(value=>`<option value="${esc(value)}" ${d.account===value?'selected':''}>${esc(value)}</option>`).join('');
  const staffOptions=staffNames.map(value=>`<option value="${esc(value)}" ${d.staff===value?'selected':''}>${esc(value)}</option>`).join('');
  const normalFields=`<div class="field"><label for="fAccount">卸屋・帳合先 *</label><select id="fAccount"><option value="">選択してください</option>${accountOptions}</select></div><div class="field"><label for="fStaff">受注担当者 *</label><select id="fStaff"><option value="">選択してください</option>${staffOptions}</select></div><div class="field"><label for="fCustomer">お客様名（任意）</label><input id="fCustomer" value="${esc(d.customer)}"></div>`;
  const paymentFields=!now?`<div class="field"><label>会計状況</label><div class="seg"><button type="button" id="payDone" class="${d.paid?'on':''}">会計済み</button><button type="button" id="payLater" class="${!d.paid?'on':''}">${d.handoff===HANDOFF.LATER?'受取時に会計':'本社対応'}</button></div></div>`:'';
  const pickupFields=d.handoff===HANDOFF.LATER?`<div class="field"><label for="fPickup">受取予定日 *</label><div class="quickDates"><button type="button" data-day="1" class="${d.pickupDate===dateOffset(1)?'on':''}">明日</button><button type="button" data-day="2" class="${d.pickupDate===dateOffset(2)?'on':''}">明後日</button></div><input id="fPickup" type="date" min="${dateOffset(1)}" value="${esc(d.pickupDate)}"></div>`:'';
  const destinationFields=d.handoff===HANDOFF.HOTEL?`<div class="field"><label for="fHotel">ホテル名 *</label><input id="fHotel" value="${esc(d.hotelName||'')}"></div><div class="two"><div class="field"><label for="fGuest">宿泊者名 *</label><input id="fGuest" value="${esc(d.guestName||d.customer||'')}"></div><div class="field"><label for="fRoom">部屋番号（任意）</label><input id="fRoom" value="${esc(d.roomNo||'')}"></div></div><div class="field"><label for="fCheckout">チェックアウト予定日</label><input id="fCheckout" type="date" value="${esc(d.checkoutDate||'')}"></div>`:d.handoff===HANDOFF.SHIP?`<div class="field"><label for="fShip">配送先住所 *</label><textarea id="fShip">${esc(d.shipAddress||'')}</textarea></div>`:'';
  const shareFields=needsHeadOfficeShare(d)?`<div class="shareStatus ${d.headOfficeShared?'shared':'pending'}"><div><b>本社への共有 *</b><small>各自Slackなどで実際に共有した後、「共有済み」を選んでください。</small></div><div class="seg"><button type="button" id="sharePendingChoice" class="${!d.headOfficeShared?'on':''}">まだ共有していない</button><button type="button" id="shareDoneChoice" class="${d.headOfficeShared?'on':''}">本社共有済み</button></div></div>`:'';
  const spotFields=`<div class="field"><label for="fCustomer">お客様名 *</label><input id="fCustomer" value="${esc(d.customer)}"></div><div class="two"><div class="field"><label for="fRegion">お客様</label><select id="fRegion"><option value="domestic" ${d.customerRegion==='domestic'?'selected':''}>国内</option><option value="overseas" ${d.customerRegion==='overseas'?'selected':''}>海外</option></select></div><div class="field"><label for="fPayment">会計方法 *</label><select id="fPayment"><option value="credit" ${d.paymentMethod===PAYMENT.CREDIT?'selected':''}>クレジット</option><option value="cash" ${d.paymentMethod===PAYMENT.CASH?'selected':''}>現金</option></select></div></div>${paymentFields}${pickupFields}${destinationFields}${shareFields}`;
  const operationHint=normal?'<div class="hintBox sendHint"><b>登録すると受注完了です。</b><br>帰社後に「印刷・PDF」から国内通常注文をまとめて印刷してください。</div>':needsHeadOfficeShare(d)?`<div class="hintBox ${d.headOfficeShared?'sendHint':'warnHint'}">${d.headOfficeShared?(d.handoff===HANDOFF.LATER?'登録後は「受取待ち」へ入ります。':'本社へ引き継ぎ済みとして「完了」へ入ります。'):'登録後は「要対応」に入り、本社未共有が赤く表示されます。'}</div>`:'<div class="hintBox sendHint">会計と商品のお渡しが済んだ状態で登録し、そのまま完了になります。</div>';
  const saveLabel=normal?'受注完了で登録':now?'会計・お渡し完了で登録':d.headOfficeShared?(d.handoff===HANDOFF.LATER?'共有済みで受取待ちに登録':'共有済みで完了登録'):'本社未共有で要対応に登録';
  $('sheetBody').innerHTML=`<div class="step"><div class="section"><div class="field"><label for="fStore">店舗名 *</label><input id="fStore" value="${esc(d.store)}" placeholder="〇〇眼鏡店"></div><div class="field"><label for="fPhone">電話番号 *</label><input id="fPhone" inputmode="tel" autocomplete="tel" value="${esc(d.phone)}"></div>${normal?normalFields:spotFields}<div class="field"><label for="fNotes">備考（任意）</label><textarea id="fNotes" placeholder="納期・連絡事項など">${esc(d.notes||'')}</textarea></div></div><div class="section"><div class="sectionTitle">注文確認</div>${d.items.map(item=>`<div class="summaryRow"><span>${esc(item.code)} ${esc(item.name)} × ${item.qty}</span><b>${yen(item.price*item.qty)}</b></div>`).join('')}<div class="summaryRow"><span>合計</span><b>${yen(totalOf(d))}</b></div></div>${operationHint}${d.paymentMethod===PAYMENT.CASH?'<div class="hintBox topGap">現金は釣銭を用意しない運用です。受取金額を確認してください。</div>':''}</div><div class="stickyActions"><button id="backType" class="secondary">戻る</button><button id="saveBtn" class="primary">${saveLabel}</button></div>`;
  bindInfo(d,normal,now);
}
function bindInfo(d,normal,now){
  const remember=()=>{
    d.store=$('fStore').value.trim();d.phone=$('fPhone').value.trim();d.customer=$('fCustomer')?.value.trim()||'';d.notes=$('fNotes')?.value.trim()||'';
    if(normal){d.account=$('fAccount').value;d.staff=$('fStaff').value}
    else{d.customerRegion=$('fRegion').value;d.paymentMethod=$('fPayment').value;if($('fPickup'))d.pickupDate=$('fPickup').value;if($('fHotel'))d.hotelName=$('fHotel').value.trim();if($('fGuest'))d.guestName=$('fGuest').value.trim();if($('fRoom'))d.roomNo=$('fRoom').value.trim();if($('fCheckout'))d.checkoutDate=$('fCheckout').value;if($('fShip'))d.shipAddress=$('fShip').value.trim()}
  };
  document.querySelectorAll('#sheetBody input,#sheetBody select,#sheetBody textarea').forEach(element=>element.onchange=remember);
  if($('payDone'))$('payDone').onclick=()=>{remember();d.paid=true;renderDraft()};
  if($('payLater'))$('payLater').onclick=()=>{remember();d.paid=false;renderDraft()};
  if($('shareDoneChoice'))$('shareDoneChoice').onclick=()=>{remember();d.headOfficeShared=true;d.headOfficeSharedAt=new Date().toISOString();renderDraft()};
  if($('sharePendingChoice'))$('sharePendingChoice').onclick=()=>{remember();d.headOfficeShared=false;d.headOfficeSharedAt='';renderDraft()};
  document.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{remember();d.pickupDate=dateOffset(Number(button.dataset.day));renderDraft()});
  $('backType').onclick=()=>{remember();d.stage='type';renderDraft()};
  $('saveBtn').onclick=async()=>{
    remember();if(now){d.paid=true;d.delivered=true;d.prepared=PREP.READY}
    const errors=validate(d);if(errors.length)return showError(errors[0]);$('saveBtn').disabled=true;
    try{const order=await saveNew(d);state.draft={...order,stage:'success'};renderDraft()}
    catch(error){console.error(error);showError('保存できませんでした。もう一度お試しください。');$('saveBtn').disabled=false}
  };
}
function renderSuccess(d){
  const normal=d.type===ORDER_TYPE.NORMAL,group=groupOf(d),shared=needsHeadOfficeShare(d)&&d.headOfficeShared;
  $('stepLabel').textContent='登録完了';$('sheetTitle').textContent=normal?'受注完了':'現売り登録完了';
  const heading=normal?'受注が完了しました':group==='done'?'対応完了です':group==='waiting'?'受取待ちに登録しました':'本社共有が必要です';
  const message=normal?'帰社後に国内通常注文をまとめて印刷してください。':group==='waiting'?'お客様が来場したら、会計・商品お渡し完了を押してください。':group==='active'?'各自Slackなどで本社へ共有した後、要対応画面で「本社共有済み」にしてください。':shared?'本社へ引き継ぎ済みとして完了に保存しました。':'その場での会計・お渡しが完了しました。';
  $('sheetBody').innerHTML=`<div class="success"><div class="successMark ${group==='active'?'pending':''}">${group==='active'?'!':'✓'}</div><h3>${heading}</h3><p>${message}</p><div class="summary"><div class="summaryRow"><span>店舗</span><b>${esc(d.store)}</b></div><div class="summaryRow"><span>区分</span><b>${esc(labelOrder(d))}</b></div>${needsHeadOfficeShare(d)?`<div class="summaryRow"><span>本社共有</span><b class="${d.headOfficeShared?'statusSent':'statusPending'}">${d.headOfficeShared?'共有済み':'未共有'}</b></div>`:''}${d.receiptNo?`<div class="summaryRow"><span>受付番号</span><b>${esc(d.receiptNo)}</b></div>`:''}<div class="summaryRow"><span>保存先</span><b>${{active:'要対応',waiting:'受取待ち',done:'完了'}[group]}</b></div><div class="summaryRow"><span>合計</span><b>${yen(totalOf(d))}</b></div></div></div><div class="stickyActions one"><button id="backDash" class="primary">管理画面へ戻る</button></div>`;
  $('backDash').onclick=()=>{closeSheet();state.tab=groupOf(d);render()};
}

function showDetail(id){
  const order=state.orders.find(item=>item.localId===id);if(!order)return;openSheet('注文詳細','');
  const sharingRow=needsHeadOfficeShare(order)?`<div class="summaryRow"><span>本社共有</span><b class="${order.headOfficeShared?'statusSent':'statusPending'}">${order.headOfficeShared?'共有済み':'未共有'}</b></div>${order.headOfficeSharedAt?`<div class="summaryRow"><span>共有確認日時</span><b>${new Date(order.headOfficeSharedAt).toLocaleString('ja-JP')}</b></div>`:''}`:'';
  $('sheetBody').innerHTML=`<div class="step"><div class="section"><div class="summaryRow"><span>店舗</span><b>${esc(order.store)}</b></div><div class="summaryRow"><span>区分</span><b>${esc(labelOrder(order))}</b></div><div class="summaryRow"><span>電話</span><b>${esc(order.phone)}</b></div>${order.customer?`<div class="summaryRow"><span>お客様</span><b>${esc(order.customer)}</b></div>`:''}${order.account?`<div class="summaryRow"><span>卸屋・帳合先</span><b>${esc(order.account)}</b></div>`:''}${order.staff?`<div class="summaryRow"><span>担当</span><b>${esc(order.staff)}</b></div>`:''}${order.receiptNo?`<div class="summaryRow"><span>受付番号</span><b>${esc(order.receiptNo)}</b></div>`:''}${sharingRow}${order.type===ORDER_TYPE.SPOT?`<div class="summaryRow"><span>会計</span><b>${order.paid?'会計済み':'未会計'}・${order.paymentMethod===PAYMENT.CASH?'現金':'クレジット'}</b></div>`:''}<div class="summaryRow"><span>受け渡し</span><b>${esc(handoffLabel(order))}</b></div><div class="summaryRow"><span>現在</span><b>${{active:'要対応',waiting:'受取待ち',done:'完了'}[groupOf(order)]}</b></div>${order.notes?`<div class="summaryRow"><span>備考</span><b class="multiline">${esc(order.notes)}</b></div>`:''}</div><div class="section"><div class="sectionTitle">商品</div>${order.items.map(item=>`<div class="summaryRow"><span>${esc(item.code)} ${esc(item.name)} × ${item.qty}</span><b>${yen(item.price*item.qty)}</b></div>`).join('')}<div class="summaryRow total"><span>合計</span><b>${yen(totalOf(order))}</b></div></div><button id="printBtn" class="secondary fullButton">この注文をPDF保存・印刷</button><button id="deleteBtn" class="dangerBtn fullButton">削除</button></div><div class="stickyActions one"><button id="detailClose" class="primary">閉じる</button></div>`;
  $('detailClose').onclick=closeSheet;$('printBtn').onclick=()=>printOrder(order);
  $('deleteBtn').onclick=async()=>{
    if(!confirm('この注文を削除しますか？'))return;$('deleteBtn').disabled=true;
    if(!order.remoteId){state.orders=state.orders.filter(item=>item!==order);localSave()}
    else{order.deleted=true;await updateOrder(order,'deleted')}
    closeSheet();render();
  };
}
function printOrder(order){
  printOrders([order],'展示会 注文書',false);
}
function printSheetHtml(order){
  const orderNumber=order.serverOrderNo||order.receiptNo||order.localId;
  const status={active:'要対応',waiting:'受取待ち',done:'完了'}[groupOf(order)];
  return `<article class="printSheet printPage"><div class="printTitle"><div><h2>展示会 注文書</h2><small>${esc(cfg.eventName||'展示会')} ／ ${esc(labelOrder(order))}</small></div><div class="printNo"><b>注文番号</b><br>${esc(orderNumber)}<br><small>${status}</small></div></div><div class="printMeta"><div><b>店舗名</b><br>${esc(order.store)}</div><div><b>電話番号</b><br>${esc(order.phone)}</div><div><b>卸屋・帳合先</b><br>${esc(order.account||'-')}</div><div><b>受注担当</b><br>${esc(order.staff||state.staff?.display_name||'-')}</div>${order.customer?`<div><b>お客様名</b><br>${esc(order.customer)}</div>`:''}<div><b>受け渡し</b><br>${esc(handoffLabel(order))}</div>${needsHeadOfficeShare(order)?`<div><b>本社共有</b><br>${order.headOfficeShared?'共有済み':'未共有'}</div>`:''}<div><b>作成日時</b><br>${new Date(order.createdAt||Date.now()).toLocaleString('ja-JP')}</div></div><table class="printItems"><thead><tr><th>品番・商品</th><th>数量</th><th>単価</th><th>金額</th></tr></thead><tbody>${order.items.map(item=>`<tr><td>${esc(item.code)} ${esc(item.name)}</td><td>${item.qty}</td><td>${yen(item.price)}</td><td>${yen(item.price*item.qty)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="3">合計</th><th>${yen(totalOf(order))}</th></tr></tfoot></table>${order.notes?`<div class="printNotes"><b>備考</b><br>${esc(order.notes)}</div>`:''}</article>`;
}
function printOrders(orders,title,withCover=true){
  const list=orders.filter(order=>!order.deleted).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  if(!list.length)return toast('印刷する注文がありません');
  const totalQty=list.reduce((sum,order)=>sum+(order.items||[]).reduce((value,item)=>value+Number(item.qty||0),0),0),grandTotal=list.reduce((sum,order)=>sum+totalOf(order),0);
  const cover=withCover?`<section class="printBatchCover"><div class="eyebrow">${esc(cfg.eventName||'展示会')}</div><h1>${esc(title)}</h1><p>出力日時 ${new Date().toLocaleString('ja-JP')}</p><div class="printStats"><div><small>注文数</small><b>${list.length}件</b></div><div><small>商品点数</small><b>${totalQty}点</b></div><div><small>合計</small><b>${yen(grandTotal)}</b></div></div><table class="batchTable"><thead><tr><th>No.</th><th>区分</th><th>店舗・お客様</th><th>状態</th><th>合計</th></tr></thead><tbody>${list.map((order,index)=>`<tr><td>${index+1}</td><td>${esc(labelOrder(order))}</td><td>${esc(order.store)}${order.customer?` / ${esc(order.customer)}`:''}</td><td>${{active:'要対応',waiting:'受取待ち',done:'完了'}[groupOf(order)]}</td><td>${yen(totalOf(order))}</td></tr>`).join('')}</tbody></table></section>`:'';
  $('printArea').innerHTML=`${cover}${list.map(printSheetHtml).join('')}<div class="printFoot">出力日時 ${new Date().toLocaleString('ja-JP')}</div>`;
  window.print();
}
function showPrintMenu(){
  const orders=state.orders.filter(order=>!order.deleted),normal=orders.filter(order=>order.type===ORDER_TYPE.NORMAL);
  openSheet('印刷・PDF','用途を選択');
  $('sheetBody').innerHTML=`<div class="step"><p class="stepIntro">印刷画面で「PDFに保存」を選べば、そのままPDFとして提出できます。</p><div class="printChoices"><button id="printNormalBatch" class="choice full ${normal.length?'':'disabled'}" ${normal.length?'':'disabled'}><b>国内通常注文をまとめて印刷</b><small>帰社後、伝票打ちへ提出する注文書です。現在 ${normal.length}件。</small></button><button id="printAllBatch" class="choice full ${orders.length?'':'disabled'}" ${orders.length?'':'disabled'}><b>展示会の全注文データをPDF・印刷</b><small>展示会終了後の提出用です。全 ${orders.length}件を一覧と明細にまとめます。</small></button></div></div><div class="stickyActions one"><button id="printMenuClose" class="secondary">閉じる</button></div>`;
  $('printMenuClose').onclick=closeSheet;if($('printNormalBatch'))$('printNormalBatch').onclick=()=>printOrders(normal,'国内通常注文 一括注文書');if($('printAllBatch'))$('printAllBatch').onclick=()=>printOrders(orders,'展示会 全注文データ');
}

function showFilter(){openSheet('絞り込み','');$('sheetBody').innerHTML=`<div class="step"><div class="choiceGrid"><button class="choice" data-f="unshared"><b>本社未共有</b><small>Slackなどで本社共有が必要</small></button><button class="choice" data-f="pickup"><b>受取待ち</b><small>共有済み・お客様の来場待ち</small></button><button class="choice" data-f="unpaid"><b>未会計</b><small>現売りの会計確認</small></button><button class="choice" data-f=""><b>すべて</b></button></div></div>`;document.querySelectorAll('[data-f]').forEach(button=>button.onclick=()=>{state.filter=button.dataset.f;closeSheet();render()})}

async function bootOnline(){try{const saved=JSON.parse(localStorage.getItem(LS_SESSION)||'null');if(saved?.access_token){state.session=saved;await ensureFreshSession();await loadStaff();state.online=true;showApp();await onlineLoad();startPoll();return}showLogin()}catch(error){console.warn(error);localStorage.removeItem(LS_SESSION);state.session=null;state.online=false;showLogin()}}
function showLogin(){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}
function showApp(){$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('eventName').textContent=cfg.eventName||'EXHIBITION';$('logoutBtn').classList.toggle('hidden',!state.online);setSync(state.online?'online':'',state.online?`オンライン・${state.staff?.display_name||'スタッフ'}`:`端末モード・商品${state.products.length.toLocaleString('ja-JP')}件`);render()}
function startPoll(){clearInterval(state.poll);state.poll=setInterval(()=>onlineLoad(),Math.max(5,Number(cfg.pollSeconds||8))*1000)}
async function login(){const email=$('loginEmail').value.trim(),password=$('loginPassword').value;if(!email||!password)return $('loginMsg').textContent='メールとパスワードを入力してください。';$('loginMsg').textContent='';$('loginBtn').disabled=true;try{await signIn(email,password);await loadStaff();state.online=true;showApp();await onlineLoad();startPoll()}catch(error){console.error(error);state.online=false;$('loginMsg').textContent='ログインできませんでした。アカウントまたは通信を確認してください。'}finally{$('loginBtn').disabled=false}}
function demo(){state.demo=true;state.online=false;state.orders=localLoad();showApp();setSync('','端末モード・オンライン未接続')}
function logout(){localStorage.removeItem(LS_SESSION);state.session=null;state.staff=null;state.online=false;clearInterval(state.poll);showLogin()}

$('loginBtn').onclick=login;$('loginPassword').onkeydown=event=>{if(event.key==='Enter')login()};$('demoBtn').onclick=demo;$('logoutBtn').onclick=logout;$('refreshBtn').onclick=()=>state.online?onlineLoad():render();$('newOrderBtn').onclick=startOrder;$('closeSheet').onclick=closeSheet;$('sheet').onclick=event=>{if(event.target===$('sheet'))closeSheet()};$('filterBtn').onclick=showFilter;$('printMenuBtn').onclick=showPrintMenu;$('orderSearch').oninput=renderOrders;$('tabs').onclick=event=>{const button=event.target.closest('[data-tab]');if(!button)return;state.tab=button.dataset.tab;state.filter='';render()};document.querySelectorAll('.metric').forEach(button=>button.onclick=()=>{state.filter=button.dataset.filter;state.tab=button.dataset.filter==='pickup'?'waiting':'active';render()});

await loadProducts();state.orders=localLoad();if(cfg.onlineEnabled)await bootOnline();else demo();
