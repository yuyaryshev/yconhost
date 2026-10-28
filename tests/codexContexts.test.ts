import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCodexContextPresets } from "../src/server/codexContexts.js";

describe("agent context import", () => {
  let dir: string;
  let contextsPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-contexts-"));
    contextsPath = path.join(dir, "contexts.md");
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function load(sections: Array<{ name: string; code: string; color?: string }>) {
    fs.writeFileSync(contextsPath, sections.map(({ name, code, color = "#003200" }) =>
      `# ${name}\nColor: \`${color}\`\n\n\`\`\`cmd\n${code}\n\`\`\`\n`
    ).join("\n"));
    return loadCodexContextPresets({ project: "codexes", contextsPath, defaultCwd: dir });
  }

  it("preserves the first Claude launch command, resume ID, cwd and color as an idle persistent slot", () => {
    const cwd = path.join(dir, "microservices");
    const command = `cls && cd /d "${cwd}" && claude --resume saved-thread --dangerously-skip-permissions`;
    const slots = load([{ name: "khb_microservices_claude", color: "#003232", code: `${command}\n\nclaude --dangerously-skip-permissions` }]);
    expect(slots).toEqual([expect.objectContaining({
      project: "codexes", name: "khb_microservices_claude", command, cwd,
      background: "#003232", noRun: true, persistent: true, start: false
    })]);
    expect(slots[0].command).not.toContain("--bypass-safety-y");
  });

  it("detects Claude by command rather than title, supports bare launches, and deduplicates commands", () => {
    const slots = load([
      { name: "workflow", code: "claude" },
      { name: "duplicate", code: "claude" },
      { name: "another workflow", code: "cls & CLAUDE --resume another" },
      { name: "claude notes", code: "echo claude --resume not-a-command\nD:\\tools\\claude --resume not-a-command\nclaude-tools --help" }
    ]);
    expect(slots.map((slot) => slot.name)).toEqual(["workflow", "another workflow"]);
    expect(slots.map((slot) => slot.command)).toEqual(["claude", "cls & CLAUDE --resume another"]);
  });

  it("retains allowed prefix lines without rewriting Claude arguments containing codex names", () => {
    const slots = load([{
      name: "Claude",
      code: 'set "CODEX_HOME=ignored"\nset "YCODEX_HOME=ignored"\ntitle Claude\nset KEEP=yes\nclaude --resume codex --append-system-prompt ycodex'
    }]);
    expect(slots[0].command).toBe("title Claude & set KEEP=yes & claude --resume codex --append-system-prompt ycodex");
  });

  it("still normalizes only the Codex executable and adds its safety flag exactly once", () => {
    const slots = load([
      { name: "Codex", code: 'cd /d "D:\\work\\codex folder" && codex resume thread' },
      { name: "Ycodex", code: "ycodex --bypass-safety-y resume other-thread" },
      { name: "Bare Codex", code: "codex" }
    ]);
    expect(slots.map((slot) => slot.command)).toEqual([
      'cd /d "D:\\work\\codex folder" && ycodex --bypass-safety-y resume thread',
      "ycodex --bypass-safety-y resume other-thread",
      "ycodex --bypass-safety-y"
    ]);
  });
});
