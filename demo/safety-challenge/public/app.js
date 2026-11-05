const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Only link to known official sources; never trust an arbitrary model- or event-provided URL.
const OFFICIAL_SOURCE_HOSTS=new Set([
  'consumer.ftc.gov','reportfraud.ftc.gov','www.identitytheft.gov','www.fbi.gov','www.ic3.gov',
  'www.fsc.go.kr','www.counterscam112.go.kr','ecrm.police.go.kr','www.kisa.or.kr','www.boho.or.kr','www.police.go.kr'
]);
function safeOfficialUrl(value){
  try{
    // URL() normalizes backslashes and control characters; reject them before parsing.
    if(typeof value!=='string'||value!==value.trim()||/[\\\x00-\x1f\x7f]/.test(value))return null;
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port||!OFFICIAL_SOURCE_HOSTS.has(url.hostname.toLowerCase()))return null;
    return url.href;
  }catch{return null;}
}

// Guided-care source URLs receive the same allowlist validation as coaching and recovery links.
// Escaping a URL for HTML is not a substitute for validating its destination.
function renderGuidedSourceLinks(sources){
  const links=(Array.isArray(sources)?sources:[]).map(source=>{
    const href=safeOfficialUrl(source?.url);
    return href?`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source?.label)}</a>`:'';
  }).join('');
  return links||'<span>국가별 공식 출처 미확인 · 연락처를 추측하지 않습니다.</span>';
}

const childMode=new URLSearchParams(location.search).get('role')==='child';
const AUTH_STORAGE_KEY=childMode?'safecall-local-child-v100':'safecall-local-session-v100';
const session={state:null,busy:false,error:null,recoveryExpanded:false,auth:null,childToken:null,glassesToken:null,events:null};
const modes={warning:'일반 경고',guidance:'케어 가이드',verified:'케어 + 가족 확인'};
const setText=(id,text)=>{const el=$(id);if(el)el.textContent=text;};
const hasAction=kind=>session.state?.actions?.some(a=>a.kind===kind);
const formatTime=iso=>iso?new Date(iso).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';

function authHeaders(){return session.auth?{'X-SafeCall-Session':session.auth.sessionId,'X-SafeCall-Token':session.auth.token}:{};}
async function api(endpoint,body){
  const response=await fetch('/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||`오류 ${response.status}`);
  return data;
}
async function mutate(endpoint,extras={}){
  if(session.busy||!session.state)return;
  session.busy=true;session.error=null;const previous=session.state;
  try{const data=await api(endpoint,{runId:previous.runId,expectedVersion:previous.version,...extras});session.state=data;render();}
  catch(error){session.error=error.message;await refresh();render();}
  finally{session.busy=false;render();}
}
async function refresh(){try{const response=await fetch('/api/state',{cache:'no-store',headers:authHeaders()});if(!response.ok)throw new Error('연결 오류');session.state=await response.json();setText('network-status','LOCAL SIMULATION');}catch{setText('network-status','RECONNECTING');}}
function bind(id,fn){$(id)?.addEventListener('click',fn);}
// Header-authenticated SSE via fetch streaming: credentials are never in URL or browser history.
// Three bounded reconnect attempts, then user can reload. No Meta API call is involved.
function eventSource(){
  if(!session.auth)return;
  session.events?.close();
  const controller=new AbortController();
  let closed=false;
  const onState=data=>{
    if(!session.state||data.runId!==session.state.runId||data.version>=session.state.version){session.state=data;render();}
    setText('network-status','LOCAL SIMULATION');
  };
  const listen=async()=>{
    for(let attempt=0;attempt<3&&!closed;attempt++){
      try{
        const response=await fetch('/api/events',{cache:'no-store',headers:authHeaders(),signal:controller.signal});
        if(!response.ok||!response.body)throw new Error(`SSE connection ${response.status}`);
        const reader=response.body.getReader();
        const decoder=new TextDecoder();let pending='';
        while(!closed){
          const chunk=await reader.read();if(chunk.done)break;
          pending+=decoder.decode(chunk.value,{stream:true}).replaceAll('\r\n','\n');
          if(pending.length>262144)throw new Error('SSE payload exceeds local display limit');
          let boundary;
          while((boundary=pending.indexOf('\n\n'))!==-1){
            const frame=pending.slice(0,boundary);pending=pending.slice(boundary+2);
            if(!frame.startsWith('event: state\n'))continue;
            const raw=frame.split('\n').filter(x=>x.startsWith('data: ')).map(x=>x.slice(6)).join('\n');
            if(raw){try{onState(JSON.parse(raw));}catch{/* malformed mock events do not change case state */}}
          }
        }
      }catch{if(closed||controller.signal.aborted)return;}
      if(closed)return;
      setText('network-status','RECONNECTING');
      await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
    }
    if(!closed)setText('network-status','연결 끊김 · 새로고침해 재접속');
  };
  session.events={close(){closed=true;controller.abort();}};
  void listen();
  return session.events;
}

function render(){if(!session.state)return;
  const s=session.state;
  const child=$('child-view');const parent=$('parent-view');child.hidden=!childMode;parent.hidden=childMode;
  if(childMode){renderChild(s);return;}
  if(s.safeBank){
    const bank=s.safeBank;
    setText('safebank-arrival-status',s.bankArrivalConfirmed?(s.bankArrivalVersion===s.careCaseVersion?'은행 도착 자기 보고됨 · 실제 위치 검증 안 됨':'사건 정보 변경 · 은행 도착을 다시 확인하세요'):'은행 도착 미확인');
    setText('safebank-status',bank.status==='HELD'?'MOCK: 가상 거래 보류 중':bank.status==='CANCELLED'?'MOCK: 보류 취소 기록':'MOCK: 가상 거래 준비');
    setText('safebank-staff-script',s.bankHelpConsented?
      (s.jurisdiction==='US'?'Please ask bank staff to verify the suspicious transfer through official channels.':'은행 직원에게 의심스러운 송금 요청을 알리고 공식 절차로 확인을 요청하세요.'):'직원 안내를 보려면 직접 동의하세요.');
    const disabled=!!s.endedAt||session.busy;
    $('safebank-arrival').disabled=disabled;
    $('safebank-consent').disabled=disabled||!s.bankArrivalConfirmed||s.bankArrivalVersion!==s.careCaseVersion||s.risk?.band==='LOW';
    $('safebank-hold').disabled=disabled||bank.status!=='READY'||!s.bankHelpConsented||s.bankArrivalVersion!==s.careCaseVersion;
    $('safebank-cancel').disabled=disabled||bank.status!=='HELD';
  }
  $('scenario').value=s.scenario.id;$('mode').value=s.mode;
  $('jurisdiction').value=s.jurisdiction||'UNKNOWN';$('jurisdiction').disabled=!!s.endedAt||session.busy;
  const checkin=$('care-checkin');checkin.hidden=s.mode==='warning';
  for(const b of document.querySelectorAll('[data-concern]')){
    b.disabled=!!s.endedAt||session.busy;b.setAttribute('aria-pressed',String(s.concern?.type===b.dataset.concern));
  }
  setText('checkin-status',s.concern?`직접 선택 · ${s.concern.label} · 사실로 확인되지 않았으며 위험 점수에 반영되지 않음`:'직접 선택 전 · 발화가 없어도 케어를 시작할 수 있습니다.');
  setText('case-id',`CASE · ${s.runId.slice(-9).toUpperCase()} · ${modes[s.mode]}`);
  setText('step-label',`발화 ${s.step} / ${s.scenario.totalSteps}`);
  $('progress-bar').style.width=`${Math.round(s.step/s.scenario.totalSteps*100)}%`;
  setText('scenario-hint',s.scenario.intro);
  setText('call-state',s.endedAt?'■ 가상 통화 종료':s.step?'● 가상 통화 진행':'● 시뮬레이션 준비');
  $('btn-next').disabled=!!s.endedAt||s.step===s.scenario.totalSteps||session.busy;
  $('btn-next').textContent=s.step===s.scenario.totalSteps?'대본이 끝났습니다':'다음 발화 보기 →';
  $('transcript').innerHTML=s.transcript.length?s.transcript.map((t,i)=>`<div class="utterance"><div class="utterance-avatar">${i+1}</div><div class="utterance-card"><div class="utterance-label">상대방 · 발화 ${i+1} · SCRIPTED MOCK</div><p>${escapeHtml(t.text)}</p><div class="utterance-cue">${escapeHtml(t.cue)}</div></div></div>`).join(''):
    '<div class="empty-transcript"><div class="empty-icon">❝</div><strong>아직 표시된 발화가 없습니다</strong><p>다음 발화 버튼으로 가상 대화를 시작하세요.</p></div>';
  $('transcript').scrollTop=$('transcript').scrollHeight;
  setText('risk-index',s.risk.index+' / 100');setText('urgency',String(s.risk.urgency));setText('pressure',String(s.risk.pressure));setText('proximity',String(s.risk.proximity));
  const badge=$('risk-badge');badge.className='risk-badge '+(s.risk.band==='HIGH'?'high':s.risk.band==='CAUTION'?'caution':'neutral');
  badge.textContent=s.risk.band==='HIGH'?'위험 근거 높음':s.risk.band==='CAUTION'?'주의 신호':'근거 없음/낮음';
  setText('evidence-count',`${s.risk.evidence}개`);
  if(s.mode==='warning'){
    setText('guidance-heading','일반 위험 경고');setText('coach-label','GENERIC WARNING · BASELINE');
    setText('coach-title',s.risk.band==='HIGH'?'위험한 상황일 수 있습니다.':s.risk.band==='CAUTION'?'주의가 필요할 수 있습니다.':'명확한 위험 신호는 없습니다.');
    setText('coach-copy','이 실험 모드에서는 구체적인 행동 코칭이나 가족 확인 기능을 제공하지 않습니다.');
    $('coach-extra').hidden=true;$('verification-note').hidden=true;
    document.querySelector('.coach-card')?.classList.remove('emergency-care');
  }else{
    setText('guidance-heading','근거 기반 안전 행동');setText('coach-label',s.endedAt?'CLOSED · NO NEW GUIDANCE':'SAFE ACTION · TEAM-REVIEWED PLAYBOOK');
    const care=s.care;
    setText('coach-title',care?.primary||s.guidance?.primary.userAction||'현재 상황을 관찰 중입니다.');
    setText('coach-copy',care?.secondary||'사실 여부는 확정하지 않습니다. 이 안내는 실제 긴급기관을 대신하지 않습니다.');
    $('coach-extra').hidden=false;
    $('coach-extra').textContent=care?`다음 행동 · ${care.nextStep}`:s.guidance?.reason||'기본 안전 안내';
    $('verification-note').hidden=!care?.verificationNotice;
    setText('verification-note',care?.verificationNotice||'');
    setText('coach-label',care?`CARE · ${care.phaseLabel}`:(s.endedAt?'CLOSED':'SAFE ACTION'));
    document.querySelector('.coach-card')?.classList.toggle('emergency-care',!!care?.emergencyGuidancePreserved);
  }
  setText('coaching-jurisdiction',s.mode==='warning'?'':s.care?.coaching?.jurisdictionNotice||'');
  $('coaching-sources').hidden=s.mode==='warning';
  $('coaching-sources').innerHTML=(s.care?.coaching?.sourceLinks||[]).map(x=>{const href=safeOfficialUrl(x.url);return href?`<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">공식 자료 · ${escapeHtml(x.label)}</a>`:'';}).join('')||'<span>국가별 특정 자료가 선택되지 않았습니다. 링크·전화번호를 추정하지 않습니다.</span>';
  setText('care-basis',s.care?`안내의 근거 · ${s.care.basis} · 실제 조치는 사용자가 결정합니다.`:'일반 경고 대조군 · 사전 케어 미제공');
  const last=s.transcript.slice(-2);
  $('evidence').innerHTML=last.length?last.map(t=>`<span class="evidence-chip"><b>${escapeHtml(t.turnId)}</b> · ${escapeHtml(t.cue)}</span>`).join('')+
    '<div style="font-size:10px;color:#8da19b;margin-top:9px">표시 문구는 시뮬레이션 해설입니다. 실제 AI가 추론한 내용이 아닙니다.</div>':
    '아직 확인된 발화 근거가 없습니다.';
  const verify=$('family-card');verify.hidden=s.mode!=='verified';
  const vs=s.verification;
  const statuses={REQUESTED:'가상 자녀의 응답을 기다리는 중',SELF_REPORTED_SAFE:'자녀가 안전하다고 자가 보고함 · 안전 증명 아님',HELP_REQUESTED:'가상 자녀가 도움을 요청함 · 실제 위험 여부 미확인',UNABLE_TO_CONFIRM:'자녀 상태 확인 불가 · 사실 미확인',EXPIRED:'확인 요청 만료 · 안전 미확인'};
  setText('verification-status',vs?statuses[vs.status]||'상태 미확인':'아직 요청하지 않았습니다.');
  $('btn-verify').disabled=session.busy||!!s.endedAt||!!vs;
  $('btn-verify').textContent=vs?'확인 요청 기록됨':'가상 가족에게 확인 요청';
  $('btn-expire').hidden=vs?.status!=='REQUESTED';$('btn-expire').disabled=session.busy||!!s.endedAt;
  for(const id of ['btn-stop','btn-emergency','btn-transfer','btn-end'])$(id).disabled=!!s.endedAt||session.busy;
  $('btn-recovery').disabled=session.busy||s.mode==='warning';
  const lastAction=s.actions.at(-1);setText('last-action',session.error?`오류: ${session.error}`:lastAction?`마지막 행동 · ${formatTime(lastAction.at)} · ${lastAction.note}`:'아직 선택된 행동이 없습니다.');
  const tiles=[['가상 송금 시도',s.review.fakeTransferAttempted?'시도 기록 있음':'없음'],['송금 보류 선택',s.review.stoppedTransfer?'선택함':'아직 선택 안 함'],['긴급 도움 선택',s.review.emergencyHelpSelected?'선택함':'아직 선택 안 함'],['독립 확인 요청',s.review.familyVerificationRequested?'요청함':'없음']];
  $('results').innerHTML=tiles.map(([k,v])=>`<div class="result-tile"><b>${escapeHtml(k)}</b><span>${escapeHtml(v)}</span></div>`).join('');
  $('event-log').innerHTML=s.log.slice().reverse().map(e=>`<div class="event-row"><span>${escapeHtml(formatTime(e.at))}</span><b>${escapeHtml(e.type)}</b><p>${escapeHtml(e.message)}</p></div>`).join('');
  const previous=s.completedRuns.filter(x=>x.scenario===s.scenario.name);
  $('comparison').hidden=!previous.length;
  $('comparison-body').innerHTML=previous.length?`<div class="comparison-table"><div class="comparison-row header"><span>실험 모드</span><span>가상 송금 시도</span><span>송금 보류</span><span>독립 확인 요청</span></div>${previous.map(r=>`<div class="comparison-row"><span>${escapeHtml(modes[r.mode]||r.mode)}</span><span>${r.review.fakeTransferAttempted?'있음':'없음'}</span><span>${r.review.stoppedTransfer?'있음':'없음'}</span><span>${r.review.familyVerificationRequested?'있음':'없음'}</span></div>`).join('')}</div>`:'';
  renderRecovery(s);renderGuided(s);renderActiveCare(s);renderPresenter(s);
}
const adaptiveCopy={
 KR:{REQUEST_TYPE:'상대방이 지금 어떤 행동을 요구하고 있나요?',ACTION_STATUS:'그 행동을 이미 했나요?',
 PAYMENT:'송금·결제',CREDENTIALS:'인증번호·비밀번호',REMOTE:'앱 설치·화면 공유',FAMILY:'가족 위급 주장',NONE:'구체적 요구 없음',UNSURE:'잘 모르겠음',
 NOT_DONE:'아직 하지 않음',PARTLY_DONE:'일부 진행',DONE:'이미 진행함'},
 US:{REQUEST_TYPE:'What is the caller asking you to do?',ACTION_STATUS:'Have you already done that?',
 PAYMENT:'Pay or send money',CREDENTIALS:'Share a password or code',REMOTE:'Install an app or share screen',FAMILY:'Family emergency claim',NONE:'Nothing specific',UNSURE:'Not sure',
 NOT_DONE:'Not yet',PARTLY_DONE:'Partially',DONE:'Already done'},
};
function careQuestionEvent(type,more={}){
 const s=session.state;if(!s?.careInteraction)return;
 return mutate('care/question/event',{eventId:crypto.randomUUID(),type,expectedInteractionVersion:s.careInteraction.version,
   caseVersion:s.careInteraction.activeQuestion?.caseVersion??s.careInteraction.questionProposal?.caseVersion??s.careCaseVersion??0,...more});
}
function renderActiveCare(s){
 const panel=$('adaptive-care');panel.hidden=s.mode==='warning';if(panel.hidden)return;
 const c=s.careInteraction;if(!c)return;
 const q=c.activeQuestion,pr=c.questionProposal;
 const lang=s.jurisdiction==='US'?'US':'KR',v=adaptiveCopy[lang];
 const active=$('adaptive-question');active.hidden=!q;
 if(q){
   setText('adaptive-prompt',v[q.id]||q.id);
   $('adaptive-options').innerHTML=q.choices.map(id=>`<button type="button" class="adaptive-choice" data-choice="${escapeHtml(id)}">${escapeHtml(v[id]||id)}</button>`).join('');
 }
 const maybeStart=!q&&pr?.decision==='ASK'&&!s.endedAt;
 $('adaptive-start').hidden=!maybeStart;$('adaptive-start').disabled=session.busy;
 $('adaptive-skip').disabled=session.busy;
 $('adaptive-unsafe').disabled=session.busy||!!s.endedAt||c.screenUnsafe;
 const answers=Object.entries(c.answers).map(([k,x])=>`${v[k]||k}: ${v[x]||x}`).join(' / ');
 const message={SKIP_EMERGENCY:'긴급 위험 안내 우선 · 질문 생략',SKIP_UNSAFE:'화면·원격 접근 위험 가능성 · 질문 중단',
   SKIP_CASE_CLOSED:'종료된 사건에서는 새 질문 없음',SKIP_NO_NEED:'추가 질문 없이 현재 행동 안내를 확인하세요.',ASK:'원한다면 선택형 질문 하나를 시작할 수 있습니다.',ALREADY_PRESENTED:'답변은 선택 사항입니다. 민감한 정보는 입력하지 마세요.'};
 setText('adaptive-status',`${c.screenUnsafe?'화면이 안전하지 않다고 직접 보고함 · 다른 신뢰 가능한 기기로 공식 경로를 확인하세요.':message[pr?.decision]||''}${answers?' · 사용자 응답(미확인): '+answers:''}`);
}
function renderRecovery(s){
  const recovery=s.recovery;
  $('recovery-panel').hidden=!recovery||!(session.recoveryExpanded||hasAction('RECOVERY_OPEN')||!!recovery.selectedPath);
  if(!recovery)return;
  const picker=$('recovery-path');
  const options='<option value="">유형 선택</option>'+recovery.paths.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)}</option>`).join('');
  if(picker.innerHTML!==options)picker.innerHTML=options;
  picker.value=recovery.selectedPath??'';picker.disabled=session.busy;
  setText('recovery-summary',recovery.selectedPath?`${recovery.summary} · ${s.endedAt?'종료된 사건의 회복 기록 (위험 엔진 변경 없음)':'사건 진행 중 회복 안내'}`:'피해가 있었는지 확정하지 않습니다. 해당 유형을 직접 선택하세요.');
  $('recovery-steps').innerHTML=recovery.steps.map((step,i)=>`<div class="recovery-step"><div class="recovery-step-label"><strong>${i+1}. ${escapeHtml(step.description)}</strong><small>사용자가 체크한 상태이며 실제 이행 여부는 검증하지 않음</small></div><select data-recovery-step="${escapeHtml(step.id)}" aria-label="${i+1}번 단계 진행 상태" ${session.busy?'disabled':''}><option value="TODO" ${step.status==='TODO'?'selected':''}>미완료</option><option value="DONE" ${step.status==='DONE'?'selected':''}>완료했다고 표시</option><option value="NOT_APPLICABLE" ${step.status==='NOT_APPLICABLE'?'selected':''}>해당 없음</option></select></div>`).join('');
  $('btn-review-recovery').hidden=!recovery.selectedPath;$('btn-review-recovery').disabled=session.busy;
  setText('recovery-updated',`회복 기록 v${recovery.version}${recovery.reviewedAt?' · 마지막 재검토 '+formatTime(recovery.reviewedAt):''}`);
  const countryName={KR:'한국',US:'미국',UNKNOWN:'미확인'}[recovery.sourceCountry]||'미확인';
  $('recovery-sources').innerHTML=`<b>공식 자료 · ${countryName}</b>`+(recovery.sources.length?recovery.sources.map(x=>{const href=safeOfficialUrl(x.url);return href?`<a target="_blank" rel="noopener noreferrer" href="${escapeHtml(href)}">${escapeHtml(x.label)} · ${escapeHtml(x.scope)}</a>`:'';}).join(''):'<span>국가가 확인되지 않아 기관과 긴급 전화번호를 추정하지 않습니다.</span>');
}
function recoveryEvent(type,extra={}){
  if(!session.state?.recovery)return;
  return mutate('recovery/event',{eventId:crypto.randomUUID(),type,expectedRecoveryVersion:session.state.recovery.version,
    pathId:session.state.recovery.selectedPath,...extra});
}


function guidedEvent(type,extra={}){
 const state=session.state;if(!state?.guided)return;
 return mutate('guided/event',{eventId:crypto.randomUUID(),type,expectedGuidedVersion:state.guided.version,...extra});
}
function renderGuided(s){
 const panel=$('guided-panel');panel.hidden=s.mode==='warning';if(panel.hidden)return;
 const g=s.guided;if(!g)return;
 const paths=$('guided-path');const prior=paths.value;
 paths.innerHTML='<option value="">상황을 선택하세요</option>'+g.availablePaths.map(x=>`<option value="${escapeHtml(x.id)}">${escapeHtml(x.label)}${g.paths.includes(x.id)?' · 등록됨':''}</option>`).join('');
 paths.value=g.activePath||prior||'';paths.disabled=session.busy||g.phase==='CLOSED';
 $('guided-detail').hidden=!g.activePath;
 if(!g.activePath)return;
 const paused=g.phase==='PAUSED',closed=g.phase==='CLOSED';
 setText('guided-status',`상태: ${g.phase} · 사건 ${g.caseClosed?'종료':'진행 중'} · 추가 유형 ${g.paths.length}개 · 처리 기록 ${g.version}개`);
 const status=$('guided-action-status');status.value=g.context.actionStatus;status.disabled=session.busy||paused||closed;
 const method=$('guided-method');method.innerHTML=g.paymentMethods.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
 method.value=g.paymentMethods.includes(g.context.paymentMethod)?g.context.paymentMethod:'UNKNOWN';
 method.disabled=session.busy||paused||closed;method.hidden=g.activePath!=='PAYMENT';
 const mLabel=method.previousElementSibling;if(mLabel)mLabel.hidden=g.activePath!=='PAYMENT';
 $('guided-sources').innerHTML=renderGuidedSourceLinks(g.sources);
 let statement='';
 if(g.blocker==='EMERGENCY_PRIORITY')statement='긴급 안전 안내가 우선입니다. 현지 긴급기관 도움을 고려하세요. 이 케어의 단계 완료 기록은 일시 중단됩니다.';
 else if(g.blocker==='SCREEN_UNSAFE')statement='화면 비안전: 민감정보 입력 및 단계 진행을 멈추고, 다른 신뢰할 수 있는 기기나 사람을 이용하세요.';
 else if(paused)statement='케어를 일시 중단했습니다. 재개하거나 종료할 수 있습니다.';
 else if(closed)statement='케어가 종료됐습니다. 이 사건의 케어 절차는 재시작되지 않습니다.';
 else if(!g.currentStep)statement='선택된 절차를 모두 진행했다고 기록했거나 건너뛰었습니다. 이는 실제 외부 처리 성공을 뜻하지 않습니다.';
 const step=g.currentStep;
 $('guided-current').innerHTML=`<div class="coach-label">GUIDED CARE · ${escapeHtml(g.activePath)} · USER SELF REPORT</div>`+
   (step?`<div class="coach-title">${escapeHtml(step.title)}</div><p class="coach-copy">${escapeHtml(step.instruction)}</p>`:'')+
   `<p class="care-basis">${escapeHtml(statement||g.completionNotice)}</p>`;
 const statusEvent=[...g.events].reverse().find(e=>e.type==='GUIDED_STEP_RESULT'&&e.stepId===step?.id);
 setText('guided-fallback',statusEvent?.result==='UNABLE_TO_COMPLETE'||statusEvent?.result==='RESULT_UNKNOWN' ?`대안: ${step?.fallback||''}`:'할 수 없음을 선택하면 안전한 대체 행동을 보여줍니다.');
 for(const b of $('guided-buttons').querySelectorAll('button'))b.disabled=session.busy||!g.canRecord||!step;
 $('guided-buttons').hidden=!step||closed;
 $('guided-pause').disabled=session.busy||g.phase!=='ACTIVE';
 $('guided-resume').disabled=session.busy||g.phase!=='PAUSED';
 $('guided-close').disabled=session.busy||closed;
}
function renderPresenter(s){
  const guide=s.sceneGuide;
  const select=$('presenter-scene');
  if(guide)select.value=guide.id;
  $('presenter-load').disabled=session.busy;
  setText('presenter-meta',s.modelReadiness?.liveVerified?'Meta LIVE 호출 검증 기록 존재':'Meta LIVE 미검증 · 호출 없음 · Model Adapter 준비 상태');
  if(!guide){
    setText('presenter-status','장면을 선택한 뒤 ‘이 장면 시작’을 눌러 실제 상태 기반 시연을 진행하세요.');
    $('presenter-checklist').replaceChildren();return;
  }
  setText('presenter-status',guide.completed?
    `시연 완료 ${guide.progress.done}/${guide.progress.total} · 가상 단계 기록만 검증됨`:
    `${guide.title} · ${guide.progress.done}/${guide.progress.total} 단계 확인 · 다음: ${guide.next?.label||''}`);
  $('presenter-checklist').innerHTML=guide.milestones.map(x=>
    `<li><span class="scene-check ${x.done?'ok':''}" aria-label="${x.done?'확인':'미완료'}">${x.done?'✓':'○'}</span>`+
    `<div class="scene-copy"><strong>${escapeHtml(x.label)}</strong><small>${escapeHtml(x.instruction)}</small></div></li>`).join('');
}

function renderChild(s){
  const r=s.verification;const pending=!!r&&r.status==='REQUESTED'&&!s.endedAt;
  setText('child-status',!r?'요청 대기 중':pending?'응답 대기 중':s.endedAt?'사건 종료':'응답 기록됨');
  setText('child-headline',!r?'대기 중인 가상 요청이 없습니다':pending?'가상 보호자가 안전 확인을 요청했습니다':
    '가상 요청의 응답이 처리됐습니다');
  setText('child-description',!r?'부모 화면에서 가상 가족 확인을 시작하세요.':pending?
    '여기에 나타나는 버튼은 오직 이 로컬 시뮬레이션의 사건 상태만 변경합니다.':'이 결과는 실제 신원 또는 신체 안전의 증명이 아닙니다.');
  $('child-options').hidden=!pending;
  for(const button of $('child-options').querySelectorAll('button'))button.disabled=session.busy;
}
function openPage(role){const u=new URL(location.href);u.searchParams.set('role',role);u.hash='';
 if(session.auth&&role==='child'&&session.childToken){u.hash=new URLSearchParams({session:session.auth.sessionId,token:session.childToken}).toString();}
 else if(session.auth&&role==='parent'&&!childMode){u.hash=new URLSearchParams({session:session.auth.sessionId,token:session.auth.token}).toString();}
 window.open(u.href,'_blank','noopener,noreferrer');}
async function bootstrapSession(){
 const hash=new URLSearchParams(location.hash.replace(/^#/,''));
 const fromLink=hash.get('session')&&hash.get('token')?{sessionId:hash.get('session'),token:hash.get('token')}:null;
 if(fromLink){session.auth=fromLink;sessionStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify(fromLink));history.replaceState(null,'',location.pathname+location.search);}
 else {try{session.auth=JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY)||'null');}catch{session.auth=null;}}
 if(session.auth){try{const saved=JSON.parse(sessionStorage.getItem('safecall-local-session-v100')||'null');if(saved?.sessionId===session.auth.sessionId&&!childMode){session.childToken=saved.childToken??null;session.glassesToken=saved.glassesToken??null;}await refresh();if(!session.state)throw new Error('missing session');return;}catch{session.auth=null;}}
 if(childMode){setText('network-status','가상 가족 연결 링크를 보호자 화면에서 다시 열어주세요');return;}
 const created=await api('session/create',{scenarioId:'kidnap',mode:'verified'});
 session.auth={sessionId:created.sessionCredentials.sessionId,token:created.sessionCredentials.parentToken};
 session.childToken=created.sessionCredentials.childToken;session.glassesToken=created.sessionCredentials.glassesToken;
 sessionStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify({ ...session.auth,childToken:session.childToken,glassesToken:session.glassesToken}));
 session.state=created;
}

async function disposeAndRestart(){
 if(session.busy||childMode||!session.auth)return;
 session.busy=true;
 try{
  const response=await fetch('/api/session/close',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:'{}',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`세션 종료 거부 (${response.status})`);
  session.events?.close();sessionStorage.removeItem(AUTH_STORAGE_KEY);session.auth=null;session.childToken=null;session.glassesToken=null;session.state=null;
  location.replace('/');
 }catch(e){session.error=e instanceof Error?e.message:'세션 종료 실패';session.busy=false;await refresh();render();}
}
async function reset(){if(session.busy)return;session.busy=true;
  try{session.state=await api('reset',{runId:session.state?.runId,expectedVersion:session.state?.version,scenarioId:$('scenario').value,mode:$('mode').value});session.recoveryExpanded=false;session.error=null;}
  catch(e){session.error=e.message;await refresh();}
  finally{session.busy=false;render();}
}
function downloadReport(data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='safecall-fictional-demo-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function safeBankCommand(type){
  const state=session.state;
  if(!state||session.busy)return;
  if(!window.confirm(type==='HOLD'?'가상 송금을 보류할까요? 실제 금융 거래에는 영향이 없습니다.':type==='CANCEL'?'가상 보류를 취소할까요?':type==='ARRIVAL_CONFIRM'?'은행에 도착했다고 직접 확인하시겠습니까? GPS로 검증하지 않습니다.':'은행 직원 도움 안내를 표시할까요?'))return;
  mutate('safebank/command',{type,confirmed:true,commandId:'mock_'+crypto.randomUUID(),expectedBankRevision:state.safeBank?.revision});
}
function init(){
  $('child-view').hidden=!childMode;$('parent-view').hidden=childMode;
  bind('safebank-arrival',()=>safeBankCommand('ARRIVAL_CONFIRM'));
  bind('safebank-consent',()=>safeBankCommand('ASSIST_CONSENT'));
  bind('safebank-hold',()=>safeBankCommand('HOLD'));
  bind('safebank-cancel',()=>safeBankCommand('CANCEL'));
  bind('btn-next',()=>mutate('advance'));bind('btn-reset',reset);bind('btn-close-session',disposeAndRestart);
  bind('presenter-load',()=>mutate('demo/scene/load',{sceneId:$('presenter-scene').value}));
  bind('adaptive-start',()=>{const s=session.state;const id=s?.careInteraction?.questionProposal?.questionId;if(id)careQuestionEvent('CARE_QUESTION_PRESENTED',{questionId:id,caseVersion:s.careCaseVersion});});
  bind('adaptive-skip',()=>{const id=session.state?.careInteraction?.activeQuestion?.id;if(id)careQuestionEvent('CARE_QUESTION_SKIPPED',{questionId:id});});
  bind('adaptive-unsafe',()=>careQuestionEvent('CARE_SCREEN_UNSAFE_REPORTED',{caseVersion:session.state?.careCaseVersion}));
  $('adaptive-options')?.addEventListener('click',e=>{const button=e.target.closest('[data-choice]');const id=session.state?.careInteraction?.activeQuestion?.id;if(button&&id)careQuestionEvent('CARE_QUESTION_ANSWERED',{questionId:id,choiceId:button.dataset.choice});});
  $('jurisdiction')?.addEventListener('change',e=>mutate('jurisdiction',{jurisdiction:e.target.value}));
  for(const b of document.querySelectorAll('[data-concern]'))b.addEventListener('click',()=>mutate('care/check-in',{concern:b.dataset.concern}));
  bind('btn-stop',()=>mutate('action',{action:'STOP_TRANSFER'}));
  bind('btn-emergency',()=>mutate('action',{action:'EMERGENCY_HELP'}));
  bind('btn-transfer',()=>mutate('action',{action:'SIMULATED_TRANSFER'}));
  bind('btn-recovery',()=>{session.recoveryExpanded=true;render();if(!session.state?.endedAt&&!hasAction('RECOVERY_OPEN'))mutate('action',{action:'RECOVERY_OPEN'});});
  $('recovery-path')?.addEventListener('change',e=>{if(e.target.value)recoveryEvent('CARE_PATH_SELECTED',{pathId:e.target.value});});
  $('recovery-steps')?.addEventListener('change',e=>{const stepId=e.target.dataset.recoveryStep;if(!stepId)return;const status=e.target.value;recoveryEvent(status==='TODO'?'RECOVERY_STEP_REOPENED':'RECOVERY_STEP_MARKED',{stepId,status});});
  bind('btn-review-recovery',()=>recoveryEvent('RECOVERY_REVIEWED'));
  $('guided-path')?.addEventListener('change',e=>{if(e.target.value)guidedEvent('GUIDED_PATH_ADDED',{pathId:e.target.value});});
  $('guided-method')?.addEventListener('change',e=>guidedEvent('GUIDED_CONTEXT_SET',{field:'paymentMethod',value:e.target.value}));
  $('guided-action-status')?.addEventListener('change',e=>guidedEvent('GUIDED_CONTEXT_SET',{field:'actionStatus',value:e.target.value}));
  $('guided-buttons')?.addEventListener('click',e=>{const button=e.target.closest('[data-guided-result]');const g=session.state?.guided;if(button&&g?.currentStep)guidedEvent('GUIDED_STEP_RESULT',{pathId:g.activePath,stepId:g.currentStep.id,result:button.dataset.guidedResult});});
  bind('guided-pause',()=>guidedEvent('GUIDED_PAUSED'));
  bind('guided-resume',()=>guidedEvent('GUIDED_RESUMED'));
  bind('guided-close',()=>guidedEvent('GUIDED_CLOSED'));
  bind('btn-verify',()=>mutate('verification/request'));bind('btn-expire',()=>mutate('verification/expire'));
  bind('btn-end',()=>mutate('end'));
  bind('btn-child',()=>openPage('child'));bind('btn-parent',()=>openPage('parent'));
  bind('btn-glasses',()=>{
 if(!session.auth||!session.glassesToken||childMode){session.error='이 세션은 안경 연결용 읽기 권한이 없습니다. 새로운 보호자 세션에서 시작하세요.';render();return;}
 const u=new URL('/glasses',location.href);u.hash=new URLSearchParams({session:session.auth.sessionId,token:session.glassesToken}).toString();
 window.open(u.href,'_blank','noopener,noreferrer');
});
  bind('btn-report',async()=>{try{const r=await fetch('/api/report',{headers:authHeaders()});downloadReport(await r.json());}catch(e){session.error=e.message;render();}});
  for(const b of document.querySelectorAll('[data-response]'))b.addEventListener('click',()=>{
    if(!session.state?.verification)return;
    mutate('verification/respond',{response:b.dataset.response,requestId:session.state.verification.requestId});
  });
  bind('btn-guide',()=>$('help-dialog').showModal());bind('close-help',()=>$('help-dialog').close());
  bootstrapSession().then(()=>{render();eventSource();}).catch(e=>{session.error=e.message;setText('network-status','시연 초기화 실패');});
}
init();
