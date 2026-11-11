import { expect, test, type Locator, type Page } from "@playwright/test";

async function openList(page: Page, name: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill("santiago@clickuppp.dev");
  await page.locator('input[type="password"]').fill("password");
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/home");
  const href = await page.locator("aside").getByRole("link", { name: "Backlog", exact: true }).getAttribute("href");
  const { list: backlog } = await (await page.request.get(`/api/lists/${href?.split("/").at(-1)}`)).json();
  const response = await page.request.post("/api/lists", { data: { spaceId: backlog.spaceId, name } });
  expect(response.status()).toBe(201);
  const list = await response.json();
  await page.goto(`/l/${list.id}`);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return list;
}

async function add(page: Page, listId: string, name: string, parentId?: string, statusId?: string, dueDate?: string) {
  const response = await page.request.post("/api/tasks", { data: { listId, name, parentId, statusId, dueDate } });
  expect(response.status()).toBe(201);
  return response.json();
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

test("expands nested subtasks and reorders filtered siblings without losing hidden tasks", async ({ page }) => {
  const list = await openList(page, `Nested work ${Date.now()}`);
  const { list: metadata } = await (await page.request.get(`/api/lists/${list.id}`)).json();
  const parent = await add(page, list.id, "Ordering parent");
  const first = await add(page, list.id, "Visible first", parent.id, metadata.statuses[0].id);
  const hidden = await add(page, list.id, "Hidden between", parent.id, metadata.statuses[1].id);
  const third = await add(page, list.id, "Visible third", parent.id, metadata.statuses[0].id);
  await add(page, list.id, "Nested grandchild", first.id);
  await page.reload();
  await page.getByLabel("Display subtasks").selectOption("expanded");
  await expect(page.getByText("Nested grandchild", { exact: true })).toBeVisible();
  const nestedDrag = page.waitForResponse((response) => response.url().endsWith("/reorder") && response.ok());
  await drag(page, page.getByRole("button", { name: "Reorder Visible third" }), page.getByRole("button", { name: "Reorder Visible first" }));
  await nestedDrag;
  await expect.poll(async () => {
    const detail = await (await page.request.get(`/api/tasks/${parent.id}`)).json();
    return detail.subtasks[0].id;
  }).toBe(third.id);
  await page.request.post(`/api/lists/${list.id}/reorder`, { data: { taskId: third.id, targetId: hidden.id, placement: "after" } });
  await page.reload();
  await page.getByRole("button", { name: "Group: Status" }).click();
  await page.getByRole("menuitem", { name: "None", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByLabel("Display subtasks").selectOption("separate");
  await page.getByRole("button", { name: "Statuses", exact: true }).click();
  await page.getByRole("checkbox", { name: metadata.statuses[0].name, exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Hidden between", { exact: true })).toHaveCount(0);
  const saved = page.waitForResponse((response) => response.url().endsWith("/reorder") && response.ok());
  await drag(page, page.getByRole("button", { name: "Reorder Visible third" }), page.getByRole("button", { name: "Reorder Visible first" }));
  await saved;
  const task = await (await page.request.get(`/api/tasks/${parent.id}`)).json();
  expect(task.subtasks.map((subtask: { id: string }) => subtask.id)).toEqual([third.id, first.id, hidden.id]);
  await page.reload();
  await expect(page.getByLabel("Display subtasks")).toHaveValue("separate");
  await expect(page.getByText("Hidden between", { exact: true })).toHaveCount(0);
});

test("opens view options and task actions from all five list views", async ({ page }) => {
  const list = await openList(page, `View menus ${Date.now()}`);
  const task = await add(page, list.id, "Context menu task", undefined, undefined, new Date().toISOString());
  await page.reload();
  for (const name of ["List", "Board", "Table", "Calendar", "Gantt"]) {
    const tab = page.getByRole("main").getByRole("button", { name, exact: true });
    await tab.click({ button: "right" });
    await expect(page.getByRole("button", { name: "Copy view link", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open view", exact: true }).click();
    const taskName = page.getByText(task.name, { exact: true }).first();
    await taskName.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Open task", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Change status", exact: false })).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("creates a folder, moves a list, and creates a new list from an updated template", async ({ page }) => {
  // Keep the native drag source and destination in view without auto-scrolling the sidebar.
  await page.setViewportSize({ width: 1280, height: 1200 });
  const name = `Reusable process ${Date.now()}`;
  const source = await openList(page, name);
  const parent = await add(page, source.id, "Template parent");
  await add(page, source.id, "Template child", parent.id);
  const sidebar = page.locator("aside");
  const space = sidebar.getByRole("button", { name: "Engineering", exact: true });
  const folderName = `Process folder ${Date.now()}`;
  await space.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New Folder", exact: true }).click();
  await sidebar.getByPlaceholder("Folder name").fill(folderName);
  await sidebar.getByPlaceholder("Folder name").press("Enter");
  const folder = sidebar.getByRole("button", { name: folderName, exact: true });
  await expect(folder).toBeVisible();

  const move = page.waitForResponse((response) => response.url().endsWith("/api/hierarchy/reorder") && response.ok());
  await sidebar.getByLabel(`Drag list ${name}`).dragTo(folder);
  const movedRequest = (await move).request().postDataJSON();
  expect(movedRequest).toMatchObject({ source: { id: source.id }, target: { kind: "folder" }, placement: "inside" });
  const moved = await (await page.request.get(`/api/lists/${source.id}`)).json();
  expect(moved.list.folder.name).toBe(folderName);
  await folder.click();
  const listLink = sidebar.getByRole("link", { name, exact: true });
  await listLink.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Save or update list template" }).click();
  await page.getByLabel("Template name").fill(name);
  const templateSaved = page.waitForResponse((response) => response.url().endsWith("/api/list-templates") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save template", exact: true }).click();
  expect((await templateSaved).status()).toBe(201);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await add(page, source.id, "Added in template update");
  const sourceData = await (await page.request.get(`/api/lists/${source.id}`)).json();
  const sourceStatus = sourceData.list.statuses[1];
  const rule = await page.request.post(`/api/lists/${source.id}/automations`, { data: {
    name: "Copied rule", trigger: "STATUS_CHANGED", statusId: sourceStatus.id, priority: "HIGH",
  } });
  expect(rule.status()).toBe(201);
  await listLink.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Save or update list template" }).click();
  await page.getByLabel("List template", { exact: true }).selectOption({ label: name });
  await page.getByRole("button", { name: "Update template", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New List from template" }).click();
  await page.getByLabel("List template", { exact: true }).selectOption({ label: name });
  await page.getByLabel("New list name").fill(`${name} copy`);
  await page.getByLabel("Copy automation rules").check();
  const created = page.waitForResponse((response) => response.url().endsWith("/api/list-templates") && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const clone = await response.json();
  await expect(page.getByRole("heading", { name: `${name} copy`, exact: true })).toBeVisible();
  const cloned = await (await page.request.get(`/api/lists/${clone.id}`)).json();
  expect(cloned.list.folder.name).toBe(folderName);
  expect(cloned.tasks.map((task: { name: string }) => task.name)).toEqual(["Template parent", "Added in template update"]);
  expect(cloned.tasks[0].subtasks[0].name).toBe("Template child");
  expect(cloned.tasks[0].subtasks[0].parentId).toBe(cloned.tasks[0].id);
  const rules = await (await page.request.get(`/api/lists/${clone.id}/automations`)).json();
  expect(rules).toEqual([expect.objectContaining({ name: "Copied rule", statusId: cloned.list.statuses[1].id })]);
  expect(rules[0].statusId).not.toBe(sourceStatus.id);

  const listOrder = page.waitForResponse((response) => response.url().endsWith("/api/hierarchy/reorder") && response.ok());
  await sidebar.getByLabel(`Drag list ${name} copy`, { exact: true }).dragTo(
    sidebar.locator(`[data-hierarchy-row="${source.id}"]`), { targetPosition: { x: 85, y: 3 } },
  );
  expect((await listOrder).request().postDataJSON()).toMatchObject({ placement: "before" });

  const { workspace } = await (await page.request.get("/api/bootstrap")).json();
  const product = workspace.spaces.find((space: { name: string }) => space.name === "Product");
  const engineering = workspace.spaces.find((space: { name: string }) => space.name === "Engineering");
  // Collapse the trees so both native drag endpoints are visible before the drag starts.
  await sidebar.getByRole("button", { name: "Product", exact: true }).click();
  await sidebar.getByRole("button", { name: "Engineering", exact: true }).click();
  const productRow = sidebar.locator(`[data-hierarchy-row="${product.id}"]`);
  const reordered = page.waitForResponse((response) => response.url().endsWith("/api/hierarchy/reorder") && response.ok());
  await sidebar.getByLabel("Drag space Engineering").dragTo(productRow, { targetPosition: { x: 70, y: 4 } });
  expect((await reordered).request().postDataJSON()).toEqual({
    source: { kind: "space", id: engineering.id }, target: { kind: "space", id: product.id }, placement: "before",
  });
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const spaces = bootstrap.workspace.spaces.map((space: { name: string }) => space.name);
  expect(spaces.indexOf("Engineering")).toBeLessThan(spaces.indexOf("Product"));
});
