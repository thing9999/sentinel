/**
 * 줄 처리 테스트 (docs/api/logs.md 4절, AC-LOG18).
 * 화면에 `[31m` 같은 찌꺼기가 오면 서버 결함이라는 계약을 여기서 고정한다.
 */
import {
  looksBinary,
  processLines,
  replaceControls,
  splitTimestamp,
  stripAnsi,
  truncateBytes,
} from './line-processor';
import { createLineRedactor } from './redact';
import type { LogSegment } from './logs.types';

function render(segments: LogSegment[]): string {
  return segments.map((s) => s.v).join('');
}

function run(raw: string[], maxLineBytes = 8192) {
  return processLines(raw, {
    idPrefix: 'q-test',
    startSeq: 0,
    maxLineBytes,
    redact: createLineRedactor(),
  });
}

describe('stripAnsi', () => {
  it('색상·스타일 시퀀스를 없앤다', () => {
    expect(stripAnsi('\u001B[31mERROR\u001B[0m ok')).toBe('ERROR ok');
    expect(stripAnsi('\u001B[38;5;208mINFO\u001B[0m x')).toBe('INFO x');
  });
});

describe('replaceControls', () => {
  it('인쇄 불가 제어문자를 · 로 바꾸고 탭은 남긴다', () => {
    expect(replaceControls('a\u0007b\tc')).toBe('a·b\tc');
  });
});

describe('splitTimestamp', () => {
  it('앞머리 RFC3339 시각을 분리한다', () => {
    const { at, body } = splitTimestamp(
      '2026-09-25T14:02:10.412345678Z listening on :8080',
    );
    expect(at).toBe('2026-09-25T14:02:10.412Z');
    expect(body).toBe('listening on :8080');
  });

  it('시각이 없으면 null이고 본문을 그대로 둔다', () => {
    const { at, body } = splitTimestamp('no timestamp here');
    expect(at).toBeNull();
    expect(body).toBe('no timestamp here');
  });
});

describe('바이너리 판정', () => {
  it('인쇄 불가 비율이 높으면 바이너리다', () => {
    expect(looksBinary('PK\u0003\u0004\u0000\u0000\u0000\u0000')).toBe(true);
    expect(looksBinary('정상적인 한국어 로그 줄입니다')).toBe(false);
  });

  it('바이너리 줄은 본문 없이 바이트 수만 준다', () => {
    const { lines, stats } = run([
      `2026-09-25T14:02:10.000Z PK\u0003\u0004${'\u0000\u0001\u0002'.repeat(20)}`,
    ]);
    expect(lines[0].kind).toBe('binary');
    expect(lines[0].segments).toEqual([]);
    expect(lines[0].bytes).toBeGreaterThan(0);
    expect(stats.binaryLines).toBe(1);
  });
});

describe('긴 줄 자르기', () => {
  it('바이트 상한에서 자르고 생략 바이트를 알린다', () => {
    const { text, truncated } = truncateBytes('x'.repeat(100), 10);
    expect(text).toHaveLength(10);
    expect(truncated).toBe(90);
  });

  it('멀티바이트 문자를 쪼개지 않는다', () => {
    const { text } = truncateBytes('한'.repeat(10), 8);
    expect(text).toBe('한한');
  });

  it('상한을 넘는 줄에 truncatedBytes가 붙는다', () => {
    const { lines, stats } = run(
      [`2026-09-25T14:02:10.000Z ${'x'.repeat(9000)}`],
      8192,
    );
    expect(lines[0].truncatedBytes).toBeGreaterThan(0);
    expect(stats.truncatedLines).toBe(1);
  });
});

describe('processLines', () => {
  it('ANSI 찌꺼기가 남지 않고 한국어가 깨지지 않는다', () => {
    const { lines } = run([
      '2026-09-25T14:02:10.000Z \u001B[31mERROR\u001B[0m 주문 처리 실패',
    ]);
    const out = render(lines[0].segments);
    expect(out).toBe('ERROR 주문 처리 실패');
    expect(out).not.toContain('[31m');
  });

  it('가림된 줄을 세고 원문을 내보내지 않는다', () => {
    const { lines, stats } = run([
      '2026-09-25T14:02:10.000Z cfg password=s3cr3t-p4ssw0rd',
    ]);
    expect(render(lines[0].segments)).not.toContain('s3cr3t-p4ssw0rd');
    expect(stats.redactedLines).toBe(1);
    expect(stats.redactedCount).toBe(1);
  });

  it('개인 키 블록을 한 줄로 접는다', () => {
    const { lines } = run([
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA',
      '-----END RSA PRIVATE KEY-----',
      '2026-09-25T14:02:10.000Z after',
    ]);
    expect(lines).toHaveLength(2);
    expect(render(lines[0].segments)).toBe('[가림: 개인 키 블록 3줄]');
    expect(render(lines[1].segments)).toBe('after');
  });

  it('줄 id가 이어지고 중복되지 않는다', () => {
    const first = run(['2026-09-25T14:02:10.000Z a']);
    const second = processLines(['2026-09-25T14:02:11.000Z b'], {
      idPrefix: 'q-test',
      startSeq: first.nextSeq,
      maxLineBytes: 8192,
      redact: createLineRedactor(),
    });
    expect(first.lines[0].id).toBe('q-test:1');
    expect(second.lines[0].id).toBe('q-test:2');
  });
});
