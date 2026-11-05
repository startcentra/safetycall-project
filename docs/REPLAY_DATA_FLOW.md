# 연구·유튜브 사례는 기존 분석기에 이렇게 연결한다

> **v0.3 시점의 초기 설계 메모.** 아래 마지막 v0.4 단락을 최신 상태로 간주한다. 외부 영상 다운로드·원음 전사·실제 Meta API 비교는 여전히 미구현이며 60건 합성 데이터셋·발화별 재생은 v0.4에서 구현됐다.

## 한 문장 규칙

**사례가 늘어나도 새 위험 엔진을 만들지 않는다.** JSON 배열에서 대화를 발화 순서대로 하나씩 꺼내어 이미 구현된 `assessTriage()`에 전달한다.

```text
공개 공식 사례 URL (메타데이터만 보관)
  ↓ 출처·사용권한·사실관계 검증
개인정보 제거 + 짧은 합성 대화(JSON)
  ↓ 한 발화씩 (미래 발화·정답 레이블 전달 금지)
assessTriage(turns, actionEvent?)  ← /lab·/simulator와 같은 함수
  ↓
위험 지수 / 심리적 압박 / Meta 호출 후보 / 근거
  ↓ (승인된 API 키·비용이 있는 경우만)
서버측 Meta AnalysisProvider (향후 구현)
  ↓
정답 레이블과 별도 비교, 경고 시점·오탐·미탐 평가
  ↓
같은 coaching / policy / mock-banking 흐름 사용
```

## JSON 예시 (가상 재구성; 실제 녹취 아님)

```json
{
  "id": "DEMO-CASE-001",
  "source": {"url": "https://example.org/official-article", "usage": "public-method-summary", "verified": false},
  "synthetic": true,
  "category": "authority-impersonation",
  "turns": [
    {"speaker": "caller", "text": "금융기관 직원이라고 주장하며 연락했습니다."},
    {"speaker": "caller", "text": "확인 절차이니 외부에는 알리지 말아 주세요."},
    {"speaker": "caller", "text": "지금 가상 계좌로 송금하세요."}
  ],
  "groundTruth": {
    "safeToInterveneFromTurn": 3,
    "expectedRiskSignals": ["MONEY_REQUEST", "SECRECY"]
  }
}
```

위 URL은 예시이며 실제 출처가 아니다. 실제로 조사·확인되지 않은 사례를 검증된 사건으로 표시하면 안 된다.

## 분석 평가 설계

- 첫 발화 → 첫 결과; 둘째 발화 → 앞선 2개 발화만 입력; 셋째도 마찬가지. 미래 정보 금지.
- 실험 A(키워드), B(정규식·문맥), C(승인된 Meta 분석) 간 *평가 대상*은 달라도 **UI·사건 상태·코칭·정답 라벨 스키마는 공통으로 유지**한다.
- A를 추가로 비교하더라도 제품용 위험 판단 엔진을 하나 더 운영하지 않는다. 비교용 알고리즘은 순수 오프라인 baseline으로만 구분.
- 모델 프롬프트에 `groundTruth`를 제공하지 않는다.
- 동일 사건의 표현만 조금 바꾼 문장은 훈련셋과 최종 평가셋에 분리하지 않는다(사례 계열 단위 분할).
- 정답이란 '사기범 신원 확정'이 아니라 **합성 시나리오의 설계 라벨**임을 명시한다.
- Precision/Recall 외에 트리거 시점, 정상 통화의 불필요한 Meta 호출 후보 비율, 안전 코칭 적절성을 측정.

## 개인정보·권한

YouTube를 볼 수 있다는 이유만으로 전체 영상·음원을 추출, 재배포, 외부 AI 서비스에 업로드할 권한이 생기는 것은 아니다. 공개 기관의 수법 설명을 참고해 새 대화를 재구성하는 것을 우선하고, 음원 사용은 허가/라이선스와 개인 정보 처리를 확인한 뒤 별도 실험으로 한다.

## v0.4 실제 구현 연결

앞부분의 '설계 가이드'에서 60건 데이터셋·텍스트 재생 기능을 이제 구현했다. 경로는 `src/data/scenarios/cases.json`, `src/modules/evaluation/index.ts`, `/lab/replay`, `scripts/evaluate-replay.mjs`, `reports/replay-results.json`이다. **음성·영상 수집과 Meta 모델 호출은 여전히 미구현**이다. `groundTruth`는 평가시에만 사용하고 기존 분석 함수에는 전달하지 않는다. 60건은 모두 합성 대화이며 실제 녹취가 아니다.


## v0.5 공급자 연결
`replayScenario` 결과와 동일한 prefix에서 `buildReplayMetaInput()`을 만들고, 서버에서 동일 `assessTriage()`를 호출해 Meta 호출 후보를 결정한다. 모델 출력은 별도 검증 후 코칭 템플릿에 전달한다. 테스트의 정답/미래발화 누출 금지 유지.
