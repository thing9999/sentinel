-- 20260924120000_control_plane_cost_column
-- kops-support (docs/specs/kops-support.md 3.5, AC-KOPS34): 비용 카테고리 eks -> controlPlane.
-- 되돌리기: docs/db/migrations/20260924120000_control_plane_cost_column.down.sql
--
-- 핵심: 기존 행을 지우지 않는다. 소모율 기록은 급증 판단의 7일 중앙값·90일 추이 기준선이라
-- 행이 사라지면 전환 후 최대 7일 동안 급증 판단이 "기준 수집 중"으로 멈춘다.
-- 그래서 Prisma가 필드 이름 변경에 기본으로 내는 DROP COLUMN + ADD COLUMN(값 손실) 대신
-- RENAME COLUMN(값 보존)을 손으로 쓴다. 아래 1번은 데이터를 한 건도 건드리지 않는다.

-- 1) 열 이름만 바꾼다. 값·행·인덱스·제약은 그대로다.
ALTER TABLE "public"."cost_rate_samples"
  RENAME COLUMN "eks_usd_per_hour" TO "control_plane_usd_per_hour";

-- 2) 같은 행 안의 resources jsonb에도 옛 카테고리 이름이 들어 있다
--    ([{kind: 'eks', ...}] — 급증 원인 비교용 리소스 요약).
--    열 이름만 바꾸고 jsonb를 두면 한 행 안에서 control_plane_usd_per_hour(금액)와
--    resources[].kind='eks'가 어긋나 UI가 모르는 카테고리를 만나게 된다.
--    금액은 그대로 두고 **카테고리 이름만** 바꾼다(값 손실 없음, 배열 순서 유지).
UPDATE "public"."cost_rate_samples"
SET "resources" = (
  SELECT jsonb_agg(
           CASE WHEN elem->>'kind' = 'eks'
                THEN jsonb_set(elem, '{kind}', '"controlPlane"'::jsonb, false)
                ELSE elem
           END
           ORDER BY ord
         )
  FROM jsonb_array_elements("resources") WITH ORDINALITY AS t(elem, ord)
)
WHERE jsonb_typeof("resources") = 'array'
  AND "resources" @> '[{"kind": "eks"}]'::jsonb;

-- 3) 전환 시점 표시(오탐 방지). 데이터만 바꾼다. 스키마 변경 아님.
--    EKS 컨트롤 플레인 "관리 요금"과 kOps 컨트롤 플레인 "실비(마스터 EC2+etcd EBS+API LB)"는
--    성격이 다른 금액이라, 이 시점 앞뒤의 total_usd_per_hour를 한 기준선으로 섞으면
--    전환 순간에 없던 급증·급감이 잡힌다(cost.spike.rate: 7일 중앙값 ×1.3 & +$0.5/h).
--    settings cost.spike.rate.baselineFrom = 이 마이그레이션 적용 시각(UTC ISO8601).
--    backend는 소모율 기준선 표본을 이 시각 이후로만 잡는다(값이 null이면 지금과 같이 전체).
--    행이 없으면(시드 전 새 DB) 아무것도 하지 않는다 — 옛 표본 자체가 없어 오탐도 없다.
--    운영자가 이미 값을 넣어 뒀으면 덮어쓰지 않는다.
UPDATE "public"."settings"
SET "value" = jsonb_set(
      "value",
      '{rate,baselineFrom}',
      to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      true
    ),
    "updated_at" = now()
WHERE "key" = 'cost.spike'
  AND jsonb_typeof("value") = 'object'
  AND jsonb_typeof("value" -> 'rate') = 'object'
  AND COALESCE(jsonb_typeof("value" -> 'rate' -> 'baselineFrom'), 'null') = 'null';
