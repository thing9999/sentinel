// 쿠버네티스 읽기 (docs/api/k8s-snapshot.md 4.4, AC-K13).
// - 모든 요청은 getJson 한 함수로 간다: GET 만, 쿼리는 limit·continue 만. watch·dryRun·exec 없음.
// - 응답은 원본 JSON 그대로 (ObjectSerializer 를 거치지 않는다: 타입 변환·모르는 필드 제거를 피한다).
// - 인증은 @kubernetes/client-node 의 KubeConfig 로만 받는다 (EKS exec 플러그인 포함). kubectl 을 실행하지 않는다.

export class KubeHttpError extends Error {
  constructor(status, path) {
    super(`HTTP ${status}`);
    this.status = status;
    this.path = path;
  }
}

export class KubeConnectError extends Error {}

const ALLOWED_QUERY = new Set(['limit', 'continue']);
const ALLOWED_PATH_RE = /^\/(version|api(\/[a-z0-9]+)?(\/[A-Za-z0-9._~%-]+)*|apis(\/[A-Za-z0-9._~%-]+)*)$/;

/** 서버 URL·토큰이 오류 메시지에 남지 않게 */
export function sanitizeMessage(msg) {
  return String(msg ?? '')
    .replace(/https?:\/\/[^\s'"]+/g, '<server>')
    .replace(/(bearer|token)[=: ]+\S+/gi, '$1 <hidden>')
    .slice(0, 200);
}

/**
 * @param {{ transport: (req: { method: 'GET', path: string, query: Record<string,string> }) => Promise<{ status: number, body: any }> }} p
 */
export function createClient({ transport }) {
  async function getJson(path, query = {}) {
    if (!ALLOWED_PATH_RE.test(path)) throw new Error(`허용되지 않은 경로: ${path}`);
    for (const k of Object.keys(query)) if (!ALLOWED_QUERY.has(k)) throw new Error(`허용되지 않은 쿼리: ${k}`);
    let res;
    try {
      res = await transport({ method: 'GET', path, query });
    } catch (err) {
      throw new KubeConnectError(sanitizeMessage(err?.message ?? err));
    }
    if (res.status === 401) throw new KubeConnectError('인증 실패 (401). 컨텍스트의 자격증명을 확인하세요');
    if (res.status < 200 || res.status >= 300) throw new KubeHttpError(res.status, path);
    return res.body;
  }

  /** 목록 전체 (limit 500 + continue 반복). 항목에 apiVersion/kind 는 없다 */
  async function listAll(path) {
    const items = [];
    let cont;
    for (let i = 0; i < 1000; i++) {
      const q = { limit: '500' };
      if (cont) q.continue = cont;
      const body = await getJson(path, q);
      for (const it of body?.items ?? []) items.push(it);
      cont = body?.metadata?.continue;
      if (!cont) break;
    }
    return items;
  }

  return { getJson, listAll };
}

/** kubeconfig 를 읽기만 한다 (인증·호출 없음). dry-run·컨텍스트 확인용 */
export async function inspectKubeconfig(kubeconfigPath) {
  const { KubeConfig } = await import('@kubernetes/client-node');
  const kc = new KubeConfig();
  if (kubeconfigPath) kc.loadFromFile(kubeconfigPath);
  else kc.loadFromDefault();
  return {
    contexts: kc.getContexts().map((c) => c.name),
    clusterNameOf(context) {
      const c = kc.getContextObject(context);
      return c ? clusterDisplayName(c.cluster) : null;
    },
  };
}

/** EKS ARN 이면 클러스터 이름만 (계정 ID 를 남기지 않는다) */
export function clusterDisplayName(name) {
  if (!name) return null;
  const m = /cluster\/([^/]+)$/.exec(name);
  return m ? m[1] : name;
}

/**
 * 실제 전송 계층: KubeConfig 로 인증을 붙여 fetch (GET 만).
 * @returns {Promise<(req) => Promise<{status:number, body:any}>>}
 */
export async function realTransport({ kubeconfigPath, context, timeoutMs = 30_000 }) {
  const { KubeConfig, RequestContext, HttpMethod } = await import('@kubernetes/client-node');
  // client-node 가 자기 API 에 쓰는 전송 계층 (번들된 undici + KubeConfig 의 dispatcher). Node 전역 fetch 와 버전이 다르다
  const { IsomorphicFetchHttpLibrary } = await import('@kubernetes/client-node/dist/gen/http/isomorphic-fetch.js');
  const http = new IsomorphicFetchHttpLibrary();
  const kc = new KubeConfig();
  if (kubeconfigPath) kc.loadFromFile(kubeconfigPath);
  else kc.loadFromDefault();
  kc.setCurrentContext(context);
  const cluster = kc.getCurrentCluster();
  if (!cluster?.server) throw new KubeConnectError('컨텍스트에 클러스터 서버가 없습니다');
  const server = cluster.server.replace(/\/+$/, '');
  return async ({ method, path, query }) => {
    if (method !== 'GET') throw new Error('GET 만 허용');
    const url = new URL(server + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const ctx = new RequestContext(url.toString(), HttpMethod.GET);
    ctx.setHeaderParam('Accept', 'application/json');
    ctx.setSignal(AbortSignal.timeout(timeoutMs));
    await kc.applySecurityAuthentication(ctx);
    const res = await http.send(ctx).toPromise();
    let body = null;
    try {
      body = JSON.parse(await res.body.text());
    } catch {
      body = null;
    }
    return { status: res.httpStatusCode, body };
  };
}
