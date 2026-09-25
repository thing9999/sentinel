/**
 * logs 설정 (docs/api/logs.md 5·10절). 전부 환경 변수다 — **가림을 끄는 항목은 없다**(P2).
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATA_SOURCE_MODE } from '../common/data-source';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../config/env.validation';

export interface LogLimits {
  defaultLines: number;
  maxLines: number;
  lineOptions: number[];
  maxBytes: number;
  maxLineBytes: number;
  maxStreams: number;
  maxLinesPerSec: number;
  idlePauseSec: number;
  maxStreamMin: number;
}

export interface LogBackendConfig {
  product: 'loki';
  url: string;
  tenant: string | null;
  token: string | null;
  basicAuth: string | null;
  timeoutSec: number;
  maxRangeHours: number;
  retentionHours: number | null;
  labels: {
    namespace: string;
    pod: string;
    container: string;
    node: string;
    stream: string;
  };
}

@Injectable()
export class LogsOptions {
  readonly enabled: boolean;
  readonly denyNamespaces: string[];
  readonly limits: LogLimits;
  readonly extraPatterns: string[];
  /**
   * 외부 로그 스택 설정. `null`이면 **설정 없음**이고 그것은 정상이다
   * (`not_configured`는 `degraded`가 아니다 — AC-LOG45).
   * **토큰·비밀번호가 들어 있으므로 이 객체를 응답에 싣지 말 것.**
   */
  readonly backend: LogBackendConfig | null;

  constructor(
    @Inject(DATA_SOURCE_MODE) readonly dataSource: DataSourceMode,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.enabled = config.get('LOGS_ENABLED', { infer: true });
    this.denyNamespaces = (
      config.get('LOG_DENY_NAMESPACES', { infer: true }) ?? ''
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const defaultLines = config.get('LOG_DEFAULT_LINES', { infer: true });
    const maxLines = config.get('LOG_MAX_LINES', { infer: true });
    this.limits = {
      defaultLines,
      maxLines,
      lineOptions: [200, 500, 2000, 5000].filter((n) => n <= maxLines),
      maxBytes: config.get('LOG_MAX_BYTES', { infer: true }),
      maxLineBytes: config.get('LOG_MAX_LINE_BYTES', { infer: true }),
      maxStreams: config.get('LOG_MAX_STREAMS', { infer: true }),
      maxLinesPerSec: config.get('LOG_STREAM_MAX_LPS', { infer: true }),
      idlePauseSec: config.get('LOG_STREAM_IDLE_PAUSE_SEC', { infer: true }),
      maxStreamMin: config.get('LOG_STREAM_MAX_MIN', { infer: true }),
    };
    this.extraPatterns = (
      config.get('LOG_REDACT_EXTRA_PATTERNS', { infer: true }) ?? ''
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const product = config.get('LOG_BACKEND', { infer: true });
    const url = config.get('LOG_BACKEND_URL', { infer: true });
    this.backend =
      product && url
        ? {
            product,
            url,
            tenant: config.get('LOG_BACKEND_TENANT', { infer: true }) ?? null,
            token: config.get('LOG_BACKEND_TOKEN', { infer: true }) ?? null,
            basicAuth:
              config.get('LOG_BACKEND_BASIC_AUTH', { infer: true }) ?? null,
            timeoutSec: config.get('LOG_BACKEND_TIMEOUT_SEC', { infer: true }),
            maxRangeHours: config.get('LOG_BACKEND_MAX_RANGE_HOURS', {
              infer: true,
            }),
            retentionHours:
              config.get('LOG_BACKEND_RETENTION_HOURS', { infer: true }) ??
              null,
            labels: {
              namespace: config.get('LOG_BACKEND_LABEL_NAMESPACE', {
                infer: true,
              }),
              pod: config.get('LOG_BACKEND_LABEL_POD', { infer: true }),
              container: config.get('LOG_BACKEND_LABEL_CONTAINER', {
                infer: true,
              }),
              node: config.get('LOG_BACKEND_LABEL_NODE', { infer: true }),
              stream: config.get('LOG_BACKEND_LABEL_STREAM', { infer: true }),
            },
          }
        : null;
  }

  /** `LOG_DENY_NAMESPACES`에 걸리는가 (설정값이고 비밀이 아니라 응답에 그대로 나간다) */
  denied(namespace: string): boolean {
    return this.denyNamespaces.includes(namespace);
  }
}
