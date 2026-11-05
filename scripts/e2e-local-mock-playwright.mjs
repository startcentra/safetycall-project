#!/usr/bin/env node
// Headless browser smoke E2E. Requires Playwright installed in isolated CI.
import { pathToFileURL } from 'node:url';
const browserModule=process.env.SAFECALL_PLAYWRIGHT_ENTRY;
if(!browserModule)throw Error('Set SAFECALL_PLAYWRIGHT_ENTRY for isolated browser package');
const {chromium}=await import(pathToFileURL(browserModule).href);
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const base='http://127.0.0.1:4173';
const env={...process.env,META_LIVE_ENABLED:'false',META_VOICE_LIVE_ENABLED:'false',META_SPEND_APPROVED:'false',META_BUDGET_KILL_SWITCH:'true',SAFECALL_HOST:'127.0.0.1'};
const child=spawn(process.execPath,['--experimental-strip-types','demo/safety-challenge/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{logs+=String(data).slice(0,2000)});
let browser;
try{
 let ready=false;
 for(let i=0;i<60;i++){
  if(child.exitCode!==null)throw Error('demo process terminated: '+logs);
  try{const response=await fetch(base,{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 if(!ready)throw Error('Demo not ready on loopback: '+logs);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();
 const outbound=[];
 page.on('request',request=>{const url=new URL(request.url());if(url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')outbound.push(url.origin);});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});
 if(response.status()!==200)throw Error('Demo page returned '+response.status());
 await page.waitForTimeout(1200);
 const title=await page.title();
 const body=await page.locator('body').innerText();
 if(body.trim().length<100)throw Error('Demo body suspiciously empty');
 if(outbound.length)throw Error('Unexpected outbound browser requests: '+outbound.join(','));
 if(errors.length)throw Error('Browser JS errors: '+errors.join('; '));
 console.log(JSON.stringify({status:'PASS',title,bodyChars:body.length,externalRequests:0,jsErrors:0,mode:'LOCAL MOCK'}));
}finally{
 await browser?.close();
 child.kill('SIGTERM');
 if(child.exitCode===null)await Promise.race([once(child,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);
}
