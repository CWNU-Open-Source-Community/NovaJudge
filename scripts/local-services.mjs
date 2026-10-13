import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
const agents = path.join(os.homedir(), 'Library/LaunchAgents');
const domain = `gui/${process.getuid()}`;
const command = process.argv[2] || 'status';
const roles = [
  { name: 'web', args: [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '3001'] },
  ...[1, 2].map(index => ({ name: `worker-${index}`, args: [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'worker.ts'), '--id', `local-${index}`] })),
];
const labelOf = role => `org.cwnu.novajudge.local.${role.name}`;
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function run(file, args) { execFileSync(file, args, { cwd: root, stdio: 'inherit' }); }
function stopAgents() {
  for (const role of roles) spawnSync('/bin/launchctl', ['bootout', `${domain}/${labelOf(role)}`], { stdio: 'ignore' });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.platform !== 'darwin') throw new Error('This local service helper requires macOS launchd.');
if (['start', 'restart'].includes(command)) {
  mkdirSync(path.join(local, 'logs'), { recursive: true }); mkdirSync(agents, { recursive: true });
  run('docker', ['compose', '-f', 'compose.local.yml', 'up', '-d', '--wait']);
  if (command === 'restart') { stopAgents(); await pause(2000); }
  for (const role of roles) {
    if (command === 'start' && spawnSync('/bin/launchctl', ['print', `${domain}/${labelOf(role)}`], { stdio: 'ignore' }).status === 0) continue;
    const args = [process.execPath, '--require', 'dotenv/config', ...role.args];
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(labelOf(role))}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>${xml(`${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
<key>NODE_ENV</key><string>production</string><key>TZ</key><string>Asia/Shanghai</string>
</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(path.join(local, 'logs', `${role.name}.log`))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(local, 'logs', `${role.name}.error.log`))}</string>
</dict></plist>`;
    const file = path.join(agents, `${labelOf(role)}.plist`); writeFileSync(file, plist, { mode: 0o600 });
    let started = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = spawnSync('/bin/launchctl', ['bootstrap', domain, file], { encoding: 'utf8' });
      if (result.status === 0) { started = true; break; }
      if (attempt === 19) throw new Error(`Cannot start ${role.name}: ${result.stderr.trim()}`);
      await pause(1000);
    }
    if (!started) throw new Error(`Cannot start ${role.name}`);
  }
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:3001/', { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) { ready = true; break; }
    } catch { /* launchd starts the process before it accepts HTTP requests. */ }
    await pause(1000);
  }
  if (!ready) throw new Error('NovaJudge web did not become ready; inspect .local/logs/web.error.log.');
  console.log('NovaJudge started: http://localhost:3001 (web + two judge workers).');
} else if (command === 'stop') {
  stopAgents();
  run('docker', ['compose', '-f', 'compose.local.yml', 'stop']);
  console.log('Stopped local services; database, Redis and uploaded files are preserved.');
} else if (command !== 'status') throw new Error('Usage: node scripts/local-services.mjs start|stop|restart|status');

if (command !== 'stop') {
  run('docker', ['compose', '-f', 'compose.local.yml', 'ps']);
  for (const role of roles) {
    const result = spawnSync('/bin/launchctl', ['print', `${domain}/${labelOf(role)}`], { encoding: 'utf8' });
    console.log(`${role.name}: ${result.status === 0 ? result.stdout.match(/state = (\S+)/)?.[1] || 'loaded' : 'stopped'}${result.stdout?.match(/pid = (\d+)/)?.[1] ? ` (PID ${result.stdout.match(/pid = (\d+)/)[1]})` : ''}`);
  }
}
