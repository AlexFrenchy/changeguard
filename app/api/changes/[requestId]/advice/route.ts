import { readAdviceRecord } from "@/lib/ledger";
import { NextResponse } from "next/server";

// The advice record for a request. 404 until the workflow writes it, which
// happens right after the AI step, before the approval wait. The review page
// polls this so the reviewer sees the advice while the run waits.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  const record = await readAdviceRecord(requestId);
  if (!record) {
    return NextResponse.json(
      { ok: false, error: "Advice not written yet." },
      { status: 404 },
    );
  }
  return NextResponse.json(record);
}
