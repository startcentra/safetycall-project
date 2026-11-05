# Public Guidance Source Registry — v0.6.6

The source objects in `src/modules/playbook/sources.ts` are the authoritative local registry; links were reviewed as public official material on 2026-10-29. **The source agencies have NOT approved SafeCall or its coaching cards.** Dates are included only when verified from the page; null means unspecified. Do not interpret `PUBLIC_SOURCE_CHECKED` as certification.

| Source | Public document | Usage |
|---|---|---|
| `FBI_VIRTUAL_KIDNAPPING` | https://www.fbi.gov/news/stories/virtual-kidnapping | Threat claims, avoid disclosing details, independent family checks, contact authorities; the page says in most cases to hang up |
| `FBI_VIRTUAL_KIDNAPPING_2025` | https://www.fbi.gov/investigate/cyber/alerts/2025/criminals-using-altered-proof-of-life-media-to-extort-victims-in-virtual-kidnapping-for-ransom-scams | Synthetic proof-of-life images are not reliable proof; confirm independently |
| `FTC_FAMILY_AI_2023` | https://consumer.ftc.gov/consumer-alerts/2023/03/scammers-use-ai-enhance-their-family-emergency-schemes | Don't trust an apparently familiar cloned voice; independently call a pre-known number |
| `FTC_AFTER_SCAM` | https://consumer.ftc.gov/articles/what-do-if-you-were-scammed | Contact the bank/payment provider promptly; ask whether a transaction can be reversed |
| `KR_POLICE_VOICE_2025` | https://www.police.go.kr/user/bbs/BD_selectBbs.do?q_bbsCode=1007&q_bbscttSn=20250618102632054 | Korean police public awareness notice: directly verify family-impersonation calls; report suspicious phishing to 112 |
| `KR_POLICE_RECOVERY` | https://ecrm.police.go.kr/minwon/crs/quick/vichelp | 피해구제 및 지급정지 신청 절차; 적용 가능성은 피해 수단과 법률 요건에 따라 달라짐 |

**Translation and attribution:** Source summaries and action cards are original, short project-specific Korean interpretations. No full article was reproduced in code. Advice should be reviewed regularly when upgrading to a real product. Real US emergency dialing differs from KR (911/112); cards intentionally say *local emergency service* without a potentially incorrect numeric constant.

## v0.9.0 recovery journey additions (2026-10-29)

Recovery checklist links are hardcoded, **public references only**, not live agency connections. Unlike the original playbook registry, these are for manually followed user checklists, not automatic action authorization.

| Jurisdiction | Source | Why shown |
|---|---|---|
| KR | https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&menuNo=205020&nttId=71739 | KISA malicious remote-control app impersonation advisory (2025-05-08) |
| KR | https://ecrm.police.go.kr/minwon/crs/quick/vichelp | Police cybercrime and damage-remedy information |
| US | https://consumer.ftc.gov/articles/what-do-if-you-were-scammed | FTC money / credentials / device-access / personal-information response |
| US | https://www.identitytheft.gov/ | FTC identity-theft recovery planning |

The application selects links only from explicit mock scenario `country` (`KR`, `US`); `UNKNOWN` intentionally returns no jurisdiction-specific links. Do not assume user location from IP, text or other sources. These links are **not endorsements, verified incident outcomes, or completed reports**.

## v0.9.1 KR/US 행동 코칭 공식 출처 추가 (2026-10-29 확인)

`src/modules/playbook/sources.ts`의 `KR_FSC_2026`, `KR_KISA_SMISHING`, `KR_SOS_1394`, `FTC_SCAM_SIGNS_2025`, `FTC_IDENTITY_STEPS`를 등록했다. 실제 사용되는 경로와 적용 조건은 `docs/V091_KR_US_COACHING_POLICY.md` 참조. 기관의 정책 승인이나 서비스를 대리하는 기능은 없다. URL 접속 여부의 실시간 재검증 기능은 제공하지 않는다.

## v0.9.3 verified attribution correction (2026-10-30)

`KR_FSC_2026` is the FSC announcement published **2026-10-06**, titled **최근 금융권 개인정보 유출사고에 따른 보이스피싱·스미싱 등 피해에 주의하세요.** The earlier generic title was not the document's actual title. This announcement specifically addresses data-leak follow-on scams, impersonation, advance payments, deceptive app installation and help with reporting suspected/actual money loss; it is not a blanket assurance of payment recovery. Official FSC page: https://www.fsc.go.kr/no010101/87882?curPage=1 .

FTC `What To Do if You Were Scammed` supports different payment-dependent next steps and account/device access precautions: https://consumer.ftc.gov/articles/what-do-if-you-were-scammed .

KISA `KR_KISA_SMISHING` could not be fetched during the 2026-10-30 live check (upstream error); prior registry attribution is retained, **not independently reverified this turn**. No official agency endorses SafeCall.
