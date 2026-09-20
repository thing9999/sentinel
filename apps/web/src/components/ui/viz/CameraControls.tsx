"use client";

import { IconButton } from "../controls/IconButton";
import { SegmentedControl, type SegmentedOption } from "../controls/SegmentedControl";
import { cx } from "../cx";
import styles from "./viz.module.css";

export type CameraView = "top" | "iso" | "front";

export interface CameraControlsProps {
  view: CameraView;
  onView: (view: CameraView) => void;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** 로딩·오류로 장면이 없을 때 */
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

/** 시점 3칸. 툴팁에 단축키를 적는다(캔버스 포커스에서 1/2/3) */
const VIEW_OPTIONS: SegmentedOption<CameraView>[] = [
  { value: "top", label: "위", tooltip: "위에서 (1)" },
  { value: "iso", label: "비스듬", tooltip: "비스듬히 (2)" },
  { value: "front", label: "앞", tooltip: "앞에서 (3)" },
];

/**
 * components.md 16.3 / snapshot-3d.md 6.3. 캔버스 오른쪽 아래(여백 12px) 세로 묶음.
 * 모든 버튼이 일반 탭 정지점이다(캔버스 다음 순서) — 마우스 없이도 카메라를 조작할 수 있어야 한다(11.1).
 */
export function CameraControls({
  view,
  onView,
  onReset,
  onZoomIn,
  onZoomOut,
  disabled = false,
  disabledReason,
  className,
}: Readonly<CameraControlsProps>) {
  const off = disabled ? { disabled: true, disabledReason } : {};
  return (
    <div className={cx(styles.camera, className)} role="group" aria-label="카메라 조작">
      <SegmentedControl
        options={
          disabled ? VIEW_OPTIONS.map((o) => ({ ...o, disabledReason: disabledReason ?? "장면이 없습니다" })) : VIEW_OPTIONS
        }
        value={view}
        onChange={onView}
        label="시점"
        size="sm"
        orientation="vertical"
        className={styles.cameraViews}
      />
      <div className={styles.cameraButtons}>
        <IconButton icon="maximize" size="sm" label="카메라 초기화 (0)" onClick={onReset} {...off} />
        <IconButton icon="zoom-in" size="sm" label="확대 (+)" onClick={onZoomIn} {...off} />
        <IconButton icon="zoom-out" size="sm" label="축소 (−)" onClick={onZoomOut} {...off} />
      </div>
    </div>
  );
}
