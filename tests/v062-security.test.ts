import {test} from 'node:test';import assert from 'node:assert/strict';
import {issueLiveTicket,verifyLiveTicket,checkLocalAccess,originMatchesHost,LiveAuthError} from '../src/modules/security/live-auth.ts';
const a='access_secret_that_is_long_enough_24',k='hmac_secret_that_is_long_enough_24';
test('fail closed on missing or weak local access configuration',()=>{
 assert.equal(checkLocalAccess(a,''),false);assert.equal(checkLocalAccess('bad',a),false);
 assert.throws(()=>issueLiveTicket('VOICE',a,'',k),LiveAuthError);
 assert.throws(()=>issueLiveTicket('VOICE',a,a,'short'),LiveAuthError);
});
test('signed voice ticket is scoped and expires after 60s',()=>{
 const token=issueLiveTicket('VOICE',a,a,k,1000);
 const ticket=verifyLiveTicket(token,'VOICE',k,2000);assert.equal(ticket.scope,'VOICE');
 assert.throws(()=>verifyLiveTicket(token,'SPARK',k,2000),LiveAuthError);
 assert.throws(()=>verifyLiveTicket(token,'VOICE',k,61001),LiveAuthError);
 assert.throws(()=>verifyLiveTicket(token+'A','VOICE',k,2000),LiveAuthError);
});
test('origin must be exact loopback host match',()=>{
 assert.equal(originMatchesHost('http://localhost:3000','localhost:3000'),true);
 assert.equal(originMatchesHost('https://evil.test','localhost:3000'),false);
 assert.equal(originMatchesHost(null,'localhost:3000'),false);
 assert.equal(originMatchesHost('http://localhost:3333','localhost:3000'),false);
});
