export const RUBRIC_VERSION = 'v1'

export const RUBRIC_AXES = ['stack', 'role', 'domain', 'growth', 'conditions'] as const
export type RubricAxis = (typeof RUBRIC_AXES)[number]

/** 축당 최대 점수. 5축 × 20 = 100. */
export const MAX_AXIS_SCORE = 20

/**
 * 루브릭 본문. `rubric.md`와 내용이 동일해야 한다 — 이 파일을 고치면 `rubric.md`도 같이 고칠 것.
 *
 * 왜 런타임에 `rubric.md`를 읽지 않고 문자열로 인라인했는가: 원래 구현은
 * `readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'rubric.md'))`였다.
 * vitest(소스에서 직접 실행)에서는 통과하지만, Next.js 프로덕션 빌드에서는 실패한다.
 * webpack이 `import.meta.url`을 빌드 시점의 절대 경로 문자열로 그대로 박아 넣고,
 * `.md` 파일은 정적으로 추적되지 않아 배포 산출물(`.nft.json` 파일 추적, Vercel 등)에
 * 포함되지 않는다. 로컬에서 `next build && next start`로 재현: 응답은 200이지만,
 * `packages/scoring/src` 디렉터리가 없는 실제 배포 환경을 흉내 내면
 * `ENOENT: no such file or directory, open '.../packages/scoring/src/rubric.md'`로 500이 난다.
 */
const RUBRIC_MARKDOWN = `# 채점 루브릭 v1

공고 1건을 5개 축으로 채점한다. 각 축 0~20점, 합계 0~100점.
**반드시 한 번에 한 건만 채점한다.** 여러 건을 한꺼번에 보면 앞 공고가 뒤 공고의 기준점이 된다.

각 축은 아래 앵커에 맞춘다. 앵커 사이는 보간한다 (예: 5점, 15점).

## stack — 기술 스택 적합도

- **0점** 주력 스택과 거의 겹치지 않는다
- **10점** 절반 정도 겹치고 나머지는 학습 가능한 범위다
- **20점** requirements 대부분이 이력서의 주력 스택이다

## role — 역할·직급 적합도

- **0점** 요구 연차나 기대 역할이 명백히 어긋난다
- **10점** 범위에는 걸치나 일부 불일치가 있다
- **20점** 연차와 책임 범위가 정확히 맞는다

## domain — 도메인 적합도

- **0점** 경험 없는 도메인이고 기존 경험의 이전성도 낮다
- **10점** 인접 도메인이라 경험 일부가 이전된다
- **20점** 직접 경험한 도메인이다

## growth — 성장·기술적 도전

- **0점** 단순 유지보수로 보이고 배울 것이 거의 없다
- **10점** 일부 새로운 영역이 있다
- **20점** 명확한 기술적 난제와 성장 여지가 있다

## conditions — 근무 조건

- **0점** 프로필에 적힌 선호 조건과 충돌한다
- **10점** 무난하지만 특별한 이점은 없다
- **20점** 위치·회사 규모·조건이 선호와 부합한다

## 출력 형식

\`breakdown\`의 키는 정확히 \`stack\`, \`role\`, \`domain\`, \`growth\`, \`conditions\` 다섯 개다.
각 값은 0~20 정수이고, \`total\`은 다섯 값의 합과 **정확히 일치**해야 한다.
\`reasoning\`은 점수의 근거를 2~4문장으로 적는다. 축별로 왜 그 점수인지 드러나야 한다.
`

export function loadRubric(): string {
  return RUBRIC_MARKDOWN
}
