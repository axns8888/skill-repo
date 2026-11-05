const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const repo = path.resolve(__dirname, "..");
const cli = path.join(repo, "skills/ruanzhu-gen/scripts/cli.js");
const counter = path.join(repo, "skills/ruanzhu-gen-intro/scripts/count-source-lines.js");
const { loadCodeDocConfig, loadDocManualConfig } = require("../skills/ruanzhu-gen-code/scripts/docx-style.js");

function fixture(t) {
  const cache = path.join(repo, ".cache");
  fs.mkdirSync(cache, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cache, "ruanzhu-tests-"));
  t.after(() => {
    if (path.dirname(path.resolve(dir)) !== cache) throw new Error("Unexpected test cleanup path");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src/main.js"), "const one = 1;\nconst two = 2;\n");
  return dir;
}
function run(root, ...args) {
  return spawnSync(process.execPath, [cli, ...args, "--root", root], { encoding: "utf8" });
}
function init(root, ...args) {
  return run(root, "init", "--project-name", "测试系统", "--paths", "src", ...args);
}
function cfg(root, kind, name = "测试系统") {
  return path.join(root, "_doc/软著申请", `${name}-ruanzhu-${kind}-config.md`);
}

// Read configs using the consumers used by the actual DOCX exporters.
test("init creates independently readable per-project configs", t => {
  const root = fixture(t);
  const result = init(root);
  assert.equal(result.status, 0, result.stderr);
  const code = loadCodeDocConfig(root, { configFile: cfg(root, "code") });
  const doc = loadDocManualConfig(root, { configFile: cfg(root, "doc") });
  assert.equal(code.projectName, "测试系统");
  assert.deepEqual(code.paths, [{ path: "src" }]);
  assert.equal(code.pages, 60);
  assert.equal(code.linesPerPage, 50);
  assert.equal(doc.md, "测试系统-操作手册-v1.md");
  assert.ok(fs.existsSync(cfg(root, "intro")));
});

test("init preserves edits unless force is explicit, and supports no-intro", t => {
  const root = fixture(t);
  assert.equal(init(root, "--no-intro").status, 0);
  assert.equal(fs.existsSync(cfg(root, "intro")), false);
  fs.writeFileSync(cfg(root, "code"), "user edits");
  assert.equal(init(root, "--no-intro").status, 0);
  assert.equal(fs.readFileSync(cfg(root, "code"), "utf8"), "user edits");
  assert.equal(init(root, "--force").status, 0);
  assert.equal(loadCodeDocConfig(root, { configFile: cfg(root, "code") }).projectName, "测试系统");
});

test("bad names, options and weights fail without creating configs", t => {
  const root = fixture(t);
  for (const args of [
    ["init", "--project-name", "../other", "--paths", "src"],
    ["init", "--project-name", "测试系统"],
    ["init", "--project-name", "测试系统", "--paths", "src:80,api:80"],
    ["init", "--project-name", "测试系统", "--paths", "src:50,api"],
    ["init", "--project-name", "测试系统", "--paths", "src", "--unknown"]
  ]) assert.equal(run(root, ...args).status, 1);
  assert.equal(fs.existsSync(path.join(root, "_doc")), false);
});

test("generator validates only the selected task and requires its installed sibling", t => {
  const root = fixture(t);
  assert.equal(init(root, "--no-intro").status, 0);
  assert.equal(run(root, "generator", "--only", "code", "--skip-code-run").status, 0);
  assert.equal(run(root, "generator", "--only", "doc").status, 0);
  assert.equal(run(root, "generator", "--skip-code-run").status, 1);
  const missing = run(root, "generator", "--only", "code", "--skip-code-run", "--skills-dir", path.join(root, "src"));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /缺少子技能/);
});

test("generator refuses ambiguous projects and inconsistent config names", t => {
  const root = fixture(t);
  assert.equal(init(root).status, 0);
  assert.equal(run(root, "init", "--project-name", "第二系统", "--paths", "src").status, 0);
  assert.equal(run(root, "generator", "--only", "intro").status, 1);
  assert.equal(run(root, "generator", "--only", "intro", "--project-name", "第二系统").status, 0);
  fs.writeFileSync(cfg(root, "intro"), fs.readFileSync(cfg(root, "intro"), "utf8").replace('"projectName": "测试系统"', '"projectName": "错误项目"'));
  assert.equal(run(root, "generator", "--only", "intro", "--project-name", "测试系统").status, 1);
});

test("physical line counts handle empty files, terminal newlines and CRLF", t => {
  const root = fixture(t);
  const cases = [["", 0], ["one", 1], ["one\n", 1], ["one\r\ntwo\r\n", 2], ["one\rtwo\r", 2], ["\n", 1], ["one\n\n", 2]];
  for (let i = 0; i < cases.length; i++) {
    const source = path.join(root, `case${i}`);
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "input.js"), cases[i][0]);
    const result = spawnSync(process.execPath, [counter, "--root", root, "--paths", `case${i}`, "--json"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).total, cases[i][1]);
  }
});

test("screenshot script uses Chromium after unavailable Chrome and Edge", async () => {
  const source = fs.readFileSync(path.join(repo, "skills/ruanzhu-gen-doc/templates/capture-screenshots.example.js"), "utf8");
  for (const available of ["chrome", "chromium", "none"]) {
    const attempts = [];
    const errors = [];
    let closed = false;
    let exitCode = 0;
    await vm.runInNewContext(source, {
      __dirname: path.join(repo, ".cache/tools"),
      require(name) {
        if (name === "fs") return { readFileSync: () => "{}" };
        if (name === "path") return path;
        if (name === "playwright") return { chromium: { async launch(opts) {
          const channel = opts.channel || "chromium";
          attempts.push(channel);
          if (channel !== available) throw new Error("browser unavailable");
          return { async close() { closed = true; } };
        } } };
        throw new Error(`Unexpected require: ${name}`);
      },
      console: { log() {}, error(error) { errors.push(String(error)); } },
      process: { argv: ["node", "capture.js", "all"], exit(code) { exitCode = code; } }
    });
    assert.deepEqual(attempts, available === "chrome" ? ["chrome"] : ["chrome", "msedge", "chromium"]);
    assert.equal(closed, available !== "none");
    assert.equal(exitCode, available === "none" ? 1 : 0);
    if (available === "none") assert.match(errors.join("\n"), /playwright install chromium/);
  }
});

test("file separators and comments do not consume effective source quotas", () => {
  const { countEffective, selectLines, chunkPagesByEffective } = require("../skills/ruanzhu-gen-code/scripts/generate-code-doc.js");
  const lines = ["// ===== FILE: src/a.js =====", "const a = 1;", "", "// comment", "const b = 2;", "// ===== FILE: src/b.js =====", "const c = 3;", "const d = 4;", "const e = 5;"];
  assert.equal(countEffective(lines), 5);
  const selected = selectLines(lines, 4, "head-tail");
  assert.equal(selected.effectiveLines, 4);
  assert.ok(selected.lines.includes("const a = 1;"));
  assert.ok(selected.lines.includes("const e = 5;"));
  assert.ok(!selected.lines.includes("const c = 3;"));
  const pages = chunkPagesByEffective(selected.lines, 2, 2);
  assert.deepEqual(pages.map(countEffective), [2, 2]);
});
