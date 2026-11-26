import { createHook, FatalError, sleep } from "workflow";
import {
  buildContextPacket,
  getAdvice,
  type Advice,
  type AdviceResult,
  type PacketDestination,
} from "../lib/ai";
import {
  authorizeRule,
  describeRules,
  hasRule,
  revokeRule,
  type SecurityGroupRule,
} from "../lib/aws";
import { runChecks, type ChangeRequest, type ExistingRule, type Finding } from "../lib/checks";
import { getDemoProfile } from "../lib/context";
import { writeAdviceRecord, type LedgerRequest } from "../lib/ledger";

// The durable workflow. Seven steps, in order: checks, AI advice, record
// advice, approval wait, apply, sleep, remove. A blocked request stops
// before the wait, and a refused approval never reaches AWS.

export interface ChangeRequestInput extends SecurityGroupRule {
  requestId: string;
  requesterId: string;
  durationMinutes: number;
  reason: string;
  destination?: PacketDestination;
}

export interface ApprovalPayload {
  approverId: string;
  approved: boolean;
}

export type ChangeStatus = "blocked" | "denied" | "expired" | "advice-unavailable";

export interface ChangeOutcome {
  status: ChangeStatus;
  requestId: string;
  findings: Finding[];
  advice: AdviceResult | null;
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
  existing: ExistingRule[];
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
  return {
    findings,
    blocked: findings.some((f) => f.effect === "block"),
    existing,
  };
}

// The AI step runs after the checks and before the approval wait, so the
// reviewer sees the advice before deciding. A blocked request never reaches
// it. If the model cannot be reached, the run stops here: fail closed.
async function adviseRequest(
  input: ChangeRequestInput,
  findings: Finding[],
  existing: ExistingRule[],
): Promise<AdviceResult> {
  "use step";

  const packet = buildContextPacket({
    sourceCidr: input.sourceCidr,
    protocol: input.protocol,
    fromPort: input.fromPort,
    toPort: input.toPort,
    durationMinutes: input.durationMinutes,
    reason: input.reason,
    requesterId: input.requesterId,
    profile: getDemoProfile(input.requesterId),
    findings,
    existing,
    destination: input.destination,
  });
  return getAdvice(packet);
}

// The advice record is the reviewer's copy: the request, the findings, and
// the advice, written to the Blob ledger right after the AI step so the
// review page can show it while the run waits for approval. Its own step so
// a retry rewrites the record instead of calling the model again.
async function recordAdvice(
  input: ChangeRequestInput,
  findings: Finding[],
  advice: Advice,
): Promise<void> {
  "use step";

  const request: LedgerRequest = {
    requestId: input.requestId,
    requesterId: input.requesterId,
    sourceCidr: input.sourceCidr,
    protocol: input.protocol,
    fromPort: input.fromPort,
    toPort: input.toPort,
    durationMinutes: input.durationMinutes,
    reason: input.reason,
    destination: input.destination,
    createdAt: new Date().toISOString(),
  };
  await writeAdviceRecord({ requestId: input.requestId, request, findings, advice });
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
      advice: null,
      applied: false,
      removed: false,
    };
  }

  const advice = await adviseRequest(input, checked.findings, checked.existing);
  if (advice.status === "unavailable") {
    return {
      status: "advice-unavailable",
      requestId: input.requestId,
      findings: checked.findings,
      advice,
      applied: false,
      removed: false,
    };
  }

  await recordAdvice(input, checked.findings, advice.advice);

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
      advice,
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
    advice,
    applied,
    removed,
  };
}
