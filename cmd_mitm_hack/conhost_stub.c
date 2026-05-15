#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <windows.h>

static void write_log(int argc, char **argv) {
  FILE *file = fopen("conhost_stub.log", "ab");
  if (!file) {
    return;
  }

  time_t now = time(NULL);
  fprintf(file, "=== fake conhost.exe launched at %lld ===\n", (long long)now);
  fprintf(file, "pid=%lu parent_unknown cwd=", (unsigned long)GetCurrentProcessId());

  char cwd[MAX_PATH];
  if (GetCurrentDirectoryA(MAX_PATH, cwd)) {
    fprintf(file, "%s\n", cwd);
  } else {
    fprintf(file, "<GetCurrentDirectory failed>\n");
  }

  fprintf(file, "GetCommandLineA=%s\n", GetCommandLineA());
  for (int i = 0; i < argc; i++) {
    fprintf(file, "argv[%d]=%s\n", i, argv[i]);
  }
  fflush(file);
  fclose(file);
}

int main(int argc, char **argv) {
  write_log(argc, argv);

  FILE *file = fopen("conhost_stub.ready", "wb");
  if (file) {
    fprintf(file, "%lu\n", (unsigned long)GetCurrentProcessId());
    fclose(file);
  }

  Sleep(30000);
  return 0;
}
