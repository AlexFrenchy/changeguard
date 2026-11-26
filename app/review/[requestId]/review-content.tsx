"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import type { Advice, AdviceResult } from "@/lib/ai";
import type { ExistingRule, Finding } from "@/lib/checks";
import { DEMO_PROFILES, getDemoProfile } from "@/lib/context";
import type { AdviceRecord, LedgerRequest } from "@/lib/ledger";
import { durationLabel, ruleLabel } from "../../format";
import { RoleSwitcher } from "../../role-switcher";

// The review page: the request, the deterministic findings, the AI advice,
// the live AWS read-back, and the Approve / Deny decision. The advice is
// polled from the Blob ledger, so it appears while the run waits.

interface LiveState {
  request: LedgerRequest;
  present: boolean;
  rules: ExistingRule[];
}

interface RunResult {
  status: string;
  findings: Finding[];
  advice: AdviceResult | null;
  applied: boolean;
  removed: boolean;
}

interface RunStatus {
  status?: string;
  waitingForApproval?: boolean;
  result?: RunResult;
  error?: string;
}

const EFFECT_STYLE: Record<string, string> = {
  block: "border-red-200 bg-red-50 text-red-800",
  escalate: "border-amber-200 bg-amber-50 text-amber-800",
  flag: "border-zinc-200 bg-zinc-50 text-zinc-700",
  return: "border-blue-200 bg-blue-50 text-blue-800",
};

const RISK_STYLE: Record<string, string> = {
  low: "border-green-200 bg-green-50 text-green-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-red-200 bg-red-50 text-red-800",
};

const RECOMMENDATION_STYLE: Record<string, string> = {
  approve: "border-green-200 bg-green-50 text-green-800",
  ask: "border-amber-200 bg-amber-50 text-amber-800",
  deny: "border-red-200 bg-red-50 text-red-800",
};

function readStored(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function runStatusText(status: RunStatus): { label: string; style: string } {
  if (status.waitingForApproval)
    return { label: "Waiting for approval", style: RISK_STYLE.medium };
  if (status.result) {
    if (status.result.status === "blocked")
      return { label: "Blocked by the checks", style: RISK_STYLE.high };
    if (status.result.status === "denied")
      return { label: "Denied", style: EFFECT_STYLE.flag };
    if (status.result.status === "expired")
      return { label: "Expired: applied and removed", style: RISK_STYLE.low };
    if (status.result.status === "advice-unavailable")
      return { label: "Advice unavailable", style: RISK_STYLE.high };
    return { label: status.result.status, style: EFFECT_STYLE.flag };
  }
  if (status.status === "failed")
    return { label: "Run failed", style: RISK_STYLE.high };
  return { label: "Running", style: EFFECT_STYLE.flag };
}

export function ReviewContent({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ runId?: string }>;
}) {
  const { requestId } = use(params);
  const { runId } = use(searchParams);

  const [live, setLive] = useState<LiveState | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [adviceRecord, setAdviceRecord] = useState<AdviceRecord | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [approverId, setApproverId] = useState(() =>
    readStored("changeguard-approver", "jonas-weber"),
  );
  const [approverTouched, setApproverTouched] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decided, setDecided] = useState<string | null>(null);
  const [prevRequesterId, setPrevRequesterId] = useState<string | null>(null);

  // Default the approver to someone other than the requester, unless the
  // reviewer already picked someone. Adjusted during render, not in an
  // effect: the approver only changes when the requester changes.
  if (live && live.request.requesterId !== prevRequesterId) {
    setPrevRequesterId(live.request.requesterId);
    if (!approverTouched && approverId === live.request.requesterId) {
      const other = DEMO_PROFILES.find(
        (p) => p.id !== live.request.requesterId,
      );
      if (other) setApproverId(other.id);
    }
  }

  useEffect(() => {
    window.localStorage.setItem("changeguard-approver", approverId);
  }, [approverId]);

  // The request and the live AWS state, polled so the read-back follows the
  // rule being applied and removed.
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      const res = await fetch(`/api/changes/${requestId}`);
      if (!res.ok) {
        if (!stopped) setLiveError("Request not found.");
        return;
      }
      const data = (await res.json()) as LiveState;
      if (!stopped) setLive(data);
    };
    void poll();
    const timer = setInterval(() => {
      if (!stopped) void poll();
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [requestId]);

  // The advice record, polled until the workflow writes it after the AI
  // step. Blocked runs never get one; their findings come from the run
  // result instead.
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      const res = await fetch(`/api/changes/${requestId}/advice`);
      if (!res.ok) return;
      const data = (await res.json()) as AdviceRecord;
      if (!stopped) {
        setAdviceRecord(data);
        stopped = true;
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (!stopped) void poll();
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [requestId]);

  // The run status, only when the page was reached with a run id.
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    const poll = async () => {
      const res = await fetch(
        `/api/changes?runId=${runId}&requestId=${requestId}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as RunStatus;
      if (stopped) return;
      setRunStatus(data);
      if (
        data.status === "completed" ||
        data.status === "failed" ||
        data.status === "cancelled"
      ) {
        stopped = true;
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (!stopped) void poll();
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [requestId, runId]);

  async function decide(approved: boolean) {
    setDeciding(true);
    setDecisionError(null);
    const res = await fetch(`/api/changes/${requestId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approverId, approved }),
    });
    const data = await res.json().catch(() => null);
    setDeciding(false);
    if (!res.ok || !data) {
      setDecisionError(data?.error ?? "The decision could not be recorded.");
      return;
    }
    setDecided(approved ? "approved" : "denied");
  }

  const request = live?.request ?? adviceRecord?.request ?? null;
  const findings: Finding[] =
    adviceRecord?.findings ?? runStatus?.result?.findings ?? [];
  const advice: Advice | null =
    adviceRecord?.advice ??
    (runStatus?.result?.advice?.status === "ok"
      ? runStatus.result.advice.advice
      : null);
  const profile = request ? getDemoProfile(request.requesterId) : undefined;
  const isSelfApproval =
    !!request && approverId === request.requesterId;
  const status = runStatus ? runStatusText(runStatus) : null;
  const cardClass = "rounded-xl border border-zinc-200 bg-white p-5";

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">
            Review request
          </h1>
          {status && (
            <span
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${status.style}`}
            >
              {status.label}
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-xs text-zinc-500">{requestId}</p>
        <Link href="/" className="mt-2 inline-block text-sm text-zinc-600 underline">
          Back to the request form
        </Link>
      </header>

      {liveError && !request && (
        <p className="mt-8 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {liveError} The request record may not exist yet, or the id is wrong.
        </p>
      )}

      {request && (
        <>
          <section className={`${cardClass} mt-8`}>
            <h2 className="text-lg font-medium text-zinc-950">The request</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">Requester</dt>
                <dd className="font-medium text-zinc-950">
                  {profile ? profile.name : request.requesterId}
                  {profile &&
                    `, ${profile.team}, ${profile.tenureBand}`}
                </dd>
                {profile && (
                  <dd className="text-xs text-zinc-500">
                    {profile.history.requests} past requests,{" "}
                    {profile.history.approved} approved,{" "}
                    {profile.history.cleanExpiries} clean expiries
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-zinc-500">Rule</dt>
                <dd className="font-mono font-medium text-zinc-950">
                  {ruleLabel(request)}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Duration</dt>
                <dd className="font-medium text-zinc-950">
                  {durationLabel(request.durationMinutes)}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Destination</dt>
                <dd className="font-medium text-zinc-950">
                  {request.destination?.label ?? "prod bastion (demo test group)"}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              <span className="text-zinc-500">Reason: </span>
              {request.reason}
            </p>
          </section>

          <section className={`${cardClass} mt-6`}>
            <h2 className="text-lg font-medium text-zinc-950">
              Deterministic checks
            </h2>
            {findings.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">
                {adviceRecord || runStatus?.result
                  ? "No findings. The deterministic checks passed."
                  : "The checks are still running."}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {findings.map((finding, index) => (
                  <li
                    key={`${finding.check}-${index}`}
                    className="flex items-start gap-2 text-sm"
                  >
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${EFFECT_STYLE[finding.effect] ?? EFFECT_STYLE.flag}`}
                    >
                      {finding.effect}
                    </span>
                    <span className="text-zinc-700">
                      <span className="font-medium text-zinc-950">
                        {finding.check}:{" "}
                      </span>
                      {finding.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${cardClass} mt-6`}>
            <h2 className="text-lg font-medium text-zinc-950">AI advice</h2>
            {!advice ? (
              <p className="mt-2 text-sm text-zinc-600">
                {runStatus?.result?.status === "blocked"
                  ? "Blocked by the checks before any advice, so there is nothing to show."
                  : "The advice is being written. It appears here while the run waits for approval."}
              </p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${RISK_STYLE[advice.riskLevel]}`}
                  >
                    Risk: {advice.riskLevel}
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${RECOMMENDATION_STYLE[advice.recommendation]}`}
                  >
                    Recommends: {advice.recommendation}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-700">
                  {advice.explanation}
                </p>
                {advice.evidence.length > 0 && (
                  <>
                    <h3 className="mt-4 text-sm font-medium text-zinc-950">
                      Evidence, quoted from the context packet
                    </h3>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-600">
                      {advice.evidence.map((quote, index) => (
                        <li key={index} className="font-mono text-xs leading-5">
                          {quote}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {advice.questions.length > 0 && (
                  <>
                    <h3 className="mt-4 text-sm font-medium text-zinc-950">
                      Questions back to the requester
                    </h3>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-600">
                      {advice.questions.map((question, index) => (
                        <li key={index}>{question}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="mt-4 text-xs text-zinc-500">
                  {advice.model}, {advice.inputTokens} in /{" "}
                  {advice.outputTokens} out tokens, $
                  {advice.costUsd.toFixed(5)} per review.
                </p>
              </>
            )}
          </section>

          <section className={`${cardClass} mt-6`}>
            <h2 className="text-lg font-medium text-zinc-950">
              Live AWS read-back
            </h2>
            <p className="mt-2 text-sm text-zinc-600">
              Rule in the security group:{" "}
              <span
                className={`font-medium ${live?.present ? "text-green-700" : "text-zinc-950"}`}
              >
                {live ? (live.present ? "Yes" : "No") : "Loading..."}
              </span>
            </p>
            {live && live.rules.length > 0 && (
              <ul className="mt-3 space-y-1">
                {live.rules.map((rule) => (
                  <li
                    key={rule.id}
                    className="font-mono text-xs leading-5 text-zinc-600"
                  >
                    {ruleLabel(rule)}
                  </li>
                ))}
              </ul>
            )}
            {live && live.rules.length === 0 && (
              <p className="mt-2 text-sm text-zinc-600">
                The group is empty.
              </p>
            )}
          </section>

          <section className={`${cardClass} mt-6`}>
            <h2 className="text-lg font-medium text-zinc-950">Decision</h2>
            <div className="mt-4">
              <RoleSwitcher
                label="Who is reviewing?"
                value={approverId}
                onChange={(id) => {
                  setApproverTouched(true);
                  setApproverId(id);
                }}
              />
            </div>
            {isSelfApproval && (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This is the requester. The workflow refuses self-approval, so
                approving here will fail the run.
              </p>
            )}
            {runStatus?.status === "failed" && (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                The workflow refused this decision:{" "}
                {runStatus.error ?? "unknown error"}. The run is over; submit a
                new request to try again.
              </p>
            )}
            {decisionError && (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {decisionError}
              </p>
            )}
            {decided ? (
              <p className="mt-4 text-sm text-zinc-600">
                You {decided} this request. The status at the top follows the
                run to the end.
              </p>
            ) : (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={deciding || !runStatus?.waitingForApproval}
                  onClick={() => void decide(true)}
                  className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {deciding ? "Recording..." : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={deciding || !runStatus?.waitingForApproval}
                  onClick={() => void decide(false)}
                  className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
                >
                  Deny
                </button>
              </div>
            )}
            {!runStatus?.waitingForApproval && !decided && (
              <p className="mt-3 text-sm text-zinc-500">
                {runStatus?.result
                  ? "This run is finished, so there is nothing left to decide."
                  : "The Approve and Deny buttons activate once the run waits for approval."}
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
