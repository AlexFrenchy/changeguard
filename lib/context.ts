// Seeded demo profiles. Every profile is fictional, invented for the demo
// so the same rule from different requesters draws different AI advice in
// Slice 4. No real directory data is used anywhere in the demo. The four
// profiles cover the four context traps in the eval set: a repeat requester
// with a clean history, a new joiner whose groups do not cover prod, a
// first time requester asking for production, and a requester whose role
// does not match the destination.

export type TenureBand =
  | "under 3 months"
  | "3 to 12 months"
  | "1 to 2 years"
  | "3+ years";

export interface DemoProfile {
  id: string;
  name: string;
  tenureBand: TenureBand;
  team: string;
  adGroups: string[];
  history: {
    requests: number;
    approved: number;
    denied: number;
    cleanExpiries: number;
    recent: string[];
  };
}

export const DEMO_PROFILES: DemoProfile[] = [
  {
    // Repeat requester, clean history.
    id: "mara-chen",
    name: "Mara Chen",
    tenureBand: "3+ years",
    team: "Platform",
    adGroups: ["platform-engineering", "prod-ssh-access", "on-call-platform"],
    history: {
      requests: 6,
      approved: 6,
      denied: 0,
      cleanExpiries: 5,
      recent: [
        "SSH to prod bastion for 2 hours, approved, expired on time.",
        "SSH to prod bastion for 4 hours, approved, expired on time.",
      ],
    },
  },
  {
    // New joiner, no prod groups, no history.
    id: "jonas-weber",
    name: "Jonas Weber",
    tenureBand: "under 3 months",
    team: "Data",
    adGroups: ["data-team"],
    history: {
      requests: 0,
      approved: 0,
      denied: 0,
      cleanExpiries: 0,
      recent: [],
    },
  },
  {
    // First time asking for production; all past requests were staging.
    id: "sofia-rossi",
    name: "Sofia Rossi",
    tenureBand: "1 to 2 years",
    team: "Support",
    adGroups: ["support-team", "staging-access"],
    history: {
      requests: 4,
      approved: 4,
      denied: 0,
      cleanExpiries: 4,
      recent: [
        "SSH to staging for 2 hours, approved, expired on time.",
        "SSH to staging for 3 hours, approved, expired on time.",
      ],
    },
  },
  {
    // Growth role asking for the prod database; one prior denial.
    id: "lena-fischer",
    name: "Lena Fischer",
    tenureBand: "3 to 12 months",
    team: "Growth",
    adGroups: ["growth-team"],
    history: {
      requests: 1,
      approved: 0,
      denied: 1,
      cleanExpiries: 0,
      recent: [
        "SSH to the prod database for 8 hours, denied, no justification given.",
      ],
    },
  },
];

export function getDemoProfile(id: string): DemoProfile | undefined {
  return DEMO_PROFILES.find((profile) => profile.id === id);
}
