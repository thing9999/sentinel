-- 되돌리기(down): 20260919120000_init
-- 생성: npx prisma migrate diff --from-schema prisma/schema.prisma --to-empty --script (apps/api에서)
-- 적용: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260919120000_init.down.sql
-- 주의: 이 마이그레이션이 만든 모든 테이블·데이터가 삭제된다. 운영 DB에서는 백업(pg_dump) 후 실행.

BEGIN;

-- DropForeignKey
ALTER TABLE "public"."advisor_suggestions" DROP CONSTRAINT "advisor_suggestions_run_id_fkey";

-- DropTable
DROP TABLE "public"."settings";

-- DropTable
DROP TABLE "public"."cost_rate_samples";

-- DropTable
DROP TABLE "public"."cost_explorer_cache";

-- DropTable
DROP TABLE "public"."cost_explorer_call_logs";

-- DropTable
DROP TABLE "public"."price_cache";

-- DropTable
DROP TABLE "public"."advisor_runs";

-- DropTable
DROP TABLE "public"."advisor_suggestions";

-- DropEnum
DROP TYPE "public"."data_source_mode";

-- DropEnum
DROP TYPE "public"."cost_explorer_query_kind";

-- DropEnum
DROP TYPE "public"."fetch_status";

-- DropEnum
DROP TYPE "public"."cost_explorer_operation";

-- DropEnum
DROP TYPE "public"."cost_explorer_trigger";

-- DropEnum
DROP TYPE "public"."price_source";

-- DropEnum
DROP TYPE "public"."advisor_run_status";

-- DropEnum
DROP TYPE "public"."advisor_failure_reason";

-- DropEnum
DROP TYPE "public"."suggestion_category";

-- DropEnum
DROP TYPE "public"."severity";

-- DropEnum
DROP TYPE "public"."savings_source";


-- Prisma 마이그레이션 기록 제거 (다시 migrate deploy 할 수 있도록)
DELETE FROM "public"."_prisma_migrations" WHERE migration_name = '20260919120000_init';

COMMIT;
