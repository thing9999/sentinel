// Former2 서비스 이름 목록과 기본 제외(비밀 보관) 서비스.
//
// Former2 CLI는 --services / --exclude-services 값을 "콘솔 서비스 이름에서 공백·쉼표·하이픈을 빼고
// &amp; 를 And로 바꾼 값"과 대소문자 무시로 비교한다 (cli/main.js nav()).
// 모르는 이름은 조용히 무시되므로(오타 → 전체 내보내기) 여기서 먼저 검증한다.
// 목록은 former2@0.2.83 js/services/*.js 의 sections.push({ service }) 에서 추출했다.
// former2 버전을 올리면 이 목록도 다시 뽑아야 한다 (README "former2 버전 올리기" 참고).

export const KNOWN_SERVICES = Object.freeze([
  '1Click', 'APIGateway', 'AmazonMQ', 'Amplify', 'Analytics', 'AppConfig', 'AppFlow', 'AppMesh',
  'AppRunner', 'AppStream', 'AppSync', 'Athena', 'AuditManager', 'AutoScaling', 'Backup', 'Batch',
  'BillingConductor', 'Budgets', 'CertificateManager', 'Cloud9', 'CloudFront', 'CloudHSM', 'CloudMap',
  'CloudTrail', 'CloudWatch', 'CodeArtifact', 'CodeBuild', 'CodeCommit', 'CodeDeploy', 'CodeGuru',
  'CodePipeline', 'CodeStar', 'Cognito', 'Config', 'Connect', 'Core', 'CostAndUsageReports',
  'CostExplorer', 'DataBrew', 'DataPipeline', 'DataSync', 'DatabaseMigrationService', 'Detective',
  'DevOpsGuru', 'DeviceFarm', 'DeviceManagement', 'DirectConnect', 'DirectoryService', 'DocumentDB',
  'DynamoDB', 'EC2', 'EC2ImageBuilder', 'ECR', 'ECS', 'EFS', 'EKS', 'EMR', 'ElastiCache',
  'ElasticBeanstalk', 'ElasticTranscoder', 'EventBridge', 'Events', 'FIS', 'FSx', 'FinSpace',
  'Forecast', 'FraudDetector', 'GameLift', 'Glacier', 'GlobalAccelerator', 'Glue', 'Greengrass',
  'GroundStation', 'GuardDuty', 'HealthLake', 'IAM', 'IncidentManager', 'Inspector',
  'InteractiveVideoService', 'KMS', 'Kendra', 'Kinesis', 'LakeFormation', 'Lambda', 'Lex',
  'LicenseManager', 'Lightsail', 'LocationService', 'LookoutForEquipment', 'LookoutForMetrics',
  'LookoutForVision', 'MSK', 'Macie', 'ManagedApacheAirflow', 'ManagedBlockchain', 'MediaConnect',
  'MediaConvert', 'MediaLive', 'MediaPackage', 'MediaStore', 'MemoryDB', 'MigrationHub', 'Neptune',
  'NimbleStudio', 'OpenSearch', 'OpsWorks', 'Organizations', 'Panorama', 'Personalize', 'Pinpoint',
  'Prometheus', 'QLDB', 'QuickSight', 'RDS', 'Redshift', 'Rekognition', 'ResilienceHub',
  'ResourceAccessManager', 'ResourceGroups', 'RoboMaker', 'Route53', 'S3', 'SES', 'SNS', 'SQS', 'SWF',
  'SageMaker', 'SecretsManager', 'SecurityHub', 'ServiceCatalog', 'ServiceQuotas', 'Signer',
  'SimpleDB', 'SingleSignOn', 'SiteWise', 'StepFunctions', 'StorageGateway', 'SystemsManager',
  'ThingsGraph', 'Timestream', 'Transfer', 'TwinMaker', 'VPC', 'VPCIPAM', 'WAFAndShield', 'WorkLink',
  'WorkSpaces', 'XRay',
]);

// 비밀값이나 개인정보를 "값째로" 읽는 서비스. 기본으로 제외한다.
// - SecretsManager: secretsmanager:GetSecretValue 로 비밀 원문을 읽는다
// - SystemsManager: ssm:GetParameter 로 Parameter Store 값(SecureString 포함 가능)을 읽는다
// - GameLift: gamelift:RequestUploadCredentials 로 임시 자격증명을 발급받는다
// - Cognito: cognito-idp:ListUsers / AdminGetUser 로 사용자 정보(개인정보)를 읽는다
export const SENSITIVE_SERVICES = Object.freeze(['SecretsManager', 'SystemsManager', 'GameLift', 'Cognito']);

// EKS + 클러스터 내 Postgres 구성에 필요한 최소 서비스 (.env.example 권장값)
export const RECOMMENDED_EKS_SERVICES = Object.freeze([
  'EKS', 'EC2', 'VPC', 'IAM', 'ECR', 'KMS', 'Route53', 'CertificateManager', 'CloudWatch', 'S3',
]);

const canonicalByLower = new Map(KNOWN_SERVICES.map((s) => [s.toLowerCase(), s]));

/** "ec2, EKS ,vpc" → ['EC2','EKS','VPC']. 모르는 이름은 unknown 으로 모은다. */
export function parseServiceList(csv) {
  const known = [];
  const unknown = [];
  for (const raw of String(csv ?? '').split(',')) {
    const name = raw.trim();
    if (!name) continue;
    const canonical = canonicalByLower.get(name.replace(/[\s-]/g, '').toLowerCase());
    if (canonical) {
      if (!known.includes(canonical)) known.push(canonical);
    } else {
      unknown.push(name);
    }
  }
  return { known, unknown };
}

/**
 * former2 에 넘길 서비스 선택을 정한다.
 * former2 는 --services 와 --exclude-services 를 동시에 받지 않으므로 둘 중 하나로 합친다.
 *
 * @returns {{ mode: 'include'|'exclude', services: string[], removedSensitive: string[] }}
 */
export function resolveServiceSelection({ include = [], exclude = [], allowSensitive = false }) {
  const sensitive = allowSensitive ? [] : [...SENSITIVE_SERVICES];
  if (include.length > 0) {
    const removedSensitive = include.filter((s) => sensitive.includes(s));
    const services = include.filter((s) => !sensitive.includes(s) && !exclude.includes(s));
    return { mode: 'include', services, removedSensitive };
  }
  const services = [...new Set([...sensitive, ...exclude])];
  return { mode: 'exclude', services, removedSensitive: [] };
}
