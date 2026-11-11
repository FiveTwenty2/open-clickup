import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, name: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(`${name}@clickuppp.dev`);
  await page.locator('input[type="password"]').fill("password");
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/home");
}

test("delivers a comment mention with a private attachment and keeps the archive audit trail", async ({ page, browser }) => {
  await login(page, "santiago");
  const teammate = await browser.newPage({ baseURL: new URL(page.url()).origin });
  try {
    await login(teammate, "maya");
    await teammate.getByRole("button", { name: /^Inbox/ }).click();
    await page.locator("aside").getByText("Backlog", { exact: true }).click();
    await page.waitForURL(/\/l\//);
    const listId = new URL(page.url()).pathname.split("/").at(-1);
    const name = `Audit and mention ${Date.now()}`;
    const response = await page.request.post("/api/tasks", { data: { listId, name } });
    expect(response.status()).toBe(201);
    const task = await response.json();
    await page.getByText(name, { exact: true }).click();
    const editor = page.getByRole("dialog").locator(".tiptap[contenteditable]").last();
    await editor.pressSequentially("@Maya");
    await page.getByRole("button", { name: "Maya Chen", exact: true }).click();
    await expect(editor.locator(".mention")).toHaveText("@Maya Chen");
    await page.getByLabel("Attach files to comment").setInputFiles({
      name: "project-notes.txt", mimeType: "text/plain", buffer: Buffer.from("Project notes"),
    });
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    const notification = teammate.getByRole("button", { name: new RegExp("mentioned you in a comment.*" + name) });
    await expect(notification).toBeVisible();
    await notification.click();
    await expect(teammate).toHaveURL(/&comment=/);
    const attachment = teammate.getByRole("link", { name: "project-notes.txt" });
    await expect(attachment).toBeVisible();
    const url = (await attachment.getAttribute("href"))!;
    const download = await teammate.request.get(url);
    expect(await download.text()).toBe("Project notes");
    expect(download.headers()["content-disposition"]).toContain("attachment;");
    const anonymous = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      expect((await anonymous.request.get(url)).status()).toBe(401);
    } finally {
      await anonymous.close();
    }

    const thread = teammate.locator('[id^="comment-"]').filter({ has: attachment });
    await thread.getByRole("button", { name: "Reply", exact: true }).click();
    await thread.getByLabel("Attach files to reply").setInputFiles({
      name: "reply.txt", mimeType: "text/plain", buffer: Buffer.from("Reply notes"),
    });
    await thread.locator("form").getByRole("button", { name: "Reply", exact: true }).click();
    await expect(thread.getByRole("link", { name: "reply.txt" })).toBeVisible();
    const senderInbox = await page.request.get("/api/notifications");
    expect((await senderInbox.json()).notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "reply", taskId: task.id }),
    ]));

    await expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { archived: true } })).ok()).toBeTruthy();
    await expect((await page.request.delete(`/api/tasks/${task.id}`)).ok()).toBeTruthy();
    await expect((await page.request.post("/api/tasks/recovery", { data: { id: task.id } })).ok()).toBeTruthy();
    await page.goto("/audit");
    await page.getByLabel("Search by task name").fill(name);
    await page.getByLabel("Audit action").selectOption("recovery");
    for (const action of ["Archived", "Moved to Trash", "Restored from Trash"]) {
      await expect(page.getByRole("listitem").filter({ hasText: new RegExp(action + " · " + name) })).toBeVisible();
    }
    expect((await teammate.request.get("/api/audit")).status()).toBe(403);
  } finally {
    await teammate.close();
  }
});

test("delivers private messages live and restores archived notifications", async ({ page, browser }) => {
  await login(page, "santiago");
  const teammate = await browser.newPage({ baseURL: new URL(page.url()).origin });
  try {
    await login(teammate, "maya");
    await teammate.getByRole("button", { name: "Messages", exact: true }).click();
    await teammate.getByRole("link", { name: "Santiago Cotto", exact: true }).click();
    await expect(teammate.getByRole("heading", { name: "Santiago Cotto" })).toBeVisible();
    await page.getByRole("button", { name: "Messages", exact: true }).click();
    await page.getByRole("link", { name: "Maya Chen", exact: true }).click();
    const message = `Private update ${Date.now()}`;
    await page.getByRole("textbox", { name: "Message", exact: true }).fill(message);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(teammate.getByText(message, { exact: true })).toBeVisible();
    await teammate.getByRole("button", { name: /^Inbox/ }).click();
    const notification = teammate.getByRole("button", { name: /sent you a direct message/ }).first();
    await expect(notification).toBeVisible();
    const id = await notification.locator("..").getAttribute("data-notification-id");
    const row = teammate.locator(`[data-notification-id="${id}"]`);
    await row.getByRole("button", { name: "Archive notification" }).click();
    await teammate.getByRole("button", { name: "Archive", exact: true }).click();
    await row.getByRole("button", { name: "Restore notification" }).click();
    await expect(row.getByRole("button", { name: "Restore notification" })).toHaveCount(0);
    await teammate.getByRole("button", { name: "Unread", exact: true }).click();
    await expect(row.getByRole("button", { name: /sent you a direct message/ })).toBeVisible();
  } finally {
    await teammate.close();
  }
});
