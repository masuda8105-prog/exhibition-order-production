// Text is saved synchronously in this tab; prepared photos use IndexedDB.
const storagePrefix='exhibitionOps.reportDraft.v1.';
export const reportDraftHasInput=value=>Boolean(value&&(value.comment||value.photos?.length||value.product!==undefined||value.category||value.editingId||value.pendingPayload));
// A pending draft in this tab takes priority over another tab's daily selection.
export function findSavedReportDraftEvent(user,events){
  if(!user)return '';
  try{
    const tab=sessionStorage.getItem('exhibitionOps.reportDraftTab');if(!tab)return '';
    for(const event of events){
      const value=JSON.parse(sessionStorage.getItem(`${storagePrefix}${tab}.${user}.${event.id}`)||'null');
      if(reportDraftHasInput(value?.draft)||reportDraftHasInput(value?.suspended))return event.id;
    }
  }catch{}
  return '';
}
let database;
function db(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('exhibition-report-drafts',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('photos');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  return database;
}
async function photoRecord(key,value,write=false){
  const database=await db();return new Promise((resolve,reject)=>{
    const transaction=database.transaction('photos',write?'readwrite':'readonly'),store=transaction.objectStore('photos');
    const request=write?store.put(value,key):store.get(key);
    transaction.oncomplete=()=>resolve(request.result);transaction.onerror=()=>reject(transaction.error);
  });
}
function serializable(draft){
  return draft?{...draft,photos:(draft.photos||[]).map(({url,blob,...photo})=>photo)}:null;
}
export function createReportDraftStorage(onError){
  let tab;
  try{tab=sessionStorage.getItem('exhibitionOps.reportDraftTab')||crypto.randomUUID();sessionStorage.setItem('exhibitionOps.reportDraftTab',tab);}catch{tab=crypto.randomUUID();}
  const key=(user,event)=>`${storagePrefix}${tab}.${user}.${event}`;
  let queue=Promise.resolve(),warned=false;const photoSets=new Map();
  function warn(){if(!warned){warned=true;onError();}}
  return {
    save(user,event,draft,suspended){
      if(!user||!event)return;
      const recordKey=key(user,event),value={draft:serializable(draft),suspended:serializable(suspended)};
      try{sessionStorage.setItem(recordKey,JSON.stringify(value));}catch{warn();}
      const blobs=[...(draft?.photos||[]),...(suspended?.photos||[])].filter(photo=>photo.blob).map(photo=>({id:photo.id,blob:photo.blob}));
      const photoSet=blobs.map(photo=>photo.id).join(',');
      if(photoSets.get(recordKey)===photoSet)return;
      photoSets.set(recordKey,photoSet);
      // Serialize writes so an older photo set cannot replace a newer set.
      queue=queue.then(async()=>photoRecord(recordKey,await Promise.all(blobs.map(async photo=>({id:photo.id,bytes:await photo.blob.arrayBuffer(),type:photo.blob.type}))),true)).catch(()=>{photoSets.delete(recordKey);warn();});
    },
    async load(user,event){
      let value;try{value=JSON.parse(sessionStorage.getItem(key(user,event))||'null');}catch{warn();return null;}
      if(!value)return null;
      let blobs=[];try{blobs=await photoRecord(key(user,event))||[];}catch{warn();}
      for(const draft of [value.draft,value.suspended].filter(Boolean)){
        draft.photos=(draft.photos||[]).map(photo=>{
          const record=blobs.find(item=>item.id===photo.id);
          const blob=record?.bytes?new Blob([record.bytes],{type:record.type}):record?.blob;
          return blob?{...photo,blob,url:URL.createObjectURL(blob)}:photo;
        });
      }
      return value;
    },
    flush(){return queue;},
  };
}
