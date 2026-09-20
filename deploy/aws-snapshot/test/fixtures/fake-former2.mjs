#!/usr/bin/env node
// 테스트용 가짜 former2. AWS 를 부르지 않고 FAKE_FORMER2_MODE 에 따라 출력 파일을 만든다.
//   clean   : 비밀값 없는 템플릿
//   secret  : 비밀값이 섞인 템플릿
//   empty   : "# No resources generated"
//   error   : "ERROR: ..." 를 찍고 종료코드 0 (실제 former2 동작 재현)
//   crash   : 종료코드 1
// 받은 인자와 자격증명 관련 환경변수는 FAKE_FORMER2_ARGS_FILE 에 JSON 으로 기록한다.
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (process.env.FAKE_FORMER2_ARGS_FILE) {
  const seen = ['AWS_PROFILE', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
  const env = Object.fromEntries(seen.filter((k) => k in process.env).map((k) => [k, process.env[k]]));
  fs.writeFileSync(process.env.FAKE_FORMER2_ARGS_FILE, JSON.stringify({ args, env }));
}

const mode = process.env.FAKE_FORMER2_MODE ?? 'clean';
if (mode === 'crash') process.exit(1);
if (mode === 'error') {
  console.log('\nERROR: Please do not use --exclude-services and --services simultaneously\n');
  process.exit(0);
}

const CFN_CLEAN = `AWSTemplateFormatVersion: "2010-09-09"
Metadata:
    Generator: "former2"
Description: ""
Resources:
    EKSCluster:
        Type: "AWS::EKS::Cluster"
        DeletionPolicy: "Retain"
        Properties:
            Name: "sentinel-prod"
            RoleArn: "arn:aws:iam::123456789012:role/eks-cluster-role"
            Version: "1.31"
    EC2VPC:
        Type: "AWS::EC2::VPC"
        DeletionPolicy: "Retain"
        Properties:
            CidrBlock: "10.0.0.0/16"
            Tags:
              -
                Key: "Environment"
                Value: "prod"
`;
const CFN_SECRET = `${CFN_CLEAN}    LambdaFunction:
        Type: "AWS::Lambda::Function"
        DeletionPolicy: "Retain"
        Properties:
            Environment:
                Variables:
                    DB_PASSWORD: "hunter2hunter2"
`;
const TF_CLEAN = `terraform {
    required_providers {
        aws = {
            source = "hashicorp/aws"
            version = "~> 3.0"
        }
    }
}

provider "aws" {
    region = "ap-northeast-2"
}

resource "aws_eks_cluster" "EKSCluster" {
    name = "sentinel-prod"
    role_arn = "arn:aws:iam::123456789012:role/eks-cluster-role"
}
`;

let cfn = CFN_CLEAN;
let tf = TF_CLEAN;
if (mode === 'secret') cfn = CFN_SECRET;
if (mode === 'empty') {
  cfn = '# No resources generated';
  tf = '# No resources generated';
}
if (opt('--output-cloudformation')) fs.writeFileSync(opt('--output-cloudformation'), cfn);
if (opt('--output-terraform')) fs.writeFileSync(opt('--output-terraform'), tf);
if (opt('--output-logical-id-mapping')) {
  fs.writeFileSync(opt('--output-logical-id-mapping'), JSON.stringify({ EKSCluster: 'sentinel-prod' }));
}
if (opt('--output-raw-data')) fs.writeFileSync(opt('--output-raw-data'), '[]');
console.log('fake former2 done');
