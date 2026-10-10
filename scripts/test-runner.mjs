import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const files = [];
function collect(directory) { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) collect(path); else if (entry.name.endsWith('.test.mjs')) files.push(path); } }
collect('scripts');
files.push('src/lib/app-data/app-data.test.ts','src/lib/app-data/readiness-schedule.test.ts','src/lib/auth/gate-identity.test.ts','src/lib/auth/sign-in-gate.test.ts','src/lib/music-model.test.ts','src/lib/singing-lyrics-guidance.test.ts');
const result = spawnSync(process.execPath, ['--experimental-strip-types','--test',...files], { stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
