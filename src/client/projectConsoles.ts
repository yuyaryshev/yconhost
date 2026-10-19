interface ProjectConsole {
  name: string;
  command: string;
  cwd: string;
  lastStartedAt?: string;
  lastInputAt?: string;
  lastOutputAt?: string;
}

export function selectProjectConsoles<T extends ProjectConsole>(consoles: T[], query: string, showAll: boolean): T[] {
  const filter = query.trim().toLowerCase();
  if (filter) return consoles.filter((item) => [item.name, item.command, item.cwd].some((value) => value.toLowerCase().includes(filter)));
  if (showAll || consoles.length <= 10) return consoles;
  const startedAt = (item: T) => Date.parse(item.lastStartedAt ?? item.lastInputAt ?? item.lastOutputAt ?? "") || 0;
  return consoles.filter((item) => startedAt(item) > 0).sort((a, b) => startedAt(b) - startedAt(a)).slice(0, 9);
}
