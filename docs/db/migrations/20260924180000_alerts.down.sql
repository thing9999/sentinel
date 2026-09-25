-- 되돌리기: 20260924180000_alerts (alerts 기능 테이블·enum)
-- 실행: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260924180000_alerts.down.sql
--
-- 손실: **알림 이력·발송 기록·상태 머신·heartbeat가 모두 사라진다.** 필요하면 먼저 덤프한다:
--   pg_dump "$DATABASE_URL" -t alerts -t alert_deliveries -t alert_key_states -t dashboard_heartbeats \
--     -f alerts-backup.sql
--
-- 건드리지 않는 것 (중요):
--   - settings 테이블. 이 마이그레이션이 settings를 바꾸지 않았으므로 되돌릴 것도 없다.
--     `alerts` / `alerts.discord` / `alerts.discord.webhookUrl` 행이 시드·설정 화면으로 생겼을 수 있지만,
--     그것은 이 마이그레이션이 만든 것이 아니다. **웹훅 주소를 여기서 지우지 않는다**
--     (다시 적용하면 그대로 쓸 수 있어야 한다. 지우고 싶으면 사람이 직접:
--      DELETE FROM settings WHERE key = 'alerts.discord.webhookUrl';)
--   - cost_rate_samples / cost_explorer_* / price_cache / advisor_* : 읽지도 쓰지도 않는다.

BEGIN;

-- 자식(발송 기록·상태 머신)을 먼저 지운다. alerts를 참조하는 FK가 있다.
DROP TABLE IF EXISTS "alert_deliveries";
DROP TABLE IF EXISTS "alert_key_states";
DROP TABLE IF EXISTS "dashboard_heartbeats";
-- alerts는 자기 자신을 참조(parent_alert_id)하므로 위 두 표를 지운 뒤면 그냥 지워진다.
DROP TABLE IF EXISTS "alerts";

DROP TYPE IF EXISTS "alert_delivery_status";
DROP TYPE IF EXISTS "alert_channel";
DROP TYPE IF EXISTS "alert_state_value";
DROP TYPE IF EXISTS "alert_kind";
DROP TYPE IF EXISTS "alert_severity";
-- data_source_mode는 cost_rate_samples 등이 계속 쓰므로 **지우지 않는다**.

-- 마이그레이션 기록 삭제 (다시 `prisma migrate deploy`로 적용할 수 있게)
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260924180000_alerts';

COMMIT;
