import {emptySalesFilters,salesOptions,summarizeSales,salesOrderValue,salesProductKey} from './sales-model.js?v=20261009-sales1';
import {isUnconfirmed,pickupNumberLabel,groupOf,ORDER_STATUS} from './workflow.js?v=20261009-events1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=value=>`¥${Math.round(value).toLocaleString('ja-JP')}`;
const number=value=>value.toLocaleString('ja-JP');
const dateTime=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'日時未登録':date.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});};
export function createSalesUi(){return {filters:emptySalesFilters(),view:'products',history:'confirmed',limit:20,filtersOpen:false,trendOpen:false,openOrders:new Set()};}
const options=(values,value,label)=>`<option value="">${label}</option>${value&&!values.some(entry=>(typeof entry==='string'?entry:entry.code)===value)?`<option value="${esc(value)}" selected>${esc(value)}（該当なし）</option>`:''}${values.map(entry=>{const key=typeof entry==='string'?entry:entry.code;return `<option value="${esc(key)}" ${key===value?'selected':''}>${esc(typeof entry==='string'?entry:`No.${entry.code} ${entry.name}`)}</option>`;}).join('')}`;
export function salesDashboardHtml(orders,ui){
  const f=ui.filters,s=summarizeSales(orders,f),choices=salesOptions(orders);
  const conditions=[['region',f.region==='domestic'?'区分：国内':f.region==='overseas'?'区分：海外':''],['account',f.account?`卸屋：${f.account}`:''],['staff',f.staff?`担当：${f.staff}`:''],['product',f.product?`商品：No.${f.product}`:''],['dates',f.from||f.to?`期間：${f.from||'開始日なし'} ～ ${f.to||'終了日なし'}`:''],['search',f.search?`検索：${f.search}`:'']].filter(([,label])=>label);
  const metric=(label,value)=>`<div><small>${label}</small><b>${value}</b></div>`;
  return `<div class="salesHeading"><h2>売上の状況</h2><p id="salesSyncStatus" class="reportMuted" role="status"></p></div>
    <div class="salesRegion" role="group" aria-label="国内・海外で絞り込み">${[['','すべて'],['domestic','国内'],['overseas','海外']].map(([value,label])=>`<button type="button" data-sales-region="${value}" aria-pressed="${f.region===value}">${label}</button>`).join('')}</div>
    <label class="salesProductLabel" for="salesProduct">商品を選んで購入店舗を確認<select id="salesProduct">${options(choices.products,f.product,'すべての商品')}</select></label>
    ${f.product?'<button type="button" id="salesClearProduct" class="salesClearProduct" data-sales-clear="product">× 商品選択を解除</button>':''}
    ${conditions.length?`<div class="salesApplied"><div class="salesAppliedHeading"><strong>絞り込み中</strong><button type="button" id="salesReset" data-sales-reset>すべての絞り込みを解除</button></div><div class="salesFilterChips">${conditions.map(([key,label])=>`<button type="button" data-sales-clear="${key}" aria-label="${esc(label)}の絞り込みを解除"><span>${esc(label)}</span><b>× 解除</b></button>`).join('')}</div></div>`:''}
    <details id="salesFilters" class="salesFilters" ${ui.filtersOpen?'open':''}><summary>卸屋・担当者・期間で絞り込み</summary><div class="salesFilterGrid">
      <label for="salesAccount">卸屋・帳合先<select id="salesAccount">${options(choices.accounts,f.account,'すべての卸屋')}</select></label>
      <label for="salesStaff">担当者<select id="salesStaff">${options(choices.staff,f.staff,'すべての担当者')}</select></label>
      <label for="salesFrom">注文日（開始）<input id="salesFrom" type="date" value="${esc(f.from)}"></label><label for="salesTo">注文日（終了）<input id="salesTo" type="date" value="${esc(f.to)}"></label>
      <label class="salesSearchLabel" for="salesSearch">店舗名・お客様名・商品・番号で検索<input id="salesSearch" type="search" autocomplete="off" placeholder="店舗名や商品番号など" value="${esc(f.search)}"></label>
      <div class="salesDateActions"><button type="button" id="salesToday">今日</button><button type="button" id="salesAllDates">全期間</button></div>
    </div></details>
    ${f.from&&f.to&&f.from>f.to?'<p class="errorText" role="alert">開始日を終了日以前にしてください。</p>':''}
    <div class="reportTotal"><small>${f.product?'選択商品の売上（税抜・送料除く）':'売上（税抜・送料含む）'}${conditions.length?'・絞り込み中':''}</small><strong id="salesAmount">${yen(s.total)}</strong><span>確定済み注文のみ集計</span></div>
    <div class="reportMetrics salesMetrics">${metric('注文件数',`${number(s.count)}件`)}${metric('販売数量',`${number(s.quantity)}点`)}${metric('国内売上',yen(s.domestic))}${metric('海外売上',yen(s.overseas))}${metric('購入店舗（店舗名・卸屋別）',`${number(s.stores.filter(store=>store.name!=='未登録').length)}店`)}${metric(f.product?'1注文あたりの商品売上':'平均注文額',yen(s.average))}</div>
    <div class="salesOperations"><span>確定済みの対応状況</span>${Object.entries(ORDER_STATUS).map(([key,label])=>`<b>${label} ${s.status[key]}件</b>`).join('')}<button type="button" id="salesPending">未確定 ${s.pending}件<span>売上に含みません</span></button></div>
    <details id="salesTrend" class="salesTrend" ${ui.trendOpen?'open':''}><summary>日別の売上を見る</summary><p class="reportMuted">注文日（日本時間）別・注文がある最新14日。上の絞り込みを反映します。</p>${s.days.length?s.days.slice(-14).map(day=>`<div class="salesDay"><span>${esc(day.date)}</span><div><i style="width:${Math.max(0,day.amount/Math.max(1,...s.days.map(entry=>entry.amount))*100)}%"></i><b>${yen(day.amount)}</b></div><small>${day.count}件</small></div>`).join(''):'<p class="salesEmpty">確定済み注文はありません</p>'}</details>
    <div class="salesViews" role="group" aria-label="売上の詳細表示">${[['products','商品実績'],['stores','購入店舗'],['accounts','卸屋別'],['staff','担当者別'],['orders','注文履歴']].map(([id,label])=>`<button type="button" data-sales-view="${id}" aria-pressed="${ui.view===id}">${label}</button>`).join('')}</div>
    <section id="salesDetail" tabindex="-1">${conditions.length?`<div class="salesDetailFilters">${f.product?'<button type="button" data-sales-clear="product" class="salesClearProduct">← 商品選択を解除して商品実績へ</button>':''}<button type="button" data-sales-reset>すべて解除して元に戻る</button></div>`:''}${detailHtml(s,ui)}</section>
    <p class="reportMuted salesDefinitions">金額は税抜。送料は全体売上に含み、商品実績・商品を選択した売上には含みません。商品実績は数量順です。注文日を基準に集計し、削除した注文は除きます。</p>`;
}
function detailHtml(s,ui){
  if(ui.view==='products')return `<h3>商品別販売実績（税抜）</h3><p class="reportMuted">商品を押すと、購入店舗ごとの数量・売上が分かります。</p><table class="reportTable salesProductTable"><thead><tr><th>商品</th><th>数量</th><th>売上</th></tr></thead><tbody>${s.products.map(product=>`<tr><td><button type="button" data-sales-product="${esc(product.code)}">No.${esc(product.code)}<small>${esc(product.name)}</small></button></td><td>${number(product.quantity)}</td><td>${yen(product.amount)}</td></tr>`).join('')||'<tr><td colspan="3">確定済み注文はありません</td></tr>'}</tbody></table>`;
  if(ui.view==='stores')return `<h3>${ui.filters.product?`No.${esc(ui.filters.product)}の購入店舗`:'購入店舗別の実績'}</h3><p class="reportMuted">店舗名・国内／海外・卸屋の組み合わせで集計します。${s.missingStores?`店舗名未登録の注文は${s.missingStores}件あり、店数には含みません。`:''}</p><div class="salesRows">${s.stores.map(store=>`<article class="salesRow"><div><h4>${esc(store.name)}</h4><small>${store.region==='overseas'?'海外':'国内'} ／ ${esc(store.account)}</small></div><div class="salesRowNumbers"><b>${yen(store.amount)}</b><span>${number(store.quantity)}点 ／ ${store.count}件</span></div></article>`).join('')||'<p class="salesEmpty">該当する購入店舗はありません</p>'}</div>`;
  if(ui.view==='accounts'||ui.view==='staff'){
    const staff=ui.view==='staff',list=staff?s.staff:s.accounts;
    return `<h3>${staff?'担当者別の実績':'卸屋・帳合先別の実績'}</h3><p class="reportMuted">名前を押すと、その${staff?'担当者':'卸屋'}の注文履歴へ進みます。</p><div class="salesRows">${list.map(entry=>`<button type="button" class="salesRow" data-sales-group="${staff?'staff':'account'}" data-sales-name="${esc(entry.name)}"><div><h4>${esc(entry.name)}</h4><small>注文履歴を見る →</small></div><div class="salesRowNumbers"><b>${yen(entry.amount)}</b><span>${number(entry.quantity)}点 ／ ${entry.count}件</span></div></button>`).join('')||'<p class="salesEmpty">確定済み注文はありません</p>'}</div>`;
  }
  const history=s.matched.filter(order=>ui.history==='all'||(ui.history==='draft'?isUnconfirmed(order):!isUnconfirmed(order))).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(b.localId||'').localeCompare(String(a.localId||'')));
  return `<h3>注文履歴 <small>${history.length}件</small></h3><div class="salesHistoryStatus" role="group" aria-label="注文の確定状態">${[['confirmed','確定済み'],['draft','未確定'],['all','すべて']].map(([id,label])=>`<button type="button" data-sales-history="${id}" aria-pressed="${ui.history===id}">${label}</button>`).join('')}</div><p class="reportMuted">新しい注文から表示。各注文を開くと商品明細を確認できます。</p><div class="salesRows">${history.slice(0,ui.limit).map(order=>{
    const value=salesOrderValue(order,ui.filters.product),id=order.localId||order.id;
    return `<details class="salesOrder" data-sales-order="${esc(id)}" ${ui.openOrders.has(id)?'open':''}><summary><div><h4>${esc(order.store||'店舗名未登録')}</h4><small>${esc(dateTime(order.createdAt))} ／ ${esc(order.staff||'担当者未登録')}</small><span>${esc(order.account||'卸屋未登録')} ／ ${order.customerRegion==='overseas'?'海外':'国内'} ／ ${isUnconfirmed(order)?'未確定':esc(ORDER_STATUS[groupOf(order)])}</span></div><div class="salesRowNumbers"><b>${yen(value.amount)}</b><span>${number(value.quantity)}点${ui.filters.product?'（選択商品）':''}</span></div></summary><div class="salesOrderBody"><p>お客様：${esc(order.customer||'未登録')} ／ 注文番号：${esc(order.receiptNo||id||'未登録')}${pickupNumberLabel(order)?` ／ お渡し番号：${esc(pickupNumberLabel(order))}`:''}</p>${isUnconfirmed(order)?'<p class="reportMuted">この注文は未確定です。売上集計に含みません。</p>':''}<table class="reportTable"><thead><tr><th>商品</th><th>数量</th><th>売上（税抜）</th></tr></thead><tbody>${value.items.map(item=>`<tr><td>No.${esc(salesProductKey(item))}<small>${esc(item.name)}</small></td><td>${number(Number(item.qty||0))}</td><td>${yen(Number(item.qty||0)*Number(item.price||0))}</td></tr>`).join('')}</tbody></table>${!ui.filters.product?'<p class="reportMuted">注文金額には送料を含みます。上の商品明細は送料を除きます。</p>':''}</div></details>`;
  }).join('')||'<p class="salesEmpty">条件に合う注文はありません</p>'}</div>${history.length>ui.limit?`<button type="button" id="salesMore" class="secondary salesMore">次の20件を表示（${ui.limit} / ${history.length}件）</button>`:''}`;
}
export function bindSalesDashboard(panel,ui,draw){
  const change=(key,value)=>{ui.filters[key]=value;ui.limit=20;draw();};
  for(const [id,key] of [['salesProduct','product'],['salesAccount','account'],['salesStaff','staff'],['salesFrom','from'],['salesTo','to'],['salesSearch','search']]){
    const input=panel.querySelector(`#${id}`);input.addEventListener(key==='search'?'input':'change',()=>{if(key==='product')ui.view=input.value?'stores':'products';change(key,input.value);});
  }
  panel.querySelectorAll('[data-sales-region]').forEach(button=>button.onclick=()=>change('region',button.dataset.salesRegion));
  panel.querySelectorAll('[data-sales-view]').forEach(button=>button.onclick=()=>{ui.view=button.dataset.salesView;draw();});
  panel.querySelectorAll('[data-sales-product]').forEach(button=>button.onclick=()=>{ui.view='stores';change('product',button.dataset.salesProduct);panel.querySelector('#salesDetail').scrollIntoView({block:'start'});});
  panel.querySelectorAll('[data-sales-group]').forEach(button=>button.onclick=()=>{ui.view='orders';ui.history='confirmed';change(button.dataset.salesGroup,button.dataset.salesName);});
  panel.querySelectorAll('[data-sales-history]').forEach(button=>button.onclick=()=>{ui.history=button.dataset.salesHistory;ui.limit=20;draw();});
  panel.querySelector('#salesPending').onclick=()=>{ui.view='orders';ui.history='draft';ui.limit=20;draw();panel.querySelector('#salesDetail').scrollIntoView({block:'start'});};
  panel.querySelector('#salesToday').onclick=()=>{const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date());ui.filters.from=today;change('to',today);};
  panel.querySelector('#salesAllDates').onclick=()=>{ui.filters.from='';change('to','');};
  const returnToDetail=()=>{const detail=panel.querySelector('#salesDetail');detail.focus({preventScroll:true});detail.scrollIntoView({block:'start'});};
  panel.querySelectorAll('[data-sales-reset]').forEach(button=>button.onclick=()=>{const fromDetail=Boolean(button.closest('#salesDetail'));ui.filters=emptySalesFilters();ui.view='products';ui.history='confirmed';ui.limit=20;draw();if(fromDetail)returnToDetail();});
  panel.querySelectorAll('[data-sales-clear]').forEach(button=>button.onclick=()=>{
    const key=button.dataset.salesClear,fromDetail=Boolean(button.closest('#salesDetail'));
    if(key==='dates'){ui.filters.from='';ui.filters.to='';}
    else{ui.filters[key]='';if(key==='product')ui.view='products';}
    ui.limit=20;draw();if(fromDetail)returnToDetail();
  });
  for(const [id,key] of [['salesFilters','filtersOpen'],['salesTrend','trendOpen']]){const details=panel.querySelector(`#${id}`);details.addEventListener('toggle',()=>{if(details.isConnected)ui[key]=details.open;});}
  panel.querySelectorAll('[data-sales-order]').forEach(details=>details.addEventListener('toggle',()=>{if(!details.isConnected)return;const id=details.dataset.salesOrder;if(details.open)ui.openOrders.add(id);else ui.openOrders.delete(id);}));
  const more=panel.querySelector('#salesMore');if(more)more.onclick=()=>{ui.limit+=20;draw();};
}
