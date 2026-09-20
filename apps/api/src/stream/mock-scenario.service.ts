import {
  HttpStatus,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import {
  ApiException,
  resourceNotFound,
  validationFailed,
} from '../common/api-error';
import { DATA_SOURCE_MODE } from '../common/data-source';
import { discoverProviders } from '../common/discovery';
import {
  MOCK_SCENARIO_METADATA,
  type MockScenarioGroup,
  type MockScenarioTarget,
} from '../common/extension-points';
import type { DataSourceMode } from '../config/env.validation';

const GROUP_ORDER: MockScenarioGroup[] = [
  'cluster',
  'db',
  'cost',
  'advisor',
  'snapshots',
  'k8s-snapshots',
];

const GROUP_LABEL: Record<MockScenarioGroup, string> = {
  cluster: '클러스터',
  db: '데이터베이스',
  cost: '비용',
  advisor: '어드바이저',
  snapshots: 'AWS 스냅샷',
  'k8s-snapshots': 'Kubernetes 스냅샷',
};

/** 기본 시나리오 (docs/api/common.md 6.1). 목록에 없으면 첫 번째 */
const DEFAULT_SCENARIO: Record<MockScenarioGroup, string> = {
  cluster: 'mixed',
  db: 'warning',
  cost: 'normal',
  advisor: 'normal',
  snapshots: 'default',
  'k8s-snapshots': 'default',
};

/** 시나리오 표시 문구 (계약 6.1 표). 없는 ID는 ID 그대로 */
const OPTION_TEXT: Record<string, [string, string]> = {
  'cluster:mixed': [
    '혼합 (기본)',
    '정상·주의·장애·알 수 없음이 영역마다 섞여 있음',
  ],
  'cluster:healthy': ['모두 정상', ''],
  'cluster:warning': ['주의만', 'cordon, 재시작 1~2회, 사용률 80%'],
  'cluster:critical': [
    '장애 다수',
    'NotReady 노드, CrashLoopBackOff, Pending, PVC Lost',
  ],
  'cluster:no-metrics': ['metrics-server 없음', 'CPU·메모리 알 수 없음'],
  'cluster:kube-stale': ['watch 끊김', 'kube 출처 stale, 마지막 값 유지'],
  'cluster:no-cluster': ['클러스터 연결 없음', '클러스터 영역 알 수 없음'],
  'cluster:empty': ['노드 0개', '클러스터 전체 장애'],
  'db:ok': ['정상', ''],
  'db:warning': ['주의 (기본)', '연결 82%, 긴 쿼리 3건, idle in tx 12분'],
  'db:critical': ['장애', '연결 92%, 30분 넘은 쿼리, 잠금 대기, standby 끊김'],
  'db:unreachable': ['접속 실패', '파드는 떠 있고 접속 실패'],
  'db:no-pod': ['DB 파드 없음', '대표 사유가 파드 쪽'],
  'db:standby': ['standby 지연', 'standby 1개, 복제 지연 주의'],
  'db:stale': ['수집 중단', '45초 뒤 데이터 오래됨'],
  'db:not-configured': ['DB 설정 없음', ''],
  'cost:normal': ['정상 (기본)', '예산·급증 정상'],
  'cost:budget-warning': ['예산 주의', '예측 90% 이상'],
  'cost:budget-over': ['예산 초과', '누적 100% 이상'],
  'cost:spike-warning': ['급증 주의', ''],
  'cost:spike-critical': ['급증', '원인 목록 포함'],
  'cost:forecast-unavailable': ['AWS 예측 불가', '추정 월말로 예산 판단'],
  'cost:ce-unavailable': ['Cost Explorer 사용 불가', 'AccessDenied'],
  'cost:ce-limit-reached': ['일일 호출 한도', ''],
  'cost:unpriced': ['단가 없음 포함', ''],
  'cost:spot-fallback': ['스팟 시세 실패', '온디맨드 상한'],
  'cost:baseline-collecting': ['기준 수집 중', '소모율 기록 24시간 미만'],
  'cost:no-budget': ['예산 미설정', ''],
  'advisor:normal': [
    '기본',
    '브리지가 켜져 있으면 실제 분석, 꺼져 있으면 예시 응답',
  ],
  'advisor:example': ['예시 응답', ''],
  'advisor:bridge-down': ['브리지 꺼짐', ''],
  'advisor:login-required': ['로그인 필요', ''],
  'advisor:usage-limit': ['사용량 한도', ''],
  'advisor:delayed': ['지연', ''],
  'advisor:timeout': ['시간 초과', ''],
  'advisor:invalid-response': ['응답 형식 오류', ''],
  'advisor:budget-exceeded': ['비용 상한 초과', ''],
};

export interface MockGroupView {
  id: MockScenarioGroup;
  label: string;
  active: string;
  options: { id: string; label: string; description: string }[];
  fastTimers?: boolean;
}

/**
 * 선택 필드(options·defaultScenario·fastTimers·setFastTimers)는 MockScenarioTarget에 정식으로 선언돼 있다.
 * fastTimers는 예전 구현 호환을 위해 함수 형태도 받는다.
 */
type MockTargetCompat = Omit<MockScenarioTarget, 'fastTimers'> & {
  fastTimers?: boolean | (() => boolean);
};

/**
 * mock 시나리오 전환 (docs/api/common.md 6절).
 * `@MockScenarioTargetProvider()`가 붙은 provider를 찾아 group별로 위임한다. mock 모드에서만 바꿀 수 있다.
 * 대상의 setScenario()가 HttpException(예: 409 RUN_ACTIVE)을 던지면 그대로 응답한다.
 */
@Injectable()
export class MockScenarioService implements OnApplicationBootstrap {
  private targets = new Map<MockScenarioGroup, MockScenarioTarget>();

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly dataSource: DataSourceMode,
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const found = discoverProviders<MockScenarioTarget>(
      this.discovery,
      this.reflector,
      MOCK_SCENARIO_METADATA,
    );
    this.targets = new Map(found.map((t) => [t.group, t]));
  }

  private view(t: MockScenarioTarget): MockGroupView {
    const own = new Map((t.options ?? []).map((o) => [o.id, o]));
    const v: MockGroupView = {
      id: t.group,
      label: GROUP_LABEL[t.group],
      active: t.currentScenario(),
      options: t.scenarios.map((id) => {
        const o = own.get(id);
        const text = OPTION_TEXT[`${t.group}:${id}`];
        return {
          id,
          label: o?.label ?? text?.[0] ?? id,
          description: o?.description ?? text?.[1] ?? '',
        };
      }),
    };
    if (t.group === 'advisor') {
      const ft = (t as MockTargetCompat).fastTimers;
      if (typeof ft === 'function') v.fastTimers = ft.call(t);
      else if (typeof ft === 'boolean') v.fastTimers = ft;
    }
    return v;
  }

  private defaultOf(t: MockScenarioTarget): string | undefined {
    if (t.defaultScenario && t.scenarios.includes(t.defaultScenario))
      return t.defaultScenario;
    const def = DEFAULT_SCENARIO[t.group];
    return t.scenarios.includes(def) ? def : t.scenarios[0];
  }

  list() {
    const enabled = this.dataSource === 'mock';
    return {
      dataSource: this.dataSource,
      enabled,
      generatedAt: new Date().toISOString(),
      groups: enabled
        ? GROUP_ORDER.filter((g) => this.targets.has(g)).map((g) =>
            this.view(this.targets.get(g)!),
          )
        : [],
    };
  }

  private assertMock(): void {
    if (this.dataSource !== 'mock') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'MOCK_MODE_ONLY',
        'mock 모드에서만 사용할 수 있습니다.',
      );
    }
  }

  set(group: string, scenario: string, fastTimers?: boolean): MockGroupView {
    this.assertMock();
    const t = this.targets.get(group as MockScenarioGroup);
    if (!t)
      throw resourceNotFound(
        { kind: 'MockScenarioGroup', id: group },
        '없는 시나리오 그룹입니다.',
      );
    if (!t.scenarios.includes(scenario)) {
      throw validationFailed([
        {
          field: 'scenario',
          value: scenario,
          constraints: [`scenario must be one of: ${t.scenarios.join(', ')}`],
        },
      ]);
    }
    t.setScenario(scenario);
    if (fastTimers !== undefined && typeof t.setFastTimers === 'function')
      t.setFastTimers(fastTimers);
    return this.view(t);
  }

  reset() {
    this.assertMock();
    for (const g of GROUP_ORDER) {
      const t = this.targets.get(g);
      if (!t) continue;
      const def = this.defaultOf(t);
      if (def !== undefined) t.setScenario(def);
      if (typeof t.resetData === 'function') t.resetData();
    }
    return this.list();
  }
}
