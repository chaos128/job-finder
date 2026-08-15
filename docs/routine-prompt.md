# 채점 routine 설정

Claude Code scheduled agent(routine)로 매일 **02:00 KST**에 실행한다.

## 필요한 값

- `JOB_FINDER_BASE_URL` — `https://jobsonar.vercel.app`
- `SCORING_TOKEN` — `.env.local`의 값과 동일 (Vercel 환경변수에 넣은 것과 같은 값)

routine은 셸 변수를 물려받지 않으므로, 프롬프트의 `$JOB_FINDER_BASE_URL`과
`$SCORING_TOKEN`은 실제 값으로 치환해서 등록해야 한다.

## 한 번에 최대 20건 — 백로그는 여러 밤에 걸쳐 빠진다

`/api/scoring/pending`은 **한 번 호출에 최대 20건**만 돌려준다. 남은 공고는 이번 실행이
채점하지 않고, 다음날 실행이 이어받는다 (`jobs_needing_score` 뷰는 이미 채점된 건과
3회 이상 실패한 건을 제외하므로 다음 호출은 항상 새 20건 또는 남은 건이다).

처음 이 routine을 켤 때 대기 중인 공고가 많이 쌓여 있다면 (예: 168건),
**첫날 밤은 20건만 채점되고 나머지 148건은 그대로 대기 상태로 남는다.**
이건 버그가 아니라 설계다 — 하루 20건씩 여러 밤에 걸쳐 백로그가 빠지고,
정상 가동 이후에는 하루치 신규 수집분(대개 20건 미만)만 채점하면 되므로
매일 밤 한 번의 호출로 충분해진다. 백로그를 더 빨리 비우고 싶다면 이
routine을 하루에 여러 번 실행하거나, 프롬프트의 1~5단계를 한 실행 안에서
`jobs`가 빈 배열이 될 때까지 반복하게 바꾸면 된다 (기본 프롬프트는 반복하지 않는다).

## 프롬프트

```
매일 채용 공고를 채점하는 작업이다. 아래 순서를 정확히 따라라.

1. 채점 대기분을 가져온다:
   curl -s "$JOB_FINDER_BASE_URL/api/scoring/pending" -H "Authorization: Bearer $SCORING_TOKEN"

2. 응답의 jobs 배열이 비어 있으면 아무것도 하지 말고 "채점할 공고 없음"이라고만 보고하고 끝낸다.

3. 응답에는 profile.resumeText(내 이력서 프로필)와 rubric(채점 기준)이 들어 있다.
   rubric을 그대로 따른다. 임의로 축을 늘리거나 배점을 바꾸지 마라.

4. jobs를 **한 건씩** 채점한다. 한 번에 여러 건을 놓고 비교하지 마라 —
   앞 공고가 뒤 공고의 기준점이 되면 점수 눈금이 흔들린다.
   각 건마다 intro, requirements, mainTasks, preferredPoints, benefits, skillTags를
   전부 읽고 resumeText와 대조해 5개 축(stack, role, domain, growth, conditions)에
   0~20점을 매긴다. 특히 intro(회사/서비스 소개)는 domain 축을 판단하는 데 필요하니
   빠뜨리지 마라 — requirements나 mainTasks만 보고 domain을 판단하지 마라.

5. 한 호출은 최대 20건만 돌려준다. 대기 중인 공고가 20건보다 많아도 이번 실행은
   받은 것만 채점하면 된다 — 나머지는 다음 실행(다음날 밤)이 이어받는다.
   지금 당장 더 채점하고 싶다고 1번을 다시 호출해 새 20건을 추가로 받아도 되지만,
   필수는 아니다.

6. 전부 채점했으면 결과를 한 번에 보낸다:
   curl -s -X POST "$JOB_FINDER_BASE_URL/api/scoring/results" \
     -H "Authorization: Bearer $SCORING_TOKEN" \
     -H "Content-Type: application/json" \
     -d '[{"jobId":"...","total":72,"breakdown":{"stack":18,"role":16,"domain":14,"growth":12,"conditions":12},"reasoning":"..."}]'

   형식 규칙:
   - breakdown의 키는 정확히 5개(stack, role, domain, growth, conditions)
   - 각 값은 0~20 정수
   - total은 5개 값의 합과 정확히 일치해야 한다
   - jobId는 pending 응답에서 받은 값 그대로(uuid)
   - reasoning은 2~4문장, 왜 그 점수인지 축별로 드러나게

7. 응답의 accepted 수와 rejected 배열을 보고한다.
   검증은 항목 단위라, 일부가 형식에 안 맞아도 나머지는 저장되고 200이 온다.
   rejected에 담긴 건은 서버가 실패 횟수를 올려 3회 뒤 자동으로 큐에서 빠지므로
   다시 보낼 필요 없다 — 보고만 하면 된다.
   400은 본문이 JSON이 아니거나 배열이 아닐 때만 온다(= 보내는 쪽 버그).
   그때는 error 문구를 그대로 보고하고 멈춰라 — 추측으로 다시 보내지 마라.
```

## 확인

첫 실행 후 Supabase에서:

```sql
select total, breakdown, left(reasoning, 60) from scores order by scored_at desc limit 10;
```

점수가 극단(전부 90+ 또는 전부 40-)에 몰려 있으면 루브릭 앵커를 조정하고
`packages/scoring/src/rubric.ts`의 `RUBRIC_VERSION`을 올린다.
