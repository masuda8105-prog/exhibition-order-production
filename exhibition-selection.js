import {findSavedReportDraftEvent} from './report-drafts.js?v=20261009-reset1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const exhibitionDay=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export const exhibitionDisplayName=name=>String(name||'').replace(/(?:19|20)\d{2}(?:年(?:度)?)?/g,'').replace(/[（(]\s*[）)]/g,'').replace(/\s+/g,' ').replace(/\s+([（(])/g,'$1').trim()||'展示会';
export function createDailyExhibitionPreference({storage,getUserId,today=exhibitionDay}){
  const key=()=>getUserId()?`exhibitionOps.selectedToday.v1:${getUserId()}`:'';
  return {
    read(){try{const id=key();if(!id)return '';const saved=JSON.parse(storage?.getItem(id)||'null');if(saved?.day===today()&&typeof saved.id==='string')return saved.id;if(saved)storage?.removeItem(id);}catch{}return '';},
    save(eventId){try{const id=key();if(id)storage?.setItem(id,JSON.stringify({id:eventId,day:today()}));}catch{}},
    forget(){try{const id=key();if(id)storage?.removeItem(id);}catch{}},
  };
}
const shortDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?`${Number(value.slice(5,7))}/${Number(value.slice(8,10))}`:'';

export function createExhibitionSelection({state,request,onSelect,onCancel}){
  const view=document.getElementById('eventChooser'),list=document.getElementById('eventChoices');
  const form=document.getElementById('createExhibitionForm'),message=document.getElementById('eventChooserError');
  let events=[],busy=false,version=0,pending=null;
  let storage;try{storage=localStorage;}catch{}
  const preference=createDailyExhibitionPreference({storage,getUserId:()=>state.session?.user?.id});
  function controls(disabled){busy=disabled;view.querySelectorAll('button,input,select').forEach(el=>el.disabled=disabled);}
  function render(){
    const choices=rows=>rows.map(event=>{
      const name=exhibitionDisplayName(event.name),same=rows.filter(value=>exhibitionDisplayName(value.name)===name&&(value.venue||'')===(event.venue||''));
      const occurrence=same.length>1?` ／ 開催回 ${same.indexOf(event)+1}`:'';
      return `<button type="button" class="eventChoice" data-event-id="${esc(event.id)}"><strong>${esc(name)}${event.superseded_by?' ／ 過去の開催':''}</strong><span>${esc(event.venue||'会場未登録')}${event.start_date?` ／ ${event.superseded_by?esc(event.start_date):shortDate(event.start_date)}${event.end_date?` ～ ${event.superseded_by?esc(event.end_date):shortDate(event.end_date)}`:''}`:''}${occurrence}</span><small>${event.superseded_by?'以前の注文・売上・レポートを確認':`お渡し番号：${esc(event.pickup_prefix||name.split(' ')[0])}-1〜`}${state.exhibition?.id===event.id?' ／ 選択中':''}</small></button>`;
    }).join('');
    const archived=events.filter(event=>event.superseded_by);
    list.innerHTML=(choices(events.filter(event=>!event.superseded_by))||'<p>展示会を登録して開始してください。</p>')+(archived.length?`<details class="eventArchive"><summary>過去の開催を見る（${archived.length}件）</summary><div class="eventChoices">${choices(archived)}</div></details>`:'');
    list.querySelectorAll('[data-event-id]').forEach(button=>button.onclick=()=>select(events.find(event=>event.id===button.dataset.eventId)));
  }
  async function select(event){
    if(busy||!event)return;const token=version;controls(true);message.textContent='';
    try{await onSelect(event);if(token===version){preference.save(event.id);view.classList.add('hidden');}}
    catch{if(token===version)message.textContent='注文を読み込めませんでした。接続を確認して再試行してください。';}
    finally{if(token===version)controls(false);}
  }
  async function show({resume=false}={}){
    const token=++version;view.classList.remove('hidden');document.getElementById('appView').classList.add('hidden');
    document.getElementById('loginView').classList.add('hidden');
    document.getElementById('eventChooserCancel').classList.toggle('hidden',!state.exhibition);
    message.textContent='';list.textContent='展示会を読み込み中…';controls(true);
    try{
      const rows=[];for(let offset=0;;offset+=500){const page=await request(`exhibitions?select=*&order=start_date.desc.nullslast,created_at.desc,id.asc&limit=500&offset=${offset}`);rows.push(...page);if(page.length<500)break;}
      if(token!==version)return;events=rows;render();
      if(resume){
        const remembered=preference.read(),draftEvent=findSavedReportDraftEvent(state.session?.user?.id,events);let event=events.find(value=>value.id===(draftEvent||remembered));
        const seen=new Set();while(!draftEvent&&event?.superseded_by&&!seen.has(event.id)){seen.add(event.id);event=events.find(value=>value.id===event.superseded_by);}
        if(event){controls(false);await select(event);}else if(remembered)preference.forget();
      }
    }catch{if(token===version){list.textContent='';message.textContent='展示会を読み込めませんでした。「一覧を更新」で再試行してください。';}}
    finally{if(token===version)controls(false);}
  }
  form.elements.name.oninput=()=>{
    if(!form.elements.pickup_prefix.dataset.edited)form.elements.pickup_prefix.value=form.elements.name.value.trim().split(/[\s（(]/)[0].slice(0,40);
  };
  form.elements.pickup_prefix.oninput=()=>form.elements.pickup_prefix.dataset.edited='true';
  form.onsubmit=async event=>{
    event.preventDefault();if(busy)return;
    const name=form.elements.name.value.trim(),prefix=form.elements.pickup_prefix.value.trim();
    if(!name||!prefix){message.textContent='展示会名とお渡し番号の接頭辞を入力してください。';return;}
    if(form.elements.start_date.value&&form.elements.end_date.value&&form.elements.end_date.value<form.elements.start_date.value){message.textContent='終了日は開始日以降にしてください。';return;}
    if(events.some(value=>value.name===name||value.order_event_name===name)){message.textContent='同じ名前の展示会があります。一覧から選ぶか、開催場所・開催回を名前に追加してください。';return;}
    const payload={name,order_event_name:name,pickup_prefix:prefix,venue:form.elements.venue.value.trim(),start_date:form.elements.start_date.value||null,end_date:form.elements.end_date.value||null};
    const signature=JSON.stringify(payload);if(pending?.signature!==signature)pending={signature,id:`event_${crypto.randomUUID().replaceAll('-','')}`};
    const token=version;controls(true);message.textContent='';
    try{
      let rows;
      try{rows=await request('exhibitions',{method:'POST',body:{id:pending.id,...payload}});}
      catch(error){rows=await request(`exhibitions?select=*&id=eq.${pending.id}`);if(!rows[0])throw error;}
      if(token!==version)return;
      if(!rows[0])throw new Error('SAVE_NOT_CONFIRMED');
      const saved=rows[0];pending=null;form.reset();delete form.elements.pickup_prefix.dataset.edited;
      events.unshift(saved);render();controls(false);await select(saved);
    }catch{if(token===version)message.textContent='登録できませんでした。名前の重複・入力内容・接続を確認してください。';}
    finally{if(token===version)controls(false);}
  };
  document.getElementById('eventChooserReload').onclick=show;
  document.getElementById('eventChooserCancel').onclick=()=>{if(!busy){view.classList.add('hidden');onCancel();}};
  return {show,remember(event){preference.save(event.id);},clear(){version++;events=[];pending=null;busy=false;form.reset();delete form.elements.pickup_prefix.dataset.edited;list.innerHTML='';message.textContent='';view.classList.add('hidden');}};
}
