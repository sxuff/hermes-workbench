"""``hermes workbench``: open Hermes in the browser as its own app window.

The Workbench is a dashboard plugin, so the Hermes dashboard server is its
backend: it serves the page, injects the session auth, and hosts the gateway
WebSocket. This command makes that invisible. It reuses a running dashboard, or
starts one in the background, then opens ``/workbench`` for the current profile.

The page shows the Hermes desktop app's own interface: this command copies a
desktop build into the plugin (re-syncing when it changes) and injects a browser
shim for its Electron bridge. The build is either the Electron app's own
(``hermes desktop``) or a web-only one from ``hermes workbench build``, which
compiles just the interface in an isolated folder: no Electron download, no
native modules, and nothing written into the Hermes checkout. Without either,
the plugin's lighter built-in UI is shown instead.

It never reads or prints credentials; the page gets its auth from the dashboard.
Standard library only (psutil, when Hermes ships it, hardens ``stop``).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import shutil
import webbrowser
from pathlib import Path

PLUGIN = "hermes-workbench"
DEFAULT_PORT = 9119
START_TIMEOUT_S = 90
# Only what the dashboard's plugin asset route serves; Electron main/preload and native binaries stay out.
SERVED_SUFFIXES = {".js", ".mjs", ".css", ".json", ".html", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp",
                   ".ico", ".woff2", ".woff", ".ttf", ".otf"}
ELECTRON_ONLY = {"electron-main.mjs", "electron-preload.js"}
SHIM_TAG = '<script src="./hermes-web-shim.js"></script>'


class WorkbenchError(Exception):
    def __init__(self, message: str, code: int = 2):
        super().__init__(message)
        self.code = code


def setup_parser(parser) -> None:
    commands = parser.add_subparsers(dest="workbench_action")
    for action, text in (("open", "Open the Workbench, starting the dashboard backend if needed (default)"),
                         ("status", "Show whether the backend is up and serving the Workbench"),
                         ("stop", "Stop the dashboard backend, only if this command started it"),
                         ("build", "Build the desktop interface for the browser (needs Node; a few minutes)")):
        sub = commands.add_parser(action, help=text)
        sub.add_argument("--port", type=int, default=None, help=f"Dashboard port (default {DEFAULT_PORT})")
        if action == "open":
            sub.add_argument("--no-browser", action="store_true", dest="workbench_no_browser",
                             help="Only print the URL (for SSH sessions)")
            # Positional, because Hermes itself claims --profile/-p anywhere on the command line.
            sub.add_argument("workbench_profile", nargs="?", default=None, metavar="PROFILE",
                             help="Open straight into this Hermes profile (default: the current one)")
        if action == "status":
            sub.add_argument("--json", action="store_true", dest="workbench_json")
    # `hermes workbench --port N` without a subcommand means `open --port N`.
    parser.add_argument("--port", type=int, default=None, dest="workbench_port_top", help=argparse.SUPPRESS)
    parser.add_argument("--no-browser", action="store_true", dest="workbench_no_browser_top", help=argparse.SUPPRESS)


def hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes").expanduser()


def profile_name() -> str:
    """Profile of this invocation (``hermes -p work workbench`` -> ``work``)."""
    try:
        from hermes_cli.profiles import get_active_profile_name
        name = get_active_profile_name()
    except Exception:
        return "default"
    if name == "custom":
        print("hermes workbench: HERMES_HOME is not a named profile; opening the default profile.", file=sys.stderr)
        return "default"
    return name or "default"


def default_hermes_home() -> Path:
    """Home of the machine-level dashboard, which loads UI plugins from the default profile."""
    try:
        from hermes_cli.profiles import _get_default_hermes_home
        return Path(_get_default_hermes_home())
    except Exception:
        home = hermes_home()
        return home.parent.parent if home.parent.name == "profiles" else home


def hermes_root() -> Path | None:
    try:
        import hermes_cli
        return Path(hermes_cli.__file__).resolve().parent.parent
    except Exception:
        return None


def build_root() -> Path:
    return default_hermes_home() / PLUGIN / "desktop-build"


def web_build_dist() -> Path:
    return build_root() / "out"


def desktop_dist() -> Path | None:
    """The desktop build to serve: an explicit override, else the newest of the Electron app's
    own build and the web-only one from `hermes workbench build`."""
    override = os.environ.get("HERMES_DESKTOP_DIST")
    if override:
        return Path(override) if (Path(override) / "index.html").is_file() else None
    root = hermes_root()
    candidates = [d for d in ((root / "apps" / "desktop" / "dist") if root else None, web_build_dist())
                  if d and (d / "index.html").is_file()]
    return max(candidates, key=lambda d: (d / "index.html").stat().st_mtime, default=None)


def hermes_revision() -> str:
    """Identifies the Hermes source a web build came from (git commit, else version)."""
    root = hermes_root()
    if root:
        try:
            out = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10)
            if out.returncode == 0 and out.stdout.strip():
                return out.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        import hermes_cli
        return f"v{hermes_cli.__version__}"
    except Exception:
        return "unknown"


def web_build_stale() -> bool:
    """True when the served build is the web-only one and Hermes has moved on since."""
    dist = desktop_dist()
    if dist != web_build_dist():
        return False
    try:
        return (dist / ".hermes-revision").read_text(encoding="utf-8").strip() != hermes_revision()
    except OSError:
        return True


def served_plugin_dir() -> Path:
    served = default_hermes_home() / "plugins" / PLUGIN
    return served if (served / "dashboard").is_dir() else Path(__file__).resolve().parent


def shim_file() -> Path:
    return Path(__file__).resolve().parent / "desktop-web" / "hermes-web-shim.js"


def sync_desktop() -> str:
    """Copy the desktop build next to the plugin's UI if it changed. Returns synced, current or missing."""
    dist = desktop_dist()
    if not dist or not shim_file().is_file():
        return "missing"
    target = served_plugin_dir() / "dashboard" / "desktop"
    # index.html names every content-hashed bundle, so it changes with each desktop build.
    fingerprint = hashlib.sha256((dist / "index.html").read_bytes() + shim_file().read_bytes()).hexdigest()
    stamp = target / ".workbench-stamp"
    if stamp.is_file() and stamp.read_text(encoding="utf-8").strip() == fingerprint:
        return "current"
    print("hermes workbench: installing the desktop interface into the plugin...")
    staging = target.with_name("desktop.staging")
    shutil.rmtree(staging, ignore_errors=True)
    for src in dist.rglob("*"):
        if src.is_file() and src.suffix.lower() in SERVED_SUFFIXES and src.name not in ELECTRON_ONLY:
            dst = staging / src.relative_to(dist)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    shutil.copy2(shim_file(), staging / "hermes-web-shim.js")
    index = staging / "index.html"
    # The shim must define window.hermesDesktop before any app script runs.
    index.write_text(index.read_text(encoding="utf-8").replace("<head>", "<head>\n    " + SHIM_TAG, 1), encoding="utf-8")
    (staging / ".workbench-stamp").write_text(fingerprint, encoding="utf-8")
    shutil.rmtree(target, ignore_errors=True)
    staging.rename(target)
    return "synced"


def node_tool(name: str) -> str | None:
    # Prefer the Node runtime Hermes manages (it satisfies Hermes's engine constraints).
    try:
        from hermes_constants import find_node_executable
        found = find_node_executable(name)
        if found:
            return str(found)
    except Exception:
        pass
    return shutil.which(name)


def build_env() -> dict:
    env = dict(os.environ)
    try:
        from hermes_constants import with_hermes_node_path
        env = with_hermes_node_path(env)
    except Exception:
        pass
    # The interface needs neither the Electron binary nor compiled native modules.
    env["ELECTRON_SKIP_BINARY_DOWNLOAD"] = "1"
    return env


def build_desktop() -> None:
    """Compile only the desktop app's web interface, in an isolated mini-workspace.

    The Hermes checkout is only read: sources are copied into ~/.hermes/hermes-workbench/desktop-build,
    dependencies install there with scripts disabled (so no Electron download or native compile), and
    Vite writes the bundle to desktop-build/out. Installing into the checkout itself is avoided on
    purpose: Hermes's own installs use `npm ci`, and a narrower install there would prune its tree.
    """
    root = hermes_root()
    if not root or not (root / "apps" / "desktop" / "package.json").is_file():
        raise WorkbenchError("this Hermes install has no desktop app sources (apps/desktop) to build from")
    npm, node = node_tool("npm"), node_tool("node")
    if not npm or not node:
        raise WorkbenchError("building the desktop interface needs Node.js; install it (or run `hermes setup`) and retry")
    work = build_root() / "workspace"
    print(f"hermes workbench: building the desktop interface in {build_root()} (a few minutes the first time)...")
    skip = shutil.ignore_patterns("node_modules", "dist", "release", "build", "e2e", "pr-assets")
    for app in ("desktop", "shared"):
        # Refresh sources but keep the app's own node_modules: npm nests some packages there.
        dest = work / "apps" / app
        if dest.is_dir():
            for entry in dest.iterdir():
                if entry.name != "node_modules":
                    shutil.rmtree(entry) if entry.is_dir() else entry.unlink()
        shutil.copytree(root / "apps" / app, dest, ignore=skip, dirs_exist_ok=True)
    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    manifest["workspaces"] = ["apps/desktop", "apps/shared"]
    manifest.get("scripts", {}).pop("postinstall", None)
    (work / "package.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    for name in ("package-lock.json", ".npmrc"):
        if (root / name).is_file():
            shutil.copy2(root / name, work / name)
    # Reinstall only when the dependency manifests change (i.e. after a Hermes update touched them).
    deps = hashlib.sha256(b"".join(p.read_bytes() for p in (
        work / "package.json", work / "package-lock.json", work / "apps" / "desktop" / "package.json",
        work / "apps" / "shared" / "package.json") if p.is_file())).hexdigest()
    deps_stamp = work / ".deps-stamp"
    env = build_env()

    def install() -> None:
        print("hermes workbench: installing interface dependencies (scripts disabled)...")
        deps_stamp.unlink(missing_ok=True)
        code = subprocess.call([npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], cwd=work, env=env)
        if code != 0:
            raise WorkbenchError(f"npm install failed with exit code {code}")
        deps_stamp.write_text(deps, encoding="utf-8")

    staging = build_root() / "out.staging"
    vite = work / "node_modules" / "vite" / "bin" / "vite.js"

    def compile_interface() -> bool:
        shutil.rmtree(staging, ignore_errors=True)
        print("hermes workbench: compiling the interface...")
        code = subprocess.call([node, str(vite), "build", "--outDir", str(staging), "--emptyOutDir", "--logLevel", "warn"],
                               cwd=work / "apps" / "desktop", env=env)
        return code == 0 and (staging / "index.html").is_file()

    installed_now = False
    if not (work / "node_modules").is_dir() or not deps_stamp.is_file() or deps_stamp.read_text(encoding="utf-8") != deps:
        install()
        installed_now = True
    if not compile_interface():
        if installed_now:
            raise WorkbenchError("the interface build failed; see the output above")
        # A cached tree can be incomplete (interrupted install, pruned nested modules): reinstall once.
        install()
        if not compile_interface():
            raise WorkbenchError("the interface build failed; see the output above")
    (staging / ".hermes-revision").write_text(hermes_revision(), encoding="utf-8")
    shutil.rmtree(web_build_dist(), ignore_errors=True)
    staging.rename(web_build_dist())
    print("hermes workbench: desktop interface built.")


def cmd_build(port: int) -> int:
    build_desktop()
    sync_desktop()
    if probe(port)["state"] == "ready":
        print(f"Reload {workbench_url(port, profile_name())} to use it.")
    return 0


def state_file() -> Path:
    return hermes_home() / PLUGIN / "backend.json"


def base_url(port: int) -> str:
    return f"http://127.0.0.1:{port}"


def workbench_url(port: int, profile: str) -> str:
    url = f"{base_url(port)}/workbench"
    return url if profile == "default" else f"{url}?profile={urllib.request.quote(profile)}"


def http_status(url: str) -> tuple[int, str]:
    """(status, body prefix); status 0 when nothing is listening."""
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            return resp.status, resp.read(4096).decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        return err.code, ""
    except (urllib.error.URLError, OSError, ValueError):
        return 0, ""


def probe(port: int) -> dict:
    """What is on the port: nothing, something that is not a dashboard, a dashboard without the
    Workbench (not installed, not enabled, or installed after it started), or a ready Workbench."""
    status, body = http_status(base_url(port) + "/")
    if status == 0:
        return {"state": "down"}
    if status != 200 or "<html" not in body.lower():
        # `hermes serve` is headless: it has the gateway but serves no pages.
        return {"state": "foreign", "detail": f"port {port} answers but serves no dashboard page (HTTP {status})"}
    asset, _ = http_status(f"{base_url(port)}/dashboard-plugins/{PLUGIN}/dist/index.js")
    return {"state": "ready"} if asset == 200 else {"state": "missing", "detail": f"plugin asset HTTP {asset}"}


def hermes_command() -> list[str]:
    # Same interpreter as this Hermes process, so the backend is the same install.
    return [sys.executable, "-m", "hermes_cli.main"]


def spawn_options() -> dict:
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
                | getattr(subprocess, "CREATE_NO_WINDOW", 0), "close_fds": True}
    return {"start_new_session": True, "close_fds": True}


def process_identity(pid: int) -> dict | None:
    try:
        import psutil
        proc = psutil.Process(pid)
        return {"create_time": proc.create_time(), "cmdline": " ".join(proc.cmdline())}
    except Exception:
        return None


def start_backend(port: int, profile: str) -> None:
    runtime = state_file().parent
    runtime.mkdir(parents=True, exist_ok=True)
    argv = hermes_command() + ([] if profile == "default" else ["-p", profile]) + [
        "dashboard", "--no-open", "--skip-build", "--port", str(port)]
    with open(runtime / "dashboard.log", "ab") as log:
        options = spawn_options()
        try:
            if os.name == "nt":
                # Terminals that kill their whole job on exit would take the backend with them.
                breakaway = dict(options, creationflags=options["creationflags"] | getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0x01000000))
                proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, **breakaway)
            else:
                proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, **options)
        except PermissionError:
            # The job forbids breakaway; the backend then lives as long as this terminal's job.
            proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, **options)
    identity = process_identity(proc.pid) or {}
    state_file().write_text(json.dumps({"pid": proc.pid, "port": port, **identity}), encoding="utf-8")
    print(f"hermes workbench: starting the dashboard backend on port {port} (log: {runtime / 'dashboard.log'})")
    deadline = time.monotonic() + START_TIMEOUT_S
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise WorkbenchError(f"the dashboard exited with code {proc.returncode}; see {runtime / 'dashboard.log'}")
        if probe(port)["state"] in ("ready", "missing"):
            return
        time.sleep(0.5)
    raise WorkbenchError(f"the dashboard did not answer within {START_TIMEOUT_S}s; see {runtime / 'dashboard.log'}")


def ensure_ready(port: int, profile: str) -> None:
    found = probe(port)
    if found["state"] == "down":
        start_backend(port, profile)
        found = probe(port)
    if found["state"] == "foreign":
        raise WorkbenchError(f"{found['detail']}. If `hermes serve` holds it, stop it or pass --port.")
    if found["state"] == "missing":
        # Usually a dashboard that started before the plugin was installed: it only discovers
        # plugins at startup. Restart ours without asking; the user's own only with consent.
        state = read_state()
        if owned_backend(state) and state.get("port") == port:
            print("hermes workbench: restarting the dashboard backend so it loads the Workbench...")
            stop_owned(state)
        elif interactive() and ask("hermes workbench: the running dashboard started before the Workbench was installed. "
                                   "Restart it now? [Y/n] "):
            subprocess.call(hermes_command() + ["dashboard", "--stop"])
        else:
            raise WorkbenchError(
                "the running dashboard isn't serving the Workbench. Restart it (`hermes dashboard --stop`, then "
                f"`hermes workbench`), and check the plugin is enabled (`hermes plugins enable {PLUGIN}`).")
        start_backend(port, profile)
        if probe(port)["state"] != "ready":
            raise WorkbenchError(f"the dashboard still isn't serving the Workbench; enable it with `hermes plugins enable {PLUGIN}`")


def can_open_browser() -> bool:
    if os.name == "nt" or sys.platform == "darwin":
        return True
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")) and not os.environ.get("SSH_CONNECTION")


def interactive() -> bool:
    return sys.stdin.isatty() and sys.stdout.isatty()


def ask(question: str) -> bool:
    return input(question).strip().lower() in ("", "y", "yes")


def can_build() -> bool:
    root = hermes_root()
    return bool(root and (root / "apps" / "desktop" / "package.json").is_file() and node_tool("npm") and node_tool("node"))


def ensure_interface() -> None:
    """Build the desktop interface when there is none, or when Hermes moved on since the web build."""
    missing, stale = desktop_dist() is None, web_build_stale()
    if (missing or stale) and can_build():
        if missing:
            print("hermes workbench: first run, building the desktop interface (one time, a few minutes)...")
        else:
            print("hermes workbench: Hermes was updated, refreshing the desktop interface...")
        try:
            build_desktop()
        except WorkbenchError as err:
            # Keep going with whatever exists: an older build, or the built-in UI.
            print(f"hermes workbench: {err}", file=sys.stderr)
    if sync_desktop() == "missing":
        print("hermes workbench: no desktop interface (it needs Node and the Hermes desktop sources to build), "
              "so the lighter built-in UI will open.")


def resolve_profile(requested: str | None) -> str:
    if not requested:
        return profile_name()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", requested):
        raise WorkbenchError(f"invalid profile name: {requested!r}")
    return requested


def cmd_open(port: int, no_browser: bool, requested_profile: str | None = None) -> int:
    profile = resolve_profile(requested_profile)
    ensure_interface()
    ensure_ready(port, profile)
    url = workbench_url(port, profile)
    print(f"Hermes Workbench: {url}")
    if no_browser or not can_open_browser():
        if not no_browser:
            print("No graphical session here. On a remote host, forward the port over SSH and open the URL locally.")
        return 0
    webbrowser.open(url)
    return 0


def read_state() -> dict:
    try:
        return json.loads(state_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def owned_backend(state: dict) -> bool:
    """True only for the exact process this command spawned (pid reuse is ruled out by create time)."""
    pid = state.get("pid")
    if not isinstance(pid, int):
        return False
    now = process_identity(pid)
    return bool(now and "create_time" in state and now["create_time"] == state["create_time"] and "dashboard" in now["cmdline"])


def cmd_status(port: int, as_json: bool) -> int:
    found = probe(port)
    state = read_state()
    installed = (served_plugin_dir() / "dashboard" / "desktop" / ".workbench-stamp").is_file()
    report = {"port": port, "profile": profile_name(), "backend": found["state"], "detail": found.get("detail", ""),
              "interface": "desktop" if installed else ("desktop-available" if desktop_dist() else "built-in"),
              "desktop_source": ("web build" if desktop_dist() == web_build_dist() else "electron build") if desktop_dist() else "",
              "desktop_stale": web_build_stale(),
              "started_by_workbench": owned_backend(state) and state.get("port") == port,
              "url": workbench_url(port, profile_name()) if found["state"] == "ready" else ""}
    if as_json:
        print(json.dumps(report, indent=2))
    else:
        labels = {"down": "not running", "foreign": "port in use by something else", "missing": "running, Workbench not served", "ready": "ready"}
        print(f"Backend (port {port}): {labels[found['state']]}" + (f" ({report['detail']})" if report["detail"] else ""))
        print(f"Profile: {report['profile']}")
        print({"desktop": f"Interface: Hermes desktop UI ({report['desktop_source']})",
               "desktop-available": "Interface: desktop build found; `hermes workbench` will install it",
               "built-in": "Interface: built-in (run `hermes workbench build` for the desktop UI)"}[report["interface"]])
        if report["desktop_stale"]:
            print("  Built for an older Hermes: run `hermes workbench build` to refresh it.")
        if report["url"]:
            print(f"Open: {report['url']}")
        if report["started_by_workbench"]:
            print("Started by `hermes workbench`; `hermes workbench stop` will stop it.")
    return 0 if found["state"] == "ready" else 1


def stop_owned(state: dict) -> None:
    import psutil
    proc = psutil.Process(state["pid"])
    for child in proc.children(recursive=True):
        child.terminate()
    proc.terminate()
    try:
        proc.wait(timeout=15)
    except psutil.TimeoutExpired:
        proc.kill()
    state_file().unlink(missing_ok=True)


def cmd_stop(port: int) -> int:
    state = read_state()
    if not owned_backend(state):
        print("hermes workbench: no backend started by this command is running. "
              "To stop a dashboard you started yourself, use `hermes dashboard --stop`.")
        return 0
    stop_owned(state)
    print(f"hermes workbench: stopped the dashboard backend on port {state.get('port', port)}.")
    return 0


def run(args) -> int:
    action = getattr(args, "workbench_action", None) or "open"
    port = getattr(args, "port", None) or getattr(args, "workbench_port_top", None) or DEFAULT_PORT
    if not 0 < port < 65536:
        raise WorkbenchError("port must be between 1 and 65535")
    if action == "open":
        return cmd_open(port, bool(getattr(args, "workbench_no_browser", False) or getattr(args, "workbench_no_browser_top", False)),
                        getattr(args, "workbench_profile", None))
    if action == "build":
        return cmd_build(port)
    if action == "status":
        return cmd_status(port, bool(getattr(args, "workbench_json", False)))
    return cmd_stop(port)


def handler(args) -> None:
    try:
        code = run(args)
    except WorkbenchError as err:
        print(f"hermes workbench: {err}", file=sys.stderr)
        code = err.code
    # Hermes dispatchers do not all propagate handler return values.
    raise SystemExit(code)
