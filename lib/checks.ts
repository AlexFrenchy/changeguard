// Level 1 deterministic checks. Each check is a pure function over the
// request and the security group's current rules: no AWS calls here, the
// caller reads live state with DescribeSecurityGroups and passes it in.
// A check returns a finding or null. The runner returns the findings in
// canonical order, checks 1 to 8.

export type CheckEffect = "block" | "escalate" | "flag" | "return";

export interface ChangeRequest {
  sourceCidr: string;
  protocol: string;
  fromPort: number;
  toPort: number;
  endsAt: Date | null;
  durationHours: number;
  reason: string;
}

export interface ExistingRule {
  id: string;
  sourceCidr: string;
  protocol: string;
  fromPort: number;
  toPort: number;
  description?: string;
}

export interface Finding {
  check: string;
  effect: CheckEffect;
  message: string;
}

type CheckFn = (
  request: ChangeRequest,
  existing: ExistingRule[],
) => Finding | null;

const RISKY_PORTS = [22, 3389, 23, 445];
const MAX_CIDR_PREFIX = 24;
const MAX_PORT_COUNT = 100;
const MAX_DURATION_HOURS = 24;
const MIN_REASON_LENGTH = 10;

interface ParsedCidr {
  version: 4 | 6;
  prefix: number;
  address: string;
}

function parseCidr(cidr: string): ParsedCidr | null {
  const trimmed = cidr.trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash <= 0) return null;
  const address = trimmed.slice(0, slash);
  const prefix = Number(trimmed.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0) return null;
  if (address.includes(":")) {
    if (prefix > 128) return null;
    return { version: 6, prefix, address };
  }
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  if (parts.some((p) => p === "" || !/^\d+$/.test(p) || Number(p) > 255)) {
    return null;
  }
  if (prefix > 32) return null;
  return { version: 4, prefix, address };
}

function ipv4ToInt(address: string): number {
  return address.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

function isPrivateIpv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 127 ||
    (a === 169 && b === 254)
  );
}

// A broad source is a public CIDR covering more than one address. Private
// ranges are the company's own network, not an external source, and a single
// host (/32) is not broad.
function isBroadSource(cidr: string): boolean {
  const parsed = parseCidr(cidr);
  if (!parsed) return false;
  if (parsed.version === 6) return parsed.prefix < 128;
  if (parsed.prefix >= 32) return false;
  return !isPrivateIpv4(parsed.address);
}

function ipv4Range(cidr: ParsedCidr): { start: number; end: number } | null {
  if (cidr.version !== 4) return null;
  const ip = ipv4ToInt(cidr.address);
  const hostBits = 32 - cidr.prefix;
  const mask =
    hostBits === 32 ? 0 : (0xffffffff << hostBits) >>> 0;
  const start = (ip & mask) >>> 0;
  const end = (start | ~mask) >>> 0;
  return { start, end };
}

// IPv6 is exact match only here, except ::/0 which contains everything.
// The demo is IPv4 first, so full IPv6 range math is out
// of scope for v1.
function cidrContains(outer: string, inner: string): boolean {
  if (outer.trim() === inner.trim()) return true;
  const o = parseCidr(outer);
  const i = parseCidr(inner);
  if (!o || !i || o.version !== i.version) return false;
  if (o.version === 6) return o.prefix === 0;
  const oRange = ipv4Range(o);
  const iRange = ipv4Range(i);
  if (!oRange || !iRange) return false;
  return oRange.start <= iRange.start && oRange.end >= iRange.end;
}

function cidrOverlaps(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const pa = parseCidr(a);
  const pb = parseCidr(b);
  if (!pa || !pb || pa.version !== pb.version) return false;
  if (pa.version === 6) return pa.prefix === 0 || pb.prefix === 0;
  const ra = ipv4Range(pa);
  const rb = ipv4Range(pb);
  if (!ra || !rb) return false;
  return ra.start <= rb.end && rb.start <= ra.end;
}

function protocolsMatch(a: string, b: string): boolean {
  const norm = (p: string) => (p === "-1" ? "all" : p.toLowerCase());
  const na = norm(a);
  const nb = norm(b);
  return na === "all" || nb === "all" || na === nb;
}

function portRangesOverlap(
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

function portRangeContains(
  outerFrom: number,
  outerTo: number,
  innerFrom: number,
  innerTo: number,
): boolean {
  return outerFrom <= innerFrom && outerTo >= innerTo;
}

function ruleContainsRequest(
  rule: ExistingRule,
  request: ChangeRequest,
): boolean {
  return (
    protocolsMatch(rule.protocol, request.protocol) &&
    cidrContains(rule.sourceCidr, request.sourceCidr) &&
    portRangeContains(rule.fromPort, rule.toPort, request.fromPort, request.toPort)
  );
}

export function checkOpenToWorld(request: ChangeRequest): Finding | null {
  const source = request.sourceCidr.trim();
  if (source !== "0.0.0.0/0" && source !== "::/0") return null;
  return {
    check: "open-to-world",
    effect: "block",
    message: `Source ${source} is open to the world.`,
  };
}

// The BLOCK case for this combination is the world open source, which check 1
// already blocks, so this check escalates the risky combination for a human.
export function checkRiskyPortBroadSource(
  request: ChangeRequest,
): Finding | null {
  const riskyPort = RISKY_PORTS.find(
    (port) => port >= request.fromPort && port <= request.toPort,
  );
  if (riskyPort === undefined) return null;
  if (!isBroadSource(request.sourceCidr)) return null;
  return {
    check: "risky-port-broad-source",
    effect: "escalate",
    message: `Risky port ${riskyPort} exposed to a broad source (${request.sourceCidr.trim()}).`,
  };
}

export function checkOverBroadRange(request: ChangeRequest): Finding | null {
  const parsed = parseCidr(request.sourceCidr);
  const cidrTooWide = parsed !== null && parsed.prefix < MAX_CIDR_PREFIX;
  const portCount = request.toPort - request.fromPort + 1;
  const portsTooWide = portCount > MAX_PORT_COUNT;
  if (!cidrTooWide && !portsTooWide) return null;
  const parts: string[] = [];
  if (cidrTooWide) parts.push("Source CIDR is wider than /24.");
  if (portsTooWide) {
    parts.push(`Port range covers ${portCount} ports, over the 100 port limit.`);
  }
  return {
    check: "over-broad-range",
    effect: "escalate",
    message: parts.join(" "),
  };
}

export function checkNoExpiry(request: ChangeRequest): Finding | null {
  if (request.endsAt !== null) return null;
  return {
    check: "no-expiry",
    effect: "block",
    message: "No end time set on a temporary rule.",
  };
}

export function checkExcessiveDuration(
  request: ChangeRequest,
): Finding | null {
  if (request.durationHours <= MAX_DURATION_HOURS) return null;
  return {
    check: "excessive-duration",
    effect: "escalate",
    message: `Requested window is ${request.durationHours} hours, over the 24 hour limit for a temporary rule.`,
  };
}

// Overlap means partial: a rule that fully contains the request is check 7's
// case, not this one, so the two checks never fire on the same rule.
export function checkOverlappingRule(
  request: ChangeRequest,
  existing: ExistingRule[],
): Finding | null {
  const overlapping = existing.filter(
    (rule) =>
      protocolsMatch(rule.protocol, request.protocol) &&
      cidrOverlaps(rule.sourceCidr, request.sourceCidr) &&
      portRangesOverlap(
        rule.fromPort,
        rule.toPort,
        request.fromPort,
        request.toPort,
      ) &&
      !ruleContainsRequest(rule, request),
  );
  if (overlapping.length === 0) return null;
  const ids = overlapping.map((rule) => rule.id).join(", ");
  return {
    check: "overlapping-rule",
    effect: "flag",
    message: `Partially overlaps existing rule(s): ${ids}.`,
  };
}

export function checkShadowedRedundant(
  request: ChangeRequest,
  existing: ExistingRule[],
): Finding | null {
  const covering = existing.filter((rule) =>
    ruleContainsRequest(rule, request),
  );
  if (covering.length === 0) return null;
  const ids = covering.map((rule) => rule.id).join(", ");
  return {
    check: "shadowed-redundant",
    effect: "return",
    message: `You already have this access (rule ${ids}).`,
  };
}

export function checkMissingJustification(
  request: ChangeRequest,
): Finding | null {
  if (request.reason.trim().length >= MIN_REASON_LENGTH) return null;
  return {
    check: "missing-justification",
    effect: "flag",
    message: "Reason is empty or under 10 characters.",
  };
}

// The checks in canonical order. The runner applies each one and keeps the
// findings, so a request can carry more than one finding at once.
const CHECKS: { run: CheckFn }[] = [
  { run: (request) => checkOpenToWorld(request) },
  { run: (request) => checkRiskyPortBroadSource(request) },
  { run: (request) => checkOverBroadRange(request) },
  { run: (request) => checkNoExpiry(request) },
  { run: (request) => checkExcessiveDuration(request) },
  { run: (request, existing) => checkOverlappingRule(request, existing) },
  { run: (request, existing) => checkShadowedRedundant(request, existing) },
  { run: (request) => checkMissingJustification(request) },
];

export function runChecks(
  request: ChangeRequest,
  existing: ExistingRule[] = [],
): Finding[] {
  const findings: Finding[] = [];
  for (const { run } of CHECKS) {
    const finding = run(request, existing);
    if (finding) findings.push(finding);
  }
  return findings;
}
