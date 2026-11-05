import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveCases} from '../src/modules/evaluation/adaptive-cases.mjs';
import {scenarios} from '../src/modules/evaluation/index.ts';
import {createCase,applyCaseEvent,getCaseView} from '../src/modules/case/index.ts';
import {selectLiveGuidance} from '../src/modules/playbook/select.ts';
import {createCareInteraction,nextCareQuestion,applyCareInteractionEvent,deriveActiveCare} from '../demo/safety-challenge/adaptive-care.mjs';
import {selectActionCoaching} from '../demo/safety-challenge/coaching-policy.mjs';
import {deriveEarlyCareEvidence} from '../demo/safety-challenge/care-plan.mjs';

test('original 60 scenario dataset preserved with at least 270 finalized utterance prefixes',()=>{
 assert.equal(scenarios.length,60);assert.equal(scenarios.reduce((n,s)=>n+s.turns.length,0),270);
});
test('100 explicitly synthetic cases and jurisdiction counts, unique IDs and family-scoped split',()=>{
 assert.equal(adaptiveCases.length,100);assert.equal(new Set(adaptiveCases.map(x=>x.id)).size,100);
 for(const [country,expected] of [['KR',40],['US',40],['UNKNOWN',20]])assert.equal(adaptiveCases.filter(x=>x.country===country).length,expected);
 assert.equal(adaptiveCases.filter(x=>x.split==='HOLDOUT').length,50);
 const family=new Map();for(const c of adaptiveCases){const key=c.country+':'+c.family;
  if(family.has(key))assert.equal(family.get(key),c.split);else family.set(key,c.split);}
});
test('every scenario uses finalized observed turn only and never sends expected labels to runtime',()=>{
 for(const c of adaptiveCases){
  let s=createCase(c.id),i=createCareInteraction(c.id);
  if(c.text!==null)s=applyCaseEvent(s,{type:'UTTERANCE_FINAL',caseId:s.caseId,eventId:'turn_test',turnId:'a',revision:0,absoluteIndex:0,speaker:c.speaker,text:c.text});
  const before=getCaseView(s).assessment.riskIndex,g=selectLiveGuidance({caseState:s,jurisdiction:c.country});
  if(c.screenUnsafe)i=applyCareInteractionEvent(i,{caseId:s.caseId,type:'CARE_SCREEN_UNSAFE_REPORTED',eventId:'unsafe_report_1',caseVersion:s.version,expectedInteractionVersion:i.version},{caseState:s,decision:{decision:'SKIP_UNSAFE'}});
  const d=nextCareQuestion({caseState:s,interaction:i,guidance:g,emergency:getCaseView(s).assessment.emergencyFlag,earlyEvidence:deriveEarlyCareEvidence(s)});
  assert.equal(d.decision,c.expectedQuestion,c.id);
  if(c.answer){assert.equal(d.decision,'ASK');
   i=applyCareInteractionEvent(i,{type:'CARE_QUESTION_PRESENTED',caseId:s.caseId,eventId:'present_action_1',caseVersion:s.version,expectedInteractionVersion:i.version,questionId:d.question.id},{caseState:s,decision:d});
   i=applyCareInteractionEvent(i,{type:'CARE_QUESTION_ANSWERED',caseId:s.caseId,eventId:'answer_action_1',caseVersion:s.version,expectedInteractionVersion:i.version,questionId:d.question.id,choiceId:c.answer},{caseState:s,decision:d});
  }
  const coach=selectActionCoaching({caseState:s,guidance:g,jurisdiction:c.country,emergency:getCaseView(s).assessment.emergencyFlag,
   activeCare:deriveActiveCare(i),earlyEvidence:deriveEarlyCareEvidence(s)});
  assert.equal(coach.kind,c.expectedKind,c.id);
  assert.equal(coach.externalActionAuthorized,false);assert.equal(coach.realWorldOutcomeVerified,false);
  assert.equal(getCaseView(s).assessment.riskIndex,before);
  if(c.country==='UNKNOWN')assert.equal(coach.sourceLinks.length,0);
 }
});
test('question budget, case-id check and event version cap prevent unbounded interaction',()=>{
 const c=createCase('limit_case');let i=createCareInteraction('limit_case');const g=selectLiveGuidance({caseState:c});
 const d=nextCareQuestion({caseState:c,interaction:i,guidance:g});
 assert.equal(d.decision,'ASK');
 assert.throws(()=>applyCareInteractionEvent(i,{type:'CARE_QUESTION_PRESENTED',caseId:'evil_case',eventId:'wrong_case_1',caseVersion:c.version,expectedInteractionVersion:0,questionId:'REQUEST_TYPE'},{caseState:c,decision:d}));
 assert.throws(()=>applyCareInteractionEvent(i,{type:'CARE_QUESTION_PRESENTED',caseId:c.caseId,eventId:'bad_version_1',caseVersion:c.version,expectedInteractionVersion:10,questionId:'REQUEST_TYPE'},{caseState:c,decision:d}));
});
