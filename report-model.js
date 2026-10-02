import {isUnconfirmed,isShippingItem,totalOf} from './workflow.js';

export const REPORT_CATEGORIES=[
  {id:'positive',short:'好反応',title:'満足情報'},
  {id:'negative',short:'要望・不満',title:'不満足情報・要望'},
  {id:'venue',short:'会場',title:'会場の雰囲気／運営'},
  {id:'other',short:'その他',title:'その他気づき・次回課題'},
];
export function summarizeExhibition(orders){
  const result={total:0,domestic:0,overseas:0,count:0,quantity:0,products:[]};
  const products=new Map();
  for(const order of orders){
    if(order.deleted||isUnconfirmed(order))continue;
    const amount=totalOf(order);result.total+=amount;result.count++;
    result[order.customerRegion==='overseas'?'overseas':'domestic']+=amount;
    for(const item of order.items||[]){
      if(isShippingItem(item))continue;
      const code=String(item.code||''),entry=products.get(code)||{code,name:item.name||'',quantity:0,amount:0};
      entry.quantity+=Number(item.qty||0);entry.amount+=Number(item.qty||0)*Number(item.price||0);
      result.quantity+=Number(item.qty||0);products.set(code,entry);
    }
  }
  result.products=[...products.values()].sort((a,b)=>b.quantity-a.quantity||b.amount-a.amount||a.code.localeCompare(b.code,'ja',{numeric:true}));
  return result;
}
export function groupReports(reports){
  const products=new Map(),general=[];
  for(const report of [...reports].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)))){
    if(!report.product_code){general.push(report);continue;}
    const code=String(report.product_code);if(!products.has(code))products.set(code,[]);products.get(code).push(report);
  }
  return {products:[...products.entries()].sort(([a],[b])=>a.localeCompare(b,'ja',{numeric:true})),general};
}
export function groupReportsByAuthor(reports){
  const groups=new Map();
  const sorted=[...reports].sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id)));
  for(const report of sorted){
    const key=report.user_id||report.author_name||'unknown';
    if(!groups.has(key))groups.set(key,{id:key,name:report.author_name||'記入者不明',reports:[]});
    const group=groups.get(key);group.name=report.author_name||group.name;group.reports.push(report);
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ja')||a.id.localeCompare(b.id));
}
