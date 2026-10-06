import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { embeddedDatabase, migrate } from "../server/src/db.js";
import { createApp } from "../server/src/app.js";
const db = embeddedDatabase(new PGlite());
await migrate(db);
const heads = (
  await db.query("SELECT person_id FROM clan_heads ORDER BY position")
).rows.map((h) => h.person_id);
const tangaya = randomUUID(),
  partner = randomUUID(),
  ids = Array.from({ length: 500 }, () => randomUUID());
await db.query(
  "INSERT INTO persons(id,first_name,gender) VALUES($1,'Tangaya','Unknown'),($2,'Partner Example','Unknown')",
  [tangaya, partner],
);
const union = (
  await db.query(
    "INSERT INTO unions(person1_id,person2_id) VALUES($1,$2) RETURNING id",
    [tangaya, partner],
  )
).rows[0].id;
const headUnion = (
  await db.query("SELECT id FROM unions WHERE person1_id=$1 OR person2_id=$1", [
    heads[0],
  ])
).rows[0].id;
for (const h of heads)
  await db.query(
    "INSERT INTO parent_child_relationships(parent_id,child_id,union_id) VALUES($1,$2,$3)",
    [h, tangaya, headUnion],
  );
const people = ids.map((id, i) => ({
  id,
  first_name:
    i < 5
      ? ("Long Name " + i + " ").padEnd(100, "n")
      : "Descendant " + String(i + 1).padStart(3, "0"),
  middle_name: i < 5 ? "m".repeat(100) : "",
  last_name: i < 5 ? "s".repeat(100) : "",
  suffix: i < 5 ? "j".repeat(30) : "",
  gender: "Unknown",
}));
await db.query(
  "INSERT INTO persons(id,first_name,middle_name,last_name,suffix,gender) SELECT id,first_name,middle_name,last_name,suffix,gender FROM jsonb_to_recordset($1::jsonb) AS p(id uuid,first_name text,middle_name text,last_name text,suffix text,gender text)",
  [JSON.stringify(people)],
);
const links = ids.map((id, i) => ({
  parent_id: i < 20 ? tangaya : ids[Math.floor((i - 20) / 4)],
  child_id: id,
  union_id: i < 20 ? union : null,
}));
for (let i = 0; i < 20; i++)
  links.push({ parent_id: partner, child_id: ids[i], union_id: union });
await db.query(
  "INSERT INTO parent_child_relationships(parent_id,child_id,union_id) SELECT parent_id,child_id,union_id FROM jsonb_to_recordset($1::jsonb) AS r(parent_id uuid,child_id uuid,union_id uuid)",
  [JSON.stringify(links)],
);
const server = createApp(db).listen(3003, "127.0.0.1");
const vite = await createServer({
  root: "client",
  configFile: "client/vite.config.js",
  server: {
    port: 5175,
    host: "127.0.0.1",
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3003" },
  },
});
await vite.listen();
let browser;
try {
  await mkdir("test-results", { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5175");
  await page.getByRole("button", { name: "View Tangaya", exact: true }).click();
  await expect(page.locator(".person-detail h2")).toHaveText("Tangaya");
  await page
    .getByRole("button", { name: "Print family tree", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prepare print preview", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("500 descendants");
  await expect(page.locator(".print-preview")).toContainText("Descendant 500");
  await page
    .getByLabel("What would you like to print?")
    .selectOption("immediate");
  await page
    .getByRole("button", { name: "Prepare print preview", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Immediate family only");
  await expect(page.locator(".print-preview")).not.toContainText(
    "Descendant 500",
  );
  await expect(page.locator(".print-preview")).toContainText("Descendant 020");
  await expect(page.locator(".print-preview")).toContainText("Status unknown");
  await page.getByLabel("What would you like to print?").selectOption("branch");
  await page
    .getByRole("button", { name: "Prepare print preview", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("500 descendants");
  const expectedPages = await page
    .locator("#family-print-document .family-print-page")
    .count();
  expect(expectedPages).toBeLessThan(60);
  const pageGroups = await page
    .locator("#family-print-document .family-print-page")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.querySelectorAll(".print-family-group").length),
    );
  expect(Math.max(...pageGroups)).toBeGreaterThan(1);
  const childRows = await page
    .locator("#family-print-document .print-family-group")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.querySelectorAll(".print-children li").length),
    );
  expect(Math.max(...childRows)).toBeGreaterThan(5);
  // Preview text must use the same small physical font sizes as the PDF.
  const typography = await page
    .locator(".print-preview .print-children strong")
    .first()
    .evaluate((n) => ({
      font: parseFloat(getComputedStyle(n).fontSize),
      padding: parseFloat(getComputedStyle(n.closest("li")).paddingTop),
    }));
  expect(typography.font).toBeLessThanOrEqual(12);
  expect(typography.padding).toBeLessThan(4);
  await page.screenshot({ path: "test-results/print-preview-desktop.png" });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#root")).toBeHidden();
  await expect(page.locator("#family-print-document")).toBeVisible();
  // Anything taller than Letter's printable height would break page references.
  const heights = await page
    .locator("#family-print-document .family-print-page")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
  if (Math.max(...heights) > 960) {
    const index = heights.indexOf(Math.max(...heights));
    console.log(
      "Tallest sheet",
      index,
      await page
        .locator("#family-print-document .family-print-page")
        .nth(index)
        .evaluate((n) =>
          Array.from(n.children).map((c) => ({
            tag: c.tagName,
            cls: c.className,
            height: c.getBoundingClientRect().height,
            margin: getComputedStyle(c).margin,
            padding: getComputedStyle(c).padding,
          })),
        ),
    );
    await page
      .locator("#family-print-document .family-print-page")
      .nth(index)
      .screenshot({ path: "test-results/print-overflow.png" });
  }
  expect(Math.max(...heights)).toBeLessThanOrEqual(960);
  await page.pdf({
    path: "test-results/family-500-a4.pdf",
    preferCSSPageSize: true,
    printBackground: false,
    displayHeaderFooter: false,
  });
  await page.emulateMedia({ media: "screen" });
  await page.getByLabel("Paper size", { exact: true }).selectOption("Letter");
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: "test-results/family-500-letter.pdf",
    preferCSSPageSize: true,
    printBackground: false,
    displayHeaderFooter: false,
  });
  const landscapeCounts = {};
  for (const paper of ["A4", "Letter"]) {
    await page.emulateMedia({ media: "screen" });
    await page.getByLabel("Paper size", { exact: true }).selectOption(paper);
    await page
      .getByLabel("Page orientation", { exact: true })
      .selectOption("landscape");
    await expect(page.locator(".print-preview")).toContainText(
      "Descendant 500",
    );
    await expect(
      page.locator(".print-preview .print-column").first(),
    ).toBeVisible();
    const count = await page
      .locator("#family-print-document .family-print-page")
      .count();
    landscapeCounts[paper] = count;
    await page.emulateMedia({ media: "print" });
    const heights = await page
      .locator("#family-print-document .family-print-page")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().height),
      );
    // A4 is the shorter landscape sheet: 186mm of printable height.
    expect(Math.max(...heights)).toBeLessThanOrEqual(702);
    const columns = await page
      .locator("#family-print-document .family-print-page")
      .first()
      .locator(".print-column")
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().x));
    expect(columns[1]).toBeGreaterThan(columns[0] + 400);
    await page.pdf({
      path: "test-results/family-500-" + paper.toLowerCase() + "-landscape.pdf",
      preferCSSPageSize: true,
      printBackground: false,
      displayHeaderFooter: false,
    });
  }
  await writeFile(
    "test-results/print-expected.json",
    JSON.stringify({
      pages: expectedPages,
      landscapePages: landscapeCounts,
      descendants: 500,
    }),
  );
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "Close print preview", exact: true })
    .click();
  expect(await page.locator("body").getAttribute("class")).not.toContain(
    "family-print-ready",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Print family tree", exact: true })
    .click();
  await page.getByLabel("What would you like to print?").selectOption("all");
  await page
    .getByRole("button", { name: "Prepare print preview", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("504 people");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page
    .getByLabel("Page orientation", { exact: true })
    .selectOption("landscape");
  await expect(page.locator(".print-preview.print-landscape")).toContainText(
    "Descendant 500",
  );
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "test-results/print-landscape-mobile.png" });
  await page
    .getByLabel("Page orientation", { exact: true })
    .selectOption("portrait");
  await expect(page.locator(".print-preview.print-portrait")).toBeVisible();
  await page.screenshot({ path: "test-results/print-preview-mobile.png" });
  expect(errors).toEqual([]);
  console.log(
    `PASS: 500 descendants, ${expectedPages} readable pages, A4/Letter portrait and landscape PDFs, complete branch and clan, desktop/mobile preview.`,
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  const timeout = setTimeout(() => process.exit(process.exitCode || 0), 5000);
  timeout.unref();
  await browser?.close();
  server.closeAllConnections();
  vite.httpServer?.closeAllConnections();
  await new Promise((r) => server.close(r));
  await vite.close();
  await db.close();
}
