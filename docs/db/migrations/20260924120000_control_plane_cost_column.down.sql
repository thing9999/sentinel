-- 되돌리기(down): 20260924120000_control_plane_cost_column
-- 적용: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260924120000_control_plane_cost_column.down.sql
-- control_plane_usd_per_hour -> eks_usd_per_hour로 되돌린다. 행은 지우지 않는다(값 보존).
-- 코드 기본값(schema.prisma, settings-defaults.ts)은 되돌리지 않는다 — 코드도 되돌릴 때 해당 커밋을 함께 되돌린다.

BEGIN;

-- 전환 시각(마이그레이션 완료 시각). 기록이 없으면 now()로 보고 모든 행을 대상으로 한다.
CREATE TEMP TABLE _cp_cutover ON COMMIT DROP AS
SELECT COALESCE(
         (SELECT max(finished_at) FROM "public"."_prisma_migrations"
          WHERE migration_name = '20260924120000_control_plane_cost_column'),
         now()
       ) AS at;

-- 1) resources jsonb 카테고리 이름 되돌리기 (금액·순서는 그대로).
--    **전환 이전에 만들어진 행만** 되돌린다. 전환 이후 행의 'controlPlane'은
--    kOps 실비(마스터 EC2·etcd EBS·API LB)라 'eks'(관리 요금)로 바꾸면 뜻이 틀려진다.
--    다만 열 이름은 테이블 전체가 함께 돌아가므로(2번), 전환 이후 행은
--    eks_usd_per_hour 열에 kOps 실비가 담긴 상태로 남는다 — 되돌리기의 본래 한계다.
--    (배포 직후 롤백이면 전환 이후 행이 거의 없어 실질적인 손실이 없다.)
UPDATE "public"."cost_rate_samples"
SET "resources" = (
  SELECT jsonb_agg(
           CASE WHEN elem->>'kind' = 'controlPlane'
                THEN jsonb_set(elem, '{kind}', '"eks"'::jsonb, false)
                ELSE elem
           END
           ORDER BY ord
         )
  FROM jsonb_array_elements("resources") WITH ORDINALITY AS t(elem, ord)
)
WHERE jsonb_typeof("resources") = 'array'
  AND "resources" @> '[{"kind": "controlPlane"}]'::jsonb
  AND "created_at" < (SELECT at FROM _cp_cutover);

-- 2) 열 이름 되돌리기 (값 보존).
ALTER TABLE "public"."cost_rate_samples"
  RENAME COLUMN "control_plane_usd_per_hour" TO "eks_usd_per_hour";

-- 3) 전환 시점 표시 제거.
--    주의: up이 넣은 시각과 운영자가 나중에 바꾼 시각을 구분할 수 없어(값 자체가 시각 하나뿐)
--    cost.spike.rate.baselineFrom은 **무조건** 지운다. 옛 동작(전체 표본으로 기준선 계산)으로 돌아간다.
--    20260919180000_advisor_limits_defaults의 되돌리기와 같은 한계다.
UPDATE "public"."settings"
SET "value" = "value" #- '{rate,baselineFrom}',
    "updated_at" = now()
WHERE "key" = 'cost.spike'
  AND jsonb_typeof("value") = 'object'
  AND jsonb_typeof("value" -> 'rate') = 'object'
  AND "value" -> 'rate' -> 'baselineFrom' IS NOT NULL;

-- Prisma 마이그레이션 기록 제거 (다시 migrate deploy 할 수 있도록)
DELETE FROM "public"."_prisma_migrations"
WHERE migration_name = '20260924120000_control_plane_cost_column';

COMMIT;
