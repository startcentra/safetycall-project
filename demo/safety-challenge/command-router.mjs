/** Explicit session-scoped command router; transport and domain mutation are separate.
 * Authorization here is defense-in-depth after the HTTP boundary's token check.
 */
const commands=Object.freeze({
  '/api/demo/scene/load':'loadScene',
  '/api/reset':'newRun',
  '/api/advance':'advance',
  '/api/location/fixture':'locationTick',
  '/api/care/check-in':'careCheckIn',
  '/api/care/question/event':'careQuestionEvent',
  '/api/jurisdiction':'setJurisdiction',
  '/api/action':'action',
  '/api/safebank/command':'bankCommand',
  '/api/mock-card/command':'cardCommand',
  '/api/ai/tool/propose':'proposeTool',
  '/api/voice/fixture':'voiceFixture',
  '/api/voice/stt/fixture':'demoAudioFixture',
  '/api/voice/benchmark/advance':'captionAdvance',
  '/api/voice/replay/enable':'enableExtendedReplay',
  '/api/voice/stt/confirm':'confirmLocalStt',
  '/api/voice/stt/revise':'reviseLocalStt',
  '/api/voice/stt/discard':'discardLocalStt',
  '/api/verification/request':'verificationRequest',
  '/api/verification/respond':'verificationResponse',
  '/api/verification/expire':'verificationExpire',
  '/api/recovery/event':'recoveryEvent',
  '/api/guided/event':'guidedEvent',
  '/api/messages/mock-receive':'receiveMessageFixture',
  '/api/messages/link-attempt':'attemptMessageLink',
  '/api/messages/review':'reviewMessage',
  '/api/postcall/answer':'postCallAnswer',
  '/api/postcall/task':'postCallTask',
  '/api/postcall/import':'importPostCall',
  '/api/postcall/delete':'deletePostCall',
  '/api/end':'closeCase'
});
const fail=(status,message)=>{const error=new Error(message);error.status=status;throw error;};
export function dispatchCaseCommand(service,path,body,context){
  const method=commands[path];
  if(!method)fail(404,'API 없음');
  if(!context||!['parent','child','legacy'].includes(context.role)||!context.sessionId)
    fail(403,'명시적 사건 실행 권한이 필요합니다.');
  if(context.role==='child'&&path!=='/api/verification/respond')fail(403,'자녀 역할은 이 작업을 수행할 수 없습니다.');
  if(context.role==='parent'&&path==='/api/verification/respond')fail(403,'자녀 역할만 가상 응답을 보낼 수 있습니다.');
  if(!service||typeof service[method]!=='function')fail(500,'사건 명령 처리기가 준비되지 않았습니다.');
  // Reset is intentionally a special explicit parent command in the MOCK demo.
  if(path==='/api/reset')return service.reset(body,{legacyReset:context.role==='legacy'});
  return service[method](body);
}
export const allowedCaseCommands=Object.freeze(Object.keys(commands));
