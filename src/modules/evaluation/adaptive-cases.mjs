/** v0.9.2 developer-authored synthetic prompts. Repetitions in each family are correlated.
 * 'HOLDOUT' is a bookkeeping partition, NOT an unseen real-user validation set.
 */
const families=[
 {group:'KR',family:'ordinary-contact',split:'DEVELOPMENT',speaker:'caller',texts:['오늘 저녁 먹을래요?','주말에 같이 산책할까요?','병원 예약이 오후 세 시예요.','내일 점심에 만나요.','이번 주말에 가족 모임이 있어요.','내일 검진 일정을 공유할게요.','저녁에 전화할게요.','은행 영업시간을 확인했어요.','신분증을 집에 놓고 왔어요.','좋은 하루 보내세요.'],expected:'OBSERVE',question:'ASK'},
 {group:'KR',family:'transfer-demand',split:'HOLDOUT',speaker:'caller',texts:Array(10).fill('지금 계좌로 돈을 보내세요.'),expected:'PAYMENT_HOLD',question:'SKIP_NO_NEED'},
 {group:'KR',family:'kidnap-threat',split:'DEVELOPMENT',speaker:'caller',texts:Array(10).fill('우리가 당신 아들을 납치했습니다.'),expected:'EMERGENCY',question:'SKIP_EMERGENCY'},
 {group:'KR',family:'remote-app',split:'HOLDOUT',speaker:'caller',texts:Array(10).fill('원격제어 앱을 설치하세요.'),expected:'REMOTE',question:'SKIP_UNSAFE'},
 {group:'US',family:'ordinary-contact',split:'HOLDOUT',speaker:'caller',texts:['Let us meet for dinner.','Your checkup is booked for tomorrow.','I will call you on Saturday.','Can you visit next week?','We can go for a walk.','Our family dinner starts at six.','My appointment is at nine.','I bought groceries.','Let us discuss the weekend.','I will send an invitation.'],expected:'OBSERVE',question:'ASK'},
 {group:'US',family:'verification-code',split:'DEVELOPMENT',speaker:'caller',texts:Array(10).fill('Tell me your verification code.'),expected:'CREDENTIALS',question:'SKIP_NO_NEED'},
 {group:'US',family:'kidnap-threat',split:'HOLDOUT',speaker:'caller',texts:Array(10).fill('We kidnapped your son.'),expected:'EMERGENCY',question:'SKIP_EMERGENCY'},
 {group:'US',family:'money-demand',split:'DEVELOPMENT',speaker:'caller',texts:Array(10).fill('Wire the money now.'),expected:'PAYMENT_HOLD',question:'SKIP_NO_NEED'},
 {group:'UNKNOWN',family:'user-check-in',split:'DEVELOPMENT',speaker:null,texts:Array(10).fill(null),expected:'PAYMENT_HOLD',question:'ASK',reply:'PAYMENT'},
 {group:'UNKNOWN',family:'unsafe-device',split:'HOLDOUT',speaker:null,texts:Array(10).fill(null),expected:'REMOTE',question:'SKIP_UNSAFE',screenUnsafe:true},
];
export const adaptiveCases=Object.freeze(families.flatMap(f=>f.texts.map((text,n)=>Object.freeze({id:`${f.group}_${f.family}_${n+1}`,
  country:f.group,family:f.family,split:f.split,text,speaker:f.speaker,expectedKind:f.expected,expectedQuestion:f.question,
  answer:f.reply??null,screenUnsafe:!!f.screenUnsafe,synthetic:true}))));
