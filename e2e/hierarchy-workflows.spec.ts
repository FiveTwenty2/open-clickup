import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, account = "santiago") {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(`${account}@clickuppp.dev`);
  await page.locator('input[type="password"]').fill("password");
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/home");
}

test("inherits the nearest status workflow and keeps tasks identical across list placements", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  const suffix = Date.now();
  const space = await (await page.request.post("/api/spaces", { data: { name: `Workflow space ${suffix}` } })).json();
  const folder = await (await page.request.post("/api/folders", { data: { spaceId: space.id, name: "Workflow folder" } })).json();
  const workflow = [
    { key: "open", name: "Intake", type: "NOT_STARTED", color: "#777777" },
    { key: "done", name: "Shipped", type: "DONE", color: "#008800" },
  ];
  const spacePath = `/api/status-workflows/space/${space.id}`;
  const folderPath = `/api/status-workflows/folder/${folder.id}`;
  expect((await page.request.put(spacePath, { data: { workflow } })).status()).toBe(200);
  const folderWorkflow = [{ ...workflow[0], name: "Triage" }, workflow[1]];
  expect((await page.request.put(folderPath, { data: { workflow: folderWorkflow } })).status()).toBe(200);
  const home = await (await page.request.post("/api/lists", { data: { spaceId: space.id, name: "Canonical workflow list" } })).json();
  const other = await (await page.request.post("/api/lists", { data: { spaceId: space.id, folderId: folder.id, name: "Placement workflow list" } })).json();
  const homePath = `/api/lists/${home.id}`;
  const otherPath = `/api/lists/${other.id}`;
  const before = await (await page.request.get(homePath)).json();
  expect(before.list.statuses.map((status: { name: string }) => status.name)).toEqual(["Intake", "Shipped"]);
  const beforeOther = await (await page.request.get(otherPath)).json();
  expect(beforeOther.list.statuses[0].name).toBe("Triage");
  const fieldResponse = await page.request.post(`${otherPath}/custom-fields`, { data: { name: "Destination code", type: "TEXT" } });
  expect(fieldResponse.status()).toBe(201);
  const field = await fieldResponse.json();

  const task = await (await page.request.post("/api/tasks", { data: { listId: home.id, name: "Single canonical task" } })).json();
  const firstChild = await (await page.request.post("/api/tasks", {
    data: { listId: home.id, parentId: task.id, name: "First inherited subtask" },
  })).json();
  const secondChild = await (await page.request.post("/api/tasks", {
    data: { listId: home.id, parentId: task.id, name: "Second inherited subtask" },
  })).json();
  const taskPath = `/api/tasks/${task.id}`;
  await page.goto(`/l/${home.id}?task=${task.id}`);
  await page.getByRole("button", { name: "Task lists", exact: true }).click();
  await page.getByLabel("Add to list").selectOption(other.id);
  await page.getByRole("button", { name: "Add to list", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove from Placement workflow list" })).toBeVisible();
  const fieldPath = `${taskPath}/fields/${field.id}`;
  expect((await page.request.put(fieldPath, { data: { value: "D-12" } })).status()).toBe(200);
  await page.goto(`/l/${home.id}?task=${task.id}`);
  await expect(page.getByText("Destination code · Placement workflow list")).toBeVisible();
  await expect(page.getByRole("button", { name: "D-12", exact: true })).toBeVisible();
  await page.goto(`/l/${other.id}`);
  await expect(page.getByText("Single canonical task", { exact: true })).toBeVisible();
  await expect(page.getByText("Intake", { exact: true }).first()).toBeVisible();
  const sibling = await (await page.request.post("/api/tasks", { data: { listId: other.id, name: "Destination sibling" } })).json();
  const initialPlacement = await (await page.request.get(otherPath)).json();
  const initialHome = await (await page.request.get(homePath)).json();
  const orderedIds = (list: { tasks: { id: string }[] }) => list.tasks.map(({ id }) => id);
  const childIds = (list: { allTasks: { id: string; parentId: string | null }[] }) => list.allTasks
    .filter(({ parentId }) => parentId === task.id).map(({ id }) => id);
  expect(childIds(initialPlacement)).toEqual([firstChild.id, secondChild.id]);
  await expect(page.getByText("First inherited subtask", { exact: true })).toHaveCount(0);
  await page.getByLabel("Display subtasks").selectOption("expanded");
  const firstHandle = page.getByRole("button", { name: "Reorder First inherited subtask" });
  const secondHandle = page.getByRole("button", { name: "Reorder Second inherited subtask" });
  await expect(firstHandle).toBeVisible();
  await expect(secondHandle).toBeVisible();
  const from = (await secondHandle.boundingBox())!;
  const to = (await firstHandle.boundingBox())!;
  const reorder = page.waitForResponse((response) => response.url().endsWith(`${otherPath}/reorder`));
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  expect((await reorder).status()).toBe(200);
  await page.getByLabel("Display subtasks").selectOption("separate");
  await expect(page.getByText("First inherited subtask", { exact: true })).toHaveCount(1);
  expect(childIds(await (await page.request.get(otherPath)).json())).toEqual([secondChild.id, firstChild.id]);
  expect(childIds(await (await page.request.get(homePath)).json())).toEqual(childIds(initialHome));
  expect((await page.request.put(`/api/tasks/${firstChild.id}/fields/${field.id}`, { data: { value: "Inherited field" } })).status()).toBe(200);
  const reversePlacement = orderedIds(initialPlacement)[0] === task.id ? "after" : "before";
  expect((await page.request.post(`${otherPath}/reorder`, {
    data: { taskId: task.id, targetId: sibling.id, placement: reversePlacement },
  })).status()).toBe(200);
  expect(orderedIds(await (await page.request.get(otherPath)).json())).toEqual(orderedIds(initialPlacement).reverse());
  expect((await (await page.request.get(homePath)).json()).tasks[0].position).toBe(initialHome.tasks[0].position);
  const statusId = beforeOther.list.statuses[1].id;
  expect((await page.request.patch(taskPath, { data: { statusId } })).status()).toBe(200);
  const canonical = await (await page.request.get(taskPath)).json();
  expect(canonical.listId).toBe(home.id);
  expect(canonical.status.name).toBe("Shipped");

  expect((await page.request.put(spacePath, { data: { workflow: [{ ...workflow[0], name: "Inbox" }, { ...workflow[1], name: "Released" }] } })).status()).toBe(200);
  const updated = await (await page.request.get(taskPath)).json();
  expect(updated.status.id).toBe(canonical.status.id);
  expect(updated.status.name).toBe("Released");
  const stillOverridden = await (await page.request.get(otherPath)).json();
  expect(stillOverridden.list.statuses[0].name).toBe("Triage");
  expect((await page.request.put(folderPath, { data: { workflow: null } })).status()).toBe(200);
  const inherited = await (await page.request.get(otherPath)).json();
  expect(inherited.list.statuses[0].name).toBe("Inbox");
  expect((await page.request.post(`/api/tasks/${secondChild.id}/lists`, { data: { listId: other.id } })).status()).toBe(200);
  const explicit = await (await page.request.get(otherPath)).json();
  expect(childIds(explicit)).toEqual([secondChild.id, firstChild.id]);

  await page.goto(`/l/${other.id}?task=${task.id}`);
  await page.getByRole("button", { name: "Task lists", exact: true }).click();
  const removal = page.waitForResponse((response) => response.url().endsWith(`${taskPath}/lists`) && response.request().method() === "DELETE");
  await page.getByRole("button", { name: "Remove from Placement workflow list" }).click();
  expect((await removal).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Remove from Placement workflow list" })).toHaveCount(0);
  const removed = await (await page.request.get(otherPath)).json();
  expect(orderedIds(removed).sort()).toEqual([sibling.id, secondChild.id].sort());
  const existing = await (await page.request.get(taskPath)).json();
  expect(existing.id).toBe(task.id);
  expect(existing.customFieldValues).toEqual([]);
  expect((await (await page.request.get(`/api/tasks/${firstChild.id}`)).json()).customFieldValues).toEqual([]);
  expect((await page.request.put(fieldPath, { data: { value: "D-13" } })).status()).toBe(404);
});

test("propagates inherited status changes without exposing private descendants and denies read-only placement removal", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await login(page);
  const email = `workflow-admin-${Date.now()}@example.com`;
  const invitation = await page.request.post("/api/workspace/invitations", { data: { email, role: "ADMIN" } });
  expect(invitation.status()).toBe(201);
  const invite = new URL((await invitation.json()).path, page.url()).searchParams.get("invite");
  const admin = await browser.newPage({ baseURL: new URL(page.url()).origin });
  admin.setDefaultTimeout(12_000);
  let adminId: string | undefined;
  try {
    const signup = await admin.request.post("/api/auth/signup", {
      data: { name: "Workflow test administrator", email, password: "local-workflow-test-password", invite },
    });
    expect(signup.status()).toBe(201);
    adminId = (await signup.json()).id;
    const space = await (await page.request.post("/api/spaces", { data: { name: `Private workflow coverage ${Date.now()}` } })).json();
    const home = await (await page.request.post("/api/lists", { data: { spaceId: space.id, name: "Workspace workflow list" } })).json();
    const hidden = await (await page.request.post("/api/lists", { data: { spaceId: space.id, name: "Private inherited workflow list" } })).json();
    const placement = await (await page.request.post("/api/lists", { data: { spaceId: space.id, name: "Read-only placement list" } })).json();
    const hiddenUrl = `/api/lists/${hidden.id}`;
    expect((await page.request.patch(`/api/access/list/${hidden.id}`, { data: { private: true, grants: [] } })).status()).toBe(200);
    const old = (await (await page.request.get(hiddenUrl)).json()).list.statuses.find((status: { name: string }) => status.name === "IN REVIEW");
    const privateTask = await (await page.request.post("/api/tasks", {
      data: { listId: hidden.id, name: "Private inherited task", statusId: old.id },
    })).json();
    const taskUrl = `/api/tasks/${privateTask.id}`;
    expect((await admin.request.get(hiddenUrl)).status()).toBe(404);
    expect((await admin.request.get(taskUrl)).status()).toBe(404);
    await admin.goto("/workspace/status-workflows");
    await admin.getByRole("combobox", { name: "Workflow location" }).selectOption(`space/${space.id}`);
    await admin.getByLabel("Status 1 name").fill("Updated intake");
    for (const index of [4, 3, 2]) await admin.getByRole("button", { name: `Remove status ${index}` }).click();
    const savedWorkflow = admin.waitForResponse((response) => response.url().endsWith(`/api/status-workflows/space/${space.id}`) && response.request().method() === "PUT", { timeout: 12_000 });
    await admin.getByRole("button", { name: "Save workflow", exact: true }).click();
    const changed = await savedWorkflow;
    expect(changed.status(), await changed.text()).toBe(200);
    expect((await (await page.request.get(taskUrl)).json()).status.name).toBe("Updated intake");
    expect((await admin.request.get(taskUrl)).status()).toBe(404);

    const visible = await (await page.request.post("/api/tasks", { data: { listId: home.id, name: "Editable shared task" } })).json();
    const privateChild = await (await page.request.post("/api/tasks", {
      data: { listId: home.id, parentId: visible.id, name: "Private child of a shared placement" },
    })).json();
    expect((await page.request.patch(`/api/access/task/${privateChild.id}`, { data: { private: true, grants: [] } })).status()).toBe(200);
    const placements = `/api/tasks/${visible.id}/lists`;
    expect((await page.request.post(placements, { data: { listId: placement.id } })).status()).toBe(200);
    expect((await page.request.patch(`/api/access/list/${placement.id}`, { data: {
      private: true, grants: [{ subjectType: "person", subjectId: adminId, permission: "VIEW" }],
    } })).status()).toBe(200);
    const readOnlyList = await admin.request.get(`/api/lists/${placement.id}`);
    expect(readOnlyList.status()).toBe(200);
    expect((await readOnlyList.json()).allTasks.map((task: { id: string }) => task.id)).toEqual([visible.id]);
    expect((await admin.request.delete(placements, { data: { listId: placement.id } })).status()).toBe(403);
    expect((await (await page.request.get(placements)).json()).map((list: { id: string }) => list.id)).toContain(placement.id);

    const statusCreated = await admin.request.post(`/api/lists/${home.id}/statuses`, {
      data: { name: "Ready to ship", type: "ACTIVE", color: "#000080" },
    });
    expect(statusCreated.status()).toBe(201);
    const status = await statusCreated.json();
    const childUrl = `/api/tasks/${privateChild.id}`;
    expect((await page.request.patch(childUrl, { data: { statusId: status.id } })).status()).toBe(200);
    expect((await admin.request.patch(`/api/statuses/${status.id}`, { data: { type: "DONE" } })).status()).toBe(200);
    expect((await (await page.request.get(childUrl)).json()).completedAt).toBeTruthy();
    expect((await admin.request.get(childUrl)).status()).toBe(404);
    const deleted = await admin.request.delete(`/api/statuses/${status.id}`);
    expect(deleted.status(), await deleted.text()).toBe(200);
    const child = await (await page.request.get(childUrl)).json();
    expect(child.status.id).toBe((await deleted.json()).movedTo);
    expect(child.status.name).toBe("Updated intake");
    expect(child.completedAt).toBeNull();
    expect((await admin.request.get(childUrl)).status()).toBe(404);
  } finally {
    await admin.close();
    if (adminId) await page.request.patch("/api/workspace/members", { data: { userId: adminId, role: null } }).catch(() => undefined);
  }
});
