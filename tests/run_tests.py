"""Runs tests/index.html in headless Edge/Chromium and exits 0 only if it reports ALL PASS.

Usage: python tests/run_tests.py [--timeout-s 300] [--browser PATH]

Python standard library only. The game folder is served on a free port; the test page POSTs its
result back to this script (headless --dump-dom prints nothing when piped on this Windows setup).
"""
import argparse
import functools
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/microsoft-edge",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
]


def find_browser(explicit):
    if explicit:
        return explicit
    for path in EDGE_CANDIDATES:
        if os.path.exists(path):
            return path
    for name in ("msedge", "chromium", "google-chrome"):
        found = shutil.which(name)
        if found:
            return found
    sys.exit("No Edge/Chromium found; pass --browser PATH")


def make_server(result):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            if self.path != "/__result":
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length", 0))
            try:
                result["data"] = json.loads(self.rfile.read(length).decode("utf-8"))
            except ValueError:
                result["data"] = {"status": "FAIL", "text": "unreadable result"}
            self.send_response(204)
            self.end_headers()
            result["event"].set()

    handler = functools.partial(Handler, directory=ROOT)
    return http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)  # port 0 = any free port


def kill_browser(proc, profile):
    """Stop the browser and any helper processes that were started with our temp profile."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
        ps = (
            "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*%s*' } "
            "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
            % os.path.basename(profile)
        )
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)
    else:
        proc.kill()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout-s", type=int, default=300, help="wall-clock limit waiting for the result")
    ap.add_argument("--browser", default=None)
    args = ap.parse_args()

    browser = find_browser(args.browser)
    result = {"event": threading.Event(), "data": None}
    server = make_server(result)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="nongfarm_edge_")
    proc = None

    try:
        cmd = [browser, "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
               f"--user-data-dir={profile}"]
        if os.environ.get("CI"):
            cmd.append("--no-sandbox")  # GitHub runners / containers
        cmd.append(f"http://127.0.0.1:{port}/tests/index.html")
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        got = result["event"].wait(args.timeout_s)
    finally:
        if proc is not None:
            kill_browser(proc, profile)
        server.shutdown()
        server.server_close()
        shutil.rmtree(profile, ignore_errors=True)

    if not got:
        print(f"FAIL: no result from the test page within {args.timeout_s}s (browser failed to start or page crashed)")
        return 1
    data = result["data"]
    print(data.get("text", ""))
    return 0 if data.get("status") == "ALL PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
