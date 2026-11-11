import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, account: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(`${account}@clickuppp.dev`);
  await page.locator('input[type="password"]').fill("password");
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/home");
}

test("sharing controls apply to every hierarchy level and guest permissions apply to task actions", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await login(page, "santiago");
  const suffix = Date.now();
  const guestName = `Privacy guest ${suffix}`;
  const adminName = `Privacy admin ${suffix}`;
  const spaceName = `Sharing space ${suffix}`;
  const folderName = `Sharing folder ${suffix}`;
  const listName = `Sharing list ${suffix}`;
  const taskName = `Sharing task ${suffix}`;
  async function create(url: string, data: object) {
    const response = await page.request.post(url, { data });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  }
  const space = await create("/api/spaces", { name: spaceName });
  const folder = await create("/api/folders", { spaceId: space.id, name: folderName });
  const list = await create("/api/lists", { spaceId: space.id, folderId: folder.id, name: listName });
  const task = await create("/api/tasks", { listId: list.id, name: taskName });
  const taskUrl = `/api/tasks/${task.id}`;
  const guest = await browser.newPage({ baseURL: new URL(page.url()).origin });
  const admin = await browser.newPage({ baseURL: new URL(page.url()).origin });
  async function inviteAccount(account: Page, name: string, role: "GUEST" | "ADMIN") {
    const email = `privacy-${role.toLowerCase()}-${suffix}@example.com`;
    const { path } = await create("/api/workspace/invitations", { email, role });
    const signup = await account.request.post("/api/auth/signup", {
      data: { email, name, password: "local-test-password", invite: new URL(path, page.url()).searchParams.get("invite") },
    });
    expect(signup.status(), await signup.text()).toBe(201);
    return (await signup.json()).id as string;
  }
  let guestId: string | undefined;
  let adminId: string | undefined;
  const path = { space: space.id, folder: folder.id, list: list.id, task: task.id };
  const accessUrl = (kind: keyof typeof path) => `/api/access/${kind}/${path[kind]}`;
  const assertGuestTask = async (status: number) => expect((await guest.request.get(taskUrl)).status()).toBe(status);
  async function makePrivate(kind: keyof typeof path, name: string) {
    const menu = kind === "list" ? page.getByRole("link", { name, exact: true }) : page.getByRole("button", { name, exact: true });
    await menu.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Sharing & permissions" }).click();
    const dialog = page.getByRole("dialog", { name: "Sharing & permissions" });
    await dialog.getByRole("checkbox", { name: `Make this ${kind} private` }).check();
    await dialog.getByRole("button", { name: "Save permissions" }).click();
    await expect(dialog).toHaveCount(0);
  }
  async function grant(kind: keyof typeof path, permission: string, teamId?: string) {
    const response = await page.request.patch(accessUrl(kind), { data: {
      private: true,
      grants: [
        { subjectType: "person", subjectId: guestId, permission },
        ...(teamId ? [{ subjectType: "team", subjectId: teamId, permission: "EDIT" }] : []),
      ],
    } });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  try {
    guestId = await inviteAccount(guest, guestName, "GUEST");
    adminId = await inviteAccount(admin, adminName, "ADMIN");
    await page.goto(`/l/${list.id}`);
    await assertGuestTask(200);
    expect((await guest.request.post(`${taskUrl}/comments`, { data: { body: "Disallowed" } })).status()).toBe(403);

    await makePrivate("space", spaceName);
    await assertGuestTask(404);
    expect((await admin.request.get(taskUrl)).status()).toBe(404);
    expect((await page.request.patch(accessUrl("space"), { data: { private: true, grants: [
      { subjectType: "person", subjectId: adminId, permission: "VIEW" },
    ] } })).ok()).toBeTruthy();
    expect((await admin.request.get(taskUrl)).status()).toBe(200);
    await grant("space", "VIEW");
    await assertGuestTask(200);
    await makePrivate("folder", folderName);
    await assertGuestTask(404);
    await grant("folder", "VIEW");
    await assertGuestTask(200);
    await page.getByRole("button", { name: folderName, exact: true }).click();
    await makePrivate("list", listName);
    await assertGuestTask(404);
    await grant("list", "VIEW");
    await assertGuestTask(200);
    expect((await guest.request.patch(`/api/lists/${list.id}`, { data: { name: listName } })).status()).toBe(403);
    await grant("list", "EDIT");
    expect((await guest.request.patch(`/api/lists/${list.id}`, { data: { name: listName } })).status()).toBe(200);
    await grant("list", "VIEW");

    await page.goto(`/l/${list.id}?task=${task.id}`);
    const taskDialog = page.getByRole("dialog", { name: "Task details" });
    await taskDialog.getByRole("button", { name: "Sharing & permissions" }).click();
    const sharing = page.getByRole("dialog", { name: "Sharing & permissions" });
    await sharing.getByRole("checkbox", { name: "Make this task private" }).check();
    await sharing.getByRole("button", { name: "Save permissions" }).click();
    await expect(sharing).toHaveCount(0);
    await assertGuestTask(404);

    const comment = { body: "Guest with comment permission", files: {
      name: "Notes.txt", mimeType: "text/plain", buffer: Buffer.from("Authorized comment file"),
    } };
    await taskDialog.getByRole("button", { name: "Sharing & permissions" }).click();
    await sharing.getByRole("button", { name: "Manage teams" }).click();
    const teamName = `Sharing team ${suffix}`;
    await sharing.getByRole("textbox", { name: "Team name" }).fill(teamName);
    await sharing.getByRole("checkbox", { name: guestName }).check();
    await sharing.getByRole("button", { name: "Create team" }).click();
    await expect(sharing.getByRole("option", { name: `${teamName} (team)` })).toHaveCount(1);
    await sharing.getByRole("button", { name: "Cancel" }).click();
    const teams = await (await page.request.get("/api/workspace/access-teams")).json();
    const team = teams.find((value: { name: string }) => value.name === teamName);
    await grant("task", "COMMENT", team.id);
    expect((await guest.request.patch(taskUrl, { data: { name: "Disallowed" } })).status()).toBe(403);
    const madeComment = await guest.request.post(`${taskUrl}/comments`, { multipart: comment });
    expect(madeComment.status(), await madeComment.text()).toBe(201);
    const attachment = (await madeComment.json()).files[0];
    expect(await (await guest.request.get(`/api/comment-files/${attachment.id}`)).text()).toBe("Authorized comment file");
    const upload = { multipart: { file: comment.files } };
    expect((await guest.request.post(`${taskUrl}/attachments`, upload)).status()).toBe(403);
    await grant("task", "EDIT");
    expect((await guest.request.patch(taskUrl, { data: { name: taskName + " edited" } })).status()).toBe(200);
    expect((await guest.request.post(`${taskUrl}/attachments`, upload)).status()).toBe(201);
    expect((await guest.request.delete(taskUrl)).status()).toBe(403);
    await grant("task", "FULL");
    const selfRevoke = await guest.request.patch(accessUrl("task"), { data: { private: true, grants: [] } });
    expect(selfRevoke.ok(), await selfRevoke.text()).toBeTruthy();
    await assertGuestTask(404);
    await grant("task", "FULL");
    expect((await guest.request.delete(taskUrl)).status()).toBe(200);
    await assertGuestTask(404);
  } finally {
    await guest.close();
    await admin.close();
    for (const userId of [guestId, adminId]) {
      if (userId) await page.request.patch("/api/workspace/members", { data: { userId, role: null } });
    }
  }
});

test("workspace templates omit private content and recurring occurrences preserve access", async ({ page, browser }) => {
  await login(page, "santiago");
  const { workspace } = await (await page.request.get("/api/bootstrap")).json();
  const sharedUser = workspace.members.find((member: { user: { email: string } }) => member.user.email === "maya@clickuppp.dev").user;
  const suffix = Date.now();
  const spaceId = workspace.spaces[0].id;
  const list = await (await page.request.post("/api/lists", { data: { spaceId, name: `Privacy recurrence ${suffix}` } })).json();
  const listUrl = `/api/lists/${list.id}`;
  const details = await (await page.request.get(listUrl)).json();
  const doneId = details.list.statuses.find((status: { type: string }) => status.type === "DONE").id;
  const privateName = `Private daily review ${suffix}`;
  const publicName = `Workspace-visible task ${suffix}`;
  const privateTask = await (await page.request.post("/api/tasks", { data: { listId: list.id, name: privateName } })).json();
  const publicTaskResponse = await page.request.post("/api/tasks", { data: { listId: list.id, name: publicName } });
  expect(publicTaskResponse.status()).toBe(201);
  const publicTask = await publicTaskResponse.json();
  const childName = `Workspace-visible child ${suffix}`;
  expect((await page.request.post("/api/tasks", { data: { listId: list.id, parentId: publicTask.id, name: childName } })).status()).toBe(201);
  const taskUrl = `/api/tasks/${privateTask.id}`;
  const privateTaskUrl = `/api/access/task/${privateTask.id}`;
  const grants = [{ subjectType: "person", subjectId: sharedUser.id, permission: "VIEW" }];
  expect((await page.request.patch(privateTaskUrl, { data: { private: true, grants } })).ok()).toBeTruthy();

  const taskTemplate = await page.request.post("/api/templates", { data: { fromTaskId: privateTask.id, name: "Private task template" } });
  expect(taskTemplate.status()).toBe(403);
  const privateList = await (await page.request.post("/api/lists", { data: { spaceId, name: `Private list ${suffix}` } })).json();
  expect((await page.request.patch(`/api/access/list/${privateList.id}`, { data: { private: true, grants: [] } })).ok()).toBeTruthy();
  const listTemplate = await page.request.post("/api/list-templates", { data: { sourceListId: privateList.id, name: "Private list template" } });
  expect(listTemplate.status()).toBe(403);

  const copied = await page.request.post(`${taskUrl}/duplicate`);
  expect(copied.status()).toBe(201);
  const copy = await copied.json();
  const template = await page.request.post("/api/list-templates", { data: {
    sourceListId: list.id, name: `Visible tasks only ${suffix}`, includeTasks: true,
  } });
  expect(template.status(), await template.text()).toBe(201);
  const listFromTemplate = await page.request.put("/api/list-templates", { data: {
    spaceId, templateId: (await template.json()).id, name: `Visible copy ${suffix}`, includeTasks: true,
  } });
  expect(listFromTemplate.status(), await listFromTemplate.text()).toBe(201);
  const snapshot = await (await page.request.get(`/api/lists/${(await listFromTemplate.json()).id}`)).json();
  expect(snapshot.tasks.map((task: { name: string }) => task.name)).toEqual([publicName]);
  expect(snapshot.allTasks.find((task: { name: string }) => task.name === childName)?.parentId).toBe(snapshot.tasks[0].id);

  expect((await page.request.patch(taskUrl, { data: { recurrence: "DAILY" } })).status()).toBe(200);
  const complete = await page.request.patch(taskUrl, { data: { statusId: doneId } });
  expect(complete.status(), await complete.text()).toBe(200);
  const next = (await (await page.request.get(listUrl)).json()).tasks.find(
    (task: { id: string; name: string }) => task.name === privateName && task.id !== privateTask.id,
  );
  expect(next).toBeTruthy();

  const folder = await (await page.request.post("/api/folders", { data: { spaceId, name: `Private folder ${suffix}` } })).json();
  const left = await (await page.request.post("/api/lists", { data: { spaceId, folderId: folder.id, name: "Private left" } })).json();
  const right = await (await page.request.post("/api/lists", { data: { spaceId, folderId: folder.id, name: "Private right" } })).json();
  expect((await page.request.patch(`/api/access/folder/${folder.id}`, { data: { private: true, grants: [] } })).ok()).toBeTruthy();
  const movingTask = await (await page.request.post("/api/tasks", { data: { listId: left.id, name: "Move inside private folder" } })).json();
  const moveUrl = `/api/tasks/${movingTask.id}/move`;
  const allowedMove = await page.request.post(moveUrl, { data: { listId: right.id } });
  expect(allowedMove.status(), await allowedMove.text()).toBe(200);
  expect((await page.request.post(moveUrl, { data: { listId: list.id } })).status()).toBe(403);

  const baseURL = new URL(page.url()).origin;
  const shared = await browser.newPage({ baseURL });
  const unshared = await browser.newPage({ baseURL });
  try {
    await login(shared, "maya");
    await login(unshared, "lucas");
    expect((await shared.request.get(`/api/tasks/${next.id}`)).status()).toBe(200);
    expect((await unshared.request.get(`/api/tasks/${next.id}`)).status()).toBe(404);
    expect((await unshared.request.get(`/api/tasks/${copy.id}`)).status()).toBe(404);
    expect((await page.request.patch(`/api/access/task/${next.id}`, { data: { private: true, grants: [] } })).ok()).toBeTruthy();
    expect((await shared.request.get(`/api/tasks/${next.id}`)).status()).toBe(404);
  } finally {
    await shared.close();
    await unshared.close();
  }
});
