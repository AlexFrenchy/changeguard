# Changeguard

Approval for firewall changes that expire on time, every time.

An engineer asks for temporary access. Deterministic code checks the obvious dangers. An AI reviews the full context — who is asking, their history, the destination — and advises only. A different person approves. The rule lands in a real AWS security group, and when the window ends, it removes itself.

## The boundary

Vercel orchestrates. AWS enforces. Changeguard never becomes the firewall — it becomes the trustworthy path to the firewall.

## Built on Vercel

- **Next.js** — requester and reviewer screens, API routes, live AWS read-back.
- **Workflows** — the approval wait and the timed removal, durable across crashes and deploys.
- **AI SDK + AI Gateway** — contextual risk advice from the assembled context packet, with failover and cost per review.

Persistence is the Blob ledger: one record per request.

## Stays on AWS

Security groups and traffic enforcement, identity, ticketing, and logs. No stored keys — OIDC federation only.

## Build plan

Seven slices, riskiest first, each committed separately:

0. Setup — public repo, Next.js scaffold, Vercel project linked.
1. Boundary spike — OIDC federation to AWS, add and remove one rule on the test security group. No UI.
2. Checks + context — the deterministic checks and the context packet.
3. Workflow — durable flow with human-approval wait and expiry sleep.
4. AI advice — AI SDK via Gateway, structured output, fallback model, cost shown.
5. Screens — requester and reviewer views on Geist, role switcher, live AWS read-back.
6. Harden, polish & write — README, polish pass, builder feedback, eval results, rehearsal.

## Links

- Live demo: [to add at build]
- Public repo: https://github.com/AlexFrenchy/changeguard
