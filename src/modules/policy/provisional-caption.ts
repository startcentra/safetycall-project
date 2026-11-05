/** v1.32 supplemental non-authoritative guidance from human-observed captions.
 * Never mutates risk scores, policy gates or mock bank/card ledgers.
 */
export type CaptionCue=Readonly<{code:string;observedAtMs:number}>;
export type ProvisionalAdvisory=Readonly<{
 kind:'NON_BINDING_VERIFICATION_GUIDANCE';basis:'CAPTION_OBSERVATION_NOT_STT';
 message:string;observedAtMs:number;isFraudDetermination:false;canAuthorizeFinance:false;
}>;
export function deriveCaptionAdvisory(cues:readonly CaptionCue[]):ProvisionalAdvisory|null{
 if(!Array.isArray(cues)||!cues.length)return null;
 const priorities:[string,string][]=[
  ['PERSONAL_DATA_SOLICITATION','개인정보를 입력하거나 읽어주기 전에 발신자의 신원을 공식 채널로 별도 확인하세요.'],
  ['NAVIGATION_PROMPT','상대방이 안내하는 주소나 검색 결과에 접속하기 전에 공식 기관 주소를 직접 확인하세요.'],
  ['CRIME_INVOLVEMENT_CLAIM','범죄 연루 주장에 압박받더라도 전화를 끊고 공식 기관 연락처로 직접 확인하세요.'],
 ];
 for(const [code,message] of priorities){
  const cue=cues.find(e=>e.code===code&&Number.isSafeInteger(e.observedAtMs)&&e.observedAtMs>=0);
  if(cue)return Object.freeze({kind:'NON_BINDING_VERIFICATION_GUIDANCE',basis:'CAPTION_OBSERVATION_NOT_STT',
    message,observedAtMs:cue.observedAtMs,isFraudDetermination:false as const,canAuthorizeFinance:false as const});
 }
 return null;
}
