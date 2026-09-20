# API 계약: snapshot-3d (1단계 — K8s 구성도 + 드리프트)

- 작성: backend, 2026-09-20 (4단계 계약. **구현 전**)
- 명세: `docs/specs/snapshot-3d.md` (확정본. 이하 **명세**). **이번 범위는 1단계(AC-3D01~33)뿐**이다. 2~4단계(AWS 구성도·시간축·통합 장면, AC-3D34~56)는 **보류**이며 이 문서에 계약을 두지 않는다(확장 자리만 18절).
- 디자인: `docs/design/snapshot-3d.md` (이하 **3D-D**. 14절 "화면이 필요로 하는 값"을 이 계약이 채운다), `docs/design/status.md` 11절, `docs/design/components.md` 16·17절, `docs/design/k8s-snapshot.md`(상세 탭 6개, `?view=3d`).
- 재사용 원본: `docs/api/k8s-snapshot.md` (이하 **K8S-API**). "K8S-API n절과 같음"이라고 쓴 곳은 그 절의 모양·규칙을 그대로 쓰고 다른 점만 적는다.
- 공통 규약: `docs/api/common.md` (이 기능으로 더한 곳은 common.md 8절 변경 이력). **이 문서는 `common.md` 1.4의 예외를 만들지 않는다**(명세 7절).
- DBA: **할 일 없음**. 대시보드 자체 DB·모니터링 대상 DB를 쓰지 않는다. 그래프는 파일에서 만들고 메모리에만 캐시한다.

**이 계약의 경계**

- 새 엔드포인트는 **한 개**다: `GET /api/k8s-snapshots/:id/graph`. 3D 장면과 대체 보기(관계 표)가 **같은 응답 하나**로 그려진다(별도 엔드포인트 없음, 9절).
- 기존 `/api/k8s-snapshots/**`·`/api/aws-snapshots/**`·`/api/snapshot-menu` 응답, SSE 이벤트 이름·payload, mock 그룹 키는 **바꾸지 않는다**(17절, AC-K17~K19·AC-3D23).
- 조회 전용이다. 파일·`notes.json`에 쓰지 않고, 쿠버네티스·AWS를 새로 부르지 않으며, **드리프트를 새로 계산하지 않는다**(기존 결과만 겹친다, AC-3D13). RBAC(`deploy/rbac.yaml`)·IAM은 그대로다.
- 비밀값·원문 값은 응답에 없다(4.4 표시 필드 화이트리스트, AC-3D14). 레이블·셀렉터·어노테이션·env·command/args·ConfigMap/Secret 내용은 **서버 안에서 비교에만** 쓰고 결과(선·표식·문구)만 내보낸다.
- **좌표를 주지 않는다.** 서버가 주는 것은 **소속과 순서**이고, 배치는 화면이 3D-D 4.1~4.3 규칙으로 계산한다(3D-D 14절).

---

## 0. 화면 ↔ 엔드포인트

| 화면 (3D-D) | REST | SSE |
|---|---|---|
| 상세 **3D 보기** 탭(`?view=3d`) 장면 전체: 판·블록·선·표식 (3D-D 4절) | `GET /api/k8s-snapshots/:id/graph` | `k8s-snapshots.changed`(`changedIds`) → 다시 조회, `k8s-snapshots.drift`(`snapshotId`) → 다시 조회 |
| 같은 탭의 **관계 표**(`gview=table`, 3D-D 8절) | 같은 응답(9절) | 같음 |
| 정보 줄·범례 수치(3D-D 6.4), 표 위 요약(3D-D 8.2) | 같은 응답 `graph.summary` | — |
| 선택 정보 패널의 관계 목록·근거·표식(3D-D 7절) | 같은 응답 `blocks[]`·`edges[]` | — |
| 필터·검색 개수(`gns`·`gkind`·`grel`·`gmark`) | 같은 응답 `graph.facets` | — |
| [드리프트 계산] / 3D 보기를 열어 둔 동안의 임대 갱신 (3D-D 10.2) | **기존** `POST /api/k8s-snapshots/:id/drift` (K8S-API 10.8, 그대로) | `k8s-snapshots.drift` |
| [파일에서 보기]·[드리프트에서 보기]·[Secret 참조에서 보기] (3D-D 10.4) | 기존 상세 주소(`?view=files&file=&line=`, `?view=drift&res=`, `?view=secrets`) | — |
| MOCK 배지 Popover | 기존 그룹 `k8s-snapshots`에 시나리오 1개 추가(12.5) | `k8s-snapshots.snapshot` 재전송 |

**새 SSE 토픽·이벤트는 없다.** 명세 4.1 "스트림에 3D 데이터를 싣지 않는다"대로, 화면은 기존 변경 알림을 받고 이 엔드포인트를 다시 부른다(30초 이내 반영, AC-3D16). "구성이 바뀌었습니다"(3D-D 9.8)는 화면이 이전 응답과 새 응답의 `graph.version`·`summary`를 비교해 판단한다.

**출처 ↔ 데이터** (`common.md` 2.3): 판·블록·관계·스캔 표식 = `k8sSnapshotStore`, 드리프트 표식 = `kube`. 새 출처(`SourceId`)는 만들지 않는다.

---

## 1. 공통 규칙 (이 기능)

1. **경로·식별자 검증**은 K8S-API 1.1과 같다. `:id`는 `^\d{8}-\d{6}$`만, 그 밖은 400 `VALIDATION_FAILED`(`field: "id"`). 파일 시스템 접근 전에 거부한다. 휴지통 스냅샷은 404.
2. **읽기 전용**이다. `POST`/`PUT`/`DELETE` 변형을 만들지 않는다(AC-3D15).
3. **서버가 판단하고 화면은 그린다**(`common.md` 2.2, 명세 3.0, 3D-D 14절): 블록의 식별값·판·**층**·순서·관계선·근거·확실성·유령 사유·표시 문구·드리프트 구분·스캔 등급·개수는 모두 서버 값이다. 화면은 종류→층 표를 따로 갖지 않는다.
4. **응답에 값이 없다**(AC-3D14): env 값, command/args, 어노테이션 값, 레이블·셀렉터 원문, ConfigMap/Secret 내용, 컨테이너 이미지 문자열, ARN·계정 ID는 어느 필드에도 없다. 내보내는 문자열은 **식별값**(종류·이름·네임스페이스·파일 경로·참조 대상 이름·컨테이너 이름), 4.4 화이트리스트, 서버가 만든 한국어 문구뿐이다.
   - 서버 문구는 `common.md` 1.4대로 비밀값 가림(`redactSecrets`)·길이 제한을 거친다.
   - 로그에는 스냅샷 ID·개수·코드만(K8S-API 1.4). 리소스 이름·관계 목록을 로그에 남기지 않는다.
5. **시각·단위**는 `common.md` 1.5·1.6과 같다. 응답 최상위에 `dataSource`·`generatedAt`(`common.md` 1.4).

---

## 2. `GET /api/k8s-snapshots/:id/graph`

스냅샷 하나의 **구성 그래프**(판·블록·관계선)와 겹쳐 보기(드리프트·스캔·Helm)를 한 번에 준다.

### 2.1 요청

```
GET /api/k8s-snapshots/20260919-061000/graph
Accept: application/json
```

| 쿼리 | 형식 | 기본 | 설명 |
|---|---|---|---|
| `rules` | 쉼표 `K1`~`K11` | **전체(K1~K11)** | 응답에 담을 관계 종류. 기본이 전체이므로 화면 필터(`grel`)는 **다시 조회하지 않고** 응답 안에서 켜고 끈다(AC-3D10). payload를 줄이고 싶을 때만 쓴다. 모르는 값이면 400 |
| `drift` | `on` \| `off` | `on` | `off`면 드리프트 겹쳐 보기를 만들지 않는다(`graph.drift.requested: false`, 블록 `markers.drift: null`). 화면 `gdrift=0`과 달리 **서버 호출을 줄이려는 용도**이고, 어느 값이든 **계산은 하지 않는다**(7.1) |

- 전역 `ValidationPipe({ whitelist: true })`가 DTO에 없는 쿼리를 조용히 버린다(`common.md` 1.3). 화면의 `g*` 쿼리(필터·검색·선택·라벨 밀도)는 **서버로 보내지 않는다**.
- `limit`/`offset`은 **없다**: 3D와 관계 표가 같은 배열을 써야 개수가 어긋나지 않는다(AC-3D04).

### 2.2 응답 200 (mock K-1 `20260919-061000`, 일부 생략)

```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-20T04:10:00.000Z",
  "revision": 17,
  "snapshotId": "20260919-061000",
  "graph": {
    "state": "ok",
    "version": "sha256:9c1f…",
    "builtAt": "2026-09-20T04:09:58.120Z",
    "rulesVersion": 1,
    "snapshotStatus": { "status": "ok", "reasons": [], "updatedAt": "…", "statusChangedAt": "…", "stale": false },
    "cluster": { "id": "7d0c2b1e-3f4a-4c5b-8d6e-9f0a1b2c3d4e", "context": "sentinel-snapshot", "name": "prod-eks", "relation": "same" },

    "summary": {
      "plates": 5,
      "documents": 30,
      "namespaceDocuments": 5,
      "resourceBlocks": 25,
      "ghosts": 9,
      "unparsedBlocks": 0,
      "blocks": 34,
      "edges": 28,
      "edgesDefaultOn": 15,
      "driftMarkers": 3,
      "scanMarkers": 0,
      "outsideFindings": 0,
      "grouped": false,
      "groupThreshold": 3000,
      "truncated": { "blocks": false, "edges": false, "droppedBlocks": 0, "droppedEdges": 0, "reason": null }
    },

    "layers": [
      { "id": "storage", "label": "저장·설정", "kinds": ["PersistentVolumeClaim", "ConfigMap", "Secret"] },
      { "id": "workload", "label": "워크로드", "kinds": ["Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job"] },
      { "id": "service", "label": "서비스", "kinds": ["Service"] },
      { "id": "ingress", "label": "진입", "kinds": ["Ingress"] },
      { "id": "aux", "label": "곁", "kinds": ["HorizontalPodAutoscaler", "PodDisruptionBudget", "NetworkPolicy", "ServiceAccount", "Role", "RoleBinding", "ResourceQuota", "LimitRange", "*"] }
    ],

    "rules": [
      { "id": "K1", "label": "Ingress → Service", "evidenceDefault": "backend.service.name", "certainty": "confirmed", "defaultOn": true, "count": 2, "excluded": false },
      { "id": "K2", "label": "Service → 워크로드", "evidenceDefault": "셀렉터", "certainty": "estimated", "defaultOn": true, "count": 4, "excluded": false },
      { "id": "K8", "label": "PDB → 워크로드", "evidenceDefault": "셀렉터", "certainty": "estimated", "defaultOn": false, "count": 1, "excluded": false }
    ],

    "plates": [
      {
        "id": "ns:batch", "kind": "namespace", "name": "batch", "system": false,
        "file": "batch/namespace.yaml", "fileLine": 1,
        "resourceCount": 4, "ghostCount": 1,
        "byLayer": { "storage": 1, "workload": 3, "aux": 1 },
        "markers": { "scan": { "errors": 0, "warnings": 0, "level": null, "count": 0, "firstLine": null }, "drift": { "change": "same", "fieldCount": 0, "hidden": { "default": 0, "managed": 0 }, "reasonCode": null, "reasonText": null }, "fileIssue": null, "helm": false },
        "notes": [],
        "navigate": { "primary": "files", "file": "batch/namespace.yaml", "line": 1, "resourceKey": "core/Namespace/_cluster/batch", "secretName": null }
      },
      { "id": "ns:data", "kind": "namespace", "name": "data", "system": false, "file": "data/namespace.yaml", "fileLine": 1, "resourceCount": 7, "ghostCount": 2, "byLayer": { "storage": 5, "workload": 2, "service": 1, "aux": 1 }, "markers": { "…": "…" }, "notes": [], "navigate": { "…": "…" } },
      { "id": "ns:default", "kind": "namespace", "name": "default", "system": false, "file": "default/namespace.yaml", "fileLine": 1, "resourceCount": 0, "ghostCount": 0, "byLayer": {}, "markers": { "…": "…" }, "notes": [], "navigate": { "…": "…" } },
      { "id": "ns:monitoring", "kind": "namespace", "name": "monitoring", "system": false, "file": "monitoring/namespace.yaml", "fileLine": 1, "resourceCount": 3, "ghostCount": 1, "byLayer": { "storage": 1, "workload": 1, "service": 1, "aux": 1 }, "markers": { "…": "…" }, "notes": [], "navigate": { "…": "…" } },
      { "id": "ns:prod", "kind": "namespace", "name": "prod", "system": false, "file": "prod/namespace.yaml", "fileLine": 1, "resourceCount": 11, "ghostCount": 5, "byLayer": { "storage": 2, "workload": 4, "service": 2, "ingress": 2, "aux": 6 }, "markers": { "…": "…" }, "notes": [], "navigate": { "…": "…" } }
    ],

    "blocks": [
      {
        "id": "apps/Deployment/prod/api",
        "blockType": "resource",
        "plateId": "ns:prod",
        "layer": "workload",
        "kind": "Deployment", "apiGroup": "apps", "apiVersion": "apps/v1",
        "namespace": "prod", "name": "api",
        "resourceKey": "apps/Deployment/prod/api",
        "kindDir": "deployments", "custom": false,
        "file": { "path": "prod/deployments/api.yaml", "line": 1, "documentIndex": 0, "documentCount": 1 },
        "summary": { "replicas": 5, "containers": 2, "initContainers": 0, "serviceAccountName": "api" },
        "ghost": null,
        "markers": {
          "scan": { "errors": 0, "warnings": 0, "level": null, "count": 0, "firstLine": null },
          "drift": { "change": "changed", "fieldCount": 3, "hidden": { "default": 3, "managed": 1 }, "reasonCode": null, "reasonText": null },
          "fileIssue": null,
          "helm": false
        },
        "notes": [],
        "system": false,
        "degree": { "in": 3, "out": 3 },
        "navigate": { "primary": "drift", "file": "prod/deployments/api.yaml", "line": 1, "resourceKey": "apps/Deployment/prod/api", "secretName": null }
      },
      {
        "id": "ghost:core/Secret/data/postgres-credentials",
        "blockType": "ghost", "plateId": "ns:data", "layer": "storage",
        "kind": "Secret", "apiGroup": "", "apiVersion": null, "namespace": "data", "name": "postgres-credentials",
        "resourceKey": null, "kindDir": "secrets", "custom": false, "file": null,
        "summary": { "referencedKeys": 1 },
        "ghost": { "reason": "secret", "text": "Secret — 이름만, 값 없음" },
        "markers": { "scan": { "errors": 0, "warnings": 0, "level": null, "count": 0, "firstLine": null }, "drift": null, "fileIssue": null, "helm": false },
        "notes": [],
        "system": false,
        "degree": { "in": 1, "out": 0 },
        "ghostFromRules": ["K6"],
        "navigate": { "primary": "secrets", "file": null, "line": null, "resourceKey": null, "secretName": "postgres-credentials" }
      },
      {
        "id": "ghost:apps/Deployment/prod/payments",
        "blockType": "ghost", "plateId": "ns:prod", "layer": "workload",
        "kind": "Deployment", "apiGroup": "apps", "apiVersion": "apps/v1", "namespace": "prod", "name": "payments",
        "resourceKey": "apps/Deployment/prod/payments", "kindDir": "deployments", "custom": false, "file": null,
        "summary": { "replicas": 0, "containers": 1 },
        "ghost": { "reason": "drift_added", "text": "추가됨 (클러스터에만 있음)" },
        "markers": { "scan": { "errors": 0, "warnings": 0, "level": null, "count": 0, "firstLine": null }, "drift": { "change": "added", "fieldCount": 0, "hidden": { "default": 0, "managed": 0 }, "reasonCode": null, "reasonText": null }, "fileIssue": null, "helm": false },
        "notes": [],
        "system": false,
        "degree": { "in": 0, "out": 0 },
        "ghostFromRules": [],
        "navigate": { "primary": "drift", "file": null, "line": null, "resourceKey": "apps/Deployment/prod/payments", "secretName": null }
      }
    ],

    "edges": [
      {
        "id": "K1|networking.k8s.io/Ingress/prod/api-public|core/Service/prod/api",
        "rule": "K1",
        "from": "networking.k8s.io/Ingress/prod/api-public",
        "to": "core/Service/prod/api",
        "certainty": "confirmed",
        "toGhost": false,
        "optional": false,
        "evidence": "Ingress 규칙의 backend.service.name",
        "evidenceItems": [ { "code": "INGRESS_BACKEND", "text": "Ingress 규칙의 backend.service.name", "container": null } ],
        "evidenceTruncated": false
      },
      {
        "id": "K5|apps/Deployment/prod/api|core/ConfigMap/prod/api-config",
        "rule": "K5", "from": "apps/Deployment/prod/api", "to": "core/ConfigMap/prod/api-config",
        "certainty": "confirmed", "toGhost": false, "optional": false,
        "evidence": "envFrom.configMapRef (컨테이너 api)",
        "evidenceItems": [ { "code": "ENV_FROM_CONFIGMAP", "text": "envFrom.configMapRef", "container": "api" } ],
        "evidenceTruncated": false
      }
    ],

    "groups": [
      { "plateId": "ns:prod", "layer": "workload", "kind": "Deployment", "apiGroup": "apps", "count": 3, "ghostCount": 1,
        "drift": { "changed": 1, "deleted": 0, "added": 1, "uncomparable": 0, "skipped": 0 },
        "scan": { "errors": 0, "warnings": 0 } }
    ],

    "facets": {
      "namespaces": [ { "plateId": "ns:prod", "name": "prod", "count": 16 } ],
      "kinds": [ { "kind": "Deployment", "apiGroup": "apps", "count": 6 } ],
      "rules": [ { "id": "K1", "count": 2 } ],
      "drift": { "changed": 1, "deleted": 1, "added": 1, "same": 18, "uncomparable": 5, "skipped": 0, "none": 8 },
      "scan": { "errorBlocks": 0, "warningBlocks": 0 },
      "ghosts": 9,
      "notes": [ { "code": "no_target", "count": 0 } ]
    },

    "drift": {
      "requested": true,
      "usable": true,
      "reasonCode": null,
      "reasonText": null,
      "badge": { "…": "K8S-API 5절 DriftBadge 그대로" },
      "computedAt": "2026-09-19T06:11:40.000Z",
      "addedCheck": "checked",
      "stale": false,
      "actions": { "computeDrift": { "allowed": true, "reasonCode": null, "reasonText": null } }
    },

    "scan": {
      "summary": { "errors": 0, "warnings": 0, "strict": false, "passed": true, "rules": [] },
      "outsideResources": { "errors": 0, "warnings": 0, "files": [] }
    },

    "notices": [
      { "code": "RELATIONS_PARTIAL", "text": "선이 없다고 관계가 없는 것은 아닙니다. 이 보기는 규칙 11가지(K1~K11)로 찾은 관계만 그립니다" }
    ]
  }
}
```

### 2.3 최상위 필드

| 필드 | 설명 |
|---|---|
| `revision` | 스냅샷 목록 revision(K8S-API 6.2와 같은 값). SSE `changed`와 맞춰 보기용 |
| `graph.state` | `ok` \| `pending_export`(내보내기 진행 중일 수 있음 → 그리지 않음) \| `empty`(리소스 문서 0). `ok`가 아니면 `plates`·`blocks`·`edges`·`groups`는 `[]`, 사유는 `notices`(11절) |
| `graph.version` | **구성 지문**. (경로, 파일 version) 목록을 정렬해 만든 sha256. 값이 같으면 판·블록·선·순서가 같다(AC-3D11). 드리프트·스캔 표식만 바뀔 때는 **바뀌지 않는다** → 3D-D 9.8의 "말없이 갱신"과 "다시 배치" 구분에 쓴다 |
| `graph.builtAt` | 그래프를 만든(캐시에 넣은) 시각 |
| `graph.rulesVersion` | 스냅샷 `cleanup.rulesVersion`(모르면 `null`) |
| `graph.snapshotStatus` | 파일 상태 `StatusInfo`(K8S-API 11.1). 정보 줄의 stale 배지·상태 문구용. **드리프트는 섞지 않는다**(두 축) |
| `graph.cluster` | 스냅샷 메타 클러스터(`id`·`context`·`name`)와 대시보드 클러스터 관계(`same`/`other`/`unknown`). 메타 없음·손상이면 `null` |
| `graph.summary` | 10.1. 3D 정보 줄·범례·표 위 요약이 **같은 수치**를 쓰는 근거(AC-3D04) |
| `graph.layers` | 층 정의(아래→위, 3D-D 4.2 순서). `kinds`의 `"*"` = 그 밖의 모든 종류(사용자 지정 포함) |
| `graph.rules` | 5.1 K1~K11 정의 + 이 스냅샷의 선 수(`count`). `rules` 쿼리로 뺀 종류는 `count: null`, `excluded: true` |
| `graph.plates` | 3절 |
| `graph.blocks` | 4절 (**배열 순서 = 배치 순서**) |
| `graph.edges` | 5절 |
| `graph.groups` | 묶어 보기(3D-D 9.7)용 `판 × 층 × 종류` 집계 |
| `graph.facets` | 9.2 (필터 UI 개수) |
| `graph.drift` | 7절 |
| `graph.scan` | 8.1 |
| `graph.notices` | 11.2 |

---

## 3. 판 `plates[]` (3D-D 4.1)

```ts
interface Plate {
  id: string;                 // "ns:<이름>" | "_cluster" | "_unparsed" | "ghost-ns:<이름>"
  kind: 'namespace' | 'cluster' | 'unparsed' | 'ghost';
  name: string | null;        // 네임스페이스 이름 (cluster·unparsed 는 null)
  system: boolean;            // 스냅샷 metadata scope.namespaces.system 에 든 네임스페이스 → Chip "시스템"
  file: string | null;        // <ns>/namespace.yaml (없으면 null)
  fileLine: number | null;    // 그 문서의 시작 줄 (보통 1)
  resourceCount: number;      // 이 판의 리소스 블록 수 (유령 제외, Namespace 문서는 판이므로 세지 않음)
  ghostCount: number;
  byLayer: Partial<Record<'storage'|'workload'|'service'|'ingress'|'aux', number>>;  // 층별 **블록** 수. 0인 층은 키가 없다
  markers: Markers;           // Namespace 문서(namespace.yaml) 자체의 표식. 4.5와 같은 모양
  notes: Note[];              // 6.2. 예: namespace.yaml 없음
  navigate: Navigate;         // 판 라벨 두 번 누르기 → namespace.yaml (3D-D 4.1)
}
```

- **`namespace.yaml`은 블록이 아니라 판이다**(3D-D 4.2). 그래서 `summary.blocks`에는 Namespace 문서가 들어가지 않는다(10.1의 계산식 참고).
- 판 목록·순서 = **화면 배치 순서**: 네임스페이스(이름 오름차순) → `_cluster` → `_unparsed` → 유령 판(이름순). 3D-D 4.1의 "왼→오, 맨 뒤 줄" 규칙이 이 순서를 그대로 쓴다.
- `_cluster`·`_unparsed`·유령 판은 **내용이 있을 때만** 응답에 있다(빈 판을 그리지 않는다).
- `<ns>/` 폴더에 리소스만 있고 `namespace.yaml`이 없으면 판은 만들고 `file: null` + `notes`에 `namespace_file_missing`.
- 유령 판(`kind: "ghost"`)은 드리프트 "추가됨" 리소스의 네임스페이스가 스냅샷에 없을 때만 생긴다.
- **판 집계는 `blocks[]`와 항상 맞는다**: `resourceCount` = 그 판의 `blockType !== 'ghost'` 블록 수, `ghostCount` = 유령 블록 수, **`byLayer`의 합 = `resourceCount + ghostCount`**(즉 `byLayer`는 유령 — 드리프트 "추가됨" 유령 포함 — 까지 센 **블록** 수다). 모든 판의 합 = `summary.blocks`. `drift=off`면 "추가됨" 유령이 없으므로 `ghostCount`·`byLayer`도 같이 줄어든다.
- 해석 실패 구역(`_unparsed`)의 블록에는 **관계선이 없다**(명세 3.1, 3D-D 4.5).

---

## 4. 블록 `blocks[]`

### 4.1 모양

```ts
type BlockType = 'resource' | 'ghost' | 'unparsed';
type Layer = 'storage' | 'workload' | 'service' | 'ingress' | 'aux';

interface Block {
  id: string;                       // 4.2. 화면 선택 쿼리 res= 에 쓰는 값
  blockType: BlockType;
  plateId: string;
  layer: Layer;                     // **서버가 판단**(화면은 종류→층 표를 갖지 않는다, 3D-D 14절)
  kind: string | null;              // 쿠버네티스 원문 (Deployment). unparsed 는 경로에서 읽은 추정값 또는 null
  apiGroup: string | null;          // core 는 ""
  apiVersion: string | null;
  namespace: string | null;
  name: string | null;              // unparsed 는 null
  resourceKey: string | null;       // K8S-API 10.3 형식. 드리프트 이동(res=)에 쓰는 값
  kindDir: string | null;
  custom: boolean;                  // 사용자 지정 리소스(plural.group)
  file: { path: string; line: number; documentIndex: number; documentCount: number } | null;
  summary: Record<string, unknown>; // 4.4 화이트리스트만
  ghost: { reason: GhostReason; text: string } | null;   // 6.1
  markers: Markers;                 // 4.5
  notes: Note[];                    // 6.2 (블록 보조 줄·패널·표의 표시 문구)
  system: boolean;
  degree: { in: number; out: number };    // 모든 관계 기준(필터 전)
  ghostFromRules?: string[];        // 유령 블록을 만든 관계 규칙들(K5 …). 그 규칙이 모두 꺼지면 화면이 이 블록도 숨긴다
  navigate: Navigate;
}

interface Navigate {
  primary: 'files' | 'drift' | 'secrets' | null;   // 두 번 클릭·Enter 의 기본 이동(3D-D 10.4)
  file: string | null;      // ?view=files&file=<이 값>
  line: number | null;      // &line=<이 값> — 스캔 발견이 있으면 첫 발견 줄, 없으면 문서 시작 줄
  resourceKey: string | null;   // ?view=drift&res=<이 값>
  secretName: string | null;    // ?view=secrets (Secret 유령 블록)
}
```

- `file.line` = **그 문서의 시작 줄**(1부터). 여러 문서 파일에서 문서마다 다른 줄로 간다(3D-D 10.4 각주의 요청 충족). YAML 문서 range에서 계산한다.
- `navigate.primary` 규칙(3D-D 10.4):
  1. 스캔 발견이 있으면 → `files`(+ `line` = 첫 발견 줄) — 스캔 오류가 드리프트보다 급하다
  2. 겹쳐 보기를 쓸 수 있고 `markers.drift.change`가 `changed`·`deleted`·`added`면 → `drift`
  3. Secret 유령 → `secrets`
  4. 파일이 있으면 → `files`
  5. 그 밖(유령 등) → `null`(이동 없음)
- 주소 조립은 프론트가 한다(AC-3D32). 서버는 탭 값(`files`·`drift`·`secrets`)과 인자만 준다.

### 4.2 `id` 규칙 (선택 상태를 주소에 남기는 값, AC-3D12 / 3D-D 2.2 `res=`)

| 경우 | id |
|---|---|
| 문서 1개짜리 리소스 파일 | `resourceKey` 그대로 (`apps/Deployment/prod/api`) — 드리프트 탭 `res=`와 **같은 값** |
| 한 파일에 문서 2개 이상 | `<resourceKey>#<documentIndex>` (블록마다. `file.path`는 같다, AC-3D31) |
| 같은 식별값이 여러 파일에(중복 정의) | `<resourceKey>#dup:<파일 경로>` (그 파일에 문서가 2개 이상이면 뒤에 `#<documentIndex>`) |
| 유령 블록 | `ghost:<resourceKey>` (Secret은 `ghost:core/Secret/<ns>/<name>`) |
| 해석 실패 문서 | `file:<파일 경로>` |
| 판 | 블록이 아니다. 판 id는 `plates[].id`(3절) |

- 드리프트 화면으로 갈 때 쓰는 값은 `navigate.resourceKey`(`#…` 접미어 없음)다. 화면이 `res=`에 넣는 값은 블록 id이고, 드리프트 탭으로 넘길 때는 `navigate.resourceKey`를 쓴다.
- `id`는 같은 구성(`graph.version`)에서 **안정**하다.

### 4.3 배열 순서 = 배치 순서 (AC-3D11)

`blocks[]`는 화면이 그대로 배치할 수 있는 순서로 온다(3D-D 4.3 "서버가 준 순서대로 왼→오, 앞→뒤"):

1. `plates[]` 순서(3절)
2. 층 순서: `storage` → `workload` → `service` → `ingress` → `aux`
3. 종류 순서: K8S-API 6.3 `tree`의 종류 목록 순서(Deployment → StatefulSet → DaemonSet → Service → Ingress → PVC → PDB → HPA → ConfigMap → ServiceAccount → Role → RoleBinding → NetworkPolicy → CronJob → Job → ResourceQuota → LimitRange → 사용자 지정(이름순)). 목록에 없는 종류(Secret 유령 등)는 그 층의 맨 뒤
4. 이름 오름차순 → `documentIndex` → 파일 경로
5. **유령 블록은 같은 (판, 층) 안에서 리소스 블록 뒤**(3D-D 4.4)
6. 해석 실패 블록은 `_unparsed` 판 안에서 파일 경로순

- 난수·해시 정렬을 쓰지 않는다. 같은 입력이면 항상 같은 배열이다.

### 4.4 `summary` — 표시 필드 화이트리스트 (AC-3D14)

**여기에 없는 필드는 응답에 넣지 않는다.** 값(env·command/args·어노테이션·레이블·셀렉터·ConfigMap 내용·이미지 문자열)은 어떤 종류에서도 넣지 않는다.

| kind | `summary` 필드 |
|---|---|
| Deployment / DaemonSet | `{ replicas: number\|null, containers: number, initContainers: number, serviceAccountName: string\|null }` (DaemonSet은 `replicas: null`) |
| StatefulSet | 위 + `{ volumeClaimTemplates: number, serviceName: string\|null }` |
| CronJob / Job | `{ containers: number, initContainers: number, suspend: boolean\|null, serviceAccountName: string\|null }` |
| Service | `{ type: string, ports: number, selector: 'present'\|'absent', headless: boolean, loadBalancerClass: string\|null }` |
| Ingress | `{ ingressClassName: string\|null, rules: number, paths: number, tlsSecrets: number, defaultBackend: boolean }` |
| PersistentVolumeClaim | `{ storageClassName: string\|null, storage: string\|null, accessModes: string[], volumeMode: string\|null }` |
| ConfigMap | `{ keys: number, binaryKeys: number }` (**키 이름은 넣지 않는다** — 키 이름이 비밀값처럼 보일 수 있다, K8S-API 2.3) |
| Secret (유령 전용) | `{ referencedKeys: number }` (참조에 적힌 키 **개수**) |
| HorizontalPodAutoscaler | `{ minReplicas: number\|null, maxReplicas: number\|null, targetKind: string\|null, targetName: string\|null }` |
| PodDisruptionBudget | `{ minAvailable: string\|number\|null, maxUnavailable: string\|number\|null, selector: 'present'\|'absent' }` |
| NetworkPolicy | `{ policyTypes: string[], scope: 'namespace'\|'selected' }` |
| ServiceAccount | `{ imagePullSecrets: number, automountServiceAccountToken: boolean\|null }` |
| Role / ClusterRole | `{ rules: number }` |
| RoleBinding / ClusterRoleBinding | `{ roleRefKind: string\|null, roleRefName: string\|null, subjects: number }` |
| ResourceQuota / LimitRange | `{ entries: number }` |
| Namespace(판) | `{ }` (판 정보는 `plates[]`에) |
| 그 밖·사용자 지정·해석 실패 | `{ }` |

### 4.5 표식 `markers` (3D-D 4.8)

```ts
interface Markers {
  scan: {
    errors: number;
    warnings: number;
    level: 'error' | 'warn' | null;   // 표식 등급 (errors>0 → error, 경고만 → warn)
    count: number;                     // 그 등급의 건수 (표식 문구 "오류 1")
    firstLine: number | null;          // 첫 발견 줄 → navigate.line
  };   // 그 블록의 **파일** 기준(8.1)
  drift: BlockDrift | null;    // 7.3. 겹쳐 보기를 쓸 수 없으면 null
  fileIssue: { code: string; text: string } | null;   // 대표 파일 문제 1개(6.2의 path_mismatch·duplicate·runtime_fields·multi_document·parse_failed 중 첫 번째)
  helm: boolean;               // Helm 관리 (files[].helmManaged)
}
```

- 3D-D 4.8의 `notComparable{reason,text}`는 `markers.drift.change === 'uncomparable'` + `reasonCode`/`reasonText`로 표현한다(드리프트 계약과 같은 말을 쓰기 위해서. `eye-off` 표식 조건도 이것이다).
- 색·모양은 디자인(3D-D 4.8, `status.md` 11절). 서버는 **구분과 문구**만 준다. `markers`는 `StatusInfo`가 아니다.

---

## 5. 관계선 `edges[]`

### 5.1 규칙 K1~K11 (명세 3.1, 3D-D 4.6)

| id | 관계 | 근거(파일에서 읽는 곳) | `certainty` | `defaultOn` |
|---|---|---|---|---|
| `K1` | Ingress → Service | `spec.rules[].http.paths[].backend.service.name`, `spec.defaultBackend.service.name` (같은 네임스페이스) | `confirmed` | ✅ |
| `K2` | Service → 워크로드 | Service `spec.selector`가 워크로드 파드 템플릿 레이블의 **부분집합**(같은 네임스페이스). 맞는 워크로드가 여럿이면 모두 | `estimated` | ✅ |
| `K3` | 워크로드 → PVC | 파드 템플릿 `volumes[].persistentVolumeClaim.claimName` | `confirmed` | ✅ |
| `K4` | StatefulSet → PVC | `spec.volumeClaimTemplates[].metadata.name` + 이름 규칙 `<템플릿>-<sts 이름>-<순번>`에 맞는 PVC | `estimated` | ✅ |
| `K5` | 워크로드 → ConfigMap | `envFrom[].configMapRef`, `env[].valueFrom.configMapKeyRef`, `volumes[].configMap`, `volumes[].projected.sources[].configMap` | `confirmed` | ✅ |
| `K6` | 워크로드·Ingress → Secret | 워크로드: `envFrom[].secretRef`, `env[].valueFrom.secretKeyRef`, `volumes[].secret`, `volumes[].projected.sources[].secret`, `volumes[].csi.nodePublishSecretRef`, `imagePullSecrets` / Ingress: `spec.tls[].secretName` | `confirmed` | ✅ |
| `K7` | HPA → 워크로드 | `spec.scaleTargetRef`(kind·name) | `confirmed` | ✅ |
| `K8` | PDB → 워크로드 | PDB `spec.selector`가 파드 템플릿 레이블과 맞음 | `estimated` | ⬜ |
| `K9` | 워크로드 → ServiceAccount | `spec.template.spec.serviceAccountName`(없으면 `default`) | `confirmed` | ⬜ |
| `K10` | NetworkPolicy → 워크로드 | `spec.podSelector`(빈 셀렉터 = 네임스페이스 전체) | `estimated` | ⬜ |
| `K11` | RoleBinding → Role·ServiceAccount | `roleRef`, `subjects[]`(kind `ServiceAccount`) | `confirmed` | ⬜ |

- **파드 템플릿**: Deployment/StatefulSet/DaemonSet/Job `spec.template`, CronJob `spec.jobTemplate.spec.template`. 컨테이너는 `containers` + `initContainers` + `ephemeralContainers`.
- 관계는 **같은 네임스페이스 안에서만** 맞춘다(다른 네임스페이스 참조는 범위 밖, 명세 6절). K11의 `roleRef.kind: ClusterRole`만 클러스터 범위 대상으로 본다.
- K6은 **매니페스트에서 직접** 뽑는다(`secret-refs.json`이 없거나 손상이어도 그린다, 명세 3.1). `secret-refs.json`의 `serviceAccount.imagePullSecrets` 경로는 이번 범위에서 선으로 만들지 않는다.
- 해석 실패 문서에서는 관계를 뽑지 않는다. 중복 정의 문서는 블록마다 같은 선이 생긴다(`notes`에 `duplicate`).
- 그 밖의 참조(ExternalName, 사용자 지정 리소스 안의 참조, StorageClass·IngressClass·PriorityClass 참조 등)는 뽑지 않는다. 응답에 항상 `RELATIONS_PARTIAL` 정보 문구를 넣는다(3D-D 4.5 상시 안내).

### 5.2 모양

```ts
interface Edge {
  id: string;            // "<rule>|<from>|<to>"
  rule: 'K1' | … | 'K11';
  from: string;          // 블록 id
  to: string;            // 블록 id
  certainty: 'confirmed' | 'estimated';    // 실선 / 대시 (3D-D 4.5)
  toGhost: boolean;
  optional: boolean;     // 모든 근거가 optional: true 참조 → 화면 Chip "선택 참조"
  evidence: string;      // **화면에 그대로 쓰는 근거 문구**(3D-D 4.6). 여러 근거면 " · " 로 이은 한 줄
  evidenceItems: { code: string; text: string; container: string | null }[];   // 최대 5개
  evidenceTruncated: boolean;
}
```

- **같은 (rule, from, to)는 선 1개**로 합치고 근거를 쌓는다(예: `api → api-config`를 `envFrom`과 `volumes.configMap`로 둘 다 참조 → 근거 2개, 선 1개). 근거가 5개를 넘으면 앞 5개 + `evidenceTruncated: true`, `evidence` 끝에 ` 외 N건`.
- `evidence`·`evidenceItems[].text`에 **셀렉터·레이블·어노테이션 값이 없다**(AC-3D14). "어디서 뽑았는지"만 말한다. 컨테이너 이름은 식별값이라 넣는다(`… (컨테이너 api)`).
- 정렬: `rule` → `from` → `to`(문자열 오름차순).

### 5.3 근거 코드 `evidenceItems[].code`

| 규칙 | code | text (서버 고정 문구) |
|---|---|---|
| K1 | `INGRESS_BACKEND` / `INGRESS_DEFAULT_BACKEND` | "Ingress 규칙의 backend.service.name" / "Ingress defaultBackend" |
| K2 | `SELECTOR_MATCH` | "Service 셀렉터가 파드 템플릿 레이블과 맞음" |
| K3 | `PVC_CLAIM_NAME` | "volumes.persistentVolumeClaim.claimName" |
| K4 | `VCT_NAME_PATTERN` | "volumeClaimTemplates 이름 규칙 `<템플릿>-<이름>-<순번>`" |
| K5 | `ENV_FROM_CONFIGMAP` / `ENV_CONFIGMAP_KEY` / `VOLUME_CONFIGMAP` / `PROJECTED_CONFIGMAP` | "envFrom.configMapRef" / "env.valueFrom.configMapKeyRef" / "volumes.configMap" / "volumes.projected.configMap" |
| K6 | `ENV_FROM_SECRET` / `ENV_SECRET_KEY` / `VOLUME_SECRET` / `PROJECTED_SECRET` / `CSI_NODE_PUBLISH_SECRET` / `IMAGE_PULL_SECRET` / `INGRESS_TLS_SECRET` | "envFrom.secretRef" / "env.valueFrom.secretKeyRef" / "volumes.secret" / "volumes.projected.secret" / "volumes.csi.nodePublishSecretRef" / "imagePullSecrets" / "Ingress spec.tls.secretName" |
| K7 | `HPA_SCALE_TARGET` | "HPA spec.scaleTargetRef" |
| K8 | `PDB_SELECTOR_MATCH` | "PDB 셀렉터가 파드 템플릿 레이블과 맞음" |
| K9 | `SERVICE_ACCOUNT_NAME` / `SERVICE_ACCOUNT_DEFAULT` | "spec.template.spec.serviceAccountName" / "serviceAccountName 없음 → default" |
| K10 | `NETPOL_POD_SELECTOR` / `NETPOL_NAMESPACE_WIDE` | "NetworkPolicy podSelector가 맞음" / "podSelector 비어 있음 = 네임스페이스 전체" |
| K11 | `ROLE_REF` / `SUBJECT_SERVICE_ACCOUNT` | "RoleBinding roleRef" / "RoleBinding subjects (ServiceAccount)" |

- 확실성(확정/추정)은 `certainty`로만 말한다. 문구에 "(추정)"을 중복해 넣지 않는다(화면이 선 모양·칩으로 표시, 3D-D 4.5).

---

## 6. 유령 블록·표시 문구

### 6.1 유령 사유 `ghost.reason` (3D-D 4.4)

| reason | text | 언제 |
|---|---|---|
| `not_in_snapshot` | "스냅샷에 없음" | K1·K3·K5·K7·K11이 가리킨 대상이 스냅샷에 없음 |
| `secret` | "Secret — 이름만, 값 없음" | K6의 Secret은 **항상** 유령(스냅샷은 Secret을 담지 않는다) |
| `autocreated` | "자동 생성 또는 스냅샷에 없음" | K9 대상 ServiceAccount가 없음(자동 생성 `default`는 CLI가 뺀다) |
| `cluster_scope` | "클러스터 범위, 스냅샷에 없을 수 있음" | K11 `roleRef.kind: ClusterRole` 대상이 없음 |
| `drift_added` | "추가됨 (클러스터에만 있음)" | 드리프트 "추가됨"(7.3). 겹쳐 보기를 쓸 수 있을 때만 생긴다 |

- 유령 블록은 **상태가 아니다**(상태색·`unknown` 색 금지, 명세 3.5). `markers.drift`는 `drift_added`만 값이 있고 나머지는 `null`이다.
- 같은 대상을 여러 워크로드가 참조하면 블록은 **1개**, 선이 여러 개다.

### 6.2 표시 문구 `notes[]` (3D-D 4.5·7.2 ④)

```ts
interface Note { code: string; text: string; count?: number }
```

| code | text | 언제 |
|---|---|---|
| `selector_missing` | "셀렉터 없음(수동 Endpoints·ExternalName)" | Service에 `spec.selector`가 없음 → **선을 그리지 않는다** |
| `no_target` | "대상 없음" | 셀렉터는 있는데 맞는 워크로드가 없음(Service K2 / PDB K8 / NetworkPolicy K10) → 선 없음 |
| `pvc_template_unmatched` | "PVC 템플릿 2개(스냅샷에 PVC 없음)" | K4 이름 규칙에 맞는 PVC가 하나도 없음. `count` = 템플릿 수 |
| `path_mismatch` | "경로 불일치" | K8S-API `files[].pathMatches === false` |
| `duplicate` | "중복 정의" | 같은 식별값이 다른 파일에도 있음. `count` = 관련 파일 수 |
| `multi_document` | "한 파일에 여러 리소스 (2개)" | `file.documentCount ≥ 2`. `count` = 문서 수 |
| `runtime_fields` | "런타임 필드 남음" | `files[].runtimeFields`가 있음. `count` = 경로 수 |
| `parse_failed` | "해석 실패 (YAML 구문 오류)" 등 | `_unparsed` 판의 블록. 사유는 `yaml_error`·`not_object`·`empty`·`too_large`에 맞춘 문구 |
| `custom_resource` | "사용자 지정 리소스 — 참조를 뽑지 않음" | `custom: true` |
| `namespace_file_missing` | "namespace.yaml 없음" | 판 전용(3절) |

- 이 문구들은 **상태 배지·상태색이 아니다**(AC-3D26). 화면은 블록 보조 줄·선택 패널·관계 표에 같은 문구를 쓴다.
- `markers.fileIssue`는 위 중 파일 문제(`path_mismatch`·`duplicate`·`runtime_fields`·`multi_document`·`parse_failed`) 첫 번째를 그대로 담는다(3D-D 4.8 `file-warning` 표식용).

---

## 7. 드리프트 겹쳐 보기 (기존 결과 재사용, 새 계산·새 호출 없음)

### 7.1 원칙

- 이 엔드포인트는 **드리프트를 계산하지 않고 임대도 만들지 않는다**. `DriftService`가 메모리에 들고 있는 결과(K8S-API 10.7~10.9)를 읽기만 한다. 3D 보기를 여는 것만으로 쿠버네티스 호출이 늘지 않는다(AC-3D13).
- 계산·임대는 **기존** `POST /api/k8s-snapshots/:id/drift` 그대로다. 3D 보기를 열어 둔 동안 화면은 드리프트 탭과 같은 규칙(60초마다 `{"force": false}`)으로 임대를 갱신하고, 떠나면 최대 120초 뒤 멈춘다(3D-D 10.2, AC-3D28).
- **중복 조회 없음**: 3D·관계 표에 필요한 드리프트 정보(배지·리소스별 구분·건수·계산 시각)는 이 응답 안에 있다. `GET …/drift`는 **필드 차이를 볼 때(드리프트 탭)만** 부른다.

### 7.2 `graph.drift`

```ts
interface GraphDrift {
  requested: boolean;          // 쿼리 drift=on
  usable: boolean;             // 겹쳐 보기를 쓸 수 있음
  reasonCode: string | null;   // usable=false 사유 (K8S-API 11.3 코드 그대로)
  reasonText: string | null;   // 같은 문구 그대로 (화면이 새 문구를 만들지 않는다)
  badge: DriftBadge;           // K8S-API 5절과 **같은 객체**(목록·SSE와 같은 값)
  computedAt: string | null;   // 정보 줄·도구 막대 B의 "15:12 계산" (3D-D 6.4·10.1)
  addedCheck: 'checked' | 'skipped_scope_unknown' | null;
  stale: boolean;
  actions: { computeDrift: DriftAbility };   // [드리프트 계산] 버튼 활성·사유 (3D-D 10.2)
}
```

- `usable` 규칙(3D-D 10.1): `badge.mode`가 `auto`·`on_demand`이거나, `last_result`이면서 `resultAvailable: true`이고 결과가 남아 있을 때.
- `usable: false`면 **모든 블록·판의 `markers.drift`가 `null`**, `summary.driftMarkers = 0`, `facets.drift`는 `none`에 전부. 구성도는 그대로 그린다(AC-3D28).
- `reasonCode` 예: `DRIFT_NOT_COMPUTED`, `CLUSTER_MISMATCH`, `CLUSTER_NOT_CONNECTED`, `CLUSTER_SYNCING`, `CLUSTER_ID_MISSING`, `SNAPSHOT_FILES_PENDING`, `NO_COMPARABLE_RESOURCES`, `DRIFT_RULES_UNAVAILABLE`, `DRIFT_FAILED`.
- `stale`이면 값은 그대로 두고 화면이 stale 배지로 보인다(`common.md` 2.3, AC-K40).

### 7.3 블록 드리프트 `markers.drift`

```ts
type DriftChange = 'same' | 'changed' | 'deleted' | 'added' | 'uncomparable' | 'skipped';

interface BlockDrift {
  change: DriftChange;                 // 드리프트 계약 resources[].change 와 같은 말
  fieldCount: number;                  // 보이는 필드 차이 수 (changed 만 ≥ 1) — 3D-D "변경됨 · 필드 N건"
  hidden: { default: number; managed: number };   // 숨긴 차이 (표식·건수에 넣지 않음)
  reasonCode: string | null;           // uncomparable: NOT_IN_RBAC | FORBIDDEN | API_VERSION_MISMATCH
                                       // skipped: YAML_ERROR | DUPLICATE | NAMESPACE_MISSING | TOO_LARGE
  reasonText: string | null;
}
```

| 드리프트 결과 | 어디에 | 화면(3D-D 10.1) |
|---|---|---|
| `changed` | 그 문서 블록(Namespace면 판) | `square-dot` + `변경됨 · 필드 N건` |
| `deleted` | 그 문서 블록 | `square-minus` |
| `added` | **유령 블록**(`ghost.reason = drift_added`) | 유령 + `square-plus` |
| `same` | 그 문서 블록 | 표식 없음(숨긴 차이만 있어도 없음) |
| `uncomparable` | 그 문서 블록 | `eye-off` + 사유 문구 |
| `skipped` | 해석 실패·중복 블록 | `file-warning` + "비교 못 함(해석 실패·중복)" |

- **값 없음**: 필드 경로·양쪽 값은 이 응답에 **없다**(건수만). 필드 차이는 드리프트 탭에서 본다.
- `summary.driftMarkers` = `changed + deleted + added` **표식 수**이고, 드리프트 응답 건수와 같다(AC-3D27). Namespace 문서의 차이는 **판 표식**으로 세어 수가 어긋나지 않게 한다.
- 빨강·초록 diff 색은 쓰지 않는다(`status.md` 10.3, 중립색).
- 구현: `DriftService`에 읽기 전용 접근자 `graphDrift(analysis)`를 더한다(`resourceKey → {change, fieldCount, hidden, reason}` 맵 + `added` 목록). 계산·임대 부작용 없음. 기존 `fileDrift()`는 그대로 둔다.

---

## 8. 스캔·Helm·시스템

### 8.1 스캔 (3D-D 10.3)

- `markers.scan`은 그 블록의 **파일**의 현재 발견 수다. 한 파일에 문서가 여러 개면 **모든 블록에 같은 수**가 붙는다(파일 단위 발견). `firstLine`은 그 파일의 첫 발견 줄 → `navigate.line`.
- 규칙 ID·문구는 넣지 않는다. 이동해서 파일 보기의 발견 줄에서 본다(AC-3D30).
- `graph.scan.outsideResources`: 블록이 없는 파일(`metadata.json`·`secret-refs.json`·`notes.json`·예상 밖 파일)의 발견 수와 경로 → 정보 줄 칩 `리소스 밖 발견 N건`(3D-D 6.4-5).
- `graph.scan.summary`는 스냅샷 전체 `ScanSummary`(K8S-API 5절)와 같은 값이다.

### 8.2 Helm·시스템

- `markers.helm`: 파일 기준(`app.kubernetes.io/managed-by: Helm`). 중립 보조 라벨(AC-3D33).
- `blocks[].system`·`plates[].system`: 스냅샷 `scope.namespaces.system`에 든 네임스페이스.

---

## 9. 대체 보기(관계 표)와 개수

### 9.1 별도 엔드포인트를 두지 않는다

관계 표(3D-D 8절)는 **이 응답 하나**로 그린다(AC-3D04):

- 그룹 행 = `plates[]`(네임스페이스) → `layers[]`(층)
- 리소스 행 = `blocks[]`(종류·이름·위치=`plateId`·표식=`markers`+`notes`·들어옴/나감=`degree`·동작=`navigate`)
- 행 펼침 = 그 블록이 `from`/`to`인 `edges[]`(상대·방향·근거 `evidence`·확실성 `certainty`·`optional`)
- 기본 정렬 = `blocks[]` 배열 순서(3D와 같은 순서, 3D-D 8.2)
- 표 위 요약 = `graph.summary`(3D 정보 줄과 같은 수치)

three.js 없이 동작한다(AC-3D03). `degree`는 **필터 전** 전체 관계 기준이고, 필터를 건 수는 화면이 같은 `edges[]`에서 센다.

### 9.2 `facets` (필터 UI 개수)

```ts
interface GraphFacets {
  namespaces: { plateId: string; name: string | null; count: number }[];   // gns
  kinds: { kind: string; apiGroup: string | null; count: number }[];        // gkind (종류 목록 순서)
  rules: { id: string; count: number }[];                                   // grel
  drift: { changed: number; deleted: number; added: number; same: number; uncomparable: number; skipped: number; none: number };  // gmark=drift
  scan: { errorBlocks: number; warningBlocks: number };                     // gmark=scan
  ghosts: number;                                                            // gmark=ghost
  notes: { code: string; count: number }[];                                  // 6.2 코드별 블록 수
}
```

- `facets.*.count`는 **블록 수**(판은 세지 않는다. 판 수는 `summary.plates`).
- 합계는 항상 서버 값을 쓴다(`common.md` 1.6).

---

## 10. 규모·잘림·성능·캐시

### 10.1 `graph.summary` (3D-D 6.4·8.2가 쓰는 수치)

```ts
interface GraphSummary {
  plates: number;
  documents: number;            // 스냅샷의 리소스 문서 수 (K8S-API resources.current.total 과 같음)
  namespaceDocuments: number;   // 그중 Namespace 문서(= 판으로 그린 것)
  resourceBlocks: number;       // = documents - namespaceDocuments (해석 실패 제외)
  ghosts: number;
  unparsedBlocks: number;
  blocks: number;               // = resourceBlocks + ghosts + unparsedBlocks  (blocks[] 길이)
  edges: number;
  edgesDefaultOn: number;       // K1~K7 선 수
  driftMarkers: number;         // changed + deleted + added (블록 + 판)
  scanMarkers: number;          // 발견이 있는 블록 + 판 수
  outsideFindings: number;      // 리소스 밖 발견 수(errors + warnings)
  grouped: boolean;             // blocks > groupThreshold → 화면은 묶어 보기로 연다(3D-D 9.7)
  groupThreshold: number;       // 기본 3000
  truncated: { blocks: boolean; edges: boolean; droppedBlocks: number; droppedEdges: number; reason: string | null };
}
```

- **AC-3D24 확인식**: **`blocks + namespaceDocuments = documents + ghosts`**. 명세의 "블록 수 = 리소스 문서 수 + 유령 블록 수"는 `namespace.yaml`을 판으로 그리기로 한 디자인(3D-D 4.2)에 맞춰 이렇게 읽는다(16절 3). 해석 실패 파일은 `documents`에 1개로 들어 있으므로 따로 더하지 않는다.
- **묶어 보기**: `grouped: true`면 화면이 `groups[]`(판 × 층 × 종류)로 먼저 그리고 펼칠 때 `blocks`를 쓴다. **관계 표는 항상 전체 행**(AC-3D22). 서버는 `blocks`·`edges`를 줄이지 않는다.
- **잘림(안전 장치)**: 블록이 `K8S_GRAPH_MAX_BLOCKS`(기본 20,000)를 넘으면 4.3 순서대로 앞에서 자르고 `truncated.blocks = true`, `reason: "BLOCK_LIMIT"`, 정보 문구 `GRAPH_TRUNCATED`. 선도 `K8S_GRAPH_MAX_EDGES`(기본 40,000)로 같다. 잘린 블록을 가리키는 선은 버린다.

### 10.2 성능(AC-3D20: 기준 규모 응답 p95 1초)과 캐시

| 단계 | 방법 |
|---|---|
| 파일 읽기·YAML 해석 | **하지 않는다.** 기존 분석 캐시(`K8sSnapshotsService`의 스냅샷별 `K8sAnalysis`, 지문 `fp`로 갱신)의 `docs[]`(이미 해석된 문서)를 쓴다 |
| 그래프 만들기 | 문서 1회 순회로 인덱스(네임스페이스별 식별값 맵, 워크로드 파드 템플릿 레이블 맵) → 관계 추출 1회 순회. 문서 수에 대해 선형(셀렉터 비교만 워크로드 수 × Service·PDB·NetPol 수) |
| 캐시 | 스냅샷별 **그래프 캐시**(LRU 기본 8개, `K8S_GRAPH_CACHE_SIZE`). 키 = `graph.version`. 파일이 안 바뀌면 다시 만들지 않는다 |
| 드리프트·스캔 겹치기 | 캐시된 그래프에 **응답을 만들 때** 얹는다. 드리프트만 바뀌면 그래프를 다시 만들지 않고 `graph.version`도 바뀌지 않는다(3D-D 9.8 "말없이 갱신") |
| 직렬화 | 기준 규모(블록 1,040·선 2,580) 응답 약 2.0 MB (측정값, 아래) |

- **측정값(2026-09-20 구현, mock `large`, 로컬 Windows·Node 22, 50회)**: 리소스 1,000개(블록 1,040·선 2,580) **p50 25 ms · p95 45 ms**(첫 호출 = 캐시 미스 63 ms), 리소스 3,200개 **p50 62 ms · p95 67 ms**(첫 호출 139 ms). AC-3D20 목표(1초) 대비 여유 20배 이상.
- **응답 크기(측정)**: 기준 규모 약 **2.0 MB**(3,200개는 약 6.3 MB). 초안의 "0.6 MB 이하" 추정은 측정값으로 고친다. 크기를 줄여야 하면 `rules` 쿼리로 켠 관계만 받는다(K1~K7만: 선 1,960개).

---

## 11. 예외 상태

### 11.1 `graph.state`와 HTTP (명세 3.9, 3D-D 9.6)

| 상황 | 응답 |
|---|---|
| 정상 | 200, `state: "ok"` |
| 내보내기 진행 중일 수 있음(`EXPORT_MAYBE_IN_PROGRESS`) | 200, `state: "pending_export"`, 빈 배열, 정보 문구 "스냅샷 파일 확인 전" |
| 리소스 문서 0개 | 200, `state: "empty"`, 정보 문구 `NO_RESOURCES` |
| `metadata.json` 없음·손상 | 200, `state: "ok"`(파일로 구성도는 그린다), `graph.cluster: null`, 드리프트 `usable: false` + `CLUSTER_ID_MISSING` |
| 다른 클러스터 스냅샷 | 200, 구성도 정상, 드리프트 `usable: false` + `CLUSTER_MISMATCH` |
| 클러스터 연결 없음·동기화 중 | 200, 구성도 정상, 드리프트 `usable: false` + `CLUSTER_NOT_CONNECTED`/`CLUSTER_SYNCING`, `actions.computeDrift.allowed: false` |
| 스냅샷 폴더 stale | 200, `snapshotStatus.stale: true`(마지막 값 유지) |
| live인데 `K8S_SNAPSHOT_DIR` 없음·폴더 없음 | **503 `SOURCE_UNAVAILABLE`**(상세와 같은 규칙). 예시 데이터로 바꾸지 않는다(AC-3D18) |
| k8s 규칙 lib·스캐너 없음 | 503 `SOURCE_UNAVAILABLE` |
| 없는 스냅샷·휴지통 스냅샷 | 404 `RESOURCE_NOT_FOUND` (`details.resource = { kind: "K8sSnapshot", id }`) |

### 11.2 정보 문구 `graph.notices[]` (상태 영향 없음)

| code | text 예 |
|---|---|
| `RELATIONS_PARTIAL` | "선이 없다고 관계가 없는 것은 아닙니다. 이 보기는 규칙 11가지(K1~K11)로 찾은 관계만 그립니다" (항상) |
| `SECRET_VALUES_NOT_INCLUDED` | "Secret 은 이름만 표시합니다 (값은 스냅샷에 없습니다)" |
| `EXPORT_MAYBE_IN_PROGRESS` | "스냅샷 파일 확인 전 — 내보내기가 진행 중일 수 있습니다" |
| `NO_RESOURCES` | "리소스 파일이 없습니다" |
| `NAMESPACE_FILE_MISSING` | "namespace.yaml 이 없는 네임스페이스 1개 (batch)" |
| `UNPARSED_FILES` | "해석 실패 2개 — 관계를 뽑지 않았습니다" |
| `CUSTOM_RESOURCES_PRESENT` | "사용자 지정 리소스 3개 — 참조를 뽑지 않습니다" |
| `GRAPH_TRUNCATED` | "리소스가 너무 많아 20,000개만 그립니다" |
| `GROUPED_VIEW` | "리소스가 3,000개를 넘어 종류별로 묶어 보입니다 (블록 3,204개)" |
| `DRIFT_NOT_OVERLAID` | "드리프트 겹쳐 보기를 쓸 수 없습니다: 계산 안 함" (사유 문구는 K8S-API 11.3) |

---

## 12. mock (`DATA_SOURCE=mock`)

### 12.1 원칙

- 기존 mock 원칙 그대로(K8S-API 14.1): 예시는 **메모리**, 실제 폴더를 읽지도 쓰지도 않음, 재시작·`POST /api/mock/reset`으로 원상태.
- **3D 전용 고정 응답을 만들지 않는다.** 그래프는 예시 파일을 **실제 추출기**로, 드리프트는 **실제 드리프트 엔진** 결과로 만든다(명세 3.10).
- 기존 예시의 **파일 상태와 드리프트 건수는 바뀌지 않는다**(AC-K41·K44, `k8s-snapshots.http.spec.ts` 기대값 유지). 12.2의 보강은 클러스터 객체와 스냅샷 파일 **양쪽에 같이** 넣어 차이가 생기지 않게 한다.

### 12.2 mock 리소스 **실제 이름** (명세 3.10: "백엔드가 cluster mock 인벤토리 이름에 맞추고 계약에 적는다")

명세 3.10·AC-3D24~33의 이름은 **아래 값으로 읽는다**. 출처: `apps/api/src/cluster/mock/mock-world.ts`(cluster 그룹 기본 시나리오 `mixed`) → `drift/mock-cluster-objects.ts` → `k8s-mock-fixtures.ts`.

**K-1 `20260919-061000`** — 판 5장: `batch`, `data`, `default`, `monitoring`, `prod`

| 판 | 리소스 |
|---|---|
| `prod` | Deployment `api`, `web`, `worker` / Service `api`(type **LoadBalancer**, `loadBalancerClass: service.k8s.aws/nlb`), `web` / Ingress `web`, **`api-public`** / ConfigMap `api-config` / NetworkPolicy `default-deny` / HPA `api` / PDB `web` |
| `data` | StatefulSet `postgres`, `redis` / Service `postgres` / PVC `data-postgres-0`, `data-postgres-1`, `data-redis-0` / ConfigMap `postgres-config` |
| `monitoring` | Deployment `grafana`(Helm) / Service `grafana`(Helm) / PVC `grafana` |
| `batch` | Deployment `report-generator` / CronJob `nightly-report` / **Job `report-backfill`** / PVC `scratch` |
| `default` | (리소스 없음 — 빈 판 예시) |

- 명세 3.10 예시와 **같은 이름**: `api-config`, `data-postgres-0`, `postgres-credentials`, `Deployment api`, `Ingress api-public`, `Deployment payments`(추가됨 유령), `StatefulSet postgres`, `HPA api`.
- 명세 3.10과 **다른 점(이 계약의 값)**:
  - Ingress는 `api-public` 외에 **`web`도 있다** → K1 선이 2개.
  - Secret 유령은 `data/postgres-credentials` 외에 **`prod/api-db-credentials`**(Deployment `api`의 `env.valueFrom.secretKeyRef`)도 있다.
  - `type: LoadBalancer` Service는 `prod/api`(NLB)·`monitoring/grafana`(CLB) **두 개**(4단계 X1용, 이번 범위에서는 `summary.type`으로만 보인다).
  - 시스템 네임스페이스 리소스는 스냅샷에 없다(CLI 기본 범위) → 판도 없다.
  - **Job `batch/report-backfill` (2026-09-20 추가)**: 소유자(`ownerReferences`) 없는 **독립 Job**이라 CLI 제외 규칙에 걸리지 않는다(CronJob이 만든 Job은 `isAlwaysExcluded`로 빠진다). 3D-D 4.11.2의 `chamfer` 모양을 실제 장면에서 점검하려고 넣었고, `batch` 판에 `Deployment`(`stack`) · `CronJob`(`roof`) · `Job`(`chamfer`)이 **한 판에** 있게 된다(3D-D 4.11.6 회귀 장면). `jobs`는 CLI `KIND_CATALOG`에서 tier `optional`이므로 예시 `metadata.json`의 `scope.kinds.optional`에 `jobs`가 들어간다. 대시보드 RBAC 밖이라 드리프트는 **비교 불가 `NOT_IN_RBAC`**(건수 3건 불변).

**K-1 보강** (클러스터 객체와 스냅샷 양쪽에 같이 넣어 드리프트 건수 불변)

| 보강 | 목적 | 생기는 선 |
|---|---|---|
| `Deployment prod/api` 컨테이너 `api`에 `envFrom: [{ configMapRef: { name: api-config } }]` | AC-3D25의 K5 | K5 `api → ConfigMap api-config` |
| `StatefulSet data/postgres`에 `volumes[].configMap.name = postgres-config`(+ `volumeMounts`) | 워크로드 종류별 K5 예시 | K5 `postgres → ConfigMap postgres-config` |
| `Deployment monitoring/grafana`에 `volumes[].persistentVolumeClaim.claimName = grafana` | **K3**(claimName) 예시가 없었다 | K3 `grafana → PVC grafana` |

- 보강은 `mock-cluster-objects.ts`(클러스터 쪽)에 넣고, 예시 스냅샷은 그 객체에서 만들어지므로 자동으로 같은 내용이 된다 → `changed`/`deleted`/`added` 건수 **불변**(변경 1 · 삭제 1 · 추가 1), 비교 불가 종류(ConfigMap·NetworkPolicy·CronJob·Job) **불변**, 파일 상태 **불변**.

**K-1 기대값(보강 뒤)**

| 관계 | 선 | 내용 |
|---|---|---|
| K1 | 2 | `Ingress api-public → Service api`, `Ingress web → Service web` |
| K2 | 4 | `Service api → Deployment api`, `Service web → Deployment web`, `Service postgres → StatefulSet postgres`, `Service grafana → Deployment grafana` |
| K3 | 1 | `Deployment grafana → PVC grafana` |
| K4 | 3 | `StatefulSet postgres → PVC data-postgres-0`, `→ data-postgres-1`, `StatefulSet redis → PVC data-redis-0` |
| K5 | 2 | `Deployment api → ConfigMap api-config`, `StatefulSet postgres → ConfigMap postgres-config` |
| K6 | 2 | `Deployment api → Secret api-db-credentials`(유령), `StatefulSet postgres → Secret postgres-credentials`(유령) |
| K7 | 1 | `HPA api → Deployment api` |
| **기본 켬 소계** | **15** | |
| K8(끔) | 1 | `PDB web → Deployment web` |
| K9(끔) | 9 | `api·web·worker → ServiceAccount api·web·worker`(유령), `report-generator·nightly-report·report-backfill·postgres·redis·grafana → ServiceAccount default`(유령, 네임스페이스별. batch 판은 Deployment·CronJob·Job 셋이 같은 유령을 가리킨다) |
| K10(끔) | 3 | `NetworkPolicy default-deny → Deployment api·web·worker` |
| K11 | 0 | RoleBinding 예시 없음 |
| **전체** | **28** | |

- 유령 9개: Secret 2, ServiceAccount 6(`prod/api`·`prod/web`·`prod/worker`·`batch/default`·`data/default`·`monitoring/default`), 드리프트 추가됨 `Deployment prod/payments` 1.
- `summary`: `documents 30`, `namespaceDocuments 5`, `resourceBlocks 25`, `ghosts 9`, `blocks 34`, `plates 5`, `edges 28`, `edgesDefaultOn 15`, `driftMarkers 3`, `scanMarkers 0`, `outsideFindings 0`. (`drift=off`면 "추가됨" 유령이 없어 `blocks 33`·`ghosts 8`)
- 드리프트 표식: 변경 `Deployment api`(필드 3), 삭제 `Ingress api-public`, 추가 `Deployment payments`(유령), 비교 불가 5(ConfigMap 2·NetworkPolicy 1·CronJob 1·Job 1), 나머지 `same`.
- **판 집계 기대값** (`drift=on` / `drift=off`):

| 판 | `resourceCount` | `ghostCount` | `byLayer` |
|---|---|---|---|
| `ns:batch` | 4 | 1 | `{ storage 1, workload 3, aux 1 }` |
| `ns:data` | 7 | 2 | `{ storage 5, workload 2, service 1, aux 1 }` |
| `ns:default` | 0 | 0 | `{}` |
| `ns:monitoring` | 3 | 1 | `{ storage 1, workload 1, service 1, aux 1 }` |
| `ns:prod` | 11 | **5 / 4** | `{ storage 2, workload **4 / 3**, service 2, ingress 2, aux 6 }` |

  `ns:prod`만 `drift` 값에 따라 달라진다("추가됨" 유령 `Deployment prod/payments`가 워크로드 층에 붙는다). 모든 판의 `byLayer` 합 = `summary.blocks`(34 / 33).

- 위 숫자는 구현에서 단위 테스트로 고정한다. 달라지면 **이 계약을 먼저 고친다**.

### 12.3 K-9·K-7 보강 (관계 예외 3종·여러 문서 파일)

| 예시 | 보강 | AC |
|---|---|---|
| **K-9** `20260919-020000` (staging-eks) | ① `prod/deployments/worker.yaml`에 `envFrom: [{ configMapRef: { name: worker-config } }]` — 대상 파일 **없음** → 유령 `not_in_snapshot` ② 새 파일 `prod/services/api-legacy.yaml`(셀렉터 `app: api-legacy`, 맞는 워크로드 없음) → `notes: no_target`, 선 없음 ③ 새 파일 `data/services/pg-external.yaml`(`spec.selector` 없음) → `notes: selector_missing`, 선 없음 | AC-3D26 |
| **K-7** `20260915-101010` | 새 파일 `batch/configmaps/report-settings.yaml`에 ConfigMap 문서 **2개**(`report-settings`, `report-schedule`) → 블록 2개·같은 파일로 이동(`file.line`은 문서마다 다름), 파일 상태 사유 `MULTI_DOCUMENT_FILE` 추가(상태는 그대로 `warning`) | AC-3D31 |

- K-9는 **다른 클러스터**라 드리프트를 계산하지 않는다 → 다른 예시의 드리프트 건수에 영향 없음(명세 3.10 의도).
- K-7의 기존 내용(YAML 구문 오류 `prod/deployments/web.yaml`, 경로 불일치 `data/services/pg.yaml`, 예상 밖 파일)은 그대로. 파일 상태 `warning` 유지(사유가 1개 늘어난다).
- K-3 `20260918-230000`(스캔 오류 `data/statefulsets/postgres.yaml`)와 K-10 `20260912-020000`(Helm `monitoring/grafana`)은 **보강 없이** AC-3D30·AC-3D33을 만족한다.
- K-2 `20260910-000000`은 `mode: last_result` + `resultAvailable: true`(mock에서 reset까지 유지) → 겹쳐 보기 사용 가능(AC-3D29).

### 12.4 대규모 시나리오 (AC-3D19·20·22)

새 mock 시나리오 **`large`**(그룹 `k8s-snapshots`). 트리에 **아래 두 개만** 담는다(기본 예시와 섞지 않아 기본 목록이 느려지지 않는다, 명세 3.10).

| ID | 규모 | 용도 |
|---|---|---|
| `20260920-030000` | 네임스페이스 20 × 50 = **리소스 1,000개**, 기본 켬 선 **약 1,960개**(전체 약 2,580개) | AC-3D19·AC-3D20 |
| `20260920-040000` | 네임스페이스 64 × 50 = **리소스 3,200개** | AC-3D22(`summary.grouped: true`) |

판 하나의 구성(결정적 생성, 이름 `bench-01`…):

| 종류 | 수 | 참조 |
|---|---|---|
| Namespace | 1 | (판) |
| Deployment | 13 | `envFrom` ConfigMap 3, `env.secretKeyRef` Secret 2, `serviceAccountName` 지정 |
| StatefulSet | 2 | `volumeClaimTemplates` 1(→ PVC 2씩), ConfigMap 1·Secret 1 |
| Service | 15 | 워크로드마다 1(셀렉터 일치) |
| Ingress | 4 | 규칙 2개씩 → Service 2개씩 |
| ConfigMap | 7 | |
| PersistentVolumeClaim | 4 | StatefulSet 이름 규칙 |
| HorizontalPodAutoscaler | 2 | |
| PodDisruptionBudget | 1 | |
| NetworkPolicy | 1 | 빈 셀렉터 |
| **합계** | **50** | 기본 켬 선 ≈ 98개/판 |

- 클러스터 ID는 **대시보드 클러스터와 다른 값**(이름 `bench-eks`) → 드리프트 `CLUSTER_MISMATCH`(계산 안 함). 이유: 자동 대상이 바뀌어 기본 예시 동작이 흔들리지 않게, mock에서 1,000개 리소스를 반복 비교하지 않게.
- 스캔 발견 0건, 파일 상태 `ok`, 휴지통 0개. 비밀값 문자열을 넣지 않는다.

### 12.5 mock 시나리오 그룹 (`common.md` 6.1 추가)

기존 그룹 **`k8s-snapshots`에 시나리오 1개(`large`)만 더한다**. 기존 시나리오 ID·동작·응답 모양은 바꾸지 않는다(K8S-API 14.4 표는 그대로 두고 이 문서가 추가분을 정의한다).

| id | 재현 내용 |
|---|---|
| `large` (추가) | 12.4의 대규모 스냅샷 2개만(기본 예시 없음). 3D 성능·묶어 보기 확인 |

- 관계 예외(K-9)·여러 문서 파일(K-7) 보강은 **`default` 시나리오에 들어간다**(별도 시나리오를 만들지 않는다). AC-3D26·3D31을 기본 상태에서 바로 확인할 수 있고, 시나리오가 늘면 Popover만 길어진다.
- 시나리오를 바꾸면 기존 규칙대로 `k8s-snapshots.snapshot`·`snapshot-menu.snapshot`을 다시 보낸다. 그래프 캐시는 시나리오 전환·reset에서 비운다.
- WebGL 없음·저사양·컨텍스트 손실은 **서버 mock이 아니라 프론트 개발 설정**으로 흉내 낸다(명세 3.10, AC-3D03·07).

---

## 13. 에러 코드

| HTTP | code | 언제 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | `:id` 형식, `rules`·`drift` 쿼리 값 |
| 403 | `SNAPSHOT_PATH_REJECTED` | 경로 해석에서 링크·루트 밖(K8S-API 1.1) |
| 404 | `RESOURCE_NOT_FOUND` | 없는 스냅샷·휴지통 스냅샷 (`details.resource = { kind: "K8sSnapshot", id }`) |
| 503 | `SOURCE_UNAVAILABLE` | 스냅샷 출처 없음·읽기 실패·규칙 lib 없음. `details.source = SourceStatus` |
| 500 | `INTERNAL_ERROR` | 그 밖(그래프 만들기 실패 포함) |

- **클러스터 쪽 문제는 오류가 아니다**: 200 + `graph.drift.usable: false`(`common.md` 3.2).
- 그래프 만들기가 실패하면 빈 그래프로 감추지 않고 **500**을 낸다(빈 그래프는 "리소스 없음"으로 오해된다). 로그에는 스냅샷 ID + 코드만.

---

## 14. 설정 (api `.env.example`)

| 이름 | 기본 | 설명 |
|---|---|---|
| `K8S_GRAPH_CACHE_SIZE` | `8` | 그래프 LRU 캐시 개수(1~64) |
| `K8S_GRAPH_GROUP_THRESHOLD` | `3000` | 넘으면 `summary.grouped: true`(500~20000) |
| `K8S_GRAPH_MAX_BLOCKS` | `20000` | 안전 상한. 넘으면 잘림 표시 |
| `K8S_GRAPH_MAX_EDGES` | `40000` | 안전 상한 |

- 기존 k8s 스냅샷 변수(K8S-API 15절)는 그대로 쓴다. 대시보드 자체 DB `settings`에는 넣지 않는다.

---

## 15. 수용 기준 ↔ 계약 매핑 (이번 범위 AC-3D01~33)

| AC | 충족 위치 | 비고 |
|---|---|---|
| 3D01·3D02 | — | 프론트(번들·지연 로딩) |
| 3D03 | 9.1 | 표가 같은 응답으로 그려짐 |
| 3D04 | 9.1, 9.2, 10.1 `summary` | 3D·표·정보 줄이 같은 수치 |
| 3D05~3D09 | — | 프론트(모션·키보드·상호작용) |
| 3D10 | 2.1(기본 전체), 9.2 `facets` | 필터는 재조회 없이 |
| 3D11 | 4.3 배열 순서, 2.3 `graph.version` | 좌표 없음·결정적 순서 |
| 3D12 | 4.2 `id` 규칙 | `res=`에 넣는 값 |
| 3D13 | 0절, 1.2, 7.1 | GET 전용·드리프트 계산 없음·새 호출 없음 |
| 3D14 | 1.4, 4.4 화이트리스트, 5.2·5.3 근거, 7.3(값 없음) | 테스트로 "가림 대상 원문 없음" 확인 |
| 3D15 | 0절, 13절 | 쓰기 엔드포인트 없음 |
| 3D16 | 0절 SSE 재조회, 2.3 `graph.version`, 10.1 `summary` | "구성이 바뀌었습니다" 판단 근거 |
| 3D17 | — | 프론트 |
| 3D18 | 11.1 | live에서 예시로 바꾸지 않음 |
| 3D19 | 12.4 `large` | 프론트 측정 |
| 3D20 | 10.2 | 백엔드 측정값 보고 |
| 3D21 | — | 프론트 |
| 3D22 | 10.1 `grouped`·`groups[]` | 표는 전체 행 |
| 3D23 | 0절, 17절 | 기존 탭·주소·응답 불변 |
| 3D24 | 3절, 4절, 10.1 확인식 | 비교 불가 종류도 블록 |
| 3D25 | 5.1·5.3, 12.2 기대값 | K1~K7 기본 켬, 근거·확실성 |
| 3D26 | 6.1·6.2, 12.3 K-9 | 상태색 아님 |
| 3D27 | 7.2·7.3, 10.1 `driftMarkers` | 표식 수 = 드리프트 건수 |
| 3D28 | 7.1·7.2, 11.1 | 계산 버튼은 기존 POST, 임대 그대로 |
| 3D29 | 7.2 `usable`, 12.3 K-2 | 지난 결과 + 계산 시각 |
| 3D30 | 8.1 `firstLine`, 4.1 `navigate.line` | 발견 줄로 이동 |
| 3D31 | 3절 `_unparsed`, 4.1 `file.line`, 4.2 `#<index>`, 6.2, 12.3 K-7 | |
| 3D32 | 4.1 `navigate` | 주소 조립은 프론트 |
| 3D33 | 8.2 `markers.helm` | |

---

## 16. 명세·디자인·공통 규약과 다르게 정한 점

1. **새 엔드포인트 1개(`…/graph`), 새 문서 1개.** 명세 7절은 "`docs/api/snapshot-3d.md` 또는 K8S-API에 절 추가(백엔드 결정)"였다. → 새 문서. 2~4단계가 같은 문서로 자라야 하고, K8S-API(1,600줄)를 더 키우면 기존 계약을 읽기 어렵다.
2. **관계·드리프트·스캔을 한 응답에** 담는다(3D 전용 드리프트 조회 없음). 표식 수와 배지 건수가 **한 시점의 같은 결과**에서 나와야 어긋나지 않고(AC-3D27), 왕복 2회는 p95 1초에 불리하다.
3. **`namespace.yaml`은 판, 블록이 아니다**(3D-D 4.2를 따른다). 그래서 AC-3D24의 "블록 수 = 리소스 문서 수 + 유령 수"는 10.1의 확인식(`blocks + namespaceDocuments = documents + ghosts`)으로 읽는다. Namespace 문서의 드리프트·스캔 표식은 **판**에 싣는다(표식 수가 드리프트 건수와 어긋나지 않게).
4. **유령 블록은 항상 응답에 있고, 화면이 관계 필터로 숨긴다**(`ghostFromRules`). 기본 끔 관계(K9 등)의 유령이 기본 장면을 어지럽히지 않게 하되 표·개수에서는 빠지지 않게 한다.
5. **`evidence`는 문자열 한 줄 + `evidenceItems` 배열**을 함께 준다. 디자인은 문자열 하나를 요청했지만(3D-D 4.6), 관계 표의 펼침·근거 여러 개(같은 대상 다중 참조)를 위해 구조화된 배열을 덧붙였다. 화면은 `evidence`만 써도 된다.
6. **확실성 값은 `confirmed` / `estimated`**(디자인 표기)를 쓴다. 드리프트·상태 계약의 다른 enum과 겹치지 않는다.
7. **`markers.scan`에 `firstLine`을 넣었다.** 3D-D 10.4의 `?view=files&file=&line=<첫 발견 줄>` 이동을 화면이 계산하지 않게.
8. **`summary` 화이트리스트에 이미지 문자열을 넣지 않았다.** 3D·표에서 쓰지 않고, ECR 이미지 문자열에는 계정 ID가 들어간다(AC-3D14의 취지).
9. **잘림 상한(20,000 블록)을 두었다.** 명세 A4의 3,000 블록은 "묶어 보기"로 다루지만, 손으로 만든 거대 폴더에서 서버가 멈추지 않게 안전 장치를 둔다.
10. **mock 시나리오는 `large` 하나만 추가**했다. 명세 3.10의 "짝 없음"은 4단계(보류)다. 관계 예외(K-9)·여러 문서(K-7)는 기본 시나리오에 넣어 기본 상태에서 확인한다.
11. **`graph.state`로 "그리지 않음"을 표현**한다(200 유지). 다른 겹쳐 보기·머리 정보는 그대로 보인다.
12. **`limit`/`offset`을 두지 않았다**(`common.md` 1.3의 선택적 페이지네이션 예외). 3D와 표가 같은 배열을 써야 개수가 어긋나지 않는다.

---

## 17. 기존 계약에 영향 없음 (불변 목록)

- `/api/k8s-snapshots`(목록·요약·상세·파일·검사·저장·라벨·삭제·휴지통·스캔 규칙·드리프트 규칙·드리프트 조회/요청) 응답 모양·오류 코드: **그대로**. 필드를 더하지 않는다.
- `/api/aws-snapshots/**`, `/api/snapshot-menu`, `/api/overview`, `/api/health`: **그대로**(새 출처·새 check 없음).
- SSE: 토픽·이벤트 이름·payload **그대로**. 새 토픽 없음.
- mock: 그룹 키·기존 시나리오 ID·기본값 **그대로**(그룹 `k8s-snapshots`에 옵션 `large` 1개 추가).
- `deploy/rbac.yaml`: **그대로**(AC-3D13).
- `common.md` 1.4 예외: **늘리지 않는다**(그래프 응답에 원문 값이 없다).
- 바뀌는 것(구현 단계): ① `K8sSnapshotsService`에 그래프 캐시·컨트롤러 라우트(`GET :id/graph`) ② `DriftService`에 읽기 전용 접근자 `graphDrift()` ③ mock 픽스처 보강(12.2·12.3)과 시나리오 `large` ④ `common.md` 6.1·8절. 기존 테스트 기대값(파일 상태 10건, 드리프트 건수, 비교 불가 종류)은 유지한다.
- 구현 위치(제안): `apps/api/src/k8s-snapshots/graph/{relations.ts, graph-builder.ts, graph.service.ts}` — `relations.ts`는 `K8sAnalysis.docs`만 입력으로 받는 **순수 함수**(fs·클러스터 접근 없음), `graph-builder.ts`가 판·층·순서·요약을, `graph.service.ts`가 캐시와 드리프트·스캔 겹치기를 맡는다.

---

## 18. 확장 자리 (2~4단계, 보류)

지금 만들지 않는다. 나중에 이어 붙일 자리만 적는다.

- 2단계(AWS 구성도): `GET /api/aws-snapshots/:id/graph`를 **같은 봉투·같은 타입 이름**(`plates`/`blocks`/`edges`/`groups`/`summary`/`facets`)으로 두고, `rules`에 `A1`~`A11`, `markers`에 `autoCreated`, `navigate.primary: 'template'`(템플릿 줄 이동)을 더한다. 층 정의(`layers`)는 응답이 주므로 화면 구조를 바꾸지 않아도 된다(3D-D 15절과 같은 판단).
- 3단계(시간축): `GET /api/k8s-snapshots/timeline`·`/api/aws-snapshots/timeline`. 식별값은 이 문서의 `resourceKey`를 재사용한다.
- 4단계(통합 장면): `GET /api/k8s-snapshots/:id/graph?with=aws:<id>`로 두 층과 `X1`~`X5`를, 짝 후보는 `GET /api/k8s-snapshots/:id/pair-candidates`로 둔다.
- 확장해도 1단계 필드는 **이름·뜻을 바꾸지 않는다**.

---

## 19. 변경 이력

- 2026-09-20: 최초 작성 (backend, 4단계 계약. 1단계 = K8s 구성도·드리프트만. 구현 전)
- 2026-09-20: designer 설계(`docs/design/snapshot-3d.md` 14절) 반영 — 이름을 화면 개념에 맞춤(`plates`/`blocks`/`edges[].rule`/`certainty: estimated`/`notes[]`/`summary{}`), `blocks[]` 배열 = 배치 순서 명시, `file.line`(문서 시작 줄)·`markers.scan.firstLine`·`navigate.line` 추가, `namespace.yaml`을 판으로(블록 아님) 정리.
- 2026-09-20 (5단계 구현, backend): **계약이 바뀐 곳 — frontend 확인 필요**
  1. `markers.scan`에 **`level`(`error`\|`warn`\|`null`)·`count`** 추가(publisher 요청. `BlockMarkers`가 그대로 쓴다). `errors`·`warnings`·`firstLine`은 그대로.
  2. **AC-3D24 확인식 정정**: `blocks + namespaceDocuments = documents + ghosts`(해석 실패 파일은 `documents`에 이미 1개로 들어 있어 `unparsedBlocks`를 더하지 않는다, 10.1).
  3. **중복 정의·`metadata.namespace` 없음 문서는 블록만 그리고 관계를 뽑지 않는다**(5.1). 드리프트에서도 `skipped`이라 같은 규칙으로 맞췄다(초안은 "그리되 같은 선이 생긴다"였다).
  4. K-1 기대값 정정(12.2): K9 선 7 → **8**, 전체 선 26 → **27**(CronJob `batch/nightly-report`도 `default` ServiceAccount 유령을 가리킨다. 유령 수 9는 그대로 — batch 판의 두 워크로드가 같은 유령을 공유).
  5. 성능·응답 크기 측정값을 10.2에 기록. 응답 크기는 추정 0.6 MB → **측정 2.0 MB**(기준 규모)로 고쳤다.
  6. 중복 정의 블록 id에 문서가 2개 이상이면 `#dup:<경로>#<documentIndex>`가 붙는다(4.2).
  7. `drift=off`일 때는 "추가됨" 유령이 생기지 않아 블록 수가 그만큼 적다(K-1: 34 → 33). `graph.drift.badge`는 그대로 준다.
  - 바뀌지 않은 것: 엔드포인트 경로·쿼리·오류 코드, `plates`/`blocks`/`edges`/`summary`/`facets`/`groups` 필드 이름, `ghost.reason` 5종, `certainty` 2종, 관계 규칙 K1~K11과 근거 코드, mock 시나리오 `large`, 기존 `/api/k8s-snapshots/**` 응답·SSE·mock 그룹.
- 2026-09-20 (mock 보강, backend): **mock 예시에 `Job` 1개 추가 — K-1 기대값이 바뀐다(frontend 확인 필요)**
  - 추가한 것: `batch/jobs/report-backfill.yaml`(소유자 없는 독립 Job, 모든 예시 스냅샷의 공통 리소스). 이유는 3D-D 4.11.2 `chamfer` 모양을 실제 장면에서 회귀 점검할 Job이 없었기 때문(frontend 보고 2026-09-20 (8)).
  - K-1 기대값: `documents` 29 → **30**, `resourceBlocks` 24 → **25**, `blocks` 33 → **34**, `edges` 27 → **28**(K9 8 → **9**), 비교 불가 4 → **5**(ConfigMap 2·NetworkPolicy 1·CronJob 1·**Job 1**), `plates[ns:batch].resourceCount` 3 → **4**.
  - **바뀌지 않은 것**: 드리프트 건수 3건(변경 1·삭제 1·추가 1), `ghosts` 9, `edgesDefaultOn` 15, `plates` 5, `scanMarkers` 0, 파일 상태, 시나리오 `large`(Job 없음 — 1,000/3,200개 구성표를 건드리지 않았다).
  - `plates[].byLayer` 예시 값을 실제 응답에 맞췄고(0인 층은 키가 없다) 타입을 `Partial<Record<…>>`로 고쳤다(2.2·3절).
- 2026-09-20 (판 집계 결함 수정, backend): **`plates[].byLayer`가 드리프트 "추가됨" 유령을 빠뜨리던 것을 고쳤다 — frontend 확인 필요**
  - 증상: 겹쳐 보기를 얹을 때 판을 다시 만들면서 `resourceCount`·`ghostCount`만 다시 세고 `byLayer`는 겹쳐 보기 **전** 값을 그대로 복사했다. 그래서 K-1 `ns:prod`가 `byLayer.workload 3`을 주는데 그 판·층의 실제 블록은 4개였다(`ghost:apps/Deployment/prod/payments` 누락).
  - 수정 뒤 K-1 `ns:prod.byLayer`: `{ storage 2, workload 4, service 2, ingress 2, aux 6 }`(`drift=off`면 `workload 3`). 다른 판은 그대로.
  - 계약에 **불변식**을 명시했다(3절): `byLayer` 합 = `resourceCount + ghostCount`, 모든 판의 합 = `summary.blocks`. 12.2에 판별 기대값 표를 넣고 테스트로 고정했다.
