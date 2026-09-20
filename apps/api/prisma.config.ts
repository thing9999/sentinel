import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma CLI 설정 (Prisma 7: datasource url은 schema가 아니라 여기서 지정)
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `npx prisma db seed` (= npm run db:seed): settings 기본값 (이미 있는 key는 유지, 멱등)
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
  datasource: {
    // generate는 URL 없이도 동작한다. migrate/db 명령에는 DATABASE_URL이 필요.
    url: process.env.DATABASE_URL ?? '',
  },
});
