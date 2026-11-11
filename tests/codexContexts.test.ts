import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDefaultPinnedTextBlocks, createCodexFolder, defaultPinnedText, parseSections } from "../src/server/folders/codexes.mjs";

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
    return createCodexFolder({ contextsPath, defaultCwd: dir }).list();
  }

  it("creates a real new session through the adapter, writes a resume template, and lists an idle slot", async () => {
    fs.writeFileSync(contextsPath, "# Notes\nKeep this\n");
    const cwd = path.join(dir, "folder & spaces");
    fs.mkdirSync(cwd);
    const sessionId = "01234567-1234-7123-8123-0123456789ab";
    const createSession = vi.fn(async () => sessionId);
    const source = createCodexFolder({ contextsPath, defaultCwd: dir }, { createSession });
    expect(source.defineFields({}, { operation: "new" }).map((field: { name: string }) => field.name)).toEqual(["name", "cwd"]);
    expect(source.defineFields({})[4].required).not.toBe(true);
    await expect(source.new({ env: { CUSTOM: "yes" } }, { name: "New agent", cwd })).resolves.toEqual({ key: sessionId });
    expect(createSession).toHaveBeenCalledWith({ name: "New agent", cwd, env: { CUSTOM: "yes" } });
    expect(fs.readFileSync(contextsPath, "utf8")).toContain(`cd /d "${cwd}" && title New agent && codex resume ${sessionId} --dangerously-bypass-approvals-and-sandbox --bypass-safety-y`);
    expect(source.list()).toEqual([expect.objectContaining({ key: sessionId, name: "New agent", cwd, noRun: true, pinned_text: defaultPinnedText,
      command: `cd /d "${cwd}" && title New agent && ycodex resume ${sessionId} --dangerously-bypass-approvals-and-sandbox --bypass-safety-y` })]);
    const original = source.list()[0].values;
    source.update({}, original, { ...original, cwd: dir });
    expect(source.list()[0].cwd).toBe(dir);
    expect(source.list()[0].command).not.toContain("folder & spaces");
  });

  it("validates new entries before allocating sessions and preserves Markdown on bootstrap failure", async () => {
    const before = "# Existing\n```cmd\nycodex resume existing\n```\n";
    fs.writeFileSync(contextsPath, before);
    const createSession = vi.fn(async () => { throw new Error("bootstrap failed"); });
    const source = createCodexFolder({ contextsPath, defaultCwd: dir }, { createSession });
    for (const values of [{ name: "Existing", cwd: dir }, { name: "Bad & injected", cwd: dir }, { name: "Bad", cwd: "relative" }, { name: "Bad", cwd: "" }]) {
      await expect(source.new({}, values)).rejects.toThrow();
    }
    expect(createSession).not.toHaveBeenCalled();
    await expect(source.new({}, { name: "New", cwd: dir })).rejects.toThrow("bootstrap failed");
    expect(fs.readFileSync(contextsPath, "utf8")).toBe(before);
  });

  it("does not overwrite concurrent Markdown edits during new and reports the allocated ID for recovery", async () => {
    fs.writeFileSync(contextsPath, "");
    const id = "01234567-1234-7123-8123-0123456789ab";
    const source = createCodexFolder({ contextsPath, defaultCwd: dir }, { createSession: async () => {
      fs.appendFileSync(contextsPath, "# External note\n"); return id;
    } });
    await expect(source.new({}, { name: "New", cwd: dir })).rejects.toThrow(`Codex session ${id} was created`);
    expect(fs.readFileSync(contextsPath, "utf8")).toBe("# External note\n");
    expect(fs.existsSync(`${contextsPath}.yconhost-lock`)).toBe(false);
  });

  it("preserves the first Claude launch command, resume ID, cwd and color as an idle persistent slot", () => {
    const cwd = path.join(dir, "microservices");
    const command = `cls && cd /d "${cwd}" && claude --resume saved-thread --dangerously-skip-permissions`;
    const slots = load([{ name: "khb_microservices_claude", color: "#003232", code: `${command}\n\nclaude --dangerously-skip-permissions` }]);
    expect(slots).toEqual([expect.objectContaining({
      name: "khb_microservices_claude", command, cwd,
      background: "#003232", noRun: true
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

  it("reports duplicate section names or session keys even when commands are identical", () => {
    expect(() => load([
      { name: "Same", code: "claude" },
      { name: "Same", code: "claude" }
    ])).toThrow('Duplicate source name "Same"');
    expect(() => load([
      { name: "First", code: "ycodex resume repeated-id" },
      { name: "Second", code: "ycodex resume repeated-id" }
    ])).toThrow('Duplicate source session/key "repeated-id" in "First" and "Second"');
  });

  it("materializes pinned defaults idempotently without changing launches, CRLF or unrelated notes", () => {
    const before = '# Agent\r\nColor: STD_GREEN\r\n\r\n```cmd\r\ncd /d "D:\\My Project" && ycodex resume saved\r\n```\r\n\r\n# Notes\r\nkeep this\r\n';
    const after = addDefaultPinnedTextBlocks(before, dir);
    const launch = (text: string) => parseSections(text, dir).map((item) => [item.name, item.command, item.cwd, item.background]);
    expect(launch(after)).toEqual(launch(before));
    expect(after).toContain("```pinned_text\r\n");
    expect(after).toContain("# Notes\r\nkeep this\r\n");
    expect(after.split("```pinned_text")).toHaveLength(2);
    expect(addDefaultPinnedTextBlocks(after, dir)).toBe(after);
    expect(parseSections(after, dir)[0].pinned_text).toBe(defaultPinnedText);
  });

  it("keeps pinned Markdown headings and agent-like text out of the command parser, with lossless edits and clearing", () => {
    load([{ name: "Agent", code: "ycodex resume real-session" }]);
    const source = createCodexFolder({ contextsPath, defaultCwd: dir });
    let item = source.list()[0];
    const notes = '# not a folder\n```cmd\nycodex resume wrong-session\n```\nD:\\path with spaces\n{{session_id}}\n';
    source.update({}, item.values, { ...item.values, pinned_text: notes });
    item = source.list()[0];
    expect(item.pinned_text).toBe(notes);
    expect(item.command).toBe("ycodex --bypass-safety-y resume real-session");
    expect(source.list()).toHaveLength(1);
    expect(fs.readFileSync(contextsPath, "utf8")).toContain("````pinned_text");
    source.update({}, item.values, { ...item.values, name: "Renamed" });
    item = source.list()[0];
    expect(item.pinned_text).toBe(notes);
    source.update({}, item.values, { ...item.values, pinned_text: "" });
    expect(source.list()[0].pinned_text).toBe("");
  });

  it("returns work_dir, project_dir, the agents_dir alias and session_id from the JS description", () => {
    const source = createCodexFolder({ contextsPath, defaultCwd: dir });
    const entry = { cwd: dir, command: 'cd /d "D:\\My Project" && ycodex resume session', session_id: "session" };
    const variables = source.getVariables({}, entry);
    expect(variables).toEqual({ work_dir: dir, project_dir: path.resolve("D:\\My Project"), agents_dir: path.resolve("D:\\My Project"), session_id: "session" });
    expect(source.getVariables({}, { cwd: dir, command: "ycodex" }).session_id).toBe("");
  });

  it.each(["\n", "\r\n"])("preserves descriptions and metadata-like pinned lines with %j newlines", (newline) => {
    fs.writeFileSync(contextsPath, ['# Agent', 'Description: "Keep this"', '```cmd', 'ycodex resume id', '```', '```pinned_text', 'Description: "Not metadata"', 'Color: STD_RED', '```', ''].join(newline));
    const section = parseSections(fs.readFileSync(contextsPath, "utf8"), dir)[0];
    expect(section.description).toBe("Keep this");
    expect(section.background).toBe("");
    expect(section.pinned_text).toBe('Description: "Not metadata"\nColor: STD_RED');
  });

  it("rejects duplicate and unterminated pinned blocks before publishing a changed list", () => {
    expect(() => parseSections('# Agent\n```cmd\nycodex\n```\n```pinned_text\none\n```\n```pinned_text\ntwo\n```\n')).toThrow("Invalid pinned_text");
    expect(() => parseSections('# Agent\n```cmd\nycodex\n```\n```pinned_text\nnot closed\n')).toThrow("Invalid pinned_text");
  });

  it.each(['cd /d "D:\\work" && ycodex --bypass-safety-y resume builtin', 'ycodex --bypass-safety-y resume builtin', 'claude --resume builtin'])("preserves Lua preset launches when saving pinned text: %s", (command) => {
    const presets = path.join(dir, "presets.lua");
    fs.writeFileSync(contextsPath, "preamble\n");
    fs.writeFileSync(presets, `local built_in_presets = {\n{ id = 'one', name = 'Builtin', background = '#003200', command = '${command.replace(/\\/g, "\\\\")}' }\n}\n`);
    const source = createCodexFolder({ contextsPath, weztermPresetsPath: presets, defaultCwd: dir });
    const before = source.list()[0];
    source.update({}, before.values, { ...before.values, pinned_text: "{{session_id}}" });
    const after = source.list()[0];
    expect(source.list()).toHaveLength(1);
    expect(after.command).toBe(before.command);
    expect(after.cwd).toBe(before.cwd);
    expect(after.pinned_text).toBe("{{session_id}}");
    expect(fs.readFileSync(presets, "utf8")).not.toContain("pinned_text");
  });
});
