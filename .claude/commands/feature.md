---
description: 기능 하나를 기획→디자인/DBA→API 계약→백엔드/퍼블리싱→프론트→검증 순서로 역할별 에이전트에게 나눠 진행
argument-hint: <기능 설명>
---

요청 기능: $ARGUMENTS

CLAUDE.md의 "기본 흐름"대로 진행해줘.

1. `planner` 에이전트에게 위 요청으로 명세 작성을 맡긴다. 기능 이름(kebab-case)을 정해서 `docs/specs/<feature>.md` 경로를 알려준다.
2. 명세의 "열린 질문"이 있으면 여기서 멈추고 나에게 묻는다.
3. `designer`와 `dba`를 **동시에** 호출한다. 각자 명세 경로를 넘긴다.
4. `backend`에게 `docs/api/<feature>.md` 계약 작성을 먼저 맡긴다.
5. `backend`(구현)와 `publisher`를 **동시에** 호출한다.
6. `frontend`에게 명세, 디자인, API 계약 경로를 모두 넘겨 통합을 맡긴다.
7. 각 에이전트 보고에 "○○ 요청"이 있으면 해당 담당에게 다시 넘긴다.
8. 마지막으로 명세의 수용 기준을 하나씩 체크한 표와, lint/test 결과, 남은 이슈를 나에게 보고한다.
