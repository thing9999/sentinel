"use client";

/**
 * aws-snapshot-manager 표현 컴포넌트 미리보기 (/dev/ui). 고정 예시 데이터만 쓴다.
 */
import { useState } from "react";

import {
  Button,
  Card,
  CodeEditor,
  CommandSteps,
  DataTable,
  Dialog,
  IconButton,
  KeyValueList,
  ScanCounts,
  ScanFindingList,
  Section,
  StatusBadge,
  SummaryStrip,
  SummaryStripItem,
  Tabs,
  TextArea,
  TextField,
  TwoLineCell,
  TypeToConfirmDialog,
  type ScanFinding,
} from "../index";

const TF = Array.from({ length: 1284 }, (_, i) =>
  i === 211
    ? "  environment {"
    : i === 212
      ? "    variables = { DB_PASSWORD = \"S3****(15자)\" }"
      : `resource "aws_lambda_function" "fn_${i}" { function_name = "fn-${i}" }`,
).join("\n");

const FINDINGS: ScanFinding[] = [
  { id: "1", level: "error", file: "terraform.tf", line: 212, ruleId: "env-block", description: "환경 변수 블록을 여는 줄", navigable: true },
  { id: "2", level: "warn", file: "terraform.tf", line: 213, ruleId: "user-data", description: "UserData 안 값 S3****(15자)", navigable: true },
  {
    id: "3",
    level: "error",
    file: "metadata.json",
    line: 4,
    ruleId: "account-id",
    description: "계정 ID 원문",
    navigable: false,
    hint: "metadata.json은 대시보드에서 편집할 수 없습니다",
  },
];

export function SnapshotPreview() {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [value, setValue] = useState(TF);
  const [wrap, setWrap] = useState(false);
  const [target, setTarget] = useState<{ line: number; key: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState("EKS 1.30 업그레이드 전");
  const [memo, setMemo] = useState("");
  const [labelError, setLabelError] = useState<string | undefined>();
  const [trash, setTrash] = useState(false);
  const [labelDialog, setLabelDialog] = useState(false);
  const [tab, setTab] = useState("tf");

  return (
    <Section title="AWS 스냅샷 (aws-snapshot-manager)">
      <SummaryStrip
        label="스냅샷 요약"
        overall={{ status: "crit", reason: ["커밋 금지 2개 · 20260919-031500 비밀값 의심 2건"], label: "커밋 금지" }}
        updatedLabel="마지막 확인"
        updatedAt="2026-09-19T05:02:10.000Z"
        actions={<IconButton icon="refresh-cw" label="지금 다시 읽기" />}
      >
        <SummaryStripItem label="전체" value="24" />
        <SummaryStripItem label="커밋 금지" value="2" status="crit" />
        <SummaryStripItem label="주의" value="5" status="warn" />
        <SummaryStripItem label="알 수 없음" value="1" status="unknown" />
      </SummaryStrip>

      <DataTable
        caption="스냅샷 목록"
        density="comfortable"
        rows={[{ id: "20260919-031500" }, { id: "20260912-020000" }]}
        rowKey={(r) => r.id}
        rowStatus={(r) => (r.id.startsWith("20260919") ? "crit" : undefined)}
        columns={[
          {
            id: "status",
            header: "상태·사유",
            width: 208,
            render: (r) =>
              r.id.startsWith("20260919") ? (
                <TwoLineCell primary={<StatusBadge status="crit" label="커밋 금지" size="sm" />} secondary="비밀값 의심 2건 (env-block)" />
              ) : (
                <TwoLineCell primary={<StatusBadge status="ok" size="sm" />} />
              ),
          },
          { id: "snap", header: "스냅샷", minWidth: 184, render: () => <TwoLineCell primary="9월 19일 12:15" secondary="EKS 1.30 업그레이드 전" strong /> },
          {
            id: "scan",
            header: "현재 스캔",
            width: 104,
            render: (r) =>
              r.id.startsWith("20260919") ? <ScanCounts errors={2} warnings={1} layout="stacked" /> : <ScanCounts errors={0} warnings={0} />,
          },
        ]}
      />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: "var(--spacing-4)" }}>
        <Card as="section" aria-label="비밀값 스캔">
          <h3>비밀값 스캔</h3>
          <ScanCounts errors={2} warnings={1} size="md" />
          <ScanFindingList
            findings={FINDINGS}
            selectedId={selected}
            maxHeight={240}
            onSelect={(f) => {
              setSelected(f.id);
              setTarget((t) => ({ line: f.line, key: (t?.key ?? 0) + 1 }));
            }}
          />
        </Card>
        <Card padding="none">
          <Tabs
            idBase="snap-files"
            label="템플릿 파일"
            value={tab}
            onChange={setTab}
            items={[
              { id: "cfn", label: "cloudformation.yml", mono: true, status: "crit", count: 1, countLabel: "발견" },
              { id: "tf", label: "terraform.tf", mono: true, status: "crit", count: 1, countLabel: "발견", dirty: value !== TF },
              { id: "map", label: "logical-id-mapping.json", mono: true, suffix: "보기 전용" },
            ]}
          />
          <div style={{ display: "flex", gap: "var(--spacing-2)", padding: "var(--spacing-2) var(--spacing-4)" }}>
            <Button size="sm" icon="pencil" onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}>
              {mode === "edit" ? "편집 취소" : "편집"}
            </Button>
            <IconButton icon="wrap-text" label="줄 바꿈" size="sm" aria-pressed={wrap} onClick={() => setWrap((w) => !w)} />
          </div>
          <CodeEditor
            value={value}
            fileName="terraform.tf"
            mode={mode}
            onChange={setValue}
            wrap={wrap}
            height={420}
            targetLine={target?.line ?? null}
            targetKey={target?.key}
            markers={[
              { line: 212, level: "error", items: [{ ruleId: "env-block", description: "환경 변수 블록을 여는 줄" }] },
              { line: 213, level: "warn", items: [{ ruleId: "user-data", description: "UserData 안 값 S3****(15자)" }] },
            ]}
          />
        </Card>
      </div>

      <Card as="section" aria-label="새 스냅샷 만들기 안내">
        <CommandSteps
          steps={[
            { id: "i", title: "설치", command: "npm install --prefix deploy/aws-snapshot" },
            { id: "e", title: "설정", text: <>deploy/aws-snapshot/<code>.env.example</code>을 .env로 복사한 뒤 값을 채웁니다.</> },
            { id: "x", title: "내보내기", command: "npm run export --prefix deploy/aws-snapshot" },
          ]}
        />
      </Card>

      <KeyValueList
        columns={2}
        labelWidth={160}
        items={[
          { label: "리전", value: "ap-northeast-2", note: { tone: "warn", text: "폴더 이름과 다름" } },
          { label: "필터", value: "없음", note: { tone: "info", text: "필터 없음(선택한 서비스의 리전 내 전체)" } },
        ]}
      />

      <div style={{ display: "flex", gap: "var(--spacing-2)" }}>
        <Button icon="tag" onClick={() => setLabelDialog(true)}>
          라벨·메모 편집
        </Button>
        <Button variant="danger" icon="trash-2" onClick={() => setTrash(true)}>
          삭제
        </Button>
      </div>

      <Dialog
        open={labelDialog}
        onClose={() => setLabelDialog(false)}
        title="라벨·메모 편집"
        size="md"
        description="스냅샷 폴더 안 라벨·메모 파일에 저장합니다. git에 스냅샷과 함께 커밋될 수 있으니 비밀값을 적지 마세요."
        confirmLabel="저장"
        confirmDisabled={label === "EKS 1.30 업그레이드 전" && memo === ""}
        confirmDisabledReason="변경 없음"
        initialFocus="content"
        onConfirm={() => setLabelDialog(false)}
        cancelLabel="취소"
      >
        <TextField
          label="라벨"
          value={label}
          onChange={(v) => {
            setLabel(v);
            setLabelError(undefined);
          }}
          maxLength={60}
          showCount
          onOverflow={() => setLabelError("라벨은 60자까지 입력할 수 있습니다")}
          error={labelError}
          placeholder="예: EKS 1.30 업그레이드 전"
        />
        <TextArea label="메모" value={memo} onChange={setMemo} maxLength={2000} showCount />
      </Dialog>

      <TypeToConfirmDialog
        open={trash}
        onClose={() => setTrash(false)}
        title="스냅샷을 휴지통으로 옮길까요?"
        expected="20260915-101010"
        inputLabel={
          <>
            확인을 위해 스냅샷 ID <code>20260915-101010</code>을 입력하세요
          </>
        }
        confirmLabel="휴지통으로 이동"
        confirmLoadingLabel="옮기는 중"
        onConfirm={() => setTrash(false)}
      />
    </Section>
  );
}
