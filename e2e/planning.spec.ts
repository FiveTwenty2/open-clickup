import { expect, test, type Locator, type Page } from "@playwright/test";

async function openBacklog(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill("santiago@clickuppp.dev");
  await page.locator('input[type="password"]').fill("password");
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/home");
  await page.locator("aside").getByRole("link", { name: "Backlog", exact: true }).click();
  await page.waitForURL(/\/l\//);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

async function drag(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
  await page.mouse.up();
}

test("manually reorders across statuses and restores an archived list with its tasks", async ({ page }) => {
  const backlogId = await openBacklog(page);
  const backlog = await (await page.request.get(`/api/lists/${backlogId}`)).json();
  const name = `Planning list ${Date.now()}`;
  const response = await page.request.post("/api/lists", { data: { spaceId: backlog.list.spaceId, name } });
  expect(response.status()).toBe(201);
  const list = await response.json();
  await page.goto(`/l/${list.id}`);
  const details = await (await page.request.get(`/api/lists/${list.id}`)).json();
  for (const [index, taskName] of ["First item", "Second item", "Third item"].entries()) {
    expect((await page.request.post("/api/tasks", {
      data: { listId: list.id, name: taskName, statusId: details.list.statuses[index % 2].id },
    })).status()).toBe(201);
  }
  await page.reload();
  await page.getByRole("button", { name: "Group: Status" }).click();
  await page.getByRole("menuitem", { name: "None", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Group: None" })).toBeVisible();
  const first = page.getByRole("button", { name: "Reorder First item" });
  const third = page.getByRole("button", { name: "Reorder Third item" });
  await expect(first).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().endsWith("/reorder") && r.ok());
  await drag(page, third, first);
  await saved;
  await page.reload();
  await expect(page.getByRole("button", { name: "Group: None" })).toBeVisible();
  const order = await page.getByRole("button", { name: /^Reorder (First|Second|Third) item/ }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  expect(order).toEqual(["Reorder Third item", "Reorder First item", "Reorder Second item"]);
  const after = await (await page.request.get(`/api/lists/${list.id}`)).json();
  expect(after.tasks.find((task: { name: string }) => task.name === "Third item").statusId).toBe(details.list.statuses[0].id);

  await page.getByRole("button", { name: "List actions" }).click();
  await page.getByRole("menuitem", { name: "Archive list" }).click();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();
  await expect(page.locator("aside").getByRole("link", { name, exact: true })).toHaveCount(0);
  const search = await (await page.request.get(`/api/search?q=${encodeURIComponent(name)}`)).json();
  expect(search.lists).toEqual([]);
  await page.goto("/recovery?mode=lists");
  await page.getByLabel("Search archived lists").fill(name);
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Unarchive ${name}` }).click();
  await expect(page.getByText("No archived lists found.")).toBeVisible();
  const restored = await (await page.request.get(`/api/lists/${list.id}`)).json();
  expect(restored.list.archivedAt).toBeNull();
  expect(restored.tasks.map((task: { name: string }) => task.name)).toEqual(["Third item", "First item", "Second item"]);
});

test("schedules from the workspace calendar and uploads a comment file above 10 MB", async ({ page }) => {
  const listId = await openBacklog(page);
  await page.locator("aside").getByRole("button", { name: "Calendar", exact: true }).click();
  await page.getByLabel("Calendar list", { exact: true }).selectOption(listId);
  const calendar = page.getByRole("region", { name: "Task calendar" });
  await calendar.getByRole("button", { name: "4 days", exact: true }).click();
  await page.getByLabel("Go to calendar date").fill("2027-01-12");
  await expect(calendar.locator("[data-calendar-date]")).toHaveCount(4);
  await calendar.getByRole("button", { name: "Add task on 2027-01-12" }).click();
  const name = `Calendar task ${Date.now()}`;
  await page.getByLabel("Scheduled task name").fill(name);
  await page.getByLabel("Due time").fill("14:30");
  const posted = page.waitForResponse((r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST");
  await calendar.getByRole("button", { name: "Create task" }).click();
  const created = await posted;
  expect(created.status()).toBe(201);
  const task = await created.json();
  const entry = calendar.locator('[data-calendar-date="2027-01-12"]').getByRole("button", { name: new RegExp(name) });
  await expect(entry).toContainText("14:30");
  const shifted = page.waitForResponse((r) => r.url().endsWith(`/api/tasks/${task.id}`) && r.request().method() === "PATCH");
  await drag(page, entry, calendar.locator('[data-calendar-date="2027-01-13"]'));
  expect((await shifted).ok()).toBeTruthy();
  const rescheduled = calendar.locator('[data-calendar-date="2027-01-13"]').getByRole("button", { name: new RegExp(name) });
  await expect(rescheduled).toContainText("14:30");
  await calendar.getByLabel("Time grid").check();
  const hour = calendar.getByRole("button", { name: "Add task on 2027-01-13 at 15:00" });
  const shiftedTime = page.waitForResponse((r) => r.url().endsWith(`/api/tasks/${task.id}`) && r.request().method() === "PATCH");
  await drag(page, rescheduled, hour);
  expect((await shiftedTime).ok()).toBeTruthy();
  await expect(rescheduled).toContainText("15:00");

  const bytes = 11 * 1024 * 1024;
  const upload = await page.request.post(`/api/tasks/${task.id}/comments`, { multipart: {
    body: "Large document",
    files: { name: "large-document.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(bytes) },
  } });
  expect(upload.status()).toBe(201);
  const comment = await upload.json();
  expect(comment.files[0].size).toBe(bytes);
  const download = await page.request.get(`/api/comment-files/${comment.files[0].id}`);
  expect((await download.body()).length).toBe(bytes);
});
