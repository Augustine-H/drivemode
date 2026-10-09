import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, openSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function windowsPreview(action) {
  const root = dirname(dirname(fileURLToPath(import.meta.url))), pidFile = join(root,'.grok','preview-windows.json');
  if (existsSync(pidFile)) {
    const { pid } = JSON.parse(readFileSync(pidFile,'utf8'));
    if (Number.isSafeInteger(pid) && pid > 0) {
      const command = execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`],{encoding:'utf8',windowsHide:true});
      if (command.includes('npm-cli.js') && command.includes('preview')) {
        try { execFileSync('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}); } catch { /* The previously recorded preview may have exited already. */ }
      }
    }
  }
  const owner = execFileSync('powershell.exe',['-NoProfile','-Command',"(Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"],{encoding:'utf8',windowsHide:true}).trim();
  if (owner) {
    const pid = Number(owner);
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Cannot identify built preview owner');
    const command = execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`],{encoding:'utf8',windowsHide:true});
    if (!command.includes('vite') || !command.includes('preview') || !command.includes('8081')) throw new Error('Built preview port is occupied by another application');
    process.kill(pid);
  }
  if (action === 'stop') return;
  if (!process.env.npm_execpath) throw new Error('Run preview:restart through npm');
  mkdirSync(join(root,'.grok'),{recursive:true});
  const log = openSync(join(root,'.grok','preview-windows.log'),'a');
  const child = spawn(process.execPath,[process.env.npm_execpath,'run','preview','--','--host','127.0.0.1','--port','8081'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log],env:process.env});
  child.unref(); writeFileSync(pidFile,JSON.stringify({pid:child.pid}));
  for (let i=0;i<100;i++) {
    try { process.kill(child.pid,0); } catch { throw new Error('Built preview process exited; check preview-windows.log'); }
    try { const response = await fetch('http://127.0.0.1:8081/'); if (response.ok) { console.log('Built preview ready'); return; } } catch { /* Retry while the preview starts listening. */ }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Built preview did not become ready');
}
