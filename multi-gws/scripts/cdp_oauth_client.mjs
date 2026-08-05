#!/usr/bin/env node
/**
 * cdp_oauth_client.mjs — self-contained CDP plumbing for creating a Google
 * Cloud **Internal** OAuth client and capturing its `client_secret.json`.
 *
 * WHAT THIS DOES (and does NOT do):
 *   - It LAUNCHES or ATTACHES to Edge / Chrome / Chromium over the Chrome
 *     DevTools Protocol, using a **dedicated automation user-data-dir** (Chrome
 *     136+ refuses `--remote-debugging-port` against your real/default profile),
 *     forces downloads into a known directory, and blocks until a
 *     `client_secret*.json` lands — printing `[cdp] CLIENT_SECRET_CAPTURED <path>`.
 *   - It does **not** click through the Cloud Console for you. The Console DOM
 *     is fragile and changes often; the agent drives the DOM with its own
 *     browser tools attached to the SAME `--port`, while this script owns the
 *     reliable parts: launch-with-debugging, download behavior, and capture.
 *     See `references/oauth-client-automation.md` for the full playbook.
 *
 * Zero external dependencies: a minimal RFC 6455 WebSocket client is
 * implemented over `node:net` + `node:crypto` so this runs on Node >= 18
 * (the global `WebSocket` is not stable there). Cross-platform (win/mac/linux).
 *
 * Usage:
 *   cdp_oauth_client.mjs launch [flags]     # spawn a browser, then capture
 *   cdp_oauth_client.mjs attach [flags]     # use a browser already on --port
 *
 * Flags:
 *   --browser <edge|chrome|chromium|auto>  binary to launch (default: auto)
 *   --port <n>                             remote-debugging port (default: 9222)
 *   --user-data-dir <path>                 dedicated automation profile dir
 *                                          (default: <tmp>/mgws-cdp-automation)
 *   --profile-directory <name>             Chrome profile subdir (default: Default)
 *   --download-dir <path>                  where client_secret.json lands
 *                                          (default: <cwd>/mgws-oauth-download)
 *   --navigate <url>                        open this URL after connecting
 *                                          (default: the Cloud credentials page)
 *   --timeout <seconds>                     capture deadline (default: 600)
 *   --keep-open                             leave a launched browser running
 *   --json                                  machine-readable final summary
 *   --help
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { get as httpGet } from 'node:http';
import { homedir, platform, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CREDENTIALS_URL = 'https://console.cloud.google.com/apis/credentials';
const log = (msg) => process.stderr.write(`[cdp] ${msg}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  // First non-flag token is the command; everything else is a flag.
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : undefined;
  const rest = command ? argv.slice(1) : argv;
  const opts = {
    command,
    browser: 'auto',
    port: 9222,
    userDataDir: null,
    profileDirectory: 'Default',
    downloadDir: resolve(process.cwd(), 'mgws-oauth-download'),
    navigate: CREDENTIALS_URL,
    timeout: 600,
    keepOpen: false,
    copyProfile: null,
    keepProfile: false,
    forceCopy: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const next = () => rest[++i];
    switch (a) {
      case '--browser': opts.browser = next(); break;
      case '--port': opts.port = Number(next()); break;
      case '--user-data-dir': opts.userDataDir = resolve(next()); break;
      case '--profile-directory': opts.profileDirectory = next(); break;
      case '--download-dir': opts.downloadDir = resolve(next()); break;
      case '--navigate': opts.navigate = next(); break;
      case '--timeout': opts.timeout = Number(next()); break;
      case '--keep-open': opts.keepOpen = true; break;
      case '--copy-profile': opts.copyProfile = next(); break;
      case '--keep-profile': opts.keepProfile = true; break;
      case '--force-copy': opts.forceCopy = true; break;
      case '--json': opts.json = true; break;
      case '-h': case '--help': opts.help = true; break;
      default: throw new Error(`unknown flag: ${a}`);
    }
  }
  return opts;
}

const HELP = `cdp_oauth_client.mjs — CDP launcher + client_secret.json capture

  launch [flags]   spawn Edge/Chrome with remote debugging, then capture
  attach [flags]   use a browser already listening on --port

Flags:
  --browser <edge|chrome|chromium|auto>   default: auto (prefer edge, then chrome)
  --port <n>                              default: 9222
  --user-data-dir <path>                  automation profile dir (default: temp)
  --profile-directory <name>              default: Default
  --download-dir <path>                   where client_secret.json is captured
  --navigate <url>                        default: Cloud Console credentials page
  --timeout <seconds>                     default: 600
  --keep-open                             leave a launched browser running
  --copy-profile <name>                   COPY your real Edge/Chrome profile (by
                                          display name, e.g. "Adam", or dir name)
                                          into a throwaway automation dir so its
                                          authenticated Google sessions are
                                          reused (no re-login). Same machine only;
                                          the live profile itself cannot be
                                          debugged (Chrome 136+). launch only.
  --keep-profile                          keep the copied profile after exit
                                          (default: deleted — it holds live cookies)
  --force-copy                            copy even if the browser looks running
                                          (risks a locked/partial profile)
  --json                                  machine-readable final summary

On success prints: [cdp] CLIENT_SECRET_CAPTURED <absolute-path>
Hand that path to: mgws profiles add <name> --client <path> --full`;

// ---------------------------------------------------------------------------
// Browser discovery
// ---------------------------------------------------------------------------
function browserCandidates(kind) {
  const p = platform();
  const edge = {
    win32: [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ],
    darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linux: ['microsoft-edge', 'microsoft-edge-stable'],
  };
  const chrome = {
    win32: [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
  };
  const pick = (map) => map[p] || map.linux;
  if (kind === 'edge') return pick(edge);
  if (kind === 'chrome') return pick(chrome);
  if (kind === 'chromium') return platform() === 'linux' ? ['chromium', 'chromium-browser'] : pick(chrome);
  return [...pick(edge), ...pick(chrome)]; // auto: edge first
}

function resolveBrowser(kind) {
  for (const cand of browserCandidates(kind)) {
    if (cand.includes('/') || cand.includes('\\')) {
      if (existsSync(cand)) return cand;
    } else {
      return cand; // bare name — rely on PATH
    }
  }
  throw new Error(`no ${kind} browser binary found; pass an explicit --browser or install one`);
}

// ---------------------------------------------------------------------------
// Real-profile copy (Chrome 136+ blocks debugging the live default profile, so
// snapshot it into a non-default dir; the copy keeps the authenticated Google
// sessions because App-Bound Encryption binds the key to the machine+user, not
// the directory path — SAME MACHINE ONLY).
// ---------------------------------------------------------------------------
function sourceUserDataDir(kind) {
  const home = homedir();
  const la = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
  const map = {
    edge: {
      win32: join(la, 'Microsoft', 'Edge', 'User Data'),
      darwin: join(home, 'Library', 'Application Support', 'Microsoft Edge'),
      linux: join(home, '.config', 'microsoft-edge'),
    },
    chrome: {
      win32: join(la, 'Google', 'Chrome', 'User Data'),
      darwin: join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      linux: join(home, '.config', 'google-chrome'),
    },
    chromium: {
      win32: join(la, 'Chromium', 'User Data'),
      darwin: join(home, 'Library', 'Application Support', 'Chromium'),
      linux: join(home, '.config', 'chromium'),
    },
  };
  const entry = map[kind === 'auto' ? 'edge' : kind] || map.chrome;
  return entry[platform()] || entry.linux;
}

// Resolve a user-facing profile name ("Adam") to its on-disk dir ("Profile 1")
// via Local State's profile.info_cache; accept an exact dir name too.
function resolveProfileDir(srcUdd, requested) {
  try {
    const ls = JSON.parse(readFileSync(join(srcUdd, 'Local State'), 'utf8'));
    const cache = (ls.profile && ls.profile.info_cache) || {};
    if (cache[requested]) return requested;
    for (const [dir, info] of Object.entries(cache)) {
      if (((info && info.name) || '').toLowerCase() === requested.toLowerCase()) return dir;
    }
  } catch { /* fall through to on-disk check */ }
  if (existsSync(join(srcUdd, requested))) return requested;
  throw new Error(`profile "${requested}" not found in ${srcUdd} (checked display names + dir names)`);
}

function browserRunning(kind) {
  const needle = ({ edge: 'msedge', chrome: 'chrome', chromium: 'chrom', auto: 'msedge' })[kind] || 'chrome';
  try {
    if (platform() === 'win32') {
      const out = spawnSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8' });
      return (out.stdout || '').toLowerCase().includes(`${needle}.exe`);
    }
    const out = spawnSync('pgrep', ['-fil', needle], { encoding: 'utf8' });
    return Boolean((out.stdout || '').trim());
  } catch { return false; }
}

// Cache/GPU dirs are large and useless for session reuse — skip them.
const CACHE_EXCLUDE = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache', 'ShaderCache',
  'GraphiteDawnCache', 'component_crx_cache', 'optimization_guide_model_store',
]);

function copyProfileInto(srcUdd, profileDir, destUdd) {
  mkdirSync(destUdd, { recursive: true });
  const ls = join(srcUdd, 'Local State');
  // Local State holds the OS-wrapped "Chrome Safe Storage" / App-Bound key that
  // decrypts cookies — a cookies-only copy fails the login check.
  if (!existsSync(ls)) throw new Error(`no "Local State" in ${srcUdd}; cannot preserve encrypted sessions`);
  cpSync(ls, join(destUdd, 'Local State'));
  const srcProfile = join(srcUdd, profileDir);
  if (!existsSync(srcProfile)) throw new Error(`profile dir not found: ${srcProfile}`);
  cpSync(srcProfile, join(destUdd, profileDir), {
    recursive: true,
    filter: (s) => !CACHE_EXCLUDE.has(s.split(/[\\/]/).pop()),
  });
}

// ---------------------------------------------------------------------------
// Minimal RFC 6455 WebSocket client (client frames MUST be masked)
// ---------------------------------------------------------------------------
class WsClient {
  constructor(host, port, path) {
    this.host = host; this.port = port; this.path = path;
    this.sock = null; this.buf = Buffer.alloc(0);
    this.handlers = new Map(); this.nextId = 1; this.events = new Map();
  }

  connect() {
    return new Promise((resolveConn, reject) => {
      const key = randomBytes(16).toString('base64');
      const sock = netConnect(this.port, this.host, () => {
        sock.write(
          `GET ${this.path} HTTP/1.1\r\n` +
          `Host: ${this.host}:${this.port}\r\n` +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });
      this.sock = sock;
      let handshakeDone = false;
      const expect = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      sock.on('data', (chunk) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        if (!handshakeDone) {
          const sep = this.buf.indexOf('\r\n\r\n');
          if (sep === -1) return;
          const head = this.buf.slice(0, sep).toString('utf8');
          if (!/HTTP\/1\.1 101/.test(head) || !head.includes(expect)) {
            reject(new Error(`websocket handshake failed:\n${head}`));
            sock.destroy();
            return;
          }
          handshakeDone = true;
          this.buf = this.buf.slice(sep + 4);
          resolveConn();
        }
        this.drainFrames();
      });
      sock.on('error', reject);
      sock.on('close', () => {
        for (const { reject: rj } of this.handlers.values()) rj(new Error('socket closed'));
        this.handlers.clear();
      });
    });
  }

  drainFrames() {
    // Reassemble one or more complete frames from this.buf (server->client
    // frames are unmasked). Handles continuation, ping, close.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); offset = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2)); offset = 10;
      }
      if (this.buf.length < offset + len) return;
      const payload = this.buf.slice(offset, offset + len);
      this.buf = this.buf.slice(offset + len);

      if (opcode === 0x8) { this.sock.end(); return; }          // close
      if (opcode === 0x9) { this.sendFrame(0xa, payload); continue; } // ping->pong
      if (opcode === 0xa) continue;                              // pong

      this.frag = this.frag ? Buffer.concat([this.frag, payload]) : payload;
      if (!fin) continue;
      const text = this.frag.toString('utf8');
      this.frag = null;
      this.dispatch(text);
    }
  }

  sendFrame(opcode, payload) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    const len = data.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
    header[0] = 0x80 | opcode; // FIN + opcode
    const mask = randomBytes(4);
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([header, mask, masked]));
  }

  dispatch(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.id && this.handlers.has(msg.id)) {
      const { resolve: rs, reject: rj } = this.handlers.get(msg.id);
      this.handlers.delete(msg.id);
      if (msg.error) rj(new Error(msg.error.message || JSON.stringify(msg.error)));
      else rs(msg.result);
    } else if (msg.method) {
      const cbs = this.events.get(msg.method);
      if (cbs) for (const cb of cbs) cb(msg.params || {});
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((rs, rj) => {
      this.handlers.set(id, { resolve: rs, reject: rj });
      this.sendFrame(0x1, JSON.stringify({ id, method, params }));
    });
  }

  on(method, cb) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(cb);
  }

  close() { try { this.sock?.destroy(); } catch { /* noop */ } }
}

// ---------------------------------------------------------------------------
// CDP endpoint discovery
// ---------------------------------------------------------------------------
function fetchJson(port, path) {
  return new Promise((rs, rj) => {
    const req = httpGet({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { rs(JSON.parse(body)); } catch (e) { rj(e); }
      });
    });
    req.on('error', rj);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

async function waitForEndpoint(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const v = await fetchJson(port, '/json/version');
      if (v.webSocketDebuggerUrl) return v.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error(`browser did not expose CDP on port ${port} in time`);
}

// ---------------------------------------------------------------------------
// Download capture (CDP events + directory poll fallback)
// ---------------------------------------------------------------------------
function existingJson(dir) {
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')));
}

async function waitForDownload(ws, dir, deadline, preexisting) {
  let doneGuidName = null;
  ws.on('Browser.downloadWillBegin', (p) => {
    if (p.suggestedFilename) log(`download starting: ${p.suggestedFilename}`);
  });
  ws.on('Browser.downloadProgress', (p) => {
    if (p.state === 'completed') doneGuidName = true;
    if (p.state === 'canceled') log('download canceled in browser');
  });

  while (Date.now() < deadline) {
    // Prefer a stable, size-settled new .json in the download dir.
    if (existsSync(dir)) {
      const fresh = readdirSync(dir).filter(
        (f) => f.toLowerCase().endsWith('.json') && !preexisting.has(f) && !f.endsWith('.crdownload'),
      );
      for (const f of fresh) {
        const full = join(dir, f);
        const s1 = statSync(full).size;
        await sleep(400);
        if (existsSync(full) && statSync(full).size === s1 && s1 > 0) return full;
      }
    }
    if (doneGuidName) await sleep(300); // let the file flush to disk, then re-scan
    await sleep(300);
  }
  throw new Error('timed out waiting for client_secret.json download');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// Module-level cleanup state so signal handlers can reach it.
let CHILD = null;
let COPIED_DIR = null; // set only when --copy-profile made a throwaway copy to delete

function killChild() {
  if (!CHILD) return;
  const pid = CHILD.pid;
  try {
    // Windows: a detached Edge/Chrome tree needs taskkill /T; process.kill(-pid)
    // is a Unix process-group idiom that does nothing here.
    if (platform() === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
    else process.kill(-pid);
  } catch { /* already gone */ }
  CHILD = null;
}

// Blocking sleep so one synchronous cleanup() serves signals, the error path,
// and normal exit — lets the just-killed browser release file handles before we
// delete the copied profile (critical on Windows).
function sleepSyncMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* noop */ }
}

function cleanup() {
  killChild();
  if (!COPIED_DIR) return;
  for (let i = 0; i < 6; i++) {
    try { rmSync(COPIED_DIR, { recursive: true, force: true }); } catch { /* retry */ }
    if (!existsSync(COPIED_DIR)) break;
    sleepSyncMs(500);
  }
  process.stderr.write(existsSync(COPIED_DIR)
    ? `[cdp] WARN: could not delete copied profile at ${COPIED_DIR} — remove it manually (it holds live cookies)\n`
    : '[cdp] deleted copied profile\n');
  COPIED_DIR = null;
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.command) { process.stdout.write(HELP + '\n'); return; }
  if (opts.command !== 'launch' && opts.command !== 'attach') {
    throw new Error(`unknown command '${opts.command}' (expected launch|attach)`);
  }

  // Default the automation dir: a unique throwaway when copying, else a stable one.
  if (!opts.userDataDir) {
    opts.userDataDir = opts.copyProfile
      ? join(tmpdir(), `mgws-cdp-copy-${Date.now()}`)
      : join(tmpdir(), 'mgws-cdp-automation');
  }

  mkdirSync(opts.downloadDir, { recursive: true });
  const deadline = Date.now() + opts.timeout * 1000;
  let child = null;

  // --copy-profile: snapshot the real profile into the automation dir so its
  // authenticated Google sessions carry over (Chrome 136+ blocks debugging the
  // live profile directly). launch-only.
  if (opts.copyProfile) {
    if (opts.command !== 'launch') throw new Error('--copy-profile requires the "launch" command');
    const kind = opts.browser === 'auto'
      ? (existsSync(sourceUserDataDir('edge')) ? 'edge' : 'chrome')
      : opts.browser;
    const srcUdd = sourceUserDataDir(kind);
    if (!existsSync(srcUdd)) throw new Error(`source profile store not found: ${srcUdd}`);
    if (browserRunning(kind) && !opts.forceCopy) {
      throw new Error(`${kind} appears to be running — close it (a live profile copies to a locked/partial state), or pass --force-copy`);
    }
    const profileDir = resolveProfileDir(srcUdd, opts.copyProfile);
    log(`copying ${kind} profile "${opts.copyProfile}" (dir: ${profileDir}) → ${opts.userDataDir}`);
    copyProfileInto(srcUdd, profileDir, opts.userDataDir);
    opts.browser = kind;               // pin resolved kind for launch
    opts.profileDirectory = profileDir; // launch the copied profile
    if (!opts.keepProfile) COPIED_DIR = opts.userDataDir; // delete on exit — holds live cookies
    log('profile copied — authenticated sessions preserved');
  }

  if (opts.command === 'launch') {
    mkdirSync(opts.userDataDir, { recursive: true });
    const bin = resolveBrowser(opts.browser);
    const args = [
      `--remote-debugging-port=${opts.port}`,
      `--user-data-dir=${opts.userDataDir}`,
      `--profile-directory=${opts.profileDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      opts.navigate,
    ];
    log(`launching ${bin} on port ${opts.port} (profile dir: ${opts.userDataDir})`);
    child = spawn(bin, args, { detached: true, stdio: 'ignore' });
    CHILD = child;
    child.unref();
  } else {
    log(`attaching to browser on port ${opts.port}`);
  }

  const wsUrl = await waitForEndpoint(opts.port, deadline);
  const u = new URL(wsUrl);
  const ws = new WsClient(u.hostname, Number(u.port) || opts.port, u.pathname + u.search);
  await ws.connect();
  log('CDP connected');

  const preexisting = existingJson(opts.downloadDir);
  await ws.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: opts.downloadDir,
    eventsEnabled: true,
  });
  log(`downloads routed to ${opts.downloadDir}`);

  if (opts.command === 'attach' && opts.navigate) {
    try { await ws.send('Target.createTarget', { url: opts.navigate }); } catch { /* non-fatal */ }
  }

  log('waiting for you/agent to create the OAuth client and click "Download JSON"…');
  const captured = await waitForDownload(ws, opts.downloadDir, deadline, preexisting);
  process.stdout.write(`[cdp] CLIENT_SECRET_CAPTURED ${captured}\n`);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      success: true,
      clientSecretPath: captured,
      port: opts.port,
      downloadDir: opts.downloadDir,
      next: `mgws profiles add <name> --client "${captured}" --full`,
    }) + '\n');
  }

  ws.close();
  if (opts.keepOpen) {
    if (COPIED_DIR) log(`note: --keep-open leaves the copied profile at ${COPIED_DIR} (it holds live cookies)`);
    COPIED_DIR = null; CHILD = null; // intentionally keep the browser + its profile
    return;
  }
  cleanup(); // kills the browser tree + deletes the copied profile (if any)
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    process.stderr.write(`[cdp] ERROR ${e.message}\n`);
    cleanup();
    process.exit(3);
  });
}

export { sourceUserDataDir, resolveProfileDir, browserRunning, copyProfileInto };
