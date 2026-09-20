import { createHash } from 'node:crypto';

export type Eol = 'lf' | 'crlf' | 'mixed' | 'none';

export interface TextFacts {
  eol: Eol;
  bom: boolean;
  utf8: boolean;
  lineCount: number;
  indent: { style: 'spaces' | 'tabs'; size: number | null } | null;
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

export function sha256Version(data: Buffer | string): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

export function hasBom(buf: Buffer): boolean {
  return buf.length >= 3 && buf.subarray(0, 3).equals(BOM);
}

export function isUtf8(buf: Buffer): boolean {
  try {
    fatalDecoder.decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** CLI(readFileSync 'utf8')와 같은 방식의 디코딩: BOM 유지, 잘못된 바이트는 대체 문자 */
export function decodeLikeCli(buf: Buffer): string {
  return buf.toString('utf8');
}

export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
      else lf++;
    }
  }
  if (crlf > 0 && lf > 0) return 'mixed';
  if (crlf > 0) return 'crlf';
  if (lf > 0) return 'lf';
  return 'none';
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith('\n') ? n : n + 1;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** 들여쓴 줄 앞 1000줄에서 들여쓰기 방식을 추정한다 */
export function detectIndent(text: string): TextFacts['indent'] {
  let tabs = 0;
  let spaces = 0;
  let g = 0;
  let seen = 0;
  const lines = text.split('\n');
  for (const line of lines) {
    if (seen >= 1000) break;
    const m = /^([ \t]+)\S/.exec(line);
    if (!m) continue;
    seen++;
    if (m[1].startsWith('\t')) tabs++;
    else {
      spaces++;
      const w = m[1].length;
      g = g === 0 ? w : gcd(g, w);
    }
  }
  if (seen === 0) return null;
  if (tabs > spaces) return { style: 'tabs', size: null };
  const size = [2, 4, 8].includes(g) ? g : null;
  return { style: 'spaces', size };
}

/** 화면에 줄 내용: BOM 제거, 줄바꿈을 LF로 */
export function toLfText(buf: Buffer): string {
  const body = hasBom(buf) ? buf.subarray(3) : buf;
  return body.toString('utf8').replace(/\r\n/g, '\n');
}

export function textFacts(buf: Buffer): TextFacts {
  const utf8 = isUtf8(buf);
  const text = buf.toString('utf8');
  return {
    eol: detectEol(text),
    bom: hasBom(buf),
    utf8,
    lineCount: countLines(text),
    indent: detectIndent(text),
  };
}

/**
 * 편집 내용(LF 또는 CRLF)을 원래 파일 형식(줄바꿈·BOM)의 바이트로 되돌린다.
 * 원래가 none/lf면 LF 그대로.
 */
export function restoreFormat(
  content: string,
  original: { eol: Eol; bom: boolean },
): Buffer {
  let text = content.replace(/\r\n/g, '\n');
  if (original.eol === 'crlf') text = text.replace(/\n/g, '\r\n');
  const body = Buffer.from(text, 'utf8');
  return original.bom ? Buffer.concat([BOM, body]) : body;
}

/**
 * 파일 앞부분만 (보기 상한). 마지막 완전한 줄까지 자르고, UTF-8 문자 중간에서 자르지 않는다.
 */
export function truncateAtLine(buf: Buffer, maxBytes: number): Buffer {
  if (buf.length <= maxBytes) return buf;
  let end = maxBytes;
  const nl = buf.lastIndexOf(10, end - 1);
  if (nl >= 0) end = nl + 1;
  else while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end);
}
