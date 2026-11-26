"use client";

import { DEMO_PROFILES } from "@/lib/context";

// The demo identity switcher. Labelled, not auth: the demo has no login, so
// the person acting is picked here. The choice is kept in localStorage by the
// page that uses it, so the requester page and the review page agree on who
// is acting.
export function RoleSwitcher({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-zinc-950">{label}</span>
        <span className="text-xs text-zinc-500">Demo identity, not a login</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {DEMO_PROFILES.map((profile) => {
          const selected = profile.id === value;
          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => onChange(profile.id)}
              aria-pressed={selected}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                selected
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-200 bg-white text-zinc-950 hover:border-zinc-400"
              }`}
            >
              <span className="block text-sm font-medium">{profile.name}</span>
              <span
                className={`block text-xs ${selected ? "text-zinc-300" : "text-zinc-500"}`}
              >
                {profile.team}, {profile.tenureBand}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
