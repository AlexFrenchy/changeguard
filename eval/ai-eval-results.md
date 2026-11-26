# AI eval results

Date: 2026-11-25
Deployment: https://changeguard-akphhc0kf-cardigans.vercel.app
Model: moonshotai/kimi-k2.5
Pass: 11 / 12
Total cost: $0.016745
Seed rule removed at expiry: yes

| Case | Expected | Got | Model | Cost | Result |
| --- | --- | --- | --- | --- | --- |
| clean-ssh | low / approve | low / approve | moonshotai/kimi-k2.5 | $0.001526 | PASS |
| open-to-world | blocked | status blocked, advice absent | - | $0.000000 | PASS |
| rdp-external | high / deny | high / deny | moonshotai/kimi-k2.5 | $0.001381 | PASS |
| broad-range | high / ask | high / deny | moonshotai/kimi-k2.5 | $0.001668 | FAIL |
| long-duration | medium / ask | medium / ask | moonshotai/kimi-k2.5 | $0.001625 | PASS |
| overlap | medium / ask | medium / ask | moonshotai/kimi-k2.5 | $0.001656 | PASS |
| shadow | low / deny | low / deny | moonshotai/kimi-k2.5 | $0.001279 | PASS |
| vague-reason | low / ask | low / ask | moonshotai/kimi-k2.5 | $0.001259 | PASS |
| benign-web | low / approve | low / approve | moonshotai/kimi-k2.5 | $0.001357 | PASS |
| trap-new-joiner | medium / ask | medium / ask | moonshotai/kimi-k2.5 | $0.001382 | PASS |
| trap-first-prod | medium / ask | medium / ask | moonshotai/kimi-k2.5 | $0.001780 | PASS |
| trap-wrong-destination | medium / ask | medium / ask | moonshotai/kimi-k2.5 | $0.001831 | PASS |

## Notes

- Every case is denied after the advice step, so no case applies a rule.
- The blocked case asserts the advice is absent, never approvable.
- The overlap and shadow cases run against the seed rule 203.0.113.20/32, applied by its own run and removed at expiry.
