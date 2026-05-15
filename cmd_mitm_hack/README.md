# cmd_mitm_hack

Experimental probe for the "fake conhost.exe" idea.

The first step is intentionally small: build a `conhost.exe` stub that logs its command line and stays alive briefly. Then start `cmd.exe` with this directory as the working directory and verify whether Windows starts this local `conhost.exe` or the real system one.

Expected useful result:

- If `conhost_stub.log` appears and contains the launch arguments, the search-order replacement idea may be worth deeper work.
- If the log does not appear and process inspection shows `C:\Windows\System32\conhost.exe`, then the normal console host is resolved by the system, not by `cmd.exe` current-directory lookup.

## Commands

- `powershell -ExecutionPolicy Bypass -File .\build.ps1`
- `powershell -ExecutionPolicy Bypass -File .\run_experiment.ps1`

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

The remaining interception routes are more invasive:

- Image File Execution Options `Debugger` for `conhost.exe` (global machine-level interception, high blast radius).
- DLL/API hooking in `cmd.exe` or system console creation paths.
- Replacing or patching system `conhost.exe` (not acceptable).

For this repository, the next safe experiment would be a non-global native launcher/probe that calls `CreateProcess` with different console flags and inherited handles, to confirm whether any documented creation path allows choosing an alternate console host. The current evidence suggests it will not.
