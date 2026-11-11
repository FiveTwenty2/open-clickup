import { expect, test, type Page } from "@playwright/test";

async function createList(page: Page, name: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill("santiago@clickuppp.dev");
  await page.locator('input[type="password"]').fill("password");
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/home");
  const { workspace, currentUser } = await (await page.request.get("/api/bootstrap")).json();
  const response = await page.request.post("/api/lists", { data: { spaceId: workspace.spaces[0].id, name } });
  expect(response.status()).toBe(201);
  return { list: await response.json(), workspace, currentUser };
}

test("publishes a form, accepts a guest response as a task, and unpublishes the link", async ({ page, browser }) => {
  const { list } = await createList(page, `Form list ${Date.now()}`);
  await page.goto(`/l/${list.id}`);
  await page.getByRole("button", { name: "List actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Intake forms", exact: true }).click();
  await page.getByLabel("Form title", { exact: true }).fill("Request intake");
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  await page.getByLabel("Question 1 label").fill("Request category");
  await page.getByLabel("Question 1 type").selectOption("choice");
  await page.getByLabel("Options, one per line").fill("Support\nFeedback");
  await page.getByRole("checkbox", { name: "Required", exact: true }).check();
  await page.getByRole("checkbox", { name: "Publish for anyone with the link" }).check();
  await page.getByRole("button", { name: "Save form" }).click();
  const publicLink = page.getByRole("link", { name: "Open public form" });
  await expect(publicLink).toBeVisible();
  const href = (await publicLink.getAttribute("href"))!;
  const key = href.split("/").at(-1)!;
  const baseURL = new URL(page.url()).origin;
  const visitor = await browser.newContext({ baseURL });
  try {
    const invalid = await visitor.request.post(`/api/public/forms/${key}`, { data: { name: "Incomplete", answers: {} } });
    expect(invalid.status()).toBe(400);
    const outside = await visitor.newPage();
    await outside.goto(href);
    await expect(outside.getByRole("heading", { name: "Request intake" })).toBeVisible();
    await outside.getByRole("textbox", { name: "Task name", exact: true }).fill("New customer request");
    await outside.getByLabel("Request category").selectOption("Support");
    await outside.getByRole("button", { name: "Submit response" }).click();
    await expect(outside.getByText("Response received.", { exact: true })).toBeVisible();
    const result = await (await page.request.get(`/api/lists/${list.id}`)).json();
    expect(result.tasks).toEqual([expect.objectContaining({ name: "New customer request", description: expect.stringContaining("Support") })]);
    await page.getByRole("checkbox", { name: "Publish for anyone with the link" }).uncheck();
    await page.getByRole("button", { name: "Save form" }).click();
    await expect(publicLink).toHaveCount(0);
    expect((await visitor.request.get(`/api/public/forms/${key}`)).status()).toBe(404);
  } finally {
    await visitor.close();
  }
});

test("links tasks both ways and shows a shared estimate in weekly workload", async ({ page }) => {
  const { list, workspace, currentUser } = await createList(page, `Workload list ${Date.now()}`);
  const peer = workspace.members.find((member: { user: { name: string } }) => member.user.name === "Maya Chen").user;
  const make = async (name: string, extra = {}) => {
    const result = await page.request.post("/api/tasks", { data: { listId: list.id, name, ...extra } });
    expect(result.status()).toBe(201);
    return result.json();
  };
  const task = await make("Capacity planning task", { assigneeIds: [currentUser.id, peer.id], dueDate: new Date().toISOString() });
  const targetName = `Relationship target ${Date.now()}`;
  const other = await make(targetName);
  expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { timeEstimate: 360 } })).ok()).toBeTruthy();
  await page.goto(`/l/${list.id}?task=${task.id}`);
  const relationships = page.getByRole("region", { name: "Relationships" });
  await expect(relationships).toBeVisible();
  await relationships.getByRole("button", { name: "Link task" }).click();
  await relationships.getByLabel("Find related task").fill(targetName);
  await relationships.getByRole("button", { name: new RegExp(targetName) }).click();
  await expect(relationships.getByRole("link", { name: targetName, exact: true })).toBeVisible();
  await relationships.getByRole("button", { name: "Add web link" }).click();
  await relationships.getByLabel("Link label").fill("Project reference");
  await relationships.getByLabel("Web address").fill("https://example.com/project");
  await relationships.getByRole("button", { name: "Save link" }).click();
  await expect(relationships.getByRole("link", { name: "Project reference" })).toHaveAttribute("href", "https://example.com/project");
  const reverse = await (await page.request.get(`/api/tasks/${other.id}/relationships`)).json();
  expect(reverse.related).toEqual([expect.objectContaining({ task: expect.objectContaining({ id: task.id }) })]);

  await page.goto(`/l/${list.id}`);
  await page.getByText(task.name, { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Convert to milestone", exact: true }).click();
  await expect(page.getByRole("img", { name: "Milestone", exact: true })).toBeVisible();
  await page.goto("/workload");
  await page.getByLabel("Workload list", { exact: true }).selectOption(list.id);
  const maya = page.locator("section").filter({ has: page.getByRole("heading", { name: "Maya Chen", exact: true }) });
  await expect(maya).toContainText("3 h estimated");
  await maya.getByText("View tasks", { exact: true }).click();
  await expect(maya.getByRole("link", { name: "Capacity planning task" })).toBeVisible();
});
