"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DEMO_DESTINATION, type PacketDestination } from "@/lib/ai";
import { durationLabel } from "./format";
import { RoleSwitcher } from "./role-switcher";

// The requester page: pick who is asking, fill in the change, submit it.
// The run status is shown after submit, with a link to the review page.

const DESTINATIONS: PacketDestination[] = [
  DEMO_DESTINATION,
  {
    environment: "production",
    label: "prod database",
    sensitivity: "Customer data. Direct access is unusual for most roles.",
  },
  {
    environment: "staging",
    label: "staging web",
    sensitivity: "Staging access. Lower sensitivity than production.",
  },
];

// One click fills the form. The shadow example draws its finding only when
// the rule is already in the group: ask once and it applies, ask again and
// the checks say you already have it.
const EXAMPLES = [
  {
    id: "clean-ssh",
    label: "Clean SSH request",
    hint: "A routine on-call fix. Expect low risk and an approval.",
    values: {
      requesterId: "mara-chen",
      sourceCidr: "203.0.113.10/32",
      protocol: "tcp",
      fromPort: 22,
      toPort: 22,
      durationMinutes: 120,
      reason: "On-call fix on the prod bastion, need SSH for the incident.",
      destination: 0,
    },
  },
  {
    id: "blocked",
    label: "Blocked: open to the world",
    hint: "SSH from 0.0.0.0/0. The checks block it before any advice.",
    values: {
      requesterId: "mara-chen",
      sourceCidr: "0.0.0.0/0",
      protocol: "tcp",
      fromPort: 22,
      toPort: 22,
      durationMinutes: 120,
      reason: "Need SSH from anywhere for the migration.",
      destination: 0,
    },
  },
  {
    id: "broad-range",
    label: "Escalated: broad range",
    hint: "A /16 source for SSH. Expect an escalated finding and a question.",
    values: {
      requesterId: "mara-chen",
      sourceCidr: "203.0.113.0/16",
      protocol: "tcp",
      fromPort: 22,
      toPort: 22,
      durationMinutes: 120,
      reason: "Open the whole office range for convenience.",
      destination: 0,
    },
  },
  {
    id: "shadow",
    label: "Shadowed: already has access",
    hint: "The same rule is already in the group, so the checks flag it as redundant.",
    values: {
      requesterId: "mara-chen",
      sourceCidr: "203.0.113.20/32",
      protocol: "tcp",
      fromPort: 22,
      toPort: 22,
      durationMinutes: 120,
      reason: "Need SSH to the prod bastion.",
      destination: 0,
    },
  },
];

interface Submitted {
  requestId: string;
  runId: string;
}

interface RunStatus {
  status?: string;
  waitingForApproval?: boolean;
  result?: { status: string; applied?: boolean; removed?: boolean };
  error?: string;
}

function readStored(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function statusText(status: RunStatus): string {
  if (status.waitingForApproval) return "Waiting for approval";
  if (status.result) {
    if (status.result.status === "blocked")
      return "Blocked by the deterministic checks. No advice, no approval.";
    if (status.result.status === "denied") return "Denied by the reviewer.";
    if (status.result.status === "expired")
      return "Approved, applied, and removed when the window ended.";
    if (status.result.status === "advice-unavailable")
      return "The AI advice was unavailable, so the run stopped. Nothing was applied.";
    return `Finished: ${status.result.status}.`;
  }
  if (status.status === "failed") return `Run failed: ${status.error ?? "unknown error"}.`;
  return "Running the checks and the AI review.";
}

export default function Home() {
  const [requesterId, setRequesterId] = useState(() =>
    readStored("changeguard-requester", "mara-chen"),
  );
  const [sourceCidr, setSourceCidr] = useState("203.0.113.10/32");
  const [protocol, setProtocol] = useState("tcp");
  const [fromPort, setFromPort] = useState(22);
  const [toPort, setToPort] = useState(22);
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [reason, setReason] = useState("");
  const [destinationIndex, setDestinationIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);

  useEffect(() => {
    window.localStorage.setItem("changeguard-requester", requesterId);
  }, [requesterId]);

  // After submit, poll the run until it waits for approval or finishes.
  // The review page takes over from there.
  useEffect(() => {
    if (!submitted) return;
    let stopped = false;
    const poll = async () => {
      const res = await fetch(
        `/api/changes?runId=${submitted.runId}&requestId=${submitted.requestId}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as RunStatus;
      if (stopped) return;
      setRunStatus(data);
      if (
        data.waitingForApproval ||
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
  }, [submitted]);

  function fillExample(example: (typeof EXAMPLES)[number]) {
    setRequesterId(example.values.requesterId);
    setSourceCidr(example.values.sourceCidr);
    setProtocol(example.values.protocol);
    setFromPort(example.values.fromPort);
    setToPort(example.values.toPort);
    setDurationMinutes(example.values.durationMinutes);
    setReason(example.values.reason);
    setDestinationIndex(example.values.destination);
    setSubmitted(null);
    setRunStatus(null);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSubmitted(null);
    setRunStatus(null);
    const res = await fetch("/api/changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requesterId,
        sourceCidr,
        protocol,
        fromPort,
        toPort,
        durationMinutes,
        reason,
        destination: DESTINATIONS[destinationIndex],
      }),
    });
    const data = await res.json().catch(() => null);
    setSubmitting(false);
    if (!res.ok || !data) {
      setError(data?.error ?? "The request could not be submitted.");
      return;
    }
    setSubmitted({ requestId: data.requestId, runId: data.runId });
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950";

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">
          Changeguard
        </h1>
        <p className="mt-2 text-base leading-7 text-zinc-600">
          Approval for firewall changes that expire on time, every time.
          Request temporary access, the checks and the AI review it, a
          different person approves, and the rule removes itself when the
          window ends.
        </p>
        <p className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
          Demo: requests go to a test security group in AWS. The rule is real,
          and it removes itself when the window ends.
        </p>
      </header>

      <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-medium text-zinc-950">Canned examples</h2>
        <p className="mt-1 text-sm text-zinc-600">
          One click fills the form. Submit it, then follow the review link.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.id}
              type="button"
              onClick={() => fillExample(example)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left hover:border-zinc-950"
            >
              <span className="block text-sm font-medium text-zinc-950">
                {example.label}
              </span>
              <span className="block text-xs leading-5 text-zinc-500">
                {example.hint}
              </span>
            </button>
          ))}
        </div>
      </section>

      <form
        onSubmit={submit}
        className="mt-6 rounded-xl border border-zinc-200 bg-white p-5"
      >
        <h2 className="text-lg font-medium text-zinc-950">Request a change</h2>
        <div className="mt-4">
          <RoleSwitcher
            label="Who is asking?"
            value={requesterId}
            onChange={setRequesterId}
          />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-zinc-950">
              Source CIDR
            </span>
            <input
              className={`${inputClass} mt-1 font-mono`}
              value={sourceCidr}
              onChange={(e) => setSourceCidr(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-950">Protocol</span>
            <select
              className={`${inputClass} mt-1`}
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
            >
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
              <option value="icmp">icmp</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-950">From port</span>
            <input
              className={`${inputClass} mt-1`}
              type="number"
              min={1}
              max={65535}
              value={fromPort}
              onChange={(e) => setFromPort(Number(e.target.value))}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-950">To port</span>
            <input
              className={`${inputClass} mt-1`}
              type="number"
              min={1}
              max={65535}
              value={toPort}
              onChange={(e) => setToPort(Number(e.target.value))}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-950">
              Duration, in minutes ({durationLabel(durationMinutes)})
            </span>
            <input
              className={`${inputClass} mt-1`}
              type="number"
              min={1}
              max={43200}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-950">
              Destination
            </span>
            <select
              className={`${inputClass} mt-1`}
              value={destinationIndex}
              onChange={(e) => setDestinationIndex(Number(e.target.value))}
            >
              {DESTINATIONS.map((destination, index) => (
                <option key={destination.label} value={index}>
                  {destination.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-medium text-zinc-950">Reason</span>
          <textarea
            className={`${inputClass} mt-1`}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why do you need this access, and for what work?"
            required
          />
        </label>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit request"}
        </button>
      </form>

      {submitted && (
        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="text-lg font-medium text-zinc-950">
            Request submitted
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            {runStatus ? statusText(runStatus) : "Starting the run..."}
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-500">
            {submitted.requestId}
          </p>
          <Link
            href={`/review/${submitted.requestId}?runId=${submitted.runId}`}
            className="mt-3 inline-block rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          >
            Review this request
          </Link>
        </section>
      )}
    </main>
  );
}
