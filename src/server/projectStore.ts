import fs from "node:fs";
import path from "node:path";
import { readJsonArray, writeJsonArray } from "./jsonStore.js";
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
    return readJsonArray<RecentProject>(this.file);
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
    return readJsonArray<ManagedProject>(this.managedProjectsFile);
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

  setGatherErrors(name: string, enabled: boolean): ManagedProject {
    const project = this.createManagedProject(name);
    const updated = { ...project, gatherErrors: enabled, updatedAt: new Date().toISOString() };
    this.saveManagedProjects(this.listManagedProjects().map((item) => item.name.toLowerCase() === project.name.toLowerCase() ? updated : item));
    return updated;
  }

  saveProject(project: ManagedProject): void {
    const current = this.listManagedProjects();
    const index = current.findIndex((item) => Boolean(project.id && item.id === project.id) || item.name.toLowerCase() === project.name.toLowerCase());
    if (index < 0) current.push(project);
    else current[index] = project;
    this.saveManagedProjects(current);
  }

  private save(items: RecentProject[]): void {
    writeJsonArray(this.file, items);
  }

  private saveManagedProjects(items: ManagedProject[]): void {
    writeJsonArray(this.managedProjectsFile, items);
  }
}
