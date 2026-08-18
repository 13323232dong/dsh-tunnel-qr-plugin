import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?![a-z0-9.-])(?:[/?#][^\s]*)?/i;
/** Extract the canonical origin from a Cloudflare Quick Tunnel log line. */
export function parseQuickTunnelUrl(line) {
    const match = line.match(QUICK_TUNNEL_URL)?.[0];
    if (match === undefined)
        return undefined;
    const url = new URL(match);
    return url.protocol === 'https:' && /^[a-z0-9-]+\.trycloudflare\.com$/i.test(url.hostname)
        ? url.origin
        : undefined;
}
class NodeTunnelProcess {
    child;
    exited;
    listeners = new Set();
    diagnosticLines = [];
    stopped = false;
    settled = false;
    constructor(child) {
        this.child = child;
        this.exited = new Promise(resolve => {
            const settle = (value) => {
                if (this.settled)
                    return;
                this.settled = true;
                resolve(value);
            };
            child.once('exit', (code, signal) => { settle({ code, signal }); });
            child.once('error', () => { settle({ code: null, signal: null }); });
        });
        this.consume(child.stdout);
        this.consume(child.stderr);
    }
    onLine(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    consume(stream) {
        let pending = '';
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
            pending += chunk;
            const lines = pending.split(/\r?\n/);
            pending = lines.pop() ?? '';
            for (const line of lines) {
                this.recordDiagnostic(line);
                for (const listener of this.listeners)
                    listener(line);
            }
        });
        stream.once('end', () => {
            if (pending.length === 0)
                return;
            this.recordDiagnostic(pending);
            for (const listener of this.listeners)
                listener(pending);
        });
    }
    diagnostics() { return [...this.diagnosticLines]; }
    recordDiagnostic(line) {
        this.diagnosticLines.push(line);
        if (this.diagnosticLines.length > 100)
            this.diagnosticLines.shift();
    }
    async stop() {
        if (this.stopped || this.settled)
            return;
        this.stopped = true;
        const pid = this.child.pid;
        if (pid === undefined) {
            this.child.kill('SIGTERM');
            await this.exited;
            return;
        }
        if (process.platform === 'win32') {
            try {
                await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F']);
            }
            catch {
                // taskkill reports failure when the process exited between the state check and invocation.
            }
        }
        else {
            try {
                process.kill(-pid, 'SIGTERM');
            }
            catch {
                // A child without a surviving process group still accepts direct termination.
                this.child.kill('SIGTERM');
            }
            const exited = await Promise.race([
                this.exited.then(() => true),
                new Promise(resolve => { setTimeout(() => { resolve(false); }, 2_000); }),
            ]);
            if (!exited) {
                try {
                    process.kill(-pid, 'SIGKILL');
                }
                catch {
                    // The process group may exit during the grace-period check.
                    this.child.kill('SIGKILL');
                }
            }
        }
        await this.exited;
    }
}
/** Spawn the official cloudflared process with updates disabled and a loopback proxy target. */
export function spawnTunnelProcess(options) {
    const child = spawn(options.executable, [
        'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${options.proxyPort}`,
    ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
    });
    return new NodeTunnelProcess(child);
}
//# sourceMappingURL=tunnel-process.js.map