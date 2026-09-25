-- 20260924180000_alerts
-- alerts 기능 (docs/specs/alerts.md 3.7 A~E). 설계·근거: docs/db/schema.md 2.8~2.12
-- 되돌리기: docs/db/migrations/20260924180000_alerts.down.sql
--
-- 이 마이그레이션은 **추가만 한다**. 기존 테이블·열·행을 하나도 건드리지 않는다.
--   - settings 행을 건드리지 않는다(값 덮어쓰기 없음). 새 key(alerts, alerts.discord)는 시드가 넣고,
--     시드를 안 돌려도 mergeSetting()이 코드 기본값으로 채우므로 동작에 구멍이 없다.
--   - cost_rate_samples / advisor_* / price_cache 는 읽지도 쓰지도 않는다.
-- 그래서 실패해도 기존 데이터가 손상되지 않고, down은 새로 만든 것만 지운다.

-- CreateEnum
CREATE TYPE "alert_severity" AS ENUM ('critical', 'warning', 'unknown', 'resolved');

-- CreateEnum
CREATE TYPE "alert_kind" AS ENUM ('transition', 'escalation', 'resolve', 'flapping', 'restart_summary', 'test');

-- CreateEnum
CREATE TYPE "alert_state_value" AS ENUM ('ok', 'warning', 'critical', 'unknown');

-- CreateEnum
CREATE TYPE "alert_channel" AS ENUM ('ui', 'discord');

-- CreateEnum
CREATE TYPE "alert_delivery_status" AS ENUM ('pending', 'sent', 'failed', 'skipped_disabled', 'skipped_not_configured', 'skipped_severity', 'skipped_unknown_off', 'skipped_mock', 'skipped_restart', 'skipped_flapping');

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "data_source" "data_source_mode" NOT NULL,
    "alert_key" VARCHAR(320) NOT NULL,
    "kind" "alert_kind" NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "from_status" "alert_state_value",
    "to_status" "alert_state_value",
    "reason_code" VARCHAR(100),
    "reason_text" VARCHAR(500),
    "targets" JSONB NOT NULL DEFAULT '[]',
    "target_count" INTEGER NOT NULL DEFAULT 0,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "last_event_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "parent_alert_id" UUID,
    "repeat_count" INTEGER NOT NULL DEFAULT 1,
    "flapping" BOOLEAN NOT NULL DEFAULT false,
    "suppressed_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acknowledged_at" TIMESTAMPTZ(3),
    "context" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_deliveries" (
    "id" BIGSERIAL NOT NULL,
    "alert_id" UUID NOT NULL,
    "channel" "alert_channel" NOT NULL,
    "status" "alert_delivery_status" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(3),
    "next_attempt_at" TIMESTAMPTZ(3),
    "response_code" INTEGER,
    "error_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alert_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_key_states" (
    "data_source" "data_source_mode" NOT NULL,
    "alert_key" VARCHAR(320) NOT NULL,
    "status" "alert_state_value" NOT NULL,
    "status_since" TIMESTAMPTZ(3) NOT NULL,
    "open_alert_id" UUID,
    "dedupe_started_at" TIMESTAMPTZ(3),
    "dedupe_count" INTEGER NOT NULL DEFAULT 0,
    "recent_transitions" JSONB NOT NULL DEFAULT '[]',
    "flapping" BOOLEAN NOT NULL DEFAULT false,
    "flapping_since" TIMESTAMPTZ(3),
    "unknown_since" TIMESTAMPTZ(3),
    "suppressed_by" VARCHAR(320),
    "last_notified_targets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alert_key_states_pkey" PRIMARY KEY ("data_source","alert_key")
);

-- CreateTable
CREATE TABLE "dashboard_heartbeats" (
    "scope" VARCHAR(32) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "data_source" "data_source_mode" NOT NULL,

    CONSTRAINT "dashboard_heartbeats_pkey" PRIMARY KEY ("scope")
);

-- CreateIndex
-- 목록 최신순·기간 필터·보관 정리(90일 범위 삭제, 2,000건 오프셋)
CREATE INDEX "alerts_data_source_occurred_at_idx" ON "alerts"("data_source", "occurred_at" DESC);

-- CreateIndex
-- 배지(안 읽은 개수·최악 심각도). 화면을 열 때마다 도는 질의라 가장 중요하다.
-- acknowledged_at IS NULL 구간만 읽으므로 이력이 2,000건이어도 스캔 대상은 "안 읽은 몇 건"뿐이고,
-- severity가 3번째 열이라 힙을 안 읽고(index only) 최악 심각도까지 구한다.
CREATE INDEX "alerts_data_source_acknowledged_at_severity_idx" ON "alerts"("data_source", "acknowledged_at", "severity");

-- CreateIndex
-- 키별 이력: 영역 필터, "최근 N분" 확인, 플래핑 타임라인 표시
CREATE INDEX "alerts_data_source_alert_key_occurred_at_idx" ON "alerts"("data_source", "alert_key", "occurred_at" DESC);

-- CreateIndex
-- 진행 중(closed_at IS NULL)만 보기
CREATE INDEX "alerts_data_source_closed_at_occurred_at_idx" ON "alerts"("data_source", "closed_at", "occurred_at" DESC);

-- CreateIndex
-- 해제↔발생 역참조. 이 인덱스가 없으면 보관 정리의 ON DELETE SET NULL이 매 행마다 alerts 전체를 훑는다.
CREATE INDEX "alerts_parent_alert_id_idx" ON "alerts"("parent_alert_id");

-- CreateIndex
-- 발송 큐: status='pending' AND next_attempt_at <= now()
CREATE INDEX "alert_deliveries_status_next_attempt_at_idx" ON "alert_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "alert_deliveries_alert_id_channel_key" ON "alert_deliveries"("alert_id", "channel");

-- CreateIndex
CREATE INDEX "alert_key_states_open_alert_id_idx" ON "alert_key_states"("open_alert_id");

-- AddForeignKey
-- 원본이 보관 정리로 사라져도 해제 알림 행은 남고 연결만 끊긴다(SET NULL). CASCADE가 아니다.
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_parent_alert_id_fkey" FOREIGN KEY ("parent_alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- 발송 기록은 알림 없이 의미가 없다 → CASCADE (보관 정리가 알림을 지우면 함께 사라진다)
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_key_states" ADD CONSTRAINT "alert_key_states_open_alert_id_fkey" FOREIGN KEY ("open_alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 저장 파라미터 (Prisma 스키마로 표현할 수 없어 여기서 지정한다. 모델 정의에 영향이 없어 drift가 생기지 않는다)
-- dashboard_heartbeats: 한 행을 60초마다 UPDATE한다. fillfactor를 낮춰 같은 페이지 안에서 HOT 갱신이
-- 일어나게 하면 인덱스 갱신·페이지 분할이 줄고 autovacuum 부담도 준다.
ALTER TABLE "dashboard_heartbeats" SET (fillfactor = 70);
-- alert_key_states: 키 8개짜리 작은 표이고 "값이 바뀐 키만" 갱신하지만, 같은 이유로 여유를 둔다.
ALTER TABLE "alert_key_states" SET (fillfactor = 85);
