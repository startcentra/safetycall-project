# SafeCall v0.4 — 텍스트 재생·평가 프로토콜

## 0. 변경 불가능한 구조

`cases.json -> replayScenario() -> assessTriage() -> selectDemoCoaching() -> /lab/replay`

- `/lab` 및 `/simulator`와 동일한 제품 분석 함수 `assessTriage()`를 사용한다.
- `keywordBaseline()`은 오프라인 비교 실험에만 사용하며 실사용 코칭·거래 보류에 연결하지 않는다.
- Meta AI를 호출하지 않는다. `shouldCallMeta`는 **호출 후보 플래그**다.
- `replayScenario`는 prefix `turns.slice(0, index+1)`만 넘긴다. `groundTruth`, 출처 및 미래 발화는 전달하지 않는다.

## 1. 판정 기준

- 합성 위험(SCAM) 시나리오 30건과 정상(NORMAL) 15건을 이진 평가한다.
- 불확실(AMBIGUOUS) 15건은 이진 정답으로 강제하지 않고 별도의 경고·호출 후보 건수를 기록한다.
- **위험 경고**: `riskBand !== LOW` 또는 `emergencyFlag === true`.
- **Meta 호출 후보**: `shouldCallMeta === true` (경고와 별개).
- **키워드 비교기 경고**: `keywordBaseline`의 최소한의 단어 탐지 결과. 제품용 분석 엔진이 아니다.
- 사건 단위 양성 예측은 시나리오 재생 중 **한 번이라도 경고**한 경우이다.

## 2. 지표 정의

`TP`: 합성 SCAM이며 경고함. `FN`: SCAM인데 경고하지 못함. `FP`: NORMAL인데 경고함. `TN`: NORMAL이며 경고 없음.

- Precision = TP/(TP+FP)
- Recall = TP/(TP+FN)
- F1 = 2×Precision×Recall/(Precision+Recall)
- False Positive Rate = FP/(FP+TN)
- False Negative Rate = FN/(FN+TP)
- Trigger Recall = 호출 후보가 된 SCAM / SCAM 30건
- First Warning Turn = 실제 `riskBand`가 처음 LOW를 벗어난 발화 번호
- First Trigger Turn = `shouldCallMeta`가 처음 참이 된 발화 번호
- **Before Critical** = 첫 경고 발화 번호가 `expectedCriticalTurn`보다 **작음** (정말로 사전 개입)
- **By Critical** = 첫 경고가 위험행동 요청과 같은 발화 또는 그보다 먼저 발생
- 데이터가 없는 분모에 대해서는 `null` / N/A 처리

현재 위험 점수(0~100)는 임의 가중치 합산값이며 금융사기 확률이나 신뢰구간이 아니다. `PSYCHOLOGICAL PRESSURE`도 의학적 가스라이팅 진단이 아니다.

## 3. 실행 절차

```bash
npm run test:replay
npm run eval:replay
npm run test:refactor
npm run check:static
# npm 패키지 설치 가능 환경에서만
npm run typecheck
npm test
npm run build
npm run dev
```

브라우저: `http://localhost:3000/lab/replay` → 유형 선택 → 가상 통화 선택 → 다음 발화 → 지수·코칭 변화 관찰 → 평가 JSON/CSV 저장.

`reports/replay-results.json`은 **실제로 실행한 평가기의 결과만** 저장하고 테스트 실행 때 재생성된다. 실제 Meta API 결과와 혼동하지 않는다. 외부 API 호출 시간/비용은 이 버전에서 측정하지 않았다.

## 4. 평가 데이터 누출 방지

테스트에 `groundTruth`를 바꿔도 `replayScenario`가 내는 분석 결과가 변하지 않는지 검사한다. 분석 입력에 다음 턴을 추가하지 않았을 때 미래 결과가 섞이지 않는지도 전체 턴에 걸쳐 검증한다. 향후 Meta AI 프롬프트에도 평가 정답과 출처의 결론을 포함하지 않는다.

## 5. 실험 한계

연구자가 합성 예시와 레이블을 함께 작성했으며, 이 데이터는 독립 블라인드 평가도 실제 사용 환경 재현도 아니다. A/B 비교는 비실시간 규칙 코드 간 실험일 뿐 Meta 모델 성능 향상을 입증하지 않는다. 정확도가 높아도 위험 행동 전 경고와 안전한 코칭이라는 제품 성능이 충분하다고 단정할 수 없다.


## v0.5 모델 비교 계획
A(오프라인 규칙), B(트리거 발생 시 Meta), C(전 발화 Meta 연구 모드)를 분리. B/C LIVE 실측값은 아직 없음. C는 별도 비용 승인까지 비활성. `docs/META_EVALUATION_PROTOCOL.md` 참조.
