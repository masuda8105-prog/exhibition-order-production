export const ORDER_TYPE = Object.freeze({ NORMAL:'normal', SPOT:'spot' });
export const HANDOFF = Object.freeze({ NOW:'now', LATER:'later', HOTEL:'hotel', SHIP:'ship' });
export const PAYMENT = Object.freeze({ CREDIT:'credit', CASH:'cash', NONE:'none' });
export const PREP = Object.freeze({ NONE:'none', PREPARING:'preparing', READY:'ready' });

export function needsHeadOfficeShare(order){
  return order?.type===ORDER_TYPE.SPOT && [HANDOFF.LATER,HANDOFF.HOTEL,HANDOFF.SHIP].includes(order?.handoff);
}

export function needsReceipt(order){
  return order?.type===ORDER_TYPE.SPOT && order?.handoff===HANDOFF.LATER;
}

export function totalOf(order){
  return (order?.items||[]).reduce((sum,item)=>sum + Number(item.price||0)*Number(item.qty||0),0);
}

export function customerNameWithHonorific(name){
  const value=String(name??'').trim();
  if(!value) return '-';
  return /(?:様|さま|御中|殿)$/.test(value)?value:`${value} 様`;
}

export function receiptInternalInfo(order,{customerCopy=false}={}){
  if(customerCopy) return {showStatus:false,showCreatedAt:false,showGuide:false,headOfficeShare:''};
  return {
    showStatus:true,
    showCreatedAt:true,
    showGuide:true,
    headOfficeShare:needsHeadOfficeShare(order)?(order?.headOfficeShared?'共有済み':'未共有'):'',
  };
}

export function validate(order){
  const errors=[];
  if(!(order?.items||[]).length) errors.push('商品を1点以上追加してください。');
  if((order?.items||[]).some(item=>!String(item?.code||'').trim()||!String(item?.name||'').trim())) errors.push('商品情報が不完全です。商品を選び直してください。');
  if((order?.items||[]).some(item=>!Number.isFinite(Number(item?.price))||Number(item.price)<=0)) errors.push('価格未定の商品は注文できません。');
  if((order?.items||[]).some(item=>!Number.isInteger(Number(item?.qty))||Number(item.qty)<=0)) errors.push('商品数量が不正です。');
  if(!String(order?.store||'').trim()) errors.push('店舗名は必須です。');
  if(!String(order?.phone||'').trim()) errors.push('電話番号は必須です。');
  if(order?.type===ORDER_TYPE.NORMAL){
    if(!String(order?.account||'').trim()) errors.push('卸屋・帳合先は必須です。');
    if(!String(order?.staff||'').trim()) errors.push('受注担当者は必須です。');
  }
  if(order?.type===ORDER_TYPE.SPOT){
    if(!String(order?.customer||'').trim()) errors.push('お客様名は必須です。');
    if(![PAYMENT.CREDIT,PAYMENT.CASH].includes(order?.paymentMethod)) errors.push('会計方法を選択してください。');
    if(!Object.values(HANDOFF).includes(order?.handoff)) errors.push('受け渡し方法を選択してください。');
    if(order?.handoff===HANDOFF.LATER && !order?.pickupDate) errors.push('受取予定日を選択してください。');
    if(order?.handoff===HANDOFF.HOTEL){
      if(!String(order?.hotelName||'').trim()) errors.push('ホテル名は必須です。');
      if(!String(order?.guestName||'').trim()) errors.push('宿泊者名は必須です。');
    }
    if(order?.handoff===HANDOFF.SHIP && !String(order?.shipAddress||'').trim()) errors.push('配送先住所は必須です。');
  }
  return errors;
}

export function isDone(order){
  if(order?.deleted) return false;
  if(order?.type===ORDER_TYPE.NORMAL) return true;
  if(order?.handoff===HANDOFF.NOW) return Boolean(order?.paid && order?.delivered);
  if(order?.handoff===HANDOFF.LATER) return Boolean(order?.headOfficeShared && order?.paid && order?.delivered);
  if([HANDOFF.HOTEL,HANDOFF.SHIP].includes(order?.handoff)) return Boolean(order?.headOfficeShared);
  return false;
}

export function groupOf(order){
  if(isDone(order)) return 'done';
  if(order?.type===ORDER_TYPE.SPOT && order?.handoff===HANDOFF.LATER && order?.headOfficeShared) return 'waiting';
  return 'active';
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

export function handoffLabel(order){
  if(order?.type===ORDER_TYPE.NORMAL) return '帰社後にまとめて印刷';
  if(order?.handoff===HANDOFF.NOW) return 'その場で会計・お渡し';
  if(order?.handoff===HANDOFF.LATER) return order?.pickupDate ? `${order.pickupDate} 受取予定` : '後日受取';
  if(order?.handoff===HANDOFF.HOTEL) return `本社対応・ホテル配送${order?.hotelName?`（${order.hotelName}）`:''}`;
  if(order?.handoff===HANDOFF.SHIP) return '本社対応・指定先配送';
  return '-';
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
    headOfficeShared:Boolean(draft.headOfficeShared), headOfficeSharedAt:draft.headOfficeSharedAt||'',
    syncState:draft.syncState||'local',
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
