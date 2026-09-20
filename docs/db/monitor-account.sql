-- =============================================================================
-- 모니터링 전용 계정 생성 (모니터링 대상 Postgres, 클러스터 안 StatefulSet)
-- =============================================================================
-- 목적 : 대시보드(api)가 DB 상태 통계만 읽는 계정. 사용자 테이블 데이터는 읽지 못한다.
-- 권한 : pg_monitor (= pg_read_all_settings + pg_read_all_stats + pg_stat_scan_tables)
--        + 접속(CONNECT). 테이블 SELECT/INSERT/UPDATE/DELETE, DDL 권한 없음.
-- 대상 : Postgres 14 이상 (기준 16). superuser(보통 postgres)로 실행한다.
-- 멱등 : 여러 번 실행해도 된다 (없으면 만들고, 있으면 속성·비밀번호를 다시 맞춘다).
--
-- 실행 방법 (자세한 설명: docs/db/health.md 7절)
--   비밀번호는 이 파일에 쓰지 않는다. psql 변수 monitor_password로 **표준 입력**에 넣는다
--   (명령줄 인자로 넘기면 프로세스 목록·쿠버네티스 감사 로그에 남을 수 있음).
--
--   read -rs MONITOR_PASSWORD   # 입력 내용이 화면에 안 보임
--   { printf "\\set monitor_password '%s'\n" "$MONITOR_PASSWORD"; cat docs/db/monitor-account.sql; } \
--     | kubectl exec -i -n <db-namespace> <db-pod-0> -- \
--       psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
--
-- 되돌리기: 파일 맨 아래 "되돌리기" 주석 참조.
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?monitor_password}
\else
  \echo 'monitor_password 변수가 없습니다. 위 실행 방법처럼 \set monitor_password ... 를 먼저 넣으세요.'
  \quit
\endif

-- 계정 이름 (바꾸면 MONITOR_DB_URL의 사용자도 바꾼다)
\set monitor_role sentinel_monitor

-- 비밀번호는 SCRAM으로 저장 (PG14+ 기본값이지만 명시)
SET password_encryption = 'scram-sha-256';

-- 이 세션의 문장이 서버 로그(log_statement=all/ddl)에 비밀번호째 남지 않도록
-- (superuser만 바꿀 수 있는 설정. 실패하면 psql이 멈추므로 권한 있는 계정으로 실행)
SET log_statement = 'none';
SET log_min_duration_statement = -1;

-- 1) 역할 생성 (없을 때만)
SELECT format('CREATE ROLE %I LOGIN', :'monitor_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'monitor_role')
\gexec

-- 2) 역할 속성: 로그인만 가능, 관리 권한 전부 없음, 연결 수 3개로 제한
--    (api 커넥션 풀 max 2 + 수동 점검 1)
SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT '
  'NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3 PASSWORD %L',
  :'monitor_role', :'monitor_password')
\gexec

-- 3) 통계 조회 권한 (pg_stat_activity 전체 행, pg_stat_replication, pg_ls_waldir,
--    pg_database_size 등). INHERIT가 있어야 권한이 적용된다.
SELECT format('GRANT pg_monitor TO %I', :'monitor_role')
\gexec

-- 4) 접속 권한 (PUBLIC에 CONNECT가 회수된 클러스터 대비). 접속 가능한 모든 DB에 부여.
--    테이블 크기(table_sizes) 쿼리는 DB마다 접속해야 하므로 필요하다.
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', datname, :'monitor_role')
FROM pg_database
WHERE datallowconn AND NOT datistemplate
\gexec

-- 5) 세션 기본값 (역할 수준). 앱의 접속 옵션과 별개로 서버 쪽 안전장치.
--    - 기본 읽기 전용 트랜잭션: 실수로 쓰기 문장을 보내도 거부된다 (임시 테이블 생성 포함)
--    - statement_timeout 5초: 명세의 "시간 초과(5초)" 기준. 개별 쿼리는 SET LOCAL로 더 짧게 건다
--    - lock_timeout 1초: 카탈로그 잠금 대기로 쌓이지 않게
--    - idle_in_transaction_session_timeout 10초: 모니터링 세션이 트랜잭션을 붙잡지 않게
--    - log_min_duration_statement 비활성: 모니터링 쿼리로 서버 로그가 불어나지 않게
SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', :'monitor_role') \gexec
SELECT format('ALTER ROLE %I SET statement_timeout = %L', :'monitor_role', '5s') \gexec
SELECT format('ALTER ROLE %I SET lock_timeout = %L', :'monitor_role', '1s') \gexec
SELECT format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', :'monitor_role', '10s') \gexec
SELECT format('ALTER ROLE %I SET log_min_duration_statement = -1', :'monitor_role') \gexec

-- 6) public 스키마 CREATE 권한 확인 (PG15+는 기본적으로 PUBLIC에 없음).
--    PG14 이하에서 PUBLIC에 CREATE가 남아 있으면 이 계정도 테이블을 만들 수 있다.
--    그 경우 기본 읽기 전용 설정이 막아 주지만, 운영 정책상 회수를 권장한다(다른 계정 영향 확인 후):
--      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT has_schema_privilege(:'monitor_role', 'public', 'CREATE') AS monitor_can_create_in_public;

-- 7) 확인: 결과가 기대값과 같아야 한다
SELECT r.rolname,
       r.rolsuper       AS superuser,        -- f
       r.rolcreaterole  AS createrole,       -- f
       r.rolcreatedb    AS createdb,         -- f
       r.rolreplication AS replication,      -- f
       r.rolconnlimit   AS conn_limit,       -- 3
       pg_has_role(r.oid, 'pg_monitor', 'USAGE') AS has_pg_monitor,  -- t
       r.rolconfig      AS role_settings
FROM pg_roles r
WHERE r.rolname = :'monitor_role';

\unset monitor_password

-- =============================================================================
-- 되돌리기 (계정 삭제). superuser로 실행. 접속 중인 세션이 있으면 먼저 대시보드를 멈춘다.
--   REVOKE pg_monitor FROM sentinel_monitor;
--   REVOKE CONNECT ON DATABASE <각 DB> FROM sentinel_monitor;
--   DROP ROLE sentinel_monitor;
-- (이 계정은 객체를 소유하지 않으므로 REASSIGN OWNED / DROP OWNED는 필요 없다.
--  필요 시 각 DB에서: DROP OWNED BY sentinel_monitor;)
-- =============================================================================
