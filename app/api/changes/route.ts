import { getHookByToken, getRun, start } from "workflow/api";
import {
  approvalToken,
  changeWorkflow,
  type ChangeRequestInput,
} from "@/workflows/change";
import type { PacketDestination } from "@/lib/ai";
import { normalizeCidr } from "@/lib/aws";
import { writeRequestRecord } from "@/lib/ledger";
import { NextResponse } from "next/server";

// Start a change request: validate the shape, start the workflow, return the
// run id and the resume URL. The route checks shape only; the workflow's
// checks judge the content, so a flaggable request still reaches a human.
const MAX_DURATION_MINUTES = 30 * 24 * 60;
const PROTOCOLS = ["tcp", "udp", "icmp"];

function badRequest(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return badRequest("Request body must be a JSON object.");
  }
  const { requesterId, sourceCidr, protocol, fromPort, toPort, durationMinutes, reason, destination } =
    body as Record<string, unknown>;

  if (typeof requesterId !== "string" || requesterId.trim() === "") {
    return badRequest("requesterId is required.");
  }
  if (typeof sourceCidr !== "string" || !sourceCidr.includes("/")) {
    return badRequest("sourceCidr must be a CIDR like 203.0.113.10/32.");
  }
  if (typeof protocol !== "string" || !PROTOCOLS.includes(protocol.trim().toLowerCase())) {
    return badRequest("protocol must be tcp, udp, or icmp.");
  }
  if (
    typeof fromPort !== "number" ||
    !Number.isInteger(fromPort) ||
    fromPort < 1 ||
    fromPort > 65535
  ) {
    return badRequest("fromPort must be an integer from 1 to 65535.");
  }
  if (
    typeof toPort !== "number" ||
    !Number.isInteger(toPort) ||
    toPort < 1 ||
    toPort > 65535
  ) {
    return badRequest("toPort must be an integer from 1 to 65535.");
  }
  if (fromPort > toPort) {
    return badRequest("fromPort must not be greater than toPort.");
  }
  if (
    typeof durationMinutes !== "number" ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > MAX_DURATION_MINUTES
  ) {
    return badRequest("durationMinutes must be an integer from 1 to 43200.");
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    return badRequest("reason is required.");
  }
  // The destination is optional; without it the packet uses the demo test
  // target. A window over 24 hours is not rejected here: the excessive
  // duration check escalates it and the AI advises a shorter window, which
  // is exactly what the 30-day eval case tests.
  let parsedDestination: PacketDestination | undefined;
  if (destination !== undefined) {
    if (typeof destination !== "object" || destination === null) {
      return badRequest("destination must be an object.");
    }
    const { environment, label, sensitivity } = destination as Record<
      string,
      unknown
    >;
    if (
      typeof environment !== "string" ||
      environment.trim() === "" ||
      typeof label !== "string" ||
      label.trim() === "" ||
      typeof sensitivity !== "string" ||
      sensitivity.trim() === ""
    ) {
      return badRequest(
        "destination needs environment, label, and sensitivity strings.",
      );
    }
    parsedDestination = {
      environment: environment.trim(),
      label: label.trim(),
      sensitivity: sensitivity.trim(),
    };
  }

  const input: ChangeRequestInput = {
    requestId: crypto.randomUUID(),
    requesterId: requesterId.trim(),
    // Normalize to the network address, so the record, the checks, the
    // workflow, and the read-back all see the CIDR AWS will store.
    sourceCidr: normalizeCidr(sourceCidr.trim()),
    protocol: protocol.trim().toLowerCase(),
    fromPort,
    toPort,
    durationMinutes,
    reason: reason.trim(),
    destination: parsedDestination,
  };
  // The request record is the review page's copy. It is written before the
  // workflow starts, so the review page can load the request while the run
  // is still waiting for approval.
  await writeRequestRecord({
    ...input,
    createdAt: new Date().toISOString(),
  });
  const run = await start(changeWorkflow, [input]);
  return NextResponse.json(
    {
      runId: run.runId,
      requestId: input.requestId,
      resumeUrl: `/api/changes/${input.requestId}/approve`,
    },
    { status: 202 },
  );
}

// Read a run: status, whether it is waiting for approval, and the outcome
// once it finishes. The proof and the Slice 5 screens both read a run this
// way; there is no other way to observe a workflow result from outside.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const runId = params.get("runId");
  const requestId = params.get("requestId");
  if (!runId) {
    return badRequest("runId query parameter is required.");
  }
  const run = getRun(runId);
  if (!(await run.exists)) {
    return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });
  }
  const status = await run.status;
  const body: Record<string, unknown> = { runId, status };
  if (requestId) {
    body.waitingForApproval = await hookRegistered(requestId);
  }
  if (status === "completed" || status === "failed" || status === "cancelled") {
    try {
      body.result = await run.returnValue;
    } catch (error) {
      body.error = error instanceof Error ? error.message : "Run failed.";
    }
  }
  return NextResponse.json(body);
}

async function hookRegistered(requestId: string): Promise<boolean> {
  try {
    await getHookByToken(approvalToken(requestId));
    return true;
  } catch {
    return false;
  }
}
