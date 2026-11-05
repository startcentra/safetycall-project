import test from 'node:test';
import assert from 'node:assert/strict';
import {decideBankArrival,type BankArrivalContext} from '../src/modules/bank-arrival/index.ts';
const base:BankArrivalContext={caseId:'c',stateVersion:1,caseOpen:true,riskIndex:85,detected:true,activeEvidenceIds:['e1'],evidenceVersion:1,country:'KR',arrivalEvidence:'USER_CONFIRMED',arrivalCaseId:'c',arrivalVersion:1,locationConsent:false,locationTimestampMs:null,nowMs:0,bankPlaceVerified:false,physicalEmergency:false,userWantsHelp:true};
test('bank actions require all separate conditions',()=>{
 assert.equal(decideBankArrival(base).allowBankSimulation,true);
 for(const p of [{userWantsHelp:false},{detected:false},{evidenceVersion:0},{caseOpen:false},{arrivalCaseId:'other'}])assert.equal(decideBankArrival({...base,...p}).allowBankSimulation,false);
});
test('nearby location never gives bank control',()=>assert.equal(decideBankArrival({...base,arrivalEvidence:'NEARBY_GPS'}).allowBankSimulation,false));
test('physical emergency always takes priority',()=>{
 const state=decideBankArrival({...base,physicalEmergency:true});
 assert.equal(state.state,'URGENT_HELP');assert.equal(state.autoLockCard,false);assert.equal(state.autoTransfer,false);
});
