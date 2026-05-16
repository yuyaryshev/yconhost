import fs from "node:fs";
import path from "node:path";
import type { AppSettings, RecentProject } from "./types.js";

export class ProjectStore {
  private readonly file: string;

  constructor(settings: AppSettings) {
    fs.mkdirSync(settings.dataDir, { recursive: true });
    this.file = path.join(settings.dataDir, "recent-projects.json");
  }

  list(): RecentProject[] {
    if (!fs.existsSync(this.file)) return [];
    return JSON.parse(fs.readFileSync(this.file, "utf8")) as RecentProject[];
  }

  touch(projectPath: string): RecentProject[] {
    const resolved = path.resolve(projectPath);
    const project: RecentProject = { path: resolved, name: path.basename(resolved), openedAt: new Date().toISOString() };
    const next = [project, ...this.list().filter((item) => path.resolve(item.path).toLowerCase() !== resolved.toLowerCase())].slice(0, 50);
    this.save(next);
    return next;
  }

  remove(projectPath: string): RecentProject[] {
    const resolved = path.resolve(projectPath).toLowerCase();
    const next = this.list().filter((item) => path.resolve(item.path).toLowerCase() !== resolved);
    this.save(next);
    return next;
  }

  private save(items: RecentProject[]): void {
    fs.writeFileSync(this.file, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  }
}
