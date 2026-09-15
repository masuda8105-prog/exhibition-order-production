export const ORDER_TYPE = Object.freeze({ NORMAL:'normal', SPOT:'spot' });
export const HANDOFF = Object.freeze({ NOW:'now', LATER:'later', HOTEL:'hotel', SHIP:'ship' });
export const PAYMENT = Object.freeze({ CREDIT:'credit', CASH:'cash', ON_PICKUP:'on_pickup', NONE:'none' });
export const PREP = Object.freeze({ NONE:'none', PREPARING:'preparing', READY:'ready' });
export const ORDER_STATUS=Object.freeze({active:'要対応',waiting:'受け取り待ち',done:'完了'});

export const SHIPPING_FEE=500;
export const isShippingItem=item=>item?.productId==='service-shipping-500';
export function addShippingFee(order,lineId){
  if((order.items||[]).some(isShippingItem))return false;
  (order.items||=[]).push({productId:'service-shipping-500',code:'送料',name:'配送料（一律）',price:SHIPPING_FEE,qty:1,lineId,orderable:true,status:'active',imageUrl:''});
  return true;
}

export function needsHeadOfficeShare(order){
  return order?.type===ORDER_TYPE.SPOT && [HANDOFF.LATER,HANDOFF.HOTEL,HANDOFF.SHIP].includes(order?.handoff);
}

export function needsReceipt(order){
  return order?.type===ORDER_TYPE.SPOT && order?.handoff===HANDOFF.LATER;
}

export const isPickupOrder=needsReceipt;

export function pickupNumberLabel(order){
  const number=String(order?.pickupNumber||'');
  return isPickupOrder(order)&&/^[1-9][0-9]*$/.test(number)?`NEO-${number}`:'';
}

export function paymentMethodOnHandoffChange(order,handoff){
  if(order.paid)return order.paymentMethod;
  if(handoff===HANDOFF.LATER&&order.handoff!==HANDOFF.LATER)return PAYMENT.ON_PICKUP;
  if(handoff!==HANDOFF.LATER&&order.paymentMethod===PAYMENT.ON_PICKUP)return PAYMENT.CREDIT;
  return order.paymentMethod;
}

export function paymentMethodLabel(order){
  return {[PAYMENT.CREDIT]:'クレジット',[PAYMENT.CASH]:'現金',[PAYMENT.ON_PICKUP]:'受け取り時会計'}[order?.paymentMethod]||'未選択';
}

export function isPickupPaymentRecorded(order){
  return isPickupOrder(order)&&order.paid===true&&[PAYMENT.CREDIT,PAYMENT.CASH].includes(order.paymentMethod);
}

export function markPickupPaid(order,method,now=new Date().toISOString()){
  if(!isPickupOrder(order)||order.delivered||isPickupPaymentRecorded(order)||![PAYMENT.CREDIT,PAYMENT.CASH].includes(method))return {...order};
  return {...order,paymentMethod:method,paid:true,paidAt:order.paidAt||now};
}

export function markPickupDelivered(order,now=new Date().toISOString()){
  if(!isPickupPaymentRecorded(order)||order.delivered)return {...order};
  return {...order,delivered:true,deliveredAt:order.deliveredAt||now,workflowStatus:'done'};
}

export function totalOf(order){
  return (order?.items||[]).reduce((sum,item)=>sum + Number(item.price||0)*Number(item.qty||0),0);
}

export function itemCountOf(order){
  return (order?.items||[]).reduce((sum,item)=>sum+(isShippingItem(item)?0:Number(item?.qty||0)),0);
}

export function phoneHasUnexpectedCharacters(value){
  const phone=String(value??'');
  return Boolean(phone && !/^[0-9+\-\s()（）]+$/.test(phone));
}

export function createdDateInTokyo(order){
  const raw=order?.createdAt||order?.created_at||'';
  if(!raw) return '';
  const date=new Date(raw);
  if(Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}

export function filterOrdersByCreatedDate(orders,{mode='all',today='',start='',end=''}={}){
  const visible=(orders||[]).filter(order=>!order?.deleted);
  if(mode==='all') return visible;
  const from=mode==='today'?today:start;
  const to=mode==='today'?today:(end||start);
  if(!from||!to) return [];
  return visible.filter(order=>{
    const date=createdDateInTokyo(order);
    return Boolean(date&&date>=from&&date<=to);
  });
}

export function orderMatchesOperationalFilter(order,filter){
  if(!order||order.deleted) return false;
  if(filter==='unshared') return needsHeadOfficeShare(order)&&!order.headOfficeShared;
  if(filter==='pickup') return order.handoff===HANDOFF.LATER&&order.headOfficeShared&&!order.delivered;
  if(filter==='unpaid') return order.type===ORDER_TYPE.SPOT&&!order.paid;
  return true;
}

export function orderMatchesSearch(order,query){
  const q=String(query??'').trim().toLowerCase();
  if(!q) return true;
  return [pickupNumberLabel(order),order?.receiptNo,order?.serverOrderNo,order?.orderNo,order?.store,order?.customer,order?.phone,...(order?.items||[]).flatMap(item=>[item?.code,item?.name])]
    .join(' ').toLowerCase().includes(q);
}

export function batchSummary(orders){
  const list=(orders||[]).filter(order=>!order?.deleted);
  return {
    orders:list.length,
    items:list.reduce((sum,order)=>sum+itemCountOf(order),0),
    total:list.reduce((sum,order)=>sum+totalOf(order),0),
    pending:list.filter(order=>order.syncState==='pending').length,
    unshared:list.filter(order=>orderMatchesOperationalFilter(order,'unshared')).length,
    active:list.filter(order=>groupOf(order)==='active').length,
    waiting:list.filter(order=>groupOf(order)==='waiting').length,
    unpaid:list.filter(order=>orderMatchesOperationalFilter(order,'unpaid')).length,
  };
}

export function customerNameWithHonorific(name){
  const value=String(name??'').trim();
  if(!value) return '-';
  return /(?:様|さま|御中|殿)$/.test(value)?value:`${value} 様`;
}

export function receiptInternalInfo(order,{customerCopy=false}={}){
  if(customerCopy) return {showStatus:false,showHandoff:false,showCreatedAt:false,showGuide:false,headOfficeShare:''};
  return {
    showStatus:false,
    showHandoff:true,
    showCreatedAt:true,
    showGuide:true,
    headOfficeShare:'',
  };
}

export function validate(order){
  const errors=[];
  if(!(order?.items||[]).some(item=>!isShippingItem(item))) errors.push('商品を1点以上追加してください。');
  const shipping=(order?.items||[]).filter(isShippingItem);
  if(shipping.length>1||shipping.some(item=>Number(item.price)!==SHIPPING_FEE||Number(item.qty)!==1)) errors.push('送料は1注文につき500円です。送料を入れ直してください。');
  if((order?.items||[]).some(item=>!String(item?.code||'').trim()||!String(item?.name||'').trim())) errors.push('商品情報が不完全です。商品を選び直してください。');
  if((order?.items||[]).some(item=>!Number.isFinite(Number(item?.price))||Number(item.price)<=0)) errors.push('価格未定の商品は注文できません。');
  if((order?.items||[]).some(item=>!Number.isInteger(Number(item?.qty))||Number(item.qty)<=0)) errors.push('商品数量が不正です。');
  if(!String(order?.store||'').trim()) errors.push('店舗名は必須です。');
  if(!String(order?.phone||'').trim()) errors.push('電話番号は必須です。');
  if(order?.type===ORDER_TYPE.NORMAL){
    if(order?.accountChoice==='その他'&&!String(order?.accountOther||'').trim()) errors.push('卸屋・帳合先名を入力してください。');
    if(!String(order?.account||'').trim()) errors.push('卸屋・帳合先は必須です。');
    if(!String(order?.staff||'').trim()) errors.push('受注担当者は必須です。');
  }
  if(order?.type===ORDER_TYPE.SPOT){
    if(!String(order?.customer||'').trim()) errors.push('お客様名は必須です。');
    const allowedPayments=isPickupOrder(order)&&!order.paid?[PAYMENT.CREDIT,PAYMENT.CASH,PAYMENT.ON_PICKUP]:[PAYMENT.CREDIT,PAYMENT.CASH];
    if(!allowedPayments.includes(order?.paymentMethod)) errors.push('会計方法を選択してください。');
    if(!Object.values(HANDOFF).includes(order?.handoff)) errors.push('受け渡し方法を選択してください。');
    if(order?.handoff===HANDOFF.LATER && !order?.pickupDate) errors.push('受取予定日を選択してください。');
  }
  return errors;
}

export function isDone(order){
  if(order?.deleted) return false;
  if(order?.type===ORDER_TYPE.NORMAL) return true;
  if(order?.handoff===HANDOFF.NOW) return Boolean(order?.paid && order?.delivered);
  if(order?.handoff===HANDOFF.LATER) return Boolean(order?.delivered);
  if([HANDOFF.HOTEL,HANDOFF.SHIP].includes(order?.handoff)) return Boolean(order?.headOfficeShared);
  return false;
}

export function groupOf(order){
  if(isPickupOrder(order)){
    if(order.delivered)return 'done';
    if(order.workflowStatus==='done')return 'waiting';
    if(Object.hasOwn(ORDER_STATUS,order.workflowStatus))return order.workflowStatus;
    return order.slackShared||order.headOfficeShared?'waiting':'active';
  }
  if(Object.hasOwn(ORDER_STATUS,order?.workflowStatus))return order.workflowStatus;
  if(isDone(order)) return 'done';
  if(order?.type===ORDER_TYPE.SPOT && order?.handoff===HANDOFF.LATER && order?.headOfficeShared) return 'waiting';
  return 'active';
}

export function setSlackShared(order,shared,now=new Date().toISOString()){
  if(!needsHeadOfficeShare(order))return {...order};
  const status=isPickupOrder(order)?(order.delivered?'done':shared?'waiting':'active'):(shared?'done':'active');
  return {...order,slackShared:Boolean(shared),slackSharedAt:shared?(order?.slackSharedAt||now):'',workflowStatus:status};
}

export function statusOnConfirmation(order,previousOrder){
  if(isPickupOrder(order)){
    if(order.delivered)return 'done';
    if(order.slackShared)return 'waiting';
    if(!previousOrder||!isPickupOrder(previousOrder))return 'active';
    return groupOf(order);
  }
  if(!needsHeadOfficeShare(order)||order.slackShared)return 'done';
  if(!previousOrder||!needsHeadOfficeShare(previousOrder))return 'active';
  return groupOf(order);
}

export function nextAction(order){
  if(isDone(order)) return {key:'done',label:'内容を見る'};
  if(order?.type===ORDER_TYPE.NORMAL) return {key:'done',label:'内容を見る'};
  if(needsHeadOfficeShare(order) && !order?.headOfficeShared) return {key:'share',label:'本社共有済みにする'};
  if(order?.handoff===HANDOFF.NOW || order?.handoff===HANDOFF.LATER) return {key:'deliver',label:'会計・商品お渡し完了'};
  return {key:'detail',label:'内容を確認'};
}

export function labelOrder(order){
  if(order?.type===ORDER_TYPE.NORMAL) return '国内通常注文';
  const h={now:'現売り・その場渡し',later:'現売り・後日受取',hotel:'現売り・ホテル配送',ship:'現売り・指定先配送'}[order?.handoff]||'現売り';
  return h;
}

export function compareOrdersForPrint(a,b){
  const categoryRank=order=>order?.type===ORDER_TYPE.NORMAL?0:({now:1,later:2,hotel:3,ship:4}[order?.handoff]??5);
  const categoryDiff=categoryRank(a)-categoryRank(b);if(categoryDiff)return categoryDiff;
  const compareText=(left,right)=>String(left??'').trim().localeCompare(String(right??'').trim(),'ja',{numeric:true,sensitivity:'base'});
  const accountA=String(a?.account??'').trim(),accountB=String(b?.account??'').trim();
  if(Boolean(accountA)!==Boolean(accountB))return accountA?-1:1;
  return compareText(accountA,accountB)||compareText(a?.store,b?.store)||compareText(a?.customer,b?.customer)||compareText(a?.createdAt,b?.createdAt)||compareText(a?.receiptNo||a?.localId,b?.receiptNo||b?.localId);
}

export function printFileBase(orders,{customerCopy=false,now=new Date()}={}){
  const list=(orders||[]).filter(order=>!order?.deleted);
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const value=type=>parts.find(part=>part.type===type)?.value||'';
  const stamp=`${value('year')}${value('month')}${value('day')}_${value('hour')}${value('minute')}`;
  const clean=value=>String(value||'').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,60)||'お客様名なし';
  if(list.length!==1)return `全注文_${stamp}`;
  return `${customerCopy?(list[0].customerRegion==='overseas'?'Customer_Copy':'お客様控え'):'注文書'}_${clean(list[0].customer||list[0].store)}_${stamp}`;
}

export function handoffLabel(order){
  if(order?.type===ORDER_TYPE.NORMAL) return '帰社後にまとめて印刷';
  if(order?.handoff===HANDOFF.NOW) return 'その場で会計・お渡し';
  if(order?.handoff===HANDOFF.LATER) return order?.pickupDate ? `${order.pickupDate} 受取予定` : '後日受取';
  if(order?.handoff===HANDOFF.HOTEL) return `本社対応・ホテル配送${order?.hotelName?`（${order.hotelName}）`:''}`;
  if(order?.handoff===HANDOFF.SHIP) return '本社対応・指定先配送';
  return '-';
}

const CLOUD_ORDER_FIELDS=Object.freeze([
  'receiptNo','type','handoff','customerRegion','store','phone','customer','workflowStatus',
  'account','accountChoice','accountOther','staff','paymentMethod','paid','paidAt',
  'delivered','deliveredAt','shipped','prepared','headOfficeShared','headOfficeSharedAt',
  'slackShared','slackSharedAt',
  'pickupDate','notes','hotelName','guestName','roomNo','checkoutDate','shipAddress',
]);

export function orderPayloadForCloud(order){
  const payload={};
  for(const field of CLOUD_ORDER_FIELDS)payload[field]=order?.[field]??'';
  payload.paid=Boolean(order?.paid);
  payload.delivered=Boolean(order?.delivered);
  payload.shipped=Boolean(order?.shipped);
  payload.headOfficeShared=Boolean(order?.headOfficeShared);
  payload.slackShared=Boolean(order?.slackShared);
  payload.items=(order?.items||[]).map(item=>({
    productId:String(item?.productId||''),
    code:String(item?.code||''),
    name:String(item?.name||''),
    price:Number(item?.price||0),
    imageUrl:String(item?.imageUrl||''),
    status:String(item?.status||''),
    orderable:Boolean(item?.orderable),
    lineId:String(item?.lineId||''),
    qty:Number(item?.qty||0),
  }));
  return payload;
}

export function orderFromCloudRow(row){
  const payload=row?.payload&&typeof row.payload==='object'&&!Array.isArray(row.payload)?row.payload:{};
  return {
    ...payload,
    pickupNumber:/^[1-9][0-9]*$/.test(String(row?.pickup_number||''))?String(row.pickup_number):'',
    items:Array.isArray(payload.items)?payload.items.map(item=>({...item})):[],
    localId:String(row?.id||''),
    clientSubmissionId:String(row?.id||''),
    createdAt:row?.created_at||'',
    updatedAt:row?.updated_at||'',
    cloudUpdatedAt:row?.updated_at||'',
    syncState:'synced',
  };
}

export function normalizeForSave(draft){
  const now=new Date().toISOString();
  return {
    ...draft,
    localId:draft.localId||`L-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`,
    createdAt:draft.createdAt||now,
    updatedAt:now,
    prepared:draft.prepared||PREP.NONE,
    paid:Boolean(draft.paid), delivered:Boolean(draft.delivered), shipped:Boolean(draft.shipped),
    deliveredAt:draft.deliveredAt||'',paidAt:draft.paidAt||'',
    headOfficeShared:Boolean(draft.headOfficeShared), headOfficeSharedAt:draft.headOfficeSharedAt||'',
    slackShared:Boolean(draft.slackShared), slackSharedAt:draft.slackSharedAt||'',
    syncState:draft.syncState||'memory',
  };
}

export function applyAction(order,action){
  const now=new Date().toISOString(),next={...order,updatedAt:now};
  if(action==='share'){
    next.headOfficeShared=true;
    next.headOfficeSharedAt=now;
  }
  if(action==='deliver'){
    next.paid=true;
    next.delivered=true;
    next.prepared=PREP.READY;
  }
  return next;
}
