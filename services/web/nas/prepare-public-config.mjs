// Operator-run candidate preparation. Does not deploy or replace runtime.json.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
const [input, origin, musicTokenFile, output] = process.argv.slice(2);
if (!input || !origin || !musicTokenFile || !output) throw new Error('Usage: node prepare-public-config.mjs PRIVATE_RUNTIME HTTPS_ORIGIN PRIVATE_MUSIC_TOKEN PRIVATE_OUTPUT_DIRECTORY');
const url = new URL(origin);
if (url.protocol !== 'https:' || url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('INVALID_PUBLIC_ORIGIN');
const current = JSON.parse(await readFile(input, 'utf8'));
if (!current.login || !current.origin || !Array.isArray(current.backends) || !current.backends.length) throw new Error('PRIVATE_RUNTIME_REQUIRED');
const musicClientToken = (await readFile(musicTokenFile, 'utf8')).trim();
if (!/^[A-Za-z0-9_-]{48,128}$/.test(musicClientToken)) throw new Error('INVALID_MUSIC_CLIENT_TOKEN');
const directory = resolve(output);
if (!(await stat(directory)).isDirectory()) throw new Error('PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
const candidate = join(directory, 'runtime.public-candidate.json');
const pairing = join(directory, 'pairing-code.txt');
if (resolve(input) === candidate || dirname(resolve(input)) !== directory) throw new Error('USE_EXISTING_PRIVATE_RUNTIME_DIRECTORY');
const code = randomBytes(48).toString('base64url');
const config = { ...current, publicOrigin: url.origin, sessionSecret: randomBytes(48).toString('base64url'), pairingHash: createHash('sha256').update(code).digest('hex'), musicClientToken };
// Exclusive creation prevents accidental credential rotation or overwrite.
await writeFile(pairing, code + '\n', { mode: 0o600, flag: 'wx' });
await writeFile(candidate, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log('Candidate configuration and pairing code created in the existing private directory. Existing runtime, services and network settings were not changed.');
