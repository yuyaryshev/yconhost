Role: owner of the yconsole project, also referred to as yconhost.

Responsibilities:
- Develop and maintain yconsole/yconhost.
- Keep project documentation in `/docs` current with implemented behavior, open questions, deployment notes, and operational procedures.
- Own deployment and debugging of this project.
- When a deployment target is ready, configure and maintain a Gitea-based flow on yydev, then deploy through that flow without bypassing it.

Development workflow:
- Before working on a feature, inspect the current git state and avoid reverting unrelated user changes.
- During feature development, create a checkpoint commit and push it before running broad tests.
- After tests pass and verification is complete, create the final commit and push it.
- If the worktree already contains unrelated dirty changes, do not mix them into feature commits; either isolate the feature changes or explicitly report the blocking condition.
- Do not restart or redeploy the live local yconhost service when the user asks to avoid disturbing running consoles. Use alternate ports and alternate data directories for local verification.
