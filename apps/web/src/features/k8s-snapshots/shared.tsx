"use client";

/**
 * k8s-snapshot 화면 공용 조각 (docs/design/k8s-snapshot.md). ASM 과 같은 부분은 aws-snapshots/shared 를 그대로 쓴다.
 * 모든 사용자 입력·파일 내용·리소스 이름은 텍스트 노드로만 그린다(디자인 14절).
 */
import {
  Banner,
  Card,
  Chip,
  CommandLine,
  CommandSteps,
  DataTable,
  DriftStatus,
  HelpPopover,
  Icon,
  InlineAlert,
  KeyValueList,
  Skeleton,
  UnknownState,
  type Column,
} from "@/components/ui";

import { sourceUnknownView } from "../aws-snapshots/model";
import { useApi } from "../common/hooks";
import { driftCellView, writeBlockBannerK8s } from "./model";
import type { DriftBadge, DriftRulesResponse, K8sCli, K8sScanRulesResponse, K8sSnapshotSummary, WriteAbility } from "./types";

export { MockNotice, SnapshotTime } from "../aws-snapshots/shared";

/** 쓰기 불가 Banner (ASM-D 3.5): neutral + lock, 닫을 수 없음 */
export function K8sWriteBlockBanner({ writable }: { writable: WriteAbility | null | undefined }) {
  const b = writeBlockBannerK8s(writable);
  if (!b) return null;
  return <Banner tone="neutral" icon="lock" title={b.title} description={b.description} />;
}

/** 출처를 쓸 수 없음: 설정 없음·폴더 없음·읽기 실패 (디자인 3.7). 예시 스냅샷을 보이지 않는다 */
export function K8sSourceUnknown({ summary }: { summary: K8sSnapshotSummary }) {
  const v = sourceUnknownView(summary);
  if (!v) return null;
  const setup = summary.root.setup;
  const notConfigured = summary.root.state === "not_configured";
  const detail = v.detail && v.detail !== v.reason ? <p className="text-mono">{v.detail}</p> : null;
  const hint = notConfigured ? (
    <div className="stack-sm" style={{ maxWidth: 560, textAlign: "left" }}>
      {detail}
      <p>① docker compose: api 서비스에 ./deploy/k8s-snapshot/snapshots 폴더를 쓰기 가능하게 마운트하고 경로 설정을 지정하세요.</p>
      {setup ? <CommandLine command={setup.dockerMount} copyLabel="마운트 설정 복사" fullWidth /> : null}
      <p>② Docker 없이 실행: 저장소의 deploy/k8s-snapshot/snapshots 경로를 설정으로 지정하세요.</p>
      {setup ? <CommandLine command={setup.localExample} copyLabel="설정 예시 복사" fullWidth /> : null}
      <p>③ EKS에 배포한 대시보드에서는 이 기능을 쓰지 않습니다.</p>
    </div>
  ) : (
    <div className="stack-sm" style={{ maxWidth: 560, textAlign: "left" }}>
      {detail}
      <p>마운트를 확인하세요. 대시보드는 폴더를 자동으로 만들지 않습니다.</p>
      {setup ? <CommandLine command={setup.dockerMount} copyLabel="마운트 설정 복사" fullWidth /> : null}
    </div>
  );
  return <UnknownState size="lg" reason={v.reason} hint={hint} />;
}

interface ExitRow {
  code: number;
  text: string;
}

const EXIT_COLUMNS: Column<ExitRow>[] = [
  { id: "code", header: "코드", width: 56, render: (r) => <span className="text-mono">{r.code}</span> },
  { id: "text", header: "뜻", minWidth: 200, render: (r) => r.text },
];

/**
 * 새 스냅샷 만들기 안내 (디자인 3.6, 명세 5.6). 명령·설정·종료코드는 서버 `cli` 값(계약 6.2). 대시보드는 실행하지 않는다.
 * scanId 가 있으면 재스캔 명령에 ID 를 채운다(서버 값에 이미 채워져 있으면 그대로).
 */
export function K8sCliGuide({ cli, scanId }: { cli: K8sCli; scanId?: string }) {
  const scan = scanId ? cli.scan.replace("<id>", scanId) : cli.scan;
  return (
    <Card as="section" padding="lg" aria-label="새 스냅샷 만들기 안내">
      <div className="stack-lg">
        <p className="text-strong">새 스냅샷은 터미널에서 CLI로 만듭니다. 대시보드는 이 명령을 실행하지 않습니다.</p>
        <CommandSteps
          label="새 스냅샷 만들기 단계"
          steps={[
            { id: "install", title: "설치", command: cli.install },
            {
              id: "configure",
              title: "설정",
              text: (
                <span className="stack-sm">
                  <span>{cli.configure}</span>
                  {cli.settings.length > 0 ? (
                    <ul className="list-plain" aria-label="설정 목록">
                      {cli.settings.map((s) => (
                        <li key={s.name} className="row gap-2" style={{ minHeight: 24, flexWrap: "wrap" }}>
                          <code className="text-mono">{s.name}</code>
                          {s.required ? <Chip size="sm" label="필수" /> : null}
                          <span className="text-caption">{s.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <span className="text-caption-tertiary">
                    전체 설정은 <span className="text-mono">{cli.readme}</span>을 보세요.
                  </span>
                </span>
              ),
            },
            { id: "dry", title: "미리 보기", command: cli.dryRun },
            { id: "export", title: "내보내기", command: cli.export },
            { id: "scan", title: "재스캔", command: scan },
          ]}
        />
        <div className="row row-start gap-6" style={{ flexWrap: "wrap" }}>
          {cli.exitCodes.length > 0 ? (
            <div className="grow" style={{ minWidth: 320, flexBasis: "52%" }}>
              <DataTable caption="CLI 종료코드" density="compact" columns={EXIT_COLUMNS} rows={cli.exitCodes} rowKey={(r) => String(r.code)} />
            </div>
          ) : null}
          <ul className="list-plain stack-sm grow text-caption" style={{ minWidth: 240, flexBasis: "40%" }}>
            <li className="row row-start gap-1-5">
              <Icon name="info" size={14} />
              <span>
                내보내기 전용 읽기 역할과 컨텍스트는 <span className="text-mono">{cli.readme}</span>를 따르세요. 대시보드 권한(sentinel-readonly)을 쓰지 않습니다.
              </span>
            </li>
            <li className="row row-start gap-1-5">
              <Icon name="hand" size={14} />
              <span>대시보드에는 적용 기능이 없습니다. kubectl diff로 확인한 뒤 kubectl apply를 직접 실행하세요.</span>
            </li>
            <li className="row row-start gap-1-5">
              <Icon name="database" size={14} />
              <span>Postgres 데이터와 PV 내용은 담지 않습니다. pg_dump 또는 EBS 볼륨 스냅샷으로 따로 보관하세요.</span>
            </li>
            <li className="row row-start gap-1-5">
              <Icon name="git-branch" size={14} />
              <span>이 스냅샷을 운영 매니페스트의 출발점으로 쓰려면 README &apos;git으로 관리 시작하기&apos;를 보세요.</span>
            </li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

/**
 * 드리프트 배지 1줄 + 2줄 (디자인 3.5). 목록 셀·상세 chips 줄 공용.
 * srPrefix: 열 머리글이 `드리프트`인 표에서는 "" (publisher 요청), 그 밖은 기본 `드리프트: `.
 */
export function driftBadgeParts(
  badge: DriftBadge | null | undefined,
  opts: { pending?: boolean; kubeStale?: boolean; size?: "sm" | "md"; srPrefix?: string } = {},
) {
  const v = driftCellView(badge, { pending: opts.pending, kubeStale: opts.kubeStale });
  const primary = (
    <DriftStatus
      state={v.state}
      count={v.count}
      size={opts.size ?? "sm"}
      staleAt={v.staleAt}
      previous={v.previous}
      reason={v.srReason}
      refreshing={v.refreshing}
      srPrefix={opts.srPrefix}
    />
  );
  return { view: v, primary, secondary: v.line2 };
}

// ---------------------------------------------------------------- 도움말

interface RuleRow {
  id: string;
  severity: string;
  description: string;
}

const RULE_COLUMNS: Column<RuleRow>[] = [
  { id: "id", header: "규칙", width: 168, render: (r) => <span className="text-mono">{r.id}</span> },
  {
    id: "severity",
    header: "등급",
    width: 72,
    render: (r) => (
      <span className="row gap-1">
        <Icon name={r.severity === "error" ? "octagon-x" : r.severity === "warn" ? "triangle-alert" : "circle-help"} size={12} />
        {r.severity === "error" ? "오류" : r.severity === "warn" ? "경고" : "알 수 없음"}
      </span>
    ),
  },
  { id: "description", header: "잡는 것", minWidth: 160, render: (r) => r.description },
];

/** 스캔 규칙 도움말 (디자인 5.3): 규칙 표는 서버(`profile: k8s`), 처리 방법 두 줄을 맨 앞에 */
export function K8sScanRulesHelp() {
  return <HelpPopover mode="drawer" label="규칙" title="스캔 규칙과 처리 방법" content={<ScanRulesBody />} />;
}

function ScanRulesBody() {
  const q = useApi<K8sScanRulesResponse>("/k8s-snapshots/scan-rules");
  return (
    <div className="stack-lg">
      {q.data ? (
        <DataTable caption="스캔 규칙" density="compact" columns={RULE_COLUMNS} rows={q.data.rules} rowKey={(r) => r.id} />
      ) : q.error ? (
        <InlineAlert tone="neutral" title="스캔 규칙을 불러오지 못했습니다" description={q.error.message} />
      ) : (
        <Skeleton lines={6} />
      )}
      <div className="stack-sm">
        <h4 className="text-strong">처리 방법</h4>
        <ol className="stack-sm" style={{ paddingLeft: 20 }}>
          <li>
            env의 <code>value:</code> 리터럴을 지우고 <code>valueFrom.secretKeyRef</code>로 바꿉니다. Secret 이름을 모르면 우선{" "}
            <code>{"<POSTGRES_PASSWORD>"}</code> 같은 자리표시자로 바꿉니다.
          </li>
          <li>
            <code>kind: Secret</code> 파일은 스냅샷에 두지 않습니다. 값을 지우고 별도 보관소에서 관리하세요.
          </li>
          <li>
            검토 후 문제없는 줄은 같은 줄 끝에 <code># {q.data?.allowMarker ?? "snapshot-scan: allow"}</code> 주석을 답니다.
          </li>
          <li>JSON 파일은 주석을 달 수 없으므로 값을 지웁니다.</li>
          <li>이미 커밋·푸시했다면 값을 교체(rotate)해야 합니다.</li>
        </ol>
      </div>
      <p className="text-caption row row-start gap-1-5" style={{ flexWrap: "nowrap" }}>
        <Icon name="info" size={14} />
        <span>스캐너는 모든 비밀값을 잡는다는 보장이 없습니다. 커밋 전 diff를 직접 확인하세요.</span>
      </p>
    </div>
  );
}

/** 드리프트 규칙 도움말: 비교 가능 종류·기본값 표·관리 필드·가림 (계약 6.6, 서버 표 그대로) */
export function DriftRulesHelp() {
  return <HelpPopover mode="drawer" label="드리프트 규칙" title="드리프트 비교 규칙" content={<DriftRulesBody />} />;
}

function DriftRulesBody() {
  const q = useApi<DriftRulesResponse>("/k8s-snapshots/drift-rules");
  if (q.error) return <InlineAlert tone="neutral" title="드리프트 규칙을 불러오지 못했습니다" description={q.error.message} />;
  if (!q.data) return <Skeleton lines={8} />;
  const d = q.data;
  const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  return (
    <div className="stack-lg">
      <p className="text-caption">
        규칙 버전 <span className="text-mono">{d.rulesVersion}</span> · 대시보드의 읽기 전용 권한 안에서만 비교합니다.
      </p>
      <section className="stack-sm">
        <h4 className="text-strong">비교하는 종류</h4>
        <ul className="list-plain stack-sm">
          {d.comparableKinds.map((k) => (
            <li key={k.id} className="row gap-2">
              <span>{k.kind}</span>
              <span className="text-mono text-caption-tertiary">{k.apiVersion}</span>
              {k.informer !== "ok" && k.informer !== "mock" ? <Chip size="sm" dashed label={k.informer === "forbidden" ? "권한 거부" : k.informer} /> : null}
            </li>
          ))}
        </ul>
        <p className="text-caption">{d.uncomparableNote}</p>
      </section>
      <section className="stack-sm">
        <h4 className="text-strong">기본값 차이로 숨기는 필드</h4>
        <KeyValueList
          columns={1}
          labelWidth={200}
          items={d.defaults.map((x) => ({
            label: x.path,
            value: (
              <span>
                {x.kinds.join(", ")} · 기본값 <span className="text-mono">{text(x.value)}</span>
                {x.note ? ` · ${x.note}` : ""}
              </span>
            ),
          }))}
        />
      </section>
      <section className="stack-sm">
        <h4 className="text-strong">관리 필드로 숨기는 필드</h4>
        <KeyValueList
          columns={1}
          labelWidth={200}
          items={d.managed.map((x) => ({
            label: x.path,
            value: `${x.kinds.join(", ")} · ${x.reason} (${x.condition})`,
          }))}
        />
      </section>
      <section className="stack-sm">
        <h4 className="text-strong">가리는 값</h4>
        <ul className="list-plain stack-sm">
          {d.masked.map((m) => (
            <li key={m} className="text-mono text-caption">
              {m}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
