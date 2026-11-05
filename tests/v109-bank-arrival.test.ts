import test from 'node:test';
import assert from 'node:assert/strict';
import {decideBankArrival,maskedStaffScript,type BankArrivalContext} from '../src/modules/bank-arrival/index.ts';
const base:BankArrivalContext={caseId:'case_01',stateVersion:7,caseOpen:true,riskIndex:92,detected:true,
 activeEvidenceIds:['utt_1'],evidenceVersion:7,country:'KR',
 arrivalEvidence:'USER_CONFIRMED',arrivalCaseId:'case_01',arrivalVersion:7,
 locationConsent:false,locationTimestampMs:null,nowMs:1000000,bankPlaceVerified:false,physicalEmergency:false,userWantsHelp:true};
const decide=(patch:Partial<BankArrivalContext>={})=>decideBankArrival({...base,...patch});
test('bank arrival plus active risk plus user consent opens simulated staff help',()=>{const x=decide();assert.equal(x.state,'BANK_ASSIST');assert.equal(x.tool,'SHOW_BANK_STAFF_SCRIPT');assert.equal(x.autoLockCard,false);assert.equal(x.autoTransfer,false);assert.equal(x.locationMayBeStored,false);});
test('risk score 100 alone never triggers protection',()=>{assert.equal(decide({detected:false,riskIndex:100}).state,'INACTIVE');});
test('stale model evidence and outdated arrival version fail closed',()=>{assert.equal(decide({evidenceVersion:6}).state,'INACTIVE');assert.equal(decide({arrivalVersion:6}).state,'VERIFY_ARRIVAL');});
test('case mixup, closed case, and missing permission are safe',()=>{assert.equal(decide({arrivalCaseId:'other'}).state,'VERIFY_ARRIVAL');assert.equal(decide({caseOpen:false}).state,'INACTIVE');assert.equal(decide({userWantsHelp:false}).state,'VERIFY_ARRIVAL');});
test('GPS proximity alone never qualifies as arrived',()=>{const x=decide({arrivalEvidence:'NEARBY_GPS',locationConsent:true,bankPlaceVerified:true,locationTimestampMs:999900});assert.equal(x.state,'VERIFY_ARRIVAL');assert.equal(x.allowBankSimulation,false);});
test('GPS denied, expired, spoofed future or unknown bank fails closed',()=>{for(const patch of [{locationConsent:false},{locationTimestampMs:850000},{locationTimestampMs:1010000},{bankPlaceVerified:false}]){const x=decide({arrivalEvidence:'NEARBY_GPS',locationConsent:true,bankPlaceVerified:true,locationTimestampMs:999900,...patch});assert.equal(x.state,'EXPIRED');}});
test('physical emergency overrides bank interaction regardless of location',()=>{const x=decide({physicalEmergency:true});assert.equal(x.state,'URGENT_HELP');assert.equal(x.tool,'SHOW_EMERGENCY_GUIDANCE');});
test('unknown arrival and low-confidence evidence are blocked',()=>{assert.equal(decide({arrivalEvidence:'NONE'}).state,'VERIFY_ARRIVAL');assert.equal(decide({activeEvidenceIds:[]}).state,'INACTIVE');});
test('US and KR staff scripts are different and never include passwords',()=>{const us=maskedStaffScript('US'),kr=maskedStaffScript('KR');assert.notEqual(us,kr);assert.match(us,/scam call/);assert.match(kr,/은행/);});
