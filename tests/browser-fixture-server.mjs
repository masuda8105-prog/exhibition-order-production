import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

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
  ['/assets/sun_nishimura_logo.jpg','assets/sun_nishimura_logo.jpg'],
]);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg'};

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
    if(credentials.email!=='fixture@example.invalid'||credentials.password!=='fixture-password')return sendJson(response,400,{error:'invalid_credentials'});
    return sendJson(response,200,{access_token:'fixture-access-token',refresh_token:'fixture-refresh-token',expires_in:3600,user:{id:'fixture-user'}});
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
    if(relative==='app.js'&&!keepPrint)body=Buffer.from(body.toString('utf8').replace('window.print();','window.__FIXTURE_PRINT_CALLED__=true;'));
    response.writeHead(200,{'content-type':mime[path.extname(relative)]||'application/octet-stream','cache-control':'no-store'});
    response.end(body);
  }catch(error){sendJson(response,500,{error:error.message})}
});

server.listen(port,'127.0.0.1',()=>console.log(`browser fixture listening on http://127.0.0.1:${port}`));
