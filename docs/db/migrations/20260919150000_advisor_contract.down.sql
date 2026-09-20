-- 되돌리기(down): 20260919150000_advisor_contract
-- 적용: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260919150000_advisor_contract.down.sql
-- 이후 20260919120000_init까지 되돌리려면 이어서 20260919120000_init.down.sql 실행.
-- 주의(손실):
--  - failure_reason = 'budget_exceeded' 행은 'other'로 바뀐다 (Postgres는 enum 값 삭제가 없어 타입을 다시 만든다).
--  - stage_timings 컬럼과 값이 삭제된다.
--  - steps(jsonb Step[])는 텍스트로 합쳐진다: 단계마다 "<text>" + 코드가 있으면 ```<language>\n<content>\n``` 블록,
--    단계 사이는 빈 줄. 배열이 아니면 jsonb 텍스트 그대로.

BEGIN;

-- steps jsonb -> text (ALTER ... USING은 서브쿼리를 못 쓰므로 새 컬럼 + UPDATE + 교체)
ALTER TABLE "public"."advisor_suggestions" ADD COLUMN "steps_text" TEXT;

UPDATE "public"."advisor_suggestions" s
SET "steps_text" = CASE
  WHEN jsonb_typeof(s."steps") = 'array' THEN COALESCE((
    SELECT string_agg(
             CASE
               WHEN jsonb_typeof(e.step) = 'object' THEN
                 COALESCE(e.step->>'text', '')
                 || CASE
                      WHEN jsonb_typeof(e.step->'code') = 'object' THEN
                        E'\n```' || COALESCE(e.step->'code'->>'language', '') || E'\n'
                        || COALESCE(e.step->'code'->>'content', '') || E'\n```'
                      ELSE ''
                    END
               ELSE e.step #>> '{}'
             END,
             E'\n\n' ORDER BY e.ord)
    FROM jsonb_array_elements(s."steps") WITH ORDINALITY AS e(step, ord)
  ), '')
  ELSE s."steps" #>> '{}'
END;

ALTER TABLE "public"."advisor_suggestions" DROP COLUMN "steps";
ALTER TABLE "public"."advisor_suggestions" RENAME COLUMN "steps_text" TO "steps";
ALTER TABLE "public"."advisor_suggestions" ALTER COLUMN "steps" SET NOT NULL;

-- stage_timings 제거
ALTER TABLE "public"."advisor_runs" DROP COLUMN "stage_timings";

-- enum에서 budget_exceeded 제거: 값 옮기기 -> 타입 다시 만들기
UPDATE "public"."advisor_runs" SET "failure_reason" = 'other' WHERE "failure_reason" = 'budget_exceeded';
ALTER TYPE "public"."advisor_failure_reason" RENAME TO "advisor_failure_reason_old";
CREATE TYPE "public"."advisor_failure_reason" AS ENUM ('bridge_unavailable', 'login_required', 'usage_limit', 'timeout', 'invalid_response', 'interrupted', 'other');
ALTER TABLE "public"."advisor_runs"
  ALTER COLUMN "failure_reason" TYPE "public"."advisor_failure_reason"
  USING ("failure_reason"::text::"public"."advisor_failure_reason");
DROP TYPE "public"."advisor_failure_reason_old";

-- Prisma 마이그레이션 기록 제거 (다시 migrate deploy 할 수 있도록)
DELETE FROM "public"."_prisma_migrations" WHERE migration_name = '20260919150000_advisor_contract';

COMMIT;
