/**
 * aws-snapshot-manager 쓰기 요청 (docs/api/aws-snapshot-manager.md 6.6·7·8·9절).
 * - 브라우저 → NestJS API 만 부른다(NEXT_PUBLIC_API_URL). AWS·클러스터·git 호출 없음.
 * - 쓰기 요청은 모두 `Content-Type: application/json`(계약 1.3). 본문이 필요 없는 새로고침·복원도 `{}`.
 *   apiFetch 는 객체 본문이면 JSON 헤더를 붙인다. DELETE 는 본문 없음(쿼리 `confirm`).
 * - 템플릿 내용은 LF 로 보낸다. 서버가 원래 줄바꿈·BOM 으로 되돌린다(계약 6.4·7.1).
 */
import { apiFetch } from "@/lib/api";

import type {
  CheckResponse,
  ConfirmKind,
  DeleteResponse,
  EditableKind,
  NotesResponse,
  RestoreResponse,
  SaveResponse,
  SummaryResponse,
} from "./types";

const BASE = "/aws-snapshots";
/** 템플릿 본문은 최대 5 MB 라 기본 10초보다 여유를 둔다 */
const WRITE_TIMEOUT_MS = 60_000;

const seg = (v: string) => encodeURIComponent(v);

export function refreshSnapshots(): Promise<SummaryResponse> {
  return apiFetch<SummaryResponse>(`${BASE}/refresh`, { method: "POST", body: {} });
}

export function checkTemplate(id: string, kind: EditableKind, content: string, baseVersion?: string): Promise<CheckResponse> {
  return apiFetch<CheckResponse>(`${BASE}/${seg(id)}/files/${kind}/check`, {
    method: "POST",
    body: baseVersion ? { content, baseVersion } : { content },
    timeoutMs: WRITE_TIMEOUT_MS,
  });
}

export function saveTemplate(
  id: string,
  kind: EditableKind,
  content: string,
  baseVersion: string,
  confirm: ConfirmKind[],
): Promise<SaveResponse> {
  return apiFetch<SaveResponse>(`${BASE}/${seg(id)}/files/${kind}`, {
    method: "PUT",
    body: confirm.length > 0 ? { content, baseVersion, confirm } : { content, baseVersion },
    timeoutMs: WRITE_TIMEOUT_MS,
  });
}

export function saveNotes(id: string, label: string, memo: string, baseVersion: string): Promise<NotesResponse> {
  return apiFetch<NotesResponse>(`${BASE}/${seg(id)}/notes`, {
    method: "PUT",
    body: { label, memo, baseVersion },
  });
}

export function moveToTrash(id: string): Promise<DeleteResponse> {
  return apiFetch<DeleteResponse>(`${BASE}/${seg(id)}`, { method: "DELETE", query: { confirm: id } });
}

export function restoreFromTrash(trashId: string): Promise<RestoreResponse> {
  return apiFetch<RestoreResponse>(`${BASE}/trash/${seg(trashId)}/restore`, { method: "POST", body: {} });
}

export function purgeFromTrash(trashId: string, snapshotId: string): Promise<{ purged: true; trashId: string; revision: number }> {
  return apiFetch(`${BASE}/trash/${seg(trashId)}`, { method: "DELETE", query: { confirm: snapshotId } });
}
