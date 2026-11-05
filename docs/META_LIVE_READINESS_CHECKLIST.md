# Meta LIVE 사용 전 준비 체크리스트 — 2026-10-28

**현재 판정: NOT READY / 비용 사용 미승인.**

- [x] 동일 `assessTriage()` 위험 엔진 재사용
- [x] 60개 가상 사례 보존 및 오프라인 평가
- [x] 단위 + 로컬 핸들러 통합 73건 통과
- [x] 내부 비용 예약·정산·Kill Switch 단위 테스트
- [x] 가짜 WebSocket을 이용한 게이트웨이 예외 테스트
- [ ] npm 패키지 신뢰성·버전 검토 후 정상 설치
- [ ] `package-lock.json` 생성·검토, npm 의존성 취약점 점검
- [ ] 전체 TypeScript 검사 통과
- [ ] ESLint 및 Next.js 프로덕션 빌드 통과
- [ ] 실제 Chromium 브라우저에서 MOCK 가상 통화/중단/재시작 점검
- [ ] 가상 거래 보류·취소 화면 E2E 점검
- [ ] 실제 로컬 WebSocket 업그레이드와 Fake ASR 연결 확인(외부 Meta 통신 없이)
- [ ] 동의 철회/늦은 응답/버퍼 포화의 실네트워크 확인
- [ ] Meta 모델 사용 권한·크레딧 유효 기간·실제 요금 검증
- [ ] 공식 Meta Billing 및 앱 내부 장부 대조 방법 확인
- [ ] 사용자의 **별도 명시적 소액 LIVE 지출 승인** 확보

## 기본 안전 설정

```dotenv
MODEL_API_KEY=
META_LIVE_ENABLED=false
META_VOICE_LIVE_ENABLED=false
META_SPEND_APPROVED=false
META_BUDGET_KILL_SWITCH=true
```

LIVE 준비 점검 중에는 이 값을 true로 바꾸지 않는다. 실제 계정 API 키를 채팅에 붙여넣지 말 것. 실험용 프로젝트의 지출 상한은 Meta **계정 전체의 강제 청구 상한이 아니므로**, 공식 Usage/Billing을 병행 확인해야 한다.

사용자가 LIVE를 별도로 승인해도, 앞의 설치·빌드·브라우저 검증 없이 곧바로 활성화하지 않는다.
