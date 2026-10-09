import assert from 'node:assert/strict';
import test from 'node:test';
import {summarizeSales,salesOptions,emptySalesFilters} from '../sales-model.js';
import {summarizeExhibition} from '../report-model.js';
const item=(code,qty,price)=>({code,name:`商品${code}`,qty,price});
const orders=[
  {localId:'a',store:'眼鏡店A',account:'卸A',staff:'増田',customerRegion:'domestic',createdAt:'2026-10-07T14:59:00Z',confirmationState:'confirmed',type:'normal',workflowStatus:'done',items:[item('1',2,100),item('1',3,90),item('2',1,200),{productId:'service-shipping-700',code:'送料',qty:1,price:700}]},
  {localId:'b',store:'眼鏡店A',account:'卸A',staff:'宮川',customerRegion:'domestic',createdAt:'2026-10-07T15:01:00Z',confirmationState:'confirmed',type:'spot',handoff:'later',slackShared:true,items:[item('1',4,110)]},
  {localId:'c',store:'海外店',account:'卸B',staff:'宮川',customerRegion:'overseas',createdAt:'2026-10-08T00:00:00Z',confirmationState:'confirmed',workflowStatus:'active',items:[item('2',10,150)]},
  {localId:'d',store:'未確定店',account:'卸B',staff:'増田',customerRegion:'overseas',createdAt:'2026-10-08T03:00:00Z',confirmationState:'draft',items:[item('1',30,100)]},
  {localId:'e',deleted:true,items:[item('1',99,999)]},
];
test('全体売上は旧集計と一致し、商品は送料を除外して重複明細も1注文として集計する',()=>{
  const s=summarizeSales(orders),old=summarizeExhibition(orders);
  for(const key of ['total','domestic','overseas','count','quantity'])assert.equal(s[key],old[key]);
  assert.equal(s.total,3310);assert.equal(s.quantity,20);assert.equal(s.pending,1);
  assert.equal(s.products.find(p=>p.code==='1').count,2);assert.equal(s.products.find(p=>p.code==='1').amount,910);
  assert.equal(s.stores.length,2);assert.equal(s.stores.find(p=>p.name==='眼鏡店A').count,2);
  assert.deepEqual(s.status,{active:1,waiting:1,done:1});
  assert.deepEqual(s.days.map(day=>[day.date,day.amount]),[['2026-10-07',1370],['2026-10-08',1940]]);
});
test('卸屋・国内海外・担当者・商品・日本時間の期間を組み合わせて購入店舗と全内訳を一致させる',()=>{
  const filters={...emptySalesFilters(),region:'domestic',account:'卸A',staff:'宮川',product:'1',from:'2026-10-08',to:'2026-10-08'},s=summarizeSales(orders,filters);
  assert.equal(s.total,440);assert.equal(s.count,1);assert.equal(s.quantity,4);assert.equal(s.average,440);
  for(const key of ['staff','accounts','stores','products','days'])assert.equal(s[key].reduce((total,row)=>total+row.amount,0),s.total);
  assert.equal(s.orders[0].localId,'b');assert.equal(s.pending,0);
  assert.equal(summarizeSales(orders,{...filters,region:'overseas'}).total,0);
});
test('商品選択時は別の商品・送料を売上に加えず未確定注文は履歴用に残す',()=>{
  const s=summarizeSales(orders,{...emptySalesFilters(),product:'1'});
  assert.equal(s.total,910);assert.equal(s.quantity,9);assert.equal(s.count,2);assert.equal(s.pending,1);assert.equal(s.matched.length,3);
  assert.equal(s.products.length,1);assert.equal(s.products[0].code,'1');
});
test('未登録の店舗を架空の1店にまとめず、空の条件や不正な期間を安全に扱う',()=>{
  const missing=[{...orders[0],localId:'x',store:''},{...orders[0],localId:'y',store:''}];
  const s=summarizeSales(missing);assert.equal(s.missingStores,2);assert.equal(s.stores.length,2);
  assert.equal(summarizeSales(orders,{...emptySalesFilters(),from:'2026-10-09',to:'2026-10-08'}).count,0);
  assert.equal(summarizeSales([]).average,0);
  assert.equal(salesOptions(orders).products.some(item=>item.code==='送料'),false);
  assert.deepEqual(salesOptions(orders).accounts,['卸A','卸B']);
});
test('店舗名・商品名・お客様名を検索し、海外が未登録の旧注文は国内に含める',()=>{
  assert.equal(summarizeSales(orders,{...emptySalesFilters(),search:'海外店'}).total,1500);
  assert.equal(summarizeSales(orders,{...emptySalesFilters(),search:'商品2'}).count,2);
  assert.equal(summarizeSales([{...orders[0],customerRegion:undefined}],{...emptySalesFilters(),region:'domestic'}).count,1);
});
