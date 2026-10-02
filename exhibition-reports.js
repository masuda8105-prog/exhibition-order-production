import {REPORT_CATEGORIES,summarizeExhibition,groupReports} from './report-model.js';
import {orderFromCloudRow} from './workflow.js';
import {preparePhoto,MAX_PHOTOS} from './order-attachments.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=value=>`¥${Math.round(value).toLocaleString('ja-JP')}`;
export function createExhibitionReports({state,cfg,request,toast,photoApi}){
  let tab='orders',events=[],selected='',reports=[],focus=[],orders=[],ready=false,error='',generation=0,busy=false;
  let draft={product:undefined,category:'',comment:'',id:crypto.randomUUID()};
  const exhibitionDrafts=new Map();
  const photoUrls=new Map();let suspendedDraft=null;
  const photos=()=>draft.photos||[];
  function releasePhotos(value){for(const photo of value?.photos||[])if(photo.url?.startsWith('blob:'))URL.revokeObjectURL(photo.url);}
  async function signPhotos(entries){
    const version=generation;
    const paths=[...new Set(entries.flatMap(entry=>entry.photo_paths||[]))];
    await Promise.all(paths.map(async path=>{if(photoUrls.get(path)?.expires>Date.now()+60000)return;const url=await photoApi.sign(path);if(version===generation)photoUrls.set(path,{url,expires:Date.now()+3500000});}));
  }
  function selectEvent(id){if(id===selected)return;exhibitionDrafts.set(selected,draft);selected=id;draft=exhibitionDrafts.get(id)||{product:undefined,category:'',comment:'',id:crypto.randomUUID()};}
  const app=document.getElementById('appView'),main=app.querySelector('main'),actions=app.querySelector('.newOrderActions');
  const nav=document.createElement('nav');nav.className='reportNav';nav.setAttribute('aria-label','アプリの画面');
  nav.innerHTML=['orders','sales','notes','reports'].map((id,i)=>`<button type="button" data-screen="${id}" aria-pressed="${i===0}">${['注文','売上','気づき','レポート'][i]}</button>`).join('');
  app.querySelector('.topbar').after(nav);
  const panel=document.createElement('section');panel.className='reportPanel hidden';nav.after(panel);
  nav.querySelectorAll('button').forEach(button=>button.onclick=async()=>{
    if(busy)return;tab=button.dataset.screen;show();
    if(tab!=='orders')await reload();
  });
  const currentEvent=()=>events.find(event=>event.id===selected);
  const currentOrders=()=>currentEvent()?.order_event_name===(cfg.eventName||'展示会')?state.orders:orders;
  async function all(table,filter='',order='created_at.asc,id.asc'){
    const rows=[];
    for(let offset=0;;offset+=500){const page=await request(`${table}?select=*&${filter}${filter?'&':''}order=${order}&limit=500&offset=${offset}`);rows.push(...page);if(page.length<500)return rows;}
  }
  async function reload(){
    if(busy)return;
    const version=++generation,user=state.session?.user?.id;
    ready=false;error='';draw();
    try{
      const loadedEvents=await all('exhibitions','','start_date.desc.nullslast,id.asc');
      if(version!==generation||state.session?.user?.id!==user)return;
      events=loadedEvents;
      if(!events.some(event=>event.id===selected))selected=events.find(event=>event.order_event_name===(cfg.eventName||'展示会'))?.id||events[0]?.id||'';
      if(!selected)throw new Error('NO_EVENTS');
      const event=currentEvent(),filter=`exhibition_id=eq.${encodeURIComponent(selected)}`;
      const [loadedReports,loadedFocus,loadedOrders]=await Promise.all([
        all('reports',`${filter}&deleted_at=is.null`),all('exhibition_products',filter,'display_order.asc,product_code.asc'),
        event.order_event_name===(cfg.eventName||'展示会')?Promise.resolve([]):all('exhibition_app_orders',`event_name=eq.${encodeURIComponent(event.order_event_name)}&deleted_at=is.null`),
      ]);
      if(version!==generation||state.session?.user?.id!==user)return;
      try{await signPhotos(loadedReports);}catch(e){toast('写真を読み込めませんでした。「同期」で再試行できます');}
      if(version!==generation||state.session?.user?.id!==user)return;
      reports=loadedReports;focus=loadedFocus;orders=loadedOrders.map(orderFromCloudRow);ready=true;
    }catch(e){if(version===generation)error=e.message==='NO_EVENTS'?'展示会が未登録です。管理者に登録を依頼してください。':'レポートを読み込めませんでした。接続とレポート機能の導入状況を確認してください。';}
    if(version===generation)draw();
  }
  function show(){
    main.classList.toggle('hidden',tab!=='orders');actions.classList.toggle('hidden',tab!=='orders');panel.classList.toggle('hidden',tab==='orders');
    nav.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.screen===tab)));
    app.querySelector('.orderOverview').classList.toggle('hidden',tab!=='orders');
    draw();
  }
  function selector(){return `<div class="reportEvent"><label for="reportEvent">展示会</label><select id="reportEvent" ${busy||draft.pendingPayload||draft.editingId?'disabled':''}>${events.map(event=>`<option value="${esc(event.id)}" ${event.id===selected?'selected':''}>${esc(event.name)}</option>`).join('')}</select><button id="reportReload" type="button" class="secondary" ${busy?'disabled':''}>↻ 同期</button></div>`;}
  function salesHtml(forReport=false){
    const summary=summarizeExhibition(currentOrders());
    return `${forReport?'':`<h2>${esc(currentEvent().name)}</h2>`}<div class="reportTotal"><small>売上（税抜・送料含む）</small><strong>${yen(summary.total)}</strong></div><div class="reportMetrics">${[['注文件数',`${summary.count}件`],['国内売上',yen(summary.domestic)],['海外売上',yen(summary.overseas)],['販売数量',`${summary.quantity}点`]].map(([label,value])=>`<div><small>${label}</small><b>${value}</b></div>`).join('')}</div>${forReport?'<h2>3. 商品別販売実績（税抜）</h2>':'<h3>商品別販売実績（税抜）</h3>'}<table class="reportTable"><thead><tr><th>商品</th><th>数量</th><th>売上</th></tr></thead><tbody>${summary.products.map(product=>`<tr><td>No.${esc(product.code)}<small>${esc(product.name)}</small></td><td>${product.quantity}</td><td>${yen(product.amount)}</td></tr>`).join('')||'<tr><td colspan="3">確定済み注文はありません</td></tr>'}</tbody></table>`;
  }
  function productLabel(code){const product=state.products.find(item=>item.code===code);return `No.${esc(code)}${product?` ${esc(product.name)}`:''}`;}
  function photoInputHtml(){return `<fieldset><legend>写真（任意・${MAX_PHOTOS}枚まで）</legend><div class="reportPhotoActions"><button type="button" id="notePhotoPick" class="secondary">写真を選ぶ</button><button type="button" id="notePhotoCamera" class="secondary">カメラで撮影</button></div><input id="notePhotoFiles" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden><input id="notePhotoCapture" type="file" accept="image/*" capture="environment" hidden><div class="reportPhotoGrid">${photos().map(photo=>`<div><img src="${esc(photo.url)}" alt="添付写真"><button type="button" data-remove-note-photo="${esc(photo.id)}">取り外す</button></div>`).join('')}</div><small>ブース全体・商品・展示方法など。写真だけでも登録できます。</small></fieldset>`;}
  function notesHtml(){return `<h2>${draft.editingId?'気づきを書き直す':'気づき入力'}</h2><p class="reportMuted">記入者：${esc(state.staff?.display_name)} ／ ${esc(currentEvent().name)}</p><form id="noteForm"><fieldset><legend>商品を選ぶ</legend><label class="reportSearchLabel" for="noteSearch">商品番号・商品名で検索</label><input id="noteSearch" type="search" placeholder="商品番号・商品名で検索" autocomplete="off"><div id="noteResults" class="reportChoices"></div><button type="button" data-note-product="" aria-pressed="${draft.product===null}">商品なし・会場全体</button><p id="noteSelected">${draft.product===undefined?'未選択':draft.product===null?'商品なし・会場全体':productLabel(draft.product)}</p></fieldset><fieldset><legend>カテゴリー</legend><div class="reportChoices">${REPORT_CATEGORIES.map(category=>`<button type="button" data-note-category="${category.id}" aria-pressed="${draft.category===category.id}">${category.short}</button>`).join('')}</div></fieldset><label for="noteComment">コメント</label><textarea id="noteComment" rows="4" maxlength="5000" placeholder="お客様の声・気づいたこと">${esc(draft.comment)}</textarea>${photoInputHtml()}<p id="noteError" class="errorText" role="alert"></p><button id="noteSave" type="submit" class="primary reportSave" ${busy?'disabled':''}>${busy?'保存中…':draft.editingId?'変更を保存する':'登録する'}</button>${draft.editingId?'<button id="noteEditCancel" type="button" class="secondary reportSave">編集をやめる</button>':''}</form>`;}
  function feedbackHtml(list){return REPORT_CATEGORIES.map(category=>{
    const entries=list.filter(entry=>entry.category===category.id);
    if(!entries.length)return '';
    return `<section class="reportFeedback"><h4>${category.title}</h4>${entries.map(entry=>`<div class="reportComment"><p>${esc(entry.comment)}</p><small>${esc(entry.author_name)}</small>${entry.user_id===state.session?.user?.id?`<div class="reportRecordActions"><button type="button" data-edit-report="${esc(entry.id)}">書き直す</button><button type="button" data-delete-report="${esc(entry.id)}">削除</button></div>`:''}</div>${(entry.photo_paths||[]).map(path=>{const url=photoUrls.get(path)?.url;return url?`<figure class="reportPhotoFigure"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" crossorigin="anonymous" alt="${esc(entry.product_code?`No.${entry.product_code}の写真`:'会場の写真')}"></a><figcaption>${esc(entry.author_name)}</figcaption></figure>`:'<p class="reportPhotoMissing">写真を読み込めませんでした。「同期」で再試行してください。</p>';}).join('')}`).join('')}</section>`;
  }).join('');}
  function reportHtml(){
    const event=currentEvent(),grouped=groupReports(reports);
    return `<article id="exhibitionReport"><h1>${esc(event.name)} 展示会レポート</h1><h2>1. 基本情報</h2><p>開催日：${esc(event.start_date||'未登録')} ～ ${esc(event.end_date||'未登録')}</p><p>会場：${esc(event.venue||'未登録')}</p><p>参加者：${esc((event.participants||[]).join('、')||'未登録')}</p><h2>2. 売上</h2>${salesHtml(true)}<h2>4. 商品別フィードバック</h2>${grouped.products.map(([code,list])=>`<section><h3>${productLabel(code)}</h3>${feedbackHtml(list)}</section>`).join('')||'<p>まだ気づきの登録はありません</p>'}<h2>5. 会場・運営</h2>${feedbackHtml(grouped.general.filter(item=>item.category==='venue'))||'<p>まだ気づきの登録はありません</p>'}<h2>6. その他気づき・次回課題</h2>${feedbackHtml(grouped.general.filter(item=>item.category!=='venue'))||'<p>まだ気づきの登録はありません</p>'}</article>`;
  }
  function adminHtml(){
    return `<details class="reportAdmin"><summary>展示会の管理</summary><form id="eventForm"><label>展示会ID<input name="id" pattern="[a-z0-9_]+" required value="${esc(selected)}" ${events.some(event=>event.id===selected)?'readonly':''}></label><label>展示会名<input name="name" required value="${esc(currentEvent().name)}"></label><label>注文の展示会名<input name="order_event_name" required value="${esc(currentEvent().order_event_name)}"></label><label>開始日<input name="start_date" type="date" value="${esc(currentEvent().start_date||'')}"></label><label>終了日<input name="end_date" type="date" value="${esc(currentEvent().end_date||'')}"></label><label>会場<input name="venue" value="${esc(currentEvent().venue||'')}"></label><label>参加者（カンマ区切り）<input name="participants" value="${esc((currentEvent().participants||[]).join(','))}"></label><p id="eventError" class="errorText"></p><button class="primary" ${busy?'disabled':''}>管理内容を保存</button><button type="button" id="newReportEvent" class="secondary">別の展示会を追加</button></form></details>`;
  }
  function draw(){
    if(tab==='orders')return;
    panel.innerHTML=selector()+(error?`<p class="errorText" role="alert">${esc(error)}</p>`:!ready?'<p>読み込み中…</p>':tab==='sales'?salesHtml():tab==='notes'?notesHtml():`<div class="reportExport"><button id="reportPdf" class="primary" ${busy?'disabled':''}>PDFを保存</button><p class="reportMuted">日本語のA4 PDFを作成します</p></div>${reportHtml()}${adminHtml()}`);
    panel.querySelector('#reportEvent').onchange=async event=>{selectEvent(event.target.value);await reload();};
    panel.querySelector('#reportReload').onclick=reload;
    if(!ready||error)return;
    if(tab==='notes')bindNotes();
    if(tab==='reports'){
      panel.querySelector('#reportPdf').onclick=exportPdf;
      panel.querySelectorAll('[data-edit-report]').forEach(button=>button.onclick=()=>beginEdit(button.dataset.editReport));
      panel.querySelectorAll('[data-delete-report]').forEach(button=>button.onclick=()=>deleteReport(button.dataset.deleteReport));
      panel.querySelector('#eventForm').onsubmit=saveEvent;
      panel.querySelector('#newReportEvent').onclick=()=>{const form=panel.querySelector('#eventForm');form.reset();for(const input of form.querySelectorAll('input')){input.value='';input.readOnly=false;}form.elements.id.focus();};
    }
  }
  function bindProducts(root){root.querySelectorAll('[data-note-product]').forEach(button=>button.onclick=()=>{
    draft.product=button.dataset.noteProduct||null;
    panel.querySelectorAll('[data-note-product]').forEach(item=>item.setAttribute('aria-pressed',String((item.dataset.noteProduct||null)===draft.product)));
    panel.querySelector('#noteSelected').innerHTML=draft.product===null?'商品なし・会場全体':productLabel(draft.product);
  });}
  function freshNote(){return {product:undefined,category:'',comment:'',id:crypto.randomUUID(),photos:[]};}
  async function addPhotos(files){
    if(busy||draft.pendingPayload)return;
    const version=generation,target=draft;busy=true;draw();
    panel.querySelectorAll('input,textarea,button,select').forEach(control=>control.disabled=true);
    try{
      for(const file of files){
        if((target.photos||[]).length>=MAX_PHOTOS){toast(`写真は${MAX_PHOTOS}枚までです`);break;}
        const photo=await preparePhoto(file);
        if(version!==generation||draft!==target){URL.revokeObjectURL(photo.url);return;}
        (target.photos||=[]).push(photo);
      }
    }catch(e){if(version===generation)toast(e.message);}
    finally{if(version===generation){busy=false;draw();}}
  }
  function beginEdit(id){
    if(busy)return;
    if(draft.editingId===id){tab='notes';show();return;}
    if(draft.pendingPayload||draft.editingId){toast('入力途中の記録があります。「気づき」で保存または編集を終了してください');return;}
    const entry=reports.find(value=>value.id===id&&value.user_id===state.session?.user?.id);if(!entry)return;
    suspendedDraft=draft;draft={id:entry.id,editingId:entry.id,revision:entry.updated_at,product:entry.product_code,category:entry.category,comment:entry.comment,photos:(entry.photo_paths||[]).map(path=>({id:path.split('/').at(-1).replace('.jpg',''),remotePath:path,url:photoUrls.get(path)?.url}))};
    tab='notes';show();panel.scrollIntoView({block:'start'});
  }
  async function deleteReport(id){
    if(busy)return;
    if(draft.id===id&&(draft.pendingPayload||draft.editingId)){toast('編集中・保存途中の記録です。「気づき」で操作を完了してください');return;}
    const entry=reports.find(value=>value.id===id&&value.user_id===state.session?.user?.id);if(!entry)return;
    if(!confirm(`この気づきと添付写真をレポートから削除しますか？\n${entry.comment.slice(0,100)}`))return;
    const version=generation;busy=true;draw();
    try{
      const revision=entry.updated_at?`&updated_at=eq.${encodeURIComponent(entry.updated_at)}`:'';
      let rows;
      try{rows=await request(`reports?id=eq.${id}&deleted_at=is.null${revision}`,{method:'PATCH',body:{deleted_at:new Date().toISOString()}});}
      catch(e){const saved=await request(`reports?id=eq.${id}&select=*`);if(saved[0]?.deleted_at)rows=saved;else throw e;}
      if(!rows?.[0])throw new Error('REPORT_CONFLICT');
      if(version!==generation)return;
      reports=reports.filter(value=>value.id!==id);for(const path of entry.photo_paths||[])photoUrls.delete(path);toast('削除しました');
    }catch(e){if(version===generation)toast(e.message==='REPORT_CONFLICT'?'更新されています。「同期」で最新内容を確認してください。':'削除できませんでした。再試行してください');}
    finally{if(version===generation){busy=false;draw();}}
  }
  function bindNotes(){
    if(draft.pendingPayload){panel.querySelectorAll('#noteForm input,#noteForm textarea,#noteForm button[type="button"]').forEach(control=>control.disabled=true);panel.querySelector('#noteError').textContent='前回の保存結果を確認します。「登録する」で同じ内容を再送してください。';}
    bindProducts(panel);
    panel.querySelectorAll('[data-note-category]').forEach(button=>button.onclick=()=>{draft.category=button.dataset.noteCategory;panel.querySelectorAll('[data-note-category]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));});
    panel.querySelector('#noteSearch').oninput=event=>{
      const query=event.target.value.trim().toLowerCase(),results=panel.querySelector('#noteResults');
      results.innerHTML=query?state.products.filter(product=>`${product.code} ${product.name}`.toLowerCase().includes(query)).slice(0,20).map(product=>`<button type="button" data-note-product="${esc(product.code)}" aria-pressed="${draft.product===product.code}">${productLabel(product.code)}</button>`).join('')||'<p>該当する商品はありません</p>':'';bindProducts(results);
    };
    panel.querySelector('#noteComment').oninput=event=>{draft.comment=event.target.value;};
    panel.querySelector('#notePhotoPick').onclick=()=>panel.querySelector('#notePhotoFiles').click();
    panel.querySelector('#notePhotoCamera').onclick=()=>panel.querySelector('#notePhotoCapture').click();
    for(const id of ['notePhotoFiles','notePhotoCapture'])panel.querySelector(`#${id}`).onchange=event=>addPhotos([...event.target.files]);
    panel.querySelectorAll('[data-remove-note-photo]').forEach(button=>button.onclick=()=>{const photo=photos().find(value=>value.id===button.dataset.removeNotePhoto);if(photo?.url?.startsWith('blob:'))URL.revokeObjectURL(photo.url);draft.photos=photos().filter(value=>value!==photo);draw();});
    if(draft.editingId){const cancel=panel.querySelector('#noteEditCancel');cancel.disabled=busy;cancel.onclick=async()=>{releasePhotos(draft);draft=suspendedDraft||freshNote();suspendedDraft=null;tab='reports';show();await reload();};}
    panel.querySelector('#noteForm').onsubmit=async event=>{
      event.preventDefault();if(busy)return;
      const message=panel.querySelector('#noteError');
      if(draft.product===undefined||!draft.category||(!draft.comment.trim()&&!photos().length)){message.textContent='商品・カテゴリーを選び、コメントまたは写真を追加してください。';return;}
      const user=state.session?.user?.id,version=generation;
      const payload={id:draft.id,exhibition_id:selected,product_code:draft.product,category:draft.category,comment:draft.comment.trim()||'写真記録'};
      busy=true;panel.querySelector('#noteSave').disabled=true;panel.querySelector('#noteSave').textContent='保存中…';
      // Freeze the exact request for retries after a lost response.
      panel.querySelectorAll('input,textarea,button,select').forEach(control=>control.disabled=true);
      draft.pendingPayload=draft.pendingPayload||payload;
      try{
        let rows;const paths=[];
        if(draft.editingId){
          const current=await request(`reports?id=eq.${draft.id}&deleted_at=is.null&select=*`);
          const desiredPaths=photos().map(photo=>photo.remotePath||`${user}/${draft.id}/${photo.id}.jpg`);
          const alreadySaved=current[0]&&['product_code','category','comment'].every(key=>current[0][key]===payload[key])&&JSON.stringify(current[0].photo_paths||[])===JSON.stringify(desiredPaths);
          if(!current[0]||(current[0].updated_at!==draft.revision&&!alreadySaved))throw new Error('REPORT_CONFLICT');
          rows=current;
        }else{
          try{rows=await request('reports',{method:'POST',body:draft.pendingPayload});}
          catch(e){if(e.status!==409)throw e;rows=await request(`reports?id=eq.${encodeURIComponent(draft.id)}&user_id=eq.${encodeURIComponent(user)}&select=*`);}
        }
        if(!rows?.[0])throw new Error('SAVE_NOT_CONFIRMED');
        if(!draft.editingId&&['exhibition_id','product_code','category','comment'].some(key=>rows[0][key]!==draft.pendingPayload[key]))throw new Error('REPORT_CONFLICT');
        for(const photo of photos()){
          if(version!==generation||state.session?.user?.id!==user)return;
          const path=photo.remotePath||`${user}/${draft.id}/${photo.id}.jpg`;
          if(!photo.remotePath){const blob=await fetch(photo.url).then(response=>response.blob());await photoApi.upload(path,blob);}
          paths.push(path);
        }
        if(version!==generation||state.session?.user?.id!==user)return;
        if(draft.editingId||paths.length){
          const changes={photo_paths:paths,...(draft.editingId?{product_code:payload.product_code,category:payload.category,comment:payload.comment}:{})};
          const revision=rows[0].updated_at?`&updated_at=eq.${encodeURIComponent(rows[0].updated_at)}`:'';
          try{rows=await request(`reports?id=eq.${draft.id}&deleted_at=is.null${revision}`,{method:'PATCH',body:changes});}
          catch(e){const saved=await request(`reports?id=eq.${draft.id}&deleted_at=is.null&select=*`);if(saved[0]&&['product_code','category','comment'].every(key=>saved[0][key]===payload[key])&&JSON.stringify(saved[0].photo_paths||[])===JSON.stringify(paths))rows=saved;else throw e;}
          if(!rows?.[0])throw new Error('REPORT_CONFLICT');
        }
        if(!rows?.[0]||['exhibition_id','product_code','category','comment'].some(key=>rows[0][key]!==draft.pendingPayload[key]))throw new Error('SAVE_NOT_CONFIRMED');
        if(version!==generation||state.session?.user?.id!==user)return;
        const edited=Boolean(draft.editingId);try{await signPhotos(rows);}catch(e){}if(version!==generation)return;releasePhotos(draft);draft=suspendedDraft||freshNote();suspendedDraft=null;exhibitionDrafts.set(selected,draft);reports=[...reports.filter(item=>item.id!==rows[0].id),rows[0]];toast(edited?'変更を保存しました':'登録しました');if(edited){tab='reports';show();}
      }catch(e){if(version===generation){if(e.status&&e.status<500&&e.status!==409&&!photos().length){delete draft.pendingPayload;}toast(e.message==='REPORT_CONFLICT'?'別の画面で更新されています。編集をやめて最新内容を確認してください。':'保存できませんでした。入力と写真を保持しています');}}
      finally{if(version===generation){busy=false;draw();}}
    };
  }
  async function saveEvent(event){
    event.preventDefault();if(busy)return;
    const form=event.target,data=Object.fromEntries(new FormData(form)),codes=data.id===selected?focus.map(item=>item.product_code):[];
    const message=panel.querySelector('#eventError');
    if(codes.some(code=>!state.products.some(product=>product.code===code))){message.textContent='注力商品の品番を商品マスターと照合してください。';return;}
    if(data.start_date&&data.end_date&&data.start_date>data.end_date){message.textContent='開催日の範囲を確認してください。';return;}
    const version=generation,user=state.session?.user?.id;
    busy=true;form.querySelectorAll('button').forEach(button=>button.disabled=true);
    try{await request('rpc/save_exhibition_report_settings',{method:'POST',body:{p_event:{id:data.id,name:data.name,order_event_name:data.order_event_name,start_date:data.start_date||null,end_date:data.end_date||null,venue:data.venue,participants:data.participants.split(/[,、]/).map(item=>item.trim()).filter(Boolean)},p_codes:codes}});if(version!==generation||state.session?.user?.id!==user)return;selectEvent(data.id);toast('管理内容を保存しました');busy=false;await reload();}
    catch(e){if(version!==generation)return;message.textContent='保存できませんでした。接続とスタッフ権限を確認してください。';busy=false;form.querySelectorAll('button').forEach(button=>button.disabled=false);}
  }
  async function exportPdf(){
    if(busy)return;busy=true;const button=panel.querySelector('#reportPdf');button.disabled=true;button.textContent='PDF作成中…';
    const version=generation,eventName=currentEvent().name;
    const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;width:794px;height:1123px';frame.setAttribute('aria-hidden','true');document.body.append(frame);
    try{
      const doc=frame.contentDocument;doc.open();doc.write('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body></body></html>');doc.close();
      const style=doc.createElement('style');style.textContent='*{box-sizing:border-box}body{margin:0;font:16px/1.6 sans-serif;color:#172033}.page{width:794px;height:1123px;padding:56px;background:white;overflow:hidden}h1{font-size:26px}h2{font-size:22px;border-bottom:1px solid #bbb}h3{font-size:19px}h4{font-size:17px}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.reportTotal strong{display:block;font-size:30px}.reportMetrics{display:flex;flex-wrap:wrap;gap:20px}.reportMetrics small,.reportMetrics b,td small{display:block}.reportTable{border-collapse:collapse;table-layout:fixed;width:100%;font-size:14px}.reportTable th:first-child{width:60%}.reportTable th:nth-child(2){width:12%}.reportTable th:nth-child(3){width:28%}.reportTable th,.reportTable td{vertical-align:top;overflow-wrap:anywhere}.reportTable th:not(:first-child),.reportTable td:not(:first-child){text-align:right}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}.reportComment{border-left:3px solid #ddd;padding-left:12px;margin:12px 0}.reportPhotoFigure{margin:12px 0}.reportPhotoFigure img{width:100%;height:420px;object-fit:contain}.reportPhotoFigure figcaption{font-size:12px}';doc.head.append(style);
      await signPhotos(reports);
      const source=doc.createElement('div');source.innerHTML=reportHtml();source.querySelectorAll('.reportRecordActions').forEach(node=>node.remove());
      await Promise.all([...source.querySelectorAll('img')].map(img=>img.decode()));
      const blocks=[];
      function flatten(node){
        if(node.tagName==='TABLE'){
          const head=node.querySelector('thead');for(const row of node.querySelectorAll('tbody tr')){const table=doc.createElement('table');table.className=node.className;if(head)table.append(head.cloneNode(true));const body=doc.createElement('tbody');body.append(row.cloneNode(true));table.append(body);blocks.push(table);}return;
        }
        if(node.matches('article,section')&&!node.matches('.reportComment')){for(const child of node.children)flatten(child);}else blocks.push(node.cloneNode(true));
      }
      flatten(source.firstElementChild);
      await doc.fonts.ready;
      const pages=[];let page;
      function newPage(){page=doc.createElement('div');page.className='page';doc.body.append(page);pages.push(page);}
      function pageFits(){return !page.lastElementChild||page.lastElementChild.getBoundingClientRect().bottom<=page.getBoundingClientRect().top+1067;}
      newPage();
      for(const block of blocks){
        // Keep one table per page, with stable columns and one header.
        if(block.tagName==='TABLE'&&page.lastElementChild?.tagName==='TABLE'){
          const row=block.querySelector('tbody tr').cloneNode(true);
          page.lastElementChild.querySelector('tbody').append(row);
          if(pageFits())continue;
          row.remove();
        }
        page.append(block);
        if(!pageFits()){block.remove();
          const headings=[];while(page.lastElementChild?.matches('h1,h2,h3,h4')){const heading=page.lastElementChild;heading.remove();headings.unshift(heading);}
          if(page.children.length)newPage();for(const heading of headings)page.append(heading);page.append(block);
          if(!pageFits()){
            // Split long comments by text, never crop a recorded observation.
            const paragraph=block.querySelector('p');if(!paragraph)throw new Error('PDF_BLOCK_TOO_LONG');
            const text=paragraph.textContent;block.remove();let cursor=0;
            while(cursor<text.length){let low=1,high=text.length-cursor,best=0;const part=block.cloneNode(true);page.append(part);
              while(low<=high){const mid=Math.floor((low+high)/2);part.querySelector('p').textContent=text.slice(cursor,cursor+mid);if(pageFits()){best=mid;low=mid+1;}else high=mid-1;}
              if(!best)throw new Error('PDF_BLOCK_TOO_LONG');part.querySelector('p').textContent=text.slice(cursor,cursor+best);cursor+=best;if(cursor<text.length)newPage();
            }
          }
        }
      }
      const pdf=new window.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});pdf.setProperties({title:`${eventName} 展示会レポート`});
      for(let i=0;i<pages.length;i++){if(version!==generation)return;if(i)pdf.addPage();const canvas=await window.html2canvas(pages[i],{scale:2,backgroundColor:'#fff',logging:false,useCORS:true});pdf.addImage(canvas.toDataURL('image/jpeg',0.95),'JPEG',0,0,210,297);pdf.setFontSize(9);pdf.text(`${i+1} / ${pages.length}`,195,290,{align:'right'});}
      if(version!==generation)return;
      pdf.save(`${eventName.replace(/[\\/:*?"<>|]/g,'_')}_展示会レポート.pdf`);toast('PDFを保存しました');
    }catch(e){toast('PDFを作成できませんでした。再試行してください');}
    finally{frame.remove();if(version===generation)busy=false;if(button.isConnected){button.disabled=false;button.textContent='PDFを保存';}}
  }
  function hasDraft(){return Boolean(draft.comment||photos().length)||[...exhibitionDrafts.values(),suspendedDraft].some(value=>value&&(value.comment||value.photos?.length));}
  window.addEventListener('beforeunload',event=>{if(hasDraft()){event.preventDefault();event.returnValue='';}});
  // Refresh shared observations only where no form is being edited.
  setInterval(()=>{if(state.online&&document.visibilityState==='visible'&&(tab==='sales'||(tab==='reports'&&!panel.querySelector('.reportAdmin[open]'))))reload();},12000);
  return {
    refresh(){if(tab==='sales'&&ready)draw();},
    clear(){generation++;for(const value of new Set([draft,suspendedDraft,...exhibitionDrafts.values()]))releasePhotos(value);photoUrls.clear();suspendedDraft=null;events=[];reports=[];orders=[];focus=[];selected='';ready=false;busy=false;exhibitionDrafts.clear();draft=freshNote();tab='orders';panel.innerHTML='';show();},
    hasDraft,
  };
}
