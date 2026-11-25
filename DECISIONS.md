# Decisions

A short log of the decisions behind Changeguard. Each entry states the
decision, why it was made, and what was considered and rejected. Entries are
added as decisions are made. This log is part of the submission: it is how
the commit history shows the thinking, not just the code.

<!-- Entry format:
## N: Title (YYYY-MM-DD)
Decision: ...
Why: ...
Alternatives considered: ...
-->

## 1: Do not pass an audience to awsCredentialsProvider (2026-11-25)
Decision: call awsCredentialsProvider with the role ARN only and rely on the default OIDC token, which already carries the team audience (https://vercel.com/cardigans).
Why: the first spike run passed the audience explicitly and Vercel's token exchange rejected it with "Invalid audience". The default token already has the team audience, which is exactly what the IdP and the trust policy expect, so no exchange is needed. Removing the option made the spike pass on the next run (rule added, read back, removed, read back absent).
Alternatives considered: passing the audience explicitly (rejected, proven to fail at the Vercel exchange, before AWS is ever reached); switching the IdP and trust policy to sts.amazonaws.com (rejected, the team audience is correct and already in place, and the failure was not on the AWS side).

## 2: Deterministic checks reconciled to eight (2026-11-25)
Decision: the v1 rulebook is eight checks: open to the world (BLOCK), risky port with a broad source (BLOCK or ESCALATE), over-broad range (ESCALATE), no expiry (BLOCK), excessive duration (ESCALATE), overlapping rule (FLAG), shadowed or redundant (RETURN), missing justification (FLAG). Self-approval is a workflow-enforced rule, not a check.
Why: the training doc (19 pp., 2026-11-23) and the HLD disagreed, the training doc listed self-approval and no-expiry but dropped over-broad range; the HLD listed seven named checks while claiming eight. The code (lib/checks.ts) can only implement one list, so this is the single source of truth.
Alternatives considered: keeping self-approval as a check (rejected, it is enforced by the Workflow refusing requester = approver, not by a pure function over the request); folding no-expiry into excessive duration (rejected, a missing end time BLOCKs, a too-long window ESCALATEs; different effects).
