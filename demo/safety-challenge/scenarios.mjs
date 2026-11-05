import {readFileSync} from 'node:fs';
const TEXT_CORPUS=JSON.parse(readFileSync(new URL('../../data/v137/text-corpus.json',import.meta.url),'utf8'));
const TEXT_SCENARIOS=Object.fromEntries(TEXT_CORPUS.cases.map(c=>[c.id,{id:c.id,name:c.name,caption:'텍스트 전용 · 합성 데이터 · '+c.category,country:c.country,intro:'공개 사기 패턴을 참고하여 만든 허구의 테스트 대화입니다. 실제 피해자 녹취·Meta API·STT 없음.',threat:false,fakeAmount:c.country==='US'?'$0':'₩0',target:'테스트',turns:c.turns}]));
/** Entirely fictional scenarios. No recorded victims, personal information or real telephony. */
export const SCENARIOS = Object.freeze({
  ...TEXT_SCENARIOS,
  kidnap: {
    id:'kidnap', name:'자녀 납치 주장', caption:'한국 · 보호자 페르소나', country:'KR',
    intro:'모르는 번호로 전화가 왔습니다. 상대는 자녀가 위험하다고 주장합니다.',
    threat:true, fakeAmount:'₩3,000,000', target:'자녀',
    turns:[
      {speaker:'caller',text:'아드님 때문에 급하게 연락드렸습니다. 지금 혼자 계십니까?',cue:'초기 가족 언급 · 독립 확인 필요 여부 관찰'},
      {speaker:'caller',text:'당신 아들을 데리고 있습니다. 우리가 아들을 납치했습니다.',cue:'가족 납치 주장 · 사실 미확인'},
      {speaker:'caller',text:'경찰에 알리면 아들을 해칠 겁니다. 지금 당장 송금하세요.',cue:'위해 협박 · 신고 방해 · 즉시 송금 요구'},
      {speaker:'caller',text:'계좌로 300만 원 입금하세요. 다른 사람에게 말하지 마세요.',cue:'금전 요구 · 외부 연락 차단'}
    ]
  },
  bail: {
    id:'bail', name:'가족 긴급 송금 사칭', caption:'미국 · 조부모 페르소나 (한국어 시연)', country:'US',
    intro:'손녀가 사고를 당해 도움이 필요하다는 전화를 받았습니다. 모든 대사는 가상입니다.',
    threat:false, fakeAmount:'$6,000', target:'손녀',
    turns:[
      {speaker:'caller',text:'손녀가 사고로 병원에 갔습니다. 가족 연락을 부탁드립니다.',cue:'가족 긴급 상황 주장 · 별도 확인 가치'},
      {speaker:'caller',text:'보석금이 급합니다. 다른 사람에게 말하지 말고 입금하세요.',cue:'외부 연락 차단 · 금전 요구'},
      {speaker:'caller',text:'지금 당장 송금하세요. 시간이 없습니다.',cue:'긴박성 상승 · 송금 압박'},
      {speaker:'caller',text:'가족에게는 연락하지 마세요. 저희가 해결합니다.',cue:'독립 확인 방해'}
    ]
  },
  otp: {
    id:'otp',name:'가상 인증번호 요청',caption:'한국 · 인증정보 노출 우려',country:'KR',
    intro:'금융 보안팀을 사칭한 사람이 인증번호를 요청합니다. 실제 번호나 계정은 없습니다.',
    threat:false,fakeAmount:'₩0',target:'계정',turns:[
      {speaker:'caller',text:'은행 보안팀에서 연락드립니다.',cue:'기관 주장 · 신원 미확인'},
      {speaker:'caller',text:'본인 인증을 해야 한다고 합니다.',cue:'인증 절차 주장 · 맥락 불확실'},
      {speaker:'caller',text:'인증번호를 저에게 알려주세요. 다른 사람에게 말하지 마세요.',cue:'인증정보 제공 요구'},
      {speaker:'caller',text:'지금 당장 처리해야 합니다.',cue:'결정 압박'}]
  },
  remote: {
    id:'remote',name:'가상 원격제어 요구',caption:'한국 · 악성 앱 의심',country:'KR',
    intro:'지원 센터를 사칭한 사람이 앱 설치를 요구합니다. 실제 설치는 이루어지지 않습니다.',
    threat:false,fakeAmount:'₩0',target:'기기',turns:[
      {speaker:'caller',text:'카드가 발급되었다는 안내를 드립니다.',cue:'카드 발급 주장 · 사실 미확인'},
      {speaker:'caller',text:'저희 지원센터에서 확인해 드리겠습니다.',cue:'지원 담당자 주장'},
      {speaker:'caller',text:'원격제어 앱을 설치하세요. 화면 공유를 켜주세요.',cue:'기기 접근 요청'},
      {speaker:'caller',text:'가족에게 말하지 말고 지금 당장 처리하세요.',cue:'긴박성 · 외부 확인 방해'}]
  },
  uncertain: {
    id:'uncertain',name:'가상 피해 여부 불확실',caption:'미국 · 사실 확인 우선',country:'US',
    intro:'내용이 분명하지 않은 일반 문의이며 피해가 확인되지 않았습니다.',
    threat:false,fakeAmount:'$0',target:'사용자',turns:[
      {speaker:'caller',text:'안녕하세요. 확인할 사항이 있어 연락드렸습니다.',cue:'신원 확인 전'},
      {speaker:'caller',text:'지난주 안내문을 받으셨나요?',cue:'일반 문의'},
      {speaker:'caller',text:'문의사항은 공식 홈페이지에서 확인 가능합니다.',cue:'독립 확인 안내'},
      {speaker:'caller',text:'감사합니다. 좋은 하루 보내세요.',cue:'위험 증거 없음'}]
  },
  benign: {
    id:'benign', name:'정상적인 가족 연락', caption:'대조군 · 정상 상황', country:'KR',
    intro:'실제 협박이나 송금 요구가 없는 정상 가족 대화입니다.',
    threat:false, fakeAmount:'₩0', target:'가족',
    turns:[
      {speaker:'caller',text:'안녕하세요. 아드님 담당 선생님입니다.',cue:'신원 주장만으로 단정하지 않음'},
      {speaker:'caller',text:'내일 행사 준비물 관련해서 연락드렸습니다.',cue:'일상적인 연락'},
      {speaker:'caller',text:'준비물은 안내문을 참고해 주세요.',cue:'금전 요구 없음'},
      {speaker:'caller',text:'좋은 하루 되세요.',cue:'불필요한 긴급 경고 평가'}
    ]
  }
});
export const MODES = Object.freeze({
  warning:{id:'warning',title:'일반 경고',description:'규칙 기반 위험 구간만 표시'},
  guidance:{id:'guidance',title:'실시간 행동 코칭',description:'근거 + 공식 교범 카드'},
  verified:{id:'verified',title:'코칭 + 가족 확인',description:'독립 확인 서버 이벤트 연결'}
});
