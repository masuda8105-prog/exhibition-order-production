import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [app,migration,builder]=await Promise.all([
  readFile(new URL('../app.js',import.meta.url),'utf8'),
  readFile(new URL('../supabase/migrations/20260901090000_private_product_master.sql',import.meta.url),'utf8'),
  readFile(new URL('../scripts/build-site.mjs',import.meta.url),'utf8'),
]);

test('商品マスターは認証後にSupabaseからページ単位で取得する',()=>{
  assert.match(app,/loadAllRows\('products'/);
  assert.match(app,/pageSize=1000/);
  assert.match(app,/Authorization=`Bearer \$\{state\.session\.access_token\}`/);
  assert.doesNotMatch(app,/fetch\(cfg\.productCsv/);
  assert.doesNotMatch(app,/product_master\.csv/);
});

test('商品と帳合先はRLSを有効化し匿名権限を付与しない',()=>{
  for(const table of ['products','exhibition_accounts']){
    assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration,new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
    assert.match(migration,new RegExp(`grant select on table public\\.${table} to authenticated`));
  }
  assert.match(migration,/where staff\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration,/staff\.active = true/);
});

test('公開ビルドはコードと一般公開ロゴだけを許可リストで収録する',()=>{
  assert.match(builder,/const files=\[/);
  for(const file of ['index.html','styles.css','app.js','workflow.js','security.js','assets/sun_nishimura_logo.jpg'])assert.match(builder,new RegExp(file.replace(/[.]/g,'\\.')));
  for(const privatePattern of ['product_master','outputs','mobile-production-test','exhibition_order_production_preview'])assert.doesNotMatch(builder,new RegExp(privatePattern));
});
