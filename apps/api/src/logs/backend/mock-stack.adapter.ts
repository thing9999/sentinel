/**
 * mock 로그 스택 (docs/api/logs.md 9절, AC-LOG48).
 * **실제 Loki 없이** 검색·기간·합쳐보기·사라진 파드가 화면에서 동작해야 한다.
 *
 * 같은 `LogBackendPort`를 구현하므로 서비스는 mock인지 알지 못한다 —
 * 출처 중립 경계가 실제로 지켜지는지를 이 어댑터가 증명한다.
 */
import {
  LogBackendError,
  type LogBackendEntry,
  type LogBackendPort,
  type LogBackendQuery,
  type LogBackendTailHandle,
} from './log-backend.port';
import { mockLogLines, type LogScenario } from '../mock/mock-logs';

const TAIL_MS = 900;

export class MockStackAdapter implements LogBackendPort {
  readonly productLabel = 'Loki';
  /**
   * 보관 기간이 **기간 상한보다 짧은** 조합을 일부러 쓴다 (흔한 실제 설정이다).
   * 둘이 같으면 `LOG_RETENTION_EXCEEDED` 안내가 영영 나오지 않아 AC-LOG38을 확인할 수 없다.
   */
  readonly retentionHours = 72;
  readonly maxRangeHours = 168;

  constructor(
    private readonly scenario: () => LogScenario,
    /** `stack-down` 시나리오에서 연결 실패를 재현한다 */
    private readonly down: () => boolean,
  ) {}

  /**
   * `stack-auth-failed`·`stack-rejected`: **Loki 어댑터와 같은 코드·같은 문구**를 던진다
   * (PM 결정 2026-09-25 — mock과 live가 같은 모양이어야 화면이 월요일에 깨지지 않는다)
   */
  private failure(): LogBackendError | null {
    const s = this.scenario();
    if (this.down()) {
      return new LogBackendError(
        'LOG_BACKEND_UNAVAILABLE',
        '로그 스택에 연결하지 못했습니다.',
      );
    }
    if (s === 'stack-auth-failed') {
      return new LogBackendError(
        'LOG_BACKEND_AUTH_FAILED',
        '로그 스택 인증에 실패했습니다. 토큰 또는 계정 설정을 확인하세요.',
      );
    }
    if (s === 'stack-rejected') {
      return new LogBackendError(
        'LOG_BACKEND_QUERY_REJECTED',
        '로그 스택이 요청을 거부했습니다.',
        'max entries limit per query exceeded, limit > max_entries_limit (5000 > 1000)',
      );
    }
    return null;
  }

  /**
   * 지금 시나리오가 재현하는 실패 (연결·인증만. 쿼리 거부는 연결 상태가 아니다).
   * 출처 상태·`capabilities` 안내가 live의 ping 결과와 같은 모양이 되게 한다
   */
  connectionFailure(): LogBackendError | null {
    const f = this.failure();
    return f && f.code !== 'LOG_BACKEND_QUERY_REJECTED' ? f : null;
  }

  ping(): Promise<void> {
    const f = this.failure();
    // 쿼리 거부는 연결 문제가 아니다 — ping은 통과한다
    if (f && f.code === 'LOG_BACKEND_AUTH_FAILED') return Promise.reject(f);
    if (this.down()) {
      return Promise.reject(
        new LogBackendError(
          'LOG_BACKEND_UNAVAILABLE',
          '로그 스택에 연결하지 못했습니다.',
        ),
      );
    }
    return Promise.resolve();
  }

  query(q: LogBackendQuery): Promise<LogBackendEntry[]> {
    const f = this.failure();
    if (f) return Promise.reject(f);
    if (this.down()) {
      return Promise.reject(
        new LogBackendError(
          'LOG_BACKEND_UNAVAILABLE',
          '로그 스택에 연결하지 못했습니다.',
        ),
      );
    }
    const pods = q.selector.pods.length ? q.selector.pods : ['unknown'];
    const container = q.selector.containers[0] ?? 'api';
    // 스택 시나리오에서도 **가림을 눈으로 확인**할 수 있어야 한다 (AC-LOG41은
    // AC-LOG04~08을 `stack` 출처에서 다시 확인하라고 요구한다).
    // 그래서 비밀값 픽스처를 섞어 준다 — 가림 규칙은 출처와 무관하게 하나다.
    const scenario = this.scenario();
    const limitPerPod = Math.max(20, Math.ceil(q.limit / pods.length));
    const base = [
      ...mockLogLines(scenario === 'stack' ? 'secrets' : scenario, {
        limit: limitPerPod,
      }).lines,
      ...mockLogLines('direct', { limit: limitPerPod }).lines,
    ];

    const entries: LogBackendEntry[] = [];
    pods.forEach((pod, podIndex) => {
      base.forEach((raw, i) => {
        // 픽스처는 `<ISO> <본문>` 모양이다. 스택은 시각과 본문을 나눠서 준다
        const sp = raw.indexOf(' ');
        const at = new Date(
          Date.parse(raw.slice(0, sp)) + podIndex * 137 + i,
        ).toISOString();
        entries.push({
          at,
          line: raw.slice(sp + 1),
          pod,
          container,
          // 스택은 stdout/stderr를 구분해 준다 (직접 조회는 못 한다)
          stream: i % 4 === 3 ? 'stderr' : 'stdout',
        });
      });
    });

    // **서버 검색**: 가져온 줄 밖의 결과도 나온다 (direct의 "화면 안에서 찾기"와 다르다)
    const text = q.search?.text;
    const filtered = text
      ? entries.filter((e) =>
          q.search?.caseSensitive
            ? e.line.includes(text)
            : e.line.toLowerCase().includes(text.toLowerCase()),
        )
      : entries;

    const inRange = filtered.filter((e) => {
      const t = Date.parse(e.at);
      return (
        t >= q.from.getTime() - 86_400_000 * 7 && t <= q.to.getTime() + 1000
      );
    });
    inRange.sort((a, b) => a.at.localeCompare(b.at));
    return Promise.resolve(inRange.slice(-q.limit));
  }

  tail(
    q: Omit<LogBackendQuery, 'from' | 'to'>,
    handlers: {
      onEntries: (entries: LogBackendEntry[]) => void;
      onError: (err: LogBackendError) => void;
    },
  ): LogBackendTailHandle {
    let n = 0;
    const timer = setInterval(() => {
      if (this.down()) {
        handlers.onError(
          new LogBackendError(
            'LOG_BACKEND_UNAVAILABLE',
            '로그 스택 연결이 끊겼습니다.',
          ),
        );
        return;
      }
      n += 1;
      const pods = q.selector.pods.length ? q.selector.pods : ['unknown'];
      handlers.onEntries(
        pods.map((pod, i) => ({
          at: new Date().toISOString(),
          line: `INFO  [http] GET /healthz 200 ${1 + ((n + i) % 3)}ms`,
          pod,
          container: q.selector.containers[0] ?? 'api',
          stream: 'stdout' as const,
        })),
      );
    }, TAIL_MS);
    timer.unref();
    return { close: (): void => clearInterval(timer) };
  }
}
