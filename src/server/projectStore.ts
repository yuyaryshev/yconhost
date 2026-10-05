import fs from "node:fs";
import path from "node:path";
import type { AppSettings, ManagedProject, RecentProject } from "./types.js";

export class ProjectStore {
  private readonly file: string;
  private readonly managedProjectsFile: string;

  constructor(settings: AppSettings) {
    fs.mkdirSync(settings.dataDir, { recursive: true });
    this.file = path.join(settings.dataDir, "recent-projects.json");
    this.managedProjectsFile = path.join(settings.dataDir, "managed-projects.json");
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

  listManagedProjects(): ManagedProject[] {
    if (!fs.existsSync(this.managedProjectsFile)) return [];
    return JSON.parse(fs.readFileSync(this.managedProjectsFile, "utf8")) as ManagedProject[];
  }

  createManagedProject(name: string): ManagedProject {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Project name is required");
    const now = new Date().toISOString();
    const current = this.listManagedProjects();
    const existing = current.find((item) => item.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const project: ManagedProject = { name: trimmed, createdAt: now, updatedAt: now };
    this.saveManagedProjects([...current, project]);
    return project;
  }

  removeManagedProject(name: string): ManagedProject[] {
    const target = name.toLowerCase();
    const next = this.listManagedProjects().filter((item) => item.name.toLowerCase() !== target);
    this.saveManagedProjects(next);
    return next;
  }

  private save(items: RecentProject[]): void {
    fs.writeFileSync(this.file, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  }

  private saveManagedProjects(items: ManagedProject[]): void {
    fs.writeFileSync(this.managedProjectsFile, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  }
}
