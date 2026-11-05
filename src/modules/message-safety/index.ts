import {observeBrowserMockFixture} from './ports.ts';
/** SafeCall v1.35: deterministic MOCK inbox policy. Never fetches or follows URLs.
 * This does not control an OS SMS app. Never use AI confidence as identity proof.
 */
export type MessageFixtureId='parcel-bait'|'prosecutor-bait'|'otp-bait'|'family-normal'|'parcel-normal'|'unknown-link'|'toll-fee-bait'|'task-job-bait'|'wedding-qr-bait'|'loan-fee-bait'|'bank-education-normal';
export type MessageVerdict='QUARANTINED'|'REVIEW_ONLY'|'NO_LINK';
export type MessageEntry={id:string;fixtureId:MessageFixtureId;receivedAt:string};
export type MessageReview={reviewId:string;messageId:string;action:'RELEASE_PREVIEW'|'REVOKE';reason:'INDEPENDENT_OFFICIAL_CHECK_SELF_REPORTED'|'USER_REVOKED';caseVersion:number;at:string;expiresAt:string|null};
export type MessageAttempt={attemptId:string;messageId:string;blocked:boolean;reason:string;at:string};
export const MESSAGE_FIXTURES:Readonly<Record<MessageFixtureId,Readonly<{sender:string;body:string;link:string|null;senderClass:'UNKNOWN'|'DEMO_CONTACT'}>>>=Object.freeze({
 'parcel-bait':{sender:'[모의 배송 알림]',body:'미배송 등기 주소 확인이 필요합니다. 지금 즉시 조회하세요: https://parcel-check.example.invalid/verify',link:'https://parcel-check.example.invalid/verify',senderClass:'UNKNOWN'},
 'prosecutor-bait':{sender:'[모의 수사 기관]',body:'검찰 사건 연루 확인이 필요합니다. 즉시 개인정보를 입력하세요: https://case-check.example.invalid/login',link:'https://case-check.example.invalid/login',senderClass:'UNKNOWN'},
 'otp-bait':{sender:'[모의 보안 센터]',body:'보안 인증번호를 지금 제출하세요: https://otp-check.example.invalid/code',link:'https://otp-check.example.invalid/code',senderClass:'UNKNOWN'},
 'family-normal':{sender:'[모의 가족]',body:'오늘 저녁에 집에서 볼까요? 연락 주세요.',link:null,senderClass:'DEMO_CONTACT'},
 'parcel-normal':{sender:'[모의 배송 알림]',body:'요청하신 배송 조회 안내입니다. 공식 판매처 주문 내역에서 확인하실 수 있습니다. https://example.org/tracking',link:'https://example.org/tracking',senderClass:'UNKNOWN'},
 'unknown-link':{sender:'[모의 미확인 발신자]',body:'사진을 확인해 보세요: https://share.example.invalid/picture',link:'https://share.example.invalid/picture',senderClass:'UNKNOWN'},
 'toll-fee-bait':{sender:'[모의 통행료 안내]',body:'미납 통행료가 있습니다. 지금 링크에서 카드 정보를 입력하고 납부하세요: https://toll-mock.example.invalid/pay',link:'https://toll-mock.example.invalid/pay',senderClass:'UNKNOWN'},
 'task-job-bait':{sender:'[모의 부업 관리]',body:'재택 부업 보상 출금하려면 먼저 예치금을 입금하세요: https://tasks-mock.example.invalid/unlock',link:'https://tasks-mock.example.invalid/unlock',senderClass:'UNKNOWN'},
 'wedding-qr-bait':{sender:'[모의 청첩장]',body:'청첩장 QR코드 조회를 위해 개인정보를 입력하세요: https://wedding-mock.example.invalid/qr',link:'https://wedding-mock.example.invalid/qr',senderClass:'UNKNOWN'},
 'loan-fee-bait':{sender:'[모의 대출 안내]',body:'대출 승인 보증금을 먼저 입금해야 지급됩니다: https://loans-mock.example.invalid/fee',link:'https://loans-mock.example.invalid/fee',senderClass:'UNKNOWN'},
 'bank-education-normal':{sender:'[모의 은행 교육]',body:'보이스피싱 예방: 인증번호를 알려주지 마세요. 공식 앱에서 확인하세요: https://example.org/security',link:'https://example.org/security',senderClass:'UNKNOWN'},
});
/** Pure offline policy for allowlisted MOCK messages; no URL navigation or network lookups.
 * Exported separately so legitimate/educational-counterexample text can be benchmarked.
 */
export function evaluateMessageContent(
 body:string,link:string|null,{caseRiskBand='LOW',senderClass='UNKNOWN'}:{caseRiskBand?:string;senderClass?:'UNKNOWN'|'DEMO_CONTACT'}={}
):{verdict:MessageVerdict;reason:string;reasonCode:string;externalNavigation:false}{
 if(!link)return {verdict:'NO_LINK',reason:'외부 링크 없음 · 텍스트 열람만 가능',reasonCode:'NO_LINK',externalNavigation:false};
 const text=body.normalize('NFKC').toLowerCase();
 // A warning that quotes an attack is not the attacker's instruction to the recipient.
 const educational=/(?:피싱\s*예방|사기\s*주의|클릭하지\s*마|누르지\s*마|입력하지\s*마|알려주지\s*마|제출하지\s*마|전송하지\s*마|보내지\s*마|절대\s*제공하지\s*마)/.test(text);
 const coercesAction=/(?:즉시|지금\s*(?:당장|제출)|계정\s*정지|주소\s*확인|개인정보.{0,12}입력|인증\s*번호.{0,12}(?:입력|제출|전달)|송금.{0,15}(?:요청|하세요))/.test(text);
 const claimsAuthority=/(?:검찰|수사|보안\s*센터|등기|미배송|법원|경찰)/.test(text);
 const requestsSensitive=/(?:개인정보|인증\s*번호|비밀번호|계좌|주소\s*확인)/.test(text);
 const payToReceive=/(?:부업|재택|보상|출금|대출|대출금).{0,45}(?:먼저|보증금|예치금|등록비).{0,20}(?:입금|송금|충전)|(?:보증금|예치금|등록비).{0,20}(?:먼저|입금|송금)/.test(text);
 const tollPayment=/(?:통행료|주차\s?요금).{0,40}(?:미납|납부|결제|카드)|(?:미납\s?통행료|미납\s?주차).{0,40}(?:카드|납부)/.test(text);
 // Parse the URL syntax only. NEVER resolve, fetch, follow or auto-open the URL.
 let unsafeSchemeOrHost=false;
 try{const url=new URL(link);
  unsafeSchemeOrHost=url.protocol!=='https:'||url.username!==''||url.password!==''||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)||url.hostname.includes(':')||
    url.hostname.split('.').some(label=>label.startsWith('xn--'))||
    ['localhost','local','internal','test'].some(suffix=>url.hostname===suffix||url.hostname.endsWith('.'+suffix))||
    (url.port!==''&&url.port!=='443')||
    [...url.searchParams].some(([k,v])=>/^(?:redirect|next|return_url|continue|target|dest|destination|url)$/i.test(k)&&/^https?:\/\//i.test(v));
 }catch{unsafeSchemeOrHost=true;}
 if(unsafeSchemeOrHost)return {verdict:'QUARANTINED',reason:'안전하지 않거나 비표준 링크 형식 · 외부 접속 차단',reasonCode:'UNSAFE_LINK_FORMAT',externalNavigation:false};
 if(!educational&&((coercesAction&&(claimsAuthority||requestsSensitive))||(/인증\s?번호/.test(text)&&/제출/.test(text))||payToReceive||tollPayment))
  return {verdict:'QUARANTINED',reason:'민감정보·기관 권위·긴급 행동 요구가 링크와 결합됨 · 사기 확정 아님',reasonCode:'SUSPICIOUS_MESSAGE_CONTENT',externalNavigation:false};
 // Confirmed HIGH phone risk can justify temporary caution on unknown-sender links,
 // but not retroactively label a specific ordinary message as a proven fraud.
 if(caseRiskBand==='HIGH'&&senderClass==='UNKNOWN')
  return {verdict:'QUARANTINED',reason:'통화 위험이 높아 미확인 발신자의 링크를 임시 격리 · 사기 확정 아님',reasonCode:'CALL_RISK_CONTEXT',externalNavigation:false};
 return {verdict:'REVIEW_ONLY',reason:'앱 안에서 메시지 확인 가능 · 링크는 외부에서 열지 않음',reasonCode:educational?'EDUCATIONAL_CONTEXT':'SAFE_DEMO_PREVIEW',externalNavigation:false};
}
export function classifyMessage(fixtureId:MessageFixtureId,{caseRiskBand='LOW'}:{caseRiskBand?:string}={}){
 const fixture=MESSAGE_FIXTURES[fixtureId];
 if(!fixture)throw new Error('INVALID_MESSAGE_FIXTURE');
 return evaluateMessageContent(fixture.body,fixture.link,{caseRiskBand,senderClass:fixture.senderClass});
}
/** Manual false-positive recovery NEVER opens the link or authenticates the sender. */
export const REVIEW_TTL_MS=15*60*1000;
export function projectMessages(messages:ReadonlyArray<MessageEntry>,caseRiskBand:string,
 {reviews=[],caseVersion=-1,nowMs=Date.now(),evidenceIds=[]}:{reviews?:ReadonlyArray<MessageReview>;caseVersion?:number;nowMs?:number;evidenceIds?:ReadonlyArray<string>}={}){
 return messages.map(message=>{
  const fixture=MESSAGE_FIXTURES[message.fixtureId];const base=classifyMessage(message.fixtureId,{caseRiskBand});
  const latest=[...reviews].reverse().find(r=>r.messageId===message.id);
  const releaseActive=base.reasonCode==='CALL_RISK_CONTEXT'&&latest?.action==='RELEASE_PREVIEW'&&
   latest.caseVersion===caseVersion&&!!latest.expiresAt&&Date.parse(latest.expiresAt)>nowMs;
  const verdict=releaseActive?'REVIEW_ONLY':base.verdict;
  return {...message,...fixture,...base,verdict,
   reason:releaseActive?'사용자가 공식 경로로 별도 확인했다고 자기보고 · 링크는 여전히 외부로 열리지 않음':base.reason,
   reasonCode:releaseActive?'USER_REVIEWED_TEMPORARY_QUARANTINE':base.reasonCode,
   review:latest?{action:latest.action,active:!!releaseActive,expiresAt:latest.expiresAt,reviewId:latest.reviewId}:null,
   observation:observeBrowserMockFixture({messageId:message.id,body:fixture.body,link:fixture.link,
      receivedAt:message.receivedAt,caseVersion,evidenceIds:base.reasonCode==='CALL_RISK_CONTEXT'?evidenceIds:[]}),mockOnly:true};
 });
}

export type ExposureKey='linkOpened'|'codeShared'|'remoteInstalled'|'moneySent'|'identityShared';
export type ExposureAnswer='YES'|'NO'|'UNSURE';
export type FollowupTaskId='STOP_CONTACT'|'VERIFY_OFFICIAL'|'RECORD_DETAILS'|'CONTACT_FINANCIAL_PROVIDER'|'SECURE_ACCOUNTS'|'DEVICE_REVIEW'|'REPORT_FRAUD'|'EMERGENCY_SAFETY'|'OPTIONAL_REVIEW';
export const EXPOSURE_QUESTIONS:Readonly<Record<ExposureKey,string>>=Object.freeze({
 linkOpened:'의심 링크를 열거나 정보를 입력했나요?',codeShared:'인증번호·비밀번호를 알려줬나요?',remoteInstalled:'원격제어·화면공유 앱을 설치하거나 허용했나요?',moneySent:'송금하거나 가상 자금 이동을 시도했나요?',identityShared:'신분증·주민등록번호 등 개인정보를 제공했나요?'
});
const TASKS:Record<FollowupTaskId,{title:string;detail:string;priority:number}>= {
 OPTIONAL_REVIEW:{title:'일반 통화 기록 확인 (선택)',detail:'위험 근거가 없으므로 추가 조치를 강요하지 않습니다. 필요한 경우에만 문자나 거래 내역을 확인하세요.',priority:50},
 STOP_CONTACT:{title:'상대와 대화·송금을 중단',detail:'새로운 링크·번호 대신 직접 알고 있는 공식 연락처로 확인하세요. 상대방에게 인증번호를 보내지 마세요.',priority:10},
 EMERGENCY_SAFETY:{title:'긴급한 신체 안전 우선',detail:'납치·폭력 등 즉각적인 위해가 의심되면 안전한 장소에서 현지 긴급기관에 직접 연락하세요.',priority:5},
 VERIFY_OFFICIAL:{title:'공식 채널 독립 확인',detail:'문자 속 링크·번호는 사용하지 말고 공식 앱·카드 뒷면·직접 찾은 기관 번호로 확인하세요.',priority:20},
 CONTACT_FINANCIAL_PROVIDER:{title:'금융기관에 즉시 보호 상담',detail:'본인 명의의 공식 은행·카드사 채널로 거래 확인 및 지급정지·카드 보호 가능성을 문의하세요. SafeCall은 실제 처리를 하지 않습니다.',priority:15},
 SECURE_ACCOUNTS:{title:'계정·인증정보 보호',detail:'깨끗한 기기에서 공식 사이트로 비밀번호를 변경하고 세션·2단계 인증을 점검하세요. 비밀정보는 이 데모에 입력하지 마세요.',priority:25},
 DEVICE_REVIEW:{title:'기기 보안 점검',detail:'의심 앱·원격제어가 있었다면 연결을 멈추고 신뢰할 수 있는 공식 보안 도움을 받으세요. 임의의 새 원격 앱을 설치하지 마세요.',priority:22},
 REPORT_FRAUD:{title:'공식 피해 신고·상담',detail:'피해가 의심되면 경찰 등 현지 공식 신고 창구와 금융기관에 직접 상담하세요. 이 버튼은 신고를 전송하지 않습니다.',priority:30},
 RECORD_DETAILS:{title:'안전한 사건 기록 정리',detail:'시각·발신번호·거래 내역을 안전한 곳에 정리하세요. 공개 공유나 이 앱에 개인정보 업로드는 하지 않습니다.',priority:40},
};
export function derivePostCallPlan({callEndedAt,endedAt,riskBand,emergency,answers={},taskStates={},messageVerdicts=[],cardExposureReported=false}:{callEndedAt:string|null;endedAt:string|null;riskBand:string;emergency:boolean;answers?:Partial<Record<ExposureKey,ExposureAnswer>>;taskStates?:Partial<Record<FollowupTaskId,string>>;messageVerdicts?:ReadonlyArray<string>;cardExposureReported?:boolean}){
 const anyYes=Object.values(answers).some(a=>a==='YES');
 const anyUnsure=Object.values(answers).some(a=>a==='UNSURE');
 const risky=riskBand!=='LOW'||messageVerdicts.includes('QUARANTINED');
 const needsProtection=risky||anyYes||anyUnsure||cardExposureReported||emergency;
 const tasks:FollowupTaskId[]=needsProtection?['STOP_CONTACT','VERIFY_OFFICIAL','RECORD_DETAILS']:['OPTIONAL_REVIEW'];
 if(emergency)tasks.push('EMERGENCY_SAFETY');
 if(cardExposureReported||['YES','UNSURE'].includes(answers.moneySent??'')||['YES','UNSURE'].includes(answers.codeShared??''))tasks.push('CONTACT_FINANCIAL_PROVIDER');
 if(['YES','UNSURE'].includes(answers.codeShared??'')||['YES','UNSURE'].includes(answers.identityShared??''))tasks.push('SECURE_ACCOUNTS');
 if(['YES','UNSURE'].includes(answers.remoteInstalled??'')||['YES','UNSURE'].includes(answers.linkOpened??''))tasks.push('DEVICE_REVIEW');
 if(risky||anyYes||anyUnsure||cardExposureReported)tasks.push('REPORT_FRAUD');
 const steps=[...new Set(tasks)].map(id=>({id,...TASKS[id],status:taskStates[id]??'TODO',selfReported:true})).sort((a,b)=>a.priority-b.priority);
 return {mode:'MOCK_SELF_REPORTED_POSTCALL',status:endedAt?'ARCHIVED':callEndedAt?'ACTIVE':'WAITING_FOR_CALL_END',callEndedAt,questions:EXPOSURE_QUESTIONS,answers,
   steps,completed:steps.filter(x=>x.status==='DONE').length,total:steps.length,
   needsImmediateAttention:emergency||answers.moneySent==='YES'||answers.codeShared==='YES'||answers.remoteInstalled==='YES',
   disclaimer:'사용자 자기 보고에 따른 조언입니다. 실제 차단·신고·계정 보호 조치는 실행되지 않았습니다.'};
}
