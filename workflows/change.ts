import { createHook, FatalError, sleep } from "workflow";
import {
  authorizeRule,
  describeRules,
  hasRule,
  revokeRule,
  type SecurityGroupRule,
} from "../lib/aws";
import { runChecks, type ChangeRequest, type Finding } from "../lib/checks";

// The durable workflow. Five steps, in order: checks, approval wait, apply,
// sleep, remove. A blocked request stops before the wait, and a refused
// approval never reaches AWS.

export interface ChangeRequestInput extends SecurityGroupRule {
  requestId: string;
  requesterId: string;
  durationMinutes: number;
  reason: string;
}

export interface ApprovalPayload {
  approverId: string;
  approved: boolean;
}

export type ChangeStatus = "blocked" | "denied" | "expired";

export interface ChangeOutcome {
  status: ChangeStatus;
  requestId: string;
  findings: Finding[];
  applied: boolean;
  removed: boolean;
}

// One token per request, rebuilt the same way by the approve route, so the
// route can resume the right run without storing anything.
export function approvalToken(requestId: string): string {
  return `approval:${requestId}`;
}

async function checkRequest(input: ChangeRequestInput): Promise<{
  findings: Finding[];
  blocked: boolean;
}> {
  "use step";

  const existing = await describeRules();
  const request: ChangeRequest = {
    sourceCidr: input.sourceCidr,
    protocol: input.protocol,
    fromPort: input.fromPort,
    toPort: input.toPort,
    endsAt: new Date(Date.now() + input.durationMinutes * 60_000),
    durationHours: input.durationMinutes / 60,
    reason: input.reason,
  };
  const findings = runChecks(request, existing);
  return { findings, blocked: findings.some((f) => f.effect === "block") };
}

// The refusal is a step, not an inline check, so it lands in the run history
// as a named failure that is never retried.
async function enforceSeparationOfDuties(
  requesterId: string,
  approverId: string,
): Promise<void> {
  "use step";

  if (approverId === requesterId) {
    throw new FatalError(
      "Self-approval is not allowed: the approver must differ from the requester.",
    );
  }
}

function ruleFor(input: ChangeRequestInput): SecurityGroupRule {
  return {
    sourceCidr: input.sourceCidr,
    protocol: input.protocol,
    fromPort: input.fromPort,
    toPort: input.toPort,
    description: `Changeguard request ${input.requestId}`,
  };
}

async function applyRule(input: ChangeRequestInput): Promise<boolean> {
  "use step";

  const rule = ruleFor(input);
  // Authorizing a rule that is already there fails, so check first.
  if (!(await hasRule(rule))) {
    await authorizeRule(rule);
  }
  // Read back: the rule must actually be there before the run moves on.
  if (!(await hasRule(rule))) {
    throw new Error("Rule was not found in the security group after applying it.");
  }
  return true;
}

async function removeRule(input: ChangeRequestInput): Promise<boolean> {
  "use step";

  const rule = ruleFor(input);
  if (await hasRule(rule)) {
    await revokeRule(rule);
  }
  // Read back: the rule must actually be gone before the run reports done.
  if (await hasRule(rule)) {
    throw new Error("Rule was still in the security group after removing it.");
  }
  return true;
}

export async function changeWorkflow(
  input: ChangeRequestInput,
): Promise<ChangeOutcome> {
  "use workflow";

  const checked = await checkRequest(input);
  if (checked.blocked) {
    return {
      status: "blocked",
      requestId: input.requestId,
      findings: checked.findings,
      applied: false,
      removed: false,
    };
  }

  const hook = createHook<ApprovalPayload>({
    token: approvalToken(input.requestId),
  });
  const approval = await hook;
  hook.dispose();

  await enforceSeparationOfDuties(input.requesterId, approval.approverId);
  if (!approval.approved) {
    return {
      status: "denied",
      requestId: input.requestId,
      findings: checked.findings,
      applied: false,
      removed: false,
    };
  }

  const applied = await applyRule(input);
  await sleep(`${input.durationMinutes}m`);
  const removed = await removeRule(input);
  return {
    status: "expired",
    requestId: input.requestId,
    findings: checked.findings,
    applied,
    removed,
  };
}
