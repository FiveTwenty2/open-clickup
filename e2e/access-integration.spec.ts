import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, name: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(`${name}@clickuppp.dev`);
  await page.locator('input[type="password"]').fill("password");
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/home");
}

test("privacy follows a task across lists and applies to downloads and pre-existing public links", async ({ page, browser }) => {
  await login(page, "santiago");
  const { workspace } = await (await page.request.get("/api/bootstrap")).json();
  const maya = workspace.members.find((member: { user: { name: string } }) => member.user.name === "Maya Chen").user;
  const spaceId = workspace.spaces[0].id;
  const stamp = Date.now();
  const createList = async (name: string) => {
    const response = await page.request.post("/api/lists", { data: { spaceId, name } });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const home = await createList("Private work " + stamp);
  const other = await createList("Shared work " + stamp);
  const name = "Cross-list restricted task " + stamp;
  const renamed = `${name} updated`;
  const made = await page.request.post("/api/tasks", { data: { listId: home.id, name } });
  expect(made.status()).toBe(201);
  const task = await made.json();
  expect((await page.request.post(`/api/tasks/${task.id}/lists`, { data: { listId: other.id } })).ok()).toBeTruthy();
  const uploaded = await page.request.post(`/api/tasks/${task.id}/attachments`, { multipart: {
    file: { name: "Restricted.txt", mimeType: "text/plain", buffer: Buffer.from("Restricted test data") },
  } });
  expect(uploaded.status()).toBe(201);
  const file = await uploaded.json();
  const share = await page.request.post(`/api/tasks/${task.id}/public-share`);
  expect(share.ok()).toBeTruthy();
  const { key } = await share.json();
  const { list: { views } } = await (await page.request.get(`/api/lists/${other.id}`)).json();
  const publicView = `/api/views/${views[0].id}/sharing`;
  expect((await page.request.patch(publicView, { data: { action: "enable" } })).ok()).toBeTruthy();
  const { key: viewKey } = await (await page.request.get(publicView)).json();
  const publicViewData = `/api/public/views/${viewKey}`;

  const baseURL = new URL(page.url()).origin;
  const peer = await browser.newPage({ baseURL });
  const anonymous = await browser.newContext({ baseURL });
  const privacy = `/api/access/list/${home.id}`;
  let tokenId: string | undefined;
  try {
    await login(peer, "maya");
    const tokenResponse = await peer.request.post("/api/me/api-tokens", { data: { name: `Privacy regression ${stamp}` } });
    expect(tokenResponse.status()).toBe(201);
    const token = await tokenResponse.json();
    tokenId = token.id;
    const headers = { Authorization: `Bearer ${token.token}` };
    await peer.goto(`/l/${other.id}`);
    await expect(peer.getByText(name, { exact: true }).first()).toBeVisible();
    expect((await anonymous.request.get(`/api/public/tasks/${key}`)).status()).toBe(200);
    const before = await (await anonymous.request.get(publicViewData)).json();
    expect(before.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: task.id })]));
    expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { name: renamed } })).ok()).toBeTruthy();
    await expect(peer.getByText(renamed, { exact: true }).first()).toBeVisible();
    expect((await page.request.patch(privacy, { data: { private: true, grants: [] } })).ok()).toBeTruthy();
    await expect(peer.getByText(renamed, { exact: true })).toHaveCount(0);
    expect((await peer.request.get(`/api/tasks/${task.id}`)).status()).toBe(404);
    expect((await anonymous.request.get(`/api/tasks/${task.id}`, { headers })).status()).toBe(404);
    expect((await peer.request.get(file.url)).status()).toBe(404);
    const search = await (await peer.request.get("/api/search?q=" + encodeURIComponent(renamed))).json();
    expect(search.tasks).toEqual([]);
    expect((await anonymous.request.get(`/api/public/tasks/${key}`)).status()).toBe(404);
    const after = await (await anonymous.request.get(publicViewData)).json();
    expect(after.tasks).toEqual([]);

    const madeTeam = await page.request.post("/api/workspace/access-teams", { data: { name: "Restricted project " + stamp, userIds: [maya.id] } });
    expect(madeTeam.ok()).toBeTruthy();
    const team = await madeTeam.json();
    expect((await page.request.patch(privacy, { data: {
      private: true, grants: [{ subjectType: "team", subjectId: team.id, permission: "VIEW" }],
    } })).ok()).toBeTruthy();
    expect((await peer.request.get(`/api/tasks/${task.id}`)).status()).toBe(200);
    expect((await anonymous.request.get(`/api/tasks/${task.id}`, { headers })).status()).toBe(200);
    expect(await (await peer.request.get(file.url)).text()).toBe("Restricted test data");
    const edit = await peer.request.patch(`/api/tasks/${task.id}`, { data: { name: "Should not change" } });
    expect([403, 404]).toContain(edit.status());
    expect((await anonymous.request.get(`/api/public/tasks/${key}`)).status()).toBe(404);
    expect((await page.request.patch(privacy, { data: { private: true, grants: [] } })).ok()).toBeTruthy();
    expect((await peer.request.get(file.url)).status()).toBe(404);
  } finally {
    if (tokenId) await peer.request.delete("/api/me/api-tokens", { data: { id: tokenId } });
    await peer.close();
    await anonymous.close();
  }
});
