/**
 * k8s-snapshot 쓰기·계산 요청 (docs/api/k8s-snapshot.md 6.7·7·8·9·10.8절).
 * - 브라우저 → NestJS API 만 부른다(NEXT_PUBLIC_API_URL). 쿠버네티스 API·AWS·git·kubectl 호출 없음.
 * - 쓰기·계산 요청은 모두 `Content-Type: application/json`(계약 1.3). 본문이 필요 없는 새로고침·복원도 `{}`.
 *   apiFetch 는 객체 본문이면 JSON 헤더를 붙인다. DELETE 는 본문 없음(쿼리 `confirm`).
 * - 파일은 서버가 `files[].path`로 준 상대 경로만 `path` 쿼리로 지정한다(5.4, 16절 4).
 * - 파일 내용은 LF 로 보낸다. 서버가 원래 줄바꿈·BOM 으로 되돌린다(ASM 7.1).
 */
import { apiFetch } from "@/lib/api";

import type {
  DriftResponse,
  K8sCheckResponse,
  K8sConfirmKind,
  K8sDeleteResponse,
  K8sNotesResponse,
  K8sRestoreResponse,
  K8sSaveResponse,
  K8sSummaryResponse,
} from "./types";

export const K8S_BASE = "/k8s-snapshots";
/** 파일 본문은 최대 5 MB 라 기본 10초보다 여유를 둔다 */
const WRITE_TIMEOUT_MS = 60_000;
/** 드리프트는 서버가 계산을 끝낸 뒤 응답한다(10.8) */
const DRIFT_TIMEOUT_MS = 30_000;

const seg = (v: string) => encodeURIComponent(v);

export const detailPath = (id: string) => `${K8S_BASE}/${seg(id)}`;
export const filePath = (id: string) => `${K8S_BASE}/${seg(id)}/file`;
export const driftPath = (id: string) => `${K8S_BASE}/${seg(id)}/drift`;
/** 3D 보기·관계 표가 **함께** 쓰는 그래프 (docs/api/snapshot-3d.md 2절). 조회는 이 한 번뿐이다 */
export const graphPath = (id: string) => `${K8S_BASE}/${seg(id)}/graph`;

export function refreshK8sSnapshots(): Promise<K8sSummaryResponse> {
  return apiFetch<K8sSummaryResponse>(`${K8S_BASE}/refresh`, { method: "POST", body: {} });
}

export function checkK8sFile(id: string, path: string, content: string, baseVersion?: string): Promise<K8sCheckResponse> {
  return apiFetch<K8sCheckResponse>(`${K8S_BASE}/${seg(id)}/file/check`, {
    method: "POST",
    query: { path },
    body: baseVersion ? { content, baseVersion } : { content },
    timeoutMs: WRITE_TIMEOUT_MS,
  });
}

export function saveK8sFile(
  id: string,
  path: string,
  content: string,
  baseVersion: string,
  confirm: K8sConfirmKind[],
): Promise<K8sSaveResponse> {
  return apiFetch<K8sSaveResponse>(filePath(id), {
    method: "PUT",
    query: { path },
    body: confirm.length > 0 ? { content, baseVersion, confirm } : { content, baseVersion },
    timeoutMs: WRITE_TIMEOUT_MS,
  });
}

export function saveK8sNotes(id: string, label: string, memo: string, baseVersion: string): Promise<K8sNotesResponse> {
  return apiFetch<K8sNotesResponse>(`${K8S_BASE}/${seg(id)}/notes`, {
    method: "PUT",
    body: { label, memo, baseVersion },
  });
}

export function moveK8sToTrash(id: string): Promise<K8sDeleteResponse> {
  return apiFetch<K8sDeleteResponse>(detailPath(id), { method: "DELETE", query: { confirm: id } });
}

export function restoreK8sFromTrash(trashId: string): Promise<K8sRestoreResponse> {
  return apiFetch<K8sRestoreResponse>(`${K8S_BASE}/trash/${seg(trashId)}/restore`, { method: "POST", body: {} });
}

export function purgeK8sFromTrash(trashId: string, snapshotId: string): Promise<{ purged: true; trashId: string; revision: number }> {
  return apiFetch(`${K8S_BASE}/trash/${seg(trashId)}`, { method: "DELETE", query: { confirm: snapshotId } });
}

/**
 * 드리프트 계산 요청 + 임대(10.8). `force: true` = "드리프트 계산"·"다시 계산" 버튼,
 * `force: false` = 드리프트 탭을 여는 동안 60초마다 보내는 임대 갱신.
 */
export function requestDrift(id: string, force: boolean): Promise<DriftResponse> {
  return apiFetch<DriftResponse>(driftPath(id), { method: "POST", body: { force }, timeoutMs: DRIFT_TIMEOUT_MS });
}
