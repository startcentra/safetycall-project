import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const entry=process.env.SAFECALL_PLAYWRIGHT_ENTRY;
if(!entry)throw Error('Browser testing package path is required');
const {chromium}=await import(pathToFileURL(entry).href);
const port=4174, origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'-H','127.0.0.1'],{env:{...process.env,META_LIVE_ENABLED:'false',META_VOICE_LIVE_ENABLED:'false',META_SPEND_APPROVED:'false',META_BUDGET_KILL_SWITCH:'true',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
let output='';for(const s of [child.stdout,child.stderr])s.on('data',d=>output+=String(d).slice(0,3000));
let browser;
try{
 let ready=false;for(let i=0;i<70;i++){try{const r=await fetch(origin+'/lab/bank-arrival',{signal:AbortSignal.timeout(800)});if(r.status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250));}
 if(!ready)throw Error('Next app unavailable: '+output.slice(-1800));
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 await mkdir('artifacts/ui',{recursive:true});
 for(const device of [{name:'iphone',width:402,height:874},{name:'galaxy',width:360,height:780}]){
  console.log('Starting '+device.name+' browser flow');
  const page=await browser.newPage({viewport:{width:device.width,height:device.height},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  console.log('Page navigation '+device.name);
  await page.goto(origin+'/lab/bank-arrival',{waitUntil:'networkidle',timeout:20000});
  console.log('Test risk call '+device.name);
  await page.getByRole('button',{name:'가상 전화 시작'}).click();
  await page.getByRole('button',{name:'GPS 근접 시뮬레이션'}).click();
  if(await page.getByRole('button',{name:'카드 잠금',exact:true}).isEnabled())throw Error('GPS alone authorized bank action!');
  await page.getByRole('button',{name:'은행에 도착했어요'}).click();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button',{name:'카드 잠금',exact:true}).click();
  if(!(await page.getByText('LOCKED').count()))throw Error('Card mock state missing');
  await page.getByRole('button',{name:'가상 송금 보류'}).click();
  if(!(await page.getByText('HELD').count()))throw Error('Transfer hold absent');
  console.log('Capture screenshot '+device.name);
  await page.screenshot({path:'artifacts/ui/v110-'+device.name+'.png',fullPage:true});
  await page.getByLabel('Language').selectOption('US');
  if(await page.getByText('HELD').count())throw Error('Language switching retained previous bank state');
  if(errors.length)throw Error('Browser page errors: '+errors.join(','));
  if(await page.locator('html').evaluate(el=>el.scrollWidth>el.clientWidth+2))throw Error('Horizontal overflow at '+device.width);
  console.log('PASS '+device.name+' '+device.width+'x'+device.height);
  await page.close();
 }
}finally{await browser?.close();child.kill('SIGTERM');}
