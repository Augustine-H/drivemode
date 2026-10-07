"""GUI Python entrypoint: keep the scheduled supervisor free of consoles."""
import argparse
import os
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--script', required=True)
parser.add_argument('--project-root', required=True)
parser.add_argument('--node')
parser.add_argument('--data', required=True)
args = parser.parse_args()
command = [os.path.join(os.environ['SystemRoot'], 'System32', 'WindowsPowerShell',
                        'v1.0', 'powershell.exe'),
           '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
           '-File', args.script, '-ProjectRoot', args.project_root,
           '-DataDirectory', args.data]
if args.node:
    command.extend(['-NodePath', args.node])
with open(os.path.join(args.data, 'Autostart', 'launcher.log'), 'ab', buffering=0) as log:
    result = subprocess.run(command, cwd=args.project_root,
                            creationflags=subprocess.CREATE_NO_WINDOW,
                            stdin=subprocess.DEVNULL, stdout=log, stderr=log)
sys.exit(result.returncode)
