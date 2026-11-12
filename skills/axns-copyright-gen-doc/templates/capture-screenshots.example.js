/**
 * 通用软著截图脚本（本机 Chrome/Edge）
 * 用法：
 *   1. 复制为项目 _doc/软著申请/.docx-tools/capture-screenshots.js
 *   2. 同目录放置 config.json（见 config.example.json）
 *   3. npm i playwright
 *   4. node capture-screenshots.js [web|h5|all]
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const TOOLS = __dirname;
const ROOT = path.resolve(TOOLS, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(TOOLS, "config.json"), "utf8"));

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      const browser = await chromium.launch({ channel, headless: true });
      console.log("browser:", channel);
      return browser;
    } catch (_) {}
  }
  try {
    const browser = await chromium.launch({ headless: true });
    console.log("browser:", "playwright-chromium");
    return browser;
  } catch (error) {
    throw new Error("无法启动 Chrome、Edge 或 Playwright Chromium。请执行 npx playwright install chromium 后重试。原因：" + error.message);
  }
}

async function shot(page, file) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: file, fullPage: false });
  console.log("ok", path.basename(file));
}

function urlJoin(base, p) {
  if (/^https?:\/\//.test(p)) return p;
  return base.replace(/\/$/, "") + (p.startsWith("/") ? p : "/" + p);
}

async function loginWeb(page, w) {
  await page.goto(urlJoin(w.baseUrl, w.loginPath), { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(800);
  const u = page.getByPlaceholder(w.userPlaceholder || "请输入用户名");
  const p = page.getByPlaceholder(w.passPlaceholder || "请输入密码");
  if (await u.count()) {
    await u.fill(w.username);
    await p.fill(w.password);
  } else {
    const inputs = page.locator("input");
    await inputs.nth(0).fill(w.username);
    await inputs.nth(1).fill(w.password);
  }
  await page.getByRole("button", { name: new RegExp(w.loginButtonText || "登录") }).click();
  await page.waitForTimeout(2500);
}

async function loginH5(page, h) {
  await page.goto(urlJoin(h.baseUrl, h.loginPath), { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  const inputs = page.locator("input");
  if ((await inputs.count()) >= 2) {
    await inputs.nth(0).fill(h.username);
    await inputs.nth(1).fill(h.password);
  }
  const sel = h.loginButtonSelector || "button, .wd-button, uni-button";
  await page.locator(sel).first().click({ force: true });
  await page.waitForTimeout(2500);
}

async function runSide(browser, sideKey) {
  const side = cfg[sideKey];
  if (!side) return;
  const outDir = path.join(ROOT, side.shotDir || (sideKey === "web" ? "Screenshot-web" : "Screenshot-h5"));
  fs.mkdirSync(outDir, { recursive: true });

  const vp = side.viewport || {};
  const page = await browser.newPage({
    viewport: { width: vp.width || 1440, height: vp.height || 900 },
    deviceScaleFactor: vp.deviceScaleFactor || 1,
    isMobile: sideKey === "h5",
    hasTouch: sideKey === "h5"
  });

  const before = (side.shots || []).filter(s => s.beforeLogin);
  const after = (side.shots || []).filter(s => !s.beforeLogin);

  for (const s of before) {
    await page.goto(urlJoin(side.baseUrl, s.path), { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(800);
    await shot(page, path.join(outDir, s.file));
  }

  if (sideKey === "web") await loginWeb(page, side);
  else await loginH5(page, side);

  for (const s of after) {
    await page.goto(urlJoin(side.baseUrl, s.path), { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1000);
    if (s.click) {
      await page.locator(s.click).first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
    }
    await shot(page, path.join(outDir, s.file));
  }

  for (const s of side.extra || []) {
    await page.goto(urlJoin(side.baseUrl, s.path), { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(800);
    if (s.click) {
      await page.locator(s.click).first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
    }
    await shot(page, path.join(outDir, s.file));
  }

  await page.close();
}

(async () => {
  const only = process.argv[2] || "all";
  const browser = await launch();
  try {
    if (only === "all" || only === "web") {
      console.log("=== WEB ===");
      await runSide(browser, "web");
    }
    if (only === "all" || only === "h5") {
      console.log("=== H5 ===");
      await runSide(browser, "h5");
    }
  } finally {
    await browser.close();
  }
  console.log("DONE — 请人工抽检 Screenshot-* 是否为业务页而非登录页");
})().catch(e => {
  console.error(e);
  process.exit(1);
});
