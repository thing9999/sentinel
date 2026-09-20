import { NO_EXECUTE_NOTICE } from '../advisor.types';
import {
  exampleLlmOutput,
  mockClusterContribution,
  mockCostContribution,
  mockDbSection,
} from '../mock/mock-fixtures';
import { buildAdvisorSnapshot } from '../snapshot/snapshot-builder';
import {
  extractJsonObject,
  finalizeResult,
  parseFieldPath,
  resolveField,
  validateSuggestion,
  valuesMatch,
} from './finalize-result';

const NOW = new Date('2026-09-19T05:00:00.000Z');
const built = buildAdvisorSnapshot(
  {
    cluster: mockClusterContribution(),
    db: mockDbSection(),
    cost: mockCostContribution(NOW),
  },
  { now: NOW, dataSource: 'mock', includeSystem: false },
)!;
let n = 0;
const input = (
  structuredOutput: unknown,
  resultText: string | null = null,
) => ({
  structuredOutput,
  resultText,
  snapshot: built.snapshot,
  pseudonyms: built.pseudonyms,
  prechecks: built.prechecks.items,
  idFactory: () => `id-${++n}`,
});

function suggestion(over: Record<string, unknown> = {}) {
  return {
    title: '제목',
    category: 'cost',
    severity: 'medium',
    priority: 1,
    targets: [{ kind: 'NodeGroup', namespace: null, name: 'batch' }],
    evidence: [
      { field: 'nodeGroups[batch].cpu.avgPct', value: 18, text: '평균 18%' },
    ],
    precheckIds: [],
    savings: null,
    steps: [{ text: '단계', code: null, language: null }],
    risk: { level: 'low', reason: '낮음' },
    verification: null,
    ...over,
  };
}

describe('finalizeResult (결과 정리 B.4)', () => {
  it('예시 응답: 검증·서버 절감액·환각 대상 맨 뒤', () => {
    const out = finalizeResult(input(exampleLlmOutput()));
    if (!out.ok) throw new Error('expected ok');
    const s = out.suggestions;
    expect(s).toHaveLength(5);
    expect(s.map((x) => x.priority)).toEqual([1, 2, 3, 4, 5]);
    // 스냅샷에 없는 payment-gateway → unverified, 맨 뒤, 링크 없음
    const last = s[4];
    expect(last.title).toContain('payment-gateway');
    expect(last.unverified).toBe(true);
    expect(last.targets[0]).toMatchObject({ inSnapshot: false, ref: null });
    // 1순위: 사전 점검 R-GRAVITON·R-ONDEMAND 서버 절감액으로 덮어씀
    const first = s[0];
    expect(first.savings?.source).toBe('server');
    const g = built.prechecks.items.find((i) => i.ruleId === 'R-GRAVITON')!
      .savings!.monthlyUsd;
    const o = built.prechecks.items.find((i) => i.ruleId === 'R-ONDEMAND')!
      .savings!.monthlyUsd;
    expect(first.savings?.monthlyUsd).toBeCloseTo(g + o, 2);
    expect(first.evidence.every((e) => e.verified)).toBe(true);
    expect(first.noExecuteNotice).toBe(NO_EXECUTE_NOTICE);
    expect(first.source).toBe('llm');
    expect(first.steps[0].code?.language).toBe('bash');
    expect(first.steps[0].code?.content).toContain('docker manifest');
    expect(out.counts).toEqual({
      suggestions: 5,
      high: 2,
      medium: 2,
      low: 1,
      dropped: 0,
    });
  });

  it('필수 필드 없는 제안은 버리고 dropped로 센다', () => {
    const out = finalizeResult(
      input({
        suggestions: [
          suggestion(),
          { ...suggestion(), title: '' },
          { ...suggestion(), steps: [] },
          'x',
        ],
      }),
    );
    expect(out.ok && out.counts.dropped).toBe(3);
    expect(out.ok && out.suggestions).toHaveLength(1);
  });

  it('전체 해석 불가 → invalid_response', () => {
    expect(finalizeResult(input(null, '그냥 문장입니다'))).toEqual({
      ok: false,
      reason: 'invalid_response',
      dropped: 0,
    });
    expect(finalizeResult(input({ suggestions: [{ title: 'x' }] }))).toEqual({
      ok: false,
      reason: 'invalid_response',
      dropped: 1,
    });
  });

  it('빈 제안 목록은 성공 (0건)', () => {
    const out = finalizeResult(input({ suggestions: [] }));
    expect(out.ok && out.suggestions).toEqual([]);
  });

  it('구조화 출력이 없으면 텍스트에서 JSON 추출', () => {
    const text =
      '결과:\n```json\n' +
      JSON.stringify({ suggestions: [suggestion()] }) +
      '\n```\n끝';
    const out = finalizeResult(input(null, text));
    expect(out.ok && out.suggestions).toHaveLength(1);
  });

  it('같은 사전 점검을 참조하는 제안은 우선순위 높은 것으로 병합', () => {
    const out = finalizeResult(
      input({
        suggestions: [
          suggestion({
            priority: 2,
            title: 'B',
            precheckIds: ['R-GP2'],
            targets: [
              {
                kind: 'PersistentVolumeClaim',
                namespace: 'data',
                name: 'data-postgres-0',
              },
            ],
          }),
          suggestion({
            priority: 1,
            title: 'A',
            precheckIds: ['R-GP2', 'R-FAKE'],
          }),
        ],
      }),
    );
    if (!out.ok) throw new Error('expected ok');
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].title).toBe('A');
    expect(out.suggestions[0].precheckIds).toEqual(['R-GP2']); // 모르는 ID 제거
    expect(out.suggestions[0].targets.map((t) => t.name)).toEqual([
      'batch',
      'data-postgres-0',
    ]);
    expect(out.suggestions[0].savings?.source).toBe('server');
  });

  it('LLM 절감액은 계산식이 있을 때만 llm 출처', () => {
    const withFormula = finalizeResult(
      input({
        suggestions: [
          suggestion({ savings: { monthlyUsd: 10, formula: '$1 × 10' } }),
        ],
      }),
    );
    expect(withFormula.ok && withFormula.suggestions[0].savings).toMatchObject({
      source: 'llm',
      monthlyUsd: 10,
      kind: 'estimated',
    });
    const noFormula = finalizeResult(
      input({
        suggestions: [
          suggestion({ savings: { monthlyUsd: 10, formula: ' ' } }),
        ],
      }),
    );
    expect(noFormula.ok && noFormula.suggestions[0].savings).toBeNull();
  });

  it('근거 값이 스냅샷과 다르면 verified=false, 모두 미확인이면 unverified', () => {
    const out = finalizeResult(
      input({
        suggestions: [
          suggestion({
            evidence: [
              {
                field: 'nodeGroups[batch].cpu.avgPct',
                value: 55,
                text: '틀린 값',
              },
            ],
          }),
        ],
      }),
    );
    expect(out.ok && out.suggestions[0].evidence[0].verified).toBe(false);
    expect(out.ok && out.suggestions[0].unverified).toBe(true);
  });

  it('가명 노드는 실제 이름으로 복원', () => {
    const alias = Object.keys(built.pseudonyms.nodes)[0];
    const out = finalizeResult(
      input({
        suggestions: [
          suggestion({
            targets: [{ kind: 'Node', namespace: null, name: alias }],
          }),
        ],
      }),
    );
    if (!out.ok) throw new Error('expected ok');
    expect(out.suggestions[0].targets[0]).toMatchObject({
      snapshotName: alias,
      name: built.pseudonyms.nodes[alias],
      inSnapshot: true,
      ref: {
        kind: 'Node',
        namespace: null,
        name: built.pseudonyms.nodes[alias],
      },
    });
  });

  it('제어 문자 제거·길이 제한 (내용은 유지)', () => {
    const v = validateSuggestion(
      suggestion({ title: 'a\u0007b' + 'x'.repeat(400) }),
    )!;
    expect(v.title.startsWith('ab')).toBe(true);
    expect(v.title).toHaveLength(300);
  });
});

describe('필드 경로', () => {
  it('파싱과 조회', () => {
    expect(
      parseFieldPath('cost.alternatives[m6i.large].graviton.usdPerHour'),
    ).toEqual([
      { key: 'cost' },
      { key: 'alternatives' },
      { select: 'm6i.large' },
      { key: 'graviton' },
      { key: 'usdPerHour' },
    ]);
    expect(
      resolveField(
        built.snapshot,
        'cost.alternatives[m6i.large].graviton.usdPerHour',
      ),
    ).toEqual({ found: true, value: 0.0816 });
    expect(
      resolveField(
        built.snapshot,
        'workloads[batch/report-worker].containers[worker].requests.cpuMillicores',
      ).value,
    ).toBe(1000);
    expect(
      resolveField(built.snapshot, 'cost.allocation[unallocated].sharePct')
        .value,
    ).toBe(42.3);
    expect(
      resolveField(built.snapshot, 'workloads[nope/x].desired').found,
    ).toBe(false);
  });

  it('값 비교: 숫자 ±1%, 문자열 대소문자 무시', () => {
    expect(valuesMatch(18, 18.1)).toBe(true);
    expect(valuesMatch('18%', 18)).toBe(true);
    expect(valuesMatch(20, 18)).toBe(false);
    expect(valuesMatch('GP2', 'gp2')).toBe(true);
    expect(valuesMatch(null, null)).toBe(true);
    expect(valuesMatch(null, 3)).toBe(false);
  });

  it('extractJsonObject: 앞뒤 문장 속 첫 객체', () => {
    expect(extractJsonObject('앞 {"a":{"b":"}"}} 뒤')).toEqual({
      a: { b: '}' },
    });
    expect(extractJsonObject('없음')).toBeUndefined();
  });
});
