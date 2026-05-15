#include <stdio.h>
#include <string.h>
#include <windows.h>

static DWORD mode_to_flags(const char *mode) {
  if (strcmp(mode, "new-console") == 0) {
    return CREATE_NEW_CONSOLE;
  }
  if (strcmp(mode, "detached") == 0) {
    return DETACHED_PROCESS;
  }
  if (strcmp(mode, "no-window") == 0) {
    return CREATE_NO_WINDOW;
  }
  return 0;
}

int main(int argc, char **argv) {
  const char *mode = argc > 1 ? argv[1] : "default";
  DWORD flags = mode_to_flags(mode);

  char cwd[MAX_PATH];
  if (!GetCurrentDirectoryA(MAX_PATH, cwd)) {
    fprintf(stderr, "GetCurrentDirectory failed: %lu\n", (unsigned long)GetLastError());
    return 2;
  }

  char systemRoot[MAX_PATH];
  DWORD systemRootLength = GetEnvironmentVariableA("SystemRoot", systemRoot, MAX_PATH);
  if (systemRootLength == 0 || systemRootLength >= MAX_PATH) {
    strcpy(systemRoot, "C:\\Windows");
  }

  char commandLine[1024];
  snprintf(commandLine, sizeof(commandLine), "\"%s\\System32\\cmd.exe\" /K echo createprocess-probe-%s", systemRoot, mode);

  STARTUPINFOA si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  ZeroMemory(&pi, sizeof(pi));
  si.cb = sizeof(si);

  BOOL ok = CreateProcessA(
      NULL,
      commandLine,
      NULL,
      NULL,
      FALSE,
      flags,
      NULL,
      cwd,
      &si,
      &pi);

  if (!ok) {
    fprintf(stderr, "CreateProcess failed: %lu commandLine=%s cwd=%s\n", (unsigned long)GetLastError(), commandLine, cwd);
    return 1;
  }

  printf("{\"mode\":\"%s\",\"pid\":%lu,\"flags\":%lu}\n", mode, (unsigned long)pi.dwProcessId, (unsigned long)flags);
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return 0;
}
