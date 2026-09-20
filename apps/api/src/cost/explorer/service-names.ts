/** Cost Explorer 서비스 이름 → 화면 표시 이름 (모르는 서비스는 원문) */
const DISPLAY_NAMES: Record<string, string> = {
  'Amazon Elastic Compute Cloud - Compute': 'EC2 - 컴퓨트',
  'EC2 - Other': 'EC2 - 기타',
  'Amazon Elastic Container Service for Kubernetes': 'EKS',
  'Amazon Elastic Load Balancing': 'Elastic Load Balancing',
  'Amazon Virtual Private Cloud': 'VPC',
  'Amazon Simple Storage Service': 'S3',
  AmazonCloudWatch: 'CloudWatch',
  'Amazon Relational Database Service': 'RDS',
  'Amazon Elastic Container Registry': 'ECR',
  'Amazon Elastic Container Registry Public': 'ECR Public',
  'Amazon Route 53': 'Route 53',
  'AWS Key Management Service': 'KMS',
  'Amazon Elastic File System': 'EFS',
  'AWS Lambda': 'Lambda',
  'Amazon DynamoDB': 'DynamoDB',
  'AWS Secrets Manager': 'Secrets Manager',
  'Amazon CloudFront': 'CloudFront',
  'AWS Cost Explorer': 'Cost Explorer',
  'AWS Data Transfer': '데이터 전송',
  Tax: '세금',
};

export function serviceDisplayName(service: string): string {
  return DISPLAY_NAMES[service] ?? service;
}
