import { expect, test, type APIRequestContext } from "@playwright/test";

test.use({ actionTimeout: 12_000 });

async function create<T>(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(path, { data });
  expect(response.status(), await response.text()).toBe(201);
  return response.json() as Promise<T>;
}

test("saves location views, edits their data, and shares read-only views", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill("santiago@clickuppp.dev");
  await page.locator('input[type="password"]').fill("password");
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/home");
  const request = page.request;
  const { currentUser, workspace: workspaceData } = await (await request.get("/api/bootstrap")).json();
  const stamp = Date.now();
  const space = await create<{ id: string }>(request, "/api/spaces", { name: `View space ${stamp}` });
  const folder = await create<{ id: string }>(request, "/api/folders", { name: "View folder", spaceId: space.id });
  const childFolder = await create<{ id: string }>(request, "/api/folders", {
    name: "Child view folder", spaceId: space.id, parentId: folder.id,
  });
  const list = await create<{ id: string }>(request, "/api/lists", { name: "View test list", spaceId: space.id, folderId: childFolder.id });
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const task = await create<{ id: string; statusId: string }>(request, "/api/tasks", {
    name: "Roadmap release", listId: list.id, dueDate: tomorrow.toISOString(), assigneeIds: [currentUser.id],
  });
  expect((await request.patch(`/api/tasks/${task.id}`, { data: { startDate: today.toISOString(), timeEstimate: 90 } })).ok()).toBe(true);
  const blocker = await create<{ id: string }>(request, "/api/tasks", {
    name: "Roadmap blocker", listId: list.id, dueDate: today.toISOString(),
  });
  await create(request, `/api/tasks/${task.id}/dependencies`, { type: "waiting_on", otherTaskId: blocker.id });
  await create(request, "/api/tasks", { name: "Roadmap checklist task", listId: list.id, parentId: task.id });
  const outside = await create<{ id: string }>(request, "/api/lists", { name: "Other view test list", spaceId: space.id });
  const placed = await create<{ id: string }>(request, "/api/tasks", { name: "Placed on roadmap", listId: outside.id });
  await create(request, "/api/tasks", { name: "Placed follow-up", listId: outside.id, parentId: placed.id });
  const outsideName = `Outside of the folder ${stamp}`;
  await create(request, "/api/tasks", { name: outsideName, listId: outside.id });
  const placement = await request.post(`/api/tasks/${placed.id}/lists`, { data: { listId: list.id } });
  expect(placement.ok(), await placement.text()).toBe(true);
  const privateHome = await create<{ id: string }>(request, "/api/lists", { name: "Private test list", spaceId: space.id });
  const privateTask = await create<{ id: string }>(request, "/api/tasks", { name: "Private placement", listId: privateHome.id });
  expect((await request.post(`/api/tasks/${privateTask.id}/lists`, { data: { listId: list.id } })).ok()).toBe(true);
  expect((await request.patch(`/api/access/list/${privateHome.id}`, { data: { private: true, grants: [] } })).ok()).toBe(true);

  const folderPage = `/views/folder/${folder.id}`;
  await page.goto(folderPage);
  await expect(page.getByRole("heading", { name: "View folder", exact: true })).toBeVisible();
  await expect(page.getByText("Placed on roadmap", { exact: true })).toBeVisible();
  await expect(page.getByText(outsideName, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add view", exact: true }).click();
  await page.getByLabel("View name").fill("Release timeline");
  await page.getByLabel("View type").selectOption("TIMELINE");
  await page.getByRole("button", { name: "Create view", exact: true }).click();
  await expect(page.getByRole("region", { name: "Timeline schedule" })).toBeVisible();
  await page.waitForURL(/\?view=[^&]+$/);
  const timeline = { id: new URL(page.url()).searchParams.get("view")! };
  const timelineTask = page.getByRole("region", { name: "Timeline schedule" }).getByRole("button", { name: "Roadmap release", exact: true }).first();
  await expect(timelineTask).toBeVisible();
  await timelineTask.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Open task", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const saveView = (type: string, name: string, location: { folderId?: string; spaceId?: string } = { folderId: folder.id }) =>
    create<{ id: string }>(request, "/api/scoped-views", { ...location, type, name });
  const mind = await saveView("MIND_MAP", "Release mind map");
  const board = await saveView("BOARD", "Release board");
  const calendar = await saveView("CALENDAR", "Release calendar");
  const gantt = await saveView("GANTT", "Release Gantt");
  const map = await saveView("MAP", "Release map");
  const embed = await saveView("EMBED", "Release embed");
  const table = await saveView("TABLE", "Release table");
  const team = await saveView("TEAM", "Release team", { spaceId: space.id });
  const workspace = await saveView("TABLE", "Release workspace", {});
  await page.goto(`${folderPage}?view=${mind.id}`);
  await expect(page.getByRole("region", { name: "Task mind map" }).getByText("Roadmap checklist task", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Task mind map" }).getByText("Placed follow-up", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Toggle branches for Roadmap release" }).click();
  await expect(page.getByText("Roadmap checklist task", { exact: true })).toHaveCount(0);
  await page.getByLabel("Mind map mode").selectOption("freeform");
  await page.getByRole("button", { name: "Add root node" }).click();
  await page.getByLabel("Node label").fill("Release planning");
  await page.getByRole("button", { name: "Save node" }).click();
  await page.getByRole("button", { name: "Add child to Release planning" }).click();
  await page.getByLabel("Node label").fill("Prepare launch");
  const mindSave = page.waitForResponse((response) => response.url().endsWith(`/api/scoped-views/${mind.id}`)
    && response.request().method() === "PATCH" && (response.request().postData() ?? "").includes("Prepare launch"));
  await page.getByRole("button", { name: "Save node" }).click();
  expect((await mindSave).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("region", { name: "Freeform mind map" }).getByText("Prepare launch", { exact: true })).toBeVisible();

  await page.goto(`${folderPage}?view=${board.id}`);
  const boardApi = await (await request.get(`/api/scoped-views?folderId=${folder.id}`)).json();
  const target = boardApi.lists[0].statuses.find(({ id }: { id: string }) => id !== task.statusId);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Roadmap release", exact: true }) });
  const column = page.getByRole("region", { name: target.name, exact: true });
  await card.dragTo(column);
  await expect(column.getByRole("button", { name: "Roadmap release", exact: true })).toBeVisible();

  await page.goto(`${folderPage}?view=${calendar.id}`);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Roadmap release$/ }).first()).toBeVisible();
  await page.goto(`${folderPage}?view=${gantt.id}`);
  await expect(page.getByRole("region", { name: "Gantt chart" }).getByRole("img", { name: "Task dependencies" })).toBeVisible();

  await page.goto(`${folderPage}?view=${map.id}`);
  await page.getByRole("region", { name: "Task map" }).getByRole("combobox", { name: "Task", exact: true }).selectOption(task.id);
  await page.getByLabel("Latitude").fill("-26.2041");
  await page.getByLabel("Longitude").fill("28.0473");
  const pointSaved = page.waitForResponse((response) =>
    response.url().endsWith(`/api/tasks/${task.id}/map-location`) && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save location" }).click();
  expect((await pointSaved).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Map pin for Roadmap release" })).toBeVisible({ timeout: 12_000 });
  await page.goto(`${folderPage}?view=${embed.id}`);
  await page.getByLabel("Embed URL").fill("https://example.com");
  await page.getByRole("button", { name: "Save embed" }).click();
  await page.getByRole("button", { name: "Load embedded content" }).click();
  await expect(page.locator("iframe[title='Embedded website']")).toHaveAttribute("sandbox", "allow-scripts allow-forms");
  await page.goto(`/views/space/${space.id}?view=${team.id}`);
  const teamRegion = page.getByRole("region", { name: "Team workload" });
  await expect(teamRegion.getByRole("heading", { name: "Unassigned", exact: true })).toBeVisible();
  await teamRegion.getByRole("combobox", { name: "Teammate", exact: true }).selectOption(currentUser.id);
  await expect(teamRegion.getByRole("heading", { name: currentUser.name, exact: true })).toBeVisible();
  await expect(teamRegion.getByText(/1.5 h estimated/)).toBeVisible();
  await expect(teamRegion.getByRole("heading", { name: "Unassigned", exact: true })).toHaveCount(0);
  await page.goto(`/views/workspace?view=${workspace.id}`);
  await expect(page.getByText(outsideName, { exact: true })).toBeVisible();
  await page.goto(`${folderPage}?view=${table.id}`);
  await page.getByRole("button", { name: "Group: Status", exact: true }).click();
  await page.getByRole("menuitem", { name: "None", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByLabel("Select all tasks", { exact: true }).check();
  await expect(page.getByLabel("Select Roadmap release", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  const canonicalList = boardApi.lists[0];
  const inline = page.getByRole("button", { name: "Change status for Roadmap release", exact: true }).first();
  const original = canonicalList.statuses.find(({ id }: { id: string }) => id === task.statusId);
  await inline.click();
  await page.getByRole("menuitem", { name: original.name, exact: true }).click();
  await expect(inline).toContainText(original.name);
  await page.getByLabel("Select Roadmap release", { exact: true }).first().check();
  await page.getByLabel("Select Placed on roadmap", { exact: true }).first().check();
  await page.getByRole("button", { name: "Status", exact: true }).click();
  await page.getByRole("menuitem", { name: target.name, exact: true }).click();
  await expect.poll(async () => {
    const home = await (await request.get(`/api/tasks/${task.id}`)).json();
    const secondary = await (await request.get(`/api/tasks/${placed.id}`)).json();
    return [home.status.name, secondary.status.name];
  }).toEqual([target.name, target.name]);

  const anonymous = await browser.newContext({ baseURL });
  try {
    const publicPage = await anonymous.newPage();
    for (const view of [mind, gantt, calendar, board, timeline, map, embed, team]) {
      const share = `/api/scoped-views/${view.id}/sharing`;
      const enabled = await request.patch(share, { data: { action: "enable" } });
      expect(enabled.status(), `${share} ${await enabled.text()}`).toBe(200);
      const { key } = await (await request.get(share)).json();
      await publicPage.goto(`/shared-view/${key}`);
      await expect(publicPage.getByText("Read-only task summary")).toBeVisible();
      if (view.id === mind.id) await expect(publicPage.getByText("Prepare launch", { exact: true })).toBeVisible();
      if (view.id === gantt.id) await expect(publicPage.getByRole("img", { name: "Task dependencies" })).toBeVisible();
      if (view.id === calendar.id) await expect(publicPage.getByRole("button", { name: "Week", exact: true })).toBeVisible();
      if (view.id === timeline.id) await expect(publicPage.getByRole("region", { name: "Timeline schedule" })).toBeVisible();
      if (view.id === map.id) await expect(publicPage.getByRole("button", { name: "Map pin for Roadmap release" })).toBeVisible();
      if (view.id === embed.id) {
        await expect(publicPage.getByRole("link", { name: "Open source" })).toHaveAttribute("href", "https://example.com/");
        await expect(publicPage.getByRole("button", { name: "Save embed" })).toHaveCount(0);
      }
      if (view.id === team.id) {
        await expect(publicPage.getByRole("heading", { name: "Assigned", exact: true })).toBeVisible();
        await expect(publicPage.getByRole("heading", { name: currentUser.name, exact: true })).toHaveCount(0);
      }
      if (view.id === board.id) {
        await expect(publicPage.getByText("Placed on roadmap", { exact: true })).toBeVisible();
        await expect(publicPage.getByText("Private placement", { exact: true })).toHaveCount(0);
        await expect(publicPage.getByText(outsideName, { exact: true })).toHaveCount(0);
        await expect(publicPage.getByLabel("Change status for Roadmap release")).toHaveCount(0);
      }
      expect((await request.patch(share, { data: { action: "revoke" } })).status()).toBe(200);
      await publicPage.reload();
      await expect(publicPage.getByRole("alert").filter({ hasText: "This shared view is unavailable." })).toBeVisible();
    }
    const listMind = await create<{ id: string }>(request, `/api/lists/${list.id}/views`, { type: "MIND_MAP", name: "List mind map" });
    await page.goto(`/l/${list.id}?view=${listMind.id}`);
    await page.getByRole("button", { name: "Manage current view" }).click();
    await page.getByRole("button", { name: "Public view link", exact: true }).click();
    await page.getByRole("button", { name: "Enable public view link" }).click();
    const publicUrl = await page.getByLabel("Public view URL").inputValue();
    await publicPage.goto(publicUrl);
    await expect(publicPage.getByRole("region", { name: "Task mind map" }).getByText("Placed follow-up", { exact: true })).toBeVisible();
    await expect(publicPage.getByText("Private placement", { exact: true })).toHaveCount(0);
  } finally {
    await anonymous.close();
  }

  const scopeApi = `/api/scoped-views?folderId=${folder.id}`;
  const privateView = await create<{ id: string }>(request, "/api/scoped-views", {
    folderId: folder.id, name: "Private planning", type: "TABLE", private: true,
  });
  expect((await request.patch(`/api/scoped-views/${table.id}`, { data: { makeDefault: true, protected: true } })).ok()).toBe(true);
  await page.goto(folderPage);
  await expect(page.getByRole("button", { name: "Group: None", exact: true })).toBeVisible();
  const peer = await browser.newPage({ baseURL });
  try {
    const reader = workspaceData.members.find((member: { user: { email: string } }) => member.user.email === "diego@clickuppp.dev");
    await peer.goto("/login");
    await peer.getByPlaceholder("you@company.com").fill(reader.user.email);
    await peer.locator('input[type="password"]').fill("password");
    await peer.getByRole("button", { name: "Log In" }).click();
    await peer.waitForURL("**/home");
    await peer.goto(folderPage);
    await expect(peer.getByRole("button", { name: "Release table", exact: true })).toBeVisible();
    await expect(peer.getByRole("button", { name: "Private planning", exact: true })).toHaveCount(0);
    expect((await request.patch(`/api/scoped-views/${privateView.id}/sharing`, {
      data: { action: "readers", userIds: [reader.userId] },
    })).ok()).toBe(true);
    await expect(peer.getByRole("button", { name: "Private planning", exact: true })).toBeVisible();
    expect((await peer.request.patch(`/api/scoped-views/${privateView.id}`, { data: { name: "Changed" } })).status()).toBe(404);
    expect((await peer.request.patch(`/api/scoped-views/${table.id}`, { data: { name: "Changed" } })).status()).toBe(403);
    expect((await request.patch(`/api/scoped-views/${privateView.id}/sharing`, { data: { action: "readers", userIds: [] } })).ok()).toBe(true);
    await expect.poll(async () => {
      const { views } = await (await peer.request.get(scopeApi)).json();
      return views.map(({ id }: { id: string }) => id);
    }).not.toContain(privateView.id);
  } finally {
    await peer.close();
  }
});
