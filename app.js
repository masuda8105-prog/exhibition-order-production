import {ORDER_TYPE,HANDOFF,PAYMENT,PREP,needsHeadOfficeShare,needsReceipt,totalOf,itemCountOf,phoneHasUnexpectedCharacters,createdDateInTokyo,filterOrdersByCreatedDate,orderMatchesOperationalFilter,orderMatchesSearch,batchSummary,customerNameWithHonorific,receiptInternalInfo,validate,isDone,groupOf,nextAction,labelOrder,compareOrdersForPrint,handoffLabel,normalizeForSave,applyAction} from './workflow.js?v=20260901-secure1';
import {SESSION_STORAGE_KEY,LEGACY_LOCAL_STORAGE_KEYS,wipeOrderData,orderMemoryId,purgePrintedOrderData} from './security.js?v=20260901-secure1';

const cfg=window.EXHIBITION_CONFIG||{};
const $=id=>document.getElementById(id);
const LS_STAFF='exhibitionOps.staff.v2',LS_KEYPAD_ALIGN='exhibitionOps.keypadAlign.v1';
const state={online:false,session:null,staff:null,orders:[],products:[],accounts:[],tab:'active',filter:'',draft:null,rememberDraftInput:null,counter:0,signalsBound:false};
const yen=n=>Number.isFinite(Number(n))?`¥${Math.round(Number(n)).toLocaleString('ja-JP')}`:'価格未定';
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const isoDate=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(d);
const today=()=>isoDate(new Date());
const dateOffset=n=>{const d=new Date();d.setDate(d.getDate()+n);return isoDate(d)};
const newUuid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now().toString(16).padStart(8,'0')}-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12,'0').slice(0,12)}`;

function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2600)}
function setSync(mode,text){$('syncDot').className=`syncDot${mode?` ${mode}`:''}`;$('syncText').textContent=text}
function purgeLegacyLocalData(){for(const key of LEGACY_LOCAL_STORAGE_KEYS){try{localStorage.removeItem(key)}catch{}}}
function temporaryReceipt(){state.counter+=1;return `一時-${String(state.counter).padStart(3,'0')}`}

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
function sbHeaders(auth=true){const headers={apikey:String(cfg.publishableKey||''),'Content-Type':'application/json'};if(auth&&state.session?.access_token)headers.Authorization=`Bearer ${state.session.access_token}`;return headers}
function saveSession(session){session.expires_at=Math.floor(Date.now()/1000)+Number(session.expires_in||3600);state.session=session;sessionStorage.setItem(SESSION_STORAGE_KEY,JSON.stringify(session));return session}
async function signIn(email,password){return saveSession(await fetchJson(`${sbBase()}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:cfg.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})}))}
async function refreshSession(){
  if(!state.session?.refresh_token)throw new Error('SESSION_EXPIRED');
  return saveSession(await fetchJson(`${sbBase()}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:cfg.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:state.session.refresh_token})}));
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
  const [products,accounts]=await Promise.all([
    loadAllRows('products','id,product_no,product_name,wholesale_price,image_url,is_active','display_order.asc,id.asc'),
    loadAllRows('exhibition_accounts','id,account_name,display_order,is_active','display_order.asc,id.asc'),
  ]);
  state.products=products.map(row=>({productId:`product-${row.id}`,code:String(row.product_no||''),name:String(row.product_name||''),price:row.wholesale_price===null?NaN:Number(row.wholesale_price),imageUrl:row.image_url||'',status:row.is_active?'active':'price_pending',orderable:Boolean(row.is_active)&&Number(row.wholesale_price)>0})).filter(product=>product.code&&product.name);
  state.accounts=accounts.filter(row=>row.is_active).map(row=>String(row.account_name||'')).filter(Boolean);
  if(!state.products.length)throw new Error('PRODUCT_MASTER_EMPTY');
}

async function saveNew(order){
  const saved=normalizeForSave({...order,syncState:'memory'});
  if(needsReceipt(saved))saved.receiptNo=temporaryReceipt();
  state.orders.unshift(saved);render();return saved;
}
async function saveEdited(draft){
  const current=state.orders.find(order=>order.localId===draft.editingId);
  if(!current)throw new Error('EDIT_TARGET_NOT_FOUND');
  const updated=normalizeForSave({...current,...draft,localId:current.localId,createdAt:current.createdAt,clientSubmissionId:current.clientSubmissionId||draft.clientSubmissionId||newUuid(),syncState:'memory'});
  delete updated.stage;delete updated.editingId;
  Object.assign(current,updated);
  await updateOrder(current,'edited');
  return current;
}
async function updateOrder(order,event='status_update'){
  order.updatedAt=new Date().toISOString();
  order.syncState='memory';render();return order;
}

function render(){renderMetrics();renderOrders()}
function currentSearch(){return $('orderSearch').value.trim()}
function filteredOrders(){const q=currentSearch(),all=state.orders.filter(order=>!order.deleted);return all.filter(order=>(state.filter||q)||groupOf(order)===state.tab).filter(order=>orderMatchesOperationalFilter(order,state.filter)).filter(order=>orderMatchesSearch(order,q))}
function clearListModes(){state.filter='';$('orderSearch').value=''}
function revealOrder(order){clearListModes();state.tab=groupOf(order);render()}
function formatDateTime(value,short=false){const date=new Date(value||'');if(Number.isNaN(date.getTime()))return '日時不明';return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:short?undefined:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(date)}
function renderMetrics(){const all=state.orders.filter(order=>!order.deleted),q=currentSearch();$('metricUnshared').textContent=all.filter(order=>orderMatchesOperationalFilter(order,'unshared')).length;$('metricPickup').textContent=all.filter(order=>orderMatchesOperationalFilter(order,'pickup')).length;$('metricUnpaid').textContent=all.filter(order=>orderMatchesOperationalFilter(order,'unpaid')).length;['active','waiting','done'].forEach(k=>{$(`count${k[0].toUpperCase()+k.slice(1)}`).textContent=all.filter(order=>groupOf(order)===k).length});document.querySelectorAll('#tabs button').forEach(button=>button.classList.toggle('active',!state.filter&&!q&&button.dataset.tab===state.tab));const banner=$('activeFilter');if(state.filter||q){const label=state.filter&&q?'検索・絞り込み結果':q?'検索結果':'絞り込み結果',condition=state.filter?`：${{unshared:'本社未共有',pickup:'受取待ち',unpaid:'未会計'}[state.filter]}`:'';banner.classList.remove('hidden');banner.innerHTML=`<b>${label}${condition}</b>（全フォルダ） <button id="clearFilter">解除</button>`;$('clearFilter').onclick=()=>{clearListModes();render()}}else banner.classList.add('hidden')}
function renderOrders(){const list=filteredOrders(),wrap=$('orders');if(!list.length){const allFolders=Boolean(state.filter||currentSearch());wrap.innerHTML=`<div class="empty">該当する注文はありません。<br><small>${allFolders?'要対応・受取待ち・完了の全フォルダを確認しました。':'別のフォルダも確認してください。'}</small></div>`;return}wrap.innerHTML=list.map(cardHtml).join('');wrap.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>handleCardAction(b.dataset.id,b.dataset.action));wrap.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>showDetail(b.dataset.detail))}
function cardHtml(order){
  const action=nextAction(order);
  const payment=order.type===ORDER_TYPE.SPOT&&[HANDOFF.NOW,HANDOFF.LATER].includes(order.handoff)?(order.paid?'<span class="chip ok">会計済み</span>':'<span class="chip warn">会計待ち</span>'):'';
  const sharing=needsHeadOfficeShare(order)?(order.headOfficeShared?'<span class="chip ok">本社共有済み</span>':'<span class="chip danger">本社未共有</span>'):'';
  const status=`<span class="chip folder">${{active:'要対応',waiting:'受取待ち',done:'完了'}[groupOf(order)]}</span>`,detail=['done','detail'].includes(action.key)?'':`<button class="linkBtn detailLink" data-detail="${esc(order.localId)}">詳細</button>`;
  return `<article class="orderCard ${!order.headOfficeShared&&needsHeadOfficeShare(order)?'needsShare':''}"><div class="orderTop"><div>${order.receiptNo?`<div class="receiptNo">${esc(order.receiptNo)}</div>`:''}<div class="store">${esc(order.store)}</div></div><div class="amount">${yen(totalOf(order))}</div></div><div class="chips"><span class="chip">${esc(labelOrder(order))}</span>${status}${payment}${sharing}</div><div class="cardNote">${esc(handoffLabel(order))}${order.customer?` ／ ${esc(order.customer)}`:''}</div><div class="receivedAt">受付 ${esc(formatDateTime(order.createdAt||order.created_at,true))}</div><button class="cardAction ${action.key==='done'?'soft':action.key==='share'?'shareAction':''}" data-action="${action.key}" data-id="${esc(order.localId)}">${esc(action.label)}</button>${detail}</article>`;
}
async function handleCardAction(id,action){const order=state.orders.find(item=>item.localId===id);if(!order)return;if(action==='done'||action==='detail')return showDetail(id);if(action==='share')return showShareConfirm(order);if(action==='deliver')return showDeliveryConfirm(order)}

function showShareConfirm(order){
  openSheet('本社共有の確認',labelOrder(order));
  const destination=order.handoff===HANDOFF.LATER?'共有後、この注文は「受取待ち」へ移動します。':'共有後、この注文は「完了」へ移動します。以後の配送対応は本社へ引き継ぎます。';
  $('sheetBody').innerHTML=`<div class="step"><div class="shareConfirm"><div class="shareIcon">本社</div><h3>本社へ共有しましたか？</h3><p>注文書をPDF保存・印刷すると、この注文はアプリのメモリから消去されます。作成したPDFまたは印刷物を本社へ共有してください。</p></div><button id="sharePrint" class="secondary fullButton sharePrintButton">PDF・印刷してデータを消去</button><div class="hintBox topGap">${esc(destination)} すでに別の方法で共有済みの場合だけ、印刷せずに下の「本社共有済み」を押してください。</div><div class="section topGap"><div class="summaryRow"><span>店舗</span><b>${esc(order.store)}</b></div><div class="summaryRow"><span>お客様</span><b>${esc(order.customer)}</b></div><div class="summaryRow"><span>受け渡し</span><b>${esc(handoffLabel(order))}</b></div></div></div><div class="stickyActions"><button id="shareCancel" class="secondary">まだ共有していない</button><button id="shareDone" class="primary">印刷せず本社共有済み</button></div>`;
  $('sharePrint').onclick=()=>printOrder(order);$('shareCancel').onclick=closeSheet;$('shareDone').onclick=async()=>{$('shareDone').disabled=true;Object.assign(order,applyAction(order,'share'));await updateOrder(order,'head_office_shared');closeSheet();revealOrder(order);toast(order.handoff===HANDOFF.LATER?'受取待ちへ移動しました':'本社対応として完了しました')};
}

function showDeliveryConfirm(order){
  openSheet('お渡し完了の確認','受取待ち');
  $('sheetBody').innerHTML=`<div class="step"><div class="shareConfirm"><div class="successMark">✓</div><h3>会計と商品のお渡しは完了しましたか？</h3><p>完了にすると「完了」フォルダへ移動します。</p></div><div class="section topGap"><div class="summaryRow"><span>受付番号</span><b>${esc(order.receiptNo||'-')}</b></div><div class="summaryRow"><span>お客様</span><b>${esc(order.customer)}</b></div><div class="summaryRow"><span>受取予定</span><b>${esc(order.pickupDate||'-')}</b></div></div></div><div class="stickyActions"><button id="deliveryCancel" class="secondary">戻る</button><button id="deliveryDone" class="primary">会計・お渡し完了</button></div>`;
  $('deliveryCancel').onclick=closeSheet;$('deliveryDone').onclick=async()=>{$('deliveryDone').disabled=true;Object.assign(order,applyAction(order,'deliver'));await updateOrder(order,'delivered');closeSheet();revealOrder(order);toast('完了へ移動しました')};
}

function openSheet(title,step=''){state.rememberDraftInput=null;$('sheetTitle').textContent=title;$('stepLabel').textContent=step;$('sheet').classList.remove('hidden');document.body.style.overflow='hidden';clearError()}
function hasResumableDraft(){return Boolean(state.draft&&state.draft.stage!=='success'&&!state.draft.editingId)}
function updateNewOrderButton(){const resumable=hasResumableDraft();$('newOrderBtn').textContent=resumable?'↩ 入力途中の注文を再開':'＋ 新しい注文';$('discardDraftBtn').classList.toggle('hidden',!resumable)}
function closeSheet(){state.rememberDraftInput?.();state.rememberDraftInput=null;$('sheet').classList.add('hidden');$('sheet').classList.remove('productFullscreen');document.body.style.overflow='';updateNewOrderButton()}
function showError(msg){$('sheetError').textContent=msg;$('sheetError').classList.remove('hidden');$('sheetPanel')?.scrollTo({top:0,behavior:'smooth'})}
function clearError(){$('sheetError').classList.add('hidden');$('sheetError').textContent=''}
function savedKeypadAlign(){try{return localStorage.getItem(LS_KEYPAD_ALIGN)==='left'?'left':'right'}catch{return'right'}}
function freshDraft(){return{stage:'products',productQuery:'',keypadMode:'number',keypadAlign:savedKeypadAlign(),type:null,handoff:null,customerRegion:'domestic',items:[],store:'',phone:'',customer:'',account:'',accountChoice:'',accountOther:'',staff:state.staff?.display_name||'',paymentMethod:PAYMENT.CREDIT,paid:false,delivered:false,shipped:false,prepared:PREP.NONE,headOfficeShared:false,headOfficeSharedAt:'',pickupDate:dateOffset(1),notes:'',clientSubmissionId:newUuid()}}
function startOrder(){const resume=hasResumableDraft();if(!resume)state.draft=freshDraft();openSheet('新しい注文','1 / 3');renderDraft();if(resume)toast('入力途中の注文を再開しました')}
function showDiscardDraftConfirm(){if(!hasResumableDraft())return startOrder();state.rememberDraftInput?.();const d=state.draft,count=itemCountOf(d),store=String(d.store||'').trim();openSheet('入力途中の注文を破棄','確認');$('sheetBody').innerHTML=`<div class="step"><div class="shareConfirm"><div class="successMark pending">!</div><h3>入力途中の内容を破棄しますか？</h3><p>破棄を確定した場合だけ新しい注文へ切り替わります。</p></div><div class="section"><div class="summaryRow"><span>追加済み商品</span><b>${count}点</b></div>${store?`<div class="summaryRow"><span>入力済み店舗</span><b>${esc(store)}</b></div>`:''}</div></div><div class="stickyActions"><button id="discardCancel" class="secondary">キャンセル</button><button id="discardConfirm" class="dangerBtn">破棄して新規開始</button></div>`;$('discardCancel').onclick=renderDraft;$('discardConfirm').onclick=()=>{state.draft=null;startOrder();toast('入力途中の注文を破棄しました')}}
function startEditOrder(order){if(!(state.draft?.editingId===order.localId&&state.draft.stage!=='success'))state.draft={...order,productQuery:'',keypadMode:'number',keypadAlign:savedKeypadAlign(),items:(order.items||[]).map(item=>({...item,lineId:item.lineId||newUuid()})),stage:'products',editingId:order.localId};openSheet('注文を修正','1 / 3');renderDraft()}
function renderDraft(){state.rememberDraftInput=null;clearError();if(!state.draft)return;const d=state.draft;$('sheet').classList.toggle('productFullscreen',d.stage==='products');if(d.stage==='products')renderProductStep(d);else if(d.stage==='type')renderTypeStep(d);else if(d.stage==='info')renderInfoStep(d);else if(d.stage==='success')renderSuccess(d)}
function renderProductStep(d){const align=d.keypadAlign==='left'?'left':'right';$('stepLabel').textContent=`1 / 3　${d.editingId?'修正':'商品'}`;$('sheetTitle').textContent=d.editingId?'注文を修正':'商品を追加';$('sheetBody').innerHTML=`<div class="step productStep"><div class="productSearch"><div class="productSearchRow"><input id="productQ" type="search" inputmode="search" placeholder="品番・商品名" autocomplete="off"><button id="clearPQ" class="secondary" aria-label="検索をクリア">×</button></div><div id="productKeypadDock" class="productKeypadDock align-${align}"><div class="keypadTitle"><div class="keypadTitleMain"><b>固定入力キー</b><span id="keypadModeLabel" class="keypadModeLabel">数字・記号</span></div><div class="keypadAlignSwitch" aria-label="キーボードの位置"><button id="keypadAlignLeft" type="button" aria-label="キーボードを左寄せにする">◀ 左</button><button id="keypadAlignRight" type="button" aria-label="キーボードを右寄せにする">右 ▶</button></div></div><div id="productKeypad" class="productKeypad numberKeys"></div></div><div id="productResults" class="productResults" role="listbox"></div></div><div class="section productCartSection"><div class="sectionTitle">注文明細 <span id="cartCount">${d.items.reduce((s,i)=>s+i.qty,0)}点</span></div><div id="cartLines" class="cart"></div></div></div><div class="stickyActions one"><button id="toType" class="primary" ${d.items.length?'':'disabled'}>注文内容へ進む</button></div>`;const q=$('productQ');q.value=d.productQuery||'';q.oninput=()=>renderProductResults(d,q.value);$('clearPQ').onclick=()=>{q.value='';renderProductResults(d,'')};bindProductKeypad(d,q);$('toType').onclick=()=>{if(!d.items.length)return showError('商品を1点以上追加してください。');d.stage='type';renderDraft()};renderCart(d);renderProductResults(d,q.value)}
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
  wrap.innerHTML=d.items.map(item=>`<div class="cartLine"><div><b>${esc(item.code)} ${esc(item.name)}</b><small>${yen(item.price)} × ${item.qty}</small></div><div class="qty"><button data-minus="${esc(item.lineId)}" aria-label="数量を減らす">−</button><b>${item.qty}</b><button data-plus="${esc(item.lineId)}" aria-label="数量を増やす">＋</button></div></div>`).join('')+`<div class="totalRow"><span>合計</span><span>${yen(totalOf(d))}</span></div>`;
  wrap.querySelectorAll('[data-plus]').forEach(button=>button.onclick=()=>{const item=d.items.find(value=>value.lineId===button.dataset.plus);if(item)item.qty++;renderCart(d)});
  wrap.querySelectorAll('[data-minus]').forEach(button=>button.onclick=()=>{const item=d.items.find(value=>value.lineId===button.dataset.minus);if(!item)return;item.qty--;if(item.qty<=0)d.items=d.items.filter(value=>value!==item);renderCart(d)});
}
function renderTypeStep(d){const canContinue=Boolean(d.type&&(d.type!==ORDER_TYPE.SPOT||d.handoff));$('stepLabel').textContent='2 / 3　注文方法';$('sheetTitle').textContent='どの対応ですか？';$('sheetBody').innerHTML=`<div class="step"><p class="stepIntro">実際の対応に一番近いものを選んでください。</p><div class="choiceGrid"><button class="choice ${d.type===ORDER_TYPE.NORMAL?'on':''}" data-type="normal"><b>国内通常注文</b><small>卸屋・電話番号を入力して受注完了。帰社後にまとめて印刷します。</small></button><button class="choice ${d.type===ORDER_TYPE.SPOT?'on':''}" data-type="spot"><b>現売り対応</b><small>会場での会計・受け渡し、後日受取、配送です。</small></button></div>${d.type===ORDER_TYPE.SPOT?`<div class="section topGap"><div class="sectionTitle">商品の渡し方 *</div><div class="choiceGrid handoffChoices"><button class="choice ${d.handoff===HANDOFF.NOW?'on':''}" data-handoff="now"><b>1　在庫あり・その場渡し</b><small>会計して、その場で商品をお渡しします。</small></button><button class="choice ${d.handoff===HANDOFF.LATER?'on':''}" data-handoff="later"><b>2　翌日・翌々日に受取</b><small>本社共有が必要。共有後は「受取待ち」で管理します。</small></button><button class="choice ${d.handoff===HANDOFF.HOTEL?'on':''}" data-handoff="hotel"><b>3　ホテルへ配送</b><small>本社共有が必要。共有済みになれば対応完了です。</small></button><button class="choice ${d.handoff===HANDOFF.SHIP?'on':''}" data-handoff="ship"><b>4　指定住所へ配送</b><small>本社共有が必要。共有済みになれば対応完了です。</small></button></div></div>`:''}</div><div class="stickyActions"><button id="backProducts" class="secondary">戻る</button><button id="toInfo" class="primary" ${canContinue?'':'disabled'}>入力へ進む</button></div>`;document.querySelectorAll('[data-type]').forEach(button=>button.onclick=()=>{const previous=d.type;d.type=button.dataset.type;if(d.type===ORDER_TYPE.SPOT&&previous!==ORDER_TYPE.SPOT)d.handoff=null;if(d.type===ORDER_TYPE.NORMAL){d.handoff=null;d.headOfficeShared=false}renderDraft()});document.querySelectorAll('[data-handoff]').forEach(button=>button.onclick=()=>{d.handoff=button.dataset.handoff;if(d.handoff===HANDOFF.NOW){d.headOfficeShared=false;d.headOfficeSharedAt=''}renderDraft()});$('backProducts').onclick=()=>{d.stage='products';renderDraft()};$('toInfo').onclick=()=>{if(!d.type)return showError('注文方法を選択してください。');if(d.type===ORDER_TYPE.SPOT&&!d.handoff)return showError('商品の渡し方を選択してください。');d.stage='info';renderDraft()}}
function renderInfoStep(d){
  const normal=d.type===ORDER_TYPE.NORMAL,now=d.handoff===HANDOFF.NOW;
  $('stepLabel').textContent='3 / 3　入力・確認';$('sheetTitle').textContent=d.editingId?'注文を修正':normal?'通常注文を受ける':'現売りを登録';
  const accounts=state.accounts,staffNames=[state.staff?.display_name].filter(Boolean);
  const accountChoice=d.accountChoice||(d.account?(accounts.includes(d.account)?d.account:'その他'):''),accountOther=d.accountOther||(accountChoice==='その他'&&d.account!=='その他'?d.account:'');d.accountChoice=accountChoice;d.accountOther=accountOther;
  const accountOptions=accounts.map(value=>`<option value="${esc(value)}" ${accountChoice===value?'selected':''}>${esc(value)}</option>`).join('');
  const staffOptions=staffNames.map(value=>`<option value="${esc(value)}" ${d.staff===value?'selected':''}>${esc(value)}</option>`).join('');
  const normalFields=`<div class="field"><label for="fAccount">卸屋・帳合先 *</label><select id="fAccount"><option value="">選択してください</option>${accountOptions}</select></div>${accountChoice==='その他'?`<div class="field"><label for="fAccountOther">卸屋・帳合先名 *</label><input id="fAccountOther" value="${esc(accountOther)}" placeholder="具体名を入力"></div>`:''}<div class="field"><label for="fStaff">受注担当者 *</label><select id="fStaff"><option value="">選択してください</option>${staffOptions}</select></div><div class="field"><label for="fCustomer">お客様名（任意）</label><input id="fCustomer" value="${esc(d.customer)}"></div>`;
  const paymentFields=!now?`<div class="field"><label>会計状況</label><div class="seg"><button type="button" id="payDone" class="${d.paid?'on':''}">会計済み</button><button type="button" id="payLater" class="${!d.paid?'on':''}">${d.handoff===HANDOFF.LATER?'受取時に会計':'本社対応'}</button></div></div>`:'';
  const pickupFields=d.handoff===HANDOFF.LATER?`<div class="field"><label for="fPickup">受取予定日 *</label><div class="quickDates"><button type="button" data-day="1" class="${d.pickupDate===dateOffset(1)?'on':''}">明日</button><button type="button" data-day="2" class="${d.pickupDate===dateOffset(2)?'on':''}">明後日</button></div><input id="fPickup" type="date" min="${dateOffset(1)}" value="${esc(d.pickupDate)}"></div>`:'';
  const destinationFields=d.handoff===HANDOFF.HOTEL?`<div class="field"><label for="fHotel">ホテル名 *</label><input id="fHotel" value="${esc(d.hotelName||'')}"></div><div class="two"><div class="field"><label for="fGuest">宿泊者名 *</label><input id="fGuest" value="${esc(d.guestName||d.customer||'')}"></div><div class="field"><label for="fRoom">部屋番号（任意）</label><input id="fRoom" value="${esc(d.roomNo||'')}"></div></div><div class="field"><label for="fCheckout">チェックアウト予定日</label><input id="fCheckout" type="date" value="${esc(d.checkoutDate||'')}"></div>`:d.handoff===HANDOFF.SHIP?`<div class="field"><label for="fShip">配送先住所 *</label><textarea id="fShip">${esc(d.shipAddress||'')}</textarea></div>`:'';
  const shareFields=needsHeadOfficeShare(d)?`<div class="shareStatus ${d.headOfficeShared?'shared':'pending'}"><div><b>本社への共有 *</b><small>内容入力後、先に注文書を印刷・PDF保存して本社へ共有してください。共有し終わったら「本社共有済み」を押します。</small></div><button type="button" id="sharePrintDraft" class="secondary sharePrintButton">印刷・PDFで本社へ共有</button><div class="seg"><button type="button" id="sharePendingChoice" class="${!d.headOfficeShared?'on':''}">まだ共有していない</button><button type="button" id="shareDoneChoice" class="${d.headOfficeShared?'on':''}">本社共有済み</button></div></div>`:'';
  const spotFields=`<div class="field"><label for="fCustomer">お客様名 *</label><input id="fCustomer" value="${esc(d.customer)}"></div><div class="two"><div class="field"><label for="fRegion">お客様</label><select id="fRegion"><option value="domestic" ${d.customerRegion==='domestic'?'selected':''}>国内</option><option value="overseas" ${d.customerRegion==='overseas'?'selected':''}>海外</option></select></div><div class="field"><label for="fPayment">会計方法 *</label><select id="fPayment"><option value="credit" ${d.paymentMethod===PAYMENT.CREDIT?'selected':''}>クレジット</option><option value="cash" ${d.paymentMethod===PAYMENT.CASH?'selected':''}>現金</option></select></div></div>${paymentFields}${pickupFields}${destinationFields}${shareFields}`;
  const operationHint=normal?'<div class="hintBox sendHint"><b>登録すると受注完了です。</b><br>帰社後に「印刷・PDF」から国内通常注文をまとめて印刷してください。</div>':needsHeadOfficeShare(d)?`<div class="hintBox ${d.headOfficeShared?'sendHint':'warnHint'}">${d.headOfficeShared?(d.handoff===HANDOFF.LATER?'登録後は「受取待ち」へ入ります。':'本社へ引き継ぎ済みとして「完了」へ入ります。'):'登録後は「要対応」に入り、本社未共有が赤く表示されます。'}</div>`:'<div class="hintBox sendHint">会計と商品のお渡しが済んだ状態で登録し、そのまま完了になります。</div>';
  const saveLabel=d.editingId?'修正内容を保存':normal?'受注完了で登録':now?'会計・お渡し完了で登録':d.headOfficeShared?(d.handoff===HANDOFF.LATER?'共有済みで受取待ちに登録':'共有済みで完了登録'):'本社未共有で要対応に登録';
  $('sheetBody').innerHTML=`<div class="step"><div class="section"><div class="field"><label for="fStore">店舗名 *</label><input id="fStore" value="${esc(d.store)}" placeholder="〇〇眼鏡店"></div><div class="field"><label for="fPhone">電話番号 *</label><input id="fPhone" inputmode="tel" autocomplete="tel" value="${esc(d.phone)}"><div id="phoneWarning" class="fieldWarning ${phoneHasUnexpectedCharacters(d.phone)?'':'hidden'}">数字、+、-、空白、括弧以外が含まれています。入力内容を確認してください。</div></div>${normal?normalFields:spotFields}<div class="field"><label for="fNotes">備考（任意）</label><textarea id="fNotes" placeholder="納期・連絡事項など">${esc(d.notes||'')}</textarea></div></div><div class="section"><div class="sectionTitle">注文確認</div>${d.items.map(item=>`<div class="summaryRow"><span>${esc(item.code)} ${esc(item.name)} × ${item.qty}</span><b>${yen(item.price*item.qty)}</b></div>`).join('')}<div class="summaryRow"><span>合計</span><b>${yen(totalOf(d))}</b></div></div>${operationHint}${d.paymentMethod===PAYMENT.CASH?'<div class="hintBox topGap">現金は釣銭を用意しない運用です。受取金額を確認してください。</div>':''}</div><div class="stickyActions"><button id="backType" class="secondary">戻る</button><button id="saveBtn" class="primary">${saveLabel}</button></div>`;
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
  if($('payDone'))$('payDone').onclick=()=>{remember();d.paid=true;renderDraft()};
  if($('payLater'))$('payLater').onclick=()=>{remember();d.paid=false;renderDraft()};
  if($('shareDoneChoice'))$('shareDoneChoice').onclick=()=>{remember();d.headOfficeShared=true;d.headOfficeSharedAt=new Date().toISOString();renderDraft()};
  if($('sharePendingChoice'))$('sharePendingChoice').onclick=()=>{remember();d.headOfficeShared=false;d.headOfficeSharedAt='';renderDraft()};
  if($('sharePrintDraft'))$('sharePrintDraft').onclick=()=>{remember();const errors=validate(d);if(errors.length)return showError(errors[0]);printOrder({...d,createdAt:d.createdAt||new Date().toISOString(),localId:d.localId||'登録前'})};
  document.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{remember();d.pickupDate=dateOffset(Number(button.dataset.day));renderDraft()});
  $('backType').onclick=()=>{remember();d.stage='type';renderDraft()};
  $('saveBtn').onclick=async()=>{
    remember();if(now){d.paid=true;d.delivered=true;d.prepared=PREP.READY}
    const errors=validate(d);if(errors.length)return showError(errors[0]);$('saveBtn').disabled=true;
    try{const order=d.editingId?await saveEdited(d):await saveNew(d);if(d.editingId){state.draft=null;closeSheet();revealOrder(order);toast('修正内容をこのタブのメモリへ反映しました')}else{state.draft={...order,stage:'success'};renderDraft()}}
    catch(error){console.error(error);showError('保存できませんでした。もう一度お試しください。');$('saveBtn').disabled=false}
  };
}
function renderSuccess(d){
  const normal=d.type===ORDER_TYPE.NORMAL,group=groupOf(d);
  $('stepLabel').textContent='登録完了';$('sheetTitle').textContent=normal?'受注完了':'現売り登録完了';
  $('sheetBody').innerHTML=`<div class="success"><div class="successMark">✓</div><h3>このタブのメモリに一時保持しました</h3><p>クラウドや端末には保存していません。PDF保存・印刷の画面を閉じると、この注文の顧客情報と明細を自動消去します。</p><div class="summary"><div class="summaryRow"><span>店舗</span><b>${esc(d.store)}</b></div><div class="summaryRow"><span>区分</span><b>${esc(labelOrder(d))}</b></div>${needsHeadOfficeShare(d)?`<div class="summaryRow"><span>本社共有</span><b class="${d.headOfficeShared?'statusSent':'statusPending'}">${d.headOfficeShared?'共有済み':'未共有'}</b></div>`:''}${d.receiptNo?`<div class="summaryRow"><span>一時番号</span><b>${esc(receiptOrderNumber(d))}</b></div>`:''}<div class="summaryRow"><span>一時フォルダ</span><b>${{active:'要対応',waiting:'受取待ち',done:'完了'}[group]}</b></div><div class="summaryRow"><span>合計</span><b>${yen(totalOf(d))}</b></div></div></div><div class="stickyActions"><button id="successCustomerCopy" class="secondary">お客様控えを印刷</button><button id="successPrint" class="primary">注文書をPDF・印刷</button></div><div class="underActions"><button id="backDash" class="linkBtn">管理画面へ戻る</button><button id="continueOrder" class="linkBtn">続けて新しい注文</button></div>`;
  $('backDash').onclick=()=>{closeSheet();revealOrder(d)};$('successPrint').onclick=()=>printOrder(d);$('successCustomerCopy').onclick=()=>printCustomerCopy(d);$('continueOrder').onclick=()=>{state.draft=null;closeSheet();startOrder()};
}

function showDetail(id){
  const order=state.orders.find(item=>item.localId===id);if(!order)return;openSheet('注文詳細','');
  const sharingRow=needsHeadOfficeShare(order)?`<div class="summaryRow"><span>本社共有</span><b class="${order.headOfficeShared?'statusSent':'statusPending'}">${order.headOfficeShared?'共有済み':'未共有'}</b></div>${order.headOfficeSharedAt?`<div class="summaryRow"><span>共有確認日時</span><b>${new Date(order.headOfficeSharedAt).toLocaleString('ja-JP')}</b></div>`:''}`:'';
  $('sheetBody').innerHTML=`<div class="step"><div class="section"><div class="summaryRow"><span>店舗</span><b>${esc(order.store)}</b></div><div class="summaryRow"><span>区分</span><b>${esc(labelOrder(order))}</b></div><div class="summaryRow"><span>電話</span><b>${esc(order.phone)}</b></div>${order.customer?`<div class="summaryRow"><span>お客様</span><b>${esc(order.customer)}</b></div>`:''}${order.account?`<div class="summaryRow"><span>卸屋・帳合先</span><b>${esc(order.account)}</b></div>`:''}${order.staff?`<div class="summaryRow"><span>担当</span><b>${esc(order.staff)}</b></div>`:''}${order.receiptNo?`<div class="summaryRow"><span>一時番号</span><b>${esc(order.receiptNo)}</b></div>`:''}${sharingRow}${order.type===ORDER_TYPE.SPOT?`<div class="summaryRow"><span>会計</span><b>${order.paid?'会計済み':'未会計'}・${order.paymentMethod===PAYMENT.CASH?'現金':'クレジット'}</b></div>`:''}<div class="summaryRow"><span>受け渡し</span><b>${esc(handoffLabel(order))}</b></div><div class="summaryRow"><span>現在</span><b>${{active:'要対応',waiting:'受取待ち',done:'完了'}[groupOf(order)]}</b></div><div class="summaryRow"><span>作成日時</span><b>${esc(formatDateTime(order.createdAt||order.created_at))}</b></div><div class="summaryRow"><span>最終更新日時</span><b>${esc(formatDateTime(order.updatedAt||order.updated_at||order.createdAt||order.created_at))}</b></div>${order.notes?`<div class="summaryRow"><span>備考</span><b class="multiline">${esc(order.notes)}</b></div>`:''}</div><div class="section"><div class="sectionTitle">商品</div>${order.items.map(item=>`<div class="summaryRow"><span>${esc(item.code)} ${esc(item.name)} × ${item.qty}</span><b>${yen(item.price*item.qty)}</b></div>`).join('')}<div class="summaryRow total"><span>合計</span><b>${yen(totalOf(order))}</b></div></div><div class="hintBox">PDF保存・印刷の画面を閉じると、この注文はメモリから消去されます。</div><button id="editOrderBtn" class="primary fullButton">この注文を修正</button><button id="customerCopyBtn" class="secondary fullButton">お客様控えをPDF保存・印刷</button><button id="printBtn" class="secondary fullButton">この注文をPDF保存・印刷</button><button id="deleteBtn" class="dangerBtn fullButton">削除</button></div><div class="stickyActions one"><button id="detailClose" class="primary">閉じる</button></div>`;
  $('detailClose').onclick=closeSheet;$('editOrderBtn').onclick=()=>startEditOrder(order);$('customerCopyBtn').onclick=()=>printCustomerCopy(order);$('printBtn').onclick=()=>printOrder(order);
  $('deleteBtn').onclick=async()=>{
    if(!confirm('この注文を削除しますか？'))return;$('deleteBtn').disabled=true;
    wipeOrderData(order);state.orders=state.orders.filter(item=>item!==order);
    closeSheet();render();
  };
}
function printOrder(order){
  printOrders([order],'展示会 注文書',false);
}
function printCustomerCopy(order){printOrders([order],'お客様控え',false,{customerCopy:true})}
function receiptOrderNumber(order){return order.receiptNo||order.orderNo||order.localId||'登録前'}
function receiptDocumentHtml(order,{customerCopy=false}={}){
  const orderNumber=receiptOrderNumber(order),status={active:'要対応',waiting:'受取待ち',done:'完了'}[groupOf(order)];
  const itemCount=(order.items||[]).reduce((sum,item)=>sum+Number(item.qty||0),0);
  const customerName=customerCopy?customerNameWithHonorific(order.customer):order.customer||'-';
  const internalInfo=receiptInternalInfo(order,{customerCopy});
  const info=[['店舗名',order.store],['電話番号',order.phone],['お客様名',customerName],['注文区分',labelOrder(order)]];if(!customerCopy)info.push(['卸屋・帳合先',order.account||'-'],['担当',order.staff||state.staff?.display_name||'-']);if(internalInfo.showHandoff)info.push(['受け渡し',handoffLabel(order)]);if(internalInfo.showStatus)info.push(['状態',status]);
  const createdAtHtml=internalInfo.showCreatedAt?`<br><b>作成日時</b> ${new Date(order.createdAt||Date.now()).toLocaleString('ja-JP')}`:'';
  const infoHtml=info.map(([label,value])=>`<div class="receiptInfoCard"><div class="receiptInfoLabel">${esc(label)}</div><div class="receiptInfoValue">${esc(value||'-')}</div></div>`).join('');
  const itemsHtml=(order.items||[]).map(item=>`<tr><td><b>${esc(item.code)}</b></td><td>${esc(item.name)}</td><td class="num">${item.qty}</td><td class="num">${yen(item.price)}</td><td class="num"><b>${yen(item.price*item.qty)}</b></td></tr>`).join('');
  const notesHtml=`${!customerCopy&&order.notes?`<div class="receiptNote"><b>備考</b>${esc(order.notes).replace(/\n/g,'<br>')}</div>`:''}${internalInfo.showGuide?'<div class="receiptNote"><b>ご案内</b>内容を確認し、必要に応じて印刷またはPDF保存してください。</div>':''}${internalInfo.headOfficeShare?`<div class="receiptNote"><b>本社共有</b>${esc(internalInfo.headOfficeShare)}</div>`:''}`;
  return `<div class="receiptHeaderSimple"><div class="receiptBrandBlock"><img class="receiptBrandLogo" src="assets/sun_nishimura_logo.jpg" alt="株式会社サンニシムラ"><div><div class="receiptBrandName">株式会社サンニシムラ</div><div class="receiptBrandSub">SAN NISHIMURA CO., LTD.${customerCopy?'':`<br>${esc(cfg.eventName||'展示会')}`}</div></div></div><div class="receiptDocMeta"><div class="receiptDocTitle">${customerCopy?'お客様控え':'展示会 注文書'}</div><div class="receiptDocSub">Exhibition Order Receipt</div><div class="receiptMetaLine"><b>注文番号</b> ${esc(orderNumber)}${createdAtHtml}</div></div></div><div class="receiptInfoBand">${infoHtml}</div><div class="receiptSection"><div class="receiptSectionHead"><div class="receiptSectionTitle">注文明細</div><div class="receiptSectionHint">${itemCount}点</div></div><table class="receiptTable"><colgroup><col class="code"><col><col class="qty"><col class="unit"><col class="subtotal"></colgroup><thead><tr><th>品番</th><th>商品名</th><th class="num">数量</th><th class="num">単価</th><th class="num">金額</th></tr></thead><tbody>${itemsHtml}</tbody></table></div><div class="receiptFooterGrid"><div class="receiptMemoStack">${notesHtml}</div><div><div class="receiptSummaryBox"><div class="receiptSummaryRow"><span>点数</span><span>${itemCount}</span></div><div class="receiptSummaryRow total"><span>合計</span><span>${yen(totalOf(order))}</span></div></div><div class="receiptCurrencyNote">通貨：JPY</div></div></div><div class="receiptFooterMini"><span>株式会社サンニシムラ</span><span>${customerCopy?`注文番号 ${esc(orderNumber)}`:`${esc(cfg.eventName||'展示会')}・${esc(orderNumber)}`}</span></div>`;
}
function printSheetHtml(order,{customerCopy=false}={}){return `<article class="printSheet printPage receiptSheet">${receiptDocumentHtml(order,{customerCopy})}</article>`}
function purgePrintedOrders(list){
  const ids=new Set(list.map(orderMemoryId).filter(Boolean));
  state.orders=purgePrintedOrderData(state.orders,list);
  for(const order of list)wipeOrderData(order);
  if(state.draft&&ids.has(orderMemoryId(state.draft))){wipeOrderData(state.draft);state.draft=null}
  $('printArea').innerHTML='';closeSheet();render();updateNewOrderButton();toast('印刷対象の顧客情報と注文明細を消去しました');
}
function printOrders(orders,title,withCover=true,{targetLabel='全期間',customerCopy=false}={}){
  const list=orders.filter(order=>!order.deleted).sort(compareOrdersForPrint);
  if(!list.length)return toast('印刷する注文がありません');
  const totalQty=list.reduce((sum,order)=>sum+(order.items||[]).reduce((value,item)=>value+Number(item.qty||0),0),0),grandTotal=list.reduce((sum,order)=>sum+totalOf(order),0);
  const cover=withCover?`<section class="printBatchCover"><div class="eyebrow">${esc(cfg.eventName||'展示会')}</div><h1>${esc(title)}</h1><p><b>対象受付日 ${esc(targetLabel)}</b><br>出力日時 ${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'medium'}).format(new Date())}</p><div class="printStats"><div><small>注文数</small><b>${list.length}件</b></div><div><small>商品点数</small><b>${totalQty}点</b></div><div><small>合計</small><b>${yen(grandTotal)}</b></div></div><table class="batchTable"><thead><tr><th>No.</th><th>受付日時</th><th>区分</th><th>卸屋・帳合先</th><th>店舗・お客様</th><th>状態</th><th>合計</th></tr></thead><tbody>${list.map((order,index)=>`<tr><td>${index+1}</td><td>${esc(formatDateTime(order.createdAt||order.created_at,true))}</td><td>${esc(labelOrder(order))}</td><td>${esc(order.account||'-')}</td><td>${esc(order.store)}${order.customer?` / ${esc(order.customer)}`:''}</td><td>${{active:'要対応',waiting:'受取待ち',done:'完了'}[groupOf(order)]}</td><td>${yen(totalOf(order))}</td></tr>`).join('')}</tbody></table></section>`:'';
  $('printArea').innerHTML=`${cover}${list.map(order=>printSheetHtml(order,{customerCopy})).join('')}<div class="printFoot">出力日時 ${new Date().toLocaleString('ja-JP')}</div>`;
  window.print();
  purgePrintedOrders(list);
}
function showPrintMenu(){
  const orders=state.orders.filter(order=>!order.deleted),normal=orders.filter(order=>order.type===ORDER_TYPE.NORMAL);
  openSheet('提出・印刷','用途を選択');
  $('sheetBody').innerHTML=`<div class="step"><p class="stepIntro">用途を選んだ後、対象受付日と出力前の件数を確認します。印刷画面を閉じた注文はメモリから消去されます。</p><div class="printChoices"><button id="printNormalBatch" class="choice full ${normal.length?'':'disabled'}" ${normal.length?'':'disabled'}><b>国内通常注文をまとめて印刷</b><small>伝票打ちへ提出する注文書です。このタブ内 ${normal.length}件。</small></button><button id="printAllBatch" class="choice full ${orders.length?'':'disabled'}" ${orders.length?'':'disabled'}><b>展示会の全注文データをPDF・印刷</b><small>このタブ内の最終提出用です。${orders.length}件。</small></button></div></div><div class="stickyActions one"><button id="printMenuClose" class="secondary">閉じる</button></div>`;
  $('printMenuClose').onclick=closeSheet;if($('printNormalBatch'))$('printNormalBatch').onclick=()=>showPrintDateOptions('normal');if($('printAllBatch'))$('printAllBatch').onclick=()=>showPrintDateOptions('final');
}

function showPrintDateOptions(kind,mode='today',start=today(),end=today()){
  const all=state.orders.filter(order=>!order.deleted),base=kind==='normal'?all.filter(order=>order.type===ORDER_TYPE.NORMAL):all,list=filterOrdersByCreatedDate(base,{mode,today:today(),start,end}),summary=batchSummary(list),isFinal=kind==='final';
  const targetLabel=mode==='all'?'全期間':mode==='today'?today():start===end?start:`${start} ～ ${end}`;
  const unresolved=summary.unshared||summary.active||summary.waiting,needsAck=isFinal&&Boolean(unresolved),dateInvalid=mode==='range'&&(!start||!end||start>end);
  $('stepLabel').textContent=isFinal?'展示会最終提出':'通常注文の伝票打ち';$('sheetTitle').textContent='対象受付日と出力前確認';
  $('sheetBody').innerHTML=`<div class="step"><div class="dateModeChoices"><button data-date-mode="today" class="${mode==='today'?'on':''}">本日</button><button data-date-mode="range" class="${mode==='range'?'on':''}">日付を指定</button><button data-date-mode="all" class="${mode==='all'?'on':''}">全期間</button></div>${mode==='range'?`<div class="two topGap"><div class="field"><label for="printStart">開始日</label><input id="printStart" type="date" value="${esc(start)}"></div><div class="field"><label for="printEnd">終了日</label><input id="printEnd" type="date" value="${esc(end)}"></div></div>`:''}<div class="section topGap"><div class="sectionTitle">出力前確認</div><div class="summaryRow"><span>対象受付日</span><b>${esc(targetLabel)}</b></div><div class="summaryRow"><span>注文数</span><b>${summary.orders}件</b></div><div class="summaryRow"><span>商品点数</span><b>${summary.items}点</b></div><div class="summaryRow"><span>合計金額</span><b>${yen(summary.total)}</b></div><div class="summaryRow"><span>本社未共有</span><b class="${summary.unshared?'statusPending':''}">${summary.unshared}件</b></div><div class="summaryRow"><span>要対応</span><b class="${summary.active?'statusPending':''}">${summary.active}件</b></div><div class="summaryRow"><span>受取待ち</span><b class="${summary.waiting?'statusPending':''}">${summary.waiting}件</b></div><div class="summaryRow"><span>未会計</span><b class="${summary.unpaid?'statusPending':''}">${summary.unpaid}件</b></div></div>${dateInvalid?'<div class="blockingWarning">開始日と終了日を正しく指定してください。</div>':''}${unresolved?`<div class="strongWarning"><b>${isFinal?'未完了注文があります':'対象に未完了注文が含まれます'}</b><br>本社未共有・要対応・受取待ちを確認してください。</div>`:''}${needsAck?'<label class="warningAck"><input id="printWarningAck" type="checkbox"> 責任者と警告内容を確認し、この対象で出力する</label>':''}<div class="hintBox topGap">印刷画面を閉じると、対象注文の顧客情報と注文明細はメモリから消去されます。</div></div><div class="stickyActions"><button id="printDateBack" class="secondary">用途へ戻る</button><button id="executeBatchPrint" class="primary" ${(needsAck||dateInvalid||!summary.orders)?'disabled':''}>${isFinal?'最終提出をPDF・印刷':'通常注文をPDF・印刷'}</button></div>`;
  document.querySelectorAll('[data-date-mode]').forEach(button=>button.onclick=()=>showPrintDateOptions(kind,button.dataset.dateMode,start,end));
  if($('printStart'))$('printStart').onchange=()=>showPrintDateOptions(kind,'range',$('printStart').value,$('printEnd').value);
  if($('printEnd'))$('printEnd').onchange=()=>showPrintDateOptions(kind,'range',$('printStart').value,$('printEnd').value);
  if($('printWarningAck'))$('printWarningAck').onchange=()=>{$('executeBatchPrint').disabled=!$('printWarningAck').checked};
  $('printDateBack').onclick=showPrintMenu;$('executeBatchPrint').onclick=()=>printOrders(list,isFinal?'展示会 全注文データ':'国内通常注文 一括注文書',true,{targetLabel});
}

function showFilter(){openSheet('絞り込み','');$('sheetBody').innerHTML=`<div class="step"><div class="choiceGrid"><button class="choice" data-f="unshared"><b>本社未共有</b><small>Slackなどで本社共有が必要</small></button><button class="choice" data-f="pickup"><b>受取待ち</b><small>共有済み・お客様の来場待ち</small></button><button class="choice" data-f="unpaid"><b>未会計</b><small>現売りの会計確認</small></button><button class="choice" data-f=""><b>すべて</b></button></div></div>`;document.querySelectorAll('[data-f]').forEach(button=>button.onclick=()=>{state.filter=button.dataset.f;closeSheet();render()})}

async function bootOnline(){let saved=null;try{saved=JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)||'null')}catch{}if(!saved?.access_token){showLogin();bindConnectivitySignals();return}state.session=saved;try{await ensureFreshSession();await loadStaff();await loadPrivateReferenceData();state.online=true;showApp()}catch(error){console.warn(error);sessionStorage.removeItem(SESSION_STORAGE_KEY);state.session=null;state.online=false;showLogin();$('loginMsg').textContent=navigator.onLine?'ログイン情報を確認できませんでした。もう一度ログインしてください。':'再接続後、登録スタッフでログインしてください。'}bindConnectivitySignals()}
function showLogin(){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden');$('loginNetworkGuide').classList.toggle('hidden',navigator.onLine);$('loginBtn').disabled=!navigator.onLine}
function showApp(){$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('eventName').textContent=cfg.eventName||'EXHIBITION';$('logoutBtn').classList.remove('hidden');setSync(navigator.onLine?'online':'error',navigator.onLine?'認証済み・注文はこのタブのみ（保存なし）':'オフライン・表示中の商品と注文だけ利用可能');render();updateNewOrderButton()}
function bindConnectivitySignals(){if(state.signalsBound)return;state.signalsBound=true;window.addEventListener('online',()=>{if(state.online)setSync('online','認証済み・注文はこのタブのみ（保存なし）');else showLogin()});window.addEventListener('offline',()=>{if(state.online)setSync('error','オフライン・表示中の商品と注文だけ利用可能');else showLogin()})}
async function refreshPrivateData(){if(!state.online||!navigator.onLine)return toast('オンライン接続が必要です');$('refreshBtn').disabled=true;setSync('busy','商品データを再取得中…');try{await loadPrivateReferenceData();setSync('online','認証済み・注文はこのタブのみ（保存なし）');toast('商品データを更新しました')}catch(error){console.error(error);setSync('error','商品データの再取得に失敗しました');toast('商品データを更新できませんでした')}finally{$('refreshBtn').disabled=false}}
async function login(){const email=$('loginEmail').value.trim(),password=$('loginPassword').value;if(!navigator.onLine)return $('loginMsg').textContent='現在オフラインです。再接続してからログインしてください。';if(!email||!password)return $('loginMsg').textContent='メールとパスワードを入力してください。';$('loginMsg').textContent='';$('loginBtn').disabled=true;try{await signIn(email,password);await loadStaff();await loadPrivateReferenceData();state.online=true;showApp();bindConnectivitySignals()}catch(error){console.error(error);sessionStorage.removeItem(SESSION_STORAGE_KEY);state.session=null;state.online=false;$('loginMsg').textContent='ログインできませんでした。登録スタッフのアカウントまたは通信を確認してください。'}finally{$('loginPassword').value='';$('loginBtn').disabled=!navigator.onLine}}
function logout(){for(const order of state.orders)wipeOrderData(order);state.orders=[];if(state.draft)wipeOrderData(state.draft);state.draft=null;state.products=[];state.accounts=[];sessionStorage.removeItem(SESSION_STORAGE_KEY);localStorage.removeItem(LS_STAFF);state.session=null;state.staff=null;state.online=false;$('loginPassword').value='';closeSheet();showLogin()}

$('loginBtn').onclick=login;$('loginPassword').onkeydown=event=>{if(event.key==='Enter')login()};$('logoutBtn').onclick=logout;$('refreshBtn').onclick=refreshPrivateData;$('newOrderBtn').onclick=startOrder;$('discardDraftBtn').onclick=showDiscardDraftConfirm;$('closeSheet').onclick=closeSheet;$('sheet').onclick=event=>{if(event.target===$('sheet'))closeSheet()};$('filterBtn').onclick=showFilter;$('printMenuBtn').onclick=showPrintMenu;$('orderSearch').oninput=render;$('tabs').onclick=event=>{const button=event.target.closest('[data-tab]');if(!button)return;state.tab=button.dataset.tab;clearListModes();render()};document.querySelectorAll('.metric').forEach(button=>button.onclick=()=>{state.filter=button.dataset.filter;$('orderSearch').value='';render()});

purgeLegacyLocalData();if(location.hash.startsWith('#receipt='))history.replaceState(null,'',`${location.pathname}${location.search}`);await bootOnline();
