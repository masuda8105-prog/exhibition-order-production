import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {ORDER_SENSITIVE_FIELDS,wipeOrderData} from '../security.js';

test('下書き単体もすべての顧客欄と数量を消去できる',()=>{
  const draft=Object.fromEntries(ORDER_SENSITIVE_FIELDS.map(field=>[field,'value']));
  draft.items=[{qty:99}];
  assert.equal(wipeOrderData(draft),draft);
  for(const field of ORDER_SENSITIVE_FIELDS)assert.equal(draft[field],'');
  assert.deepEqual(draft.items,[]);
});

test('Git追跡対象に非公開マスターと生成設定を含めない',()=>{
  const root=new URL('..',import.meta.url);
  const tracked=execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).replaceAll('\\','/').split(/\r?\n/);
  for(const path of ['product_master.csv','online-config.js','mobile-production-test.png','exhibition_order_production_preview.html'])assert.equal(tracked.includes(path),false,path);
  assert.equal(tracked.some(path=>path.startsWith('outputs/')),false);
});

test('公開ソースにブラウザ用秘密鍵の形式を含めない',async()=>{
  const files=['app.js','index.html','workflow.js','security.js','scripts/config.mjs','.env.example'];
  for(const file of files){
    const source=await readFile(new URL(`../${file}`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/service_role|sb_secret_|SUPABASE_SERVICE_ROLE|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,file);
  }
});
