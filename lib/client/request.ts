/** Interpret untrusted error responses without rendering arbitrary JSON values. */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null || !("error" in body))
    return fallback;
  const error = body.error;
  if (typeof error === "string" && error.trim()) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  )
    return error.message;
  return fallback;
}
