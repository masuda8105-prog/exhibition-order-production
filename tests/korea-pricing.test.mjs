import test from 'node:test';
import assert from 'node:assert/strict';
import {roundKoreaUnitPrice,koreaProductAtTier,totalOf,batchSummary,normalizeForSave,orderPayloadForCloud,orderFromCloudRow} from '../workflow.js';

test('Korea unit prices round half up to 1,000 won',()=>{
  for(const [input,expected] of [[67700,68000],[66501,67000],[66500,67000],[66499,66000],[4900,5000],[4499,4000]])
    assert.equal(roundKoreaUnitPrice(input),expected);
});
test('round each selected unit before quantity and preserve catalog data',()=>{
  const product={productId:'kr-test',price:66500,price165:66499,orderable:true};
  const selected=koreaProductAtTier(product,'1.7');
  assert.equal(selected.price,67000);
  assert.equal(koreaProductAtTier(product,'1.65').price,66000);
  assert.equal(totalOf({market:'KR',items:[{...selected,qty:2}]}),134000);
  assert.equal(product.price,66500);
  const saved=orderFromCloudRow({id:'kr-test',payload:orderPayloadForCloud(normalizeForSave({market:'KR',items:[{...selected,qty:2}]}))});
  assert.equal(saved.items[0].price,67000);
  assert.equal(totalOf(saved),134000);
  assert.equal(batchSummary([saved]).total,134000);
});
test('domestic prices and saved historical Korea orders remain unchanged',()=>{
  const domestic={productId:'product-1',price:66500,orderable:true};
  assert.equal(koreaProductAtTier(domestic,'1.7'),domestic);
  assert.equal(koreaProductAtTier(domestic,'1.65'),domestic);
  const old={market:'KR',items:[{price:66500,qty:2}]};
  assert.equal(totalOf(normalizeForSave(old)),133000);
  assert.equal(old.items[0].price,66500);
});
