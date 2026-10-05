"""Start the paired local services once, under the signed-in Windows user."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from filelock import FileLock, Timeout
import httpx

from diagnostics import safe_error
from nas_bridge import configuration
from provider import atomic_json
from worker_auth import local_directory, worker_token

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / ".music-runtime" / "autostart"
PYTHON = ROOT / ".music-runtime" / "venv" / "Scripts" / "python.exe"


def configure():
    """Resolve MSIX AppData virtualization without moving or decrypting credentials."""
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                  ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.GetFinalPathNameByHandleW.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    resolved = []
    for name in ("worker-api.dpapi", "nas-bridge.dpapi", "huggingface.dpapi"):
        handle = kernel.CreateFileW(str(local_directory() / name), 0, 7, None, 3, 0, None)
        if handle == wintypes.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            buffer = ctypes.create_unicode_buffer(32768)
            if not kernel.GetFinalPathNameByHandleW(handle, buffer, len(buffer), 0):
                raise ctypes.WinError(ctypes.get_last_error())
            resolved.append(Path(buffer.value.removeprefix("\\\\?\\")).parent)
        finally:
            kernel.CloseHandle(handle)
    if len(set(resolved)) != 1 or resolved[0].parts[-2:] != ("VoiceGrok", "Music"):
        raise RuntimeError("MUSIC_CREDENTIAL_LOCATIONS_DIFFER")
    atomic_json(RUNTIME / "config.json", {"localAppData": str(resolved[0].parent.parent)})


def locked(path):
    try:
        with FileLock(str(path), timeout=0):
            return False
    except Timeout:
        return True


def start_component(name, script, lock_name):
    if locked(local_directory() / lock_name):
        return {"state": "ALREADY_RUNNING"}
    log = RUNTIME / f"{name}.log"
    # Rotate only when this component is stopped, keeping the previous startup log.
    if log.exists() and log.stat().st_size > 2 * 2**20:
        log.replace(log.with_suffix(".previous.log"))
    environment = os.environ.copy()
    environment.update(PYTHONUNBUFFERED="1", PYTHONUTF8="1")
    with log.open("ab") as output:
        child = subprocess.Popen(
            [str(PYTHON), str(ROOT / "services" / "music" / script)],
            cwd=ROOT, env=environment, stdin=subprocess.DEVNULL,
            stdout=output, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    return {"state": "STARTED", "pid": child.pid, "process": child}


def run():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    # Packaged desktop tools can see an AppData overlay that Task Scheduler cannot.
    # Use its resolved physical path for both credentials and shared process locks.
    config = json.loads((RUNTIME / "config.json").read_text(encoding="utf-8"))
    os.environ["LOCALAPPDATA"] = config["localAppData"]
    # A repeated manual invocation and the logon trigger cannot launch concurrently.
    try:
        startup_lock = FileLock(str(local_directory() / "autostart.lock"), timeout=0)
        startup_lock.acquire()
    except Timeout:
        return 0
    report = {"startedAt": time.time(), "pid": os.getpid(), "state": "STARTING",
              "credentialDirectory": str(local_directory())}
    try:
        # Validate existing user-bound credentials before launching either process.
        report["credentialFilePresent"] = (local_directory() / "worker-api.dpapi").is_file()
        token = worker_token()
        configuration()
        if not PYTHON.is_file():
            raise RuntimeError("MUSIC_PYTHON_MISSING")
        components = {
            "worker": start_component("worker", "worker_api.py", "gpu-worker.lock"),
            "bridge": start_component("bridge", "nas_bridge.py", "nas-bridge.lock"),
        }
        report["components"] = {name: {k: v for k, v in value.items() if k != "process"}
                                for name, value in components.items()}
        atomic_json(RUNTIME / "status.json", report)
        deadline = time.monotonic() + 90
        with httpx.Client(base_url="http://127.0.0.1:8093", timeout=3, trust_env=False,
                          headers={"Authorization": "Bearer " + token}) as client:
            while time.monotonic() < deadline:
                for name, component in components.items():
                    child = component.get("process")
                    if child and child.poll() is not None:
                        raise RuntimeError(f"{name.upper()}_EXITED_{child.returncode}")
                try:
                    response = client.get("/health")
                    if response.status_code == 200 and response.json().get("service") == "voice-grok-music-worker":
                        if locked(local_directory() / "nas-bridge.lock"):
                            report.update(state="STARTED", workerAcceptingJobs=True,
                                          workerSessionId=response.json()["sessionId"])
                            break
                except httpx.TransportError:
                    pass
                time.sleep(1)
            else:
                raise RuntimeError("MUSIC_STARTUP_HEALTH_TIMEOUT")
        # Bridge keeps retrying if Tailscale or NAS is not available at logon.
        # Do not kill/restart an unhealthy live worker or resubmit failed GPU jobs.
        bridge_status = ROOT / ".music-runtime" / "nas-bridge" / "status.json"
        if bridge_status.is_file():
            report["lastBridgeStatus"] = json.loads(bridge_status.read_text(encoding="utf-8"))
        return 0
    except Exception as error:
        report.update(state="ERROR", error=safe_error(error))
        return 1
    finally:
        report["finishedAt"] = time.time()
        atomic_json(RUNTIME / "status.json", report)
        startup_lock.release()


if __name__ == "__main__":
    if sys.argv[1:] == ["--configure"]:
        configure()
    else:
        raise SystemExit(run())
