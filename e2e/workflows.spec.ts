import { expect, test, type Page } from "@playwright/test";

async function openBacklog(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill("santiago@clickuppp.dev");
  await page.locator('input[type="password"]').fill("password");
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/home");
  await page.locator("aside").getByText("Backlog", { exact: true }).click();
  await page.waitForURL(/\/l\//);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

test("archives in bulk on Board and restores trashed task trees", async ({ page }) => {
  const listId = await openBacklog(page);
  const name = `Recoverable work ${Date.now()}`;
  const root = await page.request.post("/api/tasks", { data: { listId, name } });
  expect(root.status()).toBe(201);
  const parent = await root.json();
  const childResponse = await page.request.post("/api/tasks", { data: { listId, name: "Recovery child", parentId: parent.id } });
  expect(childResponse.status()).toBe(201);
  const child = await childResponse.json();
  const grandchildResponse = await page.request.post("/api/tasks", { data: { listId, name: "Recovery grandchild", parentId: child.id } });
  expect(grandchildResponse.status()).toBe(201);
  const grandchild = await grandchildResponse.json();
  const roadMap = await page.locator("aside").getByRole("link", { name: "Roadmap", exact: true }).getAttribute("href");
  const destination = roadMap?.split("/").at(-1);
  expect(destination).toBeTruthy();
  expect((await page.request.post(`/api/tasks/${parent.id}/move`, { data: { listId: destination } })).ok()).toBeTruthy();
  const moved = await (await page.request.get(`/api/tasks/${grandchild.id}`)).json();
  expect(moved.listId).toBe(destination);
  expect(moved.parentId).toBe(child.id);
  await page.goto(roadMap!);
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("checkbox", { name: `Select ${name}` }).check({ force: true });
  await page.getByRole("button", { name: "Due date", exact: true }).click();
  await page.getByRole("menuitem", { name: "Tomorrow", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/tasks/${parent.id}`)).json()).dueDate).not.toBeNull();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Archive and Trash", exact: true }).click();
  await page.getByRole("button", { name: `Restore ${name}` }).click();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  expect((await page.request.delete(`/api/tasks/${parent.id}`)).ok()).toBeTruthy();
  expect((await page.request.get(`/api/tasks/${grandchild.id}`)).status()).toBe(404);
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByRole("button", { name: `Restore ${name}` }).click();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/tasks/${grandchild.id}`)).ok()).toBeTruthy();
});

test("imports a CSV hierarchy and includes logged time in the dashboard", async ({ page }) => {
  const listId = await openBacklog(page);
  const name = `Imported project ${Date.now()}`;
  const csv = `Task ID,Parent Task ID,Task Name,Description\r\nchild,parent,"Imported child, quoted",\r\nparent,,${name},"two\nlines"\r\n`;
  await page.getByRole("button", { name: "List actions" }).click();
  await page.getByRole("menuitem", { name: "Import CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles({ name: "tasks.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Validate CSV" }).click();
  await expect(page.getByText("2 task rows read.")).toBeVisible();
  await page.getByRole("button", { name: "Import 2 tasks" }).click();
  await expect(page.getByText("Imported 2 tasks.")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const list = await (await page.request.get(`/api/lists/${listId}`)).json();
  const task = list.tasks.find((entry: { name: string }) => entry.name === name);
  expect(task.subtasks[0].name).toBe("Imported child, quoted");
  const exported = await page.request.get(`/api/lists/${listId}/csv`);
  expect(exported.headers()["content-type"]).toContain("text/csv");
  expect(await exported.text()).toContain('"Imported child, quoted"');
  const rejected = await page.request.post(`/api/lists/${listId}/csv`, {
    data: { csv: "Task ID,Parent Task ID,Task Name\na,missing,Invalid import", preview: false },
  });
  expect((await rejected.json()).imported).toBe(false);
  await page.getByRole("button", { name: "All tasks", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Views", exact: true }).getByRole("button", { name: "List", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Task search", exact: true }).click();
  await page.getByLabel("Task name").fill("Imported child, quoted");
  await page.getByRole("button", { name: "Search tasks" }).click();
  await expect(page.getByRole("link", { name: /Imported child, quoted/ })).toBeVisible();
  await expect(page).toHaveURL(/\?q=/);
  const logged = await page.request.post(`/api/tasks/${task.id}/time`, { data: { action: "log", durationSeconds: 900 } });
  expect(logged.status()).toBe(201);
  await page.getByRole("button", { name: "Dashboards" }).click();
  await expect(page.getByRole("heading", { name: "Workspace dashboard" })).toBeVisible();
  await page.getByLabel("List", { exact: true }).selectOption(listId);
  await expect(page.getByText(/0\.25 hours logged/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export time CSV" }).click();
  expect((await download).suggestedFilename()).toBe("time-report.csv");
});

test("invites a read-only guest and revokes their access on removal", async ({ page, browser }) => {
  const listId = await openBacklog(page);
  const email = `guest-${Date.now()}@example.com`;
  await page.getByRole("button", { name: "Workspace members" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Role", { exact: true }).selectOption("GUEST");
  await page.getByRole("button", { name: "Create invitation" }).click();
  const input = page.getByLabel("Invitation link");
  await expect(input).toHaveValue(/\/login\?invite=/);
  const link = await input.inputValue();
  const guest = await browser.newPage();
  try {
    await guest.goto(link);
    await guest.getByRole("button", { name: /Don't have an account/ }).click();
    await guest.getByPlaceholder("Your name").fill("Invited test guest");
    await guest.getByPlaceholder("you@company.com").fill(email);
    await guest.locator('input[type="password"]').fill("local-guest-password");
    await guest.getByRole("button", { name: "Sign Up", exact: true }).click();
    await guest.waitForURL("**/home");
    const origin = new URL(link).origin;
    expect((await guest.request.get(`${origin}/api/lists/${listId}`)).ok()).toBeTruthy();
    expect((await guest.request.post(`${origin}/api/tasks`, { data: { listId, name: "Guest writes are blocked" } })).status()).toBe(403);
    await page.getByRole("button", { name: "Remove Invited test guest" }).click();
    await page.getByRole("button", { name: "Confirm removal" }).click();
    await expect(page.getByText(email, { exact: true })).toHaveCount(0);
    expect((await guest.request.get(`${origin}/api/lists/${listId}`)).status()).toBe(401);
  } finally { await guest.close(); }
});

test("runs a list rule, tracks the task in a goal, and protects shared doc drafts", async ({ page }) => {
  await openBacklog(page);
  await page.locator("aside").getByRole("link", { name: "Roadmap", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Roadmap", exact: true })).toBeVisible();
  const listId = new URL(page.url()).pathname.split("/").at(-1)!;
  const stamp = Date.now();
  const taskName = `Goal work ${stamp}`;
  await page.getByRole("button", { name: "List actions" }).click();
  await page.getByRole("menuitem", { name: "List automations" }).click();
  await page.getByLabel("Rule name").fill(`Triage rule ${stamp}`);
  await page.getByLabel("Due in days").fill("2");
  await page.getByRole("button", { name: "Create rule" }).click();
  await expect(page.getByText(`Triage rule ${stamp}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const created = await page.request.post("/api/tasks", { data: { listId, name: taskName } });
  expect(created.status()).toBe(201);
  const task = await created.json();
  expect(task.dueDate).not.toBeNull();
  const list = await (await page.request.get(`/api/lists/${listId}`)).json();
  const done = list.list.statuses.find((status: { type: string }) => status.type === "DONE");

  await page.getByRole("button", { name: "Goals", exact: true }).click();
  await page.getByRole("button", { name: "New goal" }).click();
  await page.getByLabel("Goal name").fill(`Milestone ${stamp}`);
  await page.getByRole("button", { name: "Create goal" }).click();
  await expect(page.getByRole("heading", { name: `Milestone ${stamp}` })).toBeVisible();
  await page.getByRole("button", { name: "Manage goal" }).last().click();
  await page.getByLabel("Find task to link").fill(taskName);
  await page.getByRole("button", { name: "Find tasks" }).click();
  await page.getByRole("button", { name: `Link ${taskName}` }).click();
  await expect(page.getByText("0 of 1 linked tasks closed")).toBeVisible();
  expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { statusId: done.id } })).ok()).toBeTruthy();
  await expect(page.getByText("1 of 1 linked tasks closed")).toBeVisible();

  await page.getByRole("button", { name: "Docs", exact: true }).click();
  await page.getByLabel("New document title").fill(`Runbook ${stamp}`);
  await page.getByRole("button", { name: "Create document" }).click();
  await page.getByRole("button", { name: "Edit document" }).click();
  await page.getByLabel("Document content").fill("# Release steps\nVerify the application.");
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page.getByRole("heading", { name: "Release steps" })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("doc");
  const stale = await page.request.patch(`/api/workspace/docs/${id}`, { data: { revision: 0, body: "Old draft" } });
  expect(stale.status()).toBe(409);
  await page.getByRole("button", { name: "Archive document" }).click();
  await expect(page.getByRole("button", { name: "Restore document" })).toBeVisible();
});
