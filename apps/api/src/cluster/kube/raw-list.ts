import {
  HttpMethod,
  RequestContext,
  type KubeConfig,
  type KubernetesListObject,
  type KubernetesObject,
} from '@kubernetes/client-node';
// client-node 가 자기 API 호출에 쓰는 전송 계층 (번들된 undici fetch + KubeConfig 가 만든 dispatcher).
// Node 전역 fetch 는 undici 버전이 달라 dispatcher 를 받지 못한다.
import { IsomorphicFetchHttpLibrary } from '@kubernetes/client-node/dist/gen/http/isomorphic-fetch.js';

/** 목록 요청 실패 (informer 오류 처리가 statusCode/code 숫자를 본다) */
export class RawListError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: number,
  ) {
    super(`HTTP ${statusCode}`);
  }
}

const http = new IsomorphicFetchHttpLibrary();

/**
 * informer 목록 함수: 같은 경로를 GET 으로 불러 **원본 JSON 그대로** 준다 (docs/api/k8s-snapshot.md 10.1).
 * - 타입 API(ObjectSerializer)는 시각을 Date 로 바꾸고 클라이언트 모델에 없는 필드를 버린다.
 *   watch 이벤트는 원본 JSON 이라, 타입 목록을 쓰면 캐시 안에서 객체 모양이 섞인다(드리프트 가짜 차이).
 * - 인증·TLS 는 KubeConfig 가 붙인다 (loadFromCluster / loadFromDefault 모두). 읽기(GET)만 한다.
 */
export function makeRawLister<T extends KubernetesObject>(
  kc: KubeConfig,
  path: string,
): () => Promise<KubernetesListObject<T>> {
  return async () => {
    const server = (kc.getCurrentCluster()?.server ?? '').replace(/\/+$/, '');
    const ctx = new RequestContext(`${server}${path}`, HttpMethod.GET);
    ctx.setHeaderParam('Accept', 'application/json');
    ctx.setSignal(AbortSignal.timeout(60_000));
    await kc.applySecurityAuthentication(ctx);
    const res = await http.send(ctx).toPromise();
    if (res.httpStatusCode < 200 || res.httpStatusCode >= 300)
      throw new RawListError(res.httpStatusCode, res.httpStatusCode);
    return JSON.parse(await res.body.text()) as KubernetesListObject<T>;
  };
}
