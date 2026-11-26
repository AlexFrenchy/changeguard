import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCidr } from "./aws.ts";

// AWS stores a CIDR by its network address. The adapter normalizes first,
// so a host-bit CIDR like 110.101.0.1/24 becomes 110.101.0.0/24 everywhere
// and the read-back can find the rule it just applied.
test("normalizeCidr masks host bits to the network address", () => {
  assert.equal(normalizeCidr("110.101.0.1/24"), "110.101.0.0/24");
  assert.equal(normalizeCidr("100.101.0.1/24"), "100.101.0.0/24");
  assert.equal(normalizeCidr("10.0.0.200/25"), "10.0.0.128/25");
  assert.equal(normalizeCidr("192.168.1.1/16"), "192.168.0.0/16");
  assert.equal(normalizeCidr("0.0.0.1/0"), "0.0.0.0/0");
});

test("normalizeCidr leaves network addresses and /32s unchanged", () => {
  assert.equal(normalizeCidr("203.0.113.10/32"), "203.0.113.10/32");
  assert.equal(normalizeCidr("0.0.0.0/0"), "0.0.0.0/0");
  assert.equal(normalizeCidr("110.101.0.0/24"), "110.101.0.0/24");
});

test("normalizeCidr passes through anything that is not an IPv4 CIDR", () => {
  assert.equal(normalizeCidr("not-a-cidr"), "not-a-cidr");
  assert.equal(normalizeCidr("999.1.1.1/24"), "999.1.1.1/24");
  assert.equal(normalizeCidr("10.0.0.1/33"), "10.0.0.1/33");
  assert.equal(normalizeCidr("::/0"), "::/0");
});
