// 12-case AI eval. Drives the production workflow through
// the /api/changes endpoint, so the advice is tested exactly as the reviewer
// sees it, with the live Gateway and OIDC auth. No keys, no mocks.
// Run from the repo root: node scripts/eval-ai.mjs
// Every case is denied after the advice step, so no case applies a rule and
// the security group stays clean. The seed rule is applied by its own run
// and removes itself when its 5 minute window ends.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Pin the eval to one deployment with EVAL_BASE, e.g.
// EVAL_BASE=https://changeguard-abc123-cardigans.vercel.app
// A new production deploy mid-eval would otherwise swap the code under
// the run: the old workflow returns a denied outcome with no advice field,
// which looks like a model failure. Without EVAL_BASE the production
// alias is used.
const BASE = process.env.EVAL_BASE ?? "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One vercel curl call. The last line starting with "{" is the JSON body;
// the rest is CLI chatter and the curl progress meter. The CLI path to
// Vercel sometimes hangs, so a timed-out call is retried once.
function vc(method, path, body) {
  const url = BASE ? `${BASE}${path}` : path;
  const args = ["vercel", "curl", url, "--", "--request", method];
  if (body !== undefined) args.push("--data", JSON.stringify(body));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = execFileSync("npx", args, {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 120_000,
      });
      const line = out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("{"))
        .at(-1);
      if (!line) throw new Error(`No JSON in vercel curl output for ${method} ${path}: ${out}`);
      return JSON.parse(line);
    } catch (e) {
      // The CLI sometimes hangs after the response already arrived (the
      // progress meter shows the bytes received, but the process never
      // exits). The timed-out child's stdout still holds the response,
      // so parse it instead of losing the call.
      const partial = e && e.stdout ? e.stdout.toString("utf8") : "";
      const line = partial
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("{"))
        .at(-1);
      if (line) {
        try {
          return JSON.parse(line);
        } catch {
          // Fall through to the retry below.
        }
      }
      if (attempt === 0 && String(e.message).includes("ETIMEDOUT")) {
        console.log("  (vercel curl timed out, retrying once...)");
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

async function pollRun(runId, requestId, want, tries = 14) {
  for (let i = 0; i < tries; i++) {
    const state = vc("GET", `/api/changes?runId=${runId}&requestId=${requestId}`);
    const terminal =
      state.status === "completed" ||
      state.status === "failed" ||
      state.status === "cancelled";
    // A blocked run finishes before the wait, so "waiting" also returns
    // when the run is terminal, and the caller reads the blocked outcome.
    if (want === "waiting" && (state.waitingForApproval || terminal)) return state;
    if (want === "terminal" && terminal) return state;
    await sleep(5000);
  }
  throw new Error(`Run ${runId} did not reach ${want} in time`);
}

const CASES = [
  {
    id: "clean-ssh",
    requesterId: "mara-chen",
    sourceCidr: "203.0.113.10/32",
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
    durationMinutes: 120,
    reason: "On-call fix on the prod bastion, need SSH for the incident.",
    expected: { risk: "low", recommendation: "approve" },
  },
  {
    id: "open-to-world",
    requesterId: "mara-chen",
    sourceCidr: "0.0.0.0/0",
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
    durationMinutes: 120,
    reason: "Need SSH from anywhere for the migration.",
    expected: { blocked: true },
  },
  {
    id: "rdp-external",
    requesterId: "mara-chen",
    sourceCidr: "203.0.113.30/32",
    protocol: "tcp",
    fromPort: 3389,
    toPort: 3389,
    durationMinutes: 120,
    reason: "Need RDP to the Windows jump box for the patch.",
    expected: { risk: "high", recommendation: "deny" },
  },
  {
    id: "broad-range",
    requesterId: "mara-chen",
    sourceCidr: "203.0.113.0/16",
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
    durationMinutes: 120,
    reason: "Open the whole office range for convenience.",
    expected: { risk: "high", recommendation: "ask" },
  },
  {
    id: "long-duration",
    requesterId: "mara-chen",
    sourceCidr: "203.0.113.40/32",
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
    durationMinutes: 43200,
    reason: "Need SSH for the month-long migration.",
    expected: { risk: "medium", recommendation: "ask" },
  },
  {
    id: "overlap",
    requesterId: "mara-chen",
    sourceCidr: "203.0.113.0/24",
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
    durationMinutes: 120,
    reason: "Need SSH from the office range for the deploy.",
    expected: { risk: "medium", recommendation: "ask" },
  },
  {
    id: "shadow",
    requesterId: "mara-chen",
    sourceCidr: "203.0.113.20/32",
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
    durationMinutes: 120,
    reason: "Need SSH to the prod bastion.",
    expected: { risk: "low", recommendation: "deny" },
  },
  {
    id: "vague-reason",
    requesterId: "mara-chen",
    sourceCidr: "203.0.113.10/32",
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
    durationMinutes: 120,
    reason: "need access pls",
    expected: { risk: "low", recommendation: "ask" },
  },
  {
    id: "benign-web",
    requesterId: "mara-chen",
    sourceCidr: "203.0.113.50/32",
    protocol: "tcp",
    fromPort: 443,
    toPort: 443,
    durationMinutes: 120,
    reason: "Health check probe from the monitoring host.",
    expected: { risk: "low", recommendation: "approve" },
  },
  {
    id: "trap-new-joiner",
    requesterId: "jonas-weber",
    sourceCidr: "203.0.113.10/32",
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
    durationMinutes: 120,
    reason: "Need SSH to the prod bastion for the onboarding task.",
    expected: { risk: "medium", recommendation: "ask" },
  },
  {
    id: "trap-first-prod",
    requesterId: "sofia-rossi",
    sourceCidr: "203.0.113.10/32",
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
    durationMinutes: 120,
    reason: "Need SSH to the prod bastion to check the deploy.",
    expected: { risk: "medium", recommendation: "ask" },
  },
  {
    id: "trap-wrong-destination",
    requesterId: "lena-fischer",
    sourceCidr: "203.0.113.10/32",
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
    durationMinutes: 120,
    reason: "Need SSH to the prod database to debug the checkout funnel.",
    destination: {
      environment: "production",
      label: "prod database",
      sensitivity: "Customer data. Direct access is unusual for a Growth role.",
    },
    expected: { risk: "medium", recommendation: "ask" },
  },
];

function approverFor(requesterId) {
  return requesterId === "jonas-weber" ? "mara-chen" : "jonas-weber";
}

async function runCase(c) {
  const started = vc("POST", "/api/changes", {
    requesterId: c.requesterId,
    sourceCidr: c.sourceCidr,
    protocol: c.protocol,
    fromPort: c.fromPort,
    toPort: c.toPort,
    durationMinutes: c.durationMinutes,
    reason: c.reason,
    ...(c.destination ? { destination: c.destination } : {}),
  });
  const { runId, requestId } = started;
  const waiting = await pollRun(runId, requestId, "waiting");
  if (waiting.status === "completed") {
    // Blocked: the run finished before the wait. Advice must be absent.
    return { id: c.id, runId, outcome: waiting.result };
  }
  // Deny, so the case never applies a rule. The outcome carries the advice.
  vc("POST", `/api/changes/${requestId}/approve`, {
    approverId: approverFor(c.requesterId),
    approved: false,
  });
  const done = await pollRun(runId, requestId, "terminal");
  return { id: c.id, runId, outcome: done.result };
}

function score(c, outcome) {
  if (!outcome) return { pass: false, got: "no outcome", model: "-", cost: 0 };
  if (c.expected.blocked) {
    const pass =
      outcome.status === "blocked" &&
      outcome.advice === null &&
      outcome.applied === false;
    return {
      pass,
      got: `status ${outcome.status}, advice ${outcome.advice === null ? "absent" : "present"}`,
      model: "-",
      cost: 0,
    };
  }
  const advice = outcome.advice;
  if (!advice || advice.status !== "ok") {
    return {
      pass: false,
      got: `advice ${advice ? advice.status : "missing"}`,
      model: "-",
      cost: 0,
    };
  }
  const a = advice.advice;
  const pass =
    a.riskLevel === c.expected.risk &&
    a.recommendation === c.expected.recommendation;
  return {
    pass,
    got: `${a.riskLevel} / ${a.recommendation}`,
    model: a.model,
    cost: a.costUsd,
    explanation: a.explanation,
  };
}

const startedAt = new Date();
console.log("Seeding the group with one rule for the overlap and shadow cases...");
const seed = vc("POST", "/api/changes", {
  requesterId: "mara-chen",
  sourceCidr: "203.0.113.20/32",
  protocol: "tcp",
  fromPort: 22,
  toPort: 22,
  durationMinutes: 5,
  reason: "Eval seed rule for overlap and shadow cases.",
});
await pollRun(seed.runId, seed.requestId, "waiting");
vc("POST", `/api/changes/${seed.requestId}/approve`, {
  approverId: "jonas-weber",
  approved: true,
});
await sleep(12000);
console.log(`Seed run ${seed.runId} approved, rule should be in the group.`);

const rows = [];
let passed = 0;
let totalCost = 0;
const models = new Set();
for (const c of CASES) {
  console.log(`Case ${c.id}...`);
  try {
    const { outcome } = await runCase(c);
    const s = score(c, outcome);
    if (s.pass) passed += 1;
    totalCost += s.cost;
    if (s.model !== "-") models.add(s.model);
    rows.push({ ...c, ...s, outcome });
    console.log(`  ${s.pass ? "PASS" : "FAIL"}: expected ${c.expected.blocked ? "blocked" : `${c.expected.risk} / ${c.expected.recommendation}`}, got ${s.got}`);
  } catch (e) {
    // A harness failure on one case must not lose the other eleven.
    rows.push({ ...c, pass: false, got: `error: ${e.message}`, model: "-", cost: 0 });
    console.log(`  ERROR: ${e.message}`);
  }
}

// The seed removes its own rule when its 5 minute window ends. Confirm the
// group is clean before reporting.
console.log("Waiting for the seed run to expire and remove its rule...");
const seedDone = await pollRun(seed.runId, seed.requestId, "terminal", 40);
const seedClean = seedDone.result?.removed === true;

const date = startedAt.toISOString().slice(0, 10);
const lines = [
  "# AI eval results",
  "",
  `Date: ${date}`,
  `Deployment: ${BASE || "production alias"}`,
  `Model: ${[...models].join(", ") || "-"}`,
  `Pass: ${passed} / ${CASES.length}`,
  `Total cost: $${totalCost.toFixed(6)}`,
  `Seed rule removed at expiry: ${seedClean ? "yes" : "NO, check the group"}`,
  "",
  "| Case | Expected | Got | Model | Cost | Result |",
  "| --- | --- | --- | --- | --- | --- |",
];
for (const r of rows) {
  lines.push(
    `| ${r.id} | ${r.expected.blocked ? "blocked" : `${r.expected.risk} / ${r.expected.recommendation}`} | ${r.got} | ${r.model} | $${r.cost.toFixed(6)} | ${r.pass ? "PASS" : "FAIL"} |`,
  );
}
lines.push("");
lines.push("## Notes");
lines.push("");
lines.push("- Every case is denied after the advice step, so no case applies a rule.");
lines.push("- The blocked case asserts the advice is absent, never approvable.");
lines.push("- The overlap and shadow cases run against the seed rule 203.0.113.20/32, applied by its own run and removed at expiry.");
mkdirSync(join(ROOT, "eval"), { recursive: true });
writeFileSync(join(ROOT, "eval", "ai-eval-results.md"), lines.join("\n") + "\n");
console.log(`\n${passed} / ${CASES.length} passed. Total cost $${totalCost.toFixed(6)}. Seed clean: ${seedClean}.`);
if (passed !== CASES.length || !seedClean) process.exit(1);
