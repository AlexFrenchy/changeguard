import { describeRules, normalizeCidr } from "@/lib/aws";
import { readRequestRecord } from "@/lib/ledger";
import { NextResponse } from "next/server";

// The request record plus the live AWS read-back: whether the requested
// rule is currently in the security group, and the rules that are there.
// The review page polls this while the run waits and after it finishes.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  const record = await readRequestRecord(requestId);
  if (!record) {
    return NextResponse.json(
      { ok: false, error: "Request not found." },
      { status: 404 },
    );
  }
  // One Describe call, matched inline: the rule is identified by the same
  // four fields the AWS adapter uses to match a rule. Both CIDRs are
  // normalized, so a record written before the fix still matches the
  // network address AWS stores.
  const rules = await describeRules();
  const present = rules.some(
    (r) =>
      normalizeCidr(r.sourceCidr) === normalizeCidr(record.sourceCidr) &&
      r.protocol === record.protocol &&
      r.fromPort === record.fromPort &&
      r.toPort === record.toPort,
  );
  return NextResponse.json({ request: record, present, rules });
}
