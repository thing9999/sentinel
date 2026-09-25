"use client";

/**
 * 알림 센터 `/alerts` (docs/design/alerts.md, docs/api/alerts.md).
 *
 * **목록은 이 화면 안에만 있다.** `alerts` 토픽은 모든 페이지가 구독하지만 이력이 실리지 않고(6.1),
 * `GET /api/alerts` 응답도 **전역 스토어에 얹지 않는다** — 얹으면 알림 화면을 보지 않는 탭이
 * 메모리에 이력을 들게 되어 스냅샷에서 목록을 뺀 이유가 되살아난다(AC-ALERT37).
 * 스트림에서 받는 것은 배지와 "뭔가 바뀌었다"는 카운터뿐이고, 목록은 그 카운터로 다시 조회한다(계약 11절).
 *
 * **화면을 여는 것만으로 읽음 처리하지 않는다**(디자인 4.6): 항목 클릭·확장·안 읽음 점 클릭·`모두 확인`만이다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AlertGapRow,
  AlertItem,
  Button,
  Chip,
  CodeBlock,
  EmptyState,
  ErrorState,
  FilterBar,
  formatCount,
  InlineAlert,
  KeyValueList,
  MultiSelect,
  PageHeader,
  ResourceName,
  Select,
  Skeleton,
  StaleNotice,
  StatusBadge,
  StatusIcon,
  Switch,
  Timestamp,
  statusFromApi,
} from "@/components/ui";
import { useNow } from "@/components/ui/hooks";
import { apiFetch } from "@/lib/api";

import styles from "./alerts.module.css";

import { useApi, useMediaQuery, useUrlQuery } from "../common/hooks";
import { useStreamStore, useTopics } from "../stream/StreamProvider";
import { STALE_AFTER_MS } from "../stream/stale";
import {
  ALERT_RANGES,
  AREA_BY_KEY,
  DEFAULT_RANGE,
  SEVERITY_OPTIONS,
  STATUS_TEXT,
  isDefaultQuery,
  mergeRows,
  parseList,
  parseRange,
  pickNotices,
  repeatTooltip,
  toChipDispatch,
  toItemTargets,
  toListQuery,
  type AlertsQuery,
} from "./model";
import type {
  AlertArea,
  AlertDetail,
  AlertRow,
  AlertSeverity,
  AlertsListResponse,
  AlertsReadResponse,
} from "./types";

/** 목록 기본 100건(계약 2.1). 더 보기로 늘린다 */
const PAGE_LIMIT = 100;
/** `alerts.created`를 받고 목록을 다시 읽기까지 (계약 11절) */
const REFETCH_DEBOUNCE_MS = 300;
/** 목록 항목의 영향 객체 표시 개수 (좁은 폭은 1개, 디자인 8절) */
const TARGETS_WIDE = 3;
const TARGETS_NARROW = 1;

const TOPICS = [] as const;

export function AlertsPage() {
  // `alerts` 토픽은 셸이 항상 구독한다(BASE_TOPICS). 이 화면은 토픽을 더 열지 않는다
  useTopics(TOPICS);
  const { stream } = useStreamStore();
  const q = useUrlQuery();
  const alerts = stream.alerts;

  const query: AlertsQuery = {
    range: parseRange(q.get("range")),
    severity: parseList(q.get("sev")).filter((v): v is AlertSeverity =>
      SEVERITY_OPTIONS.some((o) => o.value === v),
    ),
    area: parseList(q.get("area")).filter((v): v is AlertArea =>
      Object.values(AREA_BY_KEY).includes(v as AlertArea),
    ),
    unreadOnly: q.get("unread") === "1",
    includeResolved: q.get("resolved") !== "0",
  };
  const [limit, setLimit] = useState(PAGE_LIMIT);

  /**
   * 스트림 카운터가 오르면 목록을 다시 읽는다(300ms debounce). `facets`·`gaps`는 기간 필터에 딸린 값이라
   * 이벤트에 실리지 않는다 — 행만 끼워 넣으면 두 값이 어긋난다(계약 6절).
   */
  const [refreshKey, setRefreshKey] = useState(0);
  const seq = alerts.seq;
  useEffect(() => {
    if (seq === 0) return;
    const t = setTimeout(() => setRefreshKey((n) => n + 1), REFETCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [seq]);

  const list = useApi<AlertsListResponse>("/alerts", toListQuery(query, limit), refreshKey);
  const data = list.data;

  const [expanded, setExpanded] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, AlertDetail>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // 좁은 폭에서는 영향 객체를 1개로 줄인다(디자인 8절). 자르는 것은 호출 측 몫이다
  const narrow = useMediaQuery("(max-width: 1023px)", false);
  const now = useNow(1000);

  /** 확인 처리는 **사용자 조작에서만** 부른다 (계약 2.4) */
  const markRead = useCallback(
    async (body: { ids: string[] } | { all: true }) => {
      setBusy(true);
      setActionError(null);
      try {
        await apiFetch<AlertsReadResponse>("/alerts/read", { method: "PATCH", body });
        setRefreshKey((n) => n + 1);
      } catch {
        setActionError("확인 처리를 저장하지 못했습니다. 잠시 후 다시 시도하세요.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /** 이미 부른 상세 id. **setState 갱신 함수 안에서 fetch 하지 않는다**(갱신 함수는 여러 번 불릴 수 있다) */
  const requestedDetails = useRef<Set<string>>(new Set());
  const openDetail = useCallback((id: string) => {
    if (requestedDetails.current.has(id)) return;
    requestedDetails.current.add(id);
    void apiFetch<AlertDetail>(`/alerts/${encodeURIComponent(id)}`)
      .then((d) => setDetails((prev) => ({ ...prev, [id]: d })))
      .catch(() => {
        // 상세를 못 읽어도 항목은 그대로 둔다 (확장 영역만 비워진다)
        requestedDetails.current.delete(id);
      });
  }, []);

  const toggleExpand = useCallback(
    (item: AlertRow) => {
      setExpanded((cur) => {
        if (cur.includes(item.id)) return cur.filter((x) => x !== item.id);
        openDetail(item.id);
        return [...cur, item.id];
      });
      // 확장은 읽음 처리다 (디자인 4.6)
      if (!item.read) void markRead({ ids: [item.id] });
    },
    [markRead, openDetail],
  );

  const rows = useMemo(() => mergeRows(data?.items ?? [], data?.gaps ?? []), [data]);
  const facets = data?.facets;
  const badge = alerts.loaded ? alerts.badge : (data?.badge ?? alerts.badge);
  const rangeSpec = ALERT_RANGES.find((r) => r.id === query.range) ?? ALERT_RANGES[1];
  const notices = pickNotices(data?.notices ?? []);
  const maxTargets = narrow ? TARGETS_NARROW : TARGETS_WIDE;
  const stale = stream.lastHeartbeatAt !== null && now - stream.lastHeartbeatAt > STALE_AFTER_MS.watch;

  const setFilter = (patch: Record<string, string | null>) => {
    setLimit(PAGE_LIMIT);
    q.set(patch);
  };
  const reset = () => setFilter({ sev: null, area: null, range: null, unread: null, resolved: null });

  const toggleSeverityFilter = (sev: AlertSeverity) => {
    const on = query.severity.length === 1 && query.severity[0] === sev;
    setFilter({ sev: on ? null : sev });
  };

  return (
    <>
      <PageHeader
        title="알림"
        actions={
          <Button
            variant="secondary"
            disabled={badge.unreadCount < 1 || busy}
            disabledReason={badge.unreadCount < 1 ? "안 읽은 알림이 없습니다" : undefined}
            onClick={() => void markRead({ all: true })}
          >
            {`모두 확인 (${formatCount(badge.unreadCount)})`}
          </Button>
        }
      />
      <div className="page-stack">
        {actionError ? <InlineAlert tone="warn" compact title={actionError} /> : null}

        {/* 요약 줄 — 숫자는 서버 facets 값이다(화면이 세지 않는다). 0이 아닌 숫자는 필터 버튼 */}
        <div className={styles.summary}>
          <span className={styles.unread}>{`미확인 ${formatCount(badge.unreadCount)}`}</span>
          <span className={styles.counts}>
            {SEVERITY_OPTIONS.map((o) => {
              const n = facets?.severity?.[o.value] ?? 0;
              const pressed = query.severity.length === 1 && query.severity[0] === o.value;
              const text = `${o.label} ${formatCount(n)}`;
              return n > 0 ? (
                <Chip
                  key={o.value}
                  tone="neutral"
                  label={text}
                  onClick={() => toggleSeverityFilter(o.value)}
                  pressed={pressed}
                  ariaLabel={`${o.label} ${n}건만 보기`}
                />
              ) : (
                <span key={o.value} className={styles.zero}>
                  {text}
                </span>
              );
            })}
          </span>
          <span className={styles.updated}>
            {data ? (
              <>
                {"마지막 갱신 "}
                <Timestamp value={data.generatedAt} format="time" />
              </>
            ) : null}
            {stale && data ? <StaleNotice staleAt={data.generatedAt} /> : null}
          </span>
        </div>

        {notices.map(({ notice, tone }) => (
          <InlineAlert key={notice.code} tone={tone} compact title={notice.text} />
        ))}

        <FilterBar
          label="알림 필터"
          resultText={
            data ? `알림 ${formatCount(data.total)}건 중 ${formatCount(data.filteredTotal)}건 표시` : undefined
          }
          onReset={isDefaultQuery(query) ? undefined : reset}
        >
          <MultiSelect
            label="심각도"
            value={query.severity}
            onChange={(v) => setFilter({ sev: v.join(",") || null })}
            options={SEVERITY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
              count: facets?.severity?.[o.value],
            }))}
          />
          <MultiSelect
            label="영역"
            value={query.area}
            width={200}
            options={(data?.watch.keys ?? []).map((k) => ({
              value: AREA_BY_KEY[k.key] ?? k.key,
              label: k.label,
              count: facets?.area?.[AREA_BY_KEY[k.key] ?? (k.key as AlertArea)],
            }))}
            onChange={(v) => setFilter({ area: v.join(",") || null })}
          />
          <Select
            label="기간"
            width={160}
            value={query.range}
            onChange={(v) => setFilter({ range: v === DEFAULT_RANGE ? null : v })}
            options={ALERT_RANGES.map((r) => ({ value: r.id, label: r.label }))}
          />
          <Switch
            label="안 읽음만"
            checked={query.unreadOnly}
            onChange={(v) => setFilter({ unread: v ? "1" : null })}
          />
          <Switch
            label="해제 포함"
            checked={query.includeResolved}
            onChange={(v) => setFilter({ resolved: v ? null : "0" })}
          />
        </FilterBar>

        {list.error && !data ? (
          <ErrorState size="sm" title="알림 목록을 불러오지 못했습니다" onRetry={() => list.reload()} />
        ) : !data ? (
          <Skeleton lines={6} />
        ) : (
          <ul className={styles.list} aria-label="알림 목록">
            {rows.map((row) =>
              row.type === "gap" ? (
                <AlertGapRow
                  key={row.gap.id}
                  from={row.gap.from}
                  to={row.gap.to}
                  minutes={row.gap.minutes}
                  unknownPrevious={row.gap.unknownPrevious}
                />
              ) : (
                <AlertRowItem
                  key={row.item.id}
                  item={row.item}
                  detail={details[row.item.id]}
                  expanded={expanded.includes(row.item.id)}
                  maxTargets={maxTargets}
                  onToggleExpand={() => toggleExpand(row.item)}
                  onMarkRead={() => void markRead({ ids: [row.item.id] })}
                />
              ),
            )}
            {rows.length === 0 || data.items.length === 0 ? (
              <li className={styles.empty}>
                {data.total === 0 ? (
                  <EmptyState
                    size="lg"
                    icon="inbox"
                    title={rangeSpec.emptyTitle}
                    description="상태가 바뀌면 여기에 쌓입니다. 지금 조용한 것은 정상입니다."
                    footer={watchFooter(data)}
                  />
                ) : (
                  <EmptyState
                    size="sm"
                    icon="inbox"
                    title="필터 조건에 맞는 알림이 없습니다"
                    action={
                      <Button variant="ghost" size="sm" onClick={reset}>
                        필터 초기화
                      </Button>
                    }
                  />
                )}
              </li>
            ) : null}
          </ul>
        )}

        {data && data.filteredTotal > data.items.length ? (
          <div className={styles.more}>
            <Button variant="secondary" size="sm" onClick={() => setLimit((n) => Math.min(500, n + PAGE_LIMIT))}>
              {`더 보기 (${formatCount(data.items.length)} / ${formatCount(data.filteredTotal)})`}
            </Button>
          </div>
        ) : null}

        {data?.persistence === "memory" && data.items.length > 0 ? (
          <p className={`text-caption ${styles.note}`}>이력이 저장되지 않아 최근 200건만 있습니다.</p>
        ) : null}
      </div>
    </>
  );
}

/** 빈 상태 footer — "알림이 없다"가 "감시가 멈췄다"로 읽히지 않게 하는 유일한 장치(디자인 6.1) */
function watchFooter(data: AlertsListResponse) {
  const at = data.watch.lastObservedAt;
  const count = data.watch.keyCount;
  if (!at) return `감시 대상 ${formatCount(count)}개`;
  return (
    <>
      {"대시보드는 "}
      <Timestamp value={at} format="time" />
      {`까지 정상적으로 지켜보고 있습니다 · 감시 대상 ${formatCount(count)}개`}
    </>
  );
}

function AlertRowItem({
  item,
  detail,
  expanded,
  maxTargets,
  onToggleExpand,
  onMarkRead,
}: {
  item: AlertRow;
  detail?: AlertDetail;
  expanded: boolean;
  maxTargets: number;
  onToggleExpand: () => void;
  onMarkRead: () => void;
}) {
  const { targets, more } = toItemTargets(item, maxTargets);
  return (
    <AlertItem
      severity={item.severity}
      kind={item.kind}
      areaLabel={item.areaLabel}
      // 퍼블리셔 보고 8-6: prop 은 문자열이다(계약은 Reason 객체)
      reason={item.reason?.text ?? ""}
      targets={targets}
      targetsMore={more}
      occurredAt={item.occurredAt}
      resolvedAt={item.resolvedAt ?? undefined}
      durationMs={item.durationMs}
      repeatCount={item.repeatCount}
      repeatTooltip={repeatTooltip(item)}
      // 퍼블리셔 보고 8-6: prop 은 boolean 이다(계약은 객체)
      flapping={Boolean(item.flapping?.active)}
      suppressedAreas={item.suppressedAreas}
      dataSource={item.dataSource}
      dispatch={toChipDispatch(item)}
      read={item.read}
      onMarkRead={item.read ? undefined : onMarkRead}
      href={item.href ?? undefined}
      logHref={item.logHref ?? undefined}
      logLabel={item.logTarget ? `${item.logTarget.ref.namespace ?? ""}/${item.logTarget.ref.name} 로그` : undefined}
      targetGone={Boolean(item.logTarget?.gone)}
      expandable
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    >
      {expanded ? <AlertExpand item={item} detail={detail} /> : null}
    </AlertItem>
  );
}

/** 확장 영역 (디자인 4.5). **조작 버튼이 없다** — 재시도·삭제·무시를 만들지 않는다(조회 전용) */
function AlertExpand({ item, detail }: { item: AlertRow; detail?: AlertDetail }) {
  const targets = (detail ?? item).targets;
  const targetMore = Math.max(0, item.targetTotal - targets.length);
  return (
    <div className="stack-sm">
      {item.transition ? (
        <p className={styles.transition}>
          <StatusBadge size="sm" status={statusFromApi(item.transition.from ?? "unknown")} />
          <span aria-hidden="true">{"→"}</span>
          <StatusBadge size="sm" status={statusFromApi(item.transition.to)} />
          <span className="text-caption">
            {" · "}
            <Timestamp value={item.occurredAt} format="time" />
          </span>
          <span className="sr-only">
            {`${STATUS_TEXT[item.transition.from ?? "unknown"] ?? ""}에서 ${STATUS_TEXT[item.transition.to] ?? ""}(으)로 바뀜`}
          </span>
        </p>
      ) : null}

      {item.mitigations.length > 0 ? (
        <ul className={styles.sublist}>
          {item.mitigations.map((m, i) => (
            <li key={i} className="text-caption">
              {"완화 "}
              <Timestamp value={m.at} format="time" />
              {` (${STATUS_TEXT[m.from] ?? m.from} → ${STATUS_TEXT[m.to] ?? m.to})`}
            </li>
          ))}
        </ul>
      ) : null}

      {item.unknownGap ? (
        <p className="text-caption">
          {`확인 불가 구간 ${item.unknownGap.minutes}분`}
          {item.unknownGap.to === null ? " (진행 중)" : null}
        </p>
      ) : null}

      {item.restart ? (
        <div className="stack-sm">
          <p className="text-caption">
            {"대시보드 시작 "}
            <Timestamp value={item.occurredAt} format="time" />
          </p>
          <p className={styles.restartCounts}>
            <StatusIcon status="crit" size={12} />
            {` 장애 ${item.restart.counts.critical} · `}
            <StatusIcon status="warn" size={12} />
            {` 주의 ${item.restart.counts.warning} · `}
            <StatusIcon status="unknown" size={12} />
            {` 확인 불가 ${item.restart.counts.unknown}`}
          </p>
          {item.restart.gap ? (
            <p className="text-caption">
              {item.restart.gap.unknownPrevious
                ? "이전 실행 기록 없음 — 이전에 무엇이 있었는지 알 수 없습니다"
                : `정지 구간 ${item.restart.gap.minutes}분 — 이 동안의 변화는 알림으로 잡히지 않았습니다`}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 플래핑 전이 타임라인 (최대 12행 + `외 N회`) */}
      {detail && detail.transitions.length > 0 ? (
        <ul className={styles.sublist} aria-label="전이 타임라인">
          {detail.transitions.slice(0, 12).map((t, i) => (
            <li key={i} className={styles.timelineRow}>
              <Timestamp value={t.at} format="time" />
              <StatusBadge size="sm" status={statusFromApi(t.to)} />
            </li>
          ))}
          {detail.transitions.length > 12 ? (
            <li className="text-caption">{`외 ${detail.transitions.length - 12}회`}</li>
          ) : null}
        </ul>
      ) : null}

      {/* 출처 억제: 영향 영역 목록. 영역별 항목은 만들어지지 않았다 */}
      {detail && detail.suppressedKeys.length > 0 ? (
        <div className="stack-sm">
          <p className="text-caption">이 영역들의 알림은 따로 만들지 않았습니다 — 클러스터를 볼 수 없었기 때문입니다.</p>
          <ul className={styles.sublist}>
            {detail.suppressedKeys.map((k) => (
              <li key={k.key}>{k.label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {targets.length > 0 ? (
        <ul className={styles.sublist} aria-label="영향 객체">
          {targets.map((t, i) => (
            <li key={`${t.ref.kind}/${t.ref.namespace ?? ""}/${t.ref.name}/${i}`} className={styles.target}>
              <ResourceName
                name={t.ref.name}
                namespace={t.ref.namespace ?? undefined}
                kind={t.ref.kind.toLowerCase() === "node" ? "node" : "pod"}
                href={t.href ?? undefined}
                copyable
              />
              <span className="text-caption">{t.reason}</span>
            </li>
          ))}
          {targetMore > 0 ? <li className="text-caption">{`외 ${targetMore}개`}</li> : null}
        </ul>
      ) : null}

      {item.dispatch.length > 0 ? (
        <KeyValueList
          items={item.dispatch.map((d) => ({
            label: "디스코드",
            value: d.label,
            hint:
              [
                d.at ? `시도 ${new Date(d.at).toLocaleTimeString("ko-KR")}` : null,
                d.attempts > 0 ? `${d.attempts}회` : null,
                d.responseCode !== null ? `응답 ${d.responseCode}` : null,
                d.nextRetryAt ? `다음 시도 ${new Date(d.nextRetryAt).toLocaleTimeString("ko-KR")}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined,
            note: d.detail ? { tone: d.state === "failed" ? "crit" : "info", text: d.detail } : undefined,
          }))}
        />
      ) : null}

      {/* 보낼(보낸) 본문 전문 — mock 에서 문구를 사람이 검토하는 유일한 수단(디자인 4.5) */}
      {detail?.messagePreview ? <CodeBlock code={detail.messagePreview} language="메시지" wrap maxHeight={200} /> : null}
    </div>
  );
}
