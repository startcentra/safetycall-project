import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createDemoServer} from '../demo/safety-challenge/server.mjs';
test('local MOCK cannot bind to public IPv4 or wildcard interfaces',()=>{
 for(const host of ['0.0.0.0','192.168.1.10','::','8.8.8.8'])
  assert.throws(()=>createDemoServer({host,port:0}),/로컬/);
 const allowed=createDemoServer({host:'127.0.0.1',port:0});assert.ok(allowed.server);
});
test('Next.js security dependencies use confirmed 2026-10-31 stable release; React stays on patched branch',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.version,'1.0.6');assert.equal(pkg.dependencies.next,'16.4.3');
 assert.equal(pkg.devDependencies['eslint-config-next'],'16.4.3');
 assert.equal(pkg.dependencies.react,'19.2.9');assert.equal(pkg.dependencies['react-dom'],'19.2.9');
});
test('trusted official URL check rejects non-HTTPS, external, lookalike and credentialed addresses',async()=>{
 const ui=await readFile(new URL('../demo/safety-challenge/public/app.js',import.meta.url),'utf8');
 const start=ui.indexOf('const OFFICIAL_SOURCE_HOSTS=');
 const end=ui.indexOf('const childMode=',start);
 assert.ok(start!==-1&&end>start);
 const sandbox={URL,Set};runInNewContext(ui.slice(start,end)+';globalThis.validate=safeOfficialUrl;',sandbox);
 const check=sandbox.validate;
 for(const url of ['https://consumer.ftc.gov/articles/what-do-if-you-were-scammed','https://www.fsc.go.kr/no010101/87882','https://ecrm.police.go.kr/'])assert.equal(check(url),url);
 for(const url of ['javascript:alert(1)','http://consumer.ftc.gov/','https://consumer.ftc.gov.attacker.example/','https://evil.example/','https://user@consumer.ftc.gov/','https://consumer.ftc.gov:8443/','data:text/html,hello','/relative'])assert.equal(check(url),null);
 assert.match(ui,/safeOfficialUrl\(x\.url\)/);
});
test('offline preflight does not invoke npm, external network or code downloads',async()=>{
 const p=await readFile(new URL('../scripts/preflight-security.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(p,/\b(?:fetch\(|https\.request\(|execFile\(|spawn\()/);
 assert.match(p,/package-lock\.json 없음/);
});

test('guided-care official links fail closed on hostile URLs and escape link labels',async()=>{
 const ui=await readFile(new URL('../demo/safety-challenge/public/app.js',import.meta.url),'utf8');
 const start=ui.indexOf('const escapeHtml=');
 const end=ui.indexOf('const childMode=',start);
 assert.ok(start!==-1&&end>start);
 const sandbox={URL,Set};
 runInNewContext(ui.slice(start,end)+';globalThis.makeLinks=renderGuidedSourceLinks;',sandbox);
 const render=sandbox.makeLinks;
 const safe=render([{url:'https://consumer.ftc.gov/articles/what-do-if-you-were-scammed',label:'공식 자료 & <보안>'}]);
 assert.match(safe,/href="https:\/\/consumer\.ftc\.gov\/articles\/what-do-if-you-were-scammed"/);
 assert.match(safe,/공식 자료 &amp; &lt;보안&gt;/);
 assert.match(safe,/rel="noopener noreferrer"/);
 const evil=[
  'javascript:alert(1)', 'data:text/html,<h1>hijack</h1>', 'http://consumer.ftc.gov/',
  'https://consumer.ftc.gov.evil.example/phish', 'https://evil.example/',
  'https://user:pass@consumer.ftc.gov/', 'https://consumer.ftc.gov:8443/',
  '//evil.example/unsafe', '/relative', 'https://consumer.ftc.gov\\@evil.example/'
 ];
 for(const url of evil){
  const html=render([{url,label:'악성 링크'}]);
  assert.doesNotMatch(html,/<a\s/i,'blocked URL must not produce a link: '+url);
  assert.match(html,/국가별 공식 출처 미확인/);
 }
 const mixed=render([
  {url:'https://evil.example/unsafe',label:'악성'},
  {url:'https://www.fsc.go.kr/',label:'금융위원회'}
 ]);
 assert.equal((mixed.match(/<a\s/g)||[]).length,1);
 assert.match(mixed,/https:\/\/www\.fsc\.go\.kr\//);
 assert.doesNotMatch(mixed,/evil\.example/);
 assert.match(ui,/\$\('guided-sources'\)\.innerHTML=renderGuidedSourceLinks\(g\.sources\)/);
});
