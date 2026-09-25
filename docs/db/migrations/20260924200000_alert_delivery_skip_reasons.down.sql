-- 되돌리기(down): 20260924200000_alert_delivery_skip_reasons
-- 실행: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260924200000_alert_delivery_skip_reasons.down.sql
--
-- **손실 있음.** Postgres에는 enum 값 삭제가 없어 타입을 다시 만들어야 하고, 그 과정에서
-- 지우는 값을 쓰던 행이 다른 값으로 바뀐다. 애초에 이 마이그레이션을 만든 이유가
-- "이 둘을 구분해 기록한다"이므로, 되돌리면 그 구분이 사라지는 것이 본질이다.
--
--   skipped_no_pair      -> skipped_severity
--       짝 없는 해제가 생기는 가장 흔한 원인이 심각도 하한이다(AC-ALERT32의 예시가 그것이다).
--       "그 채널로 보내지 않기로 판단했다"는 성격이 같아 오해가 가장 적다.
--   skipped_circuit_open -> failed
--       회로가 열린 원인이 연속 발송 실패다. 되돌린 뒤 "왜 안 갔나"를 볼 때
--       skipped_* 계열보다 실패 계열에 남는 편이 사실에 가깝다.
--
-- 바뀐 행을 되살릴 수 없으므로, 운영 중이라면 먼저 덤프한다:
--   pg_dump "$DATABASE_URL" -t alert_deliveries -f alert-deliveries-backup.sql
--
-- 건드리지 않는 것: alerts / alert_key_states / dashboard_heartbeats / settings,
-- 그리고 alert_deliveries의 **다른 모든 열**(시도 횟수·시각·응답 코드·오류 메시지는 그대로다).

BEGIN;

-- 1) 지울 값을 쓰는 행을 남는 값으로 옮긴다 (이 단계가 없으면 타입 교체가 실패한다)
UPDATE "public"."alert_deliveries"
   SET "status" = 'skipped_severity'
 WHERE "status" = 'skipped_no_pair';

UPDATE "public"."alert_deliveries"
   SET "status" = 'failed'
 WHERE "status" = 'skipped_circuit_open';

-- 2) 타입을 추가 이전의 10개 값으로 다시 만든다 (20260919150000_advisor_contract down과 같은 방식)
ALTER TYPE "public"."alert_delivery_status" RENAME TO "alert_delivery_status_old";

CREATE TYPE "public"."alert_delivery_status" AS ENUM (
  'pending', 'sent', 'failed',
  'skipped_disabled', 'skipped_not_configured', 'skipped_severity', 'skipped_unknown_off',
  'skipped_mock', 'skipped_restart', 'skipped_flapping'
);

ALTER TABLE "public"."alert_deliveries"
  ALTER COLUMN "status" TYPE "public"."alert_delivery_status"
  USING ("status"::text::"public"."alert_delivery_status");

DROP TYPE "public"."alert_delivery_status_old";

-- 3) Prisma 마이그레이션 기록 제거 (다시 migrate deploy 할 수 있도록)
DELETE FROM "public"."_prisma_migrations"
 WHERE "migration_name" = '20260924200000_alert_delivery_skip_reasons';

COMMIT;
