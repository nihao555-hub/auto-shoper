import os
import posixpath
from pathlib import Path

import paramiko


HOST = "81.69.255.11"
USER = "Administrator"
PASSWORD = os.environ["AUTO_SHOPER_DEPLOY_PASSWORD"]
ROOT = Path(__file__).parent


def mkdirs(sftp, path: str) -> None:
    parts = path.replace("\\", "/").split("/")
    current = ""
    if parts and parts[0].endswith(":"):
        current = parts.pop(0) + "/"
    for part in parts:
        if not part:
            continue
        current = posixpath.join(current, part)
        try:
            sftp.stat(current)
        except OSError:
            sftp.mkdir(current)


def upload_tree(sftp, local_root: Path, remote_root: str) -> None:
    mkdirs(sftp, remote_root)
    for path in local_root.rglob("*"):
        if path.is_dir():
            continue
        relative = path.relative_to(local_root).as_posix()
        remote = posixpath.join(remote_root, relative)
        mkdirs(sftp, posixpath.dirname(remote))
        sftp.put(str(path), remote)


client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=20)
sftp = client.open_sftp()
upload_tree(sftp, ROOT / "frontend" / "dist", r"C:/Services/www/auto-shoper")
# Backend runtime imports the whole app package. Upload all Python sources so
# route/model changes cannot be left behind when deploying a feature.
upload_tree(sftp, ROOT / "backend" / "app", r"C:/Services/auto-shoper-api/backend/app")
sftp.close()

commands = [
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*uvicorn*8011*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    "Start-Process -FilePath 'C:/Services/auto-shoper-api/.venv/Scripts/python.exe' -ArgumentList '-m uvicorn backend.app.main:app --host 127.0.0.1 --port 8011' -WorkingDirectory 'C:/Services/auto-shoper-api' -WindowStyle Hidden",
]
for command in commands:
    _, stdout, stderr = client.exec_command(f"powershell -NoProfile -ExecutionPolicy Bypass -Command \"{command}\"")
    stdout.read()
    error = stderr.read().decode(errors="replace").strip()
    if error:
        raise RuntimeError(error)
client.close()
print("deployed")
