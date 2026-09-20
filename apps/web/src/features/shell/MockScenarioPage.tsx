"use client";

/**
 * mock 시나리오 전환 (개발용, docs/api/common.md 6절). mock 모드에서만 동작한다.
 * 상단바 MOCK 배지 Popover 는 cluster·cost·advisor 그룹만 지원하므로(DataSourceBadge ScenarioGroup),
 * db 그룹·어드바이저 fastTimers·전체 초기화는 이 화면에서 한다.
 */
import {
  Button,
  Card,
  Grid,
  GridItem,
  InlineAlert,
  PageHeader,
  Select,
  Skeleton,
  Switch,
  UnknownState,
} from "@/components/ui";

import { useStreamStore } from "../stream/StreamProvider";
import { useMockScenarios } from "./mock-scenarios";

export function MockScenarioPage() {
  const { stream } = useStreamStore();
  const mock = useMockScenarios(stream.dataSource === "mock");

  if (stream.dataSource === "live") {
    return (
      <>
        <PageHeader title="mock 시나리오" />
        <UnknownState size="lg" title="live 모드에서는 사용할 수 없습니다" hint="DATA_SOURCE=mock 으로 실행하면 시나리오를 바꿀 수 있습니다." />
      </>
    );
  }

  const data = mock.data;
  return (
    <>
      <PageHeader
        title="mock 시나리오"
        subtitle="개발용 · 서버 메모리의 시나리오를 바꾸면 영향을 받는 토픽 스냅샷이 모든 탭에 다시 옵니다."
        actions={
          <Button variant="secondary" icon="rotate-ccw" loading={mock.pending} onClick={() => void mock.reset()} disabled={!data?.enabled}>
            전체 초기화
          </Button>
        }
      />
      <div className="page-stack">
        {mock.error ? <InlineAlert tone="warn" title={mock.error} /> : null}
        {!data ? (
          mock.loadError ? (
            <UnknownState size="lg" reason="시나리오 목록을 불러오지 못했습니다" />
          ) : (
            <Skeleton lines={6} />
          )
        ) : !data.enabled ? (
          <UnknownState size="lg" title="시나리오 전환을 쓸 수 없습니다" hint="mock 모드가 아닙니다." />
        ) : (
          <Grid>
            {data.groups.map((g) => {
              const active = g.options.find((o) => o.id === g.active);
              return (
                <GridItem key={g.id} span={6} spanMd={12}>
                  <Card as="section" aria-label={g.label}>
                    <div className="stack">
                      <h2 className="text-h3">{g.label}</h2>
                      <Select
                        label={`${g.label} 시나리오`}
                        value={g.active}
                        width={280}
                        disabled={mock.pending}
                        onChange={(v) => void mock.change(g.id, v, g.id === "advisor" ? g.fastTimers : undefined)}
                        options={g.options.map((o) => ({ value: o.id, label: o.label }))}
                      />
                      {active?.description ? <p className="text-caption">{active.description}</p> : null}
                      {g.id === "advisor" && g.fastTimers !== undefined ? (
                        <Switch
                          label="짧은 시간 제한 (지연 10초 · 시간 초과 20초)"
                          checked={g.fastTimers}
                          disabled={mock.pending}
                          onChange={(v) => void mock.change(g.id, g.active, v)}
                        />
                      ) : null}
                    </div>
                  </Card>
                </GridItem>
              );
            })}
          </Grid>
        )}
      </div>
    </>
  );
}
