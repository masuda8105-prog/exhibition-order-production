import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeExhibition,groupReports} from '../report-model.js';
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
