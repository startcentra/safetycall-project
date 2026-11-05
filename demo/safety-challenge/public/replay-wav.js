/** SafeCall v1.33: deterministic browser/local-only PCM16 WAV windowing.
 * Not STT, not live monitoring, and never fetches media from a remote URL.
 * The file is never persisted or uploaded unless the operator separately consents.
 */
export const REPLAY_WINDOW_MS = 5000;
export const REPLAY_MAX_SEGMENTS = 8; // Default standard mode.
export const REPLAY_LONG_MAX_SEGMENTS = 24; // Only after server opt-in, never for standard mode.
const SAMPLE_RATE = 16000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
const HEADER_BYTES = 44;
const checkedMax = (maxSegments) => {
  if(maxSegments !== REPLAY_MAX_SEGMENTS && maxSegments !== REPLAY_LONG_MAX_SEGMENTS) return wrong('유효하지 않은 실험 구간 상한입니다.');
  return maxSegments;
};
const wrong = (message) => { throw new Error(message); };
const token = (bytes, start, len=4) => String.fromCharCode(...bytes.subarray(start,start+len));

/** Strict canonical WAV format. No MP3/MP4, extra chunks, malicious metadata or conversion. */
export function inspectReplayWav(input,{maxSegments=REPLAY_MAX_SEGMENTS}={}) {
  checkedMax(maxSegments);
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes || bytes.byteLength < HEADER_BYTES + 2 || bytes.byteLength > HEADER_BYTES + maxSegments*REPLAY_WINDOW_MS*BYTES_PER_SECOND/1000 + 16384)
    return wrong(`최대 ${maxSegments*5}초의 16kHz PCM16 모노 WAV만 지원합니다.`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (token(bytes,0)!=='RIFF'||token(bytes,8)!=='WAVE'||v.getUint32(4,true)!==bytes.length-8)
    return wrong('RIFF/WAVE 길이 헤더 오류');
  let offset=12,foundFmt=false,dataOffset=-1,dataLength=0,chunks=0,metadataBytes=0;
  while(offset<bytes.length) {
    if(offset+8>bytes.length || ++chunks>20) return wrong('WAV 청크 구조 오류');
    const tag=token(bytes,offset),size=v.getUint32(offset+4,true),start=offset+8,end=start+size;
    if(end>bytes.length) return wrong('WAV 청크 길이 오류');
    if(tag==='fmt ') {
      if(foundFmt||size<16||size>64) return wrong('WAV fmt 중복·길이 오류');
      if(v.getUint16(start,true)!==1||v.getUint16(start+2,true)!==1||v.getUint32(start+4,true)!==SAMPLE_RATE||
         v.getUint32(start+8,true)!==BYTES_PER_SECOND||v.getUint16(start+12,true)!==2||v.getUint16(start+14,true)!==16)
        return wrong('16kHz·PCM16·모노 형식만 지원합니다.');
      foundFmt=true;
    }else if(tag==='data') {
      if(dataOffset>=0||!foundFmt||size<2||size>maxSegments*REPLAY_WINDOW_MS*BYTES_PER_SECOND/1000||size%2)
        return wrong('WAV 데이터 청크 순서·길이 오류');
      dataOffset=start;dataLength=size;
    }else{
      // Metadata is ignored and never included in the normalized upload.
      if(!['LIST','JUNK','fact','bext','PAD ','id3 '].includes(tag)) return wrong('지원하지 않는 WAV 메타데이터 청크');
      metadataBytes+=size;
      if(metadataBytes>16384)return wrong('WAV 메타데이터가 너무 큽니다.');
    }
    offset=end+(size%2);
  }
  if(offset!==bytes.length||!foundFmt||dataOffset<0) return wrong('WAV 필수 청크 누락');
  const samples=dataLength/2;
  if(samples%16!==0) return wrong('현재 검증 경로는 1ms 단위로 정렬된 WAV를 요구합니다. FFmpeg에서 -t 옵션으로 분할하세요.');
  const windows=Math.ceil(samples/(SAMPLE_RATE*REPLAY_WINDOW_MS/1000));
  if(windows<1||windows>maxSegments) return wrong('구간 수가 허용 범위를 벗어났습니다.');
  return Object.freeze({durationMs:samples/SAMPLE_RATE*1000,totalSegments:windows,sampleCount:samples,dataOffset});
}

/** Copy precisely the requested 5-second slice with an independent valid WAV header. */
export function makeReplaySegment(input, segmentIndex,{maxSegments=REPLAY_MAX_SEGMENTS}={}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const info = inspectReplayWav(bytes,{maxSegments});
  if (!Number.isSafeInteger(segmentIndex)||segmentIndex<0||segmentIndex>=info.totalSegments)
    return wrong('요청한 오디오 구간이 파일 길이 밖입니다.');
  const from = segmentIndex * SAMPLE_RATE * (REPLAY_WINDOW_MS/1000);
  const until = Math.min(info.sampleCount,from + SAMPLE_RATE*(REPLAY_WINDOW_MS/1000));
  const samples = until-from;
  const size = HEADER_BYTES+samples*2;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const write=(at,label)=>{for(let k=0;k<label.length;k++)out[at+k]=label.charCodeAt(k);};
  write(0,'RIFF');view.setUint32(4,size-8,true);write(8,'WAVE');write(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,SAMPLE_RATE,true);view.setUint32(28,BYTES_PER_SECOND,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);
  write(36,'data');view.setUint32(40,size-HEADER_BYTES,true);
  out.set(bytes.subarray(info.dataOffset+from*2,info.dataOffset+until*2),HEADER_BYTES);
  return {bytes:out,startMs:from/SAMPLE_RATE*1000,endMs:until/SAMPLE_RATE*1000,
    durationMs:samples/SAMPLE_RATE*1000,index:segmentIndex,final:segmentIndex===info.totalSegments-1};
}

/** Pure local replay eligibility, independent of UI and bank policy. */
export function replayEligibility({caseId,sourceCaseId,mode,step,ended,segmentIndex,serverSegmentCount,
  serverNextStartMs,hasPending,networkReady,modelReady,totalSegments,maxSegments=REPLAY_MAX_SEGMENTS}={}) {
  checkedMax(maxSegments);
  if (!caseId||caseId!==sourceCaseId) return {ok:false,reason:'사건이 바뀌었습니다. 파일을 다시 선택하세요.'};
  if (ended||!networkReady) return {ok:false,reason:'사건이 종료됐거나 서버를 확인할 수 없습니다.'};
  if (step!==0||!['SCRIPTED','LOCAL_STT_USER_REVIEWED'].includes(mode))
    return {ok:false,reason:'다른 발화 출처와 병합할 수 없습니다. 새 사건에서 시작하세요.'};
  if (!modelReady) return {ok:false,reason:'로컬 STT 모델이 설치되지 않았습니다. 재생만 가능합니다.'};
  if (hasPending) return {ok:false,reason:'이전 인식 초안을 확인하거나 폐기하세요.'};
  if (!Number.isSafeInteger(segmentIndex)||segmentIndex!==serverSegmentCount||segmentIndex>=totalSegments||
    segmentIndex>=maxSegments||serverNextStartMs!==segmentIndex*REPLAY_WINDOW_MS)
    return {ok:false,reason:'서버의 확정 구간과 미디어 시간이 다릅니다.'};
  return {ok:true,reason:'서버와 구간 번호가 일치합니다.'};
}
