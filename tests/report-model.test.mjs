import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeExhibition,groupReports,groupReportsByAuthor} from '../report-model.js';
test('記入者ごとに同じ商品の複数コメントをまとめ、各記入者の中では古い順に追加する',()=>{
  const groups=groupReportsByAuthor([{id:'3',user_id:'masuda',author_name:'増田',created_at:'2026-10-08',comment:'追加コメント'},{id:'2',user_id:'miyagawa',author_name:'宮川',created_at:'2026-10-07',comment:'別の人のコメント'},{id:'1',user_id:'masuda',author_name:'増田',created_at:'2026-10-07',comment:'最初のコメント'}]);
  assert.equal(groups.length,2);const masuda=groups.find(group=>group.name==='増田');assert.deepEqual(masuda.reports.map(report=>report.comment),['最初のコメント','追加コメント']);
});
test('商品は売上額より数量を優先して並べ、合計には全商品を含める',()=>{
  const result=summarizeExhibition([{items:[{code:'A',qty:1,price:100000},{code:'B',qty:20,price:100},...Array.from({length:10},(_,i)=>({code:`C${i}`,qty:2+i,price:100}))]}]);
  assert.equal(result.products[0].code,'B');assert.equal(result.products.at(-1).code,'A');
  assert.equal(result.products.length,12);assert.equal(result.quantity,86);assert.equal(result.total,108500);
});
test('売上は確定注文のみ・商品点数に送料を含めない・注文別国内海外を保つ',()=>{
  const result=summarizeExhibition([
    {customerRegion:'domestic',items:[{code:'1065',name:'商品A',qty:2,price:1000},{productId:'service-shipping-700',qty:1,price:700}]},
    {customerRegion:'overseas',items:[{code:'1065',qty:3,price:900}]},
    {deleted:true,items:[{code:'1065',qty:100,price:1000}]},
    {confirmationState:'draft',items:[{code:'1065',qty:100,price:1000}]},
  ]);
  assert.equal(result.total,5400);assert.equal(result.domestic,2700);assert.equal(result.overseas,2700);
  assert.equal(result.count,2);assert.equal(result.quantity,5);assert.equal(result.products[0].amount,4700);
});
test('商品情報と会場全体を分けて時間順に整理し同じ時刻ではID順を保つ',()=>{
  const result=groupReports([
    {id:'b',product_code:'1065',created_at:'2026-10-08'},
    {id:'a',product_code:'1065',created_at:'2026-10-08'},
    {id:'c',product_code:null,category:'venue',created_at:'2026-10-07'},
    {id:'d',product_code:'858',created_at:'2026-10-07'},
  ]);
  assert.deepEqual(result.products.map(([code])=>code),['858','1065']);
  assert.deepEqual(result.products[1][1].map(item=>item.id),['a','b']);assert.equal(result.general[0].id,'c');
});

test('受け渡し方法は商品行数でなく確定注文の件数を集計する',()=>{
  const result=summarizeExhibition([
    ...['now','later','hotel','ship'].map(handoff=>({type:'spot',handoff,items:[{code:'A',qty:3,price:100},{code:'B',qty:2,price:100}]})),
    {type:'spot',handoff:'now'},{type:'normal',handoff:'hotel'},{type:'spot'},
    {type:'spot',handoff:'hotel',deleted:true},{type:'spot',handoff:'later',confirmationState:'draft'},
  ]);
  assert.deepEqual(result.handoffs,{now:2,later:1,hotel:1,ship:1,normal:1,unknown:1});
  assert.equal(Object.values(result.handoffs).reduce((a,b)=>a+b,0),result.count);
});
