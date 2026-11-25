// Tests for lib/checks.ts. Run with: npm test
// Node's built-in test runner, no test framework dependency. The file
// imports ./checks.ts directly, which Node 24 runs with type stripping;
// tsc accepts the .ts extension because allowImportingTsExtensions is set.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkExcessiveDuration,
  checkMissingJustification,
  checkNoExpiry,
  checkOpenToWorld,
  checkOverBroadRange,
  checkOverlappingRule,
  checkRiskyPortBroadSource,
  checkShadowedRedundant,
  runChecks,
  type ChangeRequest,
  type ExistingRule,
} from "./checks.ts";

const baseRequest: ChangeRequest = {
  sourceCidr: "203.0.113.10/32",
  protocol: "tcp",
  fromPort: 22,
  toPort: 22,
  endsAt: new Date("2026-11-25T20:00:00Z"),
  durationHours: 2,
  reason: "Debug the prod checkout outage.",
};

function request(overrides: Partial<ChangeRequest>): ChangeRequest {
  return { ...baseRequest, ...overrides };
}

const existing: ExistingRule[] = [
  {
    id: "sgr-aaa",
    sourceCidr: "203.0.113.0/24",
    protocol: "tcp",
    fromPort: 22,
    toPort: 22,
  },
  {
    id: "sgr-bbb",
    sourceCidr: "10.0.0.0/16",
    protocol: "tcp",
    fromPort: 443,
    toPort: 443,
  },
];

test("check 1 blocks 0.0.0.0/0", () => {
  const finding = checkOpenToWorld(request({ sourceCidr: "0.0.0.0/0" }));
  assert.equal(finding?.effect, "block");
  assert.equal(finding?.check, "open-to-world");
});

test("check 1 blocks ::/0", () => {
  const finding = checkOpenToWorld(request({ sourceCidr: "::/0" }));
  assert.equal(finding?.effect, "block");
});

test("check 1 passes a single host", () => {
  assert.equal(checkOpenToWorld(request({})), null);
});

test("check 2 escalates a risky port from a broad public source", () => {
  const finding = checkRiskyPortBroadSource(
    request({ sourceCidr: "203.0.113.0/24" }),
  );
  assert.equal(finding?.effect, "escalate");
  assert.equal(finding?.check, "risky-port-broad-source");
});

test("check 2 passes a risky port from a single host", () => {
  assert.equal(checkRiskyPortBroadSource(request({})), null);
});

test("check 2 passes a risky port from a private range", () => {
  assert.equal(
    checkRiskyPortBroadSource(request({ sourceCidr: "10.0.0.0/16" })),
    null,
  );
});

test("check 2 passes a safe port from a broad source", () => {
  assert.equal(
    checkRiskyPortBroadSource(
      request({ sourceCidr: "203.0.113.0/24", fromPort: 443, toPort: 443 }),
    ),
    null,
  );
});

test("check 2 fires for 3389 from a broad source", () => {
  const finding = checkRiskyPortBroadSource(
    request({ sourceCidr: "203.0.113.0/24", fromPort: 3389, toPort: 3389 }),
  );
  assert.equal(finding?.effect, "escalate");
});

test("check 3 escalates a CIDR wider than /24", () => {
  const finding = checkOverBroadRange(request({ sourceCidr: "203.0.113.0/23" }));
  assert.equal(finding?.effect, "escalate");
});

test("check 3 passes a /24 exactly", () => {
  assert.equal(
    checkOverBroadRange(request({ sourceCidr: "203.0.113.0/24" })),
    null,
  );
});

test("check 3 escalates a port range over 100 ports", () => {
  const finding = checkOverBroadRange(
    request({ fromPort: 8000, toPort: 8100 }),
  );
  assert.equal(finding?.effect, "escalate");
});

test("check 3 passes a port range of exactly 100 ports", () => {
  assert.equal(
    checkOverBroadRange(request({ fromPort: 8000, toPort: 8099 })),
    null,
  );
});

test("check 4 blocks a request with no end time", () => {
  const finding = checkNoExpiry(request({ endsAt: null }));
  assert.equal(finding?.effect, "block");
  assert.equal(finding?.check, "no-expiry");
});

test("check 4 passes a request with an end time", () => {
  assert.equal(checkNoExpiry(request({})), null);
});

test("check 5 escalates a window over 24 hours", () => {
  const finding = checkExcessiveDuration(request({ durationHours: 25 }));
  assert.equal(finding?.effect, "escalate");
  assert.equal(finding?.check, "excessive-duration");
});

test("check 5 passes a window of exactly 24 hours", () => {
  assert.equal(checkExcessiveDuration(request({ durationHours: 24 })), null);
});

test("check 6 flags a partial CIDR overlap and names the rule", () => {
  const finding = checkOverlappingRule(
    request({ sourceCidr: "203.0.113.0/23" }),
    existing,
  );
  assert.equal(finding?.effect, "flag");
  assert.match(finding?.message ?? "", /sgr-aaa/);
});

test("check 6 flags a partial port overlap", () => {
  const finding = checkOverlappingRule(
    request({ fromPort: 22, toPort: 23 }),
    existing,
  );
  assert.equal(finding?.effect, "flag");
  assert.match(finding?.message ?? "", /sgr-aaa/);
});

test("check 6 passes when there is no overlap", () => {
  assert.equal(
    checkOverlappingRule(request({ sourceCidr: "198.51.100.5/32" }), existing),
    null,
  );
});

test("check 6 passes for a different protocol", () => {
  assert.equal(
    checkOverlappingRule(request({ protocol: "udp" }), existing),
    null,
  );
});

test("check 6 does not fire on a rule that fully contains the request", () => {
  assert.equal(checkOverlappingRule(request({}), existing), null);
});

test("check 7 returns when the access is already granted", () => {
  const finding = checkShadowedRedundant(request({}), existing);
  assert.equal(finding?.effect, "return");
  assert.match(finding?.message ?? "", /already have this access/);
  assert.match(finding?.message ?? "", /sgr-aaa/);
});

test("check 7 returns for an exact duplicate rule", () => {
  const finding = checkShadowedRedundant(
    request({ sourceCidr: "203.0.113.0/24" }),
    existing,
  );
  assert.equal(finding?.effect, "return");
});

test("check 7 returns when an all protocol rule covers the request", () => {
  const allRule: ExistingRule[] = [
    {
      id: "sgr-all",
      sourceCidr: "203.0.113.0/24",
      protocol: "all",
      fromPort: 0,
      toPort: 65535,
    },
  ];
  const finding = checkShadowedRedundant(request({}), allRule);
  assert.equal(finding?.effect, "return");
});

test("check 7 passes for a partial overlap", () => {
  assert.equal(
    checkShadowedRedundant(request({ sourceCidr: "203.0.113.0/23" }), existing),
    null,
  );
});

test("check 7 passes when there is no covering rule", () => {
  assert.equal(
    checkShadowedRedundant(request({ sourceCidr: "198.51.100.5/32" }), existing),
    null,
  );
});

test("check 8 flags an empty reason", () => {
  const finding = checkMissingJustification(request({ reason: "" }));
  assert.equal(finding?.effect, "flag");
  assert.equal(finding?.check, "missing-justification");
});

test("check 8 flags a reason under 10 characters", () => {
  const finding = checkMissingJustification(request({ reason: "need ssh" }));
  assert.equal(finding?.effect, "flag");
});

test("check 8 flags a whitespace only reason", () => {
  const finding = checkMissingJustification(request({ reason: "          " }));
  assert.equal(finding?.effect, "flag");
});

test("check 8 passes a reason of exactly 10 characters", () => {
  assert.equal(
    checkMissingJustification(request({ reason: "debug prod" })),
    null,
  );
});

test("runner returns no findings for a clean request", () => {
  // Port 443 from a single host: not a risky port, not covered by either
  // existing rule, so nothing fires even with live state passed in.
  assert.deepEqual(
    runChecks(request({ fromPort: 443, toPort: 443 }), existing),
    [],
  );
});

test("runner returns findings in canonical order", () => {
  const findings = runChecks(
    request({ sourceCidr: "0.0.0.0/0", endsAt: null, reason: "" }),
    existing,
  );
  // 0.0.0.0/0 also trips the risky port, over-broad range, and overlap
  // checks: the same request can carry more than one finding at once.
  assert.deepEqual(
    findings.map((f) => f.check),
    [
      "open-to-world",
      "risky-port-broad-source",
      "over-broad-range",
      "no-expiry",
      "overlapping-rule",
      "missing-justification",
    ],
  );
});

test("runner returns the shadowed finding without the overlap finding", () => {
  const findings = runChecks(request({}), existing);
  assert.deepEqual(
    findings.map((f) => f.check),
    ["shadowed-redundant"],
  );
});
