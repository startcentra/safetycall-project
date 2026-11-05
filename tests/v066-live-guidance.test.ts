import test from 'node:test';
import assert from 'node:assert/strict';
import {createCase,applyCaseEvent,type CaseState} from '../src/modules/case/index.ts';
import {selectLiveGuidance,isCurrentGuidance} from '../src/modules/playbook/select.ts';
import {ACTION_CARDS} from '../src/modules/playbook/cards.ts';
import {PLAYBOOK_SOURCES} from '../src/modules/playbook/sources.ts';
import {scenarios} from '../src/modules/evaluation/index.ts';
import type {ModelAssessment} from '../src/modules/analysis/meta-contract.ts';
let seq=0;
function utter(s:CaseState,text:string,speaker:'caller'|'user'|'unknown'='caller',revision?:number,turnId?:string):CaseState {
 const id=turnId??`T${s.checkpoint.turns.length}`;
 const old=s.checkpoint.turns.find(t=>t.turnId===id);
 const r=revision??0;
 return applyCaseEvent(s,{type:'UTTERANCE_FINAL',caseId:s.caseId,eventId:`u${++seq}`,turnId:id,revision:r,absoluteIndex:old?.absoluteIndex??s.checkpoint.turns.length,speaker,text});
}
const base=()=>createCase(`c_${++seq}`);
const select=(s:CaseState,extra:Parameters<typeof selectLiveGuidance>[0] extends infer I ? Omit<I,'caseState'> : never={})=>selectLiveGuidance({caseState:s,...extra});
function dummyModel(ids:string[],codes:ModelAssessment['recommendedActionCodes']):ModelAssessment {return {riskLevel:'HIGH',riskIndex:99,manipulationIndex:99,detectedSignals:[],manipulationTechniques:[],requestedActions:[],evidenceUtteranceIds:ids,normalConversationEvidence:[],uncertainty:'',recommendedActionCodes:codes,emergencyFlag:true};}

test('official sources have verified metadata, URLs and scoped agency attribution',()=>{
 assert.ok(PLAYBOOK_SOURCES.length>=3);
 for(const source of PLAYBOOK_SOURCES){assert.equal(source.status,'PUBLIC_SOURCE_CHECKED');assert.ok(source.url.startsWith('https://'));assert.ok(source.lastVerifiedAt);}
});
test('eight cards and all action card source IDs refer to checked public material',()=>{
 assert.equal(ACTION_CARDS.length,8);
 for(const card of ACTION_CARDS){assert.equal(card.status,'DEMO_REVIEWED');assert.ok(card.sourceIds.every(id=>PLAYBOOK_SOURCES.some(src=>src.id===id)));assert.equal(card.allowedTools.length,0);}
});
test('normal conversation does not trigger hard warning or unsolicited speech',()=>{
 const s=utter(base(),'오늘 집에 가면서 사과 사올래?');const g=select(s);
 assert.equal(g.primary.id,'UNCERTAIN_NO_HARD_WARNING');assert.equal(g.replyText,null);assert.equal(g.executionAuthorized,false);
});
test('relative harm and ransom: urgent first, payment stop second, NEVER conversation script',()=>{
 const s=utter(base(),'당신 아들을 해칠거야. 지금 당장 송금하세요.');const g=select(s,{jurisdiction:'KR',safeToSpeak:true,requestDelayPhrase:true});
 assert.equal(g.primary.id,'EMERGENCY_CONTACT_GUIDANCE');assert.equal(g.secondary?.id,'DO_NOT_TRANSFER');assert.equal(g.replyTemplateId,'NO_SCRIPT');assert.equal(g.replyText,null);assert.deepEqual(g.primary.evidenceUtteranceIds,['T0']);
});
test('old threat survives many ordinary utterances, speech still blocked',()=>{
 let s=utter(base(),'당신 아들을 해칠 거야.');for(let i=0;i<15;i++)s=utter(s,`안녕하세요 ${i}`);
 assert.equal(select(s,{safeToSpeak:true}).primary.id,'EMERGENCY_CONTACT_GUIDANCE');
 assert.equal(select(s,{safeToSpeak:true}).replyText,null);
});
test('family emergency claim alone is unverified, not a verdict of crime',()=>{
 const s=utter(base(),'아들이 지금 사고가 났습니다.');const g=select(s);
 assert.equal(g.primary.id,'FAMILY_INDEPENDENT_VERIFY');assert.match(g.primary.userAction,/아직 확인되지/);
 assert.equal(g.replyText,null);
});
test('family emergency with transfer: transfer stop before family checking',()=>{
 let s=utter(base(),'당신 아들이 사고났습니다.');s=utter(s,'이 계좌로 송금하세요.');const g=select(s,{safeToSpeak:true});
 assert.equal(g.primary.id,'DO_NOT_TRANSFER');assert.equal(g.secondary?.id,'FAMILY_INDEPENDENT_VERIFY');
 assert.equal(g.replyTemplateId,'DECLINE_PAYMENT');
});

test('kidnapping claim without literal violent threat still prompts conditional emergency care',()=>{
 const s=utter(base(),'우리가 네 아들을 데리고 있습니다.');const g=select(s,{safeToSpeak:true});
 assert.equal(g.primary.id,'EMERGENCY_CONTACT_GUIDANCE');assert.equal(g.replyText,null);
 assert.ok(g.primary.evidenceUtteranceIds.includes('T0'));
});
test('not reached family: suggest independent secondary channel without assuming kidnapping',()=>{
 const s=utter(base(),'아들이 사고가 났습니다.');const g=select(s,{familyContactStatus:'NO_RESPONSE'});
 assert.equal(g.secondary?.id,'SEEK_SECOND_CONTACT');
 assert.equal(g.executionAuthorized,false);
});
test('same event from user does not become caller demand or fraud claim',()=>{
 const s=utter(base(),'나는 엄마랑 사고에 대해 이야기했어요','user');const g=select(s);
 assert.equal(g.primary.id,'UNCERTAIN_NO_HARD_WARNING');
});
test('unknown speaker does not become verified threat or demand',()=>{
 const s=utter(base(),'아들을 죽일 거야. 송금하세요.','unknown');const g=select(s);
 assert.equal(g.primary.id,'UNCERTAIN_NO_HARD_WARNING');assert.equal(g.executionAuthorized,false);
});
test('model cannot invent threat, sources, or convert unknown into proof',()=>{
 const s=utter(base(),'안녕하세요.');const model=dummyModel(['T0'],['CONTACT_112','DO_NOT_TRANSFER']);
 const g=select(s,{model,modelStateVersion:s.version,safeToSpeak:true});
 assert.equal(g.primary.id,'UNCERTAIN_NO_HARD_WARNING');assert.equal(g.replyText,null);
});
test('model with forged or stale evidence cannot escalate cards',()=>{
 const s=utter(base(),'해당 계좌로 송금하세요.');const model=dummyModel(['FUTURE_TURN'],['CONTACT_112']);
 assert.equal(select(s,{model,modelStateVersion:s.version}).primary.id,'DO_NOT_TRANSFER');
 assert.ok(select(s,{model,modelStateVersion:s.version}).limitations.some(x=>x.includes('Meta')));
 assert.equal(select(s,{model,modelStateVersion:s.version-1}).primary.id,'DO_NOT_TRANSFER');
});
test('first model action is not the policy priority',()=>{
 const s=utter(base(),'당신 아들을 해칠거야. 지금 송금하세요.');const model=dummyModel(['T0'],['SEEK_INDEPENDENT_HELP','DO_NOT_TRANSFER','CONTACT_112']);
 assert.equal(select(s,{model,modelStateVersion:s.version}).primary.id,'EMERGENCY_CONTACT_GUIDANCE');
});
test('speech script requires opt-in; delay request is additionally gated',()=>{
 const s=utter(base(),'이 계좌로 송금하세요.');
 assert.equal(select(s).replyText,null);
 assert.equal(select(s,{safeToSpeak:true}).replyTemplateId,'DECLINE_PAYMENT');
 assert.equal(select(s,{safeToSpeak:true,requestDelayPhrase:true}).replyTemplateId,'REQUEST_TIME');
 assert.equal(select(s,{safeToSpeak:false,requestDelayPhrase:true}).replyText,null);
});
test('credential request prevents disclosure, no OTP repeated in reply',()=>{
 const s=utter(base(),'인증번호를 알려주세요.');const g=select(s,{safeToSpeak:true});
 assert.equal(g.primary.id,'DO_NOT_DISCLOSE_PERSONAL_DATA');assert.equal(g.replyText,null);
});
test('user says transfer already sent: recovery, not claim funds are recovered',()=>{
 const s=utter(base(),'이미 송금했어요.','user');const g=select(s);
 assert.equal(g.primary.id,'POST_PAYMENT_RECOVERY');assert.match(g.primary.userAction,/가능 여부/);
});
test('no family response never verifies kidnapping nor automatically contacts people',()=>{
 const s=utter(base(),'아들이 사고가 났습니다.');const g=select(s,{familyContactStatus:'NO_RESPONSE'});
 assert.equal(g.primary.id,'FAMILY_INDEPENDENT_VERIFY');assert.ok(g.executionAuthorized===false);
 assert.equal(g.replyText,null);
});
test('source and card review state are enforced (including missing sources)',()=>{
 const s=utter(base(),'아들을 해칠거야.');
 const draft=ACTION_CARDS.map(c=>c.id==='EMERGENCY_CONTACT_GUIDANCE'?{...c,status:'DRAFT' as const}:c);
 assert.notEqual(select(s,{registry:draft}).primary.id,'EMERGENCY_CONTACT_GUIDANCE');
 const fake=ACTION_CARDS.map(c=>c.id==='EMERGENCY_CONTACT_GUIDANCE'?{...c,sourceIds:['fake_id']}:c);
 assert.notEqual(select(s,{registry:fake}).primary.id,'EMERGENCY_CONTACT_GUIDANCE');
});
test('explicit ASR correction retracts active threat and reconsider cards',()=>{
 let s=utter(base(),'아들을 죽일거야.');const first=select(s);
 s=utter(s,'안녕하세요.', 'caller',1,'T0');const now=select(s);
 assert.equal(first.primary.id,'EMERGENCY_CONTACT_GUIDANCE');assert.equal(now.primary.id,'UNCERTAIN_NO_HARD_WARNING');
 assert.equal(isCurrentGuidance(first,s),false);assert.equal(isCurrentGuidance(now,s),true);
});
test('disputed risk evidence not used as confirmed guidance',()=>{
 let s=utter(base(),'아들을 해칠 거야.');s=applyCaseEvent(s,{type:'EVIDENCE_STATUS',caseId:s.caseId,eventId:'dispute',turnId:'T0',revision:1,status:'DISPUTED',reason:'음성 전사 오류 가능성'});
 assert.equal(select(s).primary.id,'UNCERTAIN_NO_HARD_WARNING');
});
test('closed case refuses new guidance; rejects stale event and cross-case result',()=>{
 let s=utter(base(),'아들을 죽일 거야.');const previous=select(s);
 s=applyCaseEvent(s,{type:'CASE_CLOSED',caseId:s.caseId,eventId:'close'});
 assert.equal(select(s).status,'CLOSED');assert.equal(select(s).replyText,null);assert.equal(isCurrentGuidance(previous,s),false);
 assert.equal(isCurrentGuidance(previous,createCase('another')),false);
});
test('quoted prevention and teaching examples do not trigger family-claim action card',()=>{
 const s=utter(base(),'보이스피싱 예방 교육에서 예를 들어 아들을 납치했다고 말합니다.');
 assert.equal(s.checkpoint.turns[0].contextTags.length,0);
 assert.equal(select(s).primary.id,'UNCERTAIN_NO_HARD_WARNING'); // action guidance filters explicit instructional context; original risk score remains unchanged
});
test('every guidance is bounded, has a source and never authorizes a side effect',()=>{
 for(const scenario of scenarios){
   let state=createCase(`all_${scenario.scenarioId}`);
   for(const [i,t] of scenario.turns.entries()) {
     state=applyCaseEvent(state,{type:'UTTERANCE_FINAL',caseId:state.caseId,eventId:`g${i}`,turnId:t.turnId,revision:0,absoluteIndex:i,speaker:t.speaker,text:t.text});
     const g=select(state);
     assert.equal(g.executionAuthorized,false);
     assert.ok(g.primary.sourceIds.length>0);
     assert.ok(g.primary.userAction.length<230);
     assert.ok(g.replyText===null);
     assert.ok(g.primary.sourceIds.every(id=>PLAYBOOK_SOURCES.some(src=>src.id===id)));
   }
 }
});
