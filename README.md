# Changeguard

Approval for firewall changes that expire on time, every time.

An engineer asks for temporary access. Deterministic code checks the obvious dangers. An AI reviews the full context, who is asking, their history, the destination, and advises only. A different person approves. The rule lands in a real AWS security group, and when the window ends, it removes itself.

## The boundary

Vercel orchestrates. AWS enforces. Changeguard never becomes the firewall. It becomes the trustworthy path to the firewall.

## Built on Vercel

- **Next.js**: requester and reviewer screens, API routes, live AWS read-back.
- **Workflows**: the approval wait and the timed removal, durable across crashes and deploys.
- **AI SDK + AI Gateway**: contextual risk advice from the assembled context packet, with failover and cost per review.

Persistence is the Blob ledger: one record per request.

## Stays on AWS

Security groups and traffic enforcement, identity, ticketing, and logs. No stored keys. OIDC federation only.

## Build plan

Seven slices, riskiest first, each committed separately:

0. Setup: public repo, Next.js scaffold, Vercel project linked.
1. Boundary spike: OIDC federation to AWS, add and remove one rule on the test security group. No UI.
2. Checks + context: the deterministic checks and the context packet.
3. Workflow: durable flow with human-approval wait and expiry sleep.
4. AI advice: AI SDK via Gateway, structured output, fallback model, cost shown.
5. Screens: requester and reviewer views on Geist, role switcher, live AWS read-back.
6. Harden, polish & write: README, polish pass, builder feedback, eval results, rehearsal.

## The eight checks

Level 1 is deterministic. Each check is a pure function over the request and the security group's current rules, read live with DescribeSecurityGroups at decision time.

1. Open to the world: source 0.0.0.0/0 or ::/0. BLOCK.
2. Risky port with a broad source: port 22, 3389, 23, or 445 from a public CIDR covering more than one address. ESCALATE.
3. Over-broad range: CIDR wider than /24, or a port range over 100 ports. ESCALATE.
4. No expiry: no end time set. BLOCK.
5. Excessive duration: window over 24 hours. ESCALATE.
6. Overlapping rule: partial overlap with a live rule, named by rule id. FLAG.
7. Shadowed or redundant: the access is already granted. RETURN, with a plain answer: you already have this access.
8. Missing justification: reason empty or under 10 characters. FLAG.

A blocked request never reaches the AI or a human. Self-approval is enforced by the Workflow, not a check: the approver must differ from the requester.

## Run it

Requires Node 24 and a Vercel project with the env vars below. The AWS boundary and the AI advice run on a Vercel deployment, where the deployment OIDC token exists; local dev serves the screens and the checks.

- npm install
- npm test
- npm run build
- npm run dev
- npx vercel --prod --yes

Env vars (production):

- AWS_ROLE_ARN: the IAM role the deployment assumes via OIDC.
- CHANGEGUARD_SG_ID: the one security group the role may change.
- AWS_REGION: the region of that security group (us-east-2 in the demo).
- CHANGEGUARD_MODEL and CHANGEGUARD_FALLBACK_MODEL: optional model overrides. Defaults are moonshotai/kimi-k2.5 and openai/gpt-6-astra.
- AI_GATEWAY_API_KEY: optional. The deployment OIDC token is the default credential path.

## Links

- Live demo: https://changeguard-flame.vercel.app
- Public repo: https://github.com/AlexFrenchy/changeguard
