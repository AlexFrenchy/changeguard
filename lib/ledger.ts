// The Blob ledger. One request record per request, one advice record per
// request, both private. The review page reads them while the run waits for
// approval; the workflow writes the advice record right after the AI step.
// Auth is the deployment OIDC token: the store is connected in OIDC
// credential mode, so there is no static token anywhere.
import { get, put } from "@vercel/blob";
import { getVercelOidcToken } from "@vercel/oidc";
import type { Advice, PacketDestination } from "./ai";
import type { Finding } from "./checks";

export interface LedgerRequest {
  requestId: string;
  requesterId: string;
  sourceCidr: string;
  protocol: string;
  fromPort: number;
  toPort: number;
  durationMinutes: number;
  reason: string;
  destination?: PacketDestination;
  createdAt: string;
}

export interface AdviceRecord {
  requestId: string;
  request: LedgerRequest;
  findings: Finding[];
  advice: Advice;
}

const ADVICE_PREFIX = "advice/";
const REQUEST_PREFIX = "requests/";

async function writeJson(pathname: string, data: unknown): Promise<void> {
  // allowOverwrite makes the write idempotent: a retried workflow step
  // rewrites the same record instead of failing on a duplicate.
  await put(pathname, JSON.stringify(data), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    oidcToken: await getVercelOidcToken(),
  });
}

async function readJson<T>(pathname: string): Promise<T | null> {
  const result = await get(pathname, {
    access: "private",
    useCache: false,
    oidcToken: await getVercelOidcToken(),
  });
  if (!result) return null;
  return JSON.parse(await new Response(result.stream).text()) as T;
}

export async function writeRequestRecord(record: LedgerRequest): Promise<void> {
  await writeJson(`${REQUEST_PREFIX}${record.requestId}.json`, record);
}

export async function readRequestRecord(
  requestId: string,
): Promise<LedgerRequest | null> {
  return readJson<LedgerRequest>(`${REQUEST_PREFIX}${requestId}.json`);
}

export async function writeAdviceRecord(record: AdviceRecord): Promise<void> {
  await writeJson(`${ADVICE_PREFIX}${record.requestId}.json`, record);
}

export async function readAdviceRecord(
  requestId: string,
): Promise<AdviceRecord | null> {
  return readJson<AdviceRecord>(`${ADVICE_PREFIX}${requestId}.json`);
}
