'use strict';
// Lance l'application en mode test. Sous Linux sans écran, passe par xvfb-run.

const path = require('node:path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const args = ['.'];
let cmd = electron;
if (process.platform === 'linux') {
  args.push('--no-sandbox');
  if (!process.env.DISPLAY) { args.unshift(electron); cmd = 'xvfb-run'; args.unshift('-a'); }
}
const env = { ...process.env, JUNR_TEST: '1' };
delete env.ELECTRON_RUN_AS_NODE;
// `--only <motif>` équivaut à JUNR_ONLY (ne lance que les sections dont le titre correspond), sans syntaxe propre à un shell.
const onlyAt = process.argv.indexOf('--only');
if (onlyAt > 0 && process.argv[onlyAt + 1]) env.JUNR_ONLY = process.argv[onlyAt + 1];
// Garde-fou externe (JUNR_TEST_TIMEOUT_MIN) : si l'application ne répond plus du tout (blocage natif, le chien de garde interne ne
// peut alors plus s'exécuter), elle est tuée. Un blocage ou un échec est rejoué (JUNR_TEST_ATTEMPTS) : une vraie régression échoue à chaque essai, un aléa du runner (service worker lent) non.
const { spawn } = require('node:child_process');
const timeoutMs = process.env.JUNR_TEST_TIMEOUT_MIN ? Number(process.env.JUNR_TEST_TIMEOUT_MIN) * 60000 + 30000 : 0; // 30 s après le garde-fou interne
const attempts = Math.max(1, Number(process.env.JUNR_TEST_ATTEMPTS || 1));

// Photographie des processus de l'application au moment du blocage : qui reste, qui consomme du processeur.
function snapshot() {
  if (process.platform !== 'win32') return;
  const ps = "$ProgressPreference='SilentlyContinue'; $a=Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\"; Start-Sleep 3; $b=Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\"; "
    + "$b | ForEach-Object { $o=$_; $p=$a | Where-Object ProcessId -eq $o.ProcessId; $t=if($o.CommandLine -match '--type=([a-z-]+)'){$Matches[1]}else{'main'}; "
    + "'{0} pid={1} cpu+={2:N2}s threads={3} ram={4}Mo' -f $t,$o.ProcessId,((($o.KernelModeTime+$o.UserModeTime)-($p.KernelModeTime+$p.UserModeTime))/1e7),$o.ThreadCount,[int]($o.WorkingSetSize/1MB) }";
  const r = require('node:child_process').spawnSync('powershell', ['-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 30000 });
  console.log('DIAG  processus au moment du blocage :\n' + (r.stdout.trim() || 'aucun processus electron.exe'));
}

function attempt(n) {
  const child = spawn(cmd, args, { cwd: root, env, stdio: 'inherit' });
  let timer = null, hung = false;
  if (timeoutMs) timer = setTimeout(() => { hung = true; snapshot(); child.kill('SIGKILL'); }, timeoutMs);
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (!hung && code === 0) process.exit(0);
    // Des processus Electron restés après un échec bloquent l'essai suivant : on repart toujours d'un poste propre.
    const sweep = () => { if (process.env.CI && process.platform === 'win32') require('node:child_process').spawnSync('taskkill', ['/F', '/T', '/IM', 'electron.exe'], { stdio: 'ignore' }); };
    if (!hung) { console.log(`FAIL  Essai ${n}/${attempts} échoué (code ${code})`); sweep(); if (n < attempts) return attempt(n + 1); process.exit(code ?? 1); }
    console.log(`FAIL  Application bloquée : plus de ${Math.round(timeoutMs / 60000)} min sans fin (essai ${n}/${attempts})`);
    sweep();
    if (n < attempts) attempt(n + 1); else process.exit(1);
  });
}
attempt(1);
