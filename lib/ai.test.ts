// Tests for the AI advice helpers that need no model: packet building,
// cost math, and the prompt. The model call itself is covered by the live
// 12-case eval, not by unit tests.
import test from "node:test";
import assert from "node:assert/strict";
import {
  advicePrompt,
  buildContextPacket,
  reviewCostUsd,
  type ContextPacket,
} from "./ai.ts";
import { getDemoProfile } from "./context.ts";
import type { Finding } from "./checks.ts";

const KIMI = {
  id: "moonshotai/kimi-k2.5",
  inputPerMillion: 0.6,
  outputPerMillion: 3,
};
const ASTRA = {
  id: "openai/gpt-6-astra",
  inputPerMillion: 10,
  outputPerMillion: 50,
};

type PacketArgs = Parameters<typeof buildContextPacket>[0];

const BASE_ARGS: PacketArgs = {
  sourceCidr: "203.0.113.10/32",
  protocol: "tcp",
  fromPort: 22,
  toPort: 22,
  durationMinutes: 120,
  reason: "On-call fix on the prod bastion.",
  requesterId: "mara-chen",
  profile: getDemoProfile("mara-chen"),
  findings: [],
  existing: [],
};

function packet(overrides: Partial<PacketArgs> = {}): ContextPacket {
  return buildContextPacket({ ...BASE_ARGS, ...overrides });
}

test("packet carries the rule, the profile, and the findings", () => {
  const findings: Finding[] = [
    { check: "missing-justification", effect: "flag", message: "Reason is short." },
  ];
  const p = packet({ findings });
  assert.equal(p.rule.sourceCidr, "203.0.113.10/32");
  assert.equal(p.rule.durationMinutes, 120);
  assert.equal(p.requester.name, "Mara Chen");
  assert.equal(p.requester.tenureBand, "3+ years");
  assert.deepEqual(p.requester.adGroups, [
    "platform-engineering",
    "prod-ssh-access",
    "on-call-platform",
  ]);
  assert.equal(p.requester.requests, 6);
  assert.equal(p.requester.cleanExpiries, 5);
  assert.deepEqual(p.findings, findings);
  assert.deepEqual(p.gaps, []);
});

test("packet records the live group state as a count and ids", () => {
  const p = packet({
    existing: [
      { id: "tcp:22-22:203.0.113.20/32", sourceCidr: "203.0.113.20/32", protocol: "tcp", fromPort: 22, toPort: 22 },
    ],
  });
  assert.equal(p.existingRules.count, 1);
  assert.deepEqual(p.existingRules.ids, ["tcp:22-22:203.0.113.20/32"]);
});

test("packet names the gap when the profile is missing", () => {
  const p = packet({ requesterId: "nobody", profile: undefined });
  assert.equal(p.requester.name, "Unknown requester");
  assert.equal(p.requester.tenureBand, "unknown");
  assert.deepEqual(p.gaps, ["No profile found for requester nobody."]);
});

test("packet defaults to the demo test target and accepts an override", () => {
  assert.equal(packet().destination.label, "prod bastion (demo test group)");
  const p = packet({
    destination: {
      environment: "production",
      label: "prod database",
      sensitivity: "Customer data. Direct access is unusual.",
    },
  });
  assert.equal(p.destination.environment, "production");
  assert.equal(p.destination.label, "prod database");
});

test("cost math matches the Gateway list prices", () => {
  // Kimi: 1000 in at $0.60/M is $0.0006, 500 out at $3/M is $0.0015.
  assert.equal(reviewCostUsd(KIMI, 1000, 500), 0.0021);
  // Astra: 1000 in at $10/M is $0.01, 500 out at $50/M is $0.025.
  assert.equal(reviewCostUsd(ASTRA, 1000, 500), 0.035);
  assert.equal(reviewCostUsd(KIMI, 0, 0), 0);
});

test("prompt carries the packet and the block rule, with no em dashes", () => {
  const prompt = advicePrompt(packet());
  assert.match(prompt, /Mara Chen/);
  assert.match(prompt, /203\.0\.113\.10\/32/);
  assert.match(prompt, /A blocked request is never approvable/);
  assert.match(prompt, /word for word/);
  assert.doesNotMatch(prompt, /—|–/);
});
