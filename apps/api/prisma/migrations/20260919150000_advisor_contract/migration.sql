-- 20260919150000_advisor_contract
-- API 계약(3단계) 반영: docs/api/architecture-advisor.md C.2·C.3, docs/reports/architecture-advisor/backend.md 8절
-- 되돌리기: docs/db/migrations/20260919150000_advisor_contract.down.sql
--
-- Prisma가 만든 SQL(`DROP COLUMN steps` + `ADD COLUMN steps JSONB NOT NULL`)은 기존 행이 있으면 실패하거나
-- 데이터를 잃으므로 손으로 고쳤다: 타입 변경 + USING 변환(기존 text 보존).

-- AlterEnum: 비용 상한(maxBudgetUsd) 초과. schema.prisma와 같은 순서가 되도록 'interrupted' 앞에 넣는다.
-- (PG 12+: 트랜잭션 안에서 ADD VALUE 가능. 새 값은 이 트랜잭션 안에서 쓰지 않는다)
ALTER TYPE "advisor_failure_reason" ADD VALUE IF NOT EXISTS 'budget_exceeded' BEFORE 'interrupted';

-- AlterTable: 단계별 시각·소요 (선택, NULL 허용) — StageTiming[]
ALTER TABLE "advisor_runs" ADD COLUMN "stage_timings" JSONB;

-- AlterTable: steps text -> jsonb (Step[] = [{text, code:{language, content}|null}])
--  - 이미 JSON 배열 문자열이면 그대로 jsonb로
--  - 그 외(평문·마크다운)는 한 단계짜리 배열로 감싼다: [{"text": <원문>, "code": null}]
--  (CASE는 WHEN 순서대로 평가되므로 잘못된 JSON은 ::jsonb 캐스트에 닿지 않는다. pg_input_is_valid는 PG 16+)
ALTER TABLE "advisor_suggestions"
  ALTER COLUMN "steps" TYPE JSONB USING (
    CASE
      WHEN NOT pg_input_is_valid("steps", 'jsonb')
        THEN jsonb_build_array(jsonb_build_object('text', "steps", 'code', NULL))
      WHEN jsonb_typeof("steps"::jsonb) = 'array'
        THEN "steps"::jsonb
      ELSE jsonb_build_array(jsonb_build_object('text', "steps", 'code', NULL))
    END
  );
