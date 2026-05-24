# Plans

This directory stores project plan documents used by the local pi plan-mode extension.

## Layout
- `*.md` — active or proposed plan files
- `done/*.md` — completed plans (kept for reference)
- `.plan-state.json` — extension state (current active plan and mode)

## Workflow
- Toggle plan mode in pi with `Ctrl+J`
- `/plan` ensures the active plan exists and switches to plan mode
- `/plan-new <name>` creates a new active plan
- `/plan-open` shows the current active plan path
- `/plan-sync` refreshes plan UI and ensures the file exists

## Intention
Plans are lightweight working context files for active tasks. They are meant to capture:
- current goal
- constraints
- task checklist
- notes
- changed files

These files are human-readable and agent-readable project context, not pi runtime internals.
