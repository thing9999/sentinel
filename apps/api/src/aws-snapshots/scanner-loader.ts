import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CliFinding {
  file: string;
  line: number;
  rule: string;
  severity: 'error' | 'warn';
  message: string;
}

export interface CliRule {
  id: string;
  severity: 'error' | 'warn';
  description: string;
}

/** deploy/aws-snapshot/lib 에서 불러오는 함수들 (계약 2절) */
export interface SnapshotScanner {
  scanText(text: string, file?: string): CliFinding[];
  summarize(
    findings: CliFinding[],
    opts?: { strict?: boolean },
  ): { errors: number; warnings: number; strict: boolean; passed: boolean };
  allowMarker: string;
  scannableExtensions: readonly string[];
  countCloudFormationResources(text: string): number;
  countTerraformResources(text: string): number;
  listRules: (() => CliRule[]) | null;
  libDir: string;
}

export class ScannerLoadError extends Error {}

export function defaultLibDir(cwd: string = process.cwd()): string {
  return resolve(cwd, '../../deploy/aws-snapshot/lib');
}

/**
 * CLI 스캐너 lib를 동적 import로 불러온다. CJS로 컴파일돼도 `import()`가 그대로 남도록
 * (module: nodenext) 한다. jest는 --experimental-vm-modules로 실행된다.
 */
export async function loadScanner(libDir: string): Promise<SnapshotScanner> {
  const dir = resolve(libDir);
  const scanPath = resolve(dir, 'scan.mjs');
  const metaPath = resolve(dir, 'meta.mjs');
  if (!existsSync(scanPath) || !existsSync(metaPath)) {
    throw new ScannerLoadError(`스캐너 lib가 없습니다: ${dir}`);
  }
  const scan = (await import(pathToFileURL(scanPath).href)) as Record<
    string,
    unknown
  >;
  const meta = (await import(pathToFileURL(metaPath).href)) as Record<
    string,
    unknown
  >;
  const need: [Record<string, unknown>, string][] = [
    [scan, 'scanText'],
    [scan, 'summarize'],
    [scan, 'ALLOW_MARKER'],
    [scan, 'SCANNABLE_EXTENSIONS'],
    [meta, 'countCloudFormationResources'],
    [meta, 'countTerraformResources'],
  ];
  const missing = need.filter(([m, k]) => m[k] === undefined).map(([, k]) => k);
  if (missing.length) {
    throw new ScannerLoadError(`스캐너 lib export 없음: ${missing.join(', ')}`);
  }
  return {
    scanText: scan.scanText as SnapshotScanner['scanText'],
    summarize: scan.summarize as SnapshotScanner['summarize'],
    allowMarker: scan.ALLOW_MARKER as string,
    scannableExtensions: scan.SCANNABLE_EXTENSIONS as string[],
    countCloudFormationResources:
      meta.countCloudFormationResources as SnapshotScanner['countCloudFormationResources'],
    countTerraformResources:
      meta.countTerraformResources as SnapshotScanner['countTerraformResources'],
    listRules:
      typeof scan.listRules === 'function'
        ? (scan.listRules as () => CliRule[])
        : null,
    libDir: dir,
  };
}
