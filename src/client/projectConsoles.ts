interface ProjectConsole {
  name: string;
  command: string;
  cwd: string;
  status?: string;
  lastStartedAt?: string;
  lastInputAt?: string;
  lastOutputAt?: string;
}

export function selectProjectConsoles<T extends ProjectConsole>(consoles: T[], query: string, showAll: boolean): T[] {
  const filter = query.trim().toLowerCase();
  const matches = filter ? consoles.filter((item) => [item.name, item.command, item.cwd].some((value) => value.toLowerCase().includes(filter))) : consoles;
  const isRunning = (item: T) => item.status === "starting" || item.status === "running" || item.status === "ready";
  const running = matches.filter(isRunning);
  const stopped = matches.filter((item) => !isRunning(item));
  if (filter || showAll || consoles.length <= 10) return [...running, ...stopped];
  const startedAt = (item: T) => Date.parse(item.lastStartedAt ?? item.lastInputAt ?? item.lastOutputAt ?? "") || 0;
  return [...running, ...stopped.filter((item) => startedAt(item) > 0).sort((a, b) => startedAt(b) - startedAt(a)).slice(0, Math.max(0, 9 - running.length))];
}
