/** v1.37 text-first advisory; evidence-anchored, deterministic and READ-ONLY.
 * Not a fraud probability. Never grants any bank, card, SMS or OS permission.
 * Uses active caller utterances only; never reads scenario ground-truth labels.
 */

export type TextAdvisoryLevel='NONE'|'VERIFY'|'PROTECT';
export type AdvisoryEvidence=Readonly<{code:string;turnIds:string[];detail:string}>;
export type TextAdvisory=Readonly<{
 mode:'TEXT_ONLY_MOCK_RULES';level:TextAdvisoryLevel; evidence:AdvisoryEvidence[];
 guidance:string;automaticFinancialAction:false;modelCalled:false;probability:null;
}>;
type Row={id:string;text:string};
const clean=(s:string)=>s.normalize('NFKC').replace(/[\u200b-\u200f\u2060\ufeff]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const educational=(s:string)=>{
  const contextual=/(?:보이스\s?피싱|사기|스미싱).{0,20}(?:예방|주의|교육|사례|보도)|(?:사기범|범인).{0,60}(?:라고|했다는|사례)|(?:사칭해|사칭하는).{0,60}(?:말은\s?사기|사기일|피싱일)/.test(s);
  const explicitRefusal=/(?:하지\s?마|할\s?필요가\s?없|하지\s?않|없으며|요청하지\s?않|선납은\s?없)/.test(s);
  return (contextual||explicitRefusal)&&!/(?:대신|그러니|따라서|하지만|그런데|지금\s?바로).{0,35}(?:송금(?:하|해)|이체(?:하|해)|입금(?:하|해)|설치(?:하|해)|보내(?:주|셔))/.test(s);
};
const rules:ReadonlyArray<Readonly<{code:string;level:Exclude<TextAdvisoryLevel,'NONE'>;detail:string;all:RegExp[]}>>=[
 {code:'WEB_IDENTITY_FUNNEL',level:'VERIFY',detail:'배송·기관 관련 안내 뒤 URL/QR 이동과 개인정보 입력 요청이 결합됨',all:[/(?:등기|택배|배송|미납|통행료|주차|검찰|법원|정부|지원금|청첩장|결혼식|사건|복지)/,/(?:주소창|링크|qr\s?코드|qr|조회\s?페이지|연결된\s?페이지|접속|검색창)/,/(?:개인정보|신원|본인\s?확인|카드\s?번호|카드\s?정보|신분증|비밀번호|계정).{0,28}(?:입력|제출|확인|업로드|등록)|(?:입력|제출|업로드|등록).{0,25}(?:개인정보|카드|비밀번호|신분증)/]},
 {code:'AUTHORITY_CRIME_PRESSURE',level:'VERIFY',detail:'수사기관 주장과 범죄 연루/명의 도용 압박이 함께 나타남',all:[/(?:검찰|수사관|법원|금융\s?감독원|경찰)/,/(?:대포\s?통장|범죄에\s?연루|명의\s?도용|범죄\s?연루|공범|수사\s?대상)/]},
 {code:'PAY_TO_GET_PAID',level:'PROTECT',detail:'채용·부업 보상 지급을 조건으로 선입금/충전을 요구함',all:[/(?:부업|채용|재택|급여|출금|보상|상품\s?평가|작업)/,/(?:먼저|선|우선).{0,18}(?:입금|충전|송금|보증금|예치금|등록비)|(?:출금|급여|지급).{0,24}(?:입금|충전)|교육비.{0,22}(?:보내|입금|송금)/]},
 {code:'SAFETY_TRANSFER',level:'PROTECT',detail:'안전·보호를 명분으로 다른 계좌로 자금 이동 요구',all:[/(?:계좌|은행|자금|잔액)/,/(?:안전\s?계좌|보호를\s?위해|계좌가\s?바뀌|새로운\s?계좌)/,/(?:이체|송금|입금|옮기|보내)/]},
 {code:'INVESTMENT_CERTAINTY',level:'VERIFY',detail:'손실 없는 수익 보장과 투자금 납부/충전이 결합됨',all:[/(?:투자|코인|암호\s?화폐)/,/(?:수익(?:이|은|률)?\s?보장|원금\s?보장|손실이\s?없|확정\s?수익|확정된\s?돈|\d+%씩\s?확정)/,/(?:입금|충전|송금|결제|투자금)/]},
 {code:'RECOVERY_UPFRONT_FEE',level:'PROTECT',detail:'피해금 환급을 위해 선제적 수수료 납부를 요구함',all:[/(?:환급|환불|회수|피해금)/,/(?:수수료|보증금|선납|입금|인증\s?비용|유료\s?인증)/]},
 {code:'REMOTE_CONTROL_REQUEST',level:'PROTECT',detail:'원격 접근 또는 화면 공유를 실행하도록 요구함',all:[/(?:원격\s?제어|원격\s?지원|원격\s?접속|화면\s?공유)/,/(?:설치|깔아|켜|시작|허용)/]},
 {code:'GIFT_CARD_CODE',level:'PROTECT',detail:'가족 긴급상황을 명분으로 상품권 코드 제공 요구',all:[/(?:엄마|아빠|가족|휴대\s?전화|아들|딸)/,/(?:상품권|기프트\s?카드)/,/(?:코드|사진|보내|전달)/]},
 {code:'INVOICE_REDIRECTION',level:'VERIFY',detail:'상사·대표 요청과 거래처 계좌 변경/긴급 송금이 결합됨',all:[/(?:대표|상사|거래처|결제)/,/(?:계좌가\s?바뀌|새로운\s?계좌|변경된\s?계좌)/,/(?:송금|입금|이체)/]},
 {code:'LOAN_ADVANCE_FEE',level:'PROTECT',detail:'대출 지급 조건으로 선입금을 요구함',all:[/(?:대출|대출금)/,/(?:먼저|선|우선).{0,20}(?:입금|보증금|수수료|등록비)|보증금.{0,15}입금/]},
 {code:'NEW_ACCOUNT_URGENCY',level:'VERIFY',detail:'긴급하거나 보호를 명분으로 새 계좌로 송금할 것을 요구함',all:[/(?:새\s?계좌|새로운\s?계좌|변경된\s?계좌)/,/(?:송금|이체|입금).{0,12}(?:하세요|해주세요)|(?:즉시|지금).{0,20}(?:송금|이체|입금)/]},
 {code:'TOLL_PAYMENT_LINK',level:'VERIFY',detail:'미납 통행료·주차료 안내와 링크 카드 등록 요구가 결합됨',all:[/(?:미납|통행료|주차)/,/(?:문자\s?링크|첨부된\s?링크|링크)/,/(?:카드|결제|등록|납부)/]},
 {code:'OTP_DIGIT_READBACK',level:'PROTECT',detail:'금융기관이라는 주장과 다자리 인증 숫자 낭독 요구가 결합됨',all:[/(?:은행|금융|보안팀)/,/(?:여섯\s?자리|6\s?자리|숫자|인증\s?코드)/,/(?:읽어|말해|불러|전달)/]},
 {code:'DELIVERY_CARD_COLLECTION',level:'VERIFY',detail:'배송 관련 안내에서 카드 상세정보·신분 정보를 요청함',all:[/(?:배송|택배|재배달)/,/(?:카드\s?세부|카드\s?정보|신분증|카드\s?번호)/,/(?:적어|입력|등록|업로드)/]},
 {code:'CHARITY_PRESSURE',level:'VERIFY',detail:'긴급 지원을 명분으로 즉각적인 지정 계좌 송금을 요청함(사기 확정 아님)',all:[/(?:구호|재난|기부)/,/(?:오늘\s?안에|지금\s?당장|즉시)/,/(?:지정\s?계좌|계좌로).{0,18}(?:송금|입금)/]},
 {code:'SENSITIVE_DATA_SOLICITATION',level:'VERIFY',detail:'민감정보 입력·전송을 명령하는 발화가 나타남',all:[/(?:주민\s?등록\s?번호|비밀\s?번호|카드\s?번호|카드\s?정보|개인정보|인증\s?번호).{0,28}(?:입력(?:하세요|해주세요|하면|해야|해\s?주세요)|제출(?:하세요|해야|해\s?주세요)|알려(?:주세요|줘|달라|주셔야)|전달(?:하세요|해\s?주세요|해야)|보내(?:주세요|셔야|줘))|(?:입력|제출|알려주|보내).{0,25}(?:비밀번호|카드번호|개인정보|인증번호)/]},
];
export function deriveTextAdvisory(turns:ReadonlyArray<{turnId:string;speaker:string;text:string}>,{emergency=false}:{emergency?:boolean}={}):TextAdvisory{
 const caller:Row[]=turns.filter(t=>t.speaker==='caller')
  .map(t=>({id:t.turnId,text:clean(t.text)})).filter(t=>!!t.text&&!educational(t.text));
 const evidence:AdvisoryEvidence[]=[];
 for(const rule of rules){
   const matches=rule.all.map(re=>caller.find(t=>re.test(t.text)));
   if(matches.some(x=>!x))continue;
   evidence.push({code:rule.code,turnIds:[...new Set(matches.map(x=>x!.id))],detail:rule.detail});
 }
 const level:TextAdvisoryLevel=evidence.some(e=>rules.find(r=>r.code===e.code)?.level==='PROTECT')?'PROTECT':
  evidence.length?'VERIFY':'NONE';
 const guidance=emergency?'실제 위험이 확인된 것이 아닙니다. 즉시 안전을 우선하고 현지 긴급기관 도움을 고려하세요.':
  level==='PROTECT'?'민감정보·금전·기기 접근을 제공하지 말고, 통화를 끝낸 뒤 공식 채널에서 별도로 확인하세요.':
  level==='VERIFY'?'사기 여부는 확정할 수 없습니다. 링크나 상대방 제공 번호 대신 공식 채널로 별도 확인하세요.':
  '보조 위험 신호가 아직 충분하지 않습니다. 이 결과는 안전 보증이 아닙니다.';
 return {mode:'TEXT_ONLY_MOCK_RULES',level,evidence:evidence.slice(0,10),guidance,automaticFinancialAction:false,modelCalled:false,probability:null};
}
