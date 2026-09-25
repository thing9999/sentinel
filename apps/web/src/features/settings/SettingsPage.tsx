"use client";

/**
 * 설정 `/settings` — 이번 범위는 **알림 탭 하나**(docs/design/settings.md, 계약 docs/api/alerts.md 2.5~2.7).
 *
 * 이 화면이 지키는 것:
 * - **웹훅 원문을 다시 그리지 않는다.** 서버는 `hint`(끝 4자)·`length`만 주고, 화면에서 원문이 사는 곳은 입력 중인
 *   `useState` 하나뿐이다. 저장에 성공하면 **그 자리에서** 비우고 입력칸도 사라진다(AC-ALERT20).
 * - `PATCH /api/alerts/settings` 성공 응답이 **전체 설정**이므로 다시 GET 하지 않는다(backend 요청 ①).
 * - `lockedByEnv`(필드 이름)와 `lockedByEnvDetail[].envVar`(환경 변수 이름)는 용도가 다르다 —
 *   `SecretInput.lockedByEnv`에는 **환경 변수 이름**을 넣는다(backend 요청 ④).
 * - 리소스 이름 안내는 **테스트 발송 버튼 바로 위**, 닫기·접기 없음. 확인 대화상자 안에는 넣지 않는다(디자인 3.5).
 * - 테스트 발송은 **대화상자를 거쳐서만** `POST {confirm: true}`를 부른다. 쿨다운은 서버 `retryAfterSec`을 쓴다(계약 2.7).
 * - `skipped_*`는 오류가 아니다 — 빨간색·배너·토스트를 쓰지 않는다(AC-ALERT19).
 * - Card 2·3은 **표시만** 한다. 억제·플래핑·워밍업 값은 화면에 두지 않는다(명세 3.4.2). 예산 편집 자리는 만들지 않는다(디자인 7절).
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import {
  Banner,
  Button,
  Card,
  Chip,
  CodeBlock,
  Dialog,
  ErrorState,
  Icon,
  InlineAlert,
  KeyValueList,
  MaskedValue,
  PageHeader,
  SecretInput,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  Switch,
  formatTime,
  statusFromApi,
} from "@/components/ui";
import { useNow } from "@/components/ui/hooks";
import { apiFetch, isApiError, type ApiError } from "@/lib/api";

import type { AlertNotice } from "../alerts/types";
import { useMediaQuery } from "../common/hooks";
import {
  TEXT,
  cooldownText,
  dispatchModeText,
  isDbDown,
  lastDispatchText,
  lockOf,
  minSeverityCaption,
  mockDispatchLine,
  readApiError,
  testBlockReason,
} from "./model";
import styles from "./settings.module.css";
import type {
  AlertSettingsPatch,
  AlertSettingsResponse,
  MinSeverity,
  TestPreviewResponse,
  TestSendResponse,
} from "./types";

/** 저장 표시(`저장됨 14:02`)가 떠 있는 시간 (디자인 2.1) */
const SAVED_VISIBLE_MS = 1500;
/** 테스트 발송 성공 안내가 떠 있는 시간 (디자인 4.4) */
const SENT_VISIBLE_MS = 8000;
/** 서버가 쿨다운 초를 주지 않았을 때만 쓰는 값(계약 2.7.2의 60초). 서버 값이 있으면 언제나 그쪽이다 */
const FALLBACK_COOLDOWN_SEC = 60;

/** 화면이 자리를 따로 둔 안내 코드. 나머지(앞으로 생길 코드 포함)는 Card 1 위에 서버 문구 그대로 그린다 */
const PLACED_NOTICES = new Set([
  "ALERTS_TARGET_NAMES_PLAIN", // 3.5 리소스 이름 안내(테스트 발송 바로 위, 디자인 문구)
  "ALERTS_DISCORD_NOT_CONFIGURED", // 웹훅 칸 아래 회색 한 줄(AC-ALERT19)
  "ALERTS_DISPATCH_MOCK", // `발송 모드` 줄(디자인 5절)
  "ALERTS_HISTORY_MEMORY_ONLY", // 대시보드 DB 없음 배너 + Card 3
  "ALERTS_DISCORD_CIRCUIT_OPEN", // 테스트 발송 줄 아래(디자인 3.6)
  "ALERTS_DISCORD_DISABLED", // 스위치 설명이 같은 말을 한다
  "ALERTS_WARMUP_ACTIVE", // 알림 센터의 안내다(설정과 무관)
  "ALERTS_REPEAT_NOT_IMPLEMENTED", // 재알림 값은 화면에 두지 않는다(명세 3.4.2)
]);

// ---------------------------------------------------------------------------
// 조회 — 한 번 읽고, PATCH 응답으로 바꿔 끼운다

function useAlertSettings() {
  const [data, setData] = useState<AlertSettingsResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    apiFetch<AlertSettingsResponse>("/alerts/settings", { signal: ac.signal })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (isApiError(e) && e.kind === "aborted") return;
        setError(isApiError(e) ? e : null);
      });
    return () => ac.abort();
  }, [nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, reload, replace: setData };
}

// ---------------------------------------------------------------------------

export function SettingsPage() {
  const settings = useAlertSettings();
  const data = settings.data;

  return (
    <>
      <PageHeader title="설정" subtitle="대시보드 자체 설정입니다. 클러스터·AWS 설정을 바꾸지 않습니다." />
      {/* 탭 줄은 그리지 않는다 — 탭이 1개뿐이면 "다른 탭이 어디 있지"를 묻게 된다(디자인 7절, AC-ALERT34) */}
      <div className={styles.form}>
        {!data && settings.error ? (
          <ErrorState size="sm" title="알림 설정을 불러오지 못했습니다" onRetry={settings.reload} />
        ) : !data ? (
          <div className={styles.form} aria-busy="true">
            <span className="sr-only">알림 설정을 불러오는 중</span>
            {[320, 280, 160].map((h) => (
              <Card key={h} padding="lg">
                <Skeleton height={h - 40} radius="md" />
              </Card>
            ))}
          </div>
        ) : (
          <>
            {isDbDown(data) ? <Banner tone="warn" title={TEXT.dbDownBanner} /> : null}
            <DiscordCard settings={data} onReplace={settings.replace} onReload={settings.reload} />
            <TargetsCard settings={data} />
            <HistoryCard settings={data} />
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Card 1 · 디스코드 알림

type Field = "enabled" | "minSeverity" | "sendUnknown" | "webhook";

interface FieldMessage {
  field: Field;
  tone: "crit" | "warn";
  text: string;
}

type TestResult =
  | { kind: "sent"; id: number; at: string }
  | { kind: "mock"; id: number; message: string }
  | { kind: "skipped"; id: number; label: string };

interface TestDialogState {
  open: boolean;
  preview: TestPreviewResponse | null;
  previewError: string | null;
  sending: boolean;
  error: { tone: "crit" | "warn"; text: string } | null;
}

const DIALOG_CLOSED: TestDialogState = { open: false, preview: null, previewError: null, sending: false, error: null };

function DiscordCard({
  settings,
  onReplace,
  onReload,
}: {
  settings: AlertSettingsResponse;
  onReplace: (next: AlertSettingsResponse) => void;
  onReload: () => void;
}) {
  const titleId = useId();
  // 스위치 설명의 id — `Switch`의 `aria-describedby`로 잇는다(디자인 9절 "설명이 동작의 절반이다", publisher 07:15)
  const enabledDescId = useId();
  const unknownDescId = useId();
  const discord = settings.discord;
  const dbDown = isDbDown(settings);
  const webhookLock = lockOf(settings, "webhookUrl");
  const dispatchLock = lockOf(settings, "dispatchMode");
  const narrow = useMediaQuery("(max-width: 1023px)", false);

  // 저장 중인 항목과 그 값(저장 중에는 화면이 이 값을 보여 주고, 실패하면 서버 값으로 되돌아간다 — 디자인 2.1)
  const [pending, setPending] = useState<{ field: Field; value?: boolean | MinSeverity } | null>(null);
  const [fieldMessage, setFieldMessage] = useState<FieldMessage | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /** 스크린리더 알림(저장·쿨다운 시작/끝). 1초마다 읽지 않는다(디자인 4.4) */
  const [announce, setAnnounce] = useState("");
  /** **웹훅 원문이 사는 유일한 곳.** URL·저장소·전역 상태에 두지 않는다 */
  const [webhook, setWebhook] = useState<{ mode: "idle" | "editing"; value: string; error: string | null }>({
    mode: "idle",
    value: "",
    error: null,
  });
  const [clearOpen, setClearOpen] = useState(false);
  const [dialog, setDialog] = useState<TestDialogState>(DIALOG_CLOSED);
  const [cooldown, setCooldown] = useState<{ until: number; total: number } | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [resultOpen, setResultOpen] = useState(true);

  const timers = useRef<{ saved?: number; cooldown?: number; result?: number }>({});
  const previewSeq = useRef(0);
  const resultSeq = useRef(0);
  useEffect(() => {
    const t = timers.current;
    return () => {
      window.clearTimeout(t.saved);
      window.clearTimeout(t.cooldown);
      window.clearTimeout(t.result);
    };
  }, []);

  const markSaved = (at: string) => {
    setSavedAt(at);
    setAnnounce("저장됐습니다");
    window.clearTimeout(timers.current.saved);
    timers.current.saved = window.setTimeout(() => setSavedAt(null), SAVED_VISIBLE_MS);
  };

  /** 쿨다운은 **서버가 준 초**로 맞춘다(화면 타이머보다 서버 값이 우선, 디자인 4.4) */
  const startCooldown = (sec: number | null | undefined) => {
    const s = typeof sec === "number" && sec > 0 ? sec : FALLBACK_COOLDOWN_SEC;
    setCooldown({ until: Date.now() + s * 1000, total: s });
    setAnnounce(`${Math.ceil(s)}초 뒤에 다시 보낼 수 있습니다`);
    window.clearTimeout(timers.current.cooldown);
    timers.current.cooldown = window.setTimeout(() => {
      setCooldown(null);
      setAnnounce("다시 보낼 수 있습니다");
    }, s * 1000);
  };

  /** 부분 저장. 성공 응답(전체 설정)으로 화면을 바꿔 끼운다 — **다시 GET 하지 않는다** */
  const save = async (field: Field, body: AlertSettingsPatch, value?: boolean | MinSeverity): Promise<boolean> => {
    setPending({ field, value });
    setFieldMessage(null);
    try {
      const next = await apiFetch<AlertSettingsResponse>("/alerts/settings", { method: "PATCH", body });
      onReplace(next);
      markSaved(next.generatedAt);
      return true;
    } catch (e) {
      const err = readApiError(e);
      if (err.code === "VALIDATION_FAILED" && field === "webhook") {
        // 서버 사유 한 줄. **입력값 원문은 응답에 없고 화면도 되비추지 않는다**(AC-ALERT21)
        setWebhook((w) => ({ ...w, error: err.message ?? "웹훅 주소 형식이 올바르지 않습니다." }));
      } else if (err.code === "SETTING_LOCKED_BY_ENV") {
        // 다른 곳에서 잠금이 생겼다: 사유를 보이고 화면을 새로 읽어 잠금 상태로 바꾼다(디자인 5절, AC-ALERT22)
        setFieldMessage({ field, tone: "warn", text: err.message ?? "환경 변수로 고정돼 있어 화면에서 바꿀 수 없습니다." });
        setWebhook({ mode: "idle", value: "", error: null });
        onReload();
      } else {
        setFieldMessage({
          field,
          tone: "crit",
          text: err.message ?? "설정을 저장하지 못했습니다. 잠시 후 다시 시도하세요.",
        });
        if (err.code === "DASHBOARD_DB_UNAVAILABLE") onReload();
      }
      return false;
    } finally {
      setPending(null);
    }
  };

  const saveWebhook = async () => {
    const ok = await save("webhook", { discord: { webhookUrl: webhook.value.trim() } });
    // 저장 성공 **즉시** 원문을 버린다. 입력칸도 사라지고 서버 힌트(`…****7f3a`)만 남는다
    if (ok) setWebhook({ mode: "idle", value: "", error: null });
  };

  const clearWebhook = async () => {
    await save("webhook", { discord: { webhookUrl: null } });
    setClearOpen(false);
  };

  // ---- 테스트 발송 ----------------------------------------------------------

  const openTest = () => {
    const seq = ++previewSeq.current;
    setDialog({ ...DIALOG_CLOSED, open: true });
    // 미리보기는 **부작용이 없다**(계약 2.7.1). 대화상자가 보낼 본문 전문을 그대로 보여 준다
    apiFetch<TestPreviewResponse>("/alerts/test/preview")
      .then((p) => {
        if (seq !== previewSeq.current) return;
        setDialog((d) => (d.open ? { ...d, preview: p } : d));
        if (p.cooldown.active) startCooldown(p.cooldown.retryAfterSec);
      })
      .catch(() => {
        if (seq !== previewSeq.current) return;
        setDialog((d) => (d.open ? { ...d, previewError: "보낼 본문을 불러오지 못했습니다. 닫고 다시 시도하세요." } : d));
      });
  };

  const closeTest = () => {
    // 전송 중에는 `Dialog.cancelDisabled`가 버튼·Esc·바깥 클릭을 모두 막는다(디자인 4.3, publisher 07:15)
    previewSeq.current += 1;
    setDialog(DIALOG_CLOSED);
  };

  const showResult = (r: TestResult) => {
    setResult(r);
    setResultOpen(true);
    window.clearTimeout(timers.current.result);
    if (r.kind === "sent") {
      timers.current.result = window.setTimeout(
        () => setResult((cur) => (cur?.id === r.id ? null : cur)),
        SENT_VISIBLE_MS,
      );
    }
  };

  const sendTest = async () => {
    setDialog((d) => ({ ...d, sending: true, error: null }));
    try {
      const res = await apiFetch<TestSendResponse>("/alerts/test", { method: "POST", body: { confirm: true } });
      // 성공·실패·mock 어느 결과든 서버 쿨다운이 시작된다(계약 2.7.2)
      startCooldown(res.cooldown.retryAfterSec);
      const id = ++resultSeq.current;
      if (res.result.state === "failed") {
        // 실패는 **대화상자를 닫지 않고** 맨 위에 가림 처리된 서버 사유 한 줄(디자인 4.4)
        const why = res.result.detail ?? (res.result.responseCode !== null ? `응답 ${res.result.responseCode}` : null);
        setDialog((d) => ({
          ...d,
          sending: false,
          error: { tone: "crit", text: why ? `${res.result.label} — ${why}` : res.result.label },
        }));
      } else {
        previewSeq.current += 1;
        setDialog(DIALOG_CLOSED);
        if (res.result.state === "sent") showResult({ kind: "sent", id, at: res.result.at });
        else if (res.result.state === "skipped_mock") showResult({ kind: "mock", id, message: res.message });
        else showResult({ kind: "skipped", id, label: res.result.label });
      }
      // `마지막 발송` 줄은 서버 값이다. PATCH 가 아니라서 응답에 설정이 없으므로 한 번 다시 읽는다
      onReload();
    } catch (e) {
      const err = readApiError(e);
      if (err.code === "ALERT_TEST_COOLDOWN") {
        startCooldown(err.retryAfterSec);
        setDialog((d) => ({ ...d, sending: false, error: { tone: "warn", text: err.message ?? cooldownText(err.retryAfterSec ?? FALLBACK_COOLDOWN_SEC) } }));
      } else if (err.code === "ALERT_WEBHOOK_NOT_CONFIGURED" || err.code === "ALERT_DISPATCH_DISABLED") {
        setDialog((d) => ({ ...d, sending: false, error: { tone: "warn", text: err.message ?? TEXT.disabled } }));
        onReload();
      } else {
        setDialog((d) => ({
          ...d,
          sending: false,
          error: { tone: "crit", text: err.message ?? "테스트 발송 요청이 실패했습니다. 아무것도 보내지 않았을 수 있습니다." },
        }));
      }
    }
  };

  // ---- 그리기 ----------------------------------------------------------------

  const enabled = pending?.field === "enabled" ? Boolean(pending.value) : discord.enabled;
  const minSeverity = pending?.field === "minSeverity" ? (pending.value as MinSeverity) : discord.minSeverity;
  const sendUnknown = pending?.field === "sendUnknown" ? Boolean(pending.value) : discord.sendUnknown;
  const saving = pending !== null;
  const editReason = dbDown ? TEXT.dbDown : undefined;
  const otherNotices = settings.notices.filter((n) => !PLACED_NOTICES.has(n.code));
  const notConfigured = settings.notices.find((n) => n.code === "ALERTS_DISCORD_NOT_CONFIGURED");
  const messageFor = (f: Field) =>
    fieldMessage?.field === f ? <InlineAlert tone={fieldMessage.tone} compact title={fieldMessage.text} /> : null;

  return (
    <Card as="section" padding="lg" aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <h3 id={titleId} className={styles.cardTitle}>
          디스코드 알림
        </h3>
        {savedAt ? <span className={styles.saved}>{`저장됨 ${formatTime(savedAt, "shortTime")}`}</span> : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <div className={styles.cardBody}>
        {otherNotices.map((n) => (
          <NoticeLine key={n.code} notice={n} />
        ))}

        {/* 디스코드로 보내기 — 끄면 발송만 멈추고 화면 알림 센터는 계속 쌓인다(AC-ALERT29) */}
        <div>
          <Switch
            label="디스코드로 보내기"
            aria-describedby={enabledDescId}
            checked={enabled}
            disabled={dbDown || saving}
            disabledReason={editReason}
            onChange={(v) => void save("enabled", { discord: { enabled: v } }, v)}
          />
          <p id={enabledDescId} className={styles.switchDesc}>
            끄면 디스코드로 보내지 않습니다. 화면 알림 센터에는 계속 쌓입니다.
          </p>
          {messageFor("enabled")}
        </div>

        <hr className={styles.divider} />

        {/* 웹훅 주소 — 원문은 서버가 주지 않는다. `다시 보기`·눈 아이콘 없음(디자인 3.2) */}
        <div className="stack-sm">
            <SecretInput
              label="웹훅 주소"
              configured={discord.configured}
              hint={discord.hint ?? undefined}
              length={discord.length ?? undefined}
              updatedAt={discord.updatedAt ?? undefined}
              // **환경 변수 이름**을 넘긴다(필드 이름 `webhookUrl`이 아니다 — 계약 2.5)
              lockedByEnv={webhookLock?.envVar}
              mode={pending?.field === "webhook" ? "saving" : webhook.mode}
              value={webhook.value}
              onChange={(v) => setWebhook((w) => ({ ...w, value: v, error: null }))}
              placeholder="https://discord.com/api/webhooks/…"
              error={webhook.error ?? undefined}
              inputHint="디스코드 채널 설정 → 연동 → 웹훅에서 주소를 복사하세요. 저장 후에는 다시 볼 수 없습니다."
              onSave={() => void saveWebhook()}
              onEdit={() =>
                setWebhook((w) =>
                  w.mode === "editing" ? { mode: "idle", value: "", error: null } : { mode: "editing", value: "", error: null },
                )
              }
              onClear={() => setClearOpen(true)}
              // 대시보드 DB 없음: 저장·바꾸기·지우기를 막고 사유를 준다(포커스 유지). 잠김(`.env`)과는 모양이 다르다(publisher 07:15)
              disabled={dbDown && !webhookLock}
              disabledReason={dbDown ? TEXT.dbDown : undefined}
            />
          {messageFor("webhook")}
          {!discord.configured && notConfigured ? (
            // 미설정은 오류가 아니다 — 회색 정보 한 줄(AC-ALERT19)
            <InlineAlert tone="neutral" compact title={notConfigured.text} />
          ) : null}
        </div>

        <hr className={styles.divider} />

        {/* 보낼 심각도 — `확인 불가`는 이 줄에 없다(별도 축, 디자인 3.3) */}
        <div className="stack-sm">
          <span className={styles.fieldLabel}>보낼 심각도</span>
          <SegmentedControl<MinSeverity>
            label="보낼 심각도"
            value={minSeverity}
            className={narrow ? styles.fullWidth : styles.segAuto}
            onChange={(v) => void save("minSeverity", { discord: { minSeverity: v } }, v)}
            options={[
              { value: "critical", label: "장애만", disabled: saving, disabledReason: editReason },
              { value: "warning", label: "주의부터", disabled: saving, disabledReason: editReason },
            ]}
          />
          <p className="text-caption">{minSeverityCaption(minSeverity)}</p>
          {messageFor("minSeverity")}
        </div>

        <div>
          <Switch
            label="확인 불가(연결 끊김)도 보내기"
            aria-describedby={unknownDescId}
            checked={sendUnknown}
            disabled={dbDown || saving}
            disabledReason={editReason}
            onChange={(v) => void save("sendUnknown", { discord: { sendUnknown: v } }, v)}
          />
          <p id={unknownDescId} className={styles.switchDesc}>
            5분 이상 지속될 때만 보냅니다. 클러스터가 통째로 보이지 않는 상황을 놓치지 않기 위한 항목입니다.
          </p>
          {messageFor("sendUnknown")}
        </div>

        <hr className={styles.divider} />

        {/*
         * 무엇이 채널로 나가는가 — **테스트 발송 버튼 바로 위**, 닫기·접기 없음(디자인 3.5).
         * 입력칸 밑에 두면 주소를 붙여 넣을 때는 읽지만 테스트를 누르는 순간에는 화면 위로 밀려 안 보인다.
         * 확인 대화상자에는 넣지 않는다 — 테스트 본문에는 리소스 이름이 없어 사실과 어긋난다.
         */}
        <InlineAlert
          tone="neutral"
          icon="info"
          title={
            <>
              {"알림 본문에는 클러스터 리소스 이름이 원문 그대로 들어갑니다 — 네임스페이스·워크로드·파드 이름과 노드 이름(EC2 인스턴스 ID "}
              <span className={styles.resourceName}>i-0abc…</span>
              {" 형태)."}
            </>
          }
          description="채널 공개 범위를 확인하세요."
        />

        <TestSendRow
          reasonFor={(sec) => testBlockReason(settings, sec)}
          cooldown={cooldown}
          last={lastDispatchText(discord.lastDispatch)}
          narrow={narrow}
          onClick={openTest}
        />

        {result ? (
          <TestResultLine result={result} open={resultOpen} onToggle={() => setResultOpen((v) => !v)} />
        ) : null}

        {discord.circuitBreaker.open ? (
          <InlineAlert
            tone="warn"
            compact
            title={`연속 실패 ${discord.circuitBreaker.consecutiveFailures.toLocaleString("en-US")}건으로 발송을 멈췄습니다.${
              discord.circuitBreaker.resumeAt ? ` ${formatTime(discord.circuitBreaker.resumeAt, "shortTime")}에 다시 시도합니다.` : ""
            }`}
          />
        ) : null}

        {/* 발송 모드 — 화면에서 바꿀 수 있는 값이 아니다. 스위치를 만들지 않는다(디자인 5절) */}
        <div className="stack-sm">
          <div className={styles.modeRow}>
            <span className={styles.fieldLabel}>발송 모드</span>
            <span className="text-caption">{dispatchModeText(settings)}</span>
            {settings.dispatch.outbound ? null : (
              <Chip tone="mock" size="sm" icon="flask-conical" label="실제로 보내지 않음" />
            )}
            {dispatchLock ? <Chip size="sm" icon="lock" label=".env로 고정됨" /> : null}
          </div>
          {dispatchLock ? <p className="text-caption">{dispatchLock.text}</p> : null}
        </div>
      </div>

      <Dialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        cancelDisabled={pending?.field === "webhook"}
        cancelDisabledReason="지우는 중에는 닫을 수 없습니다."
        title="웹훅 주소를 지웁니다"
        description="지우면 디스코드로 알림이 가지 않습니다. 화면 알림 센터에는 계속 쌓입니다. 주소는 다시 입력해야 합니다."
        tone="danger"
        size="sm"
        initialFocus="cancel"
        cancelLabel="취소"
        confirmLabel="지우기"
        confirmLoading={pending?.field === "webhook"}
        onConfirm={() => void clearWebhook()}
      />

      <TestSendDialog
        state={dialog}
        settings={settings}
        cooldown={cooldown}
        narrow={narrow}
        onClose={closeTest}
        onConfirm={() => void sendTest()}
      />
    </Card>
  );
}

function NoticeLine({ notice }: { notice: AlertNotice }) {
  // 코드 → 문구 매핑을 두지 않는다. 서버 문구 그대로, 톤만 level 로 정한다(skipped·미설정은 오류가 아니다)
  const tone = notice.level === "warn" || notice.level === "error" ? "warn" : "neutral";
  return <InlineAlert tone={tone} compact title={notice.text} />;
}

/**
 * 테스트 발송 버튼 + 오른쪽 caption. 쿨다운 동안만 1초마다 다시 그린다(이 줄만 — 페이지 전체가 아니다).
 * 카운트다운 글자는 `aria-hidden`이다. 낭독은 시작·끝 한 번씩만(부모의 live 영역, 디자인 4.4).
 */
function TestSendRow({
  reasonFor,
  cooldown,
  last,
  narrow,
  onClick,
}: {
  reasonFor: (cooldownSec: number | null) => string | null;
  cooldown: { until: number; total: number } | null;
  last: { text: string; failed: boolean; none: boolean };
  narrow: boolean;
  onClick: () => void;
}) {
  const now = useNow(1000);
  const remain = cooldown ? Math.min(cooldown.total, Math.max(0, Math.ceil((cooldown.until - now) / 1000))) : null;
  const cooling = remain !== null && remain > 0;
  const reason = reasonFor(cooling ? remain : null);
  return (
    <div className={styles.testRow}>
      <Button
        variant="secondary"
        size="md"
        icon="send"
        fullWidth={narrow}
        disabled={reason !== null}
        disabledReason={reason ?? undefined}
        onClick={onClick}
      >
        테스트 발송
      </Button>
      {cooling ? (
        <span className={styles.testMeta} aria-hidden="true">
          {cooldownText(remain).replace(/\.$/, "")}
        </span>
      ) : (
        <span className={last.failed ? styles.testMetaFailed : last.none ? styles.testMetaNone : styles.testMeta}>
          {last.failed ? <Icon name="octagon-x" size={12} /> : null}
          {last.text}
        </span>
      )}
    </div>
  );
}

/** 테스트 발송 결과 (디자인 4.4). mock·제외는 **오류가 아니다** — 빨간색을 쓰지 않는다 */
function TestResultLine({ result, open, onToggle }: { result: TestResult; open: boolean; onToggle: () => void }) {
  if (result.kind === "sent") {
    return (
      <InlineAlert
        tone="info"
        compact
        live
        title={`테스트 메시지를 보냈습니다 ${formatTime(result.at, "time")} — 채널을 확인하세요.`}
      />
    );
  }
  if (result.kind === "skipped") {
    return <InlineAlert tone="neutral" compact live title={result.label} />;
  }
  return (
    <div className="stack-sm">
      <InlineAlert
        tone="neutral"
        compact
        live
        icon="flask-conical"
        title="실제로 보내지 않았습니다 (mock)"
        action={
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={onToggle}>
            {open ? "본문 접기" : "본문 보기"}
          </Button>
        }
      />
      {open ? <CodeBlock code={result.message} language="메시지" wrap maxHeight={200} /> : null}
    </div>
  );
}

/**
 * 테스트 발송 확인 대화상자 (디자인 4.3). 되돌릴 수 없는 외부 동작이라 **본문 전문을 읽게** 만든다.
 * 입력 확인(`TypeToConfirmDialog`)은 쓰지 않는다(components.md 21.7). 기본 포커스는 `취소`.
 */
function TestSendDialog({
  state,
  settings,
  cooldown,
  narrow,
  onClose,
  onConfirm,
}: {
  state: TestDialogState;
  settings: AlertSettingsResponse;
  cooldown: { until: number; total: number } | null;
  narrow: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const preview = state.preview;
  // 실패·429 뒤 `보내기`는 **서버 쿨다운 동안** 비활성이고 남은 초를 1초마다 적는다(디자인 4.4)
  const now = useNow(cooldown ? 1000 : 0);
  const remain = cooldown ? Math.min(cooldown.total, Math.max(0, Math.ceil((cooldown.until - now) / 1000))) : 0;
  const blocked: string | undefined = !preview
    ? state.previewError
      ? "보낼 본문을 확인할 수 없어 보내지 않습니다."
      : "보낼 본문을 불러오는 중입니다."
    : cooldown && remain > 0
      ? cooldownText(remain)
      : preview.canSend || cooldown
        ? undefined
        : (preview.blocked?.text ?? "지금은 보낼 수 없습니다.");
  const mock = preview ? !preview.dispatch.outbound : !settings.dispatch.outbound;
  return (
    <Dialog
      open={state.open}
      onClose={onClose}
      title="디스코드로 테스트 메시지를 보냅니다"
      tone="danger"
      size="md"
      initialFocus="cancel"
      cancelLabel="취소"
      confirmLabel="보내기"
      confirmLoading={state.sending}
      cancelDisabled={state.sending}
      cancelDisabledReason="보내는 중에는 닫을 수 없습니다."
      confirmDisabled={blocked !== undefined}
      confirmDisabledReason={blocked}
      onConfirm={onConfirm}
    >
      <div className="stack">
        {state.error ? <InlineAlert tone={state.error.tone} live title={state.error.text} /> : null}
        {mock ? (
          <div className="stack-sm">
            <span>
              <Chip tone="mock" icon="flask-conical" label="실제로 보내지 않음" />
            </span>
            <p className="text-caption">{mockDispatchLine(settings)}</p>
          </div>
        ) : null}
        <p className={styles.dangerLine}>
          <Icon name="octagon-alert" size={16} />
          <span>{preview?.warning ?? "채널에 실제 메시지가 즉시 전송됩니다. 되돌릴 수 없습니다."}</span>
        </p>
        <KeyValueList
          labelWidth={72}
          items={[
            {
              label: "대상",
              value: <MaskedValue text={preview?.target.hint ?? settings.discord.hint ?? "저장된 주소"} />,
            },
          ]}
        />
        <div className="stack-sm">
          <span className={styles.fieldLabel}>보낼 내용</span>
          {preview ? (
            // 서버가 준 문자열 그대로(화면이 조립하지 않는다, 계약 2.7.1)
            <CodeBlock code={preview.message} language="메시지" wrap maxHeight={narrow ? 160 : 200} />
          ) : state.previewError ? (
            <InlineAlert tone="warn" compact title={state.previewError} />
          ) : (
            <Skeleton lines={4} />
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Card 2 · 알림 대상 (표시만) / Card 3 · 화면 알림과 이력 (표시만)

/**
 * Card 2 — 현재 상태는 **서버 `keys[].status` 하나**에서 읽는다(디자인 6.1, PM 결정 2). 알림 엔진이 판정에 쓰는 바로 그 값이다.
 * 통합 2차에는 계약에 이 값이 없어 개요 스트림에서 짜 맞췄는데, 판단 기준이 두 곳이 되고 `쿠버네티스 연결`을
 * 화면이 낱말로 바꿔야 했다 — 계약 추가 뒤 지웠다. `null`(엔진이 아직 평가 전)이면 `—`만 둔다.
 */
function TargetsCard({ settings }: { settings: AlertSettingsResponse }) {
  const titleId = useId();
  const items = settings.keys.map((k) => ({
    label: k.label,
    value: keyValue(k.status ?? null, k.statusSince ?? null),
  }));
  return (
    <Card as="section" padding="lg" aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <h3 id={titleId} className={styles.cardTitle}>
          알림 대상
        </h3>
      </div>
      <div className={styles.cardBody}>
        <p className="text-caption">상태가 바뀔 때 알림이 만들어지는 대상입니다.</p>
        <KeyValueList columns={2} items={items} />
        {/* "아직"·"곧"을 쓰지 않는다 — 약속하지 않는다(AC-ALERT34의 태도) */}
        <p className="text-caption-tertiary">대상별로 켜고 끄는 기능은 제공하지 않습니다.</p>
      </div>
    </Card>
  );
}

function keyValue(status: string | null, since: string | null): ReactNode {
  if (!status) {
    return (
      <span className="text-caption-tertiary" aria-label="아직 판정 전">
        —
      </span>
    );
  }
  return (
    <StatusBadge
      size="sm"
      status={statusFromApi(status)}
      reason={since ? `${formatTime(since, "auto")}부터` : undefined}
    />
  );
}

function HistoryCard({ settings }: { settings: AlertSettingsResponse }) {
  const titleId = useId();
  const r = settings.retention;
  return (
    <Card as="section" padding="lg" aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <h3 id={titleId} className={styles.cardTitle}>
          화면 알림과 이력
        </h3>
      </div>
      <KeyValueList
        items={[
          { label: "화면 알림", value: "항상 켜짐 · 끌 수 없습니다" },
          {
            label: "이력 보관",
            value: `${r.days.toLocaleString("en-US")}일 또는 ${r.maxRows.toLocaleString("en-US")}건 · 해제되지 않은 알림은 지우지 않습니다`,
          },
          {
            label: "대시보드 DB",
            // warn 색이 아니다(디자인 6.2) — 사실만 적는다
            value: isDbDown(settings) ? "없음 — 최근 200건만 메모리에 있습니다" : "연결됨",
          },
        ]}
      />
    </Card>
  );
}
