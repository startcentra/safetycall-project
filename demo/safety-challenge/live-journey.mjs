/** Product-shaped synthetic location feed. Same event contract can be backed by an explicitly-consented GPS adapter later.
 * Distance is computed on server from an allowlisted route; the browser cannot send arbitrary coordinates.
 * A protection gate prevents only simulated transfers in SafeCall, never transactions at other banks.
 */
export const FIXTURE_BANK = Object.freeze({id:'safe-bank-fictional',name:'SafeBank 가상 지점',lat:37.29224,lng:127.01224});
export const FIXTURE_ROUTE = Object.freeze([
  [37.28644,127.00874],[37.28712,127.00915],[37.28795,127.00958],
  [37.28878,127.01008],[37.28966,127.01065],[37.29044,127.01116],
  [37.29125,127.01172],[37.29191,127.01204],[37.29220,127.01221],
].map((p,i)=>Object.freeze({step:i,lat:p[0],lng:p[1]})));
export function distanceMeters(a,b){
  const toRad=x=>x*Math.PI/180;
  const dLat=toRad(a.lat-b.lat),dLon=toRad(a.lng-b.lng),radius=6371000;
  const p=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return Math.round(2*radius*Math.asin(Math.min(1,Math.sqrt(p))));
}
export function initialLocation(){return Object.freeze({source:'SIMULATED_GPS',routeId:'BANK_APPROACH_V1',step:-1,
  lat:null,lng:null,distanceMeters:null,zone:'NOT_STARTED',at:null});}
export function routePointForStep(step){
  if(!Number.isSafeInteger(step)||step<0||step>=FIXTURE_ROUTE.length)throw new RangeError('INVALID_FIXTURE_STEP');
  const point=FIXTURE_ROUTE[step],distance=distanceMeters(point,FIXTURE_BANK);
  return Object.freeze({source:'SIMULATED_GPS',routeId:'BANK_APPROACH_V1',step:point.step,lat:point.lat,lng:point.lng,
    distanceMeters:distance,zone:distance<=50?'AT_BANK':distance<=150?'NEAR_BANK':'AWAY',at:new Date().toISOString()});
}
export function protectionDecision({riskBand,location,ended=false}){
  const near=location?.source==='SIMULATED_GPS'&&['AT_BANK','NEAR_BANK'].includes(location?.zone);
  const blocked=!ended&&riskBand==='HIGH'&&near;
  return Object.freeze({blocked,scope:'SAFEBANK_SIMULATED_TRANSFER_ONLY',source:'SERVER_POLICY',
    reason:blocked?'HIGH_RISK_AND_BANK_PROXIMITY':'INSUFFICIENT_COMBINED_EVIDENCE',
    note:blocked?'가상 은행 근처에서 위험 대화가 감지되어 SafeBank 가상 송금만 일시 보류합니다.':'현재 가상 송금 자동 보류 조건이 아닙니다.',
    actualBankBlocked:false});
}
export function contextLocationObservation(location){
  if(location?.source!=='SIMULATED_GPS'||location.step<0)return undefined;
  return {source:'SIMULATED_GPS',zone:location.zone,distanceBand:location.zone==='AWAY'?'FAR':location.zone==='NEAR_BANK'?'NEAR':'ARRIVED'};
}
