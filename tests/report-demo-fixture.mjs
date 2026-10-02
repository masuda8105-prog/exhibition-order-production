// Local-only, in-memory demo. Never included in the production build.
export function createReportDemo(){
  const products=[
    {id:101,product_no:'1064',product_name:'メガネミスト（デモ）',wholesale_price:6400,is_active:true},
    {id:102,product_no:'1065',product_name:'注力商品1065（デモ）',wholesale_price:7800,is_active:true},
    {id:103,product_no:'1067',product_name:'注力商品1067（デモ）',wholesale_price:9800,is_active:true},
    {id:104,product_no:'1053',product_name:'プッシュロックヤットコ（デモ）',wholesale_price:5600,is_active:true},
    {id:105,product_no:'1054',product_name:'抱き足ヤットコ（デモ）',wholesale_price:8000,is_active:true},
    {id:106,product_no:'858',product_name:'ヤットコ（デモ）',wholesale_price:2000,is_active:true},
  ];
  const events=[{id:'jex_2026',name:'JEX 2026（デモ）',order_event_name:'JEX 2026（デモ）',start_date:'2026-10-07',end_date:'2026-10-08',venue:'サンプル会場',participants:['増田','宮川','小野村']},
    {id:'wof_2026',name:'WOF 2026（デモ）',order_event_name:'WOF 2026（デモ）',start_date:null,end_date:null,venue:'サンプル会場',participants:[]}];
  const focused=new Map([['jex_2026',['1064','1065','1067','1053','1054']],['wof_2026',['1053','1054']]]);
  const notes=[
    {id:'00000000-0000-4000-8000-000000000001',exhibition_id:'jex_2026',product_code:'1065',category:'positive',comment:'小型で使いやすいという声が多かった。',author_name:'増田'},
    {id:'00000000-0000-4000-8000-000000000002',exhibition_id:'jex_2026',product_code:'1065',category:'negative',comment:'バネ付きが欲しいという要望があった。',author_name:'小野村'},
    {id:'00000000-0000-4000-8000-000000000003',exhibition_id:'jex_2026',product_code:'1054',category:'positive',comment:'実演すると用途を理解してもらいやすかった。',author_name:'増田'},
    {id:'00000000-0000-4000-8000-000000000004',exhibition_id:'jex_2026',product_code:null,category:'venue',comment:'午後から来場者が増えた。',author_name:'宮川'},
    {id:'00000000-0000-4000-8000-000000000005',exhibition_id:'jex_2026',product_code:null,category:'other',comment:'受付スペースは展示台2台分必要。',author_name:'増田'},
  ].map(note=>({...note,user_id:'fixture-user',created_at:'2026-10-07T01:00:00Z'}));
  const item=(code,qty,price)=>{const product=products.find(p=>p.product_no===code);return {productId:`product-${product.id}`,code,name:product.product_name,qty,price:price??product.wholesale_price};};
  const orders=[
    ['domestic',[item('1065',21),item('1067',14)]],
    ['domestic',[item('1064',9),item('1053',60),item('858',1)]],
    ['overseas',[item('1054',18),item('858',1)]],
  ].map(([region,items],i)=>({id:`00000000-0000-4000-8000-${String(i+100).padStart(12,'0')}`,event_name:'JEX 2026（デモ）',confirmation_state:'confirmed',created_at:'2026-10-07T00:00:00Z',updated_at:'2026-10-07T00:00:00Z',deleted_at:null,
    payload:{type:region==='overseas'?'spot':'normal',handoff:'now',store:`サンプル店舗${i+1}`,customer:'デモのお客様',customerRegion:region,staff:'増田',items,paid:true,delivered:true,workflowStatus:'done',confirmationState:'confirmed'}}));
  async function handle(url,request,readJson){
    const table=url.pathname.split('/').at(-1),page=rows=>rows.slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||500));
    if(table==='products')return {body:products};
    if(table==='exhibition_staff')return {body:[{display_name:'増田（デモ）',role:'staff',active:true}]};
    if(table==='exhibitions')return {body:page(events)};
    if(table==='exhibition_products'){
      const id=url.searchParams.get('exhibition_id')?.replace(/^eq\./,'');
      return {body:(focused.get(id)||[]).map((product_code,display_order)=>({exhibition_id:id,product_code,display_order}))};
    }
    if(table==='reports'){
      if(request.method==='POST'){
        const body=await readJson(request);
        if(notes.some(note=>note.id===body.id))return {status:409,body:{message:'duplicate'}};
        if(!events.some(event=>event.id===body.exhibition_id)||!['positive','negative','venue','other'].includes(body.category)||!body.comment?.trim())return {status:400,body:{message:'invalid_report'}};
        const note={...body,user_id:'fixture-user',author_name:'増田（デモ）',created_at:new Date().toISOString()};notes.push(note);return {status:201,body:[note]};
      }
      const id=url.searchParams.get('id')?.replace(/^eq\./,''),event=url.searchParams.get('exhibition_id')?.replace(/^eq\./,'');
      return {body:page(notes.filter(note=>(!id||note.id===id)&&(!event||note.exhibition_id===event)))};
    }
    if(table==='save_exhibition_report_settings'){
      const {p_event,p_codes}=await readJson(request);
      if(!p_event?.id||!p_event.name||!p_event.order_event_name||p_codes.some(code=>!products.some(product=>product.product_no===code)))return {status:400,body:{message:'invalid_settings'}};
      const existing=events.find(event=>event.id===p_event.id);if(existing)Object.assign(existing,p_event);else events.push(p_event);
      focused.set(p_event.id,p_codes);return {body:null};
    }
    return null;
  }
  return {orders,handle,eventName:'JEX 2026（デモ）'};
}
