import { InlineAlert } from "../feedback/Banner";
import { LOG_REDACTION_NOTICE } from "./logLineModel";

export interface RedactionNoticeProps {
  className?: string;
}

/**
 * 닫을 수 없는 가림 경고 (logs.md 6.1, status.md 13.4, **AC-LOG08**).
 *
 * `InlineAlert` tone `neutral` + `eye-off` 고정이고 **`closable`·접기 prop 을 아예 받지 않는다.**
 * 문구·tone·닫기 가능 여부를 prop 으로 열어 두면 언젠가 누군가 닫을 수 있게 만든다 —
 * "조심하기"가 아니라 **그렇게 쓸 수 없는 모양**으로 막는다. `CollapsibleNotice`(20.4)에 이 문구를 넣어도 안 된다.
 *
 * 자리: 로그 본문이 보이는 **모든 자리**(`/logs`, 파드 상세 로그 탭, 워크로드·DB·컨트롤 플레인 진입).
 * 경고색(빨강·노랑)을 쓰지 않는 이유는 매일 보는 문구가 경고색이면 2주 뒤에는 아무도 읽지 않기 때문이다 —
 * 대신 **절대 사라지지 않는 것**으로 무게를 준다.
 */
export function RedactionNotice({ className }: RedactionNoticeProps) {
  return <InlineAlert tone="neutral" icon="eye-off" title={LOG_REDACTION_NOTICE} className={className} />;
}
