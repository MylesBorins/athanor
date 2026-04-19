#!/usr/bin/env python3
# athanor pull sidecar.
#
# Drives huggingface_hub.snapshot_download (or hf_hub_download for the
# single-file GGUF case) and emits structured NDJSON progress events
# on stdout instead of tqdm bars. The parent Node process parses the
# NDJSON and renders its own UI (Ink TUI or CLI carriage-return bar).
#
# Stdout is reserved for NDJSON. Any free-form output from
# huggingface_hub goes to stderr and the parent surfaces it as log
# lines. Exit 0 on success, 1 on download error, 2 on import error.
import json
import sys


def emit(**kw):
    sys.stdout.write(json.dumps(kw) + "\n")
    sys.stdout.flush()


def _install_tqdm_class():
    from tqdm import tqdm as std_tqdm

    class NDJSONTqdm(std_tqdm):
        # huggingface_hub constructs one tqdm per file with unit="B",
        # plus (sometimes) an outer tqdm over files with unit="files".
        # We emit both; the parent filters on `unit` to decide what to
        # render.
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            emit(
                type="begin",
                file=self.desc or "",
                total=self.total,
                unit=self.unit,
            )

        def update(self, n=1):
            super().update(n)
            self._emit_progress()

        def refresh(self, *a, **kw):
            super().refresh(*a, **kw)
            self._emit_progress()

        def _emit_progress(self):
            fd = self.format_dict
            emit(
                type="progress",
                file=self.desc or "",
                done=self.n,
                total=self.total,
                rate=fd.get("rate"),
                elapsed=fd.get("elapsed"),
                unit=self.unit,
            )

        def close(self):
            if not self.disable:
                emit(
                    type="end",
                    file=self.desc or "",
                    total=self.total,
                    done=self.n,
                    unit=self.unit,
                )
            super().close()

        # Suppress the actual bar render. We own the UI.
        def display(self, *a, **kw):
            return

    return NDJSONTqdm


def main():
    if len(sys.argv) < 2:
        emit(type="error", message="missing payload argument")
        sys.exit(2)
    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        emit(type="error", message=f"invalid payload json: {e}")
        sys.exit(2)

    try:
        from huggingface_hub import snapshot_download
    except ImportError as e:
        emit(
            type="error",
            message=(
                f"huggingface_hub not importable from {sys.executable}: {e}. "
                "Install with: uv tool install huggingface_hub"
            ),
        )
        sys.exit(2)

    NDJSONTqdm = _install_tqdm_class()

    repo = args.get("repo")
    revision = args.get("revision")
    local_dir = args.get("local_dir")
    one_file = args.get("file")
    allow_patterns = args.get("allow_patterns")

    # Single-file pull (GGUF): use snapshot_download with a restrictive
    # allow_patterns so it only fetches the one file we asked for,
    # writing into local_dir directly. This avoids needing a separate
    # code path for hf_hub_download and keeps the tqdm_class wiring
    # uniform.
    if one_file:
        allow_patterns = [one_file]

    try:
        emit(type="resolving", repo=repo, revision=revision)
        kwargs = {
            "repo_id": repo,
            "tqdm_class": NDJSONTqdm,
        }
        if revision:
            kwargs["revision"] = revision
        if local_dir:
            kwargs["local_dir"] = local_dir
        if allow_patterns:
            kwargs["allow_patterns"] = allow_patterns
        path = snapshot_download(**kwargs)
        emit(type="done", path=path)
    except KeyboardInterrupt:
        emit(type="error", message="interrupted")
        sys.exit(130)
    except Exception as e:
        emit(type="error", message=f"{type(e).__name__}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
