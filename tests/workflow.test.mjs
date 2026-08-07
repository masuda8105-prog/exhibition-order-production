import test from 'node:test';import assert from 'node:assert/strict';
import {ORDER_TYPE,HANDOFF,PAYMENT,PREP,needsReceipt,validate,isDone,groupOf,nextAction,applyAction} from '../workflow.js';
const item={code:'1054',name:'x',price:100,qty:1};
test('国内通常注文は帳合先と担当必須',()=>{const o={type:ORDER_TYPE.NORMAL,items:[item],store:'A',phone:'1',account:'',staff:''};assert.equal(validate(o).length,2)});
test('即時現売りは受付番号不要',()=>{assert.equal(needsReceipt({type:ORDER_TYPE.SPOT,handoff:HANDOFF.NOW}),false)});
test('後日受取は受付番号必要',()=>{assert.equal(needsReceipt({type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER}),true)});
test('即時現売りは会計済み+渡済みで完了',()=>{const o={type:ORDER_TYPE.SPOT,handoff:HANDOFF.NOW,paid:true,delivered:true};assert.equal(isDone(o),true);assert.equal(groupOf(o),'done')});
test('後日受取は準備済みで受取待ち',()=>{const o={type:ORDER_TYPE.SPOT,handoff:HANDOFF.LATER,prepared:PREP.READY,paid:true,delivered:false};assert.equal(groupOf(o),'waiting');assert.equal(nextAction(o).key,'deliver')});
test('ホテル配送は発送済みまで完了しない',()=>{let o={type:ORDER_TYPE.SPOT,handoff:HANDOFF.HOTEL,prepared:PREP.READY,paid:true,shipped:false};assert.equal(isDone(o),false);o=applyAction(o,'ship');assert.equal(isDone(o),true)});
