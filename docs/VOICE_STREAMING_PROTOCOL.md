# Voice Streaming Protocol — v0.6.2

1. 사용자가 소유·허용한 WAV를 선택, 로컬 LIVE 접근코드 입력, Meta 전송 동의.
2. 브라우저에서 같은 localhost 출처의 `POST /api/voice/session`으로 짧은 승인 토큰 발급. Meta 결제 환경변수가 OFF면 항상 차단.
3. `ws://127.0.0.1:3001` 접속, 최초 JSON `{type:"start",ticket,consented:true,durationSeconds}` 전달. Gateway는 Origin, 서명·범위·만료·재사용 확인 후 예산 예약.
4. Gateway가 Meta `wss://api.meta.ai/v1/asr/realtime`에 서버 키로 접속. 승인 메시지 `bridgeReady` 수신 뒤만 오디오 재생 및 PCM 24kHz mono little-endian 16-bit 전송.
5. 재생시간과 전송 속도 동기화. 부분 전사 `transcript`는 교체되고, `speechComplete`는 발화 ID로 정확히 한 번만 반영. 동시에 다른 발화가 시작되어도 먼저 시작한 발화의 최종 결과를 폐기하지 않는다.
6. 입력 종료는 `end` JSON -> Meta `endStream` -> Meta close 1000 대기. 브라우저 `revoke`/중단/연결 실패 시 upstream 종료, 미확정 비용 liability.
7. ASR 화자는 기본 `unknown`; 명시적으로 제작된 1인 상대방 WAV로 역할이 검증된 경우에만 `caller` 매핑. 텍스트는 단일 위험 분석기 `assessTriage()`로 들어간다.

**중요:** 브라우저의 MOCK TTS는 Meta 전사가 아니다. LIVE 네트워크 경로는 아직 실험하지 않았다. 표준 WebSocket API의 프로토콜 상태와 실제 SDK 형식은 Meta 계정에서 $5 이내 별도 승인 테스트가 필요하다.

출처: https://dev.meta.ai/docs/speech-to-text · https://dev.meta.ai/docs/api-reference/voice/schemas
