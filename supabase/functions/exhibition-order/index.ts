import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
};

Deno.serve((request:Request)=>{
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  return new Response(JSON.stringify({error:"cloud_order_storage_disabled"}),{status:410,headers});
});
