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
