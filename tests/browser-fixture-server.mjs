import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','_site');
const portArgument=process.argv.find(value=>value.startsWith('--port='));
const port=Number(portArgument?.slice('--port='.length)||process.env.BROWSER_FIXTURE_PORT||8766);
const keepPrint=process.argv.includes('--keep-print')||process.env.BROWSER_FIXTURE_KEEP_PRINT==='1';
const publicFiles=new Map([
  ['/','index.html'],
  ['/index.html','index.html'],
  ['/styles.css','styles.css'],
  ['/app.js','app.js'],
  ['/workflow.js','workflow.js'],
  ['/security.js','security.js'],
  ['/receipt-share.js','receipt-share.js'],
  ['/vendor/qrcode.min.js','vendor/qrcode.min.js'],
  ['/vendor/html2canvas.min.js','vendor/html2canvas.min.js'],
  ['/assets/sun_nishimura_logo.jpg','assets/sun_nishimura_logo.jpg'],
]);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg'};
const orders=new Map();
let pickupNumberSequence=0;
const allocatePickup=row=>{if(!row.pickup_number&&row.payload?.type==='spot'&&row.payload?.handoff==='later'&&!row.deleted_at)row.pickup_number=++pickupNumberSequence;return row};
const receiptImages=new Map(),signedImages=new Map();

function sendJson(response,status,value){
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  response.end(JSON.stringify(value));
}

async function readJson(request){
  const chunks=[];
  for await(const chunk of request)chunks.push(chunk);
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return{}}
}

const server=http.createServer(async(request,response)=>{
  const url=new URL(request.url||'/',`http://${request.headers.host||'127.0.0.1'}`);
  if(request.method==='OPTIONS'){
    response.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'apikey,authorization,content-type'});
    return response.end();
  }
  if(url.pathname==='/online-config.js'){
    response.writeHead(200,{'content-type':mime['.js'],'cache-control':'no-store'});
    return response.end(`window.EXHIBITION_CONFIG=Object.freeze({supabaseUrl:'http://127.0.0.1:${port}',publishableKey:'sb_publishable_browser_fixture',eventName:'検証用展示会',currency:'JPY'});`);
  }
  if(url.pathname==='/auth/v1/token'&&request.method==='POST'){
    const credentials=await readJson(request);
    const refresh=url.searchParams.get('grant_type')==='refresh_token'&&credentials.refresh_token==='fixture-refresh-token';
    if(!refresh&&(credentials.email!=='fixture@example.invalid'||credentials.password!=='fixture-password'))return sendJson(response,400,{error:'invalid_credentials'});
    return sendJson(response,200,{access_token:'fixture-access-token',refresh_token:'fixture-refresh-token',expires_in:3600,user:{id:'fixture-user'}});
  }
  if(url.pathname==='/auth/v1/logout')return sendJson(response,200,{});
  if(url.pathname.startsWith('/storage/v1/')){
    const signedPrefix='/storage/v1/object/sign/exhibition-receipts/',objectPrefix='/storage/v1/object/exhibition-receipts/';
    if(request.method==='GET'&&url.pathname.startsWith(signedPrefix)){
      const signed=signedImages.get(url.searchParams.get('token')),imagePath=url.pathname.slice(signedPrefix.length);
      if(!signed||signed.path!==imagePath||signed.expires<Date.now()||!receiptImages.has(imagePath))return sendJson(response,403,{error:'invalid_signature'});
      response.writeHead(200,{'content-type':'image/png','cache-control':'no-store'});return response.end(receiptImages.get(imagePath));
    }
    if(request.headers.authorization!=='Bearer fixture-access-token')return sendJson(response,401,{error:'login_required'});
    if(request.method==='POST'&&url.pathname.startsWith(objectPrefix)){
      const imagePath=url.pathname.slice(objectPrefix.length),order=orders.get(imagePath.split('/')[0]);
      if(!order||order.deleted_at)return sendJson(response,403,{error:'order_access_denied'});
      if(receiptImages.has(imagePath))return sendJson(response,400,{error:'Duplicate',statusCode:'409'});
      const chunks=[];for await(const chunk of request)chunks.push(chunk);const bytes=Buffer.concat(chunks);
      if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')return sendJson(response,400,{error:'not_png'});
      receiptImages.set(imagePath,bytes);return sendJson(response,200,{Key:`exhibition-receipts/${imagePath}`});
    }
    if(request.method==='POST'&&url.pathname.startsWith(signedPrefix)){
      const imagePath=url.pathname.slice(signedPrefix.length);if(!receiptImages.has(imagePath))return sendJson(response,404,{error:'not_found'});
      const body=await readJson(request),expires=Date.now()+body.expiresIn*1000;
      const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({url:`exhibition-receipts/${imagePath}`,iat:Math.floor(Date.now()/1000),exp:Math.floor(expires/1000)})).toString('base64url'),randomBytes(32).toString('base64url')].join('.');signedImages.set(token,{path:imagePath,expires});
      return sendJson(response,200,{signedURL:`/object/sign/exhibition-receipts/${imagePath}?token=${token}`});
    }
    return sendJson(response,403,{error:'private_bucket'});
  }
  if(url.pathname.startsWith('/rest/v1/')&&request.headers.authorization!=='Bearer fixture-access-token')return sendJson(response,401,{error:'login_required'});
  if(url.pathname==='/rest/v1/exhibition_app_orders'){
    const id=url.searchParams.get('id')?.replace(/^eq\./,'');
    if(request.method==='POST'){
      const body=await readJson(request);
      if(orders.has(body.id))return sendJson(response,409,{error:'duplicate'});
      const now=new Date().toISOString(),row=allocatePickup({...body,confirmation_state:body.payload?.confirmationState||'confirmed',pickup_number:null,created_at:now,updated_at:now,deleted_at:null});orders.set(body.id,row);
      return sendJson(response,201,[row]);
    }
    if(request.method==='PATCH'){
      const row=orders.get(id),expected=url.searchParams.get('updated_at')?.replace(/^eq\./,'');
      if(!row||row.deleted_at||(expected&&row.updated_at!==expected))return sendJson(response,200,[]);
      const body=await readJson(request);Object.assign(row,body,{confirmation_state:body.payload?.confirmationState||row.confirmation_state,pickup_number:row.pickup_number,updated_at:new Date(Date.now()+1).toISOString()});allocatePickup(row);return sendJson(response,200,[row]);
    }
    let list=[...orders.values()].filter(row=>!row.deleted_at&&(!id||row.id===id));
    const event=url.searchParams.get('event_name')?.replace(/^eq\./,'');if(event)list=list.filter(row=>row.event_name===event);
    list.sort((a,b)=>b.created_at.localeCompare(a.created_at));const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||500);
    return sendJson(response,200,list.slice(offset,offset+limit));
  }
  if(url.pathname==='/rest/v1/exhibition_staff')return sendJson(response,200,[{display_name:'検証担当',role:'staff',active:true}]);
  if(url.pathname==='/rest/v1/products')return sendJson(response,200,[
    {id:1,product_no:'TEST-001',product_name:'検証商品A',wholesale_price:100,image_url:null,is_active:true},
    {id:2,product_no:'TEST-002',product_name:'検証商品B',wholesale_price:250,image_url:null,is_active:true},
    {id:3,product_no:'TEST-PENDING',product_name:'価格未定の検証商品',wholesale_price:null,image_url:null,is_active:false},
  ]);
  if(url.pathname==='/rest/v1/exhibition_accounts')return sendJson(response,200,[
    {id:1,account_name:'検証帳合A',display_order:1,is_active:true},
    {id:2,account_name:'その他',display_order:2,is_active:true},
  ]);
  const relative=publicFiles.get(url.pathname);
  if(!relative)return sendJson(response,404,{error:'not_found'});
  try{
    let body=await fs.readFile(path.join(root,relative));
    if(relative==='app.js'&&!keepPrint)body=Buffer.from(body.toString('utf8').replace('window.print();',"window.__FIXTURE_PRINT_CALLED__=true;window.dispatchEvent(new Event('afterprint'));"));
    response.writeHead(200,{'content-type':mime[path.extname(relative)]||'application/octet-stream','cache-control':'no-store'});
    response.end(body);
  }catch(error){sendJson(response,500,{error:error.message})}
});

server.listen(port,'127.0.0.1',()=>console.log(`browser fixture listening on http://127.0.0.1:${port}`));
