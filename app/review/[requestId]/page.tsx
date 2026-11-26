import { Suspense } from "react";
import { ReviewContent } from "./review-content";

// The review page is dynamic by nature: the request id comes from the URL
// and every section reads live data. It must not be prerendered.
export const instant = false;

export default function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ runId?: string }>;
}) {
  return (
    <Suspense>
      <ReviewContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
