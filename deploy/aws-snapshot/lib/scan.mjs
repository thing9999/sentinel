// 생성된 템플릿의 비밀값 스캐너 (커밋 전 확인용).
//
// - severity "error": 비밀값일 가능성이 높다. 발견되면 종료코드 1.
// - severity "warn":  사람이 검토해야 하는 블록(UserData 등). --strict 일 때만 종료코드 1.
// - 검토를 마친 줄은 같은 줄 끝에 주석 `snapshot-scan: allow` 를 달면 건너뛴다.
// - 보고서에는 값을 그대로 찍지 않고 앞 2글자만 남기고 가린다.
import fs from 'node:fs';
import path from 'node:path';

export const ALLOW_MARKER = 'snapshot-scan: allow';

// 키 이름(소문자, _ - 공백 제거)이 이 말로 "끝나면" 비밀값 키로 본다.
// 끝나는지로 보는 이유: MinimumPasswordLength, SecretArn, PasswordLastUsed 같은 설정 키 오탐을 피하려고.
const SECRET_KEY_SUFFIXES = [
  'password', 'passwd', 'pwd', 'passphrase', 'secret', 'secretkey', 'secretaccesskey', 'secretstring',
  'token', 'apikey', 'privatekey', 'clientsecret', 'connectionstring', 'credential', 'credentials',
];

// 키 이름이 비밀 키처럼 보여도 값이 참조·자리표시자면 괜찮다.
const SAFE_VALUE_RES = [
  /^$/,
  /^(null|~|true|false)$/i,
  /^!(Ref|GetAtt|ImportValue|FindInMap)\b/,
  /^\{\{resolve:(secretsmanager|ssm-secure|ssm):/, // CloudFormation 동적 참조
  /^!Sub\s+["']?\{\{resolve:/,
  /^(var|local|data|module)\.[A-Za-z0-9_.-]+$/, // Terraform 참조
  /^\$\{(var|local|data|module)\.[^}]+\}$/,
  /^\$\{[A-Za-z0-9_:.]+\}$/, // ${AWS::StackName} 등 치환만 있는 값
  /^<[^>]+>$/, // <password> 같은 자리표시자
  /^\*{3,}$/, // 이미 가려진 값
  /^(\{|\[|\|[-+]?|>[-+]?)$/, // 값이 다음 줄부터 시작하는 블록(맵·리스트·여러 줄 문자열)
];

const ENV_KEY_RE = /^\s*(?:-\s*)?["']?(?:EnvironmentVariables|environment_variables|Environment|environment|Variables|variables)["']?(?![\w-])(.*)$/;
const ENV_TAIL_RE = /^(?::[{[]?|=[{[]|\{)$/;

function isEnvBlockOpening(line) {
  const m = ENV_KEY_RE.exec(line);
  return Boolean(m) && ENV_TAIL_RE.test(m[1].replace(/\s+/g, ''));
}

const LINE_RULES = [
  {
    id: 'private-key',
    severity: 'error',
    re: /-----BEGIN ([A-Z]+ )*PRIVATE KEY-----/,
    message: '개인 키(PEM)가 들어 있습니다',
  },
  {
    id: 'aws-access-key-id',
    severity: 'error',
    re: /\b(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/,
    message: 'AWS 액세스 키 ID 패턴',
  },
  {
    id: 'aws-secret-access-key',
    severity: 'error',
    re: /(aws_?)?secret_?access_?key["']?\s*[:=]\s*["']?[a-z0-9/+=]{40}\b/i,
    message: 'AWS 비밀 액세스 키 패턴',
  },
  {
    id: 'presigned-url',
    severity: 'error',
    re: /X-Amz-(Signature|Security-Token|Credential)=/,
    message: '서명된 URL·임시 자격증명(X-Amz-*)이 들어 있습니다',
  },
  {
    id: 'jwt',
    severity: 'error',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    message: 'JWT 토큰 패턴',
  },
  {
    id: 'url-credentials',
    severity: 'error',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'{}$]+:[^\s@/"'{}$]+@[^\s"']+/i,
    message: 'URL 안에 사용자:비밀번호가 들어 있습니다 (연결 문자열)',
  },
  {
    id: 'vendor-token',
    severity: 'error',
    re: /\b(ghp_[A-Za-z0-9]{36}|github_pat_\w{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|glpat-[A-Za-z0-9_-]{20})\b/,
    message: '서비스 토큰 패턴 (GitHub/Slack/OpenAI/GitLab 등)',
  },
  {
    id: 'env-block',
    severity: 'error',
    // 블록을 "여는" 줄만 잡는다. CloudFormation: `Environment:` / `Variables:` (값 없이 줄 끝),
    // Terraform: `environment {`, `variables = {`, JSON: `"Environment": [`.
    // 태그 값(`Environment = "prod"`, `Environment: dev`)은 잡지 않는다.
    test: isEnvBlockOpening,
    message: '환경 변수 블록입니다. 값에 비밀이 없는지 확인하고, 없으면 줄 끝에 "# snapshot-scan: allow"',
  },
  {
    id: 'user-data',
    severity: 'warn',
    re: /^\s*"?(UserData|user_data|user_data_base64)"?\s*[:=]/,
    message: 'UserData(부트스트랩 스크립트)입니다. 비밀값이 섞여 있지 않은지 확인하세요',
  },
  {
    id: 'kubeconfig-ca',
    severity: 'warn',
    re: /certificate-authority-data|CertificateAuthorityData/,
    message: '클러스터 CA 데이터입니다 (비밀은 아니지만 EKS 가 관리하는 값이라 템플릿에서 빼는 것이 좋습니다)',
  },
];

// YAML `Key: value`, HCL `key = value`, JSON `"key": value`
// 값 부분은 통째로 받은 뒤 JS 에서 다듬는다 (정규식 백트래킹 방지)
const KEY_VALUE_RE = /^\s*(?:-\s*)?["']?([\w.-]+)["']?\s*[:=](.*)$/;

function normalizeKey(key) {
  return key.toLowerCase().replace(/[_\-.\s]/g, '');
}

function stripQuotes(v) {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) {
    return t.slice(1, -1);
  }
  return t;
}

export function maskValue(value) {
  const v = String(value);
  if (v.length <= 4) return '****';
  return `${v.slice(0, 2)}****(${v.length}자)`;
}

function secretKeyValueFinding(line) {
  const m = KEY_VALUE_RE.exec(line);
  if (!m) return null;
  const key = m[1];
  const nk = normalizeKey(key);
  if (!SECRET_KEY_SUFFIXES.some((s) => nk.endsWith(s))) return null;
  // 주석(#) 제거: 값이 따옴표로 시작하지 않을 때만
  let rawValue = m[2].trim().replace(/,$/, '').trim();
  if (!/^["']/.test(rawValue)) {
    const hash = rawValue.indexOf(' #');
    if (hash >= 0) rawValue = rawValue.slice(0, hash).trim();
  }
  const value = stripQuotes(rawValue);
  if (SAFE_VALUE_RES.some((re) => re.test(value))) return null;
  return {
    id: 'secret-key-value',
    severity: 'error',
    message: `비밀값으로 보이는 키 "${key}" 에 값이 들어 있습니다 (${maskValue(value)})`,
  };
}

/**
 * @param {string} text
 * @param {string} file 보고용 파일 이름
 * @param {{profile?: 'aws'|'k8s'}} [opts] profile 'aws'(기본)는 기존 규칙만, 'k8s'는 기존 규칙 + 쿠버네티스 규칙
 * @returns {{file:string,line:number,rule:string,severity:'error'|'warn',message:string}[]}
 */
export function scanText(text, file = '<text>', opts = {}) {
  const profile = opts?.profile === 'k8s' ? 'k8s' : 'aws';
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (line.includes(ALLOW_MARKER)) return;
    const hits = [];
    for (const rule of LINE_RULES) {
      if (rule.test ? rule.test(line) : rule.re.test(line)) hits.push({ rule: rule.id, severity: rule.severity, message: rule.message });
    }
    if (profile === 'k8s') {
      for (const rule of K8S_LINE_RULES) {
        if (rule.re.test(line)) hits.push({ rule: rule.id, severity: rule.severity, message: rule.message });
      }
    }
    const kv = secretKeyValueFinding(line);
    if (kv) hits.push({ rule: kv.id, severity: kv.severity, message: kv.message });
    for (const h of hits) findings.push({ file, line: idx + 1, ...h });
  });
  if (profile !== 'k8s') return findings;
  const extra = k8sContextFindings(lines).map((h) => ({ file, ...h }));
  if (!extra.length) return findings;
  // 줄 순서로 합친다 (같은 줄 안에서는 줄 단위 규칙 → 문맥 규칙 순서)
  return [...findings, ...extra]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.line - b.f.line || a.i - b.i)
    .map((x) => x.f);
}

// ---------------------------------------------------------------------------
// 쿠버네티스 규칙 (profile 'k8s' 에서만). docs/api/k8s-snapshot.md 2.3
// YAML 파서 없이 줄 단위 + 들여쓰기 추적으로 판단한다 (api 가 이 파일만 import 하므로 외부 패키지 금지).
// ---------------------------------------------------------------------------

const K8S_LINE_RULES = [
  {
    id: 'k8s-dockerconfig',
    severity: 'error',
    re: /^\s*(?:-\s+)?["']?\.docker(?:configjson|cfg)["']?\s*:\s*(?![|>][-+]?\s*$)\S|"auths"\s*:.*"auth"\s*:\s*"[^"]{4,}"/,
    message: '레지스트리 인증 정보(dockerconfig)가 들어 있습니다',
  },
  {
    id: 'k8s-last-applied',
    severity: 'warn',
    // 어노테이션 **키** 자리만 (YAML 키 또는 JSON 키). metadata.json 의 정리 규칙 요약 문자열
    // ("metadata.annotations[\"kubectl.kubernetes.io/last-applied-configuration\"]")은 값이라 걸리지 않는다
    re: /^\s*(?:-\s+)?(?:\{\s*)?["']?kubectl\.kubernetes\.io\/last-applied-configuration["']?\s*:/,
    message: 'last-applied-configuration 어노테이션이 남아 있습니다 (스펙 전체 사본, 비밀값이 섞일 수 있음)',
  },
];

const K8S_CONTEXT_RULES = [
  {
    id: 'k8s-env-literal',
    severity: 'error',
    description: '환경 변수 이름이 비밀값처럼 보이는데(PASSWORD, TOKEN, SECRET …) value 에 리터럴 값이 들어 있습니다. valueFrom.secretKeyRef 로 바꾸세요',
  },
  {
    id: 'k8s-secret-object',
    severity: 'error',
    description: 'kind: Secret 파일에 값(data/stringData)이 들어 있습니다. Secret 은 스냅샷에 넣지 않습니다',
  },
  {
    id: 'k8s-configmap-secretish',
    severity: 'warn',
    description: 'ConfigMap 키 이름이 비밀값처럼 보입니다. Secret 으로 옮길지 검토하세요',
  },
];

/** 쿠버네티스 env 변수 참조 $(NAME) 는 리터럴이 아니다 */
const K8S_VAR_REF_RE = /^\$\([A-Za-z_][A-Za-z0-9_]*\)$/;
const BLOCK_SCALAR_RE = /^[|>][-+0-9]*$/;
const FLOW_NAME_RE = /["']?name["']?\s*:\s*("([^"]*)"|'([^']*)'|([^,}\s]+))/;
const FLOW_VALUE_RE = /["']?value["']?\s*:\s*("([^"]*)"|'([^']*)'|([^,}]+?))\s*(?:[,}]|$)/;

function isSecretName(name) {
  const nk = normalizeKey(String(name));
  return SECRET_KEY_SUFFIXES.some((s) => nk.endsWith(s));
}

/** `key: value` 줄의 값 부분을 CLI secret-key-value 와 같은 방식으로 다듬는다 */
function cleanValue(raw) {
  let v = String(raw ?? '').trim().replace(/,$/, '').trim();
  if (!/^["']/.test(v)) {
    const hash = v.indexOf(' #');
    if (hash >= 0) v = v.slice(0, hash).trim();
  }
  return stripQuotes(v);
}

const YAML_KEY_LINE_RE = /^(\s*)((?:-\s+)*)(?:"([^"]*)"|'([^']*)'|([^\s"'#{}[\],:][^#{}[\]:]*?))\s*:(?:\s+(.*))?$/;

/**
 * 줄을 구조로 나눈다.
 * - key: 매핑 키 (없으면 null), keyCol: 키가 시작하는 칸, dash: 목록 항목 시작 여부
 * - value: 값 원문 (키 뒤, 없으면 '')
 * - flow: `- {…}` 한 줄 흐름 매핑/JSON 객체면 그 텍스트
 */
function parseYamlLine(line) {
  if (/^\s*(#|$)/.test(line)) return { blank: true };
  if (/^---(\s|$)/.test(line) || /^\.\.\.(\s|$)/.test(line)) return { docSep: true };
  const indent = line.length - line.trimStart().length;
  const flow = /^(\s*)(-\s+)?(\{.*\})\s*,?\s*(#.*)?$/.exec(line);
  if (flow) return { indent, keyCol: indent + (flow[2] ? flow[2].length : 0), dash: Boolean(flow[2]), key: null, value: '', flow: flow[3] };
  const m = YAML_KEY_LINE_RE.exec(line);
  if (!m) {
    const dash = /^(\s*)-(\s|$)/.test(line);
    return { indent, keyCol: indent + (dash ? 2 : 0), dash, key: null, value: line.trim() };
  }
  return { indent, keyCol: m[1].length + m[2].length, dash: m[2].length > 0, key: (m[3] ?? m[4] ?? m[5]).trim(), value: (m[6] ?? '').trim() };
}

/** 블록 스칼라(value: |) 다음 줄 (더 깊이 들여쓴 첫 줄) 의 내용 */
function blockFirstLine(lines, idx, keyCol) {
  for (let j = idx + 1; j < lines.length; j++) {
    const l = lines[j];
    if (/^\s*$/.test(l)) continue;
    const ind = l.length - l.trimStart().length;
    return ind > keyCol ? l.trim() : '';
  }
  return '';
}

function k8sContextFindings(lines) {
  const out = [];
  const allowed = (idx) => lines[idx].includes(ALLOW_MARKER);

  // ---- env 목록 항목 (k8s-env-literal) ----
  /** 열린 블록 키들: {col, key} */
  let stack = [];
  let item = null; // {col, name, valueLine, value, block, valueFrom}
  const finishItem = () => {
    if (!item) return;
    const it = item;
    item = null;
    if (it.name === null || it.valueLine === null || it.valueFrom) return;
    if (!isSecretName(it.name)) return;
    let v = it.value;
    if (!it.block) {
      if (v === '' || K8S_VAR_REF_RE.test(v)) return;
      if (SAFE_VALUE_RES.some((re) => re.test(v))) return;
    } else if (v === '') return;
    if (allowed(it.valueLine)) return;
    out.push({
      line: it.valueLine + 1,
      rule: 'k8s-env-literal',
      severity: 'error',
      message: `환경 변수 "${it.name}" 에 리터럴 값이 들어 있습니다 (${maskValue(v)}). valueFrom.secretKeyRef 로 바꾸세요`,
    });
  };
  const parentKey = () => (stack.length ? stack[stack.length - 1].key : null);

  // ---- 문서별 최상위 kind / data (k8s-secret-object, k8s-configmap-secretish) ----
  let doc = { kind: null, entries: [] };
  const finishDoc = () => {
    const d = doc;
    doc = { kind: null, entries: [] };
    if (d.kind !== 'Secret' && d.kind !== 'ConfigMap') return;
    for (const e of d.entries) {
      if (allowed(e.idx)) continue;
      if (d.kind === 'Secret') {
        if (e.value === '') continue;
        out.push({
          line: e.idx + 1,
          rule: 'k8s-secret-object',
          severity: 'error',
          message: `Secret 값이 들어 있습니다 (키 "${e.key}", ${maskValue(e.value)}). Secret 은 스냅샷에 넣지 않습니다`,
        });
      } else if (isSecretName(e.key) && !secretKeyValueFinding(lines[e.idx])) {
        out.push({
          line: e.idx + 1,
          rule: 'k8s-configmap-secretish',
          severity: 'warn',
          message: `ConfigMap 키 "${e.key}" 가 비밀값 이름처럼 보입니다. Secret 으로 옮길지 검토하세요`,
        });
      }
    }
  };

  lines.forEach((line, idx) => {
    const p = parseYamlLine(line);
    if (p.blank) return;
    if (p.docSep) {
      finishItem();
      finishDoc();
      stack = [];
      return;
    }
    // 이 줄보다 깊거나 같은 칸에서 열린 블록은 닫힌다
    while (stack.length && stack[stack.length - 1].col >= p.keyCol) stack.pop();
    // 최상위 kind 와 data 항목
    if (p.key !== null && p.keyCol === 0 && p.key === 'kind') doc.kind = cleanValue(p.value);
    const top = stack.length ? stack[0] : null;
    if (
      p.key !== null &&
      stack.length === 1 &&
      top.col === 0 &&
      ['data', 'stringData', 'binaryData'].includes(top.key)
    ) {
      let v = cleanValue(p.value);
      if (BLOCK_SCALAR_RE.test(p.value)) v = blockFirstLine(lines, idx, p.keyCol);
      doc.entries.push({ idx, key: p.key, value: v });
    }

    // 블록 YAML 의 auths: → <registry>: → auth: 값 (k8s-dockerconfig)
    if (p.key === 'auth' && stack.some((s) => s.key === 'auths') && cleanValue(p.value) !== '' && !allowed(idx)) {
      out.push({ line: idx + 1, rule: 'k8s-dockerconfig', severity: 'error', message: '레지스트리 인증 정보(dockerconfig)가 들어 있습니다' });
    }
    // env 항목
    const inEnv = parentKey() === 'env';
    if (item && (!inEnv || p.keyCol < item.col || (p.dash && p.keyCol === item.col))) finishItem();
    if (inEnv) {
      if (p.flow) {
        const n = FLOW_NAME_RE.exec(p.flow);
        const v = FLOW_VALUE_RE.exec(p.flow);
        item = {
          col: p.keyCol,
          name: n ? (n[2] ?? n[3] ?? n[4]) : null,
          valueLine: v ? idx : null,
          value: v ? (v[2] ?? v[3] ?? (v[4] ?? '').trim()) : '',
          block: false,
          valueFrom: /["']?valueFrom["']?\s*:/.test(p.flow),
        };
        finishItem();
      } else if (p.key !== null && (p.dash || (item && p.keyCol === item.col))) {
        if (p.dash) item = { col: p.keyCol, name: null, valueLine: null, value: '', block: false, valueFrom: false };
        if (p.key === 'name') item.name = cleanValue(p.value);
        else if (p.key === 'value') {
          item.valueLine = idx;
          if (BLOCK_SCALAR_RE.test(p.value)) {
            item.block = true;
            item.value = blockFirstLine(lines, idx, p.keyCol);
          } else item.value = cleanValue(p.value);
        } else if (p.key === 'valueFrom') item.valueFrom = true;
      }
    }
    // 값이 없는 키 = 블록을 연다
    if (p.key !== null && (p.value === '' || /^#/.test(p.value))) stack.push({ col: p.keyCol, key: p.key });
  });
  finishItem();
  finishDoc();
  return out;
}

export const SCANNABLE_EXTENSIONS = ['.yml', '.yaml', '.tf', '.hcl', '.json', '.template'];

// 대시보드 휴지통(snapshots/.trash/). 지운 스냅샷이라 git·CLI 스캔 대상이 아니다.
// 폴더를 돌다가 만나면 건너뛴다 (인자로 직접 준 경로는 그대로 스캔).
export const SKIPPED_DIR_NAMES = ['.trash'];

/** k8s CLI 가 쓰는 중인 임시 스냅샷 폴더 (.<id>.partial). profile 'k8s' 폴더 순회에서만 건너뛴다 */
export const PARTIAL_DIR_RE = /^\..+\.partial$/;

/**
 * 규칙 목록 (도움말·대시보드 표시용). 정규식은 내보내지 않는다.
 * @param {{profile?: 'aws'|'k8s'}} [opts] 인자가 없으면 기존(aws) 목록 그대로
 */
export function listRules(opts = {}) {
  const k8s =
    opts?.profile === 'k8s'
      ? [
          ...K8S_CONTEXT_RULES.map((r) => ({ id: r.id, severity: r.severity, description: r.description })),
          ...K8S_LINE_RULES.map((r) => ({ id: r.id, severity: r.severity, description: r.message })),
        ]
      : [];
  return [
    ...LINE_RULES.map((r) => ({ id: r.id, severity: r.severity, description: r.message })),
    ...k8s,
    {
      id: 'secret-key-value',
      severity: 'error',
      description:
        '비밀값으로 보이는 키(password, token, secret, apikey 등으로 끝나는 키)에 참조·자리표시자가 아닌 값이 들어 있습니다',
    },
  ];
}

/**
 * 파일 또는 폴더(재귀) 목록을 스캔한다
 * @param {string[]} paths
 * @param {{profile?: 'aws'|'k8s'}} [opts]
 */
export function scanPaths(paths, opts = {}) {
  const k8s = opts?.profile === 'k8s';
  const files = [];
  const walk = (p, isArg) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      const base = path.basename(p);
      if (!isArg && SKIPPED_DIR_NAMES.includes(base)) return;
      if (!isArg && k8s && PARTIAL_DIR_RE.test(base)) return;
      for (const name of fs.readdirSync(p).sort()) walk(path.join(p, name), false);
    } else if (SCANNABLE_EXTENSIONS.includes(path.extname(p).toLowerCase())) {
      files.push(p);
    }
  };
  for (const p of paths) walk(p, true);
  const findings = files.flatMap((f) => scanText(fs.readFileSync(f, 'utf8'), f, k8s ? { profile: 'k8s' } : {}));
  return { files, findings };
}

export function summarize(findings, { strict = false } = {}) {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  return { errors, warnings, strict, passed: errors === 0 && (!strict || warnings === 0) };
}

export function formatFindings(findings, baseDir = process.cwd()) {
  return findings
    .map((f) => {
      let rel = f.file;
      if (path.isAbsolute(f.file)) {
        const r = path.relative(baseDir, f.file);
        rel = r.startsWith('..') ? f.file : r;
      }
      return `  [${f.severity.toUpperCase()}] ${rel}:${f.line} (${f.rule}) ${f.message}`;
    })
    .join('\n');
}
