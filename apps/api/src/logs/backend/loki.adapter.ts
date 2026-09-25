/**
 * Loki 어댑터. **LogQL이 존재하는 유일한 파일이다** (AC-LOG47).
 *
 * 지키는 것:
 * - 라벨 이름은 **설정값**이다 (`LOG_BACKEND_LABEL_*`). 회사 Loki가 다른 이름을 써도
 *   코드를 고치지 않는다 (AC-LOG46). **라벨 이름을 응답에 노출하지 않는다.**
 * - 인증 실패 메시지에 **토큰·비밀번호가 들어가지 않는다** (AC-LOG44).
 * - 스택이 쿼리를 거부하면 **사유를 가림 처리해 그대로** 올린다 — 서버가 조용히
 *   기간·줄 수를 줄이지 않는다 (AC-LOG43).
 * - 여기서 나오는 `line`은 **아직 원문**이다. 가림은 호출부가 한다.
 *
 * 따라가기는 Loki의 websocket `/tail` 대신 **`query_range` 짧은 주기 폴링**으로 구현했다.
 * 이유: ① 프록시·인그레스가 websocket을 막는 환경이 흔하다 ② 재연결·백프레셔를
 * 직접 다루지 않아도 된다 ③ 250ms 배치로 합쳐 내보내므로 화면 체감이 같다.
 */
import { Logger } from '@nestjs/common';
import { redactSecrets, truncateText } from '../../database/health';
import {
  LogBackendError,
  type LogBackendEntry,
  type LogBackendPort,
  type LogBackendQuery,
  type LogBackendSelector,
  type LogBackendTailHandle,
} from './log-backend.port';

export interface LokiConfig {
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

const TAIL_POLL_MS = 2000;

/** 라벨 값에 쓰는 정규식 문자를 막는다 (셀렉터 주입 방지) */
function safeLabelValue(v: string): string {
  return v.replace(/[^A-Za-z0-9._\-/]/g, '');
}

function quote(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 오류 문구는 **항상** 이 함수를 거친다 (토큰·URL이 섞여 나온다) */
function safeReason(text: string): string {
  return truncateText(redactSecrets(text).replace(/\s+/g, ' ').trim(), 300);
}

export class LokiAdapter implements LogBackendPort {
  private readonly logger = new Logger(LokiAdapter.name);
  readonly productLabel = 'Loki';

  constructor(private readonly cfg: LokiConfig) {}

  get retentionHours(): number | null {
    return this.cfg.retentionHours;
  }

  get maxRangeHours(): number {
    return this.cfg.maxRangeHours;
  }

  // --- LogQL (이 클래스 밖으로 나가지 않는다) ------------------------------------

  private buildQuery(
    sel: LogBackendSelector,
    search: LogBackendQuery['search'],
  ): string {
    const L = this.cfg.labels;
    const matchers: string[] = [
      `${L.namespace}=${quote(safeLabelValue(sel.namespace))}`,
    ];
    const pods = sel.pods.map(safeLabelValue).filter(Boolean);
    if (pods.length === 1) {
      matchers.push(`${L.pod}=${quote(pods[0])}`);
    } else if (pods.length > 1) {
      matchers.push(`${L.pod}=~${quote(pods.join('|'))}`);
    }
    const containers = sel.containers.map(safeLabelValue).filter(Boolean);
    if (containers.length === 1) {
      matchers.push(`${L.container}=${quote(containers[0])}`);
    } else if (containers.length > 1) {
      matchers.push(`${L.container}=~${quote(containers.join('|'))}`);
    }
    let q = `{${matchers.join(', ')}}`;
    if (search?.text) {
      // 검색어는 **필터 연산자의 인자**로만 들어간다 (셀렉터를 바꾸지 못한다)
      q += search.caseSensitive
        ? ` |= ${quote(search.text)}`
        : ` |~ ${quote(`(?i)${escapeRe(search.text)}`)}`;
    }
    return q;
  }

  // --- HTTP -------------------------------------------------------------------

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (this.cfg.tenant) h['X-Scope-OrgID'] = this.cfg.tenant;
    if (this.cfg.token) h.Authorization = `Bearer ${this.cfg.token}`;
    else if (this.cfg.basicAuth) {
      h.Authorization = `Basic ${Buffer.from(this.cfg.basicAuth).toString('base64')}`;
    }
    return h;
  }

  private async get(path: string, params: URLSearchParams): Promise<unknown> {
    const base = this.cfg.url.replace(/\/+$/, '');
    const url = `${base}${path}?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.cfg.timeoutSec * 1000,
    );
    let res: Response;
    try {
      res = await fetch(url, {
        headers: this.headers(),
        signal: controller.signal,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : 'error';
      // 주소·토큰을 메시지에 넣지 않는다
      throw new LogBackendError(
        'LOG_BACKEND_UNAVAILABLE',
        name === 'AbortError'
          ? `로그 스택 응답이 ${this.cfg.timeoutSec}초 안에 오지 않았습니다.`
          : '로그 스택에 연결하지 못했습니다.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      // **자격 증명·토큰을 메시지에 넣지 않는다** (AC-LOG44)
      throw new LogBackendError(
        'LOG_BACKEND_AUTH_FAILED',
        '로그 스택 인증에 실패했습니다. 토큰 또는 계정 설정을 확인하세요.',
      );
    }
    if (res.status >= 400 && res.status < 500) {
      let body = '';
      try {
        body = (await res.text()).slice(0, 400);
      } catch {
        body = '';
      }
      // 스택이 준 사유를 **가림 처리 후 그대로** 올린다 (조용히 줄이지 않는다)
      throw new LogBackendError(
        'LOG_BACKEND_QUERY_REJECTED',
        '로그 스택이 요청을 거부했습니다.',
        safeReason(body || `HTTP ${res.status}`),
      );
    }
    if (!res.ok) {
      throw new LogBackendError(
        'LOG_BACKEND_UNAVAILABLE',
        `로그 스택이 오류를 돌려줬습니다 (HTTP ${res.status}).`,
      );
    }
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new LogBackendError(
        'LOG_BACKEND_UNAVAILABLE',
        '로그 스택 응답을 읽을 수 없습니다.',
      );
    }
  }

  // --- LogBackendPort ----------------------------------------------------------

  async ping(): Promise<void> {
    await this.get('/loki/api/v1/labels', new URLSearchParams({ limit: '1' }));
  }

  async query(q: LogBackendQuery): Promise<LogBackendEntry[]> {
    const params = new URLSearchParams({
      query: this.buildQuery(q.selector, q.search),
      start: `${q.from.getTime()}000000`,
      end: `${q.to.getTime()}000000`,
      limit: String(q.limit),
      direction: 'backward',
    });
    const body = await this.get('/loki/api/v1/query_range', params);
    return this.parse(body).sort((a, b) => a.at.localeCompare(b.at));
  }

  tail(
    q: Omit<LogBackendQuery, 'from' | 'to'>,
    handlers: {
      onEntries: (entries: LogBackendEntry[]) => void;
      onError: (err: LogBackendError) => void;
    },
  ): LogBackendTailHandle {
    let since = Date.now();
    let stopped = false;
    const poll = async (): Promise<void> => {
      if (stopped) return;
      const to = Date.now();
      try {
        const entries = await this.query({
          ...q,
          from: new Date(since + 1),
          to: new Date(to),
          limit: Math.min(q.limit, 1000),
        });
        if (stopped) return;
        if (entries.length > 0) {
          since = Math.max(
            since,
            Date.parse(entries[entries.length - 1].at) || to,
          );
          handlers.onEntries(entries);
        } else {
          since = to;
        }
      } catch (err) {
        if (stopped) return;
        handlers.onError(
          err instanceof LogBackendError
            ? err
            : new LogBackendError(
                'LOG_BACKEND_UNAVAILABLE',
                '로그 스택 연결이 끊겼습니다.',
              ),
        );
      }
    };
    const timer = setInterval(() => void poll(), TAIL_POLL_MS);
    timer.unref();
    void poll();
    return {
      close: (): void => {
        stopped = true;
        clearInterval(timer);
      },
    };
  }

  /** Loki 응답 → 출처 중립 엔트리. 라벨 이름이 여기서 사라진다 */
  private parse(body: unknown): LogBackendEntry[] {
    const L = this.cfg.labels;
    const data = (body as { data?: { result?: unknown[] } }).data;
    const result = Array.isArray(data?.result) ? data.result : [];
    const out: LogBackendEntry[] = [];
    for (const streamRaw of result) {
      const s = streamRaw as {
        stream?: Record<string, string>;
        values?: [string, string][];
      };
      const labels = s.stream ?? {};
      const pod = labels[L.pod] ?? '';
      const container = labels[L.container] ?? '';
      const streamName = labels[L.stream];
      for (const v of s.values ?? []) {
        const ns = Number(v[0]);
        out.push({
          at: Number.isFinite(ns)
            ? new Date(ns / 1_000_000).toISOString()
            : new Date().toISOString(),
          line: v[1] ?? '',
          pod,
          container,
          stream:
            streamName === 'stdout' || streamName === 'stderr'
              ? streamName
              : null,
        });
      }
    }
    return out;
  }
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
