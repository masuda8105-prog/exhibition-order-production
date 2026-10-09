import test from 'node:test';
import assert from 'node:assert/strict';
import {pickupNumberLabel,orderFromCloudRow,orderPayloadForCloud,orderMatchesSearch} from '../workflow.js';
test('お渡し番号はサーバー発行済みの展示会接頭辞を表示し、旧注文はNEOを維持する',()=>{
  for(const prefix of ['IMF','WOF','EGF','JEX','大阪展示会']){
    const order=orderFromCloudRow({id:'fixture',event_name:'別の開催回',pickup_number:1,pickup_prefix:prefix,payload:{type:'spot',handoff:'later'}});
    assert.equal(pickupNumberLabel(order),`${prefix}-1`);assert.equal(order.exhibitionName,'別の開催回');
    assert.ok(orderMatchesSearch(order,`${prefix}-1`));assert.equal(Object.hasOwn(orderPayloadForCloud(order),'pickupPrefix'),false);
  }
  assert.equal(pickupNumberLabel({type:'spot',handoff:'later',pickupNumber:'23'}),'NEO-23');
});
