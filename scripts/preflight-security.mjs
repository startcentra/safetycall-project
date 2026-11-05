/** Offline release preflight: checks local project inputs only, makes no network calls.
 * NOT a malware scanner, dependency vulnerability scanner, or runtime security certification.
 */
import {lstat, readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const failures=[];
const notices=[];
let count=0;
const forbiddenNames=new Set(['.env','.env.local','.env.production','id_rsa','id_ed25519']);
const skipDirs=new Set(['node_modules','.next','.git','coverage']);
async function inspect(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const name=entry.name;
    const p=path.join(dir,name);
    const rel=path.relative(root,p).replaceAll(path.sep,'/');
    if(entry.isSymbolicLink()){failures.push(`심볼릭 링크 발견: ${rel}`);continue;}
    if(forbiddenNames.has(name)||/\.(?:pem|p12|pfx|key)$/i.test(name))failures.push(`비밀키/환경 파일 후보: ${rel}`);
    if(entry.isDirectory()){
      if(skipDirs.has(name)){failures.push(`배포에서 제외할 디렉터리 포함: ${rel}`);continue;}
      await inspect(p);
    }else if(entry.isFile()){
      count++;
      const st=await lstat(p);
      if(st.size>5_000_000)notices.push(`큰 파일 검토 필요: ${rel} (${st.size})`);
      if(/\.(?:exe|dll|bat|ps1|scr|com)$/i.test(name))failures.push(`실행파일 후보: ${rel}`);
    }
  }
}
await inspect(root);
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if(pkg.private!==true)failures.push('package.json의 private이 true가 아님');
if(pkg.dependencies.next!=='16.4.3'||pkg.devDependencies['eslint-config-next']!=='16.4.3')failures.push('Next.js/ESLint 패치 버전 불일치');
if(pkg.dependencies.react!=='19.2.9'||pkg.dependencies['react-dom']!=='19.2.9')failures.push('React 버전 확인 필요');
try{await lstat(path.join(root,'package-lock.json'));}catch{notices.push('package-lock.json 없음: 설치 재현성 및 npm audit 검증 미완료');}
if(failures.length){console.error('RELEASE PREFLIGHT FAILED\n'+failures.join('\n'));process.exitCode=1;}
else console.log(`오프라인 사전검사 통과: ${count}개 파일 · 명백한 비밀 파일/심볼릭 링크/바이너리 후보 없음`);
for(const item of notices)console.log('미검증/주의: '+item);
console.log('전문 백신·외부 링크 평판·공급망 npm audit·브라우저·Next.js 빌드를 대신하지 않습니다.');
