/**
 * 비용 리소스 카테고리·하위 종류의 **표시 라벨 한 곳** (status.md 5.2·8절, aws-cost.md 2.5).
 * 2026-09-24 `kops-support`: 카테고리 `eks`(EKS 컨트롤 플레인) → **`controlPlane`(컨트롤 플레인)**.
 * kOps 클러스터에는 EKS 같은 컨트롤 플레인 관리 요금이 없고, 이 카테고리는 마스터 실비의 합이다.
 *
 * API 값은 바꾸지 않고 화면에 들어오는 지점에서 한 번만 이 표로 바꾼다(status.md 8절).
 * 서버가 `label` 을 주면 서버 값이 우선이고, 이 표는 값이 없을 때의 기본 문구다.
 */
export type CostCategory = "ec2" | "ebs" | "lb" | "ipv4" | "controlPlane";

/** 표·차트 정렬 순서 (status.md 5.2 "비용 리소스 내역") */
export const COST_CATEGORY_ORDER: CostCategory[] = ["ec2", "ebs", "lb", "ipv4", "controlPlane"];

export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  ec2: "EC2 노드",
  ebs: "EBS",
  lb: "로드밸런서",
  ipv4: "퍼블릭 IPv4",
  controlPlane: "컨트롤 플레인",
};

/** `controlPlane` 카테고리에만 있는 하위 종류 (docs/api/aws-cost.md `ControlPlaneCostKind`) */
export type ControlPlaneCostKind =
  | "master_ec2"
  | "etcd_ebs"
  | "master_root_ebs"
  | "api_lb"
  | "master_ipv4";

/** 고정 순서 (status.md 5.2: 하위 종류 → 시간당 비용 내림차순) */
export const CONTROL_PLANE_KIND_ORDER: ControlPlaneCostKind[] = [
  "master_ec2",
  "etcd_ebs",
  "master_root_ebs",
  "api_lb",
  "master_ipv4",
];

/** 내역 표 `종류` 열의 neutral Chip 문구 (aws-cost.md 2.5(d)). 상태가 아니므로 색을 쓰지 않는다 */
export const CONTROL_PLANE_KIND_LABEL: Record<ControlPlaneCostKind, string> = {
  master_ec2: "마스터 EC2",
  etcd_ebs: "etcd 볼륨",
  master_root_ebs: "마스터 루트 볼륨",
  api_lb: "API 서버 LB",
  master_ipv4: "마스터 퍼블릭 IPv4",
};
