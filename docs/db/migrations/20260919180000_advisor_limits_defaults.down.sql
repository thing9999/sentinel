-- 되돌리기(down): 20260919180000_advisor_limits_defaults
-- 적용: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260919180000_advisor_limits_defaults.down.sql
-- settings "advisor.limits"의 새 기본값(maxTurns 5, slowAfterSec 300)을 옛 기본값(3, 180)으로 되돌린다.
-- 주의: 마이그레이션 뒤 운영자가 일부러 5/300으로 설정한 값도 구분할 수 없어 함께 되돌려진다.
-- 코드 기본값(settings-defaults.ts)은 되돌리지 않는다 — 코드도 되돌릴 때는 해당 커밋을 함께 되돌린다.

BEGIN;

UPDATE "public"."settings"
SET "value" = jsonb_set("value", '{maxTurns}', '3'::jsonb, false),
    "updated_at" = now()
WHERE "key" = 'advisor.limits'
  AND jsonb_typeof("value") = 'object'
  AND "value" -> 'maxTurns' = '5'::jsonb;

UPDATE "public"."settings"
SET "value" = jsonb_set("value", '{slowAfterSec}', '180'::jsonb, false),
    "updated_at" = now()
WHERE "key" = 'advisor.limits'
  AND jsonb_typeof("value") = 'object'
  AND "value" -> 'slowAfterSec' = '300'::jsonb;

-- Prisma 마이그레이션 기록 제거 (다시 migrate deploy 할 수 있도록)
DELETE FROM "public"."_prisma_migrations" WHERE migration_name = '20260919180000_advisor_limits_defaults';

COMMIT;
