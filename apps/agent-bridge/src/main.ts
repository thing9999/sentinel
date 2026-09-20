import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const app = buildServer(config, { logger: true });

if (config.hostOverridden) {
  app.log.warn(
    'BRIDGE_TOKEN이 없어 BRIDGE_HOST를 무시하고 127.0.0.1에만 바인딩합니다 (로컬 전용 모드).',
  );
}

const shutdown = (signal: string) => {
  app.log.info(`${signal} 수신, 종료합니다.`);
  app.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `agent-bridge on ${config.host}:${config.port} (${config.token ? 'token' : 'local-only'} mode)`,
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
