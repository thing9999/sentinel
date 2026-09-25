/**
 * `direct` 출처 — 쿠버네티스 `pods/log` 서브리소스의 **`get` 하나**만 쓴다.
 * `follow=true`도 같은 동사라 정지 조회와 따라가기가 이 경로 하나로 끝난다.
 * `pods/exec`·`pods/attach`·`pods/portforward`·쓰기 동사·`secrets`는 **쓰지 않는다** (AC-LOG01~03).
 *
 * **여기서 나가는 줄은 아직 원문이다.** 가림은 호출부(`logs.service.ts`)가
 * `createLineRedactor()`로 반드시 거친다 — 이 모듈의 반환값을 응답에 바로 싣지 말 것.
 * 이 모듈은 로그를 **어디에도 저장하지 않는다** (디스크·캐시·자체 로그 금지, P5).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Log } from '@kubernetes/client-node';
import { Writable } from 'node:stream';
import { KubeClientService } from '../cluster/kube/kube-watcher.service';

export type DirectErrorCode =
  | 'LOG_FORBIDDEN'
  | 'LOG_POD_NOT_FOUND'
  | 'LOG_CONTAINER_NOT_STARTED'
  | 'LOG_PREVIOUS_NOT_AVAILABLE'
  | 'LOG_KUBELET_UNREACHABLE'
  | 'LOG_SOURCE_NOT_CONFIGURED'
  | 'LOG_UPSTREAM_ERROR';

export class DirectLogError extends Error {
  constructor(
    readonly code: DirectErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DirectLogError';
  }
}

export interface DirectFetchOptions {
  namespace: string;
  pod: string;
  container: string;
  previous: boolean;
  tailLines: number;
  sinceSeconds: number | null;
  maxBytes: number;
  /** 정지 조회 안전 시간 초과 */
  timeoutMs?: number;
}

export interface DirectFetchResult {
  lines: string[];
  bytes: number;
  /** 바이트 상한에 걸려 더 못 가져왔다 */
  bytesLimitReached: boolean;
}

/** 줄 단위로 쪼개 콜백에 넘기는 싱크. 마지막 조각은 flush에서 내보낸다 */
class LineSink extends Writable {
  private buffer = '';
  bytes = 0;
  limitReached = false;

  constructor(
    private readonly onLine: (line: string) => void,
    private readonly maxBytes: number,
  ) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this.bytes >= this.maxBytes) {
      this.limitReached = true;
      cb();
      return;
    }
    this.bytes += buf.byteLength;
    if (this.bytes > this.maxBytes) this.limitReached = true;
    this.buffer += buf.toString('utf8');
    let nl = this.buffer.indexOf('\n');
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      this.onLine(line);
      nl = this.buffer.indexOf('\n');
    }
    cb();
  }

  override _final(cb: (err?: Error | null) => void): void {
    if (this.buffer.length > 0) {
      this.onLine(this.buffer.replace(/\r$/, ''));
      this.buffer = '';
    }
    cb();
  }
}

/**
 * 쿠버네티스 오류 → 안내 코드 (계약 6절). 테스트용으로 export한다(동작 무관).
 *
 * 주의(2026-09-25 테스트로 확인): `@kubernetes/client-node` 2.0의 `Log.log`는 **500일 때만** 응답 본문
 * (`Status.message`)을 읽는다. 400 등은 본문 없이 상태 코드만 준다 → 400에서는 아래 메시지 규칙
 * (`previous terminated…`, `is waiting to start`)이 **맞지 않는다.** 그래서 previous 400은 상태 코드로
 * 가르고, 그 밖의 400은 `details.status`를 남겨 호출부가 informer 캐시로 판단하게 한다.
 */
export function mapError(err: unknown, previous: boolean): DirectLogError {
  const code = (err as { code?: unknown })?.code;
  const status = typeof code === 'number' ? code : 0;
  const raw = err instanceof Error ? err.message : String(err);
  const body = (err as { body?: unknown })?.body;
  const message =
    typeof body === 'object' && body !== null && 'message' in body
      ? String(body.message)
      : raw;

  if (status === 403) {
    return new DirectLogError(
      'LOG_FORBIDDEN',
      'pods/log 권한이 없습니다. deploy/rbac.yaml을 다시 적용하세요.',
    );
  }
  if (status === 404) {
    return new DirectLogError(
      'LOG_POD_NOT_FOUND',
      '이 파드는 더 이상 존재하지 않습니다.',
    );
  }
  if (/previous terminated container .* not found/i.test(message)) {
    return new DirectLogError(
      'LOG_PREVIOUS_NOT_AVAILABLE',
      '이전 세대 로그가 없습니다.',
    );
  }
  if (/ContainerCreating|PodInitializing|is waiting to start/i.test(message)) {
    return new DirectLogError(
      'LOG_CONTAINER_NOT_STARTED',
      '컨테이너가 아직 시작되지 않았습니다.',
    );
  }
  // apiserver → kubelet 연결 실패. `TLS handshake timeout`·`error dialing backend`(konnectivity 등)도
  // 같은 성질이다 (PM 결정 2026-09-25). `context deadline exceeded`는 apiserver 자체 문제일 수 있어
  // 넣지 않는다 → LOG_UPSTREAM_ERROR. 실클러스터 문구는 월요일 확인 목록
  if (
    /dial tcp|connection refused|i\/o timeout|no route to host|TLS handshake timeout|error dialing backend/i.test(
      message,
    )
  ) {
    return new DirectLogError(
      'LOG_KUBELET_UNREACHABLE',
      // 문구 정본: 명세 3.4·디자인 8.7 (조회 안내와 같은 문장)
      '노드에 연결할 수 없어 로그를 읽지 못했습니다.',
    );
  }
  if (previous && status === 400) {
    return new DirectLogError(
      'LOG_PREVIOUS_NOT_AVAILABLE',
      '이전 세대 로그가 없습니다.',
    );
  }
  return new DirectLogError(
    'LOG_UPSTREAM_ERROR',
    '로그를 가져오지 못했습니다.',
    status ? { status } : undefined,
  );
}

@Injectable()
export class DirectLogSource {
  private readonly logger = new Logger(DirectLogSource.name);

  constructor(private readonly kube: KubeClientService) {}

  get available(): boolean {
    return this.kube.kc !== null;
  }

  /**
   * 정지 조회. `timestamps=true`로 받아 서버가 시각을 분리한다 (계약 4절).
   *
   * 오류·셀렉터·검색어를 **프로세스 자체 로그에 남기지 않는다** (P5, AC-LOG11) —
   * 실패는 코드로만 기록한다.
   */
  async fetch(opts: DirectFetchOptions): Promise<DirectFetchResult> {
    const kc = this.kube.kc;
    if (!kc) {
      throw new DirectLogError(
        'LOG_SOURCE_NOT_CONFIGURED',
        '클러스터 연결이 없습니다.',
      );
    }
    const lines: string[] = [];
    const sink = new LineSink((l) => lines.push(l), opts.maxBytes);
    const log = new Log(kc);
    let controller: AbortController;
    try {
      controller = await log.log(
        opts.namespace,
        opts.pod,
        opts.container,
        sink,
        {
          follow: false,
          previous: opts.previous,
          timestamps: true,
          tailLines: opts.tailLines,
          limitBytes: opts.maxBytes,
          ...(opts.sinceSeconds ? { sinceSeconds: opts.sinceSeconds } : {}),
        },
      );
    } catch (err) {
      throw mapError(err, opts.previous);
    }
    const timeoutMs = opts.timeoutMs ?? 30_000;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        resolve();
      }, timeoutMs);
      timer.unref();
      sink.once('finish', () => {
        clearTimeout(timer);
        resolve();
      });
      sink.once('error', (err) => {
        clearTimeout(timer);
        reject(mapError(err, opts.previous));
      });
    });
    return {
      lines,
      bytes: sink.bytes,
      bytesLimitReached: sink.limitReached,
    };
  }

  /**
   * 따라가기. 반환한 `close()`를 부르면 **위쪽 연결을 실제로 끊는다**
   * ("일시정지"는 화면 상태가 아니라 연결 해제다 — 계약 5절).
   */
  async follow(
    opts: Omit<DirectFetchOptions, 'previous'> & {
      onLine: (line: string) => void;
      onError: (err: DirectLogError) => void;
      onEnd: () => void;
    },
  ): Promise<{ close: () => void }> {
    const kc = this.kube.kc;
    if (!kc) {
      throw new DirectLogError(
        'LOG_SOURCE_NOT_CONFIGURED',
        '클러스터 연결이 없습니다.',
      );
    }
    const sink = new LineSink(opts.onLine, Number.MAX_SAFE_INTEGER);
    const log = new Log(kc);
    let controller: AbortController;
    try {
      controller = await log.log(
        opts.namespace,
        opts.pod,
        opts.container,
        sink,
        {
          follow: true,
          previous: false,
          timestamps: true,
          tailLines: opts.tailLines,
        },
      );
    } catch (err) {
      throw mapError(err, false);
    }
    sink.once('finish', opts.onEnd);
    sink.once('error', (err) => opts.onError(mapError(err, false)));
    return {
      close: (): void => {
        try {
          controller.abort();
        } catch {
          // 이미 끊겼으면 무시
        }
        sink.destroy();
      },
    };
  }
}
