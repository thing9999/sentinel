"use client";

/**
 * 파드 상세의 `로그` 섹션 — **기본 접힘** (docs/design/logs.md 9절, PM 결정 D1).
 *
 * - 접힘 = 연결 없음(로그 API 를 하나도 부르지 않는다). 펼침 = 따라가기 **켬**으로 연결 1개(스트림 슬롯 1개).
 *   접거나 화면을 떠나면 `LogViewer`가 언마운트되며 `close`가 불려 슬롯이 돌아온다(AC-LOG13).
 * - 섹션을 그릴지·`로그 화면에서 열기` 주소는 **서버 `pod.logHref` 하나**로 정한다(계약 logs 11.4 진입점 1).
 *   `null`이면(로그 꺼짐·차단 네임스페이스) 섹션째 없다. 화면이 `enabled`·`denyNamespaces`로 다시 판단하지 않는다.
 *   덧붙이는 것은 **펼친 뷰어에서 고른 `container` 하나뿐**이다(PM 결정 4, `withContainer`).
 * - 접힌 줄에 가림 문장을 넣지 않는다 — "완벽하지 않다" 없이 안심만 시키는 반쪽 문장이 된다(디자인 9절).
 *   펼치면 `LogViewer` 맨 위에 닫을 수 없는 가림 경고가 나온다.
 */
import { useId, useState } from "react";

import { Button, ButtonLink, Section } from "@/components/ui";

import { useApi } from "../common/hooks";
import { withContainer } from "./href";
import { LogViewer } from "./LogViewer";
import type { LogCapabilitiesResponse, LogSourceId, LogTargetsResponse } from "./types";

export function PodLogsSection({
  namespace,
  name,
  logHref,
}: {
  namespace: string;
  name: string;
  /** 서버 `PodItem.logHref`. `null`이면 섹션을 그리지 않는다 */
  logHref: string | null;
}) {
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<string | null>(null);
  const [previous, setPrevious] = useState(false);
  const [source, setSource] = useState<LogSourceId | null>(null);

  // 펼치기 전에는 아무것도 부르지 않는다 (파드 상세를 여는 것만으로 로그 API 를 부르지 않는다)
  const caps = useApi<LogCapabilitiesResponse>(open && logHref ? "/logs/capabilities" : null);
  const targets = useApi<LogTargetsResponse>(
    open && caps.data?.enabled ? `/logs/targets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}` : null,
  );

  if (!logHref) return null;

  const capabilities = caps.data;
  const effectiveContainer = container ?? targets.data?.defaultContainer ?? null;

  return (
    <Section
      title="로그"
      actions={
        <span className="row">
          <Button
            variant="ghost"
            size="sm"
            icon={open ? "chevron-up" : "scroll-text"}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "로그 닫기" : "로그 보기"}
          </Button>
          {/* 서버 링크 + 펼친 뷰어에서 고른 컨테이너 하나만(PM 결정 4). 넓은 화면에서도 같은 컨테이너로 열린다 */}
          <ButtonLink variant="ghost" size="sm" icon="chevron-right" href={withContainer(logHref, effectiveContainer)}>
            로그 화면에서 열기
          </ButtonLink>
        </span>
      }
    >
      <div id={bodyId}>
        {open ? (
          capabilities ? (
            <LogViewer
              capabilities={capabilities}
              target={{ namespace, pod: name }}
              targets={targets.data}
              targetsLoading={targets.loading}
              container={effectiveContainer}
              onContainerChange={setContainer}
              previous={previous}
              onPreviousChange={setPrevious}
              source={source ?? capabilities.activeSource}
              onSourceChange={setSource}
              // 펼치는 행동이 곧 "지금 보겠다"는 의사 표시다 — 따라가기 켬 (디자인 6.2 표 · 9절)
              followDefault
              height={480}
            />
          ) : (
            <p className="text-caption">로그 기능 상태를 읽는 중입니다…</p>
          )
        ) : (
          <p className="text-caption-tertiary">펼치면 이 파드의 컨테이너 로그를 실시간으로 따라갑니다.</p>
        )}
      </div>
    </Section>
  );
}
