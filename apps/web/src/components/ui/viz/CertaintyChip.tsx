import { cx } from "../cx";
import { Chip } from "../status/Chip";
import { CERTAINTY, OPTIONAL_REF_LABEL, type Certainty } from "./viz";
import styles from "./viz.module.css";

export interface CertaintyChipProps {
  certainty: Certainty;
  /** `optional: true` 참조 (예: ConfigMap optional) → 뒤에 `선택 참조` 칩 */
  optional?: boolean;
  /** sm 20px (지금은 sm 만 쓴다) */
  size?: "sm";
  /** 근거 문구를 툴팁에 함께 (예: `셀렉터`) */
  evidence?: string;
  /**
   * 버튼·링크 **안**에 놓을 때 true. 툴팁 대신 `title` 을 쓴다
   * (툴팁 래퍼가 포커스를 받아 버튼 안에 또 다른 탭 정지점이 생기는 것을 막는다).
   */
  plain?: boolean;
  className?: string;
}

/**
 * components.md 16.10 / status.md 11.2.
 * 색으로 구분하지 않는다: 문구(`확정`/`추정`) + 아이콘(`check`/`tilde`)으로 읽히고,
 * 3D 관계선의 실선/대시와 짝을 이룬다.
 */
const OPTIONAL_TIP = "optional: true 참조입니다. 대상이 없어도 워크로드가 뜰 수 있습니다.";

export function CertaintyChip({
  certainty,
  optional = false,
  size = "sm",
  evidence,
  plain = false,
  className,
}: Readonly<CertaintyChipProps>) {
  const spec = CERTAINTY[certainty];
  const tip = evidence ? `${spec.hint} · ${evidence}` : spec.hint;
  return (
    <span className={cx(styles.certainty, className)} title={plain ? tip : undefined}>
      <Chip
        label={spec.label}
        icon={spec.icon}
        tone="neutral"
        size={size}
        dashed={certainty === "estimated"}
        tooltip={plain ? undefined : tip}
      />
      {optional ? (
        <Chip
          label={OPTIONAL_REF_LABEL}
          tone="neutral"
          size={size}
          tooltip={plain ? undefined : OPTIONAL_TIP}
        />
      ) : null}
    </span>
  );
}
