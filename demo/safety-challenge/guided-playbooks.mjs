/**
 * Pure, deterministic KR/US action playbook definitions.
 * Never performs external actions or records verified outcomes.
 * Separated from journey state transitions to keep policy review independent.
 */
export const GUIDE_PATHS=Object.freeze({
  PAYMENT:'금전·결제 피해 또는 송금 요구', FAMILY:'가족·지인 독립 확인',
  CREDENTIALS:'인증번호·계정 정보 노출', REMOTE_ACCESS:'원격제어·화면 감시',
  IDENTITY:'신분정보 노출', UNKNOWN:'피해 유형이 불확실함'
});
export const PAYMENT_METHODS=Object.freeze({
  KR:['BANK_TRANSFER','INTERNATIONAL_WIRE','CARD','PAYMENT_APP','CRYPTO','CASH','GIFT_CARD','UNKNOWN'],
  US:['ACH','BANK_WIRE','CARD','PAYMENT_APP','CRYPTO','CASH','CHECK','GIFT_CARD','UNKNOWN'],
  UNKNOWN:['UNKNOWN']
});
export const OFFICIAL_GUIDE_SOURCES=Object.freeze({
  KR_FSC:{jurisdiction:'KR',label:'금융위원회 · 보이스피싱 피해 시 공식 대응',url:'https://www.fsc.go.kr/po010101/87882',reviewedAt:'2026-10-31'},
  KR_ECRM:{jurisdiction:'KR',label:'경찰청 사이버범죄 신고시스템',url:'https://ecrm.police.go.kr/',reviewedAt:'2026-10-31'},
  KR_KISA:{jurisdiction:'KR',label:'한국인터넷진흥원',url:'https://www.kisa.or.kr/',reviewedAt:'2026-10-31',verificationStatus:'PARTIALLY_VERIFIED'},
  US_FTC:{jurisdiction:'US',label:'FTC · What To Do if You Were Scammed',url:'https://consumer.ftc.gov/articles/what-do-if-you-were-scammed',reviewedAt:'2026-10-31'},
  US_ID:{jurisdiction:'US',label:'FTC · IdentityTheft.gov',url:'https://www.identitytheft.gov/',reviewedAt:'2026-10-31'}
});
const locales={KR:'KR',US:'US',UNKNOWN:'UNKNOWN'};
export const validCountry=c=>Object.hasOwn(locales,c)?c:'UNKNOWN';
export const sourceSet=(country,path)=>country==='US'?(path==='IDENTITY'?['US_FTC','US_ID']:['US_FTC']):country==='KR'?(path==='REMOTE_ACCESS'?['KR_KISA','KR_ECRM']:['KR_FSC','KR_ECRM']):[];
const step=(id,title,instruction,fallback)=>({id,title,instruction,fallback});
function paymentDetail(country,method){
  if(country==='KR'){
    if(method==='BANK_TRANSFER')return '계좌이체에 사용한 금융회사에 즉시 연락해 지급정지 및 피해 대응 가능 여부를 문의하세요.';
    if(method==='INTERNATIONAL_WIRE')return '해외송금에 사용한 금융회사에 즉시 연락해 추적·취소 가능 여부를 문의하세요. 회수는 보장되지 않습니다.';
    if(method==='CARD')return '카드 발급사의 공식 채널로 거래 이의제기 및 보호 조치 가능 여부를 문의하세요.';
    if(method==='PAYMENT_APP')return '해당 송금·결제 서비스와 연결된 금융회사 공식 채널에 각각 문의하세요.';
    if(method==='CRYPTO')return '사용한 거래소·서비스의 공식 지원 경로에 문의하세요. 거래 취소가 어려울 수 있습니다.';
    if(method==='GIFT_CARD')return '상품권 발행사의 공식 고객 지원에서 사용·취소 가능 여부를 확인하세요.';
    if(method==='CASH')return '현금 전달 경로와 상황에 맞춰 경찰의 공식 안내를 확인하세요. 회수는 보장되지 않습니다.';
  }
  if(country==='US'){
    if(method==='ACH'||method==='BANK_WIRE')return '은행·신용조합에 즉시 해당 거래를 알리고 취소·회수 또는 분쟁 절차를 문의하세요.';
    if(method==='CARD')return '카드 발급사의 공식 앱 또는 카드 뒷면에 적힌 연락처로 연락해 이의제기를 문의하세요.';
    if(method==='PAYMENT_APP')return '결제 앱 운영사에 신고하고, 연결된 카드·은행에도 필요한 조치를 문의하세요.';
    if(method==='CRYPTO')return '사용한 거래소·ATM 운영사 공식 지원에 즉시 신고하세요. 되돌리기 어려울 수 있습니다.';
    if(method==='GIFT_CARD')return '상품권 발행사 공식 경로에 즉시 연락하고 카드와 영수증은 안전하게 보관하세요.';
    if(method==='CASH'||method==='CHECK')return '현금 전달사 또는 수표를 취급한 금융기관에 즉시 문의하세요. 방식에 따라 가능한 조치가 다릅니다.';
  }
  return '어떤 결제 수단인지 아직 확인되지 않았습니다. 먼저 안전하게 결제 제공사의 공식 경로를 확인하세요.';
}
export function guidedSteps(path,country,context={}){
  const local=validCountry(country),done=context.actionStatus==='DONE'||context.actionStatus==='PARTLY_DONE';
  const unsafe=context.screenUnsafe===true;
  if(path==='PAYMENT')return [
    step('PAUSE','추가 금전 전달 보류','추가 송금·환급 수수료·인증정보 요구를 잠시 멈추세요.','다른 안전한 기기나 신뢰할 수 있는 사람의 도움을 고려하세요.'),
    step('PROVIDER',done?'결제 제공사에 신속히 연락':'공식 경로로 요구 내용 확인',done?paymentDetail(local,context.paymentMethod):'상대방이 제공한 연락처 대신 기존에 알고 있던 공식 앱·연락처로 확인하세요.','연락되지 않으면 해당 기관의 다른 검증된 공식 지원 경로 또는 현지 공식 신고 안내를 확인하세요.'),
    step('FOLLOWUP','신고·회복 후속 절차 확인',local==='KR'?'실제 금전 피해를 입었다고 생각된다면 경찰 또는 금융회사의 공식 피해 대응 절차를 확인하세요.':local==='US'?'결제 수단에 따른 FTC 안내와 공식 신고 절차를 확인하세요.':'현재 위치에 맞는 공식 금융·신고 기관을 확인하세요. 임의의 번호를 신뢰하지 마세요.','증거를 안전하게 보존하고 나중에 다시 확인할 수 있습니다.')
  ];
  if(path==='FAMILY')return [
    step('PAUSE','추가 요구에 즉시 응하지 않기','상대가 요구하는 돈·인증정보·기기 접근 제공을 보류하세요. 신체 위해 가능성이 임박했다면 현지 긴급 도움을 우선하세요.','안전하게 기기를 조작할 수 없다면 이 화면에서 추가 확인을 진행하지 마세요.'),
    step('INDEPENDENT','기존 가족 연락처로 별도 확인','상대가 제공한 새 번호나 발신번호 표시만 믿지 말고 기존에 알고 있던 가족 연락처를 직접 이용하세요.','연락이 되지 않으면 다른 신뢰할 수 있는 가족·지인을 통해 독립적으로 확인하되 긴급 도움 요청을 지연하지 마세요.'),
    step('UNCERTAINTY','미확인 결과와 다음 조치 정리','응답이 없거나 내용이 충돌해도 납치·안전을 단정하지 마세요. 실제 임박한 위해 가능성이 있다면 현지 긴급기관에 연락을 고려하세요.','사용 가능한 안전한 연락 수단이 없으면 조치를 보류하고 안전한 지원을 먼저 확보하세요.')
  ];
  if(path==='CREDENTIALS')return [
    step('NO_SHARE','인증정보 추가 제공 중단','비밀번호·OTP·복구코드나 추가 개인정보를 이 앱 또는 상대방에게 제공하지 마세요.','안전한 기기가 없으면 민감한 계정 조작을 지금 진행하지 마세요.'),
    step('SECURE','공식 계정 보호 절차 이용','신뢰할 수 있는 기기에서 공식 계정 복구·비밀번호 변경·다중 인증·연결 세션 점검을 진행하세요.','로그인이 안 되면 공식 고객지원의 계정 복구 절차를 확인하세요.'),
    step('CHECK','연결 계정과 피해 확인','동일 비밀번호를 사용한 다른 계정 및 금융 서비스의 이상 징후를 안전하게 확인하세요.','결과를 모르면 확인되지 않은 상태를 유지하고 공식 지원으로 이어가세요.')
  ];
  if(path==='REMOTE_ACCESS')return [
    step('NO_ACCESS','추가 화면 공유·접근 보류','추가 앱 설치·화면 공유·원격제어 승인을 하지 마세요. 이미 허용했다고 보고했다면 의심 기기를 안전하다고 가정하지 마세요.','현재 화면이 감시된다면 추가 입력을 중단하고 안전한 경로부터 확보하세요.'),
    step('TRUSTED_DEVICE','신뢰 가능한 다른 기기 활용',unsafe?'화면이 안전하지 않다는 자기 보고가 있어 민감한 작업이나 추가 질문을 진행하지 않습니다.':'의심 기기에서 금융·인증 업무를 진행하지 말고 다른 신뢰할 수 있는 기기에서 공식 지원을 확인하세요.','다른 기기가 없으면 신뢰할 수 있는 사람이나 오프라인 공식 지원을 고려하세요.'),
    step('SECURE','공식 기기·계정 지원 확인','제조사 또는 보안기관 공식 경로에서 기기 점검·관련 계정 보호가 필요한지 확인하세요. 앱 삭제만으로 안전을 단정하지 마세요.','안전 여부를 확인하지 못하면 기기 상태를 미확인으로 유지하세요.')
  ];
  if(path==='IDENTITY')return [
    step('MINIMIZE','추가 개인정보 제공 중단','신분증 번호·전체 계좌번호 등 민감정보를 SafeCall에 입력하지 마세요.','화면이 안전하지 않으면 다른 신뢰 가능한 경로를 사용하세요.'),
    step('OFFICIAL','공식 신원 보호 절차 확인',local==='US'?'IdentityTheft.gov에서 신원도용 여부에 맞는 대응 계획과 보호 조치를 확인하세요.':local==='KR'?'금융회사 및 공식 보이스피싱·개인정보 보호 안내에서 가능한 예방 조치를 확인하세요.':'현재 관할을 확인한 뒤 공식 개인정보·신원 보호 안내를 찾아보세요.','계정 이용이 안 된다면 안전한 다른 기기로 공식 지원 경로를 확인하세요.'),
    step('MONITOR','추가 피해 가능성 점검','노출이 의심되는 계정·금융거래의 이상 징후를 신뢰 가능한 경로로 확인하세요.','피해 사실이 확인되지 않아도 정황과 시도한 보호 조치를 스스로 기록할 수 있습니다.')
  ];
  return [
    step('PAUSE','위험 행동 잠시 보류','추가 금전·인증정보·기기 접근 요구가 있다면 먼저 보류하세요.','화면이 안전하지 않다면 안전한 기기나 사람을 통해 확인하세요.'),
    step('CHECK','독립 확인','안전한 공식 연락 경로로 상대의 요구를 확인하세요.','확인할 수 없다면 사실을 확정하지 않고 대기하거나 공식 지원을 검토하세요.'),
    step('NEXT','필요한 케어 선택','확인된 상황에 맞는 금전·계정·가족·기기 대응 절차를 별도로 선택하세요.','불확실성은 그대로 기록하고 새로운 피해를 예방하는 행동을 유지하세요.')
  ];
}
