import { test, expect, type Page, type TestInfo } from "@playwright/test";

async function openNavigation(page: Page) {
  const trigger = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (await trigger.isVisible()) await trigger.click();
}
async function startFresh(page: Page) {
  await openNavigation(page);
  await page.locator("button.new-chat").filter({ visible: true }).click();
  await expect(
    page.getByRole("heading", { name: "What are you working on?" }),
  ).toBeVisible();
}
async function sendQuestion(page: Page, question: string) {
  const count = await page.locator("article.message.assistant").count();
  await page
    .getByRole("textbox", { name: "Ask Recall a question" })
    .fill(question);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/chat") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(page.locator("article.message.assistant")).toHaveCount(
    count + 1,
  );
  await expect(page.locator("article.message.assistant").last()).toContainText(
    "Offline demo",
  );
  await expect(page.getByRole("button", { name: "Stop research" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("textbox", { name: "Ask Recall a question" }),
  ).toBeEditable();
}
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

const hydrationErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  hydrationErrors.set(page, errors);
  // React reports recoverable hydration mismatches through console.error,
  // not pageerror. Expected HTTP 409/503 resource logs are deliberately excluded.
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydrat|server[- ]rendered|did not match|text content does not match|Minified React error #(?:418|423|425)/i.test(
        message.text(),
      )
    ) {
      errors.push(message.text());
    }
  });
  await page.goto("/");
  await expect(
    page.getByText("Demo mode · No live AI or search.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("button.suggestion-row").first()).toBeEnabled();
  // Each test uses a new browser context. Local demo storage is server-wide, so
  // prompts carry unique tokens and no test assumes a globally empty history.
});

test.afterEach(async ({ page }) => {
  expect(hydrationErrors.get(page) ?? [], "React hydration errors").toEqual([]);
  expect((await page.pageErrors()).map((error) => error.message)).toEqual([]);
});

test("real demo starts with editorial welcome and captures viewport layouts", async ({
  page,
}, info) => {
  await expect(page).toHaveTitle("Recall — Research, with a memory");
  await expect(
    page.getByRole("heading", { name: "What are you working on?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Ask Recall a question" }),
  ).toHaveAttribute("placeholder", "Ask anything. Pick up where you left off.");
  await expect(
    page.getByRole("button", { name: "Send question", exact: true }),
  ).toBeDisabled();
  const status = await page.request.get("/api/status");
  expect(await status.json()).toMatchObject({
    mode: "demo",
    storage: "memory",
    auth: "local",
  });
  await expect(page.locator(".source-card")).toHaveCount(0);
  await capture(page, info, "welcome");
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.page).toBeLessThanOrEqual(widths.viewport);
});

test("creates a real conversation, receives SSE answer, and reloads persisted messages", async ({
  page,
}, info) => {
  const question = `orbital${Date.now()} Compare database approaches for a small team`;
  await sendQuestion(page, question);
  await expect(page.locator("article.message.user")).toContainText(question);
  await expect(page.locator("article.message.assistant")).toContainText(
    "No external services were called.",
  );
  await expect(page.locator(".source-card")).toHaveCount(0);
  await capture(page, info, "conversation");
  await page.reload();
  await openNavigation(page);
  await page
    .getByRole("button", { name: question, exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.locator("article.message.user")).toContainText(question);
  await expect(page.locator("article.message.assistant")).toContainText(
    "Offline demo",
  );
});

test("switches history, searches titles, and recalls a prior timestamped question", async ({
  page,
}, info) => {
  const token = `cobalt${Date.now()}`;
  const question = token;
  await sendQuestion(page, question);
  await startFresh(page);
  await sendQuestion(page, `Find ${token}`);
  await expect(page.locator("article.message.assistant").last()).toContainText(
    "I found a saved question from",
  );
  await expect(page.locator("article.message.assistant").last()).toContainText(
    question,
  );
  await openNavigation(page);
  const search = page
    .getByRole("textbox", { name: "Search conversations" })
    .filter({ visible: true });
  await search.fill(question);
  const target = page
    .getByRole("button", { name: question, exact: true })
    .filter({ visible: true });
  await expect(target).toBeVisible();
  await target.click();
  await expect(page.locator("article.message.user")).toHaveCount(1);
  await expect(page.locator("article.message.user .prose")).toHaveText(
    question,
  );
  await expect(page.locator("article.message.assistant")).not.toContainText(
    "I found a saved question from",
  );
  await capture(page, info, "restored-history");
});

test("starter prompt, Shift+Enter newline, and Enter submit work from the keyboard", async ({
  page,
}) => {
  const suggestion = page.locator("button.suggestion-row").first();
  const prompt = await suggestion.getAttribute("aria-label");
  await suggestion.click();
  const input = page.getByRole("textbox", { name: "Ask Recall a question" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(prompt ?? "");
  await input.fill(`keyboard${Date.now()}`);
  await input.press("End");
  await input.press("Shift+Enter");
  await input.press("x");
  await expect(input).toHaveValue(/\nx$/);
  await expect(page.locator("article.message")).toHaveCount(0);
  await input.press("Enter");
  await expect(page.locator("article.message.assistant")).toContainText(
    "Offline demo",
  );
  await expect(input).toHaveValue("");
});

test("about dialog has an accessible name, traps focus, and closes with Escape", async ({
  page,
}) => {
  await openNavigation(page);
  const about = page.locator("button.about-button").filter({ visible: true });
  await about.click();
  const dialog = page.getByRole("dialog", { name: "Research, with a memory." });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-describedby", /.+/);
  await expect(
    dialog.getByText("Live AI and web search are not enabled.", {
      exact: false,
    }),
  ).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(about).toBeFocused();
});

test("evidence panel can be opened, dismissed, and does not fabricate sources", async ({
  page,
}, info) => {
  const close = page.getByRole("button", { name: "Hide evidence panel" });
  if (await close.isVisible()) await close.click();
  await page.getByRole("button", { name: "Show evidence panel" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Research evidence",
    exact: true,
  });
  if (info.project.name.startsWith("mobile")) {
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("No sources yet")).toBeVisible();
    await capture(page, info, "evidence-drawer");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  } else {
    await expect(page.locator(".evidence-rail")).toBeVisible();
    await expect(dialog).toHaveCount(0);
  }
  await expect(page.locator(".source-card")).toHaveCount(0);
});

// This regression deliberately simulates an unavailable authenticated history
// endpoint; all conversation/stream tests above use the real local demo API.
test("setup status remains actionable when history cannot be authorized", async ({
  page,
}) => {
  await page.route("**/api/status", (route) =>
    route.fulfill({
      json: {
        mode: "setup",
        configured: false,
        model: "gpt-6-luna",
        timezone: "UTC",
        storage: "memory",
        auth: "required",
        missing: ["Hosted authentication"],
      },
    }),
  );
  await page.route("**/api/conversations", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Hosted authentication is not configured." },
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Set up your workspace" }),
  ).toBeVisible();
  await expect(
    page.getByText("Hosted authentication", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Ask Recall a question" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Send question", exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.error-banner[role="alert"]')).toContainText(
    "Hosted authentication is not configured.",
  );
});

test("rejected chat removes unsaved user bubble and retry creates only one turn", async ({
  page,
}) => {
  const question = `retry${Date.now()}`;
  await page.route(
    "**/api/chat",
    (route) =>
      route.fulfill({
        status: 409,
        json: { error: "Another turn is in progress." },
      }),
    { times: 1 },
  );
  await page
    .getByRole("textbox", { name: "Ask Recall a question" })
    .fill(question);
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(page.locator('.error-banner[role="alert"]')).toContainText(
    "Another turn is in progress.",
  );
  await expect(page.locator("article.message")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Ask Recall a question" }),
  ).toHaveValue(question);
  await sendQuestion(page, question);
  await expect(page.locator("article.message.user")).toHaveCount(1);
  await expect(page.locator("article.message.assistant")).toHaveCount(1);
});

test("partial stream error reconciles saved question and discards unpersisted answer", async ({
  page,
}) => {
  const question = `interrupted${Date.now()}`;
  await page.route("**/api/chat", async (route) => {
    const input = route.request().postDataJSON() as {
      conversationId: string;
      message: string;
    };
    // Simulate the authoritative storage state of an accepted turn whose model
    // failed after saving the question but before committing an assistant answer.
    await page.route(
      `**/api/conversations/${input.conversationId}`,
      (history) =>
        history.fulfill({
          json: {
            conversation: {
              id: input.conversationId,
              title: question,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            messages: [
              {
                id: 991,
                conversationId: input.conversationId,
                role: "user",
                content: question,
                createdAt: new Date().toISOString(),
                sources: [],
                metadata: {},
              },
            ],
          },
        }),
    );
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'event: delta\ndata: {"text":"Uncommitted partial answer"}\n\nevent: error\ndata: {"message":"Provider interrupted"}\n\n',
    });
  });
  await page
    .getByRole("textbox", { name: "Ask Recall a question" })
    .fill(question);
  const reconciliation = page.waitForResponse(
    (response) =>
      /\/api\/conversations\/[^/]+$/.test(response.url()) &&
      response.request().method() === "GET",
  );
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  expect((await reconciliation).status()).toBe(200);
  await expect(page.locator('.error-banner[role="alert"]')).toContainText(
    "Provider interrupted",
  );
  await expect(page.locator("article.message.user")).toHaveCount(1);
  await expect(page.locator("article.message.user .prose")).toHaveText(
    question,
  );
  await expect(page.locator("article.message.assistant")).toHaveCount(0);
  await expect(page.getByText("Uncommitted partial answer")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Ask Recall a question" }),
  ).toHaveValue(question);
  await expect(page.getByRole("button", { name: "Stop research" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Send question", exact: true }),
  ).toBeEnabled();
});

test("failed reconciliation keeps no optimistic turn and explains uncertain history", async ({
  page,
}) => {
  const question = `uncertain${Date.now()}`;
  await page.route("**/api/chat", async (route) => {
    const input = route.request().postDataJSON() as { conversationId: string };
    await page.route(
      `**/api/conversations/${input.conversationId}`,
      (history) =>
        history.fulfill({
          status: 503,
          json: { error: "Storage unavailable" },
        }),
    );
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'event: delta\ndata: {"text":"Unsaved fragment"}\n\nevent: error\ndata: {"message":"Provider interrupted"}\n\n',
    });
  });
  await page
    .getByRole("textbox", { name: "Ask Recall a question" })
    .fill(question);
  await page
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await expect(page.locator('.error-banner[role="alert"]')).toContainText(
    "Saved history could not be refreshed",
  );
  await expect(page.locator("article.message")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Ask Recall a question" }),
  ).toHaveValue(question);
  await expect(page.getByRole("button", { name: "Stop research" })).toHaveCount(
    0,
  );
});

test("appearance persists without hydration errors and system follows browser preference", async ({
  page,
}, info) => {
  const appearance = page.getByRole("combobox", { name: "Appearance" });
  await appearance.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await capture(page, info, "dark-workspace");
  await page.reload();
  await expect(appearance).toHaveValue("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await appearance.selectOption("light");
  await capture(page, info, "light-workspace");
  await appearance.selectOption("system");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).colorScheme),
  ).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  expect(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).colorScheme),
  ).toBe("light");
});

test("personalized direct prompts fill the composer without automatically sending", async ({
  page,
}) => {
  await page.route("**/api/suggestions", (route) =>
    route.fulfill({
      json: {
        personalized: true,
        suggestions: [
          {
            id: "history-topic",
            text: "Compare the PostgreSQL options from my earlier research",
            kind: "history",
            topic: "PostgreSQL",
          },
        ],
      },
    }),
  );
  await page.reload();
  const suggestion = page.getByRole("button", {
    name: "Compare the PostgreSQL options from my earlier research",
    exact: true,
  });
  await expect(suggestion).toBeVisible();
  await expect(
    page.getByText("From your conversations", { exact: true }),
  ).toBeVisible();
  let sends = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/chat"))
      sends++;
  });
  await suggestion.click();
  await expect(
    page.getByRole("textbox", { name: "Ask Recall a question" }),
  ).toHaveValue("Compare the PostgreSQL options from my earlier research");
  await expect(
    page.getByRole("textbox", { name: "Ask Recall a question" }),
  ).toBeFocused();
  expect(sends).toBe(0);
});

test("suggestion service failure leaves usable generic prompts", async ({
  page,
}) => {
  await page.route("**/api/suggestions", (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.reload();
  await expect(page.locator("button.suggestion-row")).toHaveCount(3);
  await page.locator("button.suggestion-row").first().click();
  await expect(
    page.getByRole("textbox", { name: "Ask Recall a question" }),
  ).not.toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Send question", exact: true }),
  ).toBeEnabled();
});

test("compact 390 by 520 viewport keeps prompts and composer reachable in both themes", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 520 });
  for (const theme of ["light", "dark"]) {
    await page
      .getByRole("combobox", { name: "Appearance" })
      .selectOption(theme);
    const composer = await page.locator("form.composer").boundingBox();
    expect(composer).not.toBeNull();
    expect(composer!.y).toBeGreaterThanOrEqual(0);
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(520);
    const rows = await page.locator(".suggestions").boundingBox();
    expect(rows).not.toBeNull();
    expect(rows!.y).toBeGreaterThanOrEqual(0);
    expect(rows!.y + rows!.height).toBeLessThanOrEqual(composer!.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await capture(page, info, `compact-${theme}`);
  }
});

test("invalid appearance cookie safely falls back to system on the server", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "recall-theme",
      value: "invalid-choice",
      url: "http://127.0.0.1:3100",
    },
  ]);
  const response = await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await expect(page.getByRole("combobox", { name: "Appearance" })).toHaveValue(
    "system",
  );
  expect(response?.headers()["cache-control"]).toMatch(/private|no-store/);
});

test("saved app research progressively supplies personal suggestions", async ({
  page,
}) => {
  await sendQuestion(
    page,
    "Explain PostgreSQL transaction isolation for a small app.",
  );
  await startFresh(page);
  await expect(
    page.getByText("From your conversations", { exact: true }),
  ).toBeVisible();
  const suggestion = page
    .locator("button.suggestion-row")
    .filter({ hasText: "PostgreSQL" });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(
    page.getByRole("textbox", { name: "Ask Recall a question" }),
  ).toHaveValue(/PostgreSQL/);
  await expect(page.locator("article.message")).toHaveCount(0);
});

for (const width of [390, 740]) {
  test(`keyboard-sized ${width} by 360 viewport keeps send controls in view`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 360 });
    for (const theme of ["light", "dark"]) {
      await page
        .getByRole("combobox", { name: "Appearance" })
        .selectOption(theme);
      for (const control of [
        page.getByRole("textbox", { name: "Ask Recall a question" }),
        page.getByRole("button", { name: "Send question", exact: true }),
      ]) {
        const bounds = await control.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(360);
      }
      await page.locator("button.suggestion-row").first().click();
      await expect(
        page.getByRole("textbox", { name: "Ask Recall a question" }),
      ).toBeFocused();
      await expect(
        page.getByRole("button", { name: "Send question", exact: true }),
      ).toBeEnabled();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await capture(page, info, `keyboard-${width}-${theme}`);
    }
  });
}
