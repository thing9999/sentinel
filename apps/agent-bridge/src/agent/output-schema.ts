/**
 * 어드바이저 출력 스키마 (promptVersion: advisor-v2)
 * v2: kOps 전환으로 스냅샷 cluster 블록이 바뀌었다(platform kops, workerCount/controlPlaneCount,
 *     cluster.controlPlane, 비용 카테고리 controlPlane). api와 함께 배포한다 — 구 v1은 받지 않는다.
 * 계약: docs/api/architecture-advisor.md B.4. api가 같은 규칙으로 다시 검증한다.
 * 프롬프트·스키마는 브리지가 소유한다 (api는 스냅샷만 보낸다).
 */
export const PROMPT_VERSION = 'advisor-v2';
export const SUPPORTED_PROMPT_VERSIONS: readonly string[] = [PROMPT_VERSION];

export const ADVISOR_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'category',
          'severity',
          'priority',
          'targets',
          'evidence',
          'steps',
          'risk',
        ],
        properties: {
          title: { type: 'string', maxLength: 300 },
          category: {
            enum: [
              'cost',
              'reliability',
              'performance',
              'security',
              'database',
            ],
          },
          severity: { enum: ['high', 'medium', 'low'] },
          priority: { type: 'integer', minimum: 1 },
          targets: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              type: 'object',
              required: ['kind', 'name'],
              additionalProperties: false,
              properties: {
                kind: { type: 'string' },
                namespace: { type: ['string', 'null'] },
                name: { type: 'string' },
              },
            },
          },
          evidence: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            items: {
              type: 'object',
              required: ['text'],
              additionalProperties: false,
              properties: {
                field: { type: ['string', 'null'] },
                value: { type: ['string', 'number', 'null'] },
                text: { type: 'string', maxLength: 500 },
              },
            },
          },
          precheckIds: {
            type: 'array',
            items: { type: 'string', pattern: '^R-[A-Z0-9-]+$' },
          },
          savings: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['monthlyUsd', 'formula'],
            properties: {
              monthlyUsd: { type: 'number', minimum: 0 },
              formula: { type: 'string', maxLength: 500 },
            },
          },
          steps: {
            type: 'array',
            minItems: 1,
            maxItems: 15,
            items: {
              type: 'object',
              required: ['text'],
              additionalProperties: false,
              properties: {
                text: { type: 'string', maxLength: 2000 },
                code: { type: ['string', 'null'], maxLength: 8000 },
                language: { type: ['string', 'null'], maxLength: 20 },
              },
            },
          },
          risk: {
            type: 'object',
            required: ['level', 'reason'],
            additionalProperties: false,
            properties: {
              level: { enum: ['high', 'medium', 'low'] },
              reason: { type: 'string', maxLength: 300 },
            },
          },
          verification: { type: ['string', 'null'], maxLength: 1000 },
        },
      },
    },
  },
};
