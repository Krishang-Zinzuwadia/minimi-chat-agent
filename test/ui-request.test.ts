import test from "node:test";
import assert from "node:assert/strict";
import { apiErrorMessage } from "../lib/client/request";
test("extracts string and nested API errors", () => {
  assert.equal(
    apiErrorMessage({ error: "Unavailable" }, "Fallback"),
    "Unavailable",
  );
  assert.equal(
    apiErrorMessage({ error: { message: "Sign in required" } }, "Fallback"),
    "Sign in required",
  );
});
test("unexpected or empty error shapes never escape as renderable objects", () => {
  for (const body of [
    null,
    undefined,
    3,
    [],
    { error: {} },
    { error: { message: 4 } },
    { error: "" },
  ])
    assert.equal(apiErrorMessage(body, "Fallback"), "Fallback");
});
