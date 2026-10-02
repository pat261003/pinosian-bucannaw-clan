import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { PGlite } from "@electric-sql/pglite";
import { mkdir } from "node:fs/promises";
import { embeddedDatabase, migrate } from "../server/src/db.js";
import { createApp } from "../server/src/app.js";
const db = embeddedDatabase(new PGlite());
await migrate(db);
const server = createApp(db).listen(3002, "127.0.0.1");
const vite = await createServer({
  root: "client",
  configFile: "client/vite.config.js",
  server: {
    port: 5174,
    host: "127.0.0.1",
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3002" },
  },
});
await vite.listen();
let browser;
try {
  await mkdir("test-results", { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5174");
  await expect(page.locator(".person-detail h2")).toHaveText("Pinosian");
  await expect(page.locator(".hierarchy-person-pair")).toContainText(
    "Bucannaw",
  );
  await expect(page.locator(".brand img")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Editor|Unlock|Login/i }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/clan-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Add family member", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Who would you like to add?" }),
  ).toBeVisible();
  await expect(page.locator(".chosen-person")).toContainText("Pinosian");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Child Their son or daughter" })
    .click();
  const form = page.getByRole("dialog");
  await expect(form.getByLabel("First name")).not.toHaveAttribute("required");
  await expect(form.getByLabel("Last name")).not.toHaveAttribute("required");
  await expect(form.getByLabel("Birth date")).not.toHaveAttribute("required");
  await expect(form.getByLabel(/^Gender/)).toHaveAttribute("required", "");
  await expect(form.getByLabel("Birth place")).not.toBeVisible();
  await form.getByText("More details", { exact: false }).click();
  await expect(form.getByLabel("Birth place")).toBeVisible();
  await form.getByLabel("Birth place").fill("Family hometown");
  await expect(form.getByLabel("Who is the other parent?")).toHaveCount(0);
  await expect(form).toContainText("Child of Pinosian and Bucannaw");
  await expect(
    page
      .locator(".relative-actions")
      .getByRole("button", { name: "Partner", exact: true }),
  ).toHaveCount(0);
  await form.getByLabel(/^Gender/).selectOption("Unknown");
  await form
    .getByRole("button", { name: "Add family member", exact: true })
    .click();
  await expect(page.locator(".person-detail h2")).toContainText(
    "Unknown member",
  );
  await expect(page.locator(".parent-row")).toHaveCount(2);
  await expect(page.locator(".facts")).toContainText("Not recorded");
  await page
    .locator(".parent-row")
    .getByRole("button", { name: "Pinosian", exact: true })
    .click();
  await expect(page.locator(".generation-children").first()).toContainText(
    "Unknown member",
  );
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await mobile.newPage();
  phone.setDefaultTimeout(15000);
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto("http://127.0.0.1:5174");
  await expect(phone.locator(".mobile-clan-brand")).toBeVisible();
  await expect(phone.locator(".generation-children").first()).toContainText(
    "Unknown member",
  );
  await phone.locator(".generation-children .tree-node").tap();
  await phone.getByRole("button", { name: "Edit", exact: true }).tap();
  await phone.getByLabel("First name").fill("Shared Family Member");
  await phone.getByRole("button", { name: "Save changes" }).tap();
  await expect(phone.locator(".person-detail h2")).toHaveText(
    "Shared Family Member",
  );
  await expect(page.locator(".generation-children").first()).toContainText(
    "Shared Family Member",
    { timeout: 20000 },
  );
  await page.reload();
  await expect(page.locator(".generation-children").first()).toContainText(
    "Shared Family Member",
  );
  await phone
    .locator(".parent-row")
    .getByRole("button", { name: "Pinosian", exact: true })
    .tap();
  await phone.getByRole("button", { name: "Edit", exact: true }).tap();
  await expect(phone.getByLabel(/^Gender/)).toHaveValue("Unknown");
  await phone.getByLabel(/^Gender/).selectOption("Female");
  await phone.getByRole("button", { name: "Save changes" }).tap();
  await expect(phone.locator(".facts")).toContainText("Female");
  await phone.getByRole("button", { name: "Zoom in", exact: true }).tap();
  await expect(phone.locator(".canvas-content")).toHaveAttribute(
    "style",
    /scale\(1\./,
  );
  await phone.getByRole("button", { name: "Center tree", exact: true }).tap();
  await expect(phone.locator(".canvas-content")).toHaveAttribute(
    "style",
    /scale\(0\.75\)/,
  );
  expect(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await phone.screenshot({
    path: "test-results/clan-mobile.png",
    fullPage: true,
  });
  await phone
    .locator(".relative-actions")
    .getByRole("button", { name: "Child", exact: true })
    .tap();
  await phone.screenshot({
    path: "test-results/clan-mobile-form.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await phone.getByRole("button", { name: "Close dialog", exact: true }).tap();
  await phone.locator(".generation-children .tree-node").tap();
  await phone
    .getByRole("button", { name: "Change parents / family", exact: true })
    .tap();
  await phone
    .getByRole("dialog")
    .getByRole("button", { name: /Bucannaw/ })
    .tap();
  await expect(phone.getByRole("dialog")).toContainText(
    "Both clan heads will be recorded",
  );
  await phone
    .getByRole("button", { name: "Save correct family", exact: true })
    .tap();
  await expect(phone.getByRole("dialog")).toHaveCount(0);
  await phone.getByRole("button", { name: "Delete person", exact: true }).tap();
  await expect(phone.getByRole("dialog")).toContainText("Shared Family Member");
  await phone.getByRole("button", { name: "Keep person", exact: true }).tap();
  await page.locator(".generation-children .tree-node").click();
  await expect(phone.locator(".person-detail h2")).toHaveText(
    "Shared Family Member",
  );
  await phone.getByRole("button", { name: "Delete person", exact: true }).tap();
  await phone.screenshot({
    path: "test-results/delete-confirmation-mobile.png",
    fullPage: true,
  });
  await phone
    .getByRole("dialog")
    .getByRole("button", { name: "Delete person", exact: true })
    .tap();
  await expect(phone.getByRole("dialog")).toHaveCount(0);
  await expect(phone.locator(".member-card")).toHaveCount(2);
  await expect(page.locator(".person-detail")).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(phone.locator(".directory")).not.toContainText(
    "Shared Family Member",
  );
  await phone
    .getByRole("button", { name: "Back to clan heads", exact: true })
    .tap();
  await expect(phone.locator(".person-detail h2")).toHaveText("Pinosian");
  await expect(
    phone.getByRole("button", { name: "Delete person", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);

  const addFixture = async (first_name, relation, birth_date = null) => {
    const response = await page.request.post(
      "http://127.0.0.1:3002/api/persons",
      { data: { first_name, gender: "Unknown", birth_date, relation } },
    );
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const grandchild = await addFixture("Grandchild entered first");
  const heads = await (
    await page.request.get("http://127.0.0.1:3002/api/heads")
  ).json();
  const older = await addFixture(
    "Z eldest",
    { type: "child", person_id: heads[0].id },
    "1950-01-01",
  );
  const younger = await addFixture(
    "A youngest",
    { type: "child", person_id: heads[0].id },
    "1970-01-01",
  );
  await page.request.put(
    "http://127.0.0.1:3002/api/persons/" + grandchild.id + "/parents",
    { data: { parent_ids: [older.id] } },
  );
  await page.reload();
  await expect(
    page.locator('[data-generation="1"] > .hierarchy-person-heading'),
  ).toContainText("Pinosian");
  await expect(
    page.locator('[data-person-id="' + grandchild.id + '"]'),
  ).toHaveAttribute("data-generation", "3");
  await page
    .getByRole("button", { name: "View Grandchild entered first", exact: true })
    .click();
  await expect(page.locator(".person-detail h2")).toHaveText(
    "Grandchild entered first",
  );
  await expect(
    page.locator('[data-generation="1"] > .hierarchy-person-heading'),
  ).toContainText("Bucannaw");
  await page.getByRole("button", { name: "Simple tree", exact: true }).click();
  await expect(page.locator(".outline-scroll")).toContainText(
    "Grandchild entered first",
  );
  await page
    .getByRole("button", { name: "Arrange children", exact: true })
    .click();
  await expect(page.locator(".child-order-editor li").first()).toContainText(
    "Z eldest",
  );
  await page
    .getByRole("button", { name: "Move A youngest earlier", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save birth order", exact: true })
    .click();
  await expect(page.locator(".child-order-editor")).toHaveCount(0);
  await expect(
    page
      .locator(".outline-children")
      .first()
      .locator(":scope > .outline-person")
      .first(),
  ).toHaveAttribute("data-person-id", younger.id);
  await page.screenshot({
    path: "test-results/simple-tree-desktop.png",
    fullPage: true,
  });
  await phone.reload();
  await phone.getByRole("button", { name: "Simple tree", exact: true }).tap();
  await expect(
    phone
      .locator(".outline-children")
      .first()
      .locator(":scope > .outline-person")
      .first(),
  ).toHaveAttribute("data-person-id", younger.id);
  await phone
    .getByRole("button", { name: "Expand family of Z eldest", exact: true })
    .tap();
  await expect(phone.locator(".outline-scroll")).toContainText(
    "Grandchild entered first",
  );
  expect(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await phone.getByRole("button",{name:"Arrange children",exact:true}).tap();
  await expect(phone.getByRole("dialog",{name:"Arrange children"})).toBeVisible();
  expect(await phone.getByRole("dialog").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await phone.screenshot({path:"test-results/arrange-children-mobile.png",fullPage:true});
  await phone.getByRole("button",{name:"Cancel",exact:true}).tap();
  await phone.screenshot({
    path: "test-results/simple-tree-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Generation tree", exact: true })
    .click();
  await expect(
    page.locator('[data-person-id="' + grandchild.id + '"]'),
  ).toHaveAttribute("data-generation", "3");
  await page.screenshot({
    path: "test-results/generation-tree-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS: clan logo, seeded editable heads, unrestricted edits, optional fields, required gender, separate-browser automatic sync, reload persistence, mobile layout and zoom; anchored generations, simple tree, saved sibling ordering, and mobile ordering dialog.",
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  const timeout = setTimeout(() => process.exit(process.exitCode || 0), 5000);
  timeout.unref();
  await browser?.close();
  vite.httpServer?.closeAllConnections();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await vite.close();
  await db.close();
}
