import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCase,applyCaseEvent,getCaseView} from '../src/modules/case/index.ts';
import {selectLiveGuidance,isCurrentGuidance} from '../src/modules/playbook/select.ts';
import {deriveEarlyCareEvidence} from '../demo/safety-challenge/care-plan.mjs';
import {selectActionCoaching} from '../demo/safety-challenge/coaching-policy.mjs';
function trial(text,speaker='caller',country='KR'){
 let state=createCase('exception_case');state=applyCaseEvent(state,{type:'UTTERANCE_FINAL',caseId:state.caseId,eventId:'final_0',turnId:'x',revision:0,absoluteIndex:0,speaker,text});
 const guide=selectLiveGuidance({caseState:state,jurisdiction:country});const view=getCaseView(state);
 return {state,view,guide,early:deriveEarlyCareEvidence(state),coaching:selectActionCoaching({caseState:state,guidance:guide,jurisdiction:country,emergency:view.assessment.emergencyFlag,earlyEvidence:deriveEarlyCareEvidence(state)})};
}
test('education or quoted fraud examples do not become active threat or monetary demand',()=>{
 for(const text of ['훈련 대본: 당신 아들을 납치했습니다. 지금 당장 송금하세요.',
  '뉴스에서 보았는데 사기범이 인증번호를 알려달라고 했대요.',
  'Fraud awareness training: send money now or we will hurt your child.',
  'News report: we kidnapped your son.']){
  const r=trial(text);assert.equal(r.view.assessment.emergencyFlag,false,text);assert.equal(r.guide.primary.id,'UNCERTAIN_NO_HARD_WARNING',text);
 }
});
test('ordinary appointment, isolated bank title and English instruction do not force a threat',()=>{
 for(const [text,country] of [['아들이 내일 병원 검진을 받기로 했어요.','KR'],['은행 보안팀에서 연락드립니다.','KR'],["I'm calling from the bank.",'US'],['Your son has an appointment tomorrow.','US']]){
  const r=trial(text,'caller',country);assert.equal(r.coaching.kind,'OBSERVE',text);assert.equal(r.view.assessment.emergencyFlag,false);
 }
});
test('unknown speakers cannot authorize caller-specific threats',()=>{
 for(const who of ['unknown','multiple','user']){
  const r=trial('당신 아들을 납치했습니다. 지금 당장 송금하세요.',who);
  assert.equal(r.guide.primary.id,'UNCERTAIN_NO_HARD_WARNING');assert.equal(r.coaching.kind,'OBSERVE');
 }
});
test('stale correction removes old threat and the guidance revision cannot be reused',()=>{
 let s=createCase('repair_case');s=applyCaseEvent(s,{type:'UTTERANCE_FINAL',caseId:s.caseId,eventId:'a',turnId:'x',revision:0,absoluteIndex:0,speaker:'caller',text:'우리가 당신 아들을 납치했습니다.'});
 const unsafe=selectLiveGuidance({caseState:s});assert.equal(unsafe.primary.id,'EMERGENCY_CONTACT_GUIDANCE');
 s=applyCaseEvent(s,{type:'UTTERANCE_FINAL',caseId:s.caseId,eventId:'b',turnId:'x',revision:1,absoluteIndex:0,speaker:'caller',text:'내일 교육용 안내문을 보냅니다.'});
 assert.equal(getCaseView(s).assessment.emergencyFlag,false);assert.equal(isCurrentGuidance(unsafe,s),false);
 assert.equal(selectLiveGuidance({caseState:s}).primary.id,'UNCERTAIN_NO_HARD_WARNING');
});
test('no model text, external URL or invented location can change coaching source authorities',()=>{
 const r=trial('인증번호를 저에게 알려주세요.');
 const c=selectActionCoaching({caseState:r.state,guidance:r.guide,jurisdiction:'INVALID',emergency:false,
  model:{recommendedActionCodes:['AUTO_SEND_FUNDS']},location:'CA',sourceUrl:'https://evil.example'});
 assert.equal(c.jurisdiction,'UNKNOWN');assert.equal(c.sourceLinks.length,0);assert.equal(c.externalActionAuthorized,false);
});
test('a prepared mock transfer does not count as a proven past financial payment',()=>{
 let s=createCase('payment_case');s=applyCaseEvent(s,{type:'USER_ACTION',caseId:s.caseId,eventId:'mock',action:'TRANSFER_PREPARED'});
 const g=selectLiveGuidance({caseState:s});const c=selectActionCoaching({caseState:s,guidance:g,jurisdiction:'KR'});
 assert.equal(c.kind,'PAYMENT_HOLD');assert.notEqual(c.kind,'PAID');
});
