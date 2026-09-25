/**
 * 알림 키 → 화면 문구·경로 (docs/api/alerts.md 1.1·2.2).
 * **화면이 코드 → 문구/경로 매핑 표를 갖지 않는다.** 서버 한 곳에서 만든다.
 */
import type { Status } from '../common/status';
import {
  ALERT_AREA_KEYS,
  type AlertArea,
  type AlertKey,
  type AlertSeverity,
} from './alerts.types';

const AREA_OF_KEY: Record<AlertKey, AlertArea> = {
  'area:controlPlane': 'controlPlane',
  'area:nodes': 'nodes',
  'area:workloads': 'workloads',
  'area:pods': 'pods',
  'area:events': 'events',
  'area:db': 'db',
  'area:cost': 'cost',
  'source:kube': 'source',
  'system:restart': 'system',
  'system:test': 'system',
};

const AREA_LABEL: Record<AlertArea, string> = {
  controlPlane: '컨트롤 플레인',
  nodes: '노드',
  workloads: '워크로드',
  pods: '파드',
  events: '이벤트',
  db: '데이터베이스',
  cost: '비용',
  source: '쿠버네티스 연결',
  system: '시스템',
};

const KEY_LABEL: Record<AlertKey, string> = {
  'area:controlPlane': '컨트롤 플레인',
  'area:nodes': '노드',
  'area:workloads': '워크로드',
  'area:pods': '파드',
  'area:events': '이벤트',
  'area:db': '데이터베이스',
  'area:cost': '비용',
  'source:kube': '쿠버네티스 연결',
  'system:restart': '대시보드 재시작',
  'system:test': '테스트 발송',
};

/** 알림 키 → 화면 경로 (계약 2.2). 전용 화면이 없는 컨트롤 플레인은 노드 화면의 앵커 */
const KEY_HREF: Record<AlertKey, string | null> = {
  'area:controlPlane': '/cluster/nodes#control-plane',
  'area:nodes': '/cluster/nodes',
  'area:workloads': '/cluster/workloads',
  'area:pods': '/cluster/pods',
  'area:events': '/cluster/events',
  'area:db': '/cluster/db',
  'area:cost': '/cost',
  'source:kube': '/',
  'system:restart': null,
  'system:test': null,
};

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: '장애',
  warning: '주의',
  // **"장애"라는 낱말을 쓰지 않는다** (명세 3.2.4)
  unknown: '확인 불가',
  resolved: '해제',
};

/** 알림 본문 접두어 (계약 4.1) */
const SEVERITY_PREFIX: Record<AlertSeverity, string> = {
  critical: '[장애]',
  warning: '[주의]',
  unknown: '[확인 불가]',
  resolved: '[해제]',
};

export function areaOfKey(key: AlertKey): AlertArea {
  return AREA_OF_KEY[key] ?? 'system';
}

export function areaLabel(area: AlertArea): string {
  return AREA_LABEL[area] ?? area;
}

export function keyLabel(key: AlertKey): string {
  return KEY_LABEL[key] ?? key;
}

export function keyHref(key: AlertKey): string | null {
  return KEY_HREF[key] ?? null;
}

export function severityLabel(s: AlertSeverity): string {
  return SEVERITY_LABEL[s];
}

export function severityPrefix(s: AlertSeverity): string {
  return SEVERITY_PREFIX[s];
}

/** 감시 대상 키 목록 (배지·빈 상태 footer용). **시스템 키 2개는 넣지 않는다** */
export function watchKeys(): { key: AlertKey; label: string }[] {
  return ALERT_AREA_KEYS.map((key) => ({ key, label: keyLabel(key) }));
}

/** 전이 상태 → 알림 심각도. 새 등급을 만들지 않고 StatusInfo.status를 그대로 옮긴다 */
export function severityFromStatus(to: Status): AlertSeverity {
  if (to === 'ok') return 'resolved';
  return to;
}

const SEVERITY_RANK: Record<'critical' | 'warning' | 'unknown', number> = {
  critical: 3,
  warning: 2,
  unknown: 1,
};

/** 미확인 알림 중 최악 (계약 2.3). resolved·test는 세지 않는다 */
export function worstSeverity(
  list: Iterable<AlertSeverity>,
): 'critical' | 'warning' | 'unknown' | null {
  let worst: 'critical' | 'warning' | 'unknown' | null = null;
  for (const s of list) {
    if (s === 'resolved') continue;
    if (worst === null || SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}
