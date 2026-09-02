import fs from 'node:fs/promises';
import path from 'node:path';

function parseEnv(text){
  const values={};
  for(const sourceLine of text.split(/\r?\n/)){
    const line=sourceLine.trim();
    if(!line||line.startsWith('#'))continue;
    const match=line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if(!match)continue;
    let value=match[2].trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    values[match[1]]=value;
  }
  return values;
}

export async function loadConfigEnvironment(root){
  let local={};
  try{local=parseEnv(await fs.readFile(path.join(root,'.env'),'utf8'))}catch(error){if(error?.code!=='ENOENT')throw error}
  return {...local,...process.env};
}

export function browserConfigSource(environment){
  const supabaseUrl=String(environment.SUPABASE_URL||'').replace(/\/$/,'');
  const publishableKey=String(environment.SUPABASE_PUBLISHABLE_KEY||'');
  const eventName=String(environment.EXHIBITION_EVENT_NAME||'展示会').trim();
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl))throw new Error('SUPABASE_URL is missing or invalid.');
  if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey))throw new Error('SUPABASE_PUBLISHABLE_KEY is missing or invalid.');
  const config={
    supabaseUrl,
    publishableKey,
    eventName,
    currency:'JPY',
  };
  return `/* Generated from environment variables. Do not commit this file. */\nwindow.EXHIBITION_CONFIG = Object.freeze(${JSON.stringify(config,null,2)});\n`;
}
