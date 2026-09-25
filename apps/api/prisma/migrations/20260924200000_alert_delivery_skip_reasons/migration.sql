-- 20260924200000_alert_delivery_skip_reasons
-- alert_delivery_status enum에 "보내지 않은 이유" 2개 추가 (backend 계약 작성 중 발견).
-- 되돌리기: docs/db/migrations/20260924200000_alert_delivery_skip_reasons.down.sql
--
--   skipped_no_pair       : 발생 알림을 이 채널로 안 보냈으니 해제 알림도 안 보낸다 (AC-ALERT32).
--                           없으면 "안 보냄"과 "실패"가 기록에서 구분되지 않는다.
--   skipped_circuit_open  : 연속 실패 차단(alerts 3.3.2, 기본 10회 → 1시간 정지) 중에 건너뜀.
--                           failed와 같은 값이면 나중에 "왜 안 갔나"를 추적할 수 없다.
--
-- **기존 행·값은 하나도 바뀌지 않는다.** ALTER TYPE ... ADD VALUE는 카탈로그에 값만 덧붙이고
-- 테이블을 다시 쓰지 않는다(열 재작성·USING 캐스팅·타입 교체가 없다). 이 마이그레이션이 읽거나
-- 쓰는 테이블은 **하나도 없다**. alert_deliveries가 비어 있든 가득 차 있든 결과가 같다.
--
-- Postgres 12+부터 ADD VALUE를 트랜잭션 안에서 실행할 수 있다(Prisma migrate가 트랜잭션으로 감싼다).
-- 제약은 "같은 트랜잭션에서 그 값을 **쓸 수는** 없다"인데, 여기서는 값을 쓰지 않으므로 해당 없다.
-- 대상은 Postgres 16이다(docs/db/schema.md 머리말).
--
-- AFTER를 쓰는 이유: 정렬 위치를 schema.prisma의 선언 순서와 맞춰 둔다
-- (그냥 ADD VALUE만 하면 맨 뒤에 붙어 스키마 파일과 DB의 순서가 어긋난다).

-- AlterEnum
ALTER TYPE "alert_delivery_status" ADD VALUE 'skipped_no_pair' AFTER 'skipped_unknown_off';
ALTER TYPE "alert_delivery_status" ADD VALUE 'skipped_circuit_open' AFTER 'skipped_flapping';
