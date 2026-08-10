import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function splitCsv(line){
  const cells=[];let current='',quoted=false;
  for(let index=0;index<line.length;index++){
    const char=line[index];
    if(char==='"'){
      if(quoted&&line[index+1]==='"'){current+='"';index++}else quoted=!quoted;
    }else if(char===','&&!quoted){cells.push(current);current=''}else current+=char;
  }
  cells.push(current);return cells;
}

const text=(await readFile(new URL('../product_master.csv',import.meta.url),'utf8')).replace(/^\uFEFF/,'').trim();
const [headerLine,...lines]=text.split(/\r?\n/);
const headers=splitCsv(headerLine);
const rows=lines.map(line=>Object.fromEntries(headers.map((header,index)=>[header,splitCsv(line)[index]??''])));

test('最新版マスターは3,861商品',()=>assert.equal(rows.length,3861));
test('改定価格が反映されている',()=>{
  assert.equal(rows.find(row=>row.code==='200')?.price,'11100');
  assert.equal(rows.find(row=>row.code==='1091')?.price,'5490');
});
test('価格未定2商品だけが注文不可',()=>{
  const pending=rows.filter(row=>row.status==='price_pending');
  assert.deepEqual(pending.map(row=>row.code).sort(),['141-801','141-802']);
  assert.equal(rows.filter(row=>row.status==='active'&&!(Number(row.price)>0)).length,0);
});
test('重複コード63463は別商品として保持',()=>{
  const duplicated=rows.filter(row=>row.code==='63463');
  assert.equal(duplicated.length,2);
  assert.deepEqual(duplicated.map(row=>row.price).sort((a,b)=>Number(a)-Number(b)),['345','19300']);
});
