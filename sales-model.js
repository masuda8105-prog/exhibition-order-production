import {createdDateInTokyo,groupOf,isShippingItem,isUnconfirmed,totalOf,orderMatchesSearch} from './workflow.js?v=20261009-events1';

export const emptySalesFilters=()=>({region:'',account:'',staff:'',product:'',from:'',to:'',search:''});
export const salesName=value=>String(value||'').trim()||'未登録';
export const salesProductKey=item=>String(item.code||item.productId||'商品番号未登録');
const regionOf=order=>order.customerRegion==='overseas'?'overseas':'domestic';
const collate=(a,b)=>a.localeCompare(b,'ja',{numeric:true});
const productItems=order=>(order.items||[]).filter(item=>!isShippingItem(item));
export function salesOptions(orders){
  const live=orders.filter(order=>!order.deleted),products=new Map();
  for(const order of live)for(const item of productItems(order)){
    const code=salesProductKey(item);if(!products.has(code))products.set(code,{code,name:item.name||''});
  }
  return {accounts:[...new Set(live.map(order=>salesName(order.account)))].sort(collate),staff:[...new Set(live.map(order=>salesName(order.staff)))].sort(collate),products:[...products.values()].sort((a,b)=>collate(a.code,b.code))};
}
export function filterSalesOrders(orders,filters){
  if(filters.from&&filters.to&&filters.from>filters.to)return [];
  return orders.filter(order=>{
    if(order.deleted)return false;
    if(filters.region&&regionOf(order)!==filters.region)return false;
    if(filters.account&&salesName(order.account)!==filters.account)return false;
    if(filters.staff&&salesName(order.staff)!==filters.staff)return false;
    if(filters.product&&!productItems(order).some(item=>salesProductKey(item)===filters.product))return false;
    const date=createdDateInTokyo(order);
    if(filters.from&&(!date||date<filters.from)||filters.to&&(!date||date>filters.to))return false;
    return !filters.search||orderMatchesSearch(order,filters.search);
  });
}
export function salesOrderValue(order,product=''){
  const items=productItems(order).filter(item=>!product||salesProductKey(item)===product);
  return {amount:product?items.reduce((sum,item)=>sum+Number(item.qty||0)*Number(item.price||0),0):totalOf(order),quantity:items.reduce((sum,item)=>sum+Number(item.qty||0),0),items};
}
// All totals describe confirmed orders. Product selection counts only the selected
// lines, while order counts and workflow states remain at the order grain.
export function summarizeSales(orders,filters=emptySalesFilters()){
  const matched=filterSalesOrders(orders,filters),confirmed=matched.filter(order=>!isUnconfirmed(order));
  const result={matched,orders:confirmed,total:0,domestic:0,overseas:0,count:confirmed.length,quantity:0,pending:matched.length-confirmed.length,average:0,stores:[],accounts:[],staff:[],products:[],days:[],status:{active:0,waiting:0,done:0},missingStores:0};
  const maps={stores:new Map(),accounts:new Map(),staff:new Map(),products:new Map(),days:new Map()};
  function add(map,key,base,value){
    const entry=map.get(key)||{...base,count:0,quantity:0,amount:0};
    entry.count++;entry.quantity+=value.quantity;entry.amount+=value.amount;map.set(key,entry);
  }
  for(const order of confirmed){
    const value=salesOrderValue(order,filters.product),region=regionOf(order),account=salesName(order.account),staff=salesName(order.staff),store=salesName(order.store);
    result.total+=value.amount;result[region]+=value.amount;result.quantity+=value.quantity;result.status[groupOf(order)]++;
    // Do not merge unrelated orders with no store name into a fictional customer.
    if(store==='未登録')result.missingStores++;
    const storeKey=JSON.stringify([store,region,account,store==='未登録'?order.localId||order.id||order.createdAt:'']);
    add(maps.stores,storeKey,{key:storeKey,name:store,region,account},value);
    add(maps.accounts,account,{name:account},value);add(maps.staff,staff,{name:staff},value);
    const day=createdDateInTokyo(order);if(day)add(maps.days,day,{date:day},value);
    // Count a product once per order, even if it occurs in multiple lines.
    const perOrder=new Map();
    for(const item of value.items){
      const code=salesProductKey(item),line=perOrder.get(code)||{code,name:item.name||'',quantity:0,amount:0};
      line.quantity+=Number(item.qty||0);line.amount+=Number(item.qty||0)*Number(item.price||0);perOrder.set(code,line);
    }
    for(const [code,line] of perOrder)add(maps.products,code,{code,name:line.name},line);
  }
  result.average=result.count?result.total/result.count:0;
  const byAmount=(a,b)=>b.amount-a.amount||b.quantity-a.quantity||collate(a.name,b.name);
  for(const key of ['stores','accounts','staff'])result[key]=[...maps[key].values()].sort(byAmount);
  result.products=[...maps.products.values()].sort((a,b)=>b.quantity-a.quantity||b.amount-a.amount||collate(a.code,b.code));
  result.days=[...maps.days.values()].sort((a,b)=>collate(a.date,b.date));
  return result;
}
