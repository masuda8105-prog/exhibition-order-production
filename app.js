import {ORDER_TYPE,HANDOFF,PAYMENT,PREP,needsReceipt,totalOf,validate,isDone,groupOf,nextAction,labelOrder,handoffLabel,normalizeForSave,applyAction} from './workflow.js';

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
function migrateOrder(order){if(order?.type===ORDER_TYPE.NORMAL&&order.submitted&&!order.submissionState)order.submissionState='sent';return order}
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
  schemaVersion:3,eventId:cfg.eventId,eventName:cfg.eventName,eventDate:cfg.eventDate,
  localId:order.localId,type:order.type,handoff:order.handoff,customerRegion:order.customerRegion||'domestic',
  customerCompany:order.store,customerName:order.customer||'',customerPhone:order.phone,account:order.account||'',staffName:order.staff||state.staff?.display_name||'',
  paymentMethod:order.paymentMethod||'',paid:!!order.paid,prepared:order.prepared,delivered:!!order.delivered,shipped:!!order.shipped,submitted:!!order.submitted,
  submissionState:order.submissionState||'none',submittedAt:order.submittedAt||'',
  pickupDate:order.pickupDate||'',hotelName:order.hotelName||'',guestName:order.guestName||'',roomNo:order.roomNo||'',checkoutDate:order.checkoutDate||'',shippingAddress:order.shipAddress||'',notes:order.notes||'',
  items:(order.items||[]).map(item=>({c:item.code,n:item.name,p:Number(item.price||0),q:Number(item.qty||0)})),total:totalOf(order),receiptRequired:needsReceipt(order),clientReceiptNo:order.receiptNo||'',workflowGroup:groupOf(order)
}}
function fromRemote(row){
  const data=row.order_data||{};
  if(Number(data.schemaVersion||0)<2||!data.type)return null;
  const order=normalizeForSave({
    ...data,localId:data.localId||`R-${row.id}`,remoteId:String(row.id),publicToken:row.public_token||'',serverOrderNo:row.order_no||'',receiptNo:data.receiptRequired?(row.order_no||data.clientReceiptNo||''):null,
    store:data.customerCompany||'',customer:data.customerName||'',phone:data.customerPhone||'',shipAddress:data.shippingAddress||'',
    submissionState:data.submissionState||(data.submitted?'sent':'none'),submittedAt:data.submittedAt||'',
    items:(data.items||[]).map((item,index)=>({lineId:`remote-${index}`,code:item.c,name:Array.isArray(item.n)?item.n[0]:item.n,price:Number(item.p||0),qty:Number(item.q||0)})),syncState:'synced'
  });
  order.createdAt=row.created_at||order.createdAt;
  order.updatedAt=row.updated_at||order.updatedAt;
  return order;
}
async function notifySlack(order,event,{required=false}={}){
  if(!state.online||!cfg.slackFunctionName){if(required)throw new Error('ORDER_SEND_OFFLINE');return null}
  try{return await fetchJson(`${sbBase()}/functions/v1/${cfg.slackFunctionName}`,{method:'POST',headers:sbHeaders(),body:JSON.stringify({event,order:toOnlineOrder(order),receiptNo:order.receiptNo||'',idempotencyKey:`${order.localId}:${event}`})},20000)}
  catch(error){if(required)throw error;console.warn('Slack notify failed',error);return null}
}
async function ensureRemoteCreate(order){
  if(order.remoteId)return order;
  const online=await onlineCreate(order);
  order.remoteId=String(online.id||'');order.publicToken=String(online.token||'');order.serverOrderNo=String(online.orderNo||'');
  if(!order.remoteId)throw new Error('REMOTE_CREATE_INVALID_RESPONSE');
  if(needsReceipt(order)&&order.serverOrderNo)order.receiptNo=order.serverOrderNo;
  order.syncState=order.type===ORDER_TYPE.NORMAL&&order.submissionState==='pending'?'pending':'synced';
  localSave();
  return order;
}
async function sendNormalOrder(order,{userInitiated=true}={}){
  if(order.type!==ORDER_TYPE.NORMAL)return false;
  order.submissionState='pending';order.submitted=false;order.submissionError='';order.updatedAt=new Date().toISOString();order.syncState='pending';localSave();render();
  if(!state.online){if(userInitiated)toast('端末に保存しました。オンライン接続後に送信します');return false}
  try{
    setSync('busy','注文書を送信中…');
    await ensureFreshSession();
    await ensureRemoteCreate(order);
    const result=await notifySlack(order,'normal_order_submitted',{required:true});
    order.submitted=true;order.submissionState='sent';order.submittedAt=result?.sentAt||new Date().toISOString();order.submissionError='';order.syncState='pending';localSave();
    try{await onlinePatch(order);order.syncState='synced'}catch(error){console.error('送信状態の同期に失敗',error);order.syncState='pending'}
    localSave();setSync('online',`オンライン・${state.staff?.display_name||'スタッフ'}`);if(userInitiated)toast('注文書を送信しました');render();return true;
  }catch(error){
    console.error(error);order.submitted=false;order.submissionState='pending';order.submissionError=error.message||'SEND_FAILED';order.syncState='pending';localSave();setSync('error','注文書が未送信です');if(userInitiated)toast('送信できませんでした。再送してください');render();return false;
  }
}
async function saveNew(order,{submitNormal=false}={}){
  const submissionState=submitNormal?'pending':'none';
  const saved=normalizeForSave({...order,submitted:false,submissionState,syncState:state.online?'pending':'local'});
  if(needsReceipt(saved))saved.receiptNo=temporaryReceipt();
  state.orders.unshift(saved);localSave();render();
  if(state.online){
    try{setSync('busy','注文を登録中…');await ensureRemoteCreate(saved)}catch(error){console.error(error);saved.syncState='pending';localSave();setSync('error','未同期データあり')}
  }
  if(submitNormal)await sendNormalOrder(saved);
  else if(state.online&&saved.remoteId)await notifySlack(saved,'order_created');
  render();return saved;
}
async function updateOrder(order,event='status_update'){
  order.updatedAt=new Date().toISOString();
  if(state.online){
    order.syncState='pending';localSave();
    try{await ensureFreshSession();await ensureRemoteCreate(order);await onlinePatch(order);order.syncState='synced';await notifySlack(order,event)}
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
        if(order.type===ORDER_TYPE.NORMAL&&order.submissionState==='pending')await sendNormalOrder(order,{userInitiated:false});
        else{await onlinePatch(order);order.syncState='synced';localSave()}
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
  if(state.filter==='today')return o.handoff===HANDOFF.LATER&&o.pickupDate===today();
  if(state.filter==='future')return o.handoff===HANDOFF.LATER&&o.pickupDate&&o.pickupDate>today();
  if(state.filter==='unpaid')return o.type===ORDER_TYPE.SPOT&&!o.paid;
  return true;
}).filter(o=>!q||[o.receiptNo,o.store,o.customer,o.phone,...(o.items||[]).flatMap(i=>[i.code,i.name])].join(' ').toLowerCase().includes(q))}
function renderMetrics(){const open=state.orders.filter(o=>!o.deleted&&!isDone(o));$('metricToday').textContent=open.filter(o=>o.handoff===HANDOFF.LATER&&o.pickupDate===today()).length;$('metricFuture').textContent=open.filter(o=>o.handoff===HANDOFF.LATER&&o.pickupDate&&o.pickupDate>today()).length;$('metricUnpaid').textContent=open.filter(o=>o.type===ORDER_TYPE.SPOT&&!o.paid).length;['active','waiting','done'].forEach(k=>{$(`count${k[0].toUpperCase()+k.slice(1)}`).textContent=state.orders.filter(o=>!o.deleted&&groupOf(o)===k).length});document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));if(state.filter){$('activeFilter').classList.remove('hidden');$('activeFilter').innerHTML=`絞込中：<b>${{today:'今日受取',future:'明日以降',unpaid:'未会計'}[state.filter]}</b><button id="clearFilter">解除</button>`;$('clearFilter').onclick=()=>{state.filter='';render()}}else $('activeFilter').classList.add('hidden')}
function renderOrders(){const list=filteredOrders(),wrap=$('orders');if(!list.length){wrap.innerHTML='<div class="empty">該当する注文はありません。</div>';return}wrap.innerHTML=list.map(cardHtml).join('');wrap.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>handleCardAction(b.dataset.id,b.dataset.action));wrap.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>showDetail(b.dataset.detail))}
function cardHtml(order){
  const action=nextAction(order);
  const payment=order.type===ORDER_TYPE.SPOT?(order.paid?'<span class="chip ok">会計済み</span>':'<span class="chip danger">未会計</span>'):'';
  const preparation=order.type===ORDER_TYPE.SPOT&&order.handoff!==HANDOFF.NOW?`<span class="chip ${order.prepared===PREP.READY?'ok':''}">${order.prepared===PREP.READY?'商品準備済み':order.prepared===PREP.PREPARING?'準備中':'未準備'}</span>`:'';
  const submission=order.type===ORDER_TYPE.NORMAL?(order.submitted?'<span class="chip ok">注文書送信済み</span>':'<span class="chip danger">注文書未送信</span>'):'';
  const sync=order.syncState==='pending'?'<span class="syncBadge">● 未同期</span>':'';
  return `<article class="orderCard"><div class="orderTop"><div>${order.receiptNo?`<div class="receiptNo">${esc(order.receiptNo)}</div>`:''}<div class="store">${esc(order.store)}</div></div><div class="amount">${yen(totalOf(order))}</div></div><div class="chips"><span class="chip">${esc(labelOrder(order))}</span>${payment}${preparation}${submission}${sync}</div><div class="cardNote">${esc(handoffLabel(order))}${order.customer?` ／ ${esc(order.customer)}`:''}</div><button class="cardAction ${action.key==='done'?'soft':''}" data-action="${action.key}" data-id="${esc(order.localId)}">${esc(action.label)}</button><button class="linkBtn detailLink" data-detail="${esc(order.localId)}">詳細</button></article>`;
}
async function handleCardAction(id,action){const o=state.orders.find(x=>x.localId===id);if(!o)return;if(action==='done')return showDetail(id);if(action==='submit'){showSubmit(o);return}const n=applyAction(o,action);Object.assign(o,n);await updateOrder(o,action);if(isDone(o))toast('対応済みに移動しました');else if(action==='prepare'&&o.prepared===PREP.READY)toast('受取・発送待ちへ移動しました')}

function openSheet(title,step=''){ $('sheetTitle').textContent=title;$('stepLabel').textContent=step;$('sheet').classList.remove('hidden');document.body.style.overflow='hidden';clearError()}
function closeSheet(){ $('sheet').classList.add('hidden');document.body.style.overflow='';state.draft=null}
function showError(msg){$('sheetError').textContent=msg;$('sheetError').classList.remove('hidden');$('sheetPanel')?.scrollTo({top:0,behavior:'smooth'})}
function clearError(){$('sheetError').classList.add('hidden');$('sheetError').textContent=''}
function freshDraft(){return{stage:'products',type:null,handoff:null,customerRegion:'domestic',items:[],store:'',phone:'',customer:'',account:'',staff:state.staff?.display_name||'',paymentMethod:PAYMENT.CREDIT,paid:false,delivered:false,shipped:false,prepared:PREP.NONE,pickupDate:dateOffset(1),notes:''}}
function startOrder(){state.draft=freshDraft();openSheet('新しい注文','1 / 3');renderDraft()}
function renderDraft(){clearError();if(!state.draft)return;const d=state.draft;if(d.stage==='products')renderProductStep(d);else if(d.stage==='type')renderTypeStep(d);else if(d.stage==='info')renderInfoStep(d);else if(d.stage==='success')renderSuccess(d)}
function renderProductStep(d){$('stepLabel').textContent='1 / 3　商品';$('sheetTitle').textContent='商品を追加';$('sheetBody').innerHTML=`<div class="step"><div class="productSearch"><div class="productSearchRow"><input id="productQ" type="search" inputmode="search" placeholder="品番・商品名"><button id="clearPQ" class="secondary">×</button></div></div><div id="productResults" class="productResults"><div class="empty">品番・商品名を入力してください。</div></div><div class="section" style="margin-top:10px"><div class="sectionTitle">注文明細 <span id="cartCount">${d.items.reduce((s,i)=>s+i.qty,0)}点</span></div><div id="cartLines" class="cart"></div></div></div><div class="stickyActions one"><button id="toType" class="primary">注文内容へ進む</button></div>`;const q=$('productQ');q.oninput=()=>renderProductResults(d,q.value);$('clearPQ').onclick=()=>{q.value='';renderProductResults(d,'')};$('toType').onclick=()=>{if(!d.items.length)return showError('商品を1点以上追加してください。');d.stage='type';renderDraft()};renderCart(d)}
function renderProductResults(d,query){
  const q=String(query||'').trim().toLowerCase(),wrap=$('productResults');
  if(!q){wrap.innerHTML='<div class="empty">品番・商品名を入力してください。</div>';return}
  const list=state.products.map((product,index)=>({product,index,rank:productRank(product,q)})).filter(result=>result.rank<9).sort((a,b)=>a.rank-b.rank||a.index-b.index).slice(0,35);
  wrap.innerHTML=list.length?list.map(({product})=>`<div class="productRow ${product.orderable?'':'unavailable'}"><div><b>${esc(product.code)}</b><small>${esc(product.name)} ／ ${product.orderable?yen(product.price):'価格未定・注文不可'}</small></div><button class="addBtn" data-product-id="${esc(product.productId)}" ${product.orderable?'':'disabled'}>${product.orderable?'追加':'追加不可'}</button></div>`).join(''):'<div class="empty">該当商品がありません。</div>';
  wrap.querySelectorAll('[data-product-id]').forEach(button=>button.onclick=()=>{
    const product=state.products.find(item=>item.productId===button.dataset.productId);if(!product?.orderable)return;
    const existing=d.items.find(item=>item.productId===product.productId);
    if(existing)existing.qty++;else d.items.push({...product,lineId:`line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`,qty:1});
    renderCart(d);toast(`${product.code} を追加`);
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
function renderTypeStep(d){$('stepLabel').textContent='2 / 3　注文方法';$('sheetTitle').textContent='注文方法';$('sheetBody').innerHTML=`<div class="step"><p class="stepIntro">一番近いものを選んでください。現売りは「今すぐ持ち帰り」を初期選択します。</p><div class="choiceGrid"><button class="choice ${d.type===ORDER_TYPE.NORMAL?'on':''}" data-type="normal"><b>国内通常注文</b><small>帳合先へ通常の注文書を提出</small></button><button class="choice ${d.type===ORDER_TYPE.SPOT?'on':''}" data-type="spot"><b>現売り</b><small>会場で会計・受け渡し</small></button></div>${d.type===ORDER_TYPE.SPOT?`<div class="section" style="margin-top:10px"><div class="sectionTitle">商品の渡し方</div><div class="choiceGrid"><button class="choice ${d.handoff===HANDOFF.NOW?'on':''}" data-handoff="now"><b>今すぐ持ち帰り</b><small>受付番号なし・その場で完了</small></button><button class="choice ${d.handoff===HANDOFF.LATER?'on':''}" data-handoff="later"><b>後日会場で受取</b><small>受付番号を発行</small></button><button class="choice ${d.handoff===HANDOFF.HOTEL?'on':''}" data-handoff="hotel"><b>ホテル配送</b><small>海外客で多いパターン</small></button><button class="choice ${d.handoff===HANDOFF.SHIP?'on':''}" data-handoff="ship"><b>指定先へ配送</b><small>ホテル以外へ発送</small></button></div></div>`:''}</div><div class="stickyActions"><button id="backProducts" class="secondary">戻る</button><button id="toInfo" class="primary">入力へ進む</button></div>`;document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{d.type=b.dataset.type;if(d.type===ORDER_TYPE.SPOT&&!d.handoff)d.handoff=HANDOFF.NOW;if(d.type===ORDER_TYPE.NORMAL)d.handoff=null;renderDraft()});document.querySelectorAll('[data-handoff]').forEach(b=>b.onclick=()=>{d.handoff=b.dataset.handoff;renderDraft()});$('backProducts').onclick=()=>{d.stage='products';renderDraft()};$('toInfo').onclick=()=>{if(!d.type)return showError('注文方法を選択してください。');d.stage='info';renderDraft()}}
function renderInfoStep(d){
  const normal=d.type===ORDER_TYPE.NORMAL,now=d.handoff===HANDOFF.NOW;
  $('stepLabel').textContent='3 / 3　確認';$('sheetTitle').textContent=normal?'注文先情報':'お客様・会計';
  const accounts=cfg.accounts||[],staffNames=[...new Set([...(cfg.staffNames||[]),state.staff?.display_name].filter(Boolean))];
  const accountOptions=accounts.map(value=>`<option value="${esc(value)}" ${d.account===value?'selected':''}>${esc(value)}</option>`).join('');
  const staffOptions=staffNames.map(value=>`<option value="${esc(value)}" ${d.staff===value?'selected':''}>${esc(value)}</option>`).join('');
  const normalFields=`<div class="field"><label for="fAccount">帳合先 *</label><select id="fAccount"><option value="">選択</option>${accountOptions}</select></div><div class="field"><label for="fStaff">受注担当者 *</label><select id="fStaff"><option value="">選択</option>${staffOptions}</select></div><div class="field"><label for="fCustomer">お客様名（任意）</label><input id="fCustomer" value="${esc(d.customer)}"></div>`;
  const spotFields=`<div class="field"><label for="fCustomer">お客様名 *</label><input id="fCustomer" value="${esc(d.customer)}"></div><div class="two"><div class="field"><label for="fRegion">お客様</label><select id="fRegion"><option value="domestic" ${d.customerRegion==='domestic'?'selected':''}>国内</option><option value="overseas" ${d.customerRegion==='overseas'?'selected':''}>海外</option></select></div><div class="field"><label for="fPayment">会計方法 *</label><select id="fPayment"><option value="credit" ${d.paymentMethod===PAYMENT.CREDIT?'selected':''}>クレジット</option><option value="cash" ${d.paymentMethod===PAYMENT.CASH?'selected':''}>現金</option></select></div></div>${!now?`<div class="field"><label>会計状況</label><div class="seg"><button type="button" id="payDone" class="${d.paid?'on':''}">会計済み</button><button type="button" id="payLater" class="${!d.paid?'on':''}">未会計</button></div></div>`:''}${d.handoff===HANDOFF.LATER?`<div class="field"><label for="fPickup">受取予定日 *</label><div class="quickDates"><button type="button" data-day="0" class="${d.pickupDate===dateOffset(0)?'on':''}">今日</button><button type="button" data-day="1" class="${d.pickupDate===dateOffset(1)?'on':''}">明日</button><button type="button" data-day="2" class="${d.pickupDate===dateOffset(2)?'on':''}">明後日</button></div><input id="fPickup" type="date" value="${esc(d.pickupDate)}"></div>`:''}${d.handoff===HANDOFF.HOTEL?`<div class="field"><label for="fHotel">ホテル名 *</label><input id="fHotel" value="${esc(d.hotelName||'')}"></div><div class="two"><div class="field"><label for="fGuest">宿泊者名 *</label><input id="fGuest" value="${esc(d.guestName||d.customer||'')}"></div><div class="field"><label for="fRoom">部屋番号（任意）</label><input id="fRoom" value="${esc(d.roomNo||'')}"></div></div><div class="field"><label for="fCheckout">チェックアウト予定日</label><input id="fCheckout" type="date" value="${esc(d.checkoutDate||'')}"></div>`:''}${d.handoff===HANDOFF.SHIP?`<div class="field"><label for="fShip">配送先住所 *</label><textarea id="fShip">${esc(d.shipAddress||'')}</textarea></div>`:''}`;
  const sendHint=normal?(state.online?'<div class="hintBox sendHint">登録後、注文書を受注チャンネルへ送信します。送信成功時だけ完了になります。</div>':'<div class="hintBox warnHint">端末モードのため、注文は送信待ちで保存されます。オンラインログイン後に自動再送します。</div>'):'';
  $('sheetBody').innerHTML=`<div class="step"><div class="section"><div class="field"><label for="fStore">店舗名 *</label><input id="fStore" value="${esc(d.store)}" placeholder="〇〇眼鏡店"></div><div class="field"><label for="fPhone">電話番号 *</label><input id="fPhone" inputmode="tel" autocomplete="tel" value="${esc(d.phone)}"></div>${normal?normalFields:spotFields}<div class="field"><label for="fNotes">備考（任意）</label><textarea id="fNotes" placeholder="納期・連絡事項など">${esc(d.notes||'')}</textarea></div></div><div class="section"><div class="sectionTitle">注文確認</div>${d.items.map(item=>`<div class="summaryRow"><span>${esc(item.code)} ${esc(item.name)} × ${item.qty}</span><b>${yen(item.price*item.qty)}</b></div>`).join('')}<div class="summaryRow"><span>合計</span><b>${yen(totalOf(d))}</b></div></div>${sendHint}${d.paymentMethod===PAYMENT.CASH?'<div class="hintBox">現金は釣銭を用意しない運用です。受取金額を確認してください。</div>':''}</div><div class="stickyActions"><button id="backType" class="secondary">戻る</button><button id="saveBtn" class="primary">${normal?(state.online?'注文書を送信':'端末保存（送信待ち）'):now?'会計・お渡し完了で登録':'受付を登録'}</button></div>${now?'<div class="underActions"><button id="savePending" class="secondary">未完了として登録</button></div>':''}`;
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
  document.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{remember();d.pickupDate=dateOffset(Number(button.dataset.day));renderDraft()});
  $('backType').onclick=()=>{remember();d.stage='type';renderDraft()};
  $('saveBtn').onclick=async()=>{
    remember();if(now){d.paid=true;d.delivered=true;d.prepared=PREP.READY}
    const errors=validate(d);if(errors.length)return showError(errors[0]);$('saveBtn').disabled=true;
    try{const order=await saveNew(d,{submitNormal:normal});state.draft={...order,stage:'success'};renderDraft()}
    catch(error){console.error(error);showError('保存できませんでした。もう一度お試しください。');$('saveBtn').disabled=false}
  };
  if($('savePending'))$('savePending').onclick=async()=>{
    remember();const errors=validate(d);if(errors.length)return showError(errors[0]);$('savePending').disabled=true;
    try{const order=await saveNew(d);state.draft={...order,stage:'success'};renderDraft()}
    catch(error){console.error(error);showError('保存できませんでした。もう一度お試しください。');$('savePending').disabled=false}
  };
}
function renderSuccess(d){
  const normal=d.type===ORDER_TYPE.NORMAL,sent=normal&&d.submitted&&d.submissionState==='sent';
  $('stepLabel').textContent=sent?'送信完了':'保存完了';$('sheetTitle').textContent=sent?'注文書送信完了':'登録完了';
  const heading=sent?'注文書を送信しました':normal?'送信待ちで保存しました':isDone(d)?'対応完了':'注文を登録しました';
  const message=normal?(sent?(d.submittedAt?`送信日時 ${new Date(d.submittedAt).toLocaleString('ja-JP')}`:'注文書は送信済みです。'):state.online?'送信できませんでした。内容を確認して再送してください。':'オンラインログイン後に自動再送します。'):(d.receiptNo?`受付番号 ${esc(d.receiptNo)}`:needsReceipt(d)?'受付番号は通信復旧後に確定します。':'受付番号は不要です。');
  $('sheetBody').innerHTML=`<div class="success"><div class="successMark ${normal&&!sent?'pending':''}">${normal&&!sent?'!':'✓'}</div><h3>${heading}</h3><p>${message}</p><div class="summary"><div class="summaryRow"><span>店舗</span><b>${esc(d.store)}</b></div><div class="summaryRow"><span>区分</span><b>${esc(labelOrder(d))}</b></div>${normal?`<div class="summaryRow"><span>注文書</span><b class="${sent?'statusSent':'statusPending'}">${sent?'送信済み':'送信待ち'}</b></div>`:''}${d.receiptNo?`<div class="summaryRow"><span>受付番号</span><b>${esc(d.receiptNo)}</b></div>`:''}<div class="summaryRow"><span>合計</span><b>${yen(totalOf(d))}</b></div></div></div><div class="stickyActions ${normal&&!sent?'':'one'}"><button id="backDash" class="${normal&&!sent?'secondary':'primary'}">管理画面へ戻る</button>${normal&&!sent?'<button id="retrySend" class="primary">注文書を再送</button>':''}</div>`;
  $('backDash').onclick=()=>{closeSheet();state.tab=groupOf(d);render()};
  if($('retrySend'))$('retrySend').onclick=async()=>{const order=state.orders.find(item=>item.localId===d.localId);if(!order)return;$('retrySend').disabled=true;await sendNormalOrder(order);state.draft={...order,stage:'success'};renderDraft()};
}

function showDetail(id){
  const order=state.orders.find(item=>item.localId===id);if(!order)return;openSheet('注文詳細','');
  const submissionRow=order.type===ORDER_TYPE.NORMAL?`<div class="summaryRow"><span>注文書</span><b class="${order.submitted?'statusSent':'statusPending'}">${order.submitted?'送信済み':'未送信'}</b></div>${order.submittedAt?`<div class="summaryRow"><span>送信日時</span><b>${new Date(order.submittedAt).toLocaleString('ja-JP')}</b></div>`:''}`:'';
  $('sheetBody').innerHTML=`<div class="step"><div class="section"><div class="summaryRow"><span>店舗</span><b>${esc(order.store)}</b></div><div class="summaryRow"><span>区分</span><b>${esc(labelOrder(order))}</b></div><div class="summaryRow"><span>電話</span><b>${esc(order.phone)}</b></div>${order.customer?`<div class="summaryRow"><span>お客様</span><b>${esc(order.customer)}</b></div>`:''}${order.account?`<div class="summaryRow"><span>帳合先</span><b>${esc(order.account)}</b></div>`:''}${order.staff?`<div class="summaryRow"><span>担当</span><b>${esc(order.staff)}</b></div>`:''}${order.receiptNo?`<div class="summaryRow"><span>受付番号</span><b>${esc(order.receiptNo)}</b></div>`:''}${submissionRow}${order.type===ORDER_TYPE.SPOT?`<div class="summaryRow"><span>会計</span><b>${order.paid?'会計済み':'未会計'}・${order.paymentMethod===PAYMENT.CASH?'現金':'クレジット'}</b></div>`:''}<div class="summaryRow"><span>受け渡し</span><b>${esc(handoffLabel(order))}</b></div>${order.notes?`<div class="summaryRow"><span>備考</span><b class="multiline">${esc(order.notes)}</b></div>`:''}</div><div class="section"><div class="sectionTitle">商品</div>${order.items.map(item=>`<div class="summaryRow"><span>${esc(item.code)} ${esc(item.name)} × ${item.qty}</span><b>${yen(item.price*item.qty)}</b></div>`).join('')}<div class="summaryRow total"><span>合計</span><b>${yen(totalOf(order))}</b></div></div><button id="printBtn" class="secondary fullButton">PDF保存・印刷</button><button id="deleteBtn" class="dangerBtn fullButton">削除</button></div><div class="stickyActions one"><button id="detailClose" class="primary">閉じる</button></div>`;
  $('detailClose').onclick=closeSheet;$('printBtn').onclick=()=>printOrder(order);
  $('deleteBtn').onclick=async()=>{
    if(!confirm('この注文を削除しますか？'))return;$('deleteBtn').disabled=true;
    if(!order.remoteId){state.orders=state.orders.filter(item=>item!==order);localSave()}
    else{order.deleted=true;await updateOrder(order,'deleted')}
    closeSheet();render();
  };
}
function showSubmit(order){
  openSheet('注文書送信','国内通常注文');
  const hint=state.online?'内容を確認し、注文書を受注チャンネルへ送信します。送信成功後に「完了」へ移動します。':'現在は端末モードです。オンラインログイン後に送信してください。';
  $('sheetBody').innerHTML=`<div class="step"><div class="hintBox ${state.online?'':'warnHint'}">${hint}</div><div class="section topGap"><div class="summaryRow"><span>店舗</span><b>${esc(order.store)}</b></div><div class="summaryRow"><span>電話</span><b>${esc(order.phone)}</b></div><div class="summaryRow"><span>帳合先</span><b>${esc(order.account)}</b></div><div class="summaryRow"><span>担当</span><b>${esc(order.staff)}</b></div>${order.items.map(item=>`<div class="summaryRow"><span>${esc(item.code)} ${esc(item.name)} × ${item.qty}</span><b>${yen(item.price*item.qty)}</b></div>`).join('')}<div class="summaryRow total"><span>合計</span><b>${yen(totalOf(order))}</b></div></div><button id="previewPrint" class="secondary fullButton">PDF保存・印刷</button></div><div class="stickyActions"><button id="submitCancel" class="secondary">戻る</button><button id="submitOrder" class="primary">${order.submissionState==='pending'?'注文書を再送':'注文書を送信'}</button></div>`;
  $('previewPrint').onclick=()=>printOrder(order);$('submitCancel').onclick=closeSheet;
  $('submitOrder').onclick=async()=>{
    clearError();$('submitOrder').disabled=true;const sent=await sendNormalOrder(order);
    if(sent){closeSheet();state.tab='done';render()}
    else{showError(state.online?'注文書を送信できませんでした。通信と送信先設定を確認して再送してください。':'オンラインログインが必要です。');$('submitOrder').disabled=false}
  };
}
function printOrder(order){
  const orderNumber=order.serverOrderNo||order.receiptNo||order.localId;
  $('printArea').innerHTML=`<div class="printSheet"><div class="printTitle"><div><h2>展示会 注文書</h2><small>${esc(cfg.eventName||'展示会')}</small></div><div class="printNo"><b>注文番号</b><br>${esc(orderNumber)}</div></div><div class="printMeta"><div><b>店舗名</b><br>${esc(order.store)}</div><div><b>電話番号</b><br>${esc(order.phone)}</div><div><b>帳合先</b><br>${esc(order.account||'-')}</div><div><b>受注担当</b><br>${esc(order.staff||state.staff?.display_name||'-')}</div>${order.customer?`<div><b>お客様名</b><br>${esc(order.customer)}</div>`:''}<div><b>作成日時</b><br>${new Date(order.createdAt||Date.now()).toLocaleString('ja-JP')}</div></div><table class="printItems"><thead><tr><th>品番・商品</th><th>数量</th><th>単価</th><th>金額</th></tr></thead><tbody>${order.items.map(item=>`<tr><td>${esc(item.code)} ${esc(item.name)}</td><td>${item.qty}</td><td>${yen(item.price)}</td><td>${yen(item.price*item.qty)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="3">合計</th><th>${yen(totalOf(order))}</th></tr></tfoot></table>${order.notes?`<div class="printNotes"><b>備考</b><br>${esc(order.notes)}</div>`:''}<div class="printFoot">出力日時 ${new Date().toLocaleString('ja-JP')}${order.submittedAt?` ／ 送信日時 ${new Date(order.submittedAt).toLocaleString('ja-JP')}`:''}</div></div>`;
  window.print();
}

function showFilter(){openSheet('絞り込み','');$('sheetBody').innerHTML=`<div class="step"><div class="choiceGrid"><button class="choice" data-f="today"><b>今日受取</b></button><button class="choice" data-f="future"><b>明日以降</b></button><button class="choice" data-f="unpaid"><b>未会計</b></button><button class="choice" data-f=""><b>すべて</b></button></div></div>`;document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.f;closeSheet();render()})}

async function bootOnline(){try{const saved=JSON.parse(localStorage.getItem(LS_SESSION)||'null');if(saved?.access_token){state.session=saved;await ensureFreshSession();await loadStaff();state.online=true;showApp();await onlineLoad();startPoll();return}showLogin()}catch(error){console.warn(error);localStorage.removeItem(LS_SESSION);state.session=null;state.online=false;showLogin()}}
function showLogin(){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}
function showApp(){$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('eventName').textContent=cfg.eventName||'EXHIBITION';$('logoutBtn').classList.toggle('hidden',!state.online);setSync(state.online?'online':'',state.online?`オンライン・${state.staff?.display_name||'スタッフ'}`:`端末モード・商品${state.products.length.toLocaleString('ja-JP')}件`);render()}
function startPoll(){clearInterval(state.poll);state.poll=setInterval(()=>onlineLoad(),Math.max(5,Number(cfg.pollSeconds||8))*1000)}
async function login(){const email=$('loginEmail').value.trim(),password=$('loginPassword').value;if(!email||!password)return $('loginMsg').textContent='メールとパスワードを入力してください。';$('loginMsg').textContent='';$('loginBtn').disabled=true;try{await signIn(email,password);await loadStaff();state.online=true;showApp();await onlineLoad();startPoll()}catch(error){console.error(error);state.online=false;$('loginMsg').textContent='ログインできませんでした。アカウントまたは通信を確認してください。'}finally{$('loginBtn').disabled=false}}
function demo(){state.demo=true;state.online=false;state.orders=localLoad();showApp();setSync('','端末モード・オンライン未接続')}
function logout(){localStorage.removeItem(LS_SESSION);state.session=null;state.staff=null;state.online=false;clearInterval(state.poll);showLogin()}

$('loginBtn').onclick=login;$('loginPassword').onkeydown=event=>{if(event.key==='Enter')login()};$('demoBtn').onclick=demo;$('logoutBtn').onclick=logout;$('refreshBtn').onclick=()=>state.online?onlineLoad():render();$('newOrderBtn').onclick=startOrder;$('closeSheet').onclick=closeSheet;$('sheet').onclick=event=>{if(event.target===$('sheet'))closeSheet()};$('filterBtn').onclick=showFilter;$('orderSearch').oninput=renderOrders;$('tabs').onclick=event=>{const button=event.target.closest('[data-tab]');if(!button)return;state.tab=button.dataset.tab;state.filter='';render()};document.querySelectorAll('.metric').forEach(button=>button.onclick=()=>{state.filter=button.dataset.filter;state.tab=button.dataset.filter==='unpaid'?'active':'waiting';render()});

await loadProducts();state.orders=localLoad();if(cfg.onlineEnabled)await bootOnline();else demo();
