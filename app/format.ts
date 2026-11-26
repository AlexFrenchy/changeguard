// Small display helpers shared by the requester and review pages.

export function durationLabel(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
}

export function ruleLabel(rule: {
  protocol: string;
  fromPort: number;
  toPort: number;
  sourceCidr: string;
}): string {
  const ports =
    rule.fromPort === rule.toPort
      ? `${rule.fromPort}`
      : `${rule.fromPort}-${rule.toPort}`;
  return `${rule.protocol} ${ports} from ${rule.sourceCidr}`;
}
