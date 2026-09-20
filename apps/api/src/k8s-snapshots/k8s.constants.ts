/**
 * k8s-snapshot 상수 (docs/api/k8s-snapshot.md)
 */

export const TOPIC = 'k8s-snapshots';
export const SNAPSHOT_ID_RE = /^\d{8}-\d{6}$/;
export const TRASH_ID_RE = /^(\d{8}-\d{6})__(\d{8}T\d{9}Z)$/;
export const TRASH_DIR = '.trash';
export const PARTIAL_DIR_RE = /^\.\d{8}-\d{6}\.partial$/;
export const ROOT_IGNORED = new Set(['.gitkeep', TRASH_DIR]);
export const TMP_FILE_RE = /^\..+\.sentinel-tmp-[0-9a-f]+$/;
export const METADATA_FILE = 'metadata.json';
export const SECRET_REFS_FILE = 'secret-refs.json';
export const NOTES_FILE = 'notes.json';

export const CONFIRM_VALUES = [
  'secret_errors',
  'yaml_syntax',
  'multi_document',
  'identity_changed',
] as const;
export type ConfirmValue = (typeof CONFIRM_VALUES)[number];

export const MOCK_SCENARIOS = [
  'default',
  'empty',
  'not-configured',
  'unavailable',
  'read-only',
  'write-disabled',
  'conflict-once',
  'cluster-disconnected',
  'no-drift',
  'large',
] as const;
export type K8sMockScenario = (typeof MOCK_SCENARIOS)[number];

export const MOCK_OPTIONS: {
  id: K8sMockScenario;
  label: string;
  description: string;
}[] = [
  {
    id: 'default',
    label: '예시 스냅샷 (기본)',
    description:
      '파일 정상·주의·커밋 금지·알 수 없음, 드리프트 차이 있음·다른 클러스터·지난 결과 10개 + 휴지통 1개',
  },
  { id: 'empty', label: '스냅샷 0개', description: '빈 상태 + CLI 안내' },
  {
    id: 'unavailable',
    label: '폴더 없음',
    description: '스냅샷 폴더를 찾을 수 없음',
  },
  {
    id: 'not-configured',
    label: '설정 없음',
    description: 'K8S_SNAPSHOT_DIR 설정 없음',
  },
  { id: 'read-only', label: '읽기 전용', description: '편집·라벨·삭제 비활성' },
  {
    id: 'write-disabled',
    label: '쓰기 기능 꺼짐',
    description: '편집·라벨·삭제 비활성',
  },
  {
    id: 'conflict-once',
    label: '다음 저장 충돌',
    description: '다음 저장 한 번을 409로 응답 후 기본으로 복귀',
  },
  {
    id: 'cluster-disconnected',
    label: '클러스터 연결 없음',
    description: '드리프트 알 수 없음, 계산 버튼 비활성',
  },
  {
    id: 'no-drift',
    label: '드리프트 없음',
    description: '최신 스냅샷 드리프트 "차이 없음"',
  },
  {
    id: 'large',
    label: '대규모 (3D 성능)',
    description:
      '리소스 1,000개·3,200개 스냅샷 2개만 (3D 구성도 성능·묶어 보기 확인, 다른 클러스터라 드리프트 없음)',
  },
];

export const LABEL_MAX = 60;
export const MEMO_MAX = 2000;
export const VIEW_MIN_BYTES = 20 * 1024 * 1024;
export const STALE_AFTER_SEC = 90;

export const LEASE_TTL_MS = 120_000;
export const LEASE_RENEW_SEC = 60;
export const LEASE_MAX = 5;
export const RESULT_KEEP_MS = 10 * 60_000;
export const FIELDS_MAX = 500;

/** mock 대시보드 클러스터 (cluster mock info 와 같은 이름·버전) */
export const MOCK_CLUSTER_ID = '7d0c2b1e-3f4a-4c5b-8d6e-9f0a1b2c3d4e';
export const MOCK_OTHER_CLUSTER_ID = 'c3a9e0f2-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

export const CLI_COMMANDS = {
  install: 'npm install --prefix deploy/k8s-snapshot',
  configure:
    'deploy/k8s-snapshot/.env.example 을 .env 로 복사한 뒤 KUBE_CONTEXT 를 채우세요',
  dryRun: 'npm run export:dry --prefix deploy/k8s-snapshot',
  export: 'npm run export --prefix deploy/k8s-snapshot',
  scan: 'npm run scan --prefix deploy/k8s-snapshot -- snapshots/<id>',
  readme: 'deploy/k8s-snapshot/README.md',
  settings: [
    {
      name: 'KUBE_CONTEXT',
      required: true,
      text: '내보내기 전용 컨텍스트 이름 (필수, 비우면 종료코드 2)',
    },
    {
      name: 'KUBECONFIG',
      required: false,
      text: 'kubeconfig 경로 (비우면 사용자 기본)',
    },
    {
      name: 'SNAPSHOT_NAMESPACES',
      required: false,
      text: '포함할 네임스페이스 (비우면 시스템 제외 전체)',
    },
    {
      name: 'SNAPSHOT_EXCLUDE_NAMESPACES',
      required: false,
      text: '제외할 네임스페이스 (포함 목록과 함께 쓰지 않음)',
    },
    {
      name: 'SNAPSHOT_OPTIONAL_KINDS',
      required: false,
      text: '선택 종류 켜기 (jobs, clusterroles …)',
    },
    {
      name: 'SNAPSHOT_STRICT',
      required: false,
      text: '경고도 실패로 (true/false)',
    },
  ],
  exitCodes: [
    { code: 0, text: '성공, 스캔 통과' },
    { code: 1, text: '비밀값 의심 — 커밋 금지, 정리 후 재스캔' },
    { code: 2, text: '설정 오류 (폴더 없음)' },
    { code: 3, text: '클러스터 접속 실패·권한 없음·리소스 0개 (폴더 지움)' },
    {
      code: 4,
      text: '부분 성공 — 일부 종류를 읽지 못함 (metadata.kinds 확인)',
    },
  ],
};

export const SETUP_HINT = {
  envVar: 'K8S_SNAPSHOT_DIR',
  dockerMount: './deploy/k8s-snapshot/snapshots:/data/k8s-snapshots',
  localExample: 'K8S_SNAPSHOT_DIR=../../deploy/k8s-snapshot/snapshots',
};

export const DATA_NOT_INCLUDED_TEXT =
  '이 스냅샷은 Postgres 데이터와 PV 내용을 담지 않습니다. 스냅샷의 PVC 를 적용하면 빈 볼륨이 새로 만들어집니다 (README 8장)';

export const COMMANDS_NOTE =
  '대시보드는 이 명령을 실행하지 않습니다. kubectl diff 는 서버 측 dry-run 이라 적용할 클러스터에 쓰기 권한이 있는 컨텍스트가 필요합니다. 적용 전 kubectl diff 로 확인하세요';
