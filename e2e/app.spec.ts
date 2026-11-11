import { test, expect, request, type Page } from "@playwright/test";

const EMAIL = "santiago@clickuppp.dev";
const PASSWORD = "password";

async function login(page: Page, email = EMAIL) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Log In" }).click();
  // after login the app lands on Home ("My Work")
  await page.waitForURL(/\/home/);
}

test("redirects to /login when unauthenticated", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Log In" })).toBeVisible();
});

test("rejects bad credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.locator('input[type="password"]').fill("wrongpassword");
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(page.getByText(/Invalid email or password/i)).toBeVisible();
});

test("logs in and renders the workspace", async ({ page }) => {
  await login(page);
  // sidebar spaces from the seed
  await expect(page.getByText("Product").first()).toBeVisible();
  // a seeded list
  await expect(page.getByText("Backlog").first()).toBeVisible();
});

test("creates a task that appears in the list", async ({ page }) => {
  await login(page);
  // open a list first (Home has no task composer); scope to the sidebar so we
  // don't match a "Backlog" list chip on a Home task row
  await page.locator("aside").getByText("Backlog", { exact: true }).click();
  await page.waitForURL(/\/l\//);
  const name = `E2E task ${Date.now()}`;
  await page.getByRole("button", { name: "Add Task" }).first().click();
  await page.getByPlaceholder("Task name").fill(name);
  await page.keyboard.press("Enter");
  await expect(page.getByText(name)).toBeVisible();
});

test("opens the Home / My Work view after login", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
});

test("shows closed subtasks and reflects a teammate's changes without a reload", async ({ page, browser }) => {
  await login(page);
  await page.locator("aside").getByText("Backlog", { exact: true }).click();
  await page.waitForURL(/\/l\//);
  const listId = new URL(page.url()).pathname.split("/").at(-1);
  const listResponse = await page.request.get(`/api/lists/${listId}`);
  expect(listResponse.ok()).toBeTruthy();
  const { list } = await listResponse.json();
  const done = list.statuses.find((status: { type: string }) => status.type === "DONE");
  const closedResponse = await page.request.post(`/api/lists/${listId}/statuses`, {
    data: { name: `Closed ${Date.now()}`, color: "#22aa55", type: "CLOSED" },
  });
  expect(closedResponse.ok()).toBeTruthy();
  const closed = await closedResponse.json();

  async function createTask(name: string, parentId?: string, statusId?: string) {
    const response = await page.request.post("/api/tasks", { data: { name, listId, parentId, statusId } });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  const parent = await createTask(`Subtask visibility ${Date.now()}`);
  const open = await createTask("Open child", parent.id);
  await createTask("Done child", parent.id, done.id);
  await createTask("Closed child", parent.id, closed.id);

  await page.getByRole("button", { name: `Subtasks for ${parent.name}` }).click();
  await expect(page.getByText("Closed child", { exact: true })).toBeVisible();
  await page.getByText(parent.name, { exact: true }).click();
  const subtasks = page.getByRole("region", { name: "Subtasks" });
  await page.getByRole("button", { name: "Expand task window" }).click();
  await expect(page.getByRole("button", { name: "Restore task window" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Restore task window" }).click();
  const toggle = subtasks.getByRole("checkbox", { name: "Show closed subtasks" });
  await expect(toggle).toBeChecked();
  await expect(subtasks.getByText("2 of 3 closed")).toBeVisible();
  await subtasks.getByRole("button", { name: "Open child", exact: true }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Copy task link" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(subtasks.getByText("2 of 3 closed")).toBeVisible();
  await toggle.uncheck();
  await expect(subtasks.getByText("Done child")).toHaveCount(0);
  await expect(subtasks.getByText("Closed child")).toHaveCount(0);
  await expect(subtasks.getByText("Open child")).toBeVisible();

  const teammate = await browser.newPage();
  try {
    await login(teammate, "maya@clickuppp.dev");
    const update = await teammate.request.patch(`/api/tasks/${open.id}`, { data: { statusId: closed.id } });
    expect(update.ok()).toBeTruthy();
    await expect(subtasks.getByText("3 of 3 closed")).toBeVisible({ timeout: 8_000 });
    await expect(subtasks.getByText("All subtasks are closed.", { exact: false })).toBeVisible();
    await toggle.check();
    await expect(subtasks.getByRole("button", { name: "Open child", exact: true })).toBeVisible();

    const checklist = await teammate.request.post(`/api/tasks/${parent.id}/checklists`, {
      data: { name: "Teammate checklist" },
    });
    expect(checklist.ok()).toBeTruthy();
    await expect(page.getByText("Teammate checklist", { exact: true })).toBeVisible({ timeout: 8_000 });
  } finally {
    await teammate.close();
  }
});

test("edits task status from menus and finds tasks in custom views", async ({ page }) => {
  await login(page);
  await page.locator("aside").getByText("Backlog", { exact: true }).click();
  await page.waitForURL(/\/l\//);
  const listId = new URL(page.url()).pathname.split("/").at(-1);
  const name = `Menu task ${Date.now()}`;
  const task = await page.request.post("/api/tasks", { data: { listId, name } });
  expect(task.ok()).toBeTruthy();

  await page.getByText(name, { exact: true }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Copy task link" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Close task", exact: true }).click();
  const circle = page.getByRole("button", { name: `Change status for ${name}` });
  await expect(circle).toHaveAttribute("title", /Change status: (COMPLETE|Closed)/i);
  await circle.click();
  await page.getByRole("menuitem", { name: "Reopen task" }).click();
  await expect(circle).toHaveAttribute("title", /TO DO/i);

  for (const view of ["Board", "Table"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await page.getByText(name, { exact: true }).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Set priority" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Search this list" }).click();
  await page.getByRole("textbox", { name: "Search tasks and subtasks" }).fill("missing search term");
  await expect(page.getByText("No tasks match your filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel("Completion").selectOption("closed");
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add view" }).click();
  await page.getByLabel("View name").fill("Triage");
  await page.getByRole("button", { name: "Create view" }).click();
  await expect(page.getByRole("button", { name: "Triage", exact: true })).toBeVisible();
});

test("creates, scopes, and revokes personal API tokens", async ({ page, baseURL }) => {
  await login(page);
  await page.getByRole("button", { name: /Santiago Cotto/ }).click();
  await page.getByRole("menuitem", { name: "API tokens" }).click();
  await page.getByLabel("Token name").fill("Read-only test");
  await page.getByRole("button", { name: "Create token" }).click();
  const secretField = page.getByLabel("Copy this token now.", { exact: false });
  await expect(secretField).toHaveValue(/^ocu_/);
  const readToken = await secretField.inputValue();
  const writeResponse = await page.request.post("/api/me/api-tokens", { data: { name: "Writer test", writable: true } });
  expect(writeResponse.ok()).toBeTruthy();
  const writeToken = await writeResponse.json();

  const api = await request.newContext({ baseURL });
  const read = { Authorization: `Bearer ${readToken}` };
  const write = { Authorization: `Bearer ${writeToken.token}` };
  try {
    const response = await api.get("/api/bootstrap", { headers: read });
    expect(response.ok()).toBeTruthy();
    const { workspace } = await response.json();
    const list = workspace.spaces.flatMap((space: { lists: { id: string }[] }) => space.lists)[0];
    expect((await api.post("/api/tasks", { headers: read, data: { listId: list.id, name: "Blocked" } })).status()).toBe(403);
    const created = await api.post("/api/tasks", { headers: write, data: { listId: list.id, name: "Created by integration" } });
    expect(created.status()).toBe(201);
    const task = await created.json();
    const taskUrl = `/api/tasks/${task.id}`;
    expect((await api.get(taskUrl)).status()).toBe(401);
    expect((await api.get(taskUrl, { headers: read })).ok()).toBeTruthy();
    expect((await api.patch(taskUrl, { headers: write, data: { name: "Updated by integration" } })).ok()).toBeTruthy();
    expect((await api.post("/api/me/api-tokens", { headers: write, data: { name: "Nested token" } })).status()).toBe(401);
    const listResponse = await page.request.get("/api/me/api-tokens");
    expect(await listResponse.text()).not.toContain(readToken);
    await page.getByRole("button", { name: "Revoke Read-only test" }).click();
    await expect(page.getByRole("button", { name: "Revoke Read-only test" })).toHaveCount(0);
    expect((await api.get(taskUrl, { headers: read })).status()).toBe(401);
  } finally {
    await page.request.delete("/api/me/api-tokens", { data: { id: writeToken.id } });
    await api.dispose();
  }
});
