import {
  AuthorizeSecurityGroupIngressCommand,
  DescribeSecurityGroupsCommand,
  EC2Client,
  RevokeSecurityGroupIngressCommand,
  type IpPermission,
} from "@aws-sdk/client-ec2";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

// Slice 1 spike, temporary. It proves the Vercel to AWS boundary: assume the
// IAM role with the Vercel OIDC token, add one test rule to the test security
// group, read it back, remove it, and read back again. Slice 3 replaces this
// route with the real AWS adapter. The only rule it can ever add is the
// documentation range address below, and it removes it in the same call.
const TEST_CIDR = "203.0.113.10/32";
const TEST_RULE: IpPermission = {
  IpProtocol: "tcp",
  FromPort: 22,
  ToPort: 22,
  IpRanges: [{ CidrIp: TEST_CIDR, Description: "Changeguard Slice 1 spike" }],
};
// No audience option: the default OIDC token already carries the team
// audience (https://vercel.com/cardigans), which is what the IdP and the
// trust policy expect. Passing it explicitly forces a token exchange that
// Vercel rejects with "Invalid audience", so leave it out.

function hasTestRule(permissions: IpPermission[] | undefined): boolean {
  return (permissions ?? []).some(
    (p) =>
      p.IpProtocol === "tcp" &&
      p.FromPort === 22 &&
      p.ToPort === 22 &&
      (p.IpRanges ?? []).some((r) => r.CidrIp === TEST_CIDR),
  );
}

export async function POST() {
  const roleArn = process.env.AWS_ROLE_ARN;
  const groupId = process.env.CHANGEGUARD_SG_ID;
  const region = process.env.AWS_REGION;
  if (!roleArn || !groupId || !region) {
    return Response.json(
      { ok: false, error: "Missing AWS_ROLE_ARN, CHANGEGUARD_SG_ID, or AWS_REGION." },
      { status: 500 },
    );
  }

  const ec2 = new EC2Client({
    region,
    credentials: awsCredentialsProvider({ roleArn }),
  });
  const describe = async () => {
    const out = await ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: [groupId] }));
    return out.SecurityGroups?.[0]?.IpPermissions ?? [];
  };

  let added = false;
  try {
    const before = await describe();
    if (hasTestRule(before)) {
      // A previous run stopped after adding the rule. Remove the leftover first.
      await ec2.send(
        new RevokeSecurityGroupIngressCommand({ GroupId: groupId, IpPermissions: [TEST_RULE] }),
      );
    }
    await ec2.send(
      new AuthorizeSecurityGroupIngressCommand({ GroupId: groupId, IpPermissions: [TEST_RULE] }),
    );
    added = true;
    const afterAdd = await describe();
    const presentAfterAdd = hasTestRule(afterAdd);
    await ec2.send(
      new RevokeSecurityGroupIngressCommand({ GroupId: groupId, IpPermissions: [TEST_RULE] }),
    );
    added = false;
    const afterRemove = await describe();
    const presentAfterRemove = hasTestRule(afterRemove);
    const ok = presentAfterAdd && !presentAfterRemove;
    return Response.json(
      {
        ok,
        groupId,
        region,
        rule: TEST_CIDR,
        steps: {
          presentBefore: hasTestRule(before),
          presentAfterAdd,
          presentAfterRemove,
        },
      },
      { status: ok ? 200 : 500 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return Response.json({ ok: false, groupId, region, error: message }, { status: 500 });
  } finally {
    if (added) {
      // Never leave the test rule behind.
      await ec2
        .send(
          new RevokeSecurityGroupIngressCommand({ GroupId: groupId, IpPermissions: [TEST_RULE] }),
        )
        .catch(() => undefined);
    }
  }
}
