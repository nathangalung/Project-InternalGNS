import type { ProblemDetail } from "@/types/api"

// Problem body for tests.
export function problem(status: number, over: Partial<ProblemDetail> = {}): ProblemDetail {
  return { type: "about:blank", title: "Error", status, ...over }
}
