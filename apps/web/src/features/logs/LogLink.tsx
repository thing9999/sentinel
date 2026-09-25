"use client";

/**
 * 진입점의 **글자** `로그` 링크 (docs/design/logs.md 0절, 계약 docs/api/logs.md 11.4).
 *
 * 쓰는 곳: Warning 이벤트 행(그 시각을 보러 가는 다른 뜻이라 글자 링크로 남긴다)과 워크로드 상세의 워크로드 링크.
 * **파드 표 4곳(목록·워크로드 소속·노드·DB)은 쓰지 않는다** — `ResourceName.logHref` 아이콘 링크다(components.md 21.10,
 * designer "추가 4" E2).
 *
 * **링크 주소는 서버 `logHref` 그대로다.** 화면은 파라미터(`follow`·`at`·`container`)를 덧붙이지 않고,
 * `enabled`·`denyNamespaces`로 링크를 다시 판단하지도 않는다 — `null`이면 그리지 않을 뿐이다.
 * 따라가기 켬/끔(Q12)도 서버 링크가 정한다(`follow=1` 또는 `at=`). 규칙이 화면에 두 벌 생기면
 * `LOG_DENY_NAMESPACES`나 mock `logs=disabled`가 한쪽만 먹는다.
 *
 * 모양은 기존 `ButtonLink`(ghost sm, `scroll-text`)다. 새 UI 컴포넌트가 아니다.
 */
import { ButtonLink } from "@/components/ui";

export function LogLink({ href, label }: { href: string | null | undefined; label: string }) {
  if (!href) return null;
  return (
    <ButtonLink href={href} variant="ghost" size="sm" icon="scroll-text" aria-label={label} title={label}>
      로그
    </ButtonLink>
  );
}
