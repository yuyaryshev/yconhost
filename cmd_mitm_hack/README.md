# cmd_mitm_hack

Experimental probe for the "fake conhost.exe" idea.

The first step is intentionally small: build a `conhost.exe` stub that logs its command line and stays alive briefly. Then start `cmd.exe` with this directory as the working directory and verify whether Windows starts this local `conhost.exe` or the real system one.

Expected useful result:

- If `conhost_stub.log` appears and contains the launch arguments, the search-order replacement idea may be worth deeper work.
- If the log does not appear and process inspection shows `C:\Windows\System32\conhost.exe`, then the normal console host is resolved by the system, not by `cmd.exe` current-directory lookup.

## Commands

- `powershell -ExecutionPolicy Bypass -File .\build.ps1`
- `powershell -ExecutionPolicy Bypass -File .\run_experiment.ps1`
- `powershell -ExecutionPolicy Bypass -File .\run_safe_variants.ps1`

## Findings So Far

Tested on this host:

- `cmd.exe` was started with `cmd_mitm_hack` as its working directory.
- A local executable named `conhost.exe` existed in that directory.
- A second run also prepended `cmd_mitm_hack` to `PATH`.

Observed result:

- The local `cmd_mitm_hack\conhost.exe` was not launched.
- Windows started `C:\Windows\system32\conhost.exe` directly.
- The real command line was `\??\C:\Windows\system32\conhost.exe 0x4`.
- The real `conhost.exe` was parented by the tested `cmd.exe`.

Control result:

- Directly running `cmd_mitm_hack\conhost.exe direct-test` does create `conhost_stub.log`, so the stub itself works.

Current implication:

The simple search-order replacement hypothesis is false for normal `cmd.exe` console creation. The console host path appears to be resolved by the Windows console subsystem as the system `conhost.exe`, not by `cmd.exe` via current-directory or `PATH` lookup.

Additional safe variants were tested:

- Native `CreateProcess` from `cmd_mitm_hack` cwd with default flags.
- Native `CreateProcess` with `CREATE_NEW_CONSOLE`.
- Native `CreateProcess` with `CREATE_NEW_CONSOLE` and `cmd_mitm_hack` prepended to `PATH`.
- Temporary per-user `HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\conhost.exe`, removed immediately after process launch.

Observed result for all variants that created a new console:

- The local stub was not launched.
- The new console host was still `C:\Windows\system32\conhost.exe`.
- The command line remained `\??\C:\Windows\system32\conhost.exe 0x4`.

The default `CreateProcess` case without `CREATE_NEW_CONSOLE` did not create a new host because the child inherited the launcher's existing console context.

The remaining interception routes are more invasive and are intentionally excluded from safe tests:

- Image File Execution Options `Debugger` for `conhost.exe` (global machine-level interception, high blast radius).
- DLL/API hooking in `cmd.exe` or system console creation paths.
- Replacing or patching system `conhost.exe` (not acceptable).

Current safe-test conclusion:

No documented non-global process creation path tested so far lets a caller choose an alternate console host executable for a normal visible Windows console session.
