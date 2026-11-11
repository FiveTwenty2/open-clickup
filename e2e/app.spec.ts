import { test, expect, type Page } from "@playwright/test";

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
  const toggle = subtasks.getByRole("checkbox", { name: "Show closed subtasks" });
  await expect(toggle).toBeChecked();
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
    await expect(subtasks.getByRole("button", { name: /Open child/ })).toBeVisible();

    const checklist = await teammate.request.post(`/api/tasks/${parent.id}/checklists`, {
      data: { name: "Teammate checklist" },
    });
    expect(checklist.ok()).toBeTruthy();
    await expect(page.getByText("Teammate checklist", { exact: true })).toBeVisible({ timeout: 8_000 });
  } finally {
    await teammate.close();
  }
});
