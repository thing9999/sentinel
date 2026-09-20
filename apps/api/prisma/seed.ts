/**
 * 시드: 기본 설정값만 넣는다 (settings 테이블). 이미 있는 key는 덮어쓰지 않는다(멱등).
 *
 * 실행 (apps/api에서, DATABASE_URL 필요, 마이그레이션 적용 후):
 *   npx ts-node prisma/seed.ts
 *   또는 prisma.config.ts에 migrations.seed = 'ts-node prisma/seed.ts' 등록 후 `npx prisma db seed`
 *
 * Prisma 생성 클라이언트 대신 pg를 쓰는 이유: 생성 코드가 `./internal/class.js`처럼 .js 확장자로
 * import하므로 ts-node(CJS)로 직접 실행할 수 없다. 시드는 단순 upsert라 pg로 충분하다.
 */
import 'dotenv/config';
import { Client } from 'pg';
import {
  SETTING_DEFAULTS,
  SETTING_KEYS,
} from '../src/database/settings-defaults';

export async function seedSettings(client: Client): Promise<number> {
  let created = 0;
  for (const key of SETTING_KEYS) {
    const { value, description } = SETTING_DEFAULTS[key];
    const res = await client.query(
      `INSERT INTO "settings" ("key", "value", "description", "updated_at")
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT ("key") DO NOTHING`,
      [key, JSON.stringify(value), description],
    );
    created += res.rowCount ?? 0;
  }
  return created;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL이 없어 시드를 건너뜁니다.');
    process.exitCode = 1;
    return;
  }
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    application_name: 'sentinel-seed',
  });
  await client.connect();
  try {
    const created = await seedSettings(client);
    console.log(
      `settings 시드 완료: 새로 추가 ${created}건, 기존 유지 ${SETTING_KEYS.length - created}건`,
    );
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('시드 실패:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
