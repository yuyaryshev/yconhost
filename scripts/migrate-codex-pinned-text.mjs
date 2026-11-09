import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { addDefaultPinnedTextBlocks, parseSections } from "../src/server/folders/codexes.mjs";

const arguments_ = process.argv.slice(2);
const source = arguments_.find((argument) => !argument.startsWith("--"));
if (!source) throw new Error("Usage: node scripts/migrate-codex-pinned-text.mjs <contexts.md> [--write]");
const file = path.resolve(source);
const bytes = fs.readFileSync(file);
const before = bytes.toString("utf8");
const after = addDefaultPinnedTextBlocks(before);
const launch = (text) => parseSections(text).map((item) => [item.name, item.command, item.cwd, item.session_id, item.background, item.description, item.deleted]);
if (JSON.stringify(launch(before)) !== JSON.stringify(launch(after))) throw new Error("Migration changes launch definitions; aborting");
const added = parseSections(after).filter((item) => item.hasPinnedText).length - parseSections(before).filter((item) => item.hasPinnedText).length;
let backup;
if (arguments_.includes("--write") && after !== before) {
  const directory = path.resolve("data/source-backups", `pinned-text-${Date.now()}`);
  fs.mkdirSync(directory, { recursive: true });
  backup = path.join(directory, path.basename(file));
  fs.copyFileSync(file, backup);
  const lock = `${file}.yconhost-lock`;
  const fd = fs.openSync(lock, "wx");
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    if (!fs.readFileSync(file).equals(bytes)) throw new Error("Markdown changed during migration; retry");
    const out = fs.openSync(temporary, "wx");
    try { fs.writeFileSync(out, after, "utf8"); fs.fsyncSync(out); } finally { fs.closeSync(out); }
    fs.renameSync(temporary, file);
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
    fs.rmSync(temporary, { force: true });
  }
}
console.log(JSON.stringify({ file, addedBlocks: added, changed: after !== before, written: arguments_.includes("--write") && after !== before, launchDefinitionsUnchanged: true, backup }, null, 2));
