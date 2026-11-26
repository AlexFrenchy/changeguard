import {
  AuthorizeSecurityGroupIngressCommand,
  DescribeSecurityGroupsCommand,
  EC2Client,
  RevokeSecurityGroupIngressCommand,
  type IpPermission,
} from "@aws-sdk/client-ec2";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import type { ExistingRule } from "./checks";

// The real AWS adapter. Every function builds a short-lived EC2 client from
// the env vars and talks to the one demo security group. No audience option:
// the default OIDC token already carries the team audience
// (https://vercel.com/cardigans), which is what the IdP and the trust policy
// expect. Passing it explicitly forces a token exchange that Vercel rejects
// with "Invalid audience", so leave it out (proven in Slice 1).

export interface SecurityGroupRule {
  sourceCidr: string;
  protocol: string;
  fromPort: number;
  toPort: number;
  description?: string;
}

interface AwsConfig {
  roleArn: string;
  groupId: string;
  region: string;
}

function config(): AwsConfig {
  const roleArn = process.env.AWS_ROLE_ARN;
  const groupId = process.env.CHANGEGUARD_SG_ID;
  const region = process.env.AWS_REGION;
  if (!roleArn || !groupId || !region) {
    throw new Error("Missing AWS_ROLE_ARN, CHANGEGUARD_SG_ID, or AWS_REGION.");
  }
  return { roleArn, groupId, region };
}

function client(cfg: AwsConfig): EC2Client {
  return new EC2Client({
    region: cfg.region,
    credentials: awsCredentialsProvider({ roleArn: cfg.roleArn }),
  });
}

// AWS rules have no id, so the adapter builds one from the rule itself. The
// checks use it to name the rule in their findings.
function ruleId(permission: IpPermission, cidr: string): string {
  const protocol = permission.IpProtocol ?? "all";
  const from = permission.FromPort ?? 0;
  const to = permission.ToPort ?? 65535;
  return `${protocol}:${from}-${to}:${cidr}`;
}

function toIpPermission(rule: SecurityGroupRule): IpPermission {
  return {
    IpProtocol: rule.protocol,
    FromPort: rule.fromPort,
    ToPort: rule.toPort,
    IpRanges: [{ CidrIp: rule.sourceCidr, Description: rule.description }],
  };
}

// Reads only IPv4 ranges. The demo is IPv4 first; a rule
// with an IPv6 source is out of scope for v1.
export async function describeRules(): Promise<ExistingRule[]> {
  const cfg = config();
  const out = await client(cfg).send(
    new DescribeSecurityGroupsCommand({ GroupIds: [cfg.groupId] }),
  );
  const rules: ExistingRule[] = [];
  for (const p of out.SecurityGroups?.[0]?.IpPermissions ?? []) {
    for (const range of p.IpRanges ?? []) {
      if (!range.CidrIp) continue;
      rules.push({
        id: ruleId(p, range.CidrIp),
        sourceCidr: range.CidrIp,
        protocol: p.IpProtocol ?? "-1",
        fromPort: p.FromPort ?? 0,
        toPort: p.ToPort ?? 65535,
        description: range.Description,
      });
    }
  }
  return rules;
}

function matches(rule: SecurityGroupRule, existing: ExistingRule): boolean {
  return (
    existing.sourceCidr === rule.sourceCidr &&
    existing.protocol === rule.protocol &&
    existing.fromPort === rule.fromPort &&
    existing.toPort === rule.toPort
  );
}

export async function hasRule(rule: SecurityGroupRule): Promise<boolean> {
  const rules = await describeRules();
  return rules.some((r) => matches(rule, r));
}

export async function authorizeRule(rule: SecurityGroupRule): Promise<void> {
  const cfg = config();
  await client(cfg).send(
    new AuthorizeSecurityGroupIngressCommand({
      GroupId: cfg.groupId,
      IpPermissions: [toIpPermission(rule)],
    }),
  );
}

export async function revokeRule(rule: SecurityGroupRule): Promise<void> {
  const cfg = config();
  await client(cfg).send(
    new RevokeSecurityGroupIngressCommand({
      GroupId: cfg.groupId,
      IpPermissions: [toIpPermission(rule)],
    }),
  );
}
