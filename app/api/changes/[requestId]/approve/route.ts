import { resumeHook } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";
import { approvalToken } from "@/workflows/change";
import { NextResponse } from "next/server";

// Resume a waiting run with a human decision. The payload carries the
// approver id; the workflow itself refuses when the approver is the
// requester, so this route never needs to know who requested what.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { ok: false, error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }
  const { approverId, approved } = body as Record<string, unknown>;
  if (typeof approverId !== "string" || approverId.trim() === "") {
    return NextResponse.json(
      { ok: false, error: "approverId is required." },
      { status: 400 },
    );
  }
  if (typeof approved !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "approved must be true or false." },
      { status: 400 },
    );
  }

  try {
    const resumed = await resumeHook(approvalToken(requestId), {
      approverId: approverId.trim(),
      approved,
    });
    return NextResponse.json({ ok: true, runId: resumed.runId });
  } catch (error) {
    if (error instanceof HookNotFoundError) {
      return NextResponse.json(
        { ok: false, error: "No run is waiting for approval for this request." },
        { status: 404 },
      );
    }
    throw error;
  }
}
