-- 20260919180000_advisor_limits_defaults
-- 데이터 마이그레이션(스키마 변경 없음): settings "advisor.limits"의 옛 기본값을 새 기본값으로 올린다.
-- PM 결정(2026-09-19): maxTurns 3 -> 5, slowAfterSec 180 -> 300. timeoutSec 600, maxBudgetUsd 2.0은 그대로.
-- 되돌리기: docs/db/migrations/20260919180000_advisor_limits_defaults.down.sql
--
-- 시드는 ON CONFLICT DO NOTHING(멱등)이라 이미 시드된 DB의 값은 바뀌지 않는다. 그래서 여기서 올린다.
-- 필드별로 "값이 정확히 옛 기본값일 때만" 바꾼다: 운영자가 다른 값으로 바꿔 둔 필드는 건드리지 않는다.
-- 행이 없거나(새 DB, 시드 전) 필드가 없으면 아무것도 하지 않는다(mergeSetting이 코드 기본값을 채움).

UPDATE "settings"
SET "value" = jsonb_set("value", '{maxTurns}', '5'::jsonb, false),
    "updated_at" = now()
WHERE "key" = 'advisor.limits'
  AND jsonb_typeof("value") = 'object'
  AND "value" -> 'maxTurns' = '3'::jsonb;

UPDATE "settings"
SET "value" = jsonb_set("value", '{slowAfterSec}', '300'::jsonb, false),
    "updated_at" = now()
WHERE "key" = 'advisor.limits'
  AND jsonb_typeof("value") = 'object'
  AND "value" -> 'slowAfterSec' = '180'::jsonb;
