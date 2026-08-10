export const ORDER_TYPE = Object.freeze({ NORMAL:'normal', SPOT:'spot' });
export const HANDOFF = Object.freeze({ NOW:'now', LATER:'later', HOTEL:'hotel', SHIP:'ship' });
export const PAYMENT = Object.freeze({ CREDIT:'credit', CASH:'cash', NONE:'none' });
export const PREP = Object.freeze({ NONE:'none', PREPARING:'preparing', READY:'ready' });

export function needsReceipt(order){
  return order?.type === ORDER_TYPE.SPOT && [HANDOFF.LATER,HANDOFF.HOTEL,HANDOFF.SHIP].includes(order?.handoff);
}

export function totalOf(order){
  return (order?.items||[]).reduce((sum,item)=>sum + Number(item.price||0)*Number(item.qty||0),0);
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
    if(!String(order?.account||'').trim()) errors.push('帳合先は必須です。');
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
  if(order?.type===ORDER_TYPE.NORMAL) return Boolean(order?.submitted);
  if(order?.handoff===HANDOFF.HOTEL || order?.handoff===HANDOFF.SHIP) return Boolean(order?.paid && order?.shipped);
  return Boolean(order?.paid && order?.delivered);
}

export function groupOf(order){
  if(isDone(order)) return 'done';
  if(order?.type===ORDER_TYPE.SPOT){
    if(order?.handoff===HANDOFF.LATER && order?.prepared===PREP.READY) return 'waiting';
    if([HANDOFF.HOTEL,HANDOFF.SHIP].includes(order?.handoff) && order?.prepared===PREP.READY) return 'waiting';
  }
  return 'active';
}

export function nextAction(order){
  if(isDone(order)) return {key:'done',label:'対応済み'};
  if(order?.type===ORDER_TYPE.NORMAL) return {key:'submit',label:order?.submissionState==='pending'?'注文書を再送':'注文書を送信'};
  if(order?.handoff===HANDOFF.NOW){
    if(!order?.paid) return {key:'pay',label:'会計済みにする'};
    if(!order?.delivered) return {key:'deliver',label:'商品を渡して完了'};
  }
  if(order?.handoff===HANDOFF.LATER){
    if(order?.prepared!==PREP.READY) return {key:'prepare',label:order?.prepared===PREP.PREPARING?'商品準備完了':'商品準備を開始'};
    if(!order?.paid) return {key:'pay',label:'会計済みにする'};
    if(!order?.delivered) return {key:'deliver',label:'商品を渡して完了'};
  }
  if([HANDOFF.HOTEL,HANDOFF.SHIP].includes(order?.handoff)){
    if(order?.prepared!==PREP.READY) return {key:'prepare',label:order?.prepared===PREP.PREPARING?'商品準備完了':'商品準備を開始'};
    if(!order?.paid) return {key:'pay',label:'会計済みにする'};
    if(!order?.shipped) return {key:'ship',label:'発送して完了'};
  }
  return {key:'detail',label:'内容を確認'};
}

export function labelOrder(order){
  if(order?.type===ORDER_TYPE.NORMAL) return '国内通常注文';
  const region=order?.customerRegion==='overseas'?'海外':'国内';
  const h={now:'即時現売り',later:'後日受取',hotel:'ホテル配送',ship:'指定先配送'}[order?.handoff]||'現売り';
  return `${region}・${h}`;
}

export function handoffLabel(order){
  if(order?.type===ORDER_TYPE.NORMAL) return '後日通常出荷';
  if(order?.handoff===HANDOFF.NOW) return 'その場で持ち帰り';
  if(order?.handoff===HANDOFF.LATER) return order?.pickupDate ? `${order.pickupDate} 会場受取` : '後日会場受取';
  if(order?.handoff===HANDOFF.HOTEL) return `ホテル配送${order?.hotelName?`・${order.hotelName}`:''}`;
  if(order?.handoff===HANDOFF.SHIP) return '指定先配送';
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
    paid:Boolean(draft.paid), delivered:Boolean(draft.delivered), shipped:Boolean(draft.shipped), submitted:Boolean(draft.submitted),
    syncState:draft.syncState||'local',
  };
}

export function applyAction(order,action){
  const next={...order,updatedAt:new Date().toISOString()};
  if(action==='pay') next.paid=true;
  if(action==='deliver') next.delivered=true;
  if(action==='ship') next.shipped=true;
  if(action==='submit') next.submitted=true;
  if(action==='prepare') next.prepared=next.prepared===PREP.PREPARING?PREP.READY:PREP.PREPARING;
  return next;
}
