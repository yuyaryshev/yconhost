import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const defaultPinnedText = 'Work dir: "{{work_dir}}"\nProject dir: "{{project_dir}}"\nSession ID: {{session_id}}';

export function createCodexFolder(config) {
  const fields = [
    { name: "name", label: "Name", type: "string", required: true },
    { name: "description", label: "Description", type: "string" },
    { name: "pinned_text", label: "pinned_text", type: "string", multiline: true, defaultValue: defaultPinnedText },
    { name: "session_id", label: "Session ID", type: "string" },
    { name: "cwd", label: "Working directory", type: "string" },
    { name: "background", label: "Background", type: "color" }
  ];
  const read = () => fs.readFileSync(config.contextsPath, "utf8");
  const sections = (text) => parseSections(text, config.defaultCwd);
  const builtins = () => readLua(config.weztermPresetsPath, config.defaultCwd);
  const all = (text) => {
    const markdown = sections(text);
    const names = new Set(markdown.map((item) => item.name));
    return [...builtins().filter((item) => !names.has(item.name)), ...markdown.filter((item) => !item.deleted && item.command)];
  };
  function locate(text, original) {
    const items = all(text);
    const matches = original.session_id
      ? items.filter((item) => item.session_id === original.session_id)
      : items.filter((item) => item.name === original.name);
    if (matches.length !== 1) throw new Error("Source entry is missing or ambiguous; list the folder again");
    const item = matches[0];
    if (original._revision && item._revision !== original._revision) throw new Error("Source changed externally; reopen the dialog");
    return item;
  }
  function save(before, after) {
    const lock = `${config.contextsPath}.yconhost-lock`;
    const fd = fs.openSync(lock, "wx");
    const temporary = `${config.contextsPath}.${crypto.randomUUID()}.tmp`;
    try {
      if (read() !== before) throw new Error("Source changed externally; retry the operation");
      fs.writeFileSync(temporary, after, "utf8");
      fs.renameSync(temporary, config.contextsPath);
    } finally {
      fs.closeSync(fd);
      fs.rmSync(lock, { force: true });
      fs.rmSync(temporary, { force: true });
    }
  }
  function validate(values) {
    if (!values.name?.trim() || /[\r\n]/.test(values.name) || /^DELETED(?:\s|$)/i.test(values.name)) throw new Error("Invalid console name");
    if (values.session_id && !/^[\w-]+$/.test(values.session_id)) throw new Error("Invalid session_id");
    if (/["\r\n]/.test(values.cwd ?? "")) throw new Error("Invalid working directory");
  }
  function unique(text, values, current) {
    if (all(text).some((item) => item !== current && (item.name === values.name.trim() || values.session_id && item.session_id === values.session_id))) {
      throw new Error("A console with this name or session_id already exists");
    }
  }
  return {
    defineFields: () => fields,
    getVariables: (_context, entry) => {
      const workDir = path.resolve(entry.cwd || config.defaultCwd || process.cwd());
      const projectDir = extractCwd(entry.command ?? "", workDir);
      return { work_dir: workDir, project_dir: projectDir, agents_dir: projectDir, session_id: entry.session_id ?? sessionMatch(entry.command ?? "")?.[1] ?? "" };
    },
    list: () => {
      const text = read();
      const items = all(text);
      const names = new Set();
      const keys = new Map();
      // Validate before command deduplication so identical commands cannot hide source conflicts.
      for (const item of items) {
        const key = item.session_id || item.name;
        if (names.has(item.name)) throw new Error(`Duplicate source name ${JSON.stringify(item.name)}. Rename one of the source sections; the previous console list was retained.`);
        if (keys.has(key)) throw new Error(`Duplicate source session/key ${JSON.stringify(key)} in ${JSON.stringify(keys.get(key))} and ${JSON.stringify(item.name)}. Correct the source session IDs; the previous console list was retained.`);
        names.add(item.name);
        keys.set(key, item.name);
      }
      const seen = new Set();
      return items.filter((item) => {
        if (seen.has(item.command)) return false;
        seen.add(item.command);
        return true;
      }).map(toItem);
    },
    create: (_context, values) => {
      validate(values);
      const before = read();
      unique(before, values);
      if (sections(before).some((item) => item.name === values.name.trim())) throw new Error("This name is present in Markdown, possibly DELETED; restore or rename that section first");
      const command = `ycodex --bypass-safety-y${values.session_id ? ` resume ${values.session_id}` : ""}`;
      save(before, `${before}${before.endsWith("\n") ? "" : "\n"}\n${render(values, command)}`);
      return { key: values.session_id || values.name.trim() };
    },
    update: (_context, original, values) => {
      validate(values);
      const before = read();
      const item = locate(before, original);
      const nameChanged = values.name.trim() !== item.name;
      const idChanged = (values.session_id ?? "") !== item.session_id;
      if (nameChanged && idChanged) throw new Error("Change name or session_id separately, not both at once");
      if (all(before).some((other) => other._revision !== item._revision && (other.name === values.name.trim() || values.session_id && other.session_id === values.session_id))) throw new Error("A console with this name or session_id already exists");
      let raw = item.raw ?? render(item, item.command);
      raw = raw.replace(/^#\s+[^\r\n]+/, () => `# ${values.name.trim()}`);
      raw = metadata(raw, "Color", values.background || "");
      raw = metadata(raw, "Description", JSON.stringify(values.description ?? ""));
      raw = editLaunch(raw, values, item, idChanged);
      raw = setPinnedText(raw, values.pinned_text ?? item.pinned_text ?? defaultPinnedText);
      const after = item.raw !== undefined ? before.slice(0, item.start) + raw + before.slice(item.end) : `${before}\n${raw}`;
      save(before, after);
      return { key: values.session_id || values.name.trim() };
    },
    delete: (_context, original) => {
      const before = read();
      const item = locate(before, original);
      const raw = (item.raw ?? render(item, item.command)).replace(/^#\s+/, "# DELETED ");
      save(before, item.raw !== undefined ? before.slice(0, item.start) + raw + before.slice(item.end) : `${before}\n${raw}`);
    }
  };
}

function toItem(item) {
  return {
    key: item.session_id || item.name, name: item.name, description: item.description ?? "",
    pinned_text: item.pinned_text ?? defaultPinnedText,
    command: item.command, cwd: item.cwd, shell: process.platform === "win32" ? "cmd.exe" : undefined,
    noRun: true, background: item.background, ansiParserEnabled: true,
    values: { name: item.name, description: item.description ?? "", pinned_text: item.pinned_text ?? defaultPinnedText, session_id: item.session_id, cwd: item.cwd, background: item.background ?? "", _revision: item._revision }
  };
}

export function parseSections(text, defaultCwd = process.cwd()) {
  const headings = [];
  let offset = 0;
  const blocks = fencedBlocks(text);
  for (const line of text.split(/(?<=\n)/)) {
    if (!blocks.some((block) => offset >= block.start && offset < block.end) && /^#\s+/.test(line)) headings.push(offset);
    offset += line.length;
  }
  return headings.map((start, index) => {
    const end = headings[index + 1] ?? text.length;
    const raw = text.slice(start, end);
    const heading = raw.match(/^#\s+([^\r\n]+)/)?.[1]?.trim() ?? "";
    const deleted = /^DELETED(?:\s|$)/i.test(heading);
    const name = heading.replace(/^DELETED\s*/i, "");
    let background = "";
    let description = "";
    const sectionBlocks = fencedBlocks(raw);
    const pinned = sectionBlocks.filter((block) => block.tag === "pinned_text");
    if (pinned.length > 1 || pinned.some((block) => !block.closed)) throw new Error(`Invalid pinned_text block in ${JSON.stringify(name)}`);
    const code = sectionBlocks.filter((block) => block.tag !== "pinned_text").flatMap((block) => raw.slice(block.bodyStart, block.bodyEnd).split(/\r?\n/));
    let lineOffset = 0;
    for (const line of raw.split(/(?<=\n)/)) {
      if (!sectionBlocks.some((block) => lineOffset >= block.start && lineOffset < block.end)) {
        const color = line.match(/^Color:\s*`?([^`\r\n]+)`?\s*$/)?.[1];
        if (color) background = color.trim();
        const desc = line.match(/^Description:\s*(.*)$/)?.[1];
        if (desc !== undefined) { try { description = JSON.parse(desc); } catch { description = desc; } }
      }
      lineOffset += line.length;
    }
    const launchIndex = code.findIndex((line) => findAgentCommand(line));
    const prefixes = code.slice(0, launchIndex).map((line) => line.trim()).filter((line) => /^(?:cls|set |cd |title )/i.test(line) && !/^set\s+"?y?codex_home=/i.test(line));
    const launch = launchIndex < 0 ? "" : normalizeAgentCommand(code[launchIndex].trim());
    const command = launch ? [...prefixes, launch].join(" & ") : "";
    const pinnedText = pinned.length ? raw.slice(pinned[0].bodyStart, pinned[0].bodyEnd).replace(/\r?\n$/, "").replace(/\r\n/g, "\n") : defaultPinnedText;
    return { start, end, raw, name, deleted, background, description, pinned_text: pinnedText, hasPinnedText: pinned.length > 0, command, session_id: sessionMatch(command)?.[1] ?? "", cwd: extractCwd(command, defaultCwd), _revision: hash(raw) };
  });
}

function metadata(raw, name, value) {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const blocks = fencedBlocks(raw);
  let offset = 0;
  let found = false;
  const next = raw.split(/(?<=\n)/).map((line) => {
    const inCode = blocks.some((block) => offset >= block.start && offset < block.end);
    offset += line.length;
    if (!inCode && line.startsWith(`${name}:`)) { found = true; return `${name}: ${value}${newline}`; }
    return line;
  }).join("");
  return found ? next : next.replace(/^(#[^\r\n]*)(\r?\n|$)/, (_match, heading) => `${heading}${newline}${name}: ${value}${newline}`);
}

function editLaunch(raw, values, original, idChanged) {
  const lines = raw.split(/(?<=\n)/);
  const blocks = fencedBlocks(raw);
  let offset = 0;
  let lastDirectory = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const block = blocks.find((item) => offset >= item.bodyStart && offset < item.bodyEnd);
    offset += line.length;
    if (!block || block.tag === "pinned_text") continue;
    if (!findAgentCommand(line)) {
      if (/^\s*cd\s+\/d\s+/i.test(line)) lastDirectory = index;
      continue;
    }
    let next = line;
    if (idChanged) {
      if (sessionMatch(next)) next = next.replace(/\b(--resume(?:=|\s+)|resume\s+)(["']?)[\w-]+\2/i, (_match, prefix) => values.session_id ? `${prefix}${values.session_id}` : "");
      else if (values.session_id) next = next.replace(/\b(claude|ycodex|codex)(?=\s|$)/i, (agent) => `${agent}${agent.toLowerCase() === "claude" ? " --resume" : " resume"} ${values.session_id}`);
    }
    if ((values.cwd ?? "") !== original.cwd) {
      const directory = values.cwd ? `cd /d "${values.cwd}"` : "cd .";
      const inline = /\bcd\s+\/d\s+(.+?)(?=\s*(?:&&|&|\r?$))/i;
      if (inline.test(next)) next = next.replace(inline, () => directory);
      else if (lastDirectory >= 0) lines[lastDirectory] = `${directory}${lines[lastDirectory].endsWith("\r\n") ? "\r\n" : "\n"}`;
      else if (values.cwd) next = `${directory} && ${next}`;
    }
    lines[index] = next;
    break;
  }
  return lines.join("");
}

function render(values, command) {
  return setPinnedText(`# ${values.name.trim()}\nColor: ${values.background ?? ""}\nDescription: ${JSON.stringify(values.description ?? "")}\n\n\`\`\`cmd\n${values.cwd ? `cd /d "${values.cwd}"\n` : ""}${command}\n\`\`\`\n`, values.pinned_text ?? defaultPinnedText);
}

function fencedBlocks(text) {
  const result = [];
  let open;
  let offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    if (!open) {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/);
      if (match) open = { start: offset, bodyStart: offset + line.length, marker: match[1], tag: match[2].trim().toLowerCase() };
    } else if (new RegExp(`^ {0,3}${open.marker[0]}{${open.marker.length},}\\s*$`).test(line)) {
      result.push({ ...open, bodyEnd: offset, end: offset + line.length, closed: true });
      open = undefined;
    }
    offset += line.length;
  }
  if (open) result.push({ ...open, bodyEnd: text.length, end: text.length, closed: false });
  return result;
}

function setPinnedText(raw, text) {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const length = Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1));
  const fence = "`".repeat(length);
  const rendered = `${fence}pinned_text${newline}${text.replace(/\r?\n/g, newline)}${newline}${fence}${newline}`;
  const block = fencedBlocks(raw).find((item) => item.tag === "pinned_text");
  return block ? raw.slice(0, block.start) + rendered + raw.slice(block.end) : `${raw}${raw.endsWith("\n") ? newline : newline + newline}${rendered}`;
}

export function addDefaultPinnedTextBlocks(text, defaultCwd) {
  let next = text;
  for (const item of parseSections(text, defaultCwd).reverse()) {
    if (!item.command || item.deleted || item.hasPinnedText) continue;
    next = next.slice(0, item.start) + setPinnedText(item.raw, defaultPinnedText) + next.slice(item.end);
  }
  return next;
}

function readLua(file, defaultCwd) {
  if (!file || !fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const block = text.match(/local\s+built_in_presets\s*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const pattern = /\{\s*id\s*=\s*'([^']+)'\s*,\s*name\s*=\s*'([^']+)'\s*,\s*background\s*=\s*'(#[0-9a-fA-F]{6})'\s*,\s*command\s*=\s*'([^']+)'\s*\}/g;
  return [...block.matchAll(pattern)].map((match) => {
    const command = match[4].replace(/\\\\/g, "\\").replace(/\\'/g, "'");
    return { name: match[2], background: match[3].toLowerCase(), command, cwd: extractCwd(command, defaultCwd), session_id: sessionMatch(command)?.[1] ?? "", _revision: hash(match[0]) };
  });
}

function hash(text) { return crypto.createHash("sha256").update(text).digest("hex"); }
function findAgentCommand(line) { return /(?:^|&&?)\s*(ycodex|codex|claude)(?=\s|$)/i.exec(line); }
function sessionMatch(command) { return command.match(/\b(?:--resume(?:=|\s+)|resume\s+)["']?([\w-]+)/i); }
function normalizeAgentCommand(command) {
  const match = findAgentCommand(command);
  if (!match || match[1].toLowerCase() === "claude") return command;
  const start = match.index + match[0].length - match[1].length;
  return command.slice(0, start) + (command.toLowerCase().includes("--bypass-safety-y") ? "ycodex" : "ycodex --bypass-safety-y") + command.slice(start + match[1].length);
}
function extractCwd(command, fallback = process.cwd()) {
  const raw = [...command.matchAll(/\bcd\s+\/d\s+(.+?)(?=\s*(?:&&|&|$))/gi)].at(-1)?.[1]?.trim();
  return raw ? path.resolve(raw.replace(/^"(.+)"$/, "$1")) : fallback;
}
