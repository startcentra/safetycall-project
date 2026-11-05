import { requestJson, ApiError, isCaseState, delayForRetry, validateTransferInput, createLogEvent, replaceDemoSession } from './mobile-client.js';
import { inspectReplayWav, makeReplaySegment, replayEligibility } from './replay-wav.js';
/* SafeCall v1.24 mobile shell — same session/Case Coordinator/SSE contract as legacy app.js.
   No API keys, no real calls/money/location storage. Server remains the only authority.
   v1.22: per-view skeletons, accessible confirm sheet, local transfer-input validation,
   multi-tab reconciliation, map fallback and PII-free structured client logs. */
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const S={state:null,busy:false,pendingAction:null,auth:null,childToken:null,glassesToken:null,view:'home',call:'incoming',sec:0,timer:null,tts:false,mapPos:null,events:null,connection:'CONNECTING',booted:false,epoch:0,needsReconcile:false,sessionInvalid:false,initializing:false,mapRequest:0,viewPhase:'IDLE',logs:[],confirmResolve:null,lastFocus:null,skTimer:null,channel:null,mapTimer:null};
function logEvent(level,eventType,extra={}){try{const e=createLogEvent({level,component:'mobile',eventType,caseVersion:S.state?.version,view:S.view,...extra});S.logs.push(e);if(S.logs.length>60)S.logs.shift();if(typeof window!=='undefined')window.__SAFECALL_CLIENT_LOG__=S.logs;}catch{}}
function setViewPhase(view,phase){S.viewPhase=phase;const sec=$('view-'+view);if(!sec)return;sec.setAttribute('aria-busy',String(phase==='LOADING'||phase==='REFRESHING'));sec.dataset.phase=phase;
 const sk=sec.querySelector('[data-skeleton-for]');const ind=$('refresh-indicator');
 if(phase==='LOADING'){clearTimeout(S.skTimer);S.skTimer=setTimeout(()=>{if(S.viewPhase==='LOADING'&&sk)sk.hidden=false;},180);}
 else if(phase==='REFRESHING'){if(ind)ind.hidden=false;if(sk)sk.hidden=true;}
 else{clearTimeout(S.skTimer);if(sk)sk.hidden=true;if(ind)ind.hidden=true;}}
function showInlineAlert(message){const box=$('inline-alert');if(!box)return;$('inline-alert-text').textContent=message;box.hidden=false;}
function hideInlineAlert(){const box=$('inline-alert');if(box)box.hidden=true;}
const KEY='safecall-local-session-v100';
const setT=(id,t)=>{const e=$(id);if(e)e.textContent=t};
const fmt=iso=>iso?new Date(iso).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'';
function toast(message, severity='info') { const t=$('toast');t.textContent=message;t.dataset.severity=severity;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),4600) }
function setConnection(value, message='') {
 S.connection=value;
 const bar=$('connection-bar');bar.hidden=value==='CONNECTED';const banner=$('connection-banner');
 const labels={CONNECTING:'서버 연결 중…',RECONNECTING:'연결이 끊겼습니다. 재연결 중…',OFFLINE:'오프라인 · 마지막으로 확인된 화면입니다',FAILED:'연결 실패 · 재시도 필요'};
 banner.textContent=message||labels[value]||'';
 if(value!=='CONNECTED')setT('stage-note',message||labels[value]);
}
function lockLostSession() {
 S.sessionInvalid=true;S.needsReconcile=true;S.events?.close();
 setConnection('FAILED','기존 서버 세션을 확인할 수 없습니다. 새 가상 세션은 직접 시작해야 합니다.');
 setPhase('error','기존 서버 세션이 만료되었거나 서버 재시작으로 사라졌습니다. 이 화면의 이전 사건 정보는 새 서버에서 검증할 수 없습니다. 새 세션 시작은 사용자가 직접 선택해야 합니다.');
 if(S.state)render();updatePending();logEvent('warn','session_unavailable',{errorCode:'FORBIDDEN',result:'error'});
}
function setPhase(phase, message=''){
 const skeleton=$('mobile-skeleton'),error=$('mobile-error');
 skeleton.hidden=phase!=='loading';error.hidden=phase!=='error';
 if(phase==='error'){setT('error-heading','데모 화면을 불러오지 못했습니다');setT('error-copy',message||'서버 연결을 확인하고 다시 시도하세요. 기존 사건은 자동으로 삭제하지 않습니다.');}
}
function safeSessionRead() { try { const v=JSON.parse(sessionStorage.getItem(KEY)||'null');return v && typeof v.sessionId==='string' && typeof v.token==='string' && v.sessionId.length<256 && v.token.length<512?v:null; }catch{return null} }
function safeSessionWrite(s) {try{sessionStorage.setItem(KEY,JSON.stringify(s));return true}catch{return false}}
function clearSession(){try{sessionStorage.removeItem(KEY)}catch{}}
function authH(){return S.auth?{'X-SafeCall-Session':S.auth.sessionId,'X-SafeCall-Token':S.auth.token}:{}}
async function api(ep,body){return requestJson('/api/'+ep,{method:'POST',body,headers:authH(),validate:ep==='session/create'?d=>isCaseState(d)&&!!d.sessionCredentials?.parentToken&&!!d.sessionCredentials?.sessionId:isCaseState})}
async function refresh({quiet=false,allowInvalid=false}={}){
 if((S.sessionInvalid&&!allowInvalid)||!S.auth||S.busy)return {ok:false,skipped:true};
 const epoch=S.epoch, auth=S.auth;const started=performance.now();
 setViewPhase(S.view,S.state?'REFRESHING':'LOADING');
 try{
  const latest=await requestJson('/api/state',{headers:authH(),validate:isCaseState});
  if(epoch!==S.epoch||auth!==S.auth)return {ok:false,skipped:true};
  // A background refresh can only move the SAME case forward; explicit reset is handled by mutate().
  if(S.state&&latest.runId!==S.state.runId){logEvent('warn','case_id_changed_on_refresh',{result:'conflict'});setViewPhase(S.view,'CONFLICT');showInlineAlert('사건 ID가 변경되었습니다. 서버 최신 상태를 확인하세요.');return {ok:false,skipped:true};}
  if(!S.state||latest.version>=S.state.version){S.state=latest;render();}
  S.sessionInvalid=false;S.needsReconcile=false;setConnection('CONNECTED');setPhase('ready');setViewPhase(S.view,'SUCCESS');logEvent('info','state_refresh',{durationMs:Math.round(performance.now()-started),result:'ok'});render();return {ok:true,state:S.state};
 }catch(error){if(epoch!==S.epoch)return {ok:false,skipped:true};
  if(['AUTH_REQUIRED','FORBIDDEN'].includes(error.code)){lockLostSession();return {ok:false,error};}
  setConnection(error.code==='NETWORK_ERROR'?'OFFLINE':'FAILED');setViewPhase(S.view,error.code==='NETWORK_ERROR'?'OFFLINE':'ERROR');logEvent('warn','state_refresh',{durationMs:Math.round(performance.now()-started),errorCode:error.code,result:'error'});
  if(!quiet&&!S.state)setPhase('error',error.message);
  return {ok:false,error};
 }
}
async function mutate(ep,ex={}){
 if(S.busy||S.sessionInvalid||!S.state)return {ok:false,skipped:true};
 if(S.needsReconcile){toast('이전 명령 처리 상태를 확인하기 전에는 새로운 명령을 전송할 수 없습니다.','warning');return {ok:false,skipped:true};}
 const previous=S.state,epoch=++S.epoch;const started=performance.now();const cmdType=ex.type||ex.action||ep;
 S.busy=true;S.pendingAction=ex.type||ex.action||ep;updatePending();
 try{
  const next=await api(ep,{runId:previous.runId,expectedVersion:previous.version,...ex});
  if(epoch!==S.epoch||S.sessionInvalid)return {ok:false,skipped:true};
  if(ep!=='reset'&&next.runId!==previous.runId)throw new ApiError('INVALID_RESPONSE','사건 ID가 변경되었습니다. 서버 상태를 확인하세요.');
  if(ep!=='reset'&&next.version<previous.version)throw new ApiError('INVALID_RESPONSE','오래된 서버 응답이 감지되었습니다.');
  S.state=next;setConnection('CONNECTED');setViewPhase(S.view,'SUCCESS');hideInlineAlert();logEvent('info','command',{commandType:cmdType,durationMs:Math.round(performance.now()-started),result:'ok',caseVersion:next.version});
  try{S.channel?.postMessage({runId:next.runId,version:next.version});}catch{}
  return {ok:true,state:next};
 }catch(error){
  if(['AUTH_REQUIRED','FORBIDDEN'].includes(error.code))lockLostSession();
  logEvent('warn','command',{commandType:cmdType,durationMs:Math.round(performance.now()-started),errorCode:error.code,result:error.code==='VERSION_CONFLICT'?'conflict':'error'});
  if(error.code==='VERSION_CONFLICT'||error.code==='CASE_VERSION_CONFLICT'){toast('사건 정보가 바뀌었습니다. 서버 최신 상태를 확인합니다.','warning');showInlineAlert('다른 화면이나 탭에서 사건이 변경되었습니다. 서버 최신 상태를 확인한 뒤 다시 시도하세요.');setViewPhase(S.view,'CONFLICT');}
  else if(error.code==='EMERGENCY_LOCK'){toast('긴급 상황에서는 가상 카드 잠금을 해제할 수 없습니다.','warning');showInlineAlert(error.message||'긴급 상황에서는 가상 카드 잠금을 해제할 수 없습니다.');}
  else if(error.code==='PROXIMITY_LOCK'){toast('가상 은행 근처에서는 가상 카드 잠금을 해제할 수 없습니다.','warning');showInlineAlert(error.message||'가상 은행 근처에서는 가상 카드 잠금을 해제할 수 없습니다.');}
  else if(error.code==='POLICY_DENIED'){toast('정책 조건이 충족되지 않아 진행할 수 없습니다.','warning');showInlineAlert((error.message||'정책 조건이 충족되지 않았습니다.')+' 긴급 상황에서는 은행 보호보다 먼저 안전 확보와 긴급 도움을 우선하세요. 가상 은행 상태는 변경되지 않았습니다.');}
  else if(error.code==='COMMAND_REPLAY_CONFLICT'){toast('같은 명령이 다른 내용으로 다시 전송되어 차단했습니다.','warning');showInlineAlert('중복 명령 충돌이 감지되어 자동 재실행하지 않았습니다. 서버 상태를 확인하세요.');}
  else if(error.code==='CASE_ENDED'){toast('종료된 사건에는 새 명령을 보낼 수 없습니다.','warning');showInlineAlert('이 사건은 종료되었습니다. 새 사건을 시작해야 새 명령을 보낼 수 있습니다.');}
  else if(error.code==='TIMEOUT'||error.code==='NETWORK_ERROR'){toast('처리 결과를 확인할 수 없습니다. 재전송하지 않고 서버 상태를 조회합니다.','warning');showInlineAlert('명령 처리 여부를 확인할 수 없습니다. 자동 재전송하지 않았습니다. 서버 상태를 다시 확인하세요.');}
  else {toast(error.message||'요청 처리에 실패했습니다.','error');showInlineAlert(error.message||'요청 처리에 실패했습니다. 서버 상태를 확인하세요.');}
  if(['TIMEOUT','NETWORK_ERROR','INVALID_RESPONSE'].includes(error.code)){S.needsReconcile=true;setConnection('RECONNECTING','처리 결과 미확인 · 서버 상태 재조회 전까지 명령이 잠깁니다.');}
  return {ok:false,error};
 }finally{
  if(epoch===S.epoch){S.busy=false;S.pendingAction=null;render();await refresh({quiet:true});}
 }
}
function updatePending(){
 for(const el of document.querySelectorAll('[data-action-pending]')){
  const active=S.busy&&el.dataset.actionPending===S.pendingAction;
  el.classList.toggle('is-pending',active);el.setAttribute('aria-busy',String(active));
 }
 const transfer=$('btn-tx');transfer.disabled=S.busy||S.needsReconcile||S.sessionInvalid||!S.state||!!S.state?.endedAt;
 $('btn-endcase').disabled=S.busy||S.needsReconcile||S.sessionInvalid||!S.state||!!S.state?.endedAt;
 $('btn-newcase').disabled=S.busy||S.needsReconcile||S.sessionInvalid||!S.state;
 $('stage-next').disabled=S.busy||S.needsReconcile||S.sessionInvalid||!S.state||!!S.state.callEndedAt||!!S.state.endedAt;
 for(const id of ['demo-restart','demo-step']){const el=$(id);if(el)el.disabled=S.busy||S.needsReconcile||S.sessionInvalid||!S.state;}
 $('m-scenario').disabled=S.busy||S.needsReconcile||S.sessionInvalid||!S.state;
 $('map-arrival').disabled=S.busy||S.needsReconcile||S.sessionInvalid||!S.state||!!S.state?.endedAt;
}
function sse(){
 if(!S.auth||S.sessionInvalid)return;S.events?.close();
 const controller=new AbortController();let closed=false;
 const onEvent=d=>{
  if(closed||!isCaseState(d))return;
  if(!S.state){S.state=d;render();return}
  if(d.runId!==S.state.runId){if(!S.busy)void refresh({quiet:true});return}
  if(d.version>=S.state.version&&!S.busy){S.state=d;render()}
 };
 (async()=>{let attempt=0;
  while(!closed){
   try{
    if(!navigator.onLine){setConnection('OFFLINE');await new Promise(r=>setTimeout(r,1200));continue}
    const r=await fetch('/api/events',{cache:'no-store',credentials:'same-origin',headers:authH(),signal:controller.signal});
    if(r.status===401||r.status===403){lockLostSession();return}
    if(!r.ok||!r.body)throw new Error('SSE unavailable');
    const rd=r.body.getReader(),dc=new TextDecoder();let buf='';
    await refresh({quiet:true});if(!closed)setConnection('CONNECTED');attempt=0;
    while(!closed){const c=await rd.read();if(c.done)break;buf+=dc.decode(c.value,{stream:true}).replaceAll('\r\n','\n');if(buf.length>262144)throw new Error('SSE frame too large');let b;
      while((b=buf.indexOf('\n\n'))>=0){const f=buf.slice(0,b);buf=buf.slice(b+2);
        if(f.startsWith('event: state\n')){const raw=f.split('\n').filter(x=>x.startsWith('data: ')).map(x=>x.slice(6)).join('\n');try{onEvent(JSON.parse(raw))}catch{}}
      }
    }
   }catch{if(closed)return}
   if(closed)return;
   setConnection(navigator.onLine?'RECONNECTING':'OFFLINE');
   const backoff=delayForRetry(attempt++);
   await new Promise(r=>setTimeout(r,backoff));
  }
 })();
 S.events={close(){closed=true;controller.abort()}};
}
function go(v){S.view=v;for(const el of document.querySelectorAll('.view'))el.classList.toggle('on',el.id==='view-'+v);for(const b of document.querySelectorAll('.tabbar button'))b.classList.toggle('on',b.dataset.go===v);if(!S.state)setViewPhase(v,'LOADING');else if(S.needsReconcile)setViewPhase(v,'CONFLICT');render()}
function confirmDialog(title,copy,okLabel='확인'){return new Promise(resolve=>{const sheet=$('confirm-sheet');if(!sheet){resolve(false);return}S.lastFocus=document.activeElement;S.confirmResolve=resolve;$('confirm-title').textContent=title;$('confirm-copy').textContent=copy;$('confirm-ok').textContent=okLabel;sheet.hidden=false;requestAnimationFrame(()=>$('confirm-cancel')?.focus());});}
function closeConfirm(value){const sheet=$('confirm-sheet');if(sheet)sheet.hidden=true;const r=S.confirmResolve;S.confirmResolve=null;try{S.lastFocus?.focus?.();}catch{}if(r)r(value);}
let scenarioReturnFocus=null;
function syncScenarioUi(){const s=S.state;const label=s?`${s.scenario.name} (${s.scenario.id})`:'—';setT('scenario-current',label);for(const b of document.querySelectorAll('[data-scenario-option]')){b.setAttribute('aria-selected',String(!!s&&b.dataset.scenarioOption===s.scenario.id));b.disabled=S.busy||S.needsReconcile;}
 const sel=$('m-scenario');if(sel&&s&&sel.value!==s.scenario.id)sel.value=s.scenario.id;}
function openScenarioSheet(){const sh=$('scenario-sheet');if(!sh)return;syncScenarioUi();scenarioReturnFocus=document.activeElement;sh.hidden=false;requestAnimationFrame(()=>$('scenario-close')?.focus());}
function closeScenarioSheet(){$('scenario-sheet').hidden=true;try{scenarioReturnFocus?.focus?.();}catch{}}
async function chooseScenario(id){if(!S.state||S.busy)return;if(S.state.scenario.id===id){closeScenarioSheet();return;}closeScenarioSheet();const ok=await confirmDialog('시나리오 변경','새 가상 사건을 시작합니다. 이전 동의·가상 은행 상태는 초기화됩니다.','새 사건 시작');if(!ok)return;const result=await mutate('reset',{scenarioId:id,mode:'verified'});if(result.ok){S.call='incoming';const inc=$('phone-incoming'),inCall=$('phone-incall');if(inc)inc.hidden=false;if(inCall)inCall.hidden=true;toast('새 가상 사건이 시작되었습니다 · 새 Case ID가 발급되었습니다','success');go('home');}}
function initMultiTab(){try{if(typeof BroadcastChannel==='undefined')return;S.channel=new BroadcastChannel('safecall-v122-case');S.channel.onmessage=e=>{const d=e.data;if(!d||!S.state)return;if(d.runId===S.state.runId&&typeof d.version==='number'&&d.version!==S.state.version){setViewPhase(S.view,'CONFLICT');showInlineAlert('다른 탭에서 사건이 변경되었습니다. 서버 최신 상태를 확인합니다.');void refresh({quiet:true});}};}catch{}}
function phase(s){if(s.endedAt)return['RESOLVED','사건이 종료됐습니다','아래 기록에서 보호 행동과 후속 확인을 볼 수 있습니다.'];
 if(s.risk.emergency)return['PROTECTIVE_GUIDANCE','즉시 안전을 우선하세요',s.care?.primary||'현지 긴급기관 도움을 고려하세요.'];
 if(s.risk.band==='HIGH')return['REVIEW_REQUIRED','확인 없이 송금하지 마세요',s.care?.primary||'위험 근거가 확인됐습니다. 공식 채널로 독립 확인하세요.'];
 if(s.risk.band==='CAUTION')return['SIGNAL_DETECTED','주의 신호가 있습니다',s.care?.primary||'상대 주장을 사실로 확정하지 말고 천천히 확인하세요.'];
 if(s.metaReview?.status==='LIVE_VERIFIED'&&['HIGH','CAUTION'].includes(s.metaReview?.review?.riskLevel)&&s.metaReview.review.evidenceTurnIds.length)return ['META_PROVISIONAL_ADVISORY','Meta가 의심스러운 행동 요구를 관찰했습니다',s.metaReview.review.advisories[0]||'공식 채널로 독립 확인하세요.'];
 if(s.textAdvisory?.level==='PROTECT')return['PROVISIONAL_TEXT_PROTECTION','문장에 민감정보·자금 요구가 감지됐습니다',s.textAdvisory.guidance];
 if(s.textAdvisory?.level==='VERIFY')return['PROVISIONAL_TEXT_REVIEW','문장 문맥에 확인할 부분이 있습니다',s.textAdvisory.guidance];
 if(s.step>0||s.captionReplay?.elapsedMs>0||s.voiceFixture?.localSegmentCount>0)return['MONITORING_DEMO','가상 통화를 관찰 중입니다','아직 뚜렷한 위험 근거는 없습니다. 과도한 경고는 표시하지 않습니다.'];
 return['IDLE','보호 대기 중','위험 근거가 확인되면 다음 행동을 안내합니다.']}
function render(){
 if(replayLoaded&&(S.state?.runId!==replayLoaded.caseId||S.state?.endedAt||S.sessionInvalid)){clearReplay();replayStatus('사건 변경·종료 또는 세션 무효화로 로컬 WAV 미리보기를 폐기했습니다.');}const s=S.state;if(!s)return;if(lastVoiceCase!==s.runId){lastVoiceCase=s.runId;pendingLocalStt=null;
 if($('local-stt-confirm-box'))$('local-stt-confirm-box').hidden=true;
 if($('meta-consent-checkbox'))$('meta-consent-checkbox').checked=false;if($('msg-consent'))$('msg-consent').checked=false;if($('msg-review-consent'))$('msg-review-consent').checked=false;if($('local-stt-consent'))$('local-stt-consent').checked=false;
 if($('local-stt-review-consent'))$('local-stt-review-consent').checked=false;if($('voice-result'))$('voice-result').hidden=true;if($('voice-consent'))$('voice-consent').checked=false;setT('voice-status','MOCK 전사 실험은 가상 발화만 사용합니다. 실제 STT·Meta LIVE 호출 없음.');}const[ph,title,copy]=phase(s);
 setT('home-case',s.runId.slice(-8).toUpperCase());setT('widget-state',title);setT('bank-case',s.runId);setT('act-case',s.runId.slice(-8).toUpperCase());
 const extendedReplay=s.voiceFixture?.replayMode==='EXTENDED_120S';
 $('replay-extended-enable').disabled=extendedReplay||!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid||
   s.scenario.id!=='benign'||s.step!==0||s.voiceFixture?.localSegmentCount>0||!!replayLoaded;
 setT('replay-mode-status',extendedReplay?
   '120초/24구간 연구 모드 · 활성화됨. 자동 STT·위험 분석이 아니라 각 구간 동의 및 검토가 필요합니다.':
   '기본 40초/8구간 · 새 정상 가족 연락 사건에서 오디오 입력 전에만 확장할 수 있습니다.');
 const card=s.mockCard||{status:'ACTIVE',revision:0};setT('card-lock-state',card.status==='LOCKED'?'LOCKED · 가상 카드':'ACTIVE · 가상 카드');
 $('card-risk-report').disabled=!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid||s.cardExposureReported===true;
 $('card-lock').disabled=!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid||!s.mockCard||card.status!=='ACTIVE';
  $('card-unlock').disabled=!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid||!s.mockCard||card.status!=='LOCKED'||!!s.risk?.emergency||!!s.protectionGate?.blocked;
  setT('card-lock-note',s.risk?.emergency&&card.status==='LOCKED'?'위해 협박이 감지되어 가상 카드가 잠겼습니다. 긴급 상황이 이어지는 동안 해제할 수 없고, 실제 카드와 계좌이체에는 영향이 없습니다.':card.status==='LOCKED'&&s.protectionGate?.blocked?'가상 은행 근처에서 송금 요구가 감지되어 가상 카드가 잠겼습니다. 확인하면 해제할 수 있고, 실제 카드에는 영향이 없습니다.':card.status==='LOCKED'?'가상 카드만 잠겼습니다. 계좌이체 및 송금 보류에는 영향이 없습니다.':'은행 방문과 관계없이 사용자 확인 후 카드 잠금을 선택할 수 있습니다.');
 const highRisk=s.risk.band==='HIGH'||s.risk.emergency===true;
 const riskBanner=$('tx-risk-banner');if(riskBanner)riskBanner.hidden=!highRisk||!!s.endedAt;
 $('dot-phone').hidden=!(S.call==='incoming'&&s.step===0&&!s.endedAt&&!s.callEndedAt);$('dot-guard').hidden=s.risk.band==='LOW'&&s.textAdvisory?.level==='NONE'&&!(s.metaReview?.status==='LIVE_VERIFIED'&&['CAUTION','HIGH'].includes(s.metaReview?.review?.riskLevel));$('dot-bank').hidden=s.safeBank?.status!=='HELD';$('dot-messages').hidden=!s.messages?.entries?.some(m=>m.verdict==='QUARANTINED');
 setT('guard-phase',ph);setT('guard-title',title);setT('guard-copy',copy);
 const advisory=s.textAdvisory;setT('text-advisory-status',advisory?`${advisory.level} · ${advisory.evidence.map(e=>e.code+' ['+e.turnIds.join(',')+']').join(' · ')||'새로운 보조 근거 없음'} · ${advisory.guidance}`:'TEXT ONLY 대기');
 const meta=s.metaReview||{status:'DISABLED'},ready=s.modelReadiness?.enabled===true;
 const metaVerified=meta.status==='LIVE_VERIFIED'&&Array.isArray(meta.review?.evidenceTurnIds)&&meta.review.evidenceTurnIds.length>0;
 const metaPending=meta.status==='PENDING'||meta.status==='WAITING_LATEST';
 const metaDown=['ERROR','INPUT_REJECTED','BUDGET_EXHAUSTED','PROCESS_BUDGET_EXHAUSTED'].includes(meta.status);
 setT('ai-mode',metaVerified?'META LIVE VERIFIED':metaPending?'META ANALYSIS PENDING':metaDown?'META UNAVAILABLE / ERROR':'OFFLINE / SCRIPTED MOCK');
 setT('ai-copy',ready?'합성 대본 발화가 추가될 때 서버가 Muse Spark에 비동기로 요청합니다. 응답은 사건 버전·근거 ID를 검증한 잠정 보호 안내이며 위험 지수나 금융 정책을 변경하지 않습니다.':'현재 Meta 호출은 비활성 상태입니다. 서버 전용 API 키·비용 승인·킬 스위치를 설정해야 합니다.');
 $('meta-consent-button').disabled=!ready||meta.consented||!!s.endedAt||!!s.callEndedAt||S.busy||S.needsReconcile||S.sessionInvalid||s.voiceFixture?.mode!=='SCRIPTED';
 $('meta-consent-checkbox').disabled=!ready||meta.consented||!!s.endedAt;
 const review=meta.review;
 setT('meta-review-results',metaVerified&&review?
  `Meta 응답 검증 · 위험 제안 ${review.riskLevel} · 근거 ${review.evidenceTurnIds.join(', ')||'없음'} · 보호 안내: ${review.advisories.join(' / ')||'추가 안내 없음'} · ${review.elapsedMs}ms · 실제 위험 지수 및 금융 명령 미변경`:
  meta.status==='PENDING'?'Meta 분석 요청 처리 중 · 새 발화가 오면 과거 응답은 폐기합니다.':
  meta.status==='WAITING_LATEST'?'Meta 이전 분석 완료를 기다리는 중 · 최신 발화는 한 번으로 합쳐 분석합니다 (중복 비용 방지).':
  meta.status==='STALE_DISCARDED'?'사건 상태가 변경되어 이전 모델 응답을 폐기했습니다. 최신 발화는 계속 로컬에서 분석합니다.':
  meta.status==='ERROR'?`Meta 요청 오류 (${meta.errorCode||'UNKNOWN'}) · 규칙 기반 보호는 계속 작동합니다.`:
  meta.status==='BUDGET_EXHAUSTED'||meta.status==='PROCESS_BUDGET_EXHAUSTED'?'Meta 요청 상한 도달 · 규칙 기반 보호 유지':
  meta.status==='AWAITING_CONSENT'?'합성 텍스트 외부 전송에 동의하면 실제 모델 분석을 시작합니다.':
  'Meta 비활성 · 합성 텍스트 규칙 기반 보호만 작동합니다.');
 setT('risk-num',`${s.risk.index} / 100`);$('risk-fill').style.width=s.risk.index+'%';setT('m-urg',s.risk.urgency);setT('m-pre',s.risk.pressure);setT('m-pro',s.risk.proximity);setT('m-evi',s.risk.evidence);
 $('m-evidence').innerHTML=s.transcript.length?s.transcript.map(t=>`<div class="evidence-chip"><b>${esc(t.turnId)}</b> · ${esc(t.text)}<br><small>${esc(t.cue)}</small></div>`).join(''):'<p class="empty">아직 확인된 발화 근거가 없습니다.</p>';
 const log=s.log.slice(-12).reverse().map(e=>`<div class="row"><time>${fmt(e.at)}</time><b>${esc(e.type)}</b><span>${esc(e.message)}</span></div>`).join('')||'<p class="empty">기록 없음</p>';
 $('m-log').innerHTML=log;$('act-log').innerHTML=log;
 $('m-transcript').innerHTML=s.transcript.length?s.transcript.map((t,i)=>`<div class="utt"><small>${esc(t.speaker)} · 발화 ${i+1} · ${s.voiceFixture?.mode==='LOCAL_STT_USER_REVIEWED'?'LOCAL STT · HUMAN REVIEWED':s.voiceFixture?.mode==='CAPTION_OBSERVATION'?'CAPTION OBSERVATION · NOT STT':s.voiceFixture?.mode==='FIXTURE'?'MOCK TRANSCRIPT':'SCRIPTED MOCK'}</small>${esc(t.text)}<em>${esc(t.cue)}</em></div>`).join(''):'<p class="empty">다음 발화 버튼을 누르면 합성 대본이 한 문장씩 표시됩니다.</p>';
 $('m-transcript').scrollTop=$('m-transcript').scrollHeight;
 if(s.captionReplay){setT('caption-status',`CAPTION ONLY · ${Math.round(s.captionReplay.elapsedMs/1000)}초 · ${s.captionReplay.observations}건 화면 자막 관찰 · Case ${s.runId.slice(-8)} · STT 미실행`);setT('caption-evidence','보조 문맥 신호(기존 위험 점수에 미합산): '+(s.captionReplay.contextEvidence.map(e=>e.code+' @'+Math.round(e.observedAtMs/1000)+'초').join(', ')||'없음'));setT('caption-advisory',s.captionReplay.provisionalAdvisory?.message||'잠정 보호 안내 없음 · 실제 STT가 아니며 은행 명령에 영향 없음');}
 $('caption-next').disabled=!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid||s.step!==0||!['SCRIPTED','CAPTION_OBSERVATION'].includes(s.voiceFixture?.mode)||!!(s.captionReplay&&s.captionReplay.elapsedMs>=110000);
 $('caption-case').disabled=!!s.captionReplay||S.busy||S.needsReconcile||S.sessionInvalid;
 if(s.callEndedAt){$('phone-incall').hidden=true;$('phone-incoming').hidden=false;$('btn-answer').disabled=true;clearInterval(S.timer);S.call='incoming';}else $('btn-answer').disabled=!!s.endedAt;
 setT('incoming-sub',s.callEndedAt?'가상 통화가 종료됐습니다. 활동 기록에서 후속 보호 점검을 진행하세요.':s.scenario.intro);$('btn-next-utter').disabled=s.voiceFixture?.mode!=='SCRIPTED'||!!s.endedAt||!!s.callEndedAt||s.step>=s.scenario.totalSteps||S.busy||S.needsReconcile||S.sessionInvalid;
 $('btn-next-utter').textContent=s.step>=s.scenario.totalSteps?'대본 종료':'다음 발화 듣기 →';
 for(const id of['m-stop','m-emergency','m-transfer','m-verify'])$(id).disabled=!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid;
 $('m-verify').hidden=s.mode!=='verified';setT('m-verify-note',s.verification?`가상 가족 확인: ${s.verification.status} · 신원·안전 인증 아님`:'');
 // SafeBank server-state mirror (never locally approved)
 const b=s.safeBank;setT('bank-status',b.status==='HELD'?'MOCK: 가상 송금 보류 중 (서버 승인)':b.status==='CANCELLED'?'MOCK: 보류 취소됨 (서버 기록)':'MOCK: 가상 거래 준비');
 $('st-arrival').classList.toggle('done',!!s.bankArrivalConfirmed);$('st-consent').classList.toggle('done',!!s.bankHelpConsented);$('st-hold').classList.toggle('done',b.status==='HELD');
 $('sb-arrival').disabled=!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid;$('sb-consent').disabled=!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid||!s.bankArrivalConfirmed||s.bankArrivalVersion!==s.careCaseVersion||s.risk.band==='LOW';
 $('sb-hold').disabled=!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid||b.status!=='READY'||!s.bankHelpConsented;$('sb-cancel').disabled=!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid||b.status!=='HELD';
 setT('sb-script',s.bankHelpConsented?'직원 안내: “의심스러운 전화로 송금을 요구받고 있습니다. 공식 절차로 확인을 도와주세요.” (가상 문구)':'');
 $('bank-activity').innerHTML=b.activity.length?b.activity.map(a=>`<div class="row"><b>${a.kind}</b><span>ledger revision ${a.revision} · 서버 기록</span></div>`).join(''):'<p class="empty">은행 명령 기록 없음</p>';
 setT('map-arrival-note',s.bankArrivalConfirmed?'도착 자기 보고됨 · 실제 위치 검증 안 됨 · 사건 정보가 바뀌면 다시 확인 필요':'아직 도착 확인 전');
 $('act-tiles').innerHTML=[['가상 송금 시도',s.review.fakeTransferAttempted?'기록 있음':'없음'],['송금 보류 선택',s.review.stoppedTransfer?'선택함':'없음'],['가족 확인 요청',s.review.familyVerificationRequested?'요청함':'없음'],['은행 보류',b.status],['가상 카드 잠금',s.mockCard.status]].map(([k,v])=>`<div class="tile"><small>${k}</small><b>${v}</b></div>`).join('');
 renderMessages(s);renderPostCall(s);renderRecovery(s);updatePending();syncScenarioUi();if(S.connection==='CONNECTED')setT('stage-note',`연결됨 · CASE ${s.runId.slice(-8).toUpperCase()} · v${s.version} · ${ph}`)}
function renderMessages(s){
 const data=s.messages||{entries:[],lastAttempt:null};const list=$('msg-list');
 const quarantine=data.entries.filter(m=>m.verdict==='QUARANTINED').length;
 setT('message-safety-title',quarantine?`주의 · ${quarantine}개 메시지 링크 격리됨`:'가상 메시지 수신함 · 실제 OS 차단 없음');
 setT('message-safety-note',quarantine?'해당 링크는 앱 내부에서 선택할 수 없으며 서버도 요청을 허용하지 않습니다. 실제 SMS 앱에는 영향 없습니다.':'정상 문자까지 사기라고 단정하지 않습니다. 모든 URL은 데모 안에서 외부로 열리지 않습니다.');
 $('msg-inject').disabled=!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid||data.entries.length>=12;
 list.innerHTML=data.entries.length?data.entries.map(m=>`<article class="message-entry ${m.verdict==='QUARANTINED'?'quarantined':''}">
   <header><b>${esc(m.sender)}</b><span class="chip ${m.verdict==='QUARANTINED'?'demo':'mock'}">${m.verdict==='QUARANTINED'?'격리':m.verdict==='NO_LINK'?'링크 없음':'검토만'}</span></header>
   <p class="message-body">${esc(m.body)}</p><p class="message-reason">${esc(m.reason)}</p>
   <div class="message-actions">${m.link?`<button type="button" class="mini" data-message-attempt="${esc(m.id)}" ${m.verdict==='QUARANTINED'?'disabled aria-disabled="true"':''}>${m.verdict==='QUARANTINED'?'의심 링크 선택 차단':'가상 링크 선택 (외부 이동 없음)'}</button>`:'<span class="fine">일반 텍스트 메시지</span>'}
   ${m.verdict==='QUARANTINED'?`<button type="button" class="mini" data-message-reason="${esc(m.id)}">서버 차단 정책 확인</button>`:''}
   ${m.verdict==='QUARANTINED'&&m.reasonCode==='CALL_RISK_CONTEXT'?`<button type="button" class="mini" data-message-review="${esc(m.id)}">독립 확인 자기보고 후 15분 가상 미리보기</button>`:''}
   ${m.review?.active?`<button type="button" class="mini" data-message-revoke="${esc(m.id)}">임시 검토 허용 철회</button>`:''}</div>
   <p class="fine">통화 위험 연계: ${esc(m.observation?.linkedEvidenceIds?.join(', ')||'없음')} · 신원 확인 아님</p></article>`).join(''):'<p class="empty">가상 메시지를 추가하면 안전 정책과 함께 표시됩니다.</p>';
 setT('msg-status',data.lastAttempt?(data.lastAttempt.blocked?'서버 차단 확인: '+data.lastAttempt.reason+' · 외부 요청 없음':'서버가 가상 선택을 기록했습니다. 브라우저 이동/실제 접속은 없습니다.'):'가상 문자함 · 링크는 외부에서 열리지 않으며 실제 휴대전화 문자 앱에는 영향이 없습니다.');
}
function renderPostCall(s){
 const panel=$('postcall-panel'),post=s.postCall;if(!panel||!post)return;
 for(const id of ['postcall-export','postcall-import','postcall-delete'])$(id).disabled=(!s.callEndedAt||!!s.endedAt||S.busy||S.needsReconcile||S.sessionInvalid);
 if(s.recoveryVault?.restoredFrom)setT('postcall-vault-status','암호화 자료에서 자기보고를 수동 복원한 사건입니다. 실제 금융·전화 상태는 복원되지 않았습니다.');
 const ready=post.status!=='WAITING_FOR_CALL_END',disabled=ready&&!s.endedAt&&!S.busy&&!S.needsReconcile&&!S.sessionInvalid;
 setT('postcall-status',!ready?'통화 종료 버튼을 누르면 이 사건의 후속 점검이 열립니다.':post.status==='ARCHIVED'?'사건 종료 · 이전 자기 보고 내역을 읽기 전용으로 표시합니다.':post.needsImmediateAttention?'중요: 노출 가능성이 보고되었습니다. 금융기관·공식 기관에 직접 연락하는 순서를 우선 확인하세요.':'같은 Case ID로 후속 행동을 점검할 수 있습니다. 실제 조치는 사용자가 직접 수행해야 합니다.');
 $('postcall-questions').innerHTML=Object.entries(post.questions).map(([key,title])=>`<label class="postcall-question"><span>${esc(title)}</span><select data-postcall-question="${esc(key)}" ${!disabled?'disabled':''}><option value="" ${!post.answers[key]?'selected':''}>미응답</option>${[['YES','예'],['NO','아니요'],['UNSURE','잘 모르겠어요']].map(([v,l])=>`<option value="${v}" ${post.answers[key]===v?'selected':''}>${l}</option>`).join('')}</select></label>`).join('');
 $('postcall-steps').innerHTML=post.steps.map((step,i)=>`<div class="postcall-step"><strong>${i+1}. ${esc(step.title)}</strong><p class="fine">${esc(step.detail)}</p><label>진행 상태 (자기 보고)<select data-postcall-task="${esc(step.id)}" ${!disabled?'disabled':''}><option value="TODO" ${step.status==='TODO'?'selected':''}>미완료</option><option value="DONE" ${step.status==='DONE'?'selected':''}>직접 처리했다고 표시</option><option value="NOT_APPLICABLE" ${step.status==='NOT_APPLICABLE'?'selected':''}>해당 없음</option></select></label></div>`).join('');
}
function renderRecovery(s){const r=s.recovery,box=$('m-recovery');if(!r){box.innerHTML='<p class="empty">이 모드에서는 회복 케어를 제공하지 않습니다.</p>';return}
 if(!r.selectedPath){box.innerHTML=`<div class="form"><label>걱정 유형 직접 선택<select id="rec-path"><option value="">선택</option>${r.paths.map(p=>`<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select></label></div>`;
  $('rec-path').addEventListener('change',e=>{if(e.target.value)mutate('recovery/event',{eventId:crypto.randomUUID(),type:'CARE_PATH_SELECTED',expectedRecoveryVersion:r.version,pathId:e.target.value})});return}
 box.innerHTML=r.steps.map((st,i)=>`<div class="rec-step"><span>${i+1}. ${esc(st.description)}</span><select data-step="${esc(st.id)}"><option value="TODO" ${st.status==='TODO'?'selected':''}>미완료</option><option value="DONE" ${st.status==='DONE'?'selected':''}>완료 표시</option><option value="NOT_APPLICABLE" ${st.status==='NOT_APPLICABLE'?'selected':''}>해당 없음</option></select></div>`).join('')+'<p class="fine">자기 보고 기록이며 실제 금융·신고 조치를 검증하지 않습니다.</p>';
 box.querySelectorAll('[data-step]').forEach(sel=>sel.addEventListener('change',()=>mutate('recovery/event',{eventId:crypto.randomUUID(),type:sel.value==='TODO'?'RECOVERY_STEP_REOPENED':'RECOVERY_STEP_MARKED',expectedRecoveryVersion:S.state.recovery.version,pathId:S.state.recovery.selectedPath,stepId:sel.dataset.step,status:sel.value})))}
async function bankCmd(type){const s=S.state;if(!s||S.busy||S.needsReconcile||S.sessionInvalid)return;const msg={ARRIVAL_CONFIRM:'은행에 도착했다고 직접 확인할까요? GPS로 검증하지 않습니다.',ASSIST_CONSENT:'직원 도움 안내에 동의할까요?',HOLD:'가상 송금을 보류할까요? 실제 거래에 영향 없습니다.',CANCEL:'가상 보류를 취소할까요?'}[type];const ok=await confirmDialog('SafeBank 확인',msg,'확인');if(!ok)return;
 mutate('safebank/command',{type,confirmed:true,commandId:'mock_'+crypto.randomUUID(),expectedBankRevision:s.safeBank?.revision})}
function validateTransferForm(){const check=validateTransferInput({recipient:$('tx-name')?.value,amount:$('tx-amt')?.value});for(const [id,key] of [['tx-name-error','recipient'],['tx-amt-error','amount']]){const e=$(id);if(e){e.textContent=check.errors[key]||'';e.hidden=!check.errors[key];}}const name=$('tx-name'),amt=$('tx-amt');if(name)name.setAttribute('aria-invalid',String(!!check.errors.recipient));if(amt)amt.setAttribute('aria-invalid',String(!!check.errors.amount));if(!check.ok){(check.errors.recipient?name:amt)?.focus();showInlineAlert('가상 송금 입력값을 확인하세요. 서버로 전송되지 않았습니다.');}return check;}
function speak(text){if(!S.tts||!('speechSynthesis' in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=S.state?.jurisdiction==='US'?'en-US':'ko-KR';u.rate=1;speechSynthesis.speak(u)}
async function advance(){const before=S.state?.step;const result=await mutate('advance');if(result.ok&&S.state.step>before)speak(S.state.transcript.at(-1)?.text)}
function startTimer(){clearInterval(S.timer);S.sec=0;S.timer=setInterval(()=>{S.sec++;setT('call-timer',`${String(Math.floor(S.sec/60)).padStart(2,'0')}:${String(S.sec%60).padStart(2,'0')}`)},1000)}
function tickClock(){const d=new Date(),t=d.toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit',hour12:false});setT('sb-time',t);setT('home-time',t);setT('home-date',d.toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'}))}
async function initialize({newSession=false}={}) {
 if(S.initializing||S.busy)return;
 S.initializing=true;
 const hadPrevious=!!(S.auth&&S.state);
 setPhase('loading');setConnection('CONNECTING');
 try {
  if(!S.auth&&!newSession){const saved=safeSessionRead();if(saved){S.auth={sessionId:saved.sessionId,token:saved.token};S.childToken=saved.childToken||null;S.glassesToken=saved.glassesToken||null;}}
  if(S.auth&&!newSession){
   const result=await refresh({quiet:false,allowInvalid:true});
   if(!result.ok){
    if(!['AUTH_REQUIRED','FORBIDDEN'].includes(result.error?.code))setPhase('error','기존 사건을 확인하지 못했습니다. 서버 연결을 확인하고 재시도하세요. 새 세션은 직접 선택한 경우에만 시작됩니다.');
    return;
   }
  } else {
   // Create first and commit only after a valid server snapshot arrives.
   // On network failure the previous credentials and case remain untouched.
   const priorAuth=S.auth;
   await replaceDemoSession({
    create:()=>api('session/create',{scenarioId:'kidnap',mode:'verified'}),
    commit:created=>{
     S.events?.close();S.epoch++;S.auth={sessionId:created.sessionCredentials.sessionId,token:created.sessionCredentials.parentToken};
     S.childToken=created.sessionCredentials.childToken||null;S.glassesToken=created.sessionCredentials.glassesToken||null;S.state=created;
     S.sessionInvalid=false;S.needsReconcile=false;
     safeSessionWrite({...S.auth,childToken:S.childToken,glassesToken:S.glassesToken});
     clearInterval(S.timer);S.sec=0;S.call='incoming';S.mapRequest++;S.mapPos=null;
     const inc=$('phone-incoming'),inCall=$('phone-incall');if(inc)inc.hidden=false;if(inCall)inCall.hidden=true;
     const map=$('map-box');if(map)map.hidden=true;const open=$('map-open');if(open)open.hidden=false;
     $('map-frame')?.removeAttribute('src');closeScenarioSheet();go('home');
    },
    releasePrevious:priorAuth?async()=>{
     // Session cleanup is best effort, non-blocking for the new visible session.
     const controller=new AbortController();const t=setTimeout(()=>controller.abort(),1500);
     try{await fetch('/api/session/close',{method:'POST',cache:'no-store',credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-SafeCall-Session':priorAuth.sessionId,'X-SafeCall-Token':priorAuth.token},body:'{}',signal:controller.signal});}
     finally{clearTimeout(t);}
    }:undefined,
   });
  }
  setPhase('ready');setConnection('CONNECTED');render();sse();
  logEvent('info',newSession?'new_session_created':'session_initialized',{result:'ok'});
 } catch(error) {
  logEvent('warn','session_initialize',{errorCode:error.code||'UNKNOWN_ERROR',result:'error'});
  if(newSession&&hadPrevious&&!S.sessionInvalid){
   // A failed replacement must not erase the prior, still-valid local case.
   setPhase('ready');setConnection('FAILED','새 가상 세션을 만들지 못했습니다. 기존 사건은 유지됩니다.');
   showInlineAlert('새 세션 생성이 실패해 기존 사건을 유지했습니다. 서버 연결을 확인한 후 다시 시도할 수 있습니다.');
  }else{setConnection('FAILED');setPhase('error',error.message||'서버를 사용할 수 없습니다.');}
  toast('세션 요청이 실패했습니다. 기존 사건을 임의로 삭제하지 않았습니다.','error');
 } finally {S.initializing=false;}
}

function boot(){if(S.booted)return;S.booted=true;initMultiTab();logEvent('info','boot',{});tickClock();setInterval(tickClock,15000);void initialize()}
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
async function mockCardCommand(action){
 const s=S.state;if(!s||S.busy||S.needsReconcile||S.sessionInvalid)return;
 const yes=await confirmDialog('SafeBank 가상 카드',action==='LOCK'?'가상 카드만 잠글까요? 계좌이체나 실제 카드에는 영향이 없습니다.':'가상 카드 잠금을 해제할까요? 실제 카드에는 영향이 없습니다.',action==='LOCK'?'가상 카드 잠금':'잠금 해제');
 if(!yes)return;
 const result=await mutate('mock-card/command',{action,cardRef:'DEMO_CARD_1',confirmed:true,commandId:'mockcard_'+crypto.randomUUID(),expectedCardRevision:s.mockCard.revision});
 if(result.ok)toast(action==='LOCK'?'가상 카드 잠금 승인 · 실제 카드 영향 없음':'가상 카드 잠금 해제 완료','success');
}
function setPlatform(platform){document.body.dataset.platform=platform;$('plat-ios').classList.toggle('on',platform==='ios');$('plat-galaxy').classList.toggle('on',platform==='galaxy');$('platform-toggle').querySelector('label').textContent=platform==='ios'?'Galaxy 스타일':'iOS 스타일'}
$('plat-ios').addEventListener('click',()=>setPlatform('ios'));
$('plat-galaxy').addEventListener('click',()=>setPlatform('galaxy'));
$('platform-toggle').addEventListener('click',()=>setPlatform(document.body.dataset.platform==='ios'?'galaxy':'ios'));
$('meta-consent-button').addEventListener('click',async()=>{
 if(!$('meta-consent-checkbox').checked){toast('Meta API 외부 전송 및 비용 동의를 먼저 선택하세요.','warning');return;}
 const ok=await confirmDialog('Meta LIVE 활성화','이 사건의 합성 텍스트를 Meta Model API로 전송합니다. 유료 호출이 발생할 수 있으며 기본 위험 점수 및 금융 명령은 변경하지 않습니다.','동의하고 활성화');
 if(!ok)return;const result=await mutate('meta/consent',{consented:true});if(result.ok)toast('Meta LIVE 활성화 · 합성 대화만 전송합니다.','success');
});
$('btn-answer').addEventListener('click',()=>{S.call='incall';$('phone-incoming').hidden=true;$('phone-incall').hidden=false;startTimer();toast('가상 통화 연결 · 실제 통화 아님')});
$('btn-decline').addEventListener('click',()=>{toast('가상 전화를 거절했습니다 (로컬 표시)');go('home')});
$('btn-endcall').addEventListener('click',async()=>{const result=await mutate('action',{action:'END_CALL'});if(!result.ok)return;clearInterval(S.timer);S.call='incoming';$('phone-incoming').hidden=false;$('phone-incall').hidden=true;toast('가상 통화 종료 · 후속 점검을 시작하세요','success');go('activity')});
document.querySelectorAll('[data-pad]').forEach(b=>b.addEventListener('click',()=>{const on=b.getAttribute('aria-pressed')==='true';b.setAttribute('aria-pressed',String(!on));if(b.dataset.pad==='keypad')$('keypad').hidden=on;toast(`${b.textContent} ${!on?'켜짐':'꺼짐'} · 시뮬레이션 표시`)}));
$('btn-next-utter').addEventListener('click',advance);$('stage-next').addEventListener('click',()=>{go('phone');if(S.call!=='incall')$('btn-answer').click();advance()});
function openGlasses(){
 if(!S.auth||!S.glassesToken||S.sessionInvalid){toast('현재 세션에서 안경 연결 정보를 확인할 수 없습니다. 새 세션을 시작하세요.');return false;}
 const u=new URL('/glasses',location.href);u.hash=new URLSearchParams({session:S.auth.sessionId,token:S.glassesToken}).toString();
 const popup=window.open(u.href,'_blank','noopener,noreferrer');
 if(!popup)toast('안경 창이 차단되었습니다. 팝업을 허용한 뒤 ④를 다시 누르세요.','warning');
 return !!popup;
}
function showIncomingCall(){clearInterval(S.timer);S.sec=0;S.call='incoming';const inc=$('phone-incoming'),inCall=$('phone-incall');if(inc)inc.hidden=false;if(inCall)inCall.hidden=true;}
async function ensureScenario(id){
 if(!(S.state&&S.state.scenario?.id===id&&S.state.step===0&&!S.state.endedAt&&!S.state.callEndedAt)){
  const result=await mutate('reset',{scenarioId:id,mode:'verified'});
  if(!result.ok)return false;
  showIncomingCall();
 }
 return true;
}
async function advanceUntil(limit){
 let guard=0;
 while(S.state&&S.state.step<Math.min(limit,S.state.scenario.totalSteps)&&!S.state.endedAt&&!S.state.callEndedAt&&guard++<8){
  const result=await mutate('advance');
  if(!result.ok)return false;
 }
 return true;
}
const DEMO_STEPS=[
 {id:'A',note:'A · 정상 통화. 합성 가족 연락이고, 위험 단서가 없으면 경고를 올리지 않습니다.',run:async()=>{if(!await ensureScenario('benign'))return;go('phone');if(S.call!=='incall')$('btn-answer').click();await advanceUntil(2);}},
 {id:'B',note:'B · 은행 사칭, 이체 요구, 비밀 유지. 위험 단서와 행동 안내가 바뀝니다. 점수는 범죄 확률이 아닙니다.',run:async()=>{if(!await ensureScenario('txt_bank_transfer'))return;go('phone');if(S.call!=='incall')$('btn-answer').click();await advanceUntil(99);go('guard');}},
 {id:'C',note:'C · 안경 HUD. 같은 사건의 읽기 전용 경고입니다. 실물 안경과 공식 시뮬레이터는 이 버튼으로 검증되지 않습니다.',run:async()=>{openGlasses();go('guard');}},
 {id:'D',note:'D · SafeBank 가상 송금. 높은 위험 단서가 있으면 기록 전에 확인 창이 열립니다. 실제 금융 호출은 없습니다.',run:async()=>{go('bank');}},
 {id:'E',note:'E · 가상 송금 보류 후 사건 종료. 조치는 이 시뮬레이터 안에만 남습니다.',run:async()=>{const held=await mutate('action',{action:'STOP_TRANSFER'});if(!held.ok)return;await mutate('end');go('guard');}},
];
let demoIndex=-1;
async function runDemo(index){
 if(S.busy||S.sessionInvalid||!S.state)return;
 const step=DEMO_STEPS[index];if(!step)return;
 demoIndex=index;document.body.dataset.demoStep=step.id;setT('demo-scene-note',step.note);
 try{await step.run();}catch{setT('demo-scene-note','시연 단계를 진행하지 못했습니다. 서버 연결을 확인한 뒤 다시 시작하세요.');}
}
$('stage-glasses').addEventListener('click',()=>{openGlasses();});
$('demo-restart')?.addEventListener('click',()=>{void runDemo(0);});
$('demo-step')?.addEventListener('click',()=>{void runDemo(demoIndex<0?0:(demoIndex+1)%DEMO_STEPS.length);});
$('stage-call').addEventListener('click',()=>go('phone'));$('stage-bank').addEventListener('click',()=>go('bank'));
$('btn-tts').addEventListener('click',e=>{S.tts=!S.tts;e.currentTarget.setAttribute('aria-pressed',String(S.tts));toast(S.tts?'발화 음성 켜짐 (기기 TTS)':'발화 음성 꺼짐')});
let lastVoiceCase=null;
let pendingLocalStt=null;
const localSttReady={value:false};
const replayMax = ()=>S.state?.voiceFixture?.replayMaxSegments===24?24:8;
let replayLoaded=null;
let replayPreviewCursor=0; // Browser-only listening without STT never advances Case evidence.
let replayPrepared=null;
let replayUrl=null;
let localSttUploading=false;
$('replay-player').addEventListener('ended',()=>{
 if(replayPrepared){replayPrepared.playbackComplete=true;
  $('replay-send').disabled=!(localSttReady.value&&replayStateReady()&&!pendingLocalStt);
  if(!localSttReady.value&&replayLoaded){
    replayPreviewCursor=Math.min(replayPrepared.index+1,replayLoaded.info.totalSegments);
    $('replay-prepare').disabled=replayPreviewCursor>=replayLoaded.info.totalSegments;
    replayStatus(`오디오 미리듣기 ${replayPreviewCursor}/${replayLoaded.info.totalSegments}구간 완료 · 실제 STT/위험 분석 없음. ${replayPreviewCursor<replayLoaded.info.totalSegments?'다음 구간을 재생할 수 있습니다.':'전체 미리듣기 완료.'}`);
  }else replayStatus(`구간 ${replayPrepared.index+1} 재생 완료 · 별도 동의 후 로컬 STT 분석 요청 가능`);
 }
});
function clearReplay({clearFile=true}={}){
  const player=$('replay-player');player.pause();player.removeAttribute('src');player.load();player.hidden=true;
  if(replayUrl){URL.revokeObjectURL(replayUrl);replayUrl=null;}
  // Best-effort zeroization of in-memory source/segment bytes; browser Blob buffers are GC-owned.
  replayPrepared?.bytes?.fill(0);replayLoaded?.bytes?.fill(0);
  replayPrepared=null;replayLoaded=null;replayPreviewCursor=0;
  if(clearFile)$('replay-file').value='';
  $('replay-prepare').disabled=true;$('replay-send').disabled=true;
}
function replayStateReady(){
 const s=S.state;
 return !!s&&!s.endedAt&&!S.sessionInvalid&&!S.needsReconcile&&!S.busy&&
   !!replayLoaded&&replayLoaded.caseId===s.runId&&s.step===0&&
   ['SCRIPTED','LOCAL_STT_USER_REVIEWED'].includes(s.voiceFixture?.mode);
}
function replayStatus(message){setT('replay-status',message);}
$('replay-extended-enable').addEventListener('click',async()=>{
 if(!$('replay-extended-consent').checked){setT('replay-mode-status','120초 실험에는 별도 동의가 필요합니다.');return;}
 if(replayLoaded||replayPrepared||pendingLocalStt){setT('replay-mode-status','음성 입력 전에 새 사건에서만 모드를 선택하세요.');return;}
 const result=await mutate('voice/replay/enable',{consented:true,mode:'EXTENDED_120S'});
 if(result.ok){setT('replay-mode-status','120초/24구간 연구 모드 활성화됨. 각 5초 입력에는 별도 동의·검토가 필요합니다.');$('replay-extended-consent').checked=false;}
});

$('caption-next').addEventListener('click',async()=>{
 if(!S.state||S.busy||S.needsReconcile||S.sessionInvalid)return;
 if(!$('caption-consent').checked){setT('caption-status','이 사건에 자막 관찰을 반영하려면 동의를 직접 선택하세요.');return;}
 if(S.state.scenario.id!=='benign'&&S.state.voiceFixture.mode==='SCRIPTED'){
  setT('caption-status','먼저 시나리오에서 정상 가족 연락(benign)을 선택하고 새 사건을 시작하세요.');return;
 }
 const id=S.state.captionReplay?.fixtureId||$('caption-case').value;
 const result=await mutate('voice/benchmark/advance',{fixtureId:id,consented:true});
 if(result.ok)setT('caption-status',`자막 관찰 시뮬레이션 · ${Math.round(result.state.captionReplay.elapsedMs/1000)}초 (실제 STT 아님)`);
});

async function refreshLocalSttCapabilities(){
 try{const r=await requestJson('/api/voice/stt/capabilities',{headers:authH(),validate:x=>!!x&&!!x.localStt&&typeof x.localStt.ready==='boolean'});
  localSttReady.value=r.localStt.ready;
  const note=localSttReady.value?'로컬 모델 준비됨 · 기본 8회 / 별도 동의 120초 실험 24회 · 매 구간 직접 검토':'로컬 음성 모델 미설정: 기존 MOCK 실험만 사용할 수 있습니다.';
  setT('local-stt-availability',note);
 }catch{localSttReady.value=false;setT('local-stt-availability','로컬 STT 준비 상태 확인 실패. 합성 MOCK 실험은 사용 가능합니다.');}
 for(const id of ['local-stt-file','local-stt-language','local-stt-consent','local-stt-run'])$(id).disabled=!localSttReady.value;
}
void refreshLocalSttCapabilities();
async function submitLocalWav(bytes,{segmentIndex,segmentStartMs,kind='single'}={}){
 if(!localSttReady.value||S.busy||S.needsReconcile||S.sessionInvalid||!S.state||S.state.endedAt||localSttUploading)return false;
 if(pendingLocalStt){setT('local-stt-status','이전 STT 초안을 확인하거나 삭제하세요.');return false;}
 if(!$('local-stt-consent').checked){setT('local-stt-status','오디오 로컬 분석에 대한 명시적 동의가 필요합니다.');return false;}
 const run=S.state.runId,ver=S.state.version,epoch=S.epoch;
 localSttUploading=true;$('local-stt-run').disabled=true;$('replay-send').disabled=true;
 setT('local-stt-status','로컬 STT가 전사 초안을 생성 중입니다. 아직 위험 판단에 반영되지 않습니다.');
 const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),65000);
 try{
  const digest='sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const headers={...authH(),'Content-Type':'audio/wav','X-SafeCall-Local-Consent':'granted',
   'X-SafeCall-Consent-At':String(Date.now()),'X-SafeCall-Language':$('local-stt-language').value,
   'X-SafeCall-Run':run,'X-SafeCall-Version':String(ver),'X-SafeCall-Digest':digest};
  if(segmentIndex!==undefined){headers['X-SafeCall-Segment-Index']=String(segmentIndex);headers['X-SafeCall-Segment-Start-Ms']=String(segmentStartMs);}
  const r=await fetch('/api/voice/stt/local',{method:'POST',credentials:'same-origin',cache:'no-store',headers,body:bytes,signal:abort.signal});
  const data=await r.json();if(!r.ok)throw new Error(data.error||data.code||'로컬 STT 실패');
  if(S.state?.runId!==run||S.state?.version!==ver||S.epoch!==epoch||S.sessionInvalid){
   setT('local-stt-status','사건이 변경되어 오래된 STT 결과를 화면에 사용하지 않습니다.');return false;
  }
  if(data.requiresUserReview!==true||typeof data.text!=='string'||!data.candidateId)throw new Error('검토가 필요한 STT 후보 응답 형식 오류');
  pendingLocalStt=data;$('local-stt-text').value=data.text;$('local-stt-speaker').value='';
  $('local-stt-review-consent').checked=false;$('local-stt-confirm-box').hidden=false;
  setT('local-stt-status',`STT 초안 생성: ${kind==='replay'?'5초 오디오 구간':'개별 WAV'} · 사용자 검토 전 점수·금융 상태 불변`);
  if(kind==='replay')replayStatus(`구간 ${segmentIndex+1} 분석 초안이 준비됐습니다. 아래 문장·화자를 확인해야 다음 구간으로 진행할 수 있습니다.`);
  return true;
 }catch(err){setT('local-stt-status',err?.name==='AbortError'?'인식 요청 제한시간 초과/연결 중단 · 서버 처리 여부 확인 필요':err.message||'로컬 STT 실패');return false;}
 finally{clearTimeout(timeout);localSttUploading=false;$('local-stt-consent').checked=false;
  $('local-stt-run').disabled=!localSttReady.value||S.sessionInvalid;
  $('replay-send').disabled=!(replayPrepared?.playbackComplete&&localSttReady.value&&replayStateReady()&&!pendingLocalStt);
 }
}
$('local-stt-run').addEventListener('click',async()=>{
 const file=$('local-stt-file').files?.[0];
 if(!file||file.size<46||file.size>320044){setT('local-stt-status','10초 이내 PCM16 16kHz WAV 파일(최대 320044바이트)을 선택하세요.');return;}
 try{await submitLocalWav(await file.arrayBuffer());}
 catch(err){setT('local-stt-status',err.message||'WAV 파일 읽기 오류');}
 finally{$('local-stt-file').value='';}
});
$('replay-file').addEventListener('change',async()=>{
 clearReplay({clearFile:false});
 const file=$('replay-file').files?.[0];if(!file){replayStatus('파일이 없습니다.');return;}
 if(!S.state||S.state.endedAt||S.sessionInvalid){replayStatus('새 유효한 사건을 먼저 시작하세요.');$('replay-file').value='';return;}
 try{
  const max=replayMax();
  if(file.size>44+max*160000+16384)throw new Error(`최대 ${max*5}초의 로컬 WAV만 지원합니다.`);
  const bytes=new Uint8Array(await file.arrayBuffer());const info=inspectReplayWav(bytes,{maxSegments:max});
  replayLoaded={bytes,info,caseId:S.state.runId};
  $('replay-prepare').disabled=false;
  replayStatus(`로컬 브라우저에 WAV ${info.durationMs.toFixed(0)}ms / ${info.totalSegments}구간을 불러왔습니다. 서버로 전송하지 않았습니다.`);
 }catch(err){clearReplay();replayStatus('WAV 검증 실패: '+err.message);}
});
$('replay-prepare').addEventListener('click',async()=>{
 if(!replayStateReady()){replayStatus('새 사건에서 WAV를 다시 선택하세요. 다른 출처와 혼합할 수 없습니다.');return;}
 if(pendingLocalStt||localSttUploading){replayStatus('이전 STT 초안이 남아 있습니다. 먼저 확정 또는 폐기하세요.');return;}
 const s=S.state,idx=localSttReady.value?(s.voiceFixture?.localSegmentCount||0):replayPreviewCursor;
 if(localSttReady.value&&s.voiceFixture?.nextStartMs!==idx*5000){replayStatus('이미 짧은 개별 WAV를 사용한 사건입니다. 5초 구간 재생은 새 사건에서 시작하세요.');return;}
 try{
  const segment=makeReplaySegment(replayLoaded.bytes,idx,{maxSegments:replayMax()});
  const eligibility=replayEligibility({caseId:s.runId,sourceCaseId:replayLoaded.caseId,mode:s.voiceFixture.mode,
   step:s.step,ended:!!s.endedAt,segmentIndex:idx,serverSegmentCount:idx,
   serverNextStartMs:s.voiceFixture.nextStartMs,totalSegments:replayLoaded.info.totalSegments,maxSegments:replayMax(),
   hasPending:false,networkReady:!S.sessionInvalid,modelReady:localSttReady.value});
  if(!eligibility.ok&&localSttReady.value){replayStatus(eligibility.reason);return;}
  const player=$('replay-player');player.pause();if(replayUrl)URL.revokeObjectURL(replayUrl);
  replayPrepared?.bytes?.fill(0);
  replayUrl=URL.createObjectURL(new Blob([segment.bytes],{type:'audio/wav'}));
  player.src=replayUrl;player.hidden=false;player.load();
  replayPrepared={...segment,caseId:s.runId,caseVersion:s.version,playbackComplete:false};
  $('replay-send').disabled=true;
  replayStatus(`구간 ${idx+1}/${replayLoaded.info.totalSegments}: ${segment.startMs/1000}–${segment.endMs/1000}초 · 브라우저 로컬 재생 · ${localSttReady.value?'별도 동의 후 STT 요청 가능':'모델 미설치: 재생만 가능'}`);
  try{await player.play();}catch{replayStatus('브라우저가 자동 재생을 제한했습니다. 오디오 플레이어에서 직접 재생할 수 있습니다.');}
 }catch(err){$('replay-send').disabled=true;replayStatus(err.message||'구간 준비 실패');}
});
$('replay-send').addEventListener('click',async()=>{
 const seg=replayPrepared,s=S.state;
 if(!seg||!replayLoaded||!s){replayStatus('현재 구간을 먼저 준비하세요.');return;}
 if(!seg.playbackComplete){replayStatus('현재 5초 구간의 재생이 끝난 후 분석을 요청하세요.');return;}
 const eligibility=replayEligibility({caseId:s.runId,sourceCaseId:replayLoaded.caseId,mode:s.voiceFixture.mode,
  step:s.step,ended:!!s.endedAt,segmentIndex:seg.index,serverSegmentCount:s.voiceFixture.localSegmentCount,
  serverNextStartMs:s.voiceFixture.nextStartMs,totalSegments:replayLoaded.info.totalSegments,maxSegments:replayMax(),
  hasPending:!!pendingLocalStt,networkReady:!S.sessionInvalid&&!S.needsReconcile,modelReady:localSttReady.value});
 if(!eligibility.ok){replayStatus(eligibility.reason);return;}
 if(s.version!==seg.caseVersion){replayStatus('사건 버전이 변경되었습니다. 현재 구간을 다시 준비해 주세요.');return;}
 $('replay-player').pause();
 await submitLocalWav(seg.bytes,{segmentIndex:seg.index,segmentStartMs:seg.startMs,kind:'replay'});
});
$('replay-clear').addEventListener('click',()=>{clearReplay();replayStatus('로컬 오디오 선택·미리보기 삭제 완료. 서버의 이미 확정된 발화는 변경하지 않았습니다.');});
$('local-stt-discard').addEventListener('click',async()=>{
 const candidate=pendingLocalStt;if(!candidate)return;
 if(S.state?.runId===candidate.caseId&&S.state?.version===candidate.caseVersion)await mutate('voice/stt/discard',{candidateId:candidate.candidateId});
 pendingLocalStt=null;$('local-stt-text').value='';$('local-stt-confirm-box').hidden=true;
 setT('local-stt-status','검토 초안을 삭제했습니다. 위험 점수와 가상 금융 상태에는 반영되지 않았습니다.');
});
$('local-stt-confirm').addEventListener('click',async()=>{
 const candidate=pendingLocalStt;const text=$('local-stt-text').value.trim();const speaker=$('local-stt-speaker').value;
 if(!candidate||!S.state||S.state.runId!==candidate.caseId||S.state.version!==candidate.caseVersion){setT('local-stt-status','검토 후보가 오래되었습니다. 새로 요청하세요.');return;}
 if(!$('local-stt-review-consent').checked||!['caller','user'].includes(speaker)||!text||text.length>800){setT('local-stt-status','초안의 문장·화자를 검토하고 사건 반영에 동의하세요.');return;}
 const result=await mutate('voice/stt/confirm',{candidateId:candidate.candidateId,confirmedText:text,speaker,consented:true});
 if(result.ok){if(replayPrepared){$('replay-player').pause();if(replayUrl){URL.revokeObjectURL(replayUrl);replayUrl=null;}$('replay-player').removeAttribute('src');$('replay-player').hidden=true;replayPrepared.bytes?.fill(0);replayPrepared=null;$('replay-send').disabled=true;replayStatus('구간 확정 완료. 서버 위험 근거가 갱신됐습니다. 다음 구간을 준비하세요.');}pendingLocalStt=null;$('local-stt-confirm-box').hidden=true;$('local-stt-revise-text').value=text;$('local-stt-revise-speaker').value=speaker;setT('local-stt-status',`로컬 STT ${result.state.voiceFixture.localSegmentCount}/${replayMax()}구간 확정. 같은 사건에 다음 WAV를 선택할 수 있습니다. Meta LIVE·금융 실행 없음.`);}
});
async function reviseLocalReviewed(retract){
 const s=S.state;if(!s||S.busy||S.needsReconcile||S.sessionInvalid||s.endedAt||s.voiceFixture?.mode!=='LOCAL_STT_USER_REVIEWED'){setT('local-stt-status','사용자 검토된 로컬 STT 사건에서만 정정할 수 있습니다.');return;}
 if(!$('local-stt-revise-consent').checked){setT('local-stt-status','정정·철회 전에 새 동의가 필요합니다.');return;}
 const event={turnId:s.voiceFixture.lastTurnId,revision:s.voiceFixture.lastRevision+1,operation:retract?'RETRACT':'CORRECT',consented:true};
 if(!event.turnId?.startsWith('voice_local_'))return;
 if(!retract){event.text=$('local-stt-revise-text').value.trim();event.speaker=$('local-stt-revise-speaker').value;if(!event.text||event.text.length>800)return;}
 const result=await mutate('voice/stt/revise',event);
 if(result.ok){$('local-stt-revise-consent').checked=false;setT('local-stt-status',retract?'이전 검토 발화를 철회하고 관련 위험 근거를 재계산했습니다.':'정정된 문장으로 위험 근거를 다시 계산했습니다.');}
}
$('local-stt-revise').addEventListener('click',()=>void reviseLocalReviewed(false));
$('local-stt-retract').addEventListener('click',()=>void reviseLocalReviewed(true));
$('voice-audio-run').addEventListener('click',async()=>{
 if(S.busy||!S.state||S.needsReconcile||S.sessionInvalid)return;
 if(!$('voice-consent').checked){setT('voice-status','합성 오디오 매칭에도 사건 기록 동의를 먼저 확인하세요.');return;}
 const s=S.state;
 if(s.step>0){setT('voice-status','합성 대본이 시작된 사건에서는 오디오 테스트를 혼합할 수 없습니다. 새 사건을 시작하세요.');return;}
 const result=await mutate('voice/stt/fixture',{fixtureId:$('voice-audio-fixture').value,consented:true});
 if(result.ok){$('voice-consent').checked=false;$('voice-result').hidden=true;
  setT('voice-status','등록된 합성 톤 해시를 미리 작성된 MOCK 문장과 매칭했습니다. 실제 STT·Meta LIVE·금융 조치 없음.');}
});
$('voice-final').addEventListener('click',async()=>{
 const txt=$('voice-text').value.trim();
 if(!$('voice-consent').checked){setT('voice-status','동의를 확인해야 MOCK 전사를 제출할 수 있습니다.');return;}
 if(!txt||txt.length>800){setT('voice-status','1~800자의 허구 테스트 문장만 사용할 수 있습니다.');return;}
 const s=S.state;if(!s||s.step>0){setT('voice-status','합성 시나리오가 이미 진행되었습니다. 새 사건에서 전사를 입력하세요.');return;}
 if(s.voiceFixture?.mode==='FIXTURE'&&s.voiceFixture.finalCount>=8){setT('voice-status','MOCK 사건당 확정 발화는 최대 8개입니다.');return;}
 const event={source:'MOCK_ASR_FIXTURE',consented:true,operation:'FINAL',turnId:'voice_ui_'+crypto.randomUUID().replaceAll('-','').slice(0,20),revision:0,speaker:$('voice-speaker').value,text:txt,quality:'OK'};
 const result=await mutate('voice/fixture',{event});
 if(result.ok){$('voice-text').value='';$('voice-consent').checked=false;$('voice-result').hidden=true;setT('voice-status','확정 전사가 서버 사건에 반영되었습니다. 실제 음성/STT/Meta LIVE가 아닙니다.');}
});
async function reviseLastMock(retract){
 const state=S.state;const info=state?.voiceFixture;
 if(!state||info?.lastStatus!=='APPLIED_FINAL'||!info.lastTurnId)return;
 if(!$('voice-consent').checked){setT('voice-status','MOCK 발화 정정·철회에도 새 동의가 필요합니다.');return;}
 const nextText=$('voice-text').value.trim();
 if(!retract&&(!nextText||nextText.length>800)){setT('voice-status','수정할 허구 테스트 문장을 입력하세요.');return;}
 const ok=await confirmDialog('MOCK 전사 변경',retract?'마지막 가상 발화를 철회할까요? 위험 근거에서 제외됩니다.':'마지막 가상 발화를 새 문장으로 정정할까요? 위험 근거가 다시 계산됩니다.',retract?'철회':'정정');if(!ok)return;
 const event={source:'MOCK_ASR_FIXTURE',consented:true,operation:retract?'RETRACT':'FINAL',turnId:info.lastTurnId,revision:info.lastRevision+1};
 if(!retract){event.speaker=$('voice-speaker').value;event.text=nextText;event.quality='OK';}
 const result=await mutate('voice/fixture',{event});
 if(result.ok){$('voice-text').value='';$('voice-consent').checked=false;$('voice-result').hidden=true;setT('voice-status',retract?'가상 발화를 철회했습니다. 자동 보호 명령은 실행되지 않았습니다.':'가상 발화 정정이 적용되어 위험 점수가 다시 계산되었습니다.');}
}
$('voice-correct').addEventListener('click',()=>void reviseLastMock(false));
$('voice-retract').addEventListener('click',()=>void reviseLastMock(true));
$('voice-review').addEventListener('click',async()=>{
 if(S.busy||!S.state||S.needsReconcile||S.sessionInvalid)return;
 const prior=S.state.runId;setT('voice-status','기존 규칙 분석의 MOCK 표시 결과를 조회 중입니다…');
 $('voice-review').disabled=true;
 try{
  const r=await requestJson('/api/voice/review',{headers:authH(),validate:d=>!!d&&d.mode==='MOCK'&&typeof d.status==='string'&&d.metaCalled===false});
  if(S.state?.runId!==prior)return;
  const result=$('voice-result');result.hidden=false;result.replaceChildren();
  const title=document.createElement('strong');title.textContent=r.status==='REVIEWED'?'MOCK 의미 분석 · 실제 Meta 호출 없음':'분석 가능한 MOCK 확정 발화가 없습니다.';result.append(title);
  if(r.analysis){const line=document.createElement('p');line.textContent=`위험 단계: ${r.analysis.riskLevel} · 실험 점수 ${r.analysis.riskIndex}/100 · 근거 발화 ID: ${(r.analysis.evidenceUtteranceIds||[]).join(', ')||'없음'}`;result.append(line);
   const note=document.createElement('p');note.textContent='도구 제안은 버튼 표시 후보일 뿐 금융 실행 권한이 아닙니다. '+(r.toolSuggestions||[]).map(x=>`${x.kind}: ${x.decision.accepted?'검증됨':'거절됨'}`).join(' / ');result.append(note);}
  setT('voice-status',r.message||'실제 음성 처리 및 외부 AI 호출 없음');
 }catch(error){setT('voice-status',error.message||'MOCK 분석 조회 실패. 사건 상태를 확인하세요.');}
 finally{$('voice-review').disabled=!!S.busy||!!S.sessionInvalid||!!S.needsReconcile;}
});
$('m-stop').addEventListener('click',()=>mutate('action',{action:'STOP_TRANSFER'}));$('m-emergency').addEventListener('click',()=>mutate('action',{action:'EMERGENCY_HELP'}));
$('m-transfer').addEventListener('click',()=>mutate('action',{action:'SIMULATED_TRANSFER'}));$('m-verify').addEventListener('click',()=>mutate('verification/request'));
$('msg-inject').addEventListener('click',async()=>{
 if(!$('msg-consent').checked){toast('가상 문자 추가에 명시적으로 동의해 주세요.','warning');return;}
 const result=await mutate('messages/mock-receive',{fixtureId:$('msg-fixture').value,consented:true});
 if(result.ok){$('msg-consent').checked=false;toast('가상 메시지가 같은 사건에 추가되었습니다.','success');}
});
$('msg-list').addEventListener('click',async e=>{
 const button=e.target.closest('button[data-message-attempt],button[data-message-reason],button[data-message-review],button[data-message-revoke]');if(!button||!S.state||S.state.endedAt)return;
 if(button.dataset.messageReview||button.dataset.messageRevoke){
  const release=!!button.dataset.messageReview;
  if(release&&!$('msg-review-consent').checked){toast('별도 공식 경로 확인 자기보고에 동의한 경우에만 임시 미리보기를 허용합니다.','warning');return;}
  const result=await mutate('messages/review',{messageId:button.dataset.messageReview||button.dataset.messageRevoke,
   reviewId:'msg_review_'+crypto.randomUUID(),action:release?'RELEASE_PREVIEW':'REVOKE',
   reason:release?'INDEPENDENT_OFFICIAL_CHECK_SELF_REPORTED':'USER_REVOKED',confirmed:true});
  if(result.ok){$('msg-review-consent').checked=false;toast(release?'15분 가상 미리보기만 허용 · 외부 링크 접속 없음':'임시 허용을 철회했습니다.','info');}return;
 }
 const messageId=button.dataset.messageAttempt||button.dataset.messageReason;
 const message=S.state.messages?.entries?.find(m=>m.id===messageId);if(!message)return;
 if(button.dataset.messageAttempt&&message.verdict==='QUARANTINED')return; // DOM enforcement and server re-check.
 if(S.busy||S.needsReconcile||S.sessionInvalid)return;
 const result=await mutate('messages/link-attempt',{messageId,attemptId:'msg_attempt_'+crypto.randomUUID()});
 if(result.ok)toast(result.state.messages.lastAttempt.blocked?'서버가 의심 링크 선택을 차단했습니다.':'가상 선택 기록 완료 · 외부 링크는 열지 않습니다.',result.state.messages.lastAttempt.blocked?'warning':'info');
});
$('postcall-questions').addEventListener('change',async e=>{
 const sel=e.target.closest('select[data-postcall-question]');if(!sel||!['YES','NO','UNSURE'].includes(sel.value)||!S.state?.callEndedAt||S.state.endedAt)return;
 await mutate('postcall/answer',{question:sel.dataset.postcallQuestion,answer:sel.value});
});
$('postcall-export').addEventListener('click',async()=>{
 if(!S.state?.callEndedAt||!$('postcall-vault-consent').checked){toast('통화 종료 후 암호화 백업에 동의해 주세요.','warning');return;}
 const passphrase=$('postcall-passphrase').value;
 if(passphrase.length<12){toast('백업 암호를 12자 이상 입력해 주세요.','warning');return;}
 try{const data=await requestJson('/api/postcall/export',{method:'POST',headers:authH(),
  body:{runId:S.state.runId,expectedVersion:S.state.version,consented:true,passphrase},
  validate:d=>d?.mode==='USER_MANAGED_ENCRYPTED_CAPSULE'&&typeof d.capsule==='string'});
  $('postcall-capsule').value=data.capsule;
  setT('postcall-vault-status','백업 문자열을 직접 안전한 곳에 보관하세요. 자동 저장되지 않습니다.');
 }catch(error){toast(error.message||'백업 생성 오류','error');}
 finally{$('postcall-passphrase').value='';$('postcall-vault-consent').checked=false;}
});
$('postcall-import').addEventListener('click',async()=>{
 if(!$('postcall-vault-consent').checked){toast('복원에 명시적으로 동의해 주세요.','warning');return;}
 const passphrase=$('postcall-passphrase').value,capsule=$('postcall-capsule').value.trim();
 const result=await mutate('postcall/import',{passphrase,capsule,consented:true});
 $('postcall-passphrase').value='';$('postcall-vault-consent').checked=false;
 if(result.ok){$('postcall-capsule').value='';toast('새 사건에 자기보고만 복원했습니다. 실제 보호 조치는 실행되지 않았습니다.','success');}
});
$('postcall-delete').addEventListener('click',async()=>{
 if(!$('postcall-delete-confirm').checked){toast('현재 후속 기록 삭제를 확인해 주세요.','warning');return;}
 const result=await mutate('postcall/delete',{scope:'POSTCALL_ONLY',confirmed:true});
 $('postcall-delete-confirm').checked=false;
 if(result.ok){$('postcall-capsule').value='';$('postcall-passphrase').value='';toast('현재 사건의 후속 자기보고를 삭제했습니다.','success');}
});
$('postcall-steps').addEventListener('change',async e=>{
 const sel=e.target.closest('select[data-postcall-task]');if(!sel||!S.state?.callEndedAt||S.state.endedAt)return;
 await mutate('postcall/task',{taskId:sel.dataset.postcallTask,status:sel.value,eventId:'pc_'+crypto.randomUUID()});
});
$('btn-tx').addEventListener('click',async()=>{
 if(!validateTransferForm().ok)return;
 if(S.state?.risk?.band==='HIGH'||S.state?.risk?.emergency){
  const ok=await confirmDialog('송금 전 확인','높은 위험 단서가 있는 상태입니다. 이 버튼은 가상 기록만 남기고 실제 금융기관에는 연결되지 않습니다. 공식 채널 확인이나 송금 보류를 선택할 수 있습니다.','가상 기록만');
  if(!ok){toast('가상 송금을 진행하지 않았습니다. 실제 계좌는 변하지 않습니다.','info');return;}
 }
 const result=await mutate('action',{action:'SIMULATED_TRANSFER'});if(!result.ok)return;toast('가상 송금 시도가 서버 사건에 기록되었습니다 · 실제 송금 없음','success');go('guard')
});
$('tx-name')?.addEventListener('input',()=>{const e=$('tx-name-error');if(e)e.hidden=true;});
$('tx-amt')?.addEventListener('input',()=>{const e=$('tx-amt-error');if(e)e.hidden=true;});
$('confirm-cancel')?.addEventListener('click',()=>closeConfirm(false));
$('confirm-ok')?.addEventListener('click',()=>closeConfirm(true));
$('confirm-sheet')?.addEventListener('click',e=>{if(e.target.id==='confirm-sheet')closeConfirm(false);});
document.addEventListener('keydown',e=>{if(!$('confirm-sheet')||$('confirm-sheet').hidden)return;if(e.key==='Escape'){e.preventDefault();closeConfirm(false);}if(e.key==='Tab'){const f=[$('confirm-cancel'),$('confirm-ok')].filter(Boolean);if(!f.length)return;const first=f[0],last=f[f.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
$('inline-alert-close')?.addEventListener('click',hideInlineAlert);
$('inline-alert-retry')?.addEventListener('click',()=>{hideInlineAlert();void refresh();});
$('card-risk-report').addEventListener('click',async()=>{const ok=await confirmDialog('카드 정보 노출 우려','카드번호를 입력하지 않고 노출 가능성만 가상 사건에 기록합니다. 실제 카드 잠금은 별도 선택이 필요합니다.','우려 기록');if(ok)await mutate('action',{action:'CARD_EXPOSURE_REPORTED'});});
$('card-lock').addEventListener('click',()=>void mockCardCommand('LOCK'));
$('card-unlock').addEventListener('click',()=>void mockCardCommand('UNLOCK'));
$('sb-arrival').addEventListener('click',()=>bankCmd('ARRIVAL_CONFIRM'));$('sb-consent').addEventListener('click',()=>bankCmd('ASSIST_CONSENT'));$('sb-hold').addEventListener('click',()=>bankCmd('HOLD'));$('sb-cancel').addEventListener('click',()=>bankCmd('CANCEL'));$('map-arrival').addEventListener('click',()=>bankCmd('ARRIVAL_CONFIRM'));
$('btn-endcase').addEventListener('click',async()=>{if(!S.state||S.state.endedAt)return;const ok=await confirmDialog('사건 종료','이 가상 사건을 종료할까요? 종료 후에는 새 명령을 보낼 수 없습니다.','사건 종료');if(!ok)return;await mutate('end');});
$('btn-newcase').addEventListener('click',()=>{if(S.state)mutate('reset',{scenarioId:$('m-scenario').value,mode:'verified'})});
$('btn-demo-settings')?.addEventListener('click',openScenarioSheet);
$('text-benchmark-run')?.addEventListener('click',async()=>{try{const d=await requestJson('/api/text/benchmark',{headers:authH()});const m=d.summary;setT('text-benchmark-result',`합성 사례 ${m.cases}개 · 탐지 ${m.tp}/${m.positives} · 정상 오경고 ${m.fp}/${m.negatives} · 놓친 사례 ${m.fn}개 · 실제 현장 성능 미검증`);}catch{setT('text-benchmark-result','평가 결과를 조회할 수 없습니다. 서버 연결을 확인하세요.');}});
$('v138-benchmark-run')?.addEventListener('click',async()=>{try{const d=await requestJson('/api/text/benchmark/v138',{headers:authH()});const m=d.summary;setT('text-benchmark-result',`v1.38 구현 전 고정된 합성 20건 · 탐지 ${m.tp}/${m.positives} · 정상 오경고 ${m.fp}/${m.negatives} · 미탐지 ${m.fn}건 · 독립 현장 성능은 검증되지 않았습니다.`);}catch{setT('text-benchmark-result','고정 평가 조회에 실패했습니다. 세션·서버 연결을 확인하세요.');}});
$('v138-public-probe-run')?.addEventListener('click',async()=>{try{const d=await requestJson('/api/text/benchmark/v138/public',{headers:authH()});const m=d.summary;setT('text-benchmark-result',`2026년 공개 경고 유형 참고 · 신규 합성 ${m.cases}건 · 탐지 ${m.tp}/${m.positives} · 오경고 ${m.fp}/${m.negatives} · 놓친 위험 패턴 ${m.fn}건 · 실제 성능 아님`);}catch{setT('text-benchmark-result','신규 유형 평가에 실패했습니다. 세션·서버 연결을 확인하세요.');}});
$('scenario-close')?.addEventListener('click',closeScenarioSheet);
$('scenario-sheet')?.addEventListener('click',e=>{if(e.target.id==='scenario-sheet')closeScenarioSheet();});
document.querySelectorAll('[data-scenario-option]').forEach(b=>b.addEventListener('click',()=>void chooseScenario(b.dataset.scenarioOption)));
document.addEventListener('keydown',e=>{const sh=$('scenario-sheet');if(!sh||sh.hidden)return;if(e.key==='Escape'){e.preventDefault();closeScenarioSheet();}});
$('m-scenario').addEventListener('change',()=>{if(S.state)mutate('reset',{scenarioId:$('m-scenario').value,mode:'verified'})});
// Map: explicit open, one-shot location only, coords never stored/sent to server.
$('map-open').addEventListener('click',()=>{$('map-box').hidden=false;$('map-open').hidden=true;const fb=$('map-fallback');if(fb)fb.hidden=true;drawMap()});
$('map-frame').addEventListener('load',()=>{S.mapLoaded=true;clearTimeout(S.mapTimer);if($('map-box').hidden||S.mapFailed)return;const fb=$('map-fallback');if(fb)fb.hidden=true;setT('map-status',S.mapPos?'현재 위치 주변 지도를 표시합니다. 은행 도착을 의미하지 않습니다.':'지도 프레임 로딩 완료 · 표시 정보는 실제 은행 위치 인증이 아닙니다.')});
$('map-frame').addEventListener('error',()=>{S.mapFailed=true;const fb=$('map-fallback');if(fb)fb.hidden=false;setT('map-status','지도를 표시할 수 없습니다. 외부 지도 연결을 확인하거나 나중에 재시도하세요.')});
$('map-retry')?.addEventListener('click',()=>{const fb=$('map-fallback');if(fb)fb.hidden=true;drawMap();});
$('map-close').addEventListener('click',()=>{S.mapRequest++;clearTimeout(S.mapTimer);$('map-box').hidden=true;$('map-open').hidden=false;S.mapPos=null;$('map-frame').removeAttribute('src');setT('map-status','위치 표시를 삭제했습니다')});
function drawMap(){setT('map-status','지도 불러오는 중… 연결 실패 시 지역 지도 탐색을 다시 시도하세요.');S.mapLoaded=false;S.mapFailed=false;clearTimeout(S.mapTimer);S.mapTimer=setTimeout(()=>{if(!$('map-box').hidden&&!S.mapLoaded){const fb=$('map-fallback');if(fb)fb.hidden=false;setT('map-status','지도 로딩 시간이 초과되었습니다. 아래 대체 안내를 사용하세요.');}},6000);const c=S.mapPos||(S.state?.jurisdiction==='US'?{lat:40.7128,lon:-74.006}:{lat:37.5665,lon:126.978});const d=S.mapPos?0.009:0.025;const bbox=[c.lon-d,c.lat-d,c.lon+d,c.lat+d].map(x=>x.toFixed(5)).join('%2C');$('map-frame').src='https://www.openstreetmap.org/export/embed.html?bbox='+bbox+'&layer=mapnik'}
$('map-locate').addEventListener('click',()=>{if(!navigator.geolocation){setT('map-status','위치 서비스를 사용할 수 없습니다. 지역 지도를 사용하세요.');return}setT('map-status','위치 조회 중… (한 번만, 저장 안 함)');const request=++S.mapRequest;
 navigator.geolocation.getCurrentPosition(p=>{if(request!==S.mapRequest||$('map-box').hidden)return;const{latitude,longitude,accuracy}=p.coords;if(![latitude,longitude,accuracy].every(Number.isFinite)||accuracy>2000){setT('map-status','위치가 부정확합니다. 직접 탐색하세요.');return}S.mapPos={lat:latitude,lon:longitude};setT('map-status','현재 위치 주변 지도를 표시합니다. 은행 도착을 의미하지 않습니다.');drawMap()},()=>{if(request===S.mapRequest&&!$('map-box').hidden)setT('map-status','위치 권한 거부/실패 · 지역 지도를 사용할 수 있습니다.')},{enableHighAccuracy:false,maximumAge:0,timeout:8000})});
$('error-retry').addEventListener('click',()=>void initialize());
$('error-new').addEventListener('click',()=>void initialize({newSession:true}));
$('connection-retry').addEventListener('click',()=>{if(S.auth){void refresh();sse()}else void initialize()});
$('theme-toggle').addEventListener('click',()=>{const light=document.body.dataset.theme!=='light';document.body.dataset.theme=light?'light':'dark';$('theme-toggle').setAttribute('aria-pressed',String(light));const lbl=$('theme-toggle').querySelector('label');if(lbl)lbl.textContent=light?'다크 화면':'라이트 화면';});
window.addEventListener('online',()=>{if(S.auth&&!S.sessionInvalid){void refresh({quiet:true});sse()}});
window.addEventListener('offline',()=>setConnection('OFFLINE'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.auth&&!S.sessionInvalid){void refresh({quiet:true});sse()}});
boot();
