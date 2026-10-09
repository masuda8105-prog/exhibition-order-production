import assert from 'node:assert/strict';
import test from 'node:test';
import {createDailyExhibitionPreference,exhibitionDay,exhibitionDisplayName} from '../exhibition-selection.js';
test('日付は日本時間で切り替わり、展示会名の年だけを表示から外す',()=>{
  assert.equal(exhibitionDay(new Date('2026-10-09T14:59:00Z')),'2026-10-09');
  assert.equal(exhibitionDay(new Date('2026-10-09T15:01:00Z')),'2026-10-10');
  assert.equal(exhibitionDisplayName('NEO TOKYO2026'),'NEO TOKYO');
  assert.equal(exhibitionDisplayName('EGF 2027（大阪）'),'EGF（大阪）');
  assert.equal(exhibitionDisplayName('WOF（2026年）'),'WOF');
  assert.equal(exhibitionDisplayName('IMF'),'IMF');
});
test('当日の展示会だけをユーザー別に記憶し、翌日や削除時には解除する',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  let user='staff1',day='2026-10-09';
  const preference=createDailyExhibitionPreference({storage,getUserId:()=>user,today:()=>day});
  assert.equal(preference.read(),'');preference.save('imf');assert.equal(preference.read(),'imf');
  user='staff2';assert.equal(preference.read(),'');preference.save('jex');assert.equal(preference.read(),'jex');
  user='staff1';assert.equal(preference.read(),'imf');preference.save('wof');assert.equal(preference.read(),'wof');
  day='2026-10-10';assert.equal(preference.read(),'');assert.equal(data.has('exhibitionOps.selectedToday.v1:staff1'),false);
  preference.save('egf');preference.forget();assert.equal(preference.read(),'');
});
test('ブラウザ保存が使えない場合も選択を妨げず、壊れた保存値やログイン前を無視する',()=>{
  const unavailable=new Proxy({},{get(){throw new Error('blocked')}});
  const preference=createDailyExhibitionPreference({storage:unavailable,getUserId:()=> 'staff'});
  assert.doesNotThrow(()=>preference.save('jex'));assert.equal(preference.read(),'');assert.doesNotThrow(()=>preference.forget());
  assert.equal(createDailyExhibitionPreference({storage:{getItem:()=>'{broken'},getUserId:()=> 'staff'}).read(),'');
  assert.equal(createDailyExhibitionPreference({storage:{getItem(){throw new Error('should not access')}},getUserId:()=>null}).read(),'');
});
