/** Deliberately audible tones (not speech). Deterministic QA labels do NOT constitute STT. */
import {DigestMappedFixtureAdapter,digestAudio,makeSyntheticTone,type AudioInput,type SttSegment} from './stt-port.ts';
const catalog={
  benign:{hz:400,turnId:'voice_audio_benign',speaker:'caller',text:'오늘 날씨가 참 좋네요.',quality:'OK'},
  otp:{hz:600,turnId:'voice_audio_otp',speaker:'caller',text:'은행 직원입니다. 지금 인증번호를 알려주세요. 절대 다른 사람에게 말하지 마세요.',quality:'OK'},
  noisy:{hz:800,turnId:'voice_audio_noisy',speaker:'unknown',text:'인식이 불명확합니다. 인증번호',quality:'LOW_QUALITY'},
  quote:{hz:1000,turnId:'voice_audio_quote',speaker:'caller',text:'보이스피싱 예방 교육에서 예를 들어 지금 당장 송금하세요 라는 말은 위험합니다.',quality:'OK'},
} as const;
export type DemoAudioFixtureId=keyof typeof catalog;
export const DEMO_AUDIO_OPTIONS=Object.freeze(Object.keys(catalog) as DemoAudioFixtureId[]);
const pairs=Object.values(catalog).map(v=>{
 const bytes=makeSyntheticTone(v.hz);return [digestAudio(bytes), [{kind:'FINAL',turnId:v.turnId,revision:0,speaker:v.speaker,quality:v.quality,text:v.text}]] as const;
});
export const demoAudioAdapter=new DigestMappedFixtureAdapter(new Map<string,readonly SttSegment[]>(pairs));
export function makeDemoAudioInput(id:DemoAudioFixtureId,caseId:string,now=Date.now()):AudioInput {
 const fixture=catalog[id];if(!fixture)throw new Error('unknown local test audio fixture');
 const audioBytes=makeSyntheticTone(fixture.hz);
 return {caseId,sourceType:'SYNTHETIC_DEMO_AUDIO',audioBytes,codec:'WAV_PCM16_MONO_16000',sizeBytes:audioBytes.byteLength,
    durationMs:(audioBytes.byteLength-44)/32,inputDigest:digestAudio(audioBytes),languageHint:'ko-KR',
    consentReceipt:{granted:true,purpose:'LOCAL_DEMO_ANALYSIS',externalTransfer:false,issuedAtMs:now,expiresAtMs:now+60_000},
    provenance:'GENERATED_TEST_FIXTURE',retentionPolicy:'DISCARD_IMMEDIATELY'};
}
