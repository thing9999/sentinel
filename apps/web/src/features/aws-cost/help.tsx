/**
 * 비용 도움말 Drawer 내용 (docs/design/aws-cost.md 2.9). 명세 docs/specs/aws-cost.md 3.1·3.2·3.8 문장을 그대로 옮겼다.
 */
import { HelpPopover, InlineAlert, KeyValueList } from "@/components/ui";

/**
 * kOps 전환 고정 문구 (docs/api/aws-cost.md 3.1.1). **서버가 내려보내지 않는 화면 상수**다.
 * 프론트·퍼블리싱·디자인이 같은 문장을 쓰도록 계약에 원문이 있다 (AC-KOPS31·AC-KOPS35).
 */
export const CONTROL_PLANE_NOTICE =
  "kOps 클러스터에는 EKS 같은 컨트롤 플레인 관리 요금이 없습니다. 대신 마스터 EC2·etcd 볼륨·API 서버 LB 실비가 '컨트롤 플레인' 항목으로 잡힙니다.";

/** 카테고리 구성 목록의 `컨트롤 플레인` 행 툴팁 (디자인 2.5(b)) */
export const CONTROL_PLANE_CATEGORY_TOOLTIP =
  "kOps 클러스터에는 EKS 같은 컨트롤 플레인 관리 요금이 없습니다. 대신 마스터 EC2·etcd 볼륨·API 서버 LB 실비가 이 항목으로 잡힙니다.";

/** `API 서버 LB` 행 툴팁 (계약 3.1.1) */
export const API_LB_TOOLTIP =
  "API 서버 LB로 추정했습니다. 클러스터 태그가 있고 Service·Ingress에 귀속되지 않는 로드밸런서를 기준으로 합니다.";

/** 노드그룹 집계 툴팁 (계약 3.1.1 / D2 — autoscaling 권한을 추가하지 않는다) */
export const NODE_GROUP_TARGET_TOOLTIP = "목표 대수는 표시하지 않습니다(실제로 붙어 있는 노드만 셉니다).";


export const CALC_RATE_ITEMS = [
  { label: "EC2 노드", value: "노드별 인스턴스 타입 × 구매 옵션(온디맨드/스팟) 시간당 단가. 스팟은 실제 스팟 시세(AZ별 최신), 조회 실패 시 온디맨드 상한" },
  { label: "노드 퍼블릭 IPv4", value: "퍼블릭 IPv4 주소 수 × 시간당 단가. 노드에 붙은 것만" },
  { label: "EBS", value: "볼륨별 (용량 GB × 월 GB 단가 + gp3/io1/io2의 추가 IOPS·처리량 단가) ÷ 730. 노드 루트 볼륨 + PVC 볼륨" },
  { label: "로드밸런서", value: "ALB/NLB/CLB 개수 × 시간당 기본 단가. LCU/NLCU 사용량 요금은 제외" },
  {
    label: "컨트롤 플레인",
    value:
      "마스터 EC2(인스턴스 단가) + etcd 볼륨(EBS 단가) + 마스터 루트 볼륨(EBS 단가) + API 서버 LB(LB 단가) + 마스터 퍼블릭 IPv4(IPv4 단가). 컨트롤 플레인 전용 단가는 없습니다.",
  },
];

export const ALLOCATION_RULES = [
  "노드 비용: 노드마다 시간당 비용을 그 노드 위 파드에 배분. 파드 몫 = 노드 시간당 비용 × (CPU requests 비율 + 메모리 requests 비율) ÷ 2. 비율 = 파드 requests ÷ 노드 할당 가능량.",
  "노드 비용 중 어떤 파드에도 배분되지 않은 나머지 = \"미할당(유휴)\" 행.",
  "requests가 없는 파드는 0으로 배분되고, 네임스페이스 행에 \"requests 미설정 파드 N개\" 경고를 붙인다(실제 사용량은 더 클 수 있음).",
  "PVC 볼륨 비용: 해당 PVC의 네임스페이스에 직접 귀속.",
  "로드밸런서 비용: 해당 LoadBalancer 서비스/Ingress의 네임스페이스에 직접 귀속. 식별 불가하면 \"공용\".",
  "컨트롤 플레인 전체(마스터 EC2·etcd/루트 볼륨·API 서버 LB·마스터 퍼블릭 IPv4)와 워커 루트 볼륨, 워커 퍼블릭 IPv4: \"공용(클러스터)\" 행. 마스터 비용은 파드에 배분하지 않는다.",
  "완료된(Succeeded/Failed) 파드는 배분하지 않는다.",
];

export const NOT_INCLUDED = [
  "예약 인스턴스(RI), Savings Plans 할인, 기업 할인(EDP), 크레딧, 프리 티어",
  "데이터 전송비(인터넷 송신, AZ 간, NAT 처리량), NAT 게이트웨이 시간당 요금",
  "로드밸런서 LCU/NLCU 사용량 요금",
  "EBS 스냅샷, ECR, S3, CloudWatch(로그·지표), Route 53, KMS 등 클러스터 리소스가 아닌 서비스",
  "Fargate, 스팟 시세의 조회 주기 사이 변동(스팟 시세는 1시간 캐시, 실제 청구는 사용 시점 시세)",
  "세금",
  // kOps 전환으로 2줄 추가 (계약 3.1.1) — 권한을 늘리지 않고, 추측해서 넣으면 거짓 금액이 된다
  "Route53 호스팅 존·쿼리 요금",
  "kOps state store(S3) 저장·etcd 백업 용량 요금",
];

export function CalcHelp({ label = "계산 방법" }: { label?: string }) {
  return (
    <HelpPopover
      mode="drawer"
      label={label}
      title="계산 방법"
      content={
        <div className="stack-lg">
          <InlineAlert tone="info" title={CONTROL_PLANE_NOTICE} />
          <section className="stack-sm">
            <h3 className="text-h3">시간당 소모율</h3>
            <KeyValueList items={CALC_RATE_ITEMS} labelWidth={120} />
          </section>
          <section className="stack-sm">
            <h3 className="text-h3">네임스페이스 배분</h3>
            <ol className="list-bullet">
              {ALLOCATION_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          </section>
          <p className="text-caption">모든 값은 서버가 계산합니다. 월 환산 = 시간당 × 730.</p>
        </div>
      }
    />
  );
}

export function NotIncludedHelp({ label = "이 추정에 포함되지 않는 것" }: { label?: string }) {
  return (
    <HelpPopover
      mode="drawer"
      label={label}
      title="이 추정에 포함되지 않는 것"
      content={
        <div className="stack-lg">
          <p className="text-strong" style={{ margin: 0 }}>
            실시간 추정은 공시 온디맨드 단가와 조회 시점의 스팟 시세 기준이며 아래 항목을 반영하지 않습니다. 실제 청구액과 차이가 날 수 있습니다.
          </p>
          <ul className="list-bullet">
            {NOT_INCLUDED.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <InlineAlert tone="info" title="이 항목들은 확정 비용(Cost Explorer)에는 모두 포함됩니다." />
        </div>
      }
    />
  );
}
