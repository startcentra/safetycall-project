/** Independently authored synthetic coaching examples: NOT recorded incidents or real-user accuracy.
 * Final split was fixed by ID before the first eval run. Family distribution intentionally broad.
 * Every item is one final observed utterance; test-time labels are never passed to production logic.
 */
const base={
 KR:{
  risk:[
   ['지금 당장 송금하세요. 다른 사람에게 말하지 마세요.','PAYMENT_HOLD'],
   ['인증번호를 저에게 알려주세요.','CREDENTIALS'],
   ['원격제어 앱을 설치하세요.','REMOTE'],
   ['우리에게 당신 아들이 있습니다. 아들을 해칠 겁니다.','EMERGENCY'],
   ['아드님이 사고로 병원에 갔습니다. 가족에게 연락하세요.','VERIFY'],
   ['이 계좌로 돈을 보내세요.','PAYMENT_HOLD'],
   ['은행 보안팀입니다. 지금 당장 확인해야 합니다. 인증번호를 말해주세요.','CREDENTIALS'],
   ['화면 공유를 켜세요. 보호 앱을 설치하세요.','REMOTE'],
   ['당신의 딸을 납치했습니다.','EMERGENCY'],
   ['검찰 수사관입니다. 지금 당장 이체하세요.','PAYMENT_HOLD']
  ],
  normal:[
   ['보이스피싱 예방 교육에서 예를 들어 송금하세요라는 말을 합니다.','OBSERVE'],
   ['오늘은 아이의 준비물을 안내드립니다.','OBSERVE'],
   ['은행 보안팀은 무슨 일을 하나요?','OBSERVE'],
   ['뉴스에서 보았는데 사기범이 인증번호를 알려달라고 했대요.','OBSERVE'],
   ['아들이 내일 병원 검진을 받기로 했어요.','OBSERVE'],
   ['훈련 대본: 다른 사람에게 말하지 마세요.','OBSERVE'],
   ['본사 고객상담 서비스를 이용하셨나요?','OBSERVE'],
   ['경찰청에서 발표한 사건 통계를 읽어드릴게요.','OBSERVE'],
   ['사기 예방 교육: 계좌로 입금하세요는 예시입니다.','OBSERVE'],
   ['정상적으로 송금을 완료했어요. 영수증을 확인하세요.','OBSERVE']
  ],
  uncertain:[
   ['은행 보안팀에서 전화드립니다.','OBSERVE'],
   ['가족 상황을 확인하려 합니다.','OBSERVE'],
   ['오늘 상담 후 다시 연락드리겠습니다.','OBSERVE'],
   ['금융감독원 안내문을 보셨나요?','OBSERVE'],
   ['회사 대표번호를 확인해 주세요.','OBSERVE'],
   ['지금 당장 처리해야 한다는 얘기를 들었어요.','OBSERVE'],
   ['다른 사람에게 말하지 마세요.','VERIFY'],
   ['보호 앱 설치하세요.','REMOTE'],
   ['비밀번호를 말해주세요.','CREDENTIALS'],
   ['가족이 연락되지 않아서 걱정됩니다.','OBSERVE']
  ]
 },
 US:{
  risk:[
   ['Send money now. Do not contact your family.','PAYMENT_HOLD'],
   ['Tell me your verification code.','CREDENTIALS'],
   ['Install the remote-access support app.','REMOTE'],
   ['We kidnapped your son. We will hurt your child.','EMERGENCY'],
   ['Your granddaughter was injured in an accident.','VERIFY'],
   ['Wire the funds now to this account.','PAYMENT_HOLD'],
   ["I'm calling from the bank. Give me your one-time code.",'CREDENTIALS'],
   ['Share your screen and start the remote-access app.','REMOTE'],
   ['We took your daughter. We will kill your child.','EMERGENCY'],
   ['You must transfer the money immediately.','PAYMENT_HOLD']
  ],
  normal:[
   ['In a training script, a scammer says send money now.','OBSERVE'],
   ['Your daughter has a school event next Thursday.','OBSERVE'],
   ['I am calling from the bank about opening hours.','OBSERVE'],
   ['News report: criminals asked for a verification code.','OBSERVE'],
   ['Your grandson is going to a routine appointment.','OBSERVE'],
   ['Example of a scam: never wire money to strangers.','OBSERVE'],
   ['This is a courtesy reminder about our office hours.','OBSERVE'],
   ['Federal investigators gave a public seminar.','OBSERVE'],
   ['Fraud awareness training: the sample message says send money.','OBSERVE'],
   ['I sent the files already, thanks.','OBSERVE']
  ],
  uncertain:[
   ["I'm calling from the bank.",'OBSERVE'],
   ['Can you check the family calendar?','OBSERVE'],
   ['Let us discuss your account another day.','OBSERVE'],
   ['An IRS announcement was published yesterday.','OBSERVE'],
   ['Please call the official customer service number.','OBSERVE'],
   ['I need to leave immediately for my appointment.','OBSERVE'],
   ["Don't tell anyone about this.",'VERIFY'],
   ['Start the screen-sharing app.','REMOTE'],
   ['Please share your password.','CREDENTIALS'],
   ['I am worried because my son has not answered.','OBSERVE']
  ]
 }
};
export const coachingCases=Object.freeze(Object.entries(base).flatMap(([country,groups])=>
 Object.entries(groups).flatMap(([category,rows])=>rows.map(([text,expectedKind],idx)=>({
  id:`${country}_${category}_${String(idx+1).padStart(2,'0')}`,country,category,text,expectedKind,
  split:idx<6?'DEVELOPMENT':'HOLDOUT',speaker:'caller'
 })))));
