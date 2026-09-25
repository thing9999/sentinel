"use client";

/**
 * aws-snapshot-manager 화면 공용 조각 (docs/design/aws-snapshot-manager.md).
 * 모든 사용자 입력(라벨·메모·파일 이름·템플릿)은 텍스트 노드로만 그린다(디자인 11절).
 */
import {
  Banner,
  Card,
  CommandLine,
  CommandSteps,
  DataTable,
  HelpPopover,
  Icon,
  IconButton,
  InlineAlert,
  Skeleton,
  Tooltip,
  UnknownState,
  type Column,
} from "@/components/ui";

import { useApi } from "../common/hooks";
import { snapshotTimeLabel, snapshotTimeTooltip, sourceUnknownView, writeBlockBanner } from "./model";
import type { CliGuideText, ScanRulesResponse, SnapshotSummary, WriteAbility } from "./types";

/** 스냅샷 시각 (로컬, 날짜 포함) + 툴팁 UTC 폴더 이름 (status.md 9.4) */
export function SnapshotTime({ iso, id, strong }: { iso: string | null | undefined; id: string; strong?: boolean }) {
  const [full, utc] = snapshotTimeTooltip(iso, id);
  return (
    <Tooltip
      content={
        <span className="stack-sm">
          <span>{full}</span>
          <span className="text-mono">{utc}</span>
        </span>
      }
    >
      <time dateTime={iso ?? undefined} className={strong ? "text-strong tabular" : "tabular"} suppressHydrationWarning>
        {snapshotTimeLabel(iso, id)}
      </time>
    </Tooltip>
  );
}

/** mock 안내 (디자인 3.1) */
export function MockNotice() {
  return (
    <InlineAlert
      tone="info"
      compact
      icon="flask-conical"
      title="MOCK: 예시 스냅샷입니다. 편집·삭제는 메모리에만 반영되고 API를 재시작하면 처음으로 돌아갑니다."
    />
  );
}

/** 쓰기 불가 Banner (디자인 3.5): neutral + lock, 닫을 수 없음. 장애가 아니다. */
export function WriteBlockBanner({ writable }: { writable: WriteAbility | null | undefined }) {
  const b = writeBlockBanner(writable);
  if (!b) return null;
  return <Banner tone="neutral" icon="lock" title={b.title} description={b.description} />;
}

/** 출처를 쓸 수 없음: 설정 없음·폴더 없음·읽기 실패 (디자인 3.7). 예시 스냅샷을 보이지 않는다. */
export function SourceUnknown({ summary }: { summary: SnapshotSummary }) {
  const v = sourceUnknownView(summary);
  if (!v) return null;
  const setup = summary.root.setup;
  const notConfigured = summary.root.state === "not_configured";
  const detail = v.detail && v.detail !== v.reason ? <p className="text-mono">{v.detail}</p> : null;
  const hint = notConfigured ? (
    <div className="stack-sm" style={{ maxWidth: 560, textAlign: "left" }}>
      {detail}
      <p>① docker compose: api 서비스에 ./deploy/aws-snapshot/snapshots 폴더를 쓰기 가능하게 마운트하고 경로 설정을 지정하세요.</p>
      {setup ? <CommandLine command={setup.dockerMount} copyLabel="마운트 설정 복사" fullWidth /> : null}
      <p>② Docker 없이 실행: 저장소의 deploy/aws-snapshot/snapshots 경로를 설정으로 지정하세요.</p>
      {setup ? <CommandLine command={setup.localExample} copyLabel="설정 예시 복사" fullWidth /> : null}
      <p>③ 클러스터 안에 배포한 대시보드에서는 이 기능을 쓰지 않습니다.</p>
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

/** 표 동작 열 아이콘 버튼. 비활성은 IconButton disabledReason(aria-disabled + 사유 툴팁, 포커스 유지, 디자인 3.5) */
export function RowActionButton({
  icon,
  label,
  disabledReason,
  onClick,
}: {
  icon: "tag" | "trash-2";
  label: string;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <IconButton
      icon={icon}
      size="sm"
      label={label}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabledReason) onClick();
      }}
      onKeyDown={(e) => {
        // 행 Enter(상세 이동)로 번지지 않게
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
    />
  );
}

interface ExitCodeRow {
  code: string;
  meaning: string;
  folder: string;
}

const EXIT_CODES: ExitCodeRow[] = [
  { code: "0", meaning: "성공, 비밀값 스캔 통과", folder: "남음" },
  { code: "1", meaning: "비밀값 의심 발견 → 커밋 금지, 정리 후 재스캔", folder: "남음(검토용)" },
  { code: "2", meaning: "설정 오류(리전 없음, 모르는 서비스, 잘못된 플래그 등)", folder: "안 만듦" },
  { code: "3", meaning: "former2 실패 또는 리소스 0개", folder: "지움" },
];

const EXIT_COLUMNS: Column<ExitCodeRow>[] = [
  { id: "code", header: "코드", width: 56, render: (r) => <span className="text-mono">{r.code}</span> },
  { id: "meaning", header: "뜻", minWidth: 200, render: (r) => r.meaning },
  { id: "folder", header: "스냅샷 폴더", width: 120, render: (r) => r.folder },
];

/**
 * 새 스냅샷 만들기 안내 (디자인 3.6, 명세 3.10, AC-51). 명령은 텍스트로만(실행 수단 없음).
 * scanId 가 있으면 재스캔 명령에 ID 를 채운다.
 */
export function CliGuide({ cli, scanId }: { cli: CliGuideText; scanId?: string }) {
  const scan = scanId ? cli.scan.replace("<id>", scanId) : cli.scan;
  return (
    <Card as="section" padding="lg" aria-label="새 스냅샷 만들기 안내">
      <div className="stack-lg">
        <p className="text-strong">새 스냅샷은 터미널에서 CLI로 만듭니다. 대시보드는 이 명령을 실행하지 않습니다.</p>
        <CommandSteps
          label="새 스냅샷 만들기 단계"
          steps={[
            { id: "install", title: "설치", command: cli.install },
            { id: "configure", title: "설정", text: <span>{cli.configure}</span> },
            { id: "dry", title: "미리 보기", command: cli.dryRun },
            { id: "export", title: "내보내기", command: cli.export },
            { id: "scan", title: "재스캔", command: scan },
          ]}
        />
        <div className="row row-start gap-6" style={{ flexWrap: "wrap" }}>
          <div className="grow" style={{ minWidth: 320, flexBasis: "56%" }}>
            <DataTable caption="CLI 종료코드" density="compact" columns={EXIT_COLUMNS} rows={EXIT_CODES} rowKey={(r) => r.code} />
          </div>
          <ul className="list-plain stack-sm grow text-caption" style={{ minWidth: 240, flexBasis: "36%" }}>
            <li className="row row-start gap-1-5">
              <Icon name="info" size={14} />
              <span>
                내보내기 전용 IAM 역할·프로필은 <span className="text-mono">{cli.readme}</span> 3장을 따르세요.
              </span>
            </li>
            <li className="row row-start gap-1-5">
              <Icon name="hand" size={14} />
              <span>대시보드에는 적용 기능이 없습니다. README 7장 절차(change set / plan 검토 후 사람이 실행)를 따르세요.</span>
            </li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

/** 스캔 규칙 도움말 (디자인 4.5 Drawer): 규칙 표는 서버(CLI 스캐너)에서 읽는다 */
export function ScanRulesHelp() {
  return <HelpPopover mode="drawer" label="규칙" title="스캔 규칙과 처리 방법" content={<ScanRulesBody />} />;
}

interface RuleRow {
  id: string;
  severity: string;
  description: string;
}

const RULE_COLUMNS: Column<RuleRow>[] = [
  { id: "id", header: "규칙", width: 150, render: (r) => <span className="text-mono">{r.id}</span> },
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

function ScanRulesBody() {
  const q = useApi<ScanRulesResponse>("/aws-snapshots/scan-rules");
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
            값을 지우고 CloudFormation은 <code>{"{{resolve:secretsmanager:…}}"}</code> 동적 참조나 NoEcho 파라미터로, Terraform은{" "}
            <code>variable(sensitive = true)</code>이나 <code>data &quot;aws_secretsmanager_secret_version&quot;</code>으로 바꿉니다.
          </li>
          <li>
            검토 후 문제없는 줄은 같은 줄 끝에 <code># {q.data?.allowMarker ?? "snapshot-scan: allow"}</code> 주석을 답니다(YAML·HCL).
          </li>
          <li>JSON 파일은 주석을 달 수 없으므로 값을 지웁니다.</li>
          <li>이미 커밋·푸시했다면 값을 교체(rotate)해야 합니다.</li>
        </ol>
      </div>
      <p className="text-caption row row-start gap-1-5">
        <Icon name="info" size={14} />
        스캐너는 모든 비밀값을 잡는다는 보장이 없습니다. 커밋 전 diff를 직접 확인하세요.
      </p>
    </div>
  );
}
