import { parseQuickTunnelUrl, spawnTunnelProcess, } from './tunnel-process.js';
function defaultSleep(milliseconds, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, milliseconds);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason);
        }, { once: true });
    });
}
/** Owns one Quick Tunnel process at a time and publishes immutable recovery state. */
export class TunnelManager {
    options;
    spawn;
    sleep;
    now;
    listeners = new Set();
    snapshot;
    runId = 0;
    generation = 0;
    current;
    loop;
    abortController;
    started = false;
    disposed = false;
    constructor(options) {
        this.options = options;
        this.spawn = options.spawn ?? spawnTunnelProcess;
        this.sleep = options.sleep ?? defaultSleep;
        this.now = options.now ?? Date.now;
        this.snapshot = Object.freeze({ status: 'starting', generation: 0, updatedAt: this.now() });
    }
    getSnapshot() { return this.snapshot; }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    /** Start recovery and resolve after the first ready or terminal state. */
    start() {
        if (this.started)
            throw new Error('tunnel manager already started');
        this.started = true;
        return this.beginRun();
    }
    /** Stop the current process and begin a fresh generation immediately. */
    async restart() {
        if (!this.started || this.disposed)
            throw new Error('tunnel manager is not running');
        this.runId += 1;
        this.abortController?.abort(new Error('tunnel restart'));
        await this.current?.stop();
        await this.loop;
        await this.beginRun();
    }
    beginRun() {
        const runId = ++this.runId;
        const controller = new AbortController();
        this.abortController = controller;
        let resolveInitial;
        const initial = new Promise(resolve => { resolveInitial = resolve; });
        let initialSettled = false;
        const settleInitial = () => {
            if (initialSettled)
                return;
            initialSettled = true;
            resolveInitial();
        };
        this.loop = this.runLoop(runId, controller.signal, settleInitial)
            .finally(settleInitial);
        return initial;
    }
    async runLoop(runId, signal, settleInitial) {
        let attempt = 0;
        while (!this.disposed && runId === this.runId) {
            this.publish(attempt === 0
                ? { status: 'starting', generation: this.generation, updatedAt: this.now() }
                : { status: 'reconnecting', generation: this.generation, attempt, updatedAt: this.now() });
            let process;
            try {
                process = this.spawn({ executable: this.options.executable, proxyPort: this.options.proxyPort });
            }
            catch {
                if (!await this.retry(runId, signal, ++attempt, settleInitial))
                    return;
                continue;
            }
            this.current = process;
            const outcome = await this.waitForOutcome(process);
            if (this.disposed || runId !== this.runId)
                return;
            if (outcome.kind === 'ready') {
                const readyAt = this.now();
                const retired = this.generation;
                this.generation += 1;
                if (retired > 0)
                    this.options.onGenerationRetired?.(retired);
                this.publish(Object.freeze({
                    status: 'ready', generation: this.generation, publicUrl: outcome.publicUrl, updatedAt: this.now(),
                }));
                settleInitial();
                await process.exited;
                if (this.disposed || runId !== this.runId)
                    return;
                if (this.now() - readyAt >= this.options.startupTimeoutMs)
                    attempt = 0;
            }
            else if (outcome.kind === 'timeout') {
                await process.stop();
            }
            this.current = undefined;
            if (!await this.retry(runId, signal, ++attempt, settleInitial))
                return;
        }
    }
    waitForOutcome(process) {
        return new Promise(resolve => {
            let settled = false;
            let timer;
            let offLine = () => { };
            const finish = (outcome) => {
                if (settled)
                    return;
                settled = true;
                if (timer !== undefined)
                    clearTimeout(timer);
                offLine();
                resolve(outcome);
            };
            offLine = process.onLine(line => {
                const publicUrl = parseQuickTunnelUrl(line);
                if (publicUrl !== undefined)
                    finish({ kind: 'ready', publicUrl });
            });
            timer = setTimeout(() => { finish({ kind: 'timeout' }); }, this.options.startupTimeoutMs);
            void process.exited.then(() => { finish({ kind: 'exit' }); });
        });
    }
    async retry(runId, signal, attempt, settleInitial) {
        if (attempt > this.options.restartLimit) {
            this.publish(Object.freeze({
                status: 'failed', generation: this.generation, code: 'tunnel-exited',
                message: '公网隧道启动失败', retryable: true, updatedAt: this.now(),
            }));
            settleInitial();
            return false;
        }
        this.publish(Object.freeze({
            status: 'reconnecting', generation: this.generation, attempt, updatedAt: this.now(),
        }));
        const delay = Math.min(this.options.restartBackoffMaxMs, this.options.restartBackoffMinMs * 2 ** (attempt - 1));
        try {
            await this.sleep(delay, signal);
        }
        catch {
            return false;
        }
        return !this.disposed && runId === this.runId;
    }
    publish(snapshot) {
        this.snapshot = Object.freeze(snapshot);
        for (const listener of this.listeners)
            listener();
    }
    /** Cancel recovery and terminate the exact owned process tree. */
    async dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.runId += 1;
        this.abortController?.abort(new Error('tunnel manager disposed'));
        await this.current?.stop();
        await this.loop;
        this.current = undefined;
        this.listeners.clear();
    }
}
//# sourceMappingURL=tunnel-manager.js.map