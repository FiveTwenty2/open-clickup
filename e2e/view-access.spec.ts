import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, name: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(`${name}@clickuppp.dev`);
  await page.locator('input[type="password"]').fill("password");
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/home");
}

test("keeps private views private and enforces locks for shared views", async ({ page, browser }) => {
  await login(page, "santiago");
  const { workspace } = await (await page.request.get("/api/bootstrap")).json();
  const spaceId = workspace.spaces[0].id;
  const parent = await (await page.request.post("/api/folders", { data: { name: "Access parent", spaceId } })).json();
  const subfolder = await page.request.post("/api/folders", { data: { name: "Access child", spaceId, parentId: parent.id } });
  expect(subfolder.status()).toBe(201);
  const folder = await subfolder.json();
  const list = await (await page.request.post("/api/lists", { data: { name: "View access list", spaceId, folderId: folder.id } })).json();
  const listPath = `/api/lists/${list.id}`;
  await page.goto(`/l/${list.id}`);
  await page.getByRole("button", { name: "Add view" }).click();
  await page.getByLabel("View name").fill("Private status review");
  await page.getByRole("checkbox", { name: "Private view" }).check();
  await page.getByRole("button", { name: "Create view" }).click();
  await expect(page.getByRole("button", { name: "Private status review", exact: true })).toBeVisible();
  const ownerData = await (await page.request.get(listPath)).json();
  const privateView = ownerData.list.views.find((view: { name: string }) => view.name === "Private status review");
  const shared = ownerData.list.views.find((view: { name: string }) => view.name === "List");
  expect((await page.request.patch(`/api/views/${shared.id}`, { data: { protected: true } })).ok()).toBeTruthy();

  const peer = await browser.newPage({ baseURL: new URL(page.url()).origin });
  try {
    await login(peer, "maya");
    const visible = await (await peer.request.get(listPath)).json();
    expect(visible.list.views.some((view: { id: string }) => view.id === privateView.id)).toBe(false);
    expect((await peer.request.post(`/api/views/${privateView.id}`)).status()).toBe(404);
    expect((await peer.request.patch(`/api/views/${shared.id}`, { data: { config: { groupBy: "none" } } })).status()).toBe(403);
    expect((await peer.request.delete(`/api/views/${shared.id}`)).status()).toBe(403);
  } finally {
    await peer.close();
  }

  await page.goto("/workspace/task-types");
  await page.getByLabel("Type name").fill(`Bug ${Date.now()}`);
  const saved = page.waitForResponse((response) => response.url().endsWith("/task-types") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create task type" }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const taskType = await response.json();
  const task = await (await page.request.post("/api/tasks", { data: { listId: list.id, name: "Typed task" } })).json();
  await page.goto(`/l/${list.id}?task=${task.id}`);
  await page.getByRole("combobox", { name: "Task type" }).selectOption(taskType.id);
  await expect.poll(async () => {
    const detail = await (await page.request.get(`/api/tasks/${task.id}`)).json();
    return detail.taskType?.id;
  }).toBe(taskType.id);

  await page.getByRole("button", { name: "Share task summary" }).click();
  await page.getByRole("button", { name: "Enable public link" }).click();
  const link = page.getByRole("textbox", { name: "Public task link" });
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  const key = new URL(url).pathname.split("/").at(-1);
  const anonymous = await browser.newPage({ baseURL: new URL(url).origin });
  try {
    await anonymous.goto(url);
    await expect(anonymous.getByRole("heading", { name: "Typed task" })).toBeVisible();
    const result = await (await anonymous.request.get(`/api/public/tasks/${key}`)).json();
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("listId");
    await page.getByRole("button", { name: "Revoke link" }).click();
    await expect(link).toHaveCount(0);
    expect((await anonymous.request.get(`/api/public/tasks/${key}`)).status()).toBe(404);
  } finally {
    await anonymous.close();
  }
});

test("grants and revokes teammate view access and publishes only matching task summaries", async ({ page, browser }) => {
  await login(page, "santiago");
  const { workspace } = await (await page.request.get("/api/bootstrap")).json();
  const maya = workspace.members.find((member: { user: { name: string } }) => member.user.name === "Maya Chen").user;
  const list = await (await page.request.post("/api/lists", { data: { name: "View sharing " + Date.now(), spaceId: workspace.spaces[0].id } })).json();
  const path = `/api/lists/${list.id}`;
  const privateView = await (await page.request.post(path + "/views", { data: { name: "Private planning", type: "LIST", private: true } })).json();
  const { list: metadata } = await (await page.request.get(path)).json();
  const shared = metadata.views.find((view: { type: string }) => view.type === "LIST");
  const statusId = metadata.statuses[0].id;
  expect((await page.request.patch(`/api/views/${shared.id}`, { data: { config: { statusIds: [statusId] } } })).ok()).toBeTruthy();
  await page.request.post("/api/tasks", { data: { listId: list.id, statusId, name: "Visible public task" } });
  await page.request.post("/api/tasks", { data: { listId: list.id, statusId: metadata.statuses[1].id, name: "Filtered out task" } });

  const baseURL = new URL(page.url()).origin;
  const peer = await browser.newPage({ baseURL });
  const visitor = await browser.newPage({ baseURL });
  try {
    await login(peer, "maya");
    await page.goto(`/l/${list.id}?view=${privateView.id}`);
    await expect(page.getByRole("button", { name: "Private planning", exact: true })).toHaveClass(/border-cu-purple/);
    await page.getByRole("button", { name: "Manage current view" }).click();
    await page.getByRole("button", { name: "Share with teammates" }).click();
    await page.getByRole("checkbox", { name: "Maya Chen", exact: true }).check();
    await page.getByRole("button", { name: "Save view access" }).click();
    await expect(page.getByRole("button", { name: "Save view access" })).toBeDisabled();
    await peer.goto(`/l/${list.id}?view=${privateView.id}`);
    await expect(peer.getByRole("button", { name: "Private planning", exact: true })).toBeVisible();
    expect((await peer.request.patch(`/api/views/${privateView.id}`, { data: { name: "Changed" } })).status()).toBe(404);
    await page.getByRole("checkbox", { name: "Maya Chen", exact: true }).uncheck();
    await page.getByRole("button", { name: "Save view access" }).click();
    await expect(page.getByRole("button", { name: "Save view access" })).toBeDisabled();
    await peer.reload();
    await expect(peer.getByRole("button", { name: "Private planning", exact: true })).toHaveCount(0);

    await page.goto(`/l/${list.id}?view=${shared.id}`);
    await page.getByRole("button", { name: "Manage current view" }).click();
    await page.getByRole("button", { name: "Public view link", exact: true }).click();
    await page.getByRole("button", { name: "Enable public view link" }).click();
    const link = page.getByRole("textbox", { name: "Public view URL" });
    await expect(link).toBeVisible();
    const url = await link.inputValue();
    await visitor.goto(url);
    await expect(visitor.getByText("Visible public task", { exact: true })).toBeVisible();
    await expect(visitor.getByText("Filtered out task", { exact: true })).toHaveCount(0);
    const publicPath = "/api/public/views/" + new URL(url).pathname.split("/").at(-1);
    const data = await (await visitor.request.get(publicPath)).json();
    expect(data.tasks[0]).not.toHaveProperty("description");
    expect(data.tasks[0]).not.toHaveProperty("assignees");
    await page.getByRole("button", { name: "Revoke public view link" }).click();
    await expect(link).toHaveCount(0);
    expect((await visitor.request.get(publicPath)).status()).toBe(404);
  } finally {
    await peer.close();
    await visitor.close();
  }
});
