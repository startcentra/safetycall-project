/** Self-authored, deterministic policy contract checks (NOT independent user research). */
import {writeFileSync,mkdirSync} from 'node:fs';
import {guidedSteps,createGuidedJourney,applyGuidedEvent,guidedJourneyView} from '../demo/safety-challenge/guided-actions.mjs';
const cases=[];
const add=(group,id,country,path,context,check,reason)=>cases.push({group,id,country,path,context,check,reason});
// 20 payment variants: each selects a different provider/procedure or stage.
for(const [country,method,word] of [
 ['KR','BANK_TRANSFER','지급정지'],['KR','INTERNATIONAL_WIRE','해외송금'],['KR','CARD','카드 발급사'],
 ['KR','PAYMENT_APP','송금·결제 서비스'],['KR','CRYPTO','거래소'],['KR','CASH','현금 전달'],['KR','GIFT_CARD','상품권'],['KR','UNKNOWN','공식 경로'],
 ['US','ACH','은행'],['US','BANK_WIRE','은행'],['US','CARD','카드 발급사'],['US','PAYMENT_APP','결제 앱'],['US','CRYPTO','거래소'],['US','CASH','현금 전달사'],['US','CHECK','수표'],['US','GIFT_CARD','상품권'],['US','UNKNOWN','공식 경로'],
 ['UNKNOWN','UNKNOWN','공식 경로']])add('PAYMENT_METHOD',`payment_${country}_${method}`,country,'PAYMENT',{paymentMethod:method,actionStatus:'DONE'},['PROVIDER',word],`결제 수단별 신고/확인 경로 ${method}`);
for(const country of ['KR','US'])add('PRE_PAYMENT',`payment_before_${country}`,country,'PAYMENT',{actionStatus:'NOT_DONE'},['PROVIDER','공식 앱'], '송금 전 공식 경로 독립 확인');
// 10 family, with scenario labels to avoid treating unverified responses as proof.
for(const [id,status] of [
 ['family_new_number','NO_RESPONSE'],['family_voice_clone','UNVERIFIED_RESPONSE'],['family_video_clone','CONFLICTING_INFORMATION'],
 ['family_kidnap_claim','UNABLE_TO_CONTACT'],['family_phone_spoof','NO_RESPONSE'],['family_no_answer','NO_RESPONSE'],
 ['family_conflicting','CONFLICTING_INFORMATION'],['family_help','HELP_REQUESTED'],['family_safe_report','SELF_REPORTED_SAFE'],
 ['family_emergency_unknown','UNABLE_TO_CONTACT']])add('FAMILY',id,'KR','FAMILY',{familyStatus:status},['INDEPENDENT','연락처'],`가족 확인 · ${status} · 위험 또는 안전 확정 금지`);
// 10 account and credential concerns.
for(const id of ['otp_requested','otp_shared','password_shared','account_locked','sim_takeover_suspected','same_password_multiple_accounts','unauthorized_login','recovery_code_exposed','identity_provider_mimic','account_recovery_unknown'])
 add('CREDENTIALS',id,'US','CREDENTIALS',{},['SECURE','공식 계정'],`계정 노출/복구: ${id}`);
// 10 compromised device / screen monitoring variations.
for(const id of ['install_request','install_started','remote_granted','screen_mirrored','banking_on_compromised_device','removed_app_unverified','no_trusted_device','remote_tech_support','screen_unsafe_report','device_status_unknown'])
 add('REMOTE',id,'KR','REMOTE_ACCESS',{screenUnsafe:id==='screen_unsafe_report'},['TRUSTED_DEVICE',id==='screen_unsafe_report'?'화면이 안전하지':'신뢰할 수 있는'],`원격접근 위험: ${id}`);
// 10 identity variations across regions.
for(const [id,country] of [['passport_photo','KR'],['id_number','KR'],['data_breach','KR'],['account_opened_unknown','KR'],['unauthorized_account','KR'],['ssn_shared','US'],['us_credit_freeze','US'],['us_fraud_alert','US'],['cross_border_id','UNKNOWN'],['identity_unsure','UNKNOWN']])
 add('IDENTITY',id,country,'IDENTITY',{},['OFFICIAL',country==='US'?'IdentityTheft.gov':country==='KR'?'공식':'관할'],`신분정보 대응 ${id}`);
// 10 unknown/no contact scenarios.
for(const [id,country] of [['no_demand','KR'],['news_quote','KR'],['normal_bank_contact','KR'],['just_suspicious','US'],['normal_family_request','US'],['training_scam_example','US'],['unknown_country','UNKNOWN'],['traveling_abroad','UNKNOWN'],['speech_cut_off','UNKNOWN'],['payment_method_unavailable','UNKNOWN']])
 add('UNKNOWN',id,country,'UNKNOWN',{},['CHECK','확인'],`정상 또는 불확실한 상황: ${id}`);
// 10 multi-path context+termination safety variants, exercising real state and not strings only.
for(const [id,paths] of [
 ['payment_credentials',['PAYMENT','CREDENTIALS']],['payment_remote',['PAYMENT','REMOTE_ACCESS']],['family_payment',['FAMILY','PAYMENT']],
 ['id_password',['IDENTITY','CREDENTIALS']],['remote_id',['REMOTE_ACCESS','IDENTITY']],['family_remote',['FAMILY','REMOTE_ACCESS']],
 ['unknown_payment',['UNKNOWN','PAYMENT']],['credentials_remote',['CREDENTIALS','REMOTE_ACCESS']],
 ['payment_family_credentials',['PAYMENT','FAMILY','CREDENTIALS']],['all_paths',['PAYMENT','FAMILY','CREDENTIALS','REMOTE_ACCESS','IDENTITY','UNKNOWN']]])
 add('MULTI',id,'KR',paths[0],{multiPaths:paths},['MULTI','independent'],`여러 피해 유형은 진행 기록을 분리`);
if(cases.length!==80)throw new Error(`expected 80 cases, got ${cases.length}`);
let passed=0;const findings=[];
for(const item of cases){
 try{
  const s=guidedSteps(item.path,item.country,item.context);
  if(item.group==='MULTI'){
   let store=createGuidedJourney('eval_case');
   for(const path of item.context.multiPaths)store=applyGuidedEvent(store,{caseId:store.caseId,eventId:`a_${store.version}`,type:'GUIDED_PATH_ADDED',pathId:path,expectedGuidedVersion:store.version});
   const v=guidedJourneyView(store,{jurisdiction:'KR'});
   if(v.paths.length!==item.context.multiPaths.length||Object.keys(store.progress).length!==0)throw new Error('mixed or missing path selections');
  }else{
   const target=s.find(x=>x.id===item.check[0]);if(!target||!target.instruction.includes(item.check[1]))throw new Error('expected phrase/step absent');
   if(s.some(x=>!x.fallback||!x.instruction))throw new Error('missing fallback');
  }
  passed++;findings.push({...item,passed:true});
 }catch(e){findings.push({...item,passed:false,error:String(e.message)});}
}
const output={version:'1.0.2',generatedAt:new Date().toISOString(),type:'SELF_AUTHORED_CONTRACT_CASES',source:'local deterministic playbooks; no external calls',
 caveat:'80 checks are curated policy and branching smoke checks; not 80 independent blinded evaluations; not evidence of actual user benefit, legal accuracy, provider results or harm reduction.',
 total:cases.length,passed,failed:cases.length-passed,findings};
mkdirSync('artifacts/evaluations',{recursive:true});writeFileSync('artifacts/evaluations/v102_guided_care.json',JSON.stringify(output,null,2)+'\n');
console.log(`Self-authored Guided Care policy checks ${passed}/${cases.length} passing; not field accuracy.`);
if(passed!==cases.length){for(const f of findings.filter(x=>!x.passed))console.error(f.id,f.error);process.exitCode=1;}
