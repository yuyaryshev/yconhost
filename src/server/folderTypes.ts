export type FolderType = "manual" | "my_wins" | "scripted";

export interface FolderField {
  name: string;
  label: string;
  type: "string" | "color";
  required?: boolean;
  defaultValue?: string;
  multiline?: boolean;
}

export interface FolderCapabilities {
  new: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  readOutput: boolean;
}

export interface FolderConfig {
  id?: string;
  name: string;
  type: FolderType;
  projectPath?: string;
  scriptPath?: string;
  intervalSeconds?: number;
  gatherErrors?: boolean;
  closeRemoves?: boolean;
  confirmed?: boolean;
}

export interface FolderInfo extends FolderConfig {
  id: string;
  capabilities: FolderCapabilities;
  lastListedAt?: string;
  error?: string;
}

export interface SourceMetadata {
  folderId?: string;
  sourceKey?: string;
  sourceValues?: Record<string, string>;
  description?: string;
  pinned_text?: string;
  pinnedVariables?: Record<string, string>;
  orphaned?: boolean;
  pendingRestart?: boolean;
}

export interface FolderItem {
  key: string;
  name: string;
  description?: string;
  pinned_text?: string;
  pinnedVariables?: Record<string, string>;
  values?: Record<string, string>;
  command?: string;
  cwd?: string;
  shell?: string;
  args?: string[];
  background?: string;
  noRun?: boolean;
  ansiParserEnabled?: boolean;
  readonly?: boolean;
  external?: {
    pid?: number;
    status?: "idle" | "running" | "exited";
    lastOutputAt?: string;
  };
}

export const defaultFolderFields: FolderField[] = [
  { name: "name", label: "Name", type: "string", required: true },
  { name: "description", label: "Description", type: "string" }
];
