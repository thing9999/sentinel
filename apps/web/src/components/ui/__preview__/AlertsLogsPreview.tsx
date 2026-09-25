"use client";

/**
 * 알림·로그·설정 컴포넌트 미리보기 (components.md 20·21절).
 * 모든 데이터는 이 파일 안의 고정 예시다(fetch·SSE 없음).
 */
import { useMemo, useState } from "react";

import {
  AlertGapRow,
  AlertItem,
  Button,
  Card,
  Chip,
  CollapsibleNotice,
  ComponentMatrix,
  DataTable,
  Dialog,
  EmptyState,
  InlineAlert,
  KeyValueList,
  LogLineList,
  RedactionNotice,
  ResourceName,
  SearchInput,
  Section,
  SecretInput,
  SegmentedControl,
  Switch,
  formatFullTime,
  logAnchorTimeText,
  logListAnchor,
  type LogAnchorState,
  type Column,
  type ComponentMatrixCell,
  type LogLine,
  type SecretInputMode,
} from "../index";

const T = (m: number, s: number, ms = 0) =>
  new Date(2026, 8, 25, 14, m, s, ms).toISOString();

const LONG =
  "ERROR io.sentinel.api.Handler - upstream call failed after 3 retries: GET https://internal-api.prod.svc.cluster.local:8443/v2/resources?filter=namespace%3Dprod%26kind%3DDeployment%26limit%3D500 timeout=30s traceId=7f9c8d6b5a4e3d2c1b0a9f8e7d6c5b4a spanId=1a2b3c4d5e6f7a8b attempt=3 node=i-0c3d4e5f6a7b8c9d0";

const LOG_LINES: LogLine[] = [
  { id: "l0", kind: "ringTop", segments: [{ t: "text", v: "— 이전 줄은 화면에서 지워졌습니다 (2만 줄 상한) —" }] },
  {
    id: "l1",
    kind: "line",
    at: T(2, 10, 412),
    prefix: { pod: "prod/api-7f9c8d6b5-x2kq9", container: "api" },
    segments: [{ t: "text", v: "INFO  starting api server on :8080 (build 2026-09-25T04:10:00Z)" }],
  },
  {
    id: "l2",
    kind: "line",
    at: T(2, 10, 508),
    prefix: { pod: "prod/api-7f9c8d6b5-x2kq9", container: "api" },
    segments: [
      { t: "text", v: "INFO  connecting to postgres://" },
      { t: "masked", v: "ap****(12자)", rules: ["접속 문자열 자격 증명"], confidence: "high" },
      { t: "text", v: "@postgres.db.svc:5432/app" },
    ],
  },
  {
    id: "l3",
    kind: "line",
    at: T(2, 11, 90),
    prefix: { pod: "prod/api-7f9c8d6b5-x2kq9", container: "api" },
    segments: [
      { t: "text", v: "WARN  auth header Bearer " },
      { t: "masked", v: "ey****(148자)", rules: ["Bearer 토큰"], confidence: "high" },
      { t: "text", v: " rejected for tenant=acme-corp region=ap-northeast-2" },
    ],
  },
  {
    id: "l4",
    kind: "line",
    at: T(2, 11, 312),
    prefix: { pod: "prod/api-7f9c8d6b5-x2kq9", container: "api" },
    segments: [{ t: "text", v: LONG }],
  },
  {
    id: "l5",
    kind: "line",
    at: T(2, 11, 640),
    prefix: { pod: "prod/api-7f9c8d6b5-x2kq9", container: "api" },
    segments: [
      { t: "text", v: "ERROR duplicate key value violates unique constraint — statement: INSERT INTO users (email) VALUES (" },
      { t: "masked", v: "a@****(11자)", rules: ["SQL 문장"], confidence: "suspect" },
      { t: "text", v: ")" },
    ],
    truncatedBytes: 12345,
  },
  { id: "l6", kind: "dropped", droppedLines: 1204, segments: [{ t: "text", v: "— 초당 상한으로 1,204줄 생략됨 (14:02:11 ~ 14:02:12) —" }] },
  { id: "l7", kind: "binary", bytes: 4096, segments: [] },
  { id: "l8", kind: "redactFailed", segments: [] },
  {
    id: "l9",
    kind: "line",
    at: T(2, 12, 30),
    prefix: { pod: "prod/api-7f9c8d6b5-x2kq9", container: "api" },
    segments: [{ t: "text", v: "INFO  recovered, serving traffic" }],
  },
];

/*
 * 그 시각으로 열기(logs.md 7.6) 미리보기용 줄. 14:01:40부터 1초에 1줄, 30번째(14:02:10)쯤이 "그 시각" 근처.
 * 서버가 준 `anchor { state, lineId }` 를 흉내 낸다 — 화면은 시각을 비교하지 않는다(7.6).
 */
const ANCHOR_AT = new Date(2026, 8, 25, 14, 2, 5).toISOString();
const anchorLines = (prefix: string, count: number, startSec: number): LogLine[] =>
  Array.from({ length: count }, (_, i) => {
    const sec = startSec + i;
    const at = new Date(2026, 8, 25, 14, 1 + Math.floor(sec / 60), sec % 60, 412).toISOString();
    if (i === 24) {
      return { id: `${prefix}${i}`, kind: "line" as const, at, segments: [{ t: "text" as const, v: `INFO ${LONG}` }] };
    }
    if (i % 9 === 4) {
      return {
        id: `${prefix}${i}`,
        kind: "line" as const,
        at,
        segments: [
          { t: "text" as const, v: "INFO  connecting to postgres://" },
          { t: "masked" as const, v: "ap****(12자)", rules: ["접속 문자열 자격 증명"], confidence: "high" as const },
          { t: "text" as const, v: "@postgres.db.svc:5432/app" },
        ],
      };
    }
    return {
      id: `${prefix}${i}`,
      kind: "line" as const,
      at,
      segments: [{ t: "text" as const, v: i % 5 === 0 ? "ERROR Caused by: java.net.ConnectException: Connection refused" : `GET /api/orders 200 ${10 + (i % 7)}ms` }],
    };
  });
const ANCHOR_CASES: { state: LogAnchorState; lines: LogLine[]; lineId: string; notice?: "before" | "after" }[] = [
  // 14:01:40 ~ : 25번째 줄 = 14:02:05.412 (그 시각 이후 첫 줄)
  { state: "found", lines: anchorLines("af", 60, 40), lineId: "af25" },
  // 14:02:10 ~ : 가져온 첫 줄이 그 시각보다 뒤
  { state: "before_result", lines: anchorLines("ab", 30, 70), lineId: "ab0", notice: "before" },
  // 14:00:20 ~ 14:00:49 : 그 시각 이후 출력 없음
  { state: "after_result", lines: anchorLines("aa", 30, -40), lineId: "aa29", notice: "after" },
];

// 파드 표의 `로그`(components.md 21.10): 주소는 서버 `logHref` 그대로(여기서는 예시 문자열). null 이면 그리지 않는다
type LogPodRow = { name: string; status: string; logHref: string | null };
const LOG_PODS: LogPodRow[] = [
  { name: "prod/api-7f9c8d6b5-x2kq9", status: "Running", logHref: "/logs?namespace=prod&pod=api-7f9c8d6b5-x2kq9&follow=1" },
  { name: "prod/worker-5c6d7e8f9-abcde", status: "CrashLoopBackOff", logHref: "/logs?namespace=prod&pod=worker-5c6d7e8f9-abcde&follow=1" },
  { name: "db/postgres-0", status: "Running", logHref: null },
];
const LOG_POD_COLUMNS: Column<LogPodRow>[] = [
  {
    id: "name",
    header: "이름",
    minWidth: 240,
    render: (r) => <ResourceName name={r.name} kind="pod" logHref={r.logHref} />,
  },
  { id: "status", header: "상태", render: (r) => r.status },
];

const MATRIX_ROWS = [
  { id: "kube-apiserver", label: "kube-apiserver" },
  { id: "etcd-manager-main", label: "etcd-manager-main" },
];
const MATRIX_COLUMNS = [
  { id: "a", name: "i-0a1b2c3d4e5f6a7b8", meta: "ap-northeast-2a · t3.medium", status: "ok" as const },
  {
    id: "c",
    name: "i-0c3d4e5f6a7b8c9d0",
    meta: "ap-northeast-2c · t3.medium",
    status: "warn" as const,
    notReporting: true,
    reason: "NotReady 4분",
  },
];
const MATRIX_CELLS: ComponentMatrixCell[] = [
  {
    columnId: "a",
    rowId: "kube-apiserver",
    state: "ok",
    label: "Ready",
    href: "/cluster/pods/kube-system/kube-apiserver-a",
    logHref: "/logs?pod=kube-apiserver-a",
  },
  {
    columnId: "a",
    rowId: "etcd-manager-main",
    state: "crit",
    label: "장애",
    detail: "CrashLoopBackOff · 재시작 4회",
    href: "/cluster/pods/kube-system/etcd-manager-main-a",
    logHref: "/logs?pod=etcd-manager-main-a",
  },
  {
    columnId: "c",
    rowId: "kube-apiserver",
    state: "notReporting",
    label: "노드 미보고",
    detail: "마지막 보고 04:58",
    // notReporting 에도 로그 버튼을 그린다(마스터가 NotReady여도 조회는 성공할 수 있다)
    logHref: "/logs?pod=kube-apiserver-c",
  },
  { columnId: "c", rowId: "etcd-manager-main", state: "missing", label: "없음" },
];

export function AlertsLogsPreview() {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [wrap, setWrap] = useState(false);
  const [showTime, setShowTime] = useState(true);
  const [showPrefix, setShowPrefix] = useState(false);
  const [find, setFind] = useState("");
  const [source, setSource] = useState("direct");
  const [secretMode, setSecretMode] = useState<SecretInputMode>("idle");
  const [secretValue, setSecretValue] = useState("");
  const [configured, setConfigured] = useState(true);
  const [noticeOpen, setNoticeOpen] = useState(true);
  // `새 줄 N개` 흉내: 맨 아래에 직접 닿으면 N만 0(자동 스크롤은 켜지 않는다, logs.md 7.4)
  const [pending, setPending] = useState(12);
  const [reachCount, setReachCount] = useState(0);
  // 그 시각 칩 `x` = 앵커 해제(logs.md 7.6 ②). 미리보기에서는 세 목록의 앵커를 한꺼번에 뗀다
  const [anchorOn, setAnchorOn] = useState(true);
  // 2만 줄 + 깊은 앵커(10,000번째 줄) — 구분 줄 20px 가 가상 스크롤 높이에 들어가는지 확인용
  const [deepAnchor, setDeepAnchor] = useState(false);
  // currentMatch 스크롤 시연: found 목록의 긴 줄(af24, 앵커 바로 위) 오른쪽 끝의 `attempt=3` 으로 옮긴다(세로 + 가로)
  const [matchSeq, setMatchSeq] = useState(0);
  const [rowClicked, setRowClicked] = useState("");
  // 기존 컴포넌트 확장 시연(2026-09-25 publisher 요청 1~3)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [notifyOn, setNotifyOn] = useState(true);
  const [findText, setFindText] = useState("");
  const [lastKey, setLastKey] = useState("");
  const anchorTime = logAnchorTimeText(ANCHOR_AT, new Date(2026, 8, 25, 18, 0));

  const toggle = (id: string) =>
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // 2만 줄 링버퍼에서도 화면 몫만 그리는지 보기 위한 긴 목록
  const manyLines = useMemo<LogLine[]>(
    () =>
      Array.from({ length: 20000 }, (_, i) => ({
        id: `m${i}`,
        kind: "line" as const,
        at: T(2, i % 60, i % 1000),
        segments: [{ t: "text" as const, v: `${i.toString().padStart(5, "0")} ${i % 7 === 0 ? LONG : "INFO heartbeat ok"}` }],
      })),
    [],
  );

  return (
    <>
      <Section title="알림 항목 (AlertItem · AlertGapRow)" meta="components.md 20.1·20.2 / alerts.md 4·5절">
        <Card padding="sm">
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="alert-list">
            <AlertItem
              severity="critical"
              areaLabel="파드"
              reason="CrashLoopBackOff · 최근 1시간 재시작 6회"
              occurredAt={T(2, 5)}
              read={false}
              onMarkRead={() => undefined}
              href="/cluster/pods/prod/api-7f9c8d6b5-x2kq9"
              repeatCount={4}
              dataSource="mock"
              targets={[
                { kind: "Pod", namespace: "prod", name: "api-7f9c8d6b5-x2kq9", href: "/cluster/pods/prod/api" },
                { kind: "Pod", namespace: "prod", name: "api-7f9c8d6b5-mn4d2" },
              ]}
              targetsMore={2}
              dispatch={[{ state: "sent", at: T(2, 12) }]}
              logHref="/logs?pod=api-7f9c8d6b5-x2kq9"
              logLabel="prod/api-7f9c8d6b5-x2kq9 로그 보기"
              expandable
              expanded={expanded.includes("a1")}
              onToggleExpand={() => toggle("a1")}
            >
              <KeyValueList
                columns={1}
                items={[
                  { label: "채널", value: "discord" },
                  { label: "상태", value: "보냄" },
                  { label: "시각", value: "14:02:12" },
                ]}
              />
            </AlertItem>

            <AlertItem
              severity="warning"
              areaLabel="노드"
              reason="ip-10-0-40-12 메모리 87%"
              occurredAt={T(1, 2)}
              read
              href="/cluster/nodes"
              dispatch={[{ state: "skipped_severity" }]}
            />

            {/*
              2026-09-25 추가 칩 2종 (status.md 12.5). mock 발송 판정에서는 `skipped_mock` 이 먼저 이겨
              화면에서 볼 길이가 없으므로(designer R9) 여기서 본다. `발송 멈춤(연속 실패)`이 가장 긴 칩(약 130px)이라
              좁은 폭 ④행 줄바꿈(alerts.md 8절)도 이 항목으로 확인한다.
            */}
            <AlertItem
              severity="warning"
              areaLabel="파드"
              reason="OOMKilled · 최근 1시간 재시작 2회"
              occurredAt={T(1, 40)}
              read={false}
              onMarkRead={() => undefined}
              href="/cluster/pods/prod/worker-5c6d7e8f9-abcde"
              targets={[{ kind: "Pod", namespace: "prod", name: "worker-5c6d7e8f9-abcde" }]}
              dispatch={[{ state: "skipped_circuit_open" }]}
              logHref="/logs?namespace=prod&pod=worker-5c6d7e8f9-abcde"
              logLabel="prod/worker-5c6d7e8f9-abcde 로그 보기"
              expandable
              expanded={expanded.includes("a5")}
              onToggleExpand={() => toggle("a5")}
            >
              <KeyValueList
                columns={1}
                items={[
                  { label: "채널", value: "discord" },
                  { label: "상태", value: "발송 멈춤(연속 실패)" },
                ]}
              />
            </AlertItem>

            <AlertItem
              severity="resolved"
              areaLabel="파드"
              reason="CrashLoopBackOff가 풀렸습니다"
              occurredAt={T(0, 50)}
              resolvedAt={T(1, 5)}
              durationMs={15 * 60 * 1000}
              read
              href="/cluster/pods/prod/api-7f9c8d6b5-x2kq9"
              targets={[{ kind: "Pod", namespace: "prod", name: "api-7f9c8d6b5-x2kq9" }]}
              dispatch={[{ state: "skipped_no_pair" }]}
              logHref="/logs?namespace=prod&pod=api-7f9c8d6b5-x2kq9"
            />

            <AlertGapRow from={new Date(2026, 8, 25, 9, 12).toISOString()} to={new Date(2026, 8, 25, 9, 31).toISOString()} minutes={19} />

            <AlertItem
              severity="unknown"
              areaLabel="쿠버네티스 연결"
              reason="인증 실패, 토큰이 만료됐을 수 있습니다"
              occurredAt={T(0, 12)}
              read={false}
              onMarkRead={() => undefined}
              href="/"
              suppressedAreas={5}
              flapping
              repeatCount={3}
              dataSource="mock"
              kind="test"
              dispatch={[{ state: "failed", detail: "429 Too Many Requests" }]}
            />

            <AlertItem
              severity="resolved"
              areaLabel="비용"
              reason="예산 90% 아래로 내려왔습니다"
              occurredAt={T(0, 1)}
              resolvedAt={T(0, 30)}
              durationMs={17 * 60 * 1000}
              read
              href="/cost"
              dispatch={[{ state: "skipped_mock" }]}
            />

            <AlertGapRow from={new Date(2026, 8, 25, 8, 0).toISOString()} minutes={41} unknownPrevious />
          </ul>
        </Card>

        <EmptyState
          icon="inbox"
          size="lg"
          title="최근 24시간 동안 알림이 없습니다"
          description="상태가 바뀌면 여기에 쌓입니다. 지금 조용한 것은 정상입니다."
          footer="대시보드는 14:02:10까지 정상적으로 지켜보고 있습니다 · 감시 대상 8개"
        />
      </Section>

      <Section title="로그 (LogLineList · CollapsibleNotice · 닫을 수 없는 가림 경고)" meta="components.md 20.4·20.5 / logs.md 4·6·7절">
        {/* 닫을 수 없다(AC-LOG08). closable prop 자체가 없다 */}
        <RedactionNotice />

        <CollapsibleNotice
          tone="neutral"
          icon="info"
          summary="직접 조회 · 지난 로그·검색 없음"
          open={noticeOpen}
          onToggle={setNoticeOpen}
          label="직접 조회 한계 안내"
          lines={[
            "직접 조회는 지금 살아 있는 컨테이너의 현재 로그 파일만 읽습니다.",
            "노드가 로그 파일을 돌리면(보통 10MiB마다) 그 이전 내용은 남아 있어도 조회할 수 없습니다.",
            "재시작한 컨테이너는 직전 1세대까지만 볼 수 있습니다. 2세대 전 로그는 없습니다.",
            "파드가 사라지면 그 로그는 볼 수 없습니다. 장애 조사에 가장 필요한 순간에 가장 약한 지점입니다 — 외부 로그 스택이 있으면 그쪽에 남습니다.",
          ]}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-3)", alignItems: "center" }}>
          <SegmentedControl
            label="로그 출처"
            value={source}
            onChange={setSource}
            options={[
              {
                value: "stack",
                label: "로그 스택",
                disabled: true,
                disabledReason: "외부 로그 스택이 설정돼 있지 않습니다 (LOG_BACKEND_URL)",
              },
              { value: "direct", label: "직접 조회" },
            ]}
          />
          <Switch checked={wrap} onChange={setWrap} label="줄 바꿈" />
          <Switch checked={showTime} onChange={setShowTime} label="시각" />
          <Switch checked={showPrefix} onChange={setShowPrefix} label="파드 접두" />
          <Button size="sm" variant="secondary" onClick={() => setFind(find ? "" : "ERROR")}>
            {find ? "찾기 끄기" : "`ERROR` 찾기"}
          </Button>
          <Chip label="가림 3건" icon="eye-off" onClick={() => undefined} ariaLabel="가려진 값 3건, 규칙 보기" />
          <Chip label="실제로 보내지 않음" icon="flask-conical" tone="mock" />
          <Chip label="보관 7일" icon="timer" title="로그 스택 설정값입니다" />
        </div>

        <LogLineList
          lines={LOG_LINES}
          caption="prod / api-7f9c8d6b5-x2kq9 컨테이너 api 로그"
          height={240}
          wrap={wrap}
          showTimestamp={showTime}
          showPrefix={showPrefix}
          findQuery={find || undefined}
          currentMatch={find ? { lineId: "l5", index: 0 } : undefined}
          pendingCount={12}
          onJumpToBottom={() => undefined}
          onRedactionClick={() => undefined}
        />

        <p className="text-caption">2만 줄(가상 스크롤) · 긴 줄 sticky gutter · 맨 아래 닿음(`onReachBottom`) 확인용</p>
        <LogLineList
          lines={manyLines}
          caption="2만 줄 예시"
          height={200}
          wrap={wrap}
          showTimestamp={showTime}
          pendingCount={pending}
          onJumpToBottom={() => setPending(0)}
          onReachBottom={() => {
            setPending(0);
            setReachCount((n) => n + 1);
          }}
          onRedactionClick={() => undefined}
        />
        <p className="text-caption" data-testid="reach-bottom-demo">
          맨 아래 닿음 알림 {reachCount}회 · 새 줄 {pending}개{" "}
          <Button size="sm" variant="ghost" onClick={() => setPending(12)}>
            새 줄 12개로 되돌리기
          </Button>
        </p>

        <LogLineList lines={[]} state="empty" caption="빈 로그" height={80} />
      </Section>

      <Section title="그 시각으로 열기 — 앵커 (LogLineList anchor)" meta="logs.md 7.6 / components.md 20.5">
        {/*
          ② 조작 줄 맨 앞의 `그 시각` 칩 — **기존 Chip 조합**(neutral sm + history + onRemove + removeLabel + title).
          새 컴포넌트가 아니다. `x` = 앵커 해제.
        */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-3)", alignItems: "center" }}>
          {anchorOn ? (
            <Chip
              label={`그 시각 ${anchorTime}`}
              icon="history"
              size="sm"
              title={formatFullTime(ANCHOR_AT)}
              onRemove={() => setAnchorOn(false)}
              removeLabel="그 시각 표시 해제"
            />
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setAnchorOn(true)}>
              앵커 다시 켜기
            </Button>
          )}
          <Switch checked={deepAnchor} onChange={setDeepAnchor} label="2만 줄에 앵커(10,000번째 줄)" />
          <Button size="sm" variant="secondary" onClick={() => setMatchSeq((n) => n + 1)}>
            found 목록에서 `attempt=3` 찾기 ({matchSeq})
          </Button>
        </div>

        {ANCHOR_CASES.map((c) => (
          <div key={c.state} data-testid={`anchor-case-${c.state}`} style={{ display: "grid", gap: "var(--spacing-2)" }}>
            <p className="text-caption">
              <code>{c.state}</code>
            </p>
            {/* ③ 못 찾았을 때 안내 — 기존 InlineAlert 조합(info, 닫기 없음, suggest 는 action 버튼) */}
            {c.notice === "before" ? (
              <InlineAlert
                tone="info"
                title="그 시각의 줄은 가져온 500줄보다 앞에 있습니다. 줄 수를 늘려 다시 조회하세요."
                description="서버 문구 그대로(LOG_ANCHOR_BEFORE_RESULT · cut)."
                action={
                  <Button size="sm" variant="secondary">
                    2,000줄로 다시 조회
                  </Button>
                }
              />
            ) : null}
            {c.notice === "after" ? (
              <InlineAlert tone="info" compact title="그 시각 이후 출력이 없습니다." />
            ) : null}
            <LogLineList
              lines={c.lines}
              caption={`앵커 ${c.state}`}
              height={240}
              wrap={wrap}
              anchor={anchorOn ? logListAnchor({ state: c.state, lineId: c.lineId }, anchorTime, formatFullTime(ANCHOR_AT)) : undefined}
              findQuery={c.state === "found" && matchSeq > 0 ? "attempt=3" : undefined}
              currentMatch={c.state === "found" && matchSeq > 0 ? { lineId: "af24", index: 0, seq: matchSeq } : undefined}
              onRedactionClick={() => undefined}
            />
          </div>
        ))}

        <LogLineList
          lines={manyLines}
          caption="2만 줄 + 앵커"
          height={200}
          wrap={wrap}
          anchor={
            deepAnchor ? logListAnchor({ state: "found", lineId: "m10000" }, anchorTime, formatFullTime(ANCHOR_AT)) : undefined
          }
        />
      </Section>

      <Section title="기존 컴포넌트 확장 (2026-09-25 통합 2차 요청)" meta="SecretInput disabled · Switch aria-describedby · Dialog cancelDisabled · SearchInput onKeyDown">
        <Card padding="lg">
          <SecretInput
            label="웹훅 주소 (DB 없음 — 저장 불가)"
            configured
            hint="…****7f3a"
            length={119}
            updatedAt={T(2, 0)}
            onEdit={() => undefined}
            onClear={() => undefined}
            disabled
            disabledReason="대시보드 DB에 연결할 수 없어 저장할 수 없습니다."
          />
          <div style={{ height: "var(--spacing-4)" }} />
          <Switch
            checked={notifyOn}
            onChange={setNotifyOn}
            label="디스코드로 알림 보내기"
            aria-describedby="preview-switch-desc"
          />
          <p id="preview-switch-desc" className="text-caption">
            끄면 화면 알림 센터에는 계속 쌓입니다.
          </p>
          <div style={{ height: "var(--spacing-4)" }} />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDialogOpen(true);
              setSending(false);
            }}
          >
            테스트 발송 대화상자 열기
          </Button>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="디스코드로 테스트 알림을 보냅니다"
            description="보내는 중에는 취소할 수 없습니다(Esc·배경 클릭도 닫히지 않는다)."
            tone="danger"
            confirmLabel="보내기"
            confirmLoading={sending}
            onConfirm={() => setSending(true)}
            cancelLabel="취소"
            cancelDisabled={sending}
            cancelDisabledReason="보내는 중에는 닫을 수 없습니다."
            initialFocus="cancel"
          >
            {sending ? (
              <Button size="sm" variant="ghost" onClick={() => setSending(false)}>
                (시연) 전송 끝내기
              </Button>
            ) : null}
          </Dialog>
          <div style={{ height: "var(--spacing-4)" }} />
          <SearchInput
            value={findText}
            onChange={setFindText}
            placeholder="화면 안에서 찾기"
            shortcut={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                setLastKey(`${e.shiftKey ? "Shift+" : ""}Enter · 입력칸 값 "${e.currentTarget.value}"`);
              }
            }}
          />
          <p className="text-caption" data-testid="search-key-demo">
            마지막 키: {lastKey || "없음"}
          </p>
        </Card>
      </Section>

      <Section title="설정 (SecretInput)" meta="components.md 20.3 / settings.md 3.2·5절">
        <Card padding="lg">
          <SecretInput
            label="웹훅 주소"
            configured={configured}
            hint="…****7f3a"
            length={119}
            updatedAt={T(2, 0)}
            mode={secretMode}
            value={secretValue}
            onChange={setSecretValue}
            placeholder="https://discord.com/api/webhooks/…"
            inputHint="디스코드 채널 설정 → 연동 → 웹훅에서 주소를 복사하세요. 저장 후에는 다시 볼 수 없습니다."
            onEdit={() => setSecretMode(secretMode === "idle" ? "editing" : "idle")}
            onSave={() => {
              setSecretMode("idle");
              setSecretValue("");
              setConfigured(true);
            }}
            onClear={() => setConfigured(false)}
          />
          <div style={{ height: "var(--spacing-4)" }} />
          <SecretInput
            label="웹훅 주소 (오류)"
            configured={false}
            mode="editing"
            value="https://example.com/hook"
            onChange={() => undefined}
            error="디스코드 웹훅 주소가 아닙니다 (https://discord.com/api/webhooks/… 형식)"
            onSave={() => undefined}
          />
          <div style={{ height: "var(--spacing-4)" }} />
          <SecretInput
            label="웹훅 주소 (환경 변수로 잠김)"
            configured
            hint="…****7f3a"
            length={119}
            lockedByEnv="ALERTS_DISCORD_WEBHOOK_URL"
          />
          <div style={{ height: "var(--spacing-4)" }} />
          {/* 닫기·접기 없음 — 설정을 볼 때마다 보이는 것이 목적이다(settings.md 3.5) */}
          <InlineAlert
            tone="neutral"
            icon="info"
            title="알림 본문에는 클러스터 리소스 이름이 원문 그대로 들어갑니다 — 네임스페이스·워크로드·파드 이름과 노드 이름(EC2 인스턴스 ID i-0abc… 형태)."
            description="채널 공개 범위를 확인하세요."
          />
        </Card>
      </Section>

      <Section title="파드 표의 로그 (ResourceName logHref)" meta="components.md 21.10 / logs.md 0절">
        <p className="text-caption">
          ① 마우스: 행에 올리면 복사·로그 아이콘이 보인다 ② 키보드: Tab 으로 행에 오면 보인다(행 포커스) ③ 터치(hover 없음):
          항상 보인다 — 아래 마지막 줄이 그 모양이다. 셋 다 투명도로만 숨겨 스크린리더에는 항상 있다. `null` 행(db-0)은 그리지 않는다.
        </p>
        <DataTable
          caption="파드 (로그 링크 확인용)"
          columns={LOG_POD_COLUMNS}
          rows={LOG_PODS}
          rowKey={(r) => r.name}
          onRowClick={(r) => setRowClicked(r.name)}
        />
        <p className="text-caption" data-testid="row-click-demo">
          행 클릭: {rowClicked || "없음"} (로그·복사 아이콘을 눌러도 행 클릭으로 번지지 않는다)
        </p>
        {/* ③ 터치 모양 — 이 미리보기에서만 강제로 보이게(실제 규칙은 CSS `@media (hover: none)`) */}
        <div data-preview-touch="true">
          <style>{`[data-preview-touch] [class*="rnAction"] { opacity: 1; }`}</style>
          <ResourceName name="prod/api-7f9c8d6b5-x2kq9" kind="pod" logHref="/logs?namespace=prod&pod=api-7f9c8d6b5-x2kq9&follow=1" />
        </div>
      </Section>

      <Section title="구성요소 매트릭스의 로그 버튼" meta="components.md 21.5">
        <ComponentMatrix
          columns={MATRIX_COLUMNS}
          rows={MATRIX_ROWS}
          cells={MATRIX_CELLS}
          caption="컨트롤 플레인 구성요소 (로그 버튼 확인용)"
        />
      </Section>
    </>
  );
}
