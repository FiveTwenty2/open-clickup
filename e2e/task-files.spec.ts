import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

test("requires an authenticated session to download task attachment bytes", async ({ page, browser }) => {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill("santiago@clickuppp.dev");
  await page.locator('input[type="password"]').fill("password");
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL("**/home");
  const href = await page.locator("aside").getByRole("link", { name: "Backlog", exact: true }).getAttribute("href");
  const listId = href?.split("/").at(-1);
  expect(listId).toBeTruthy();
  const result = await page.request.post("/api/tasks", { data: { listId, name: "Protected file " + Date.now() } });
  expect(result.status()).toBe(201);
  const task = await result.json();
  const response = await page.request.post(`/api/tasks/${task.id}/attachments`, { multipart: {
    file: { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Task notes") },
  } });
  expect(response.status()).toBe(201);
  const attachment = await response.json();
  expect(attachment).not.toHaveProperty("blob");
  const file = await page.request.get(attachment.url);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-disposition"]).toContain("attachment");
  expect(file.headers()["cache-control"]).toContain("no-store");
  expect(await file.text()).toBe("Task notes");

  const legacyName = `${randomUUID()}.txt`;
  const legacyUrl = `/uploads/${legacyName}`;
  const directory = path.join(process.cwd(), "public", "uploads");
  const legacyPath = path.join(directory, legacyName);
  await mkdir(directory, { recursive: true });
  await writeFile(legacyPath, "Legacy task notes", { flag: "wx" });
  const anonymous = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const legacyId = randomUUID();
  try {
    await db.connect();
    await db.query('INSERT INTO "Attachment" (id, "taskId", name, url, mime, size) VALUES ($1, $2, $3, $4, $5, $6)',
      [legacyId, task.id, "Legacy notes.txt", legacyUrl, "text/plain", 17]);
    const legacyFile = await page.request.get(legacyUrl);
    expect(legacyFile.status()).toBe(200);
    expect(await legacyFile.text()).toBe("Legacy task notes");
    expect((await anonymous.request.get(attachment.url)).status()).toBe(401);
    expect((await anonymous.request.get(legacyUrl)).status()).toBe(401);
    for (const alternate of [`/%75ploads/${legacyName}`, `/Uploads/${legacyName}`]) {
      const result = await anonymous.request.get(alternate, { maxRedirects: 0 });
      expect(result.ok()).toBeFalsy();
    }
    expect((await anonymous.request.get("/_next/image?url=" + encodeURIComponent(legacyUrl) + "&w=64&q=75")).status()).toBe(400);
    expect((await page.request.delete(`/api/attachments/${legacyId}`)).ok()).toBeTruthy();
  } finally {
    await db.end();
    await anonymous.close();
    await unlink(legacyPath).catch(() => {});
  }

  expect((await page.request.delete(attachment.url)).ok()).toBeTruthy();
  expect((await page.request.get(attachment.url)).status()).toBe(404);
});
