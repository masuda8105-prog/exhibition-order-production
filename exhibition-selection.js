const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createExhibitionSelection({state,request,onSelect,onCancel}){
  const view=document.getElementById('eventChooser'),list=document.getElementById('eventChoices');
  const form=document.getElementById('createExhibitionForm'),message=document.getElementById('eventChooserError');
  let events=[],busy=false,version=0,pending=null;
  function controls(disabled){busy=disabled;view.querySelectorAll('button,input,select').forEach(el=>el.disabled=disabled);}
  function render(){
    list.innerHTML=events.map(event=>`<button type="button" class="eventChoice" data-event-id="${esc(event.id)}"><strong>${esc(event.name)}</strong><span>${esc(event.venue||'会場未登録')}${event.start_date?` ／ ${esc(event.start_date)}${event.end_date?` ～ ${esc(event.end_date)}`:''}`:''}</span><small>お渡し番号：${esc(event.pickup_prefix||event.name.split(' ')[0])}-1〜${state.exhibition?.id===event.id?' ／ 選択中':''}</small></button>`).join('')||'<p>展示会を登録して開始してください。</p>';
    list.querySelectorAll('[data-event-id]').forEach(button=>button.onclick=()=>select(events.find(event=>event.id===button.dataset.eventId)));
  }
  async function select(event){
    if(busy||!event)return;const token=version;controls(true);message.textContent='';
    try{await onSelect(event);if(token===version)view.classList.add('hidden');}
    catch{if(token===version)message.textContent='注文を読み込めませんでした。接続を確認して再試行してください。';}
    finally{if(token===version)controls(false);}
  }
  async function show(){
    const token=++version;view.classList.remove('hidden');document.getElementById('appView').classList.add('hidden');
    document.getElementById('loginView').classList.add('hidden');
    document.getElementById('eventChooserCancel').classList.toggle('hidden',!state.exhibition);
    message.textContent='';list.textContent='展示会を読み込み中…';controls(true);
    try{
      const rows=[];for(let offset=0;;offset+=500){const page=await request(`exhibitions?select=*&order=start_date.desc.nullslast,created_at.desc,id.asc&limit=500&offset=${offset}`);rows.push(...page);if(page.length<500)break;}
      if(token!==version)return;events=rows;render();
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
    if(events.some(value=>value.name===name||value.order_event_name===name)){message.textContent='同じ名前の展示会があります。一覧から選ぶか、年・開催回を名前に追加してください。';return;}
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
  return {show,clear(){version++;events=[];pending=null;busy=false;form.reset();delete form.elements.pickup_prefix.dataset.edited;list.innerHTML='';message.textContent='';view.classList.add('hidden');}};
}
