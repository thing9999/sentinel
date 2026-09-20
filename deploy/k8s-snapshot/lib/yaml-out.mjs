// YAML 직렬화 (CLI 전용. api 는 import 하지 않는다).
// 같은 입력이면 같은 바이트 (AC-K07): 줄 접기 없음, 블록 스타일만, 별칭 없음, LF.
import { stringify } from 'yaml';

export function toYaml(obj) {
  return stringify(obj, {
    lineWidth: 0,
    minContentWidth: 0,
    aliasDuplicateObjects: false,
    indent: 2,
    indentSeq: true,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  });
}
