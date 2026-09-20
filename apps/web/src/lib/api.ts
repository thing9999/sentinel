/**
 * NestJS API 호출용 fetch 래퍼.
 *
 * - 브라우저: NEXT_PUBLIC_API_URL (빌드 시 번들에 인라인됨)
 * - 서버(서버 컴포넌트, Route Handler): API_INTERNAL_URL (컨테이너 간 주소, 런타임에 읽음)
 * - 둘 다 없으면 http://localhost:3001
 * - 모든 경로는 `/api` prefix 아래로 붙는다. 예: apiUrl("/health") → http://localhost:3001/api/health
 */

export const DEFAULT_API_URL = "http://localhost:3001";
export const API_PREFIX = "/api";
const DEFAULT_TIMEOUT_MS = 10_000;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return trimTrailingSlash(
      process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL,
    );
  }
  // NEXT_PUBLIC_* 는 `process.env.NEXT_PUBLIC_API_URL` 형태로 직접 참조해야 인라인된다.
  return trimTrailingSlash(process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL);
}

export type QueryValue = string | number | boolean | null | undefined;

/** `/api` 아래 경로를 절대 URL로 만든다. path는 `/`로 시작하지 않아도 된다. */
export function apiUrl(path: string, query?: Record<string, QueryValue>): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = `${getApiBaseUrl()}${API_PREFIX}${normalized}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

/**
 * - network: 서버에 닿지 못함 (연결 거부, DNS, CORS 등)
 * - timeout: timeoutMs 안에 응답 없음
 * - http: 2xx가 아닌 응답
 * - parse: 응답 본문이 JSON이 아님
 * - aborted: 호출자가 signal로 취소함
 */
export type ApiErrorKind = "network" | "timeout" | "http" | "parse" | "aborted";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly url: string;
  /** http 에러일 때만 값이 있다. */
  readonly status?: number;
  /** 에러 응답 본문 (JSON이면 파싱된 값, 아니면 문자열). 형식은 docs/api 계약을 따른다. */
  readonly body?: unknown;

  constructor(
    kind: ApiErrorKind,
    message: string,
    details: { url: string; status?: number; body?: unknown; cause?: unknown },
  ) {
    super(message, { cause: details.cause });
    this.name = "ApiError";
    this.kind = kind;
    this.url = details.url;
    this.status = details.status;
    this.body = details.body;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  query?: Record<string, QueryValue>;
  /** 객체면 JSON으로 직렬화한다. */
  body?: unknown;
  /** 기본 10초. 0이면 타임아웃 없음. */
  timeoutMs?: number;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { query, body, timeoutMs = DEFAULT_TIMEOUT_MS, headers, signal, ...init } = options;
  const url = apiUrl(path, query);

  const controller = new AbortController();
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  const finalHeaders = new Headers(headers);
  if (!finalHeaders.has("Accept")) finalHeaders.set("Accept", "application/json");
  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    if (typeof body === "string" || body instanceof FormData || body instanceof Blob) {
      requestBody = body;
    } else {
      requestBody = JSON.stringify(body);
      if (!finalHeaders.has("Content-Type")) finalHeaders.set("Content-Type", "application/json");
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: finalHeaders,
      body: requestBody,
      signal: controller.signal,
    });
  } catch (cause) {
    if (timedOut) {
      throw new ApiError("timeout", `API 응답 시간 초과 (${timeoutMs}ms): ${url}`, { url, cause });
    }
    if (controller.signal.aborted) {
      throw new ApiError("aborted", `API 요청 취소: ${url}`, { url, cause });
    }
    throw new ApiError("network", `API에 연결할 수 없음: ${url}`, { url, cause });
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  if (!res.ok) {
    const errorBody = await readBody(res).catch(() => undefined);
    throw new ApiError("http", `API 오류 ${res.status}: ${url}`, {
      url,
      status: res.status,
      body: errorBody,
    });
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new ApiError("parse", `API 응답이 JSON이 아님: ${url}`, { url, status: res.status, body: text, cause });
  }
}
