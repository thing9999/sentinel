#!/usr/bin/env node
// 스냅샷 비밀값 재스캔 (템플릿을 손질한 뒤 커밋 전에 다시 돌린다).
//
//   npm run scan --prefix deploy/aws-snapshot                          # snapshots/ 전체
//   npm run scan --prefix deploy/aws-snapshot -- snapshots/20260919-031500 --strict
//
// 종료코드: 0 통과, 1 비밀값 의심 발견, 2 사용법 오류
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { formatFindings, scanPaths, summarize } from './lib/scan.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export function runScan({ argv = process.argv.slice(2), stdout = process.stdout, stderr = process.stderr } = {}) {
  const log = (s = '') => stdout.write(`${s}\n`);
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { strict: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
    });
  } catch (e) {
    stderr.write(`${e.message}\n`);
    return 2;
  }
  if (parsed.values.help) {
    log('사용법: node scan.mjs [경로...] [--strict]   (기본 경로: snapshots/)');
    return 0;
  }
  // 상대 경로: 명령을 친 폴더(npm --prefix 면 INIT_CWD) 기준으로 먼저 찾고, 없으면 이 폴더 기준
  // (그래서 "snapshots/<시각>" 을 저장소 루트에서 줘도 동작한다)
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const targets = (parsed.positionals.length ? parsed.positionals : ['snapshots']).map((p) => {
    if (path.isAbsolute(p)) return p;
    const fromCwd = path.resolve(baseDir, p);
    return fs.existsSync(fromCwd) ? fromCwd : path.join(SCRIPT_DIR, p);
  });
  const missing = targets.filter((t) => !fs.existsSync(t));
  if (missing.length) {
    stderr.write(`경로가 없습니다: ${missing.join(', ')}\n`);
    return 2;
  }
  const { files, findings } = scanPaths(targets);
  const summary = summarize(findings, { strict: parsed.values.strict });
  log(`스캔한 파일 ${files.length}개: 오류 ${summary.errors}건, 경고 ${summary.warnings}건${summary.strict ? ' (strict)' : ''}`);
  if (findings.length) log(formatFindings(findings, SCRIPT_DIR));
  log(summary.passed ? '통과' : '실패: 커밋 전에 위 항목을 정리하세요');
  return summary.passed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runScan();
}
