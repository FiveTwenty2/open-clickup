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
