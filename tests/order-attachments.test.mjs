import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttachmentStore,validatePhoto,MAX_PHOTOS,MAX_PHOTO_BYTES} from '../order-attachments.js';
import {validOfficePhotoPaths,orderPayloadForCloud,orderFromCloudRow} from '../workflow.js';

test('写真だけを受け付け、空ファイル・20MB超・SVGやPDFを拒否する',()=>{
  for(const type of ['image/jpeg','image/png','image/webp','image/heic','image/heif'])assert.equal(validatePhoto({type,size:MAX_PHOTO_BYTES,name:'image'}),'');
  assert.equal(validatePhoto({type:'',size:10,name:'camera.HEIC'}),'');
  for(const file of [{size:0,type:'image/jpeg'},{size:MAX_PHOTO_BYTES+1,type:'image/png'},{size:10,type:'application/pdf',name:'order.pdf'},{size:10,type:'image/svg+xml',name:'image.svg'},{size:10,type:'text/html',name:'photo.jpg'}])assert.ok(validatePhoto(file));
});

test('写真は注文ごとに分け、6枚制限と削除で不要な画像URLを解放する',()=>{
  const revoked=[],store=createAttachmentStore(url=>revoked.push(url));
  for(let i=0;i<MAX_PHOTOS;i++)assert.equal(store.add('A',{id:String(i),url:`blob:${i}`}),true);
  assert.equal(store.add('A',{id:'overflow',url:'blob:overflow'}),false);assert.deepEqual(revoked,['blob:overflow']);
  assert.equal(store.add('B',{id:'other',url:'blob:other'}),true);store.remove('A','0');assert.equal(store.list('A').length,5);assert.equal(store.list('B').length,1);
  store.clearOrder('A');assert.equal(store.list('A').length,0);assert.equal(store.list('B').length,1);store.clear();assert.equal(store.hasPhotos(),false);assert.equal(new Set(revoked).size,8);
});

test('ログアウトや新規注文後に遅い画像処理が終わっても写真を復活させない',()=>{
  const revoked=[],store=createAttachmentStore(url=>revoked.push(url)),generation=store.generation;
  store.clear();assert.equal(store.add('old',{id:'late',url:'blob:late'},generation),false);assert.equal(store.hasPhotos(),false);assert.deepEqual(revoked,['blob:late']);
});

test('会社控え写真の保存先は注文内の非公開パスだけを同期する',()=>{
  const id='00000000-0000-4000-8000-000000000001',path=`${id}/${'a'.repeat(32)}.png`;
  assert.deepEqual(validOfficePhotoPaths([path,path,'other.png',`${id}/../escape.png`],id),[path]);
  const payload=orderPayloadForCloud({localId:id,items:[],officePhotoPaths:[path,'other.png']});
  assert.deepEqual(payload.officePhotoPaths,[path]);
  assert.deepEqual(orderFromCloudRow({id,payload}).officePhotoPaths,[path]);
});
