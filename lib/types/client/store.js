const DEFAULT_POLL_MS = 15_000;
export class TunnelQrController {
    api;
    snapshot = {
        open: false,
        busy: 'idle',
        status: null,
        qr: null,
        error: null,
        copyState: 'idle',
    };
    listeners = new Set();
    pollMs;
    pollHandle = null;
    inFlight = null;
    activeAbort = null;
    disposed = false;
    restoreFocus = null;
    constructor(api, options = {}) {
        this.api = api;
        this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    }
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    getSnapshot = () => this.snapshot;
    async open(target) {
        if (target !== undefined)
            this.restoreFocus = target;
        if (!this.snapshot.open)
            this.publish({ ...this.snapshot, open: true, copyState: 'idle' });
        await this.refresh();
    }
    close() {
        if (!this.snapshot.open)
            return;
        this.clearPoll();
        this.publish({ ...this.snapshot, open: false, busy: 'idle', copyState: 'idle' });
        this.restoreFocus?.focus();
    }
    handleBackdrop = () => {
        this.close();
    };
    handleKeyDown = (event) => {
        if (event.key === 'Escape')
            this.close();
    };
    async refresh() {
        await this.runExclusive('refreshing', async (signal) => {
            const nextStatus = await this.api.readStatus(signal);
            const nextQr = nextStatus.snapshot.status === 'ready'
                ? await this.api.readFreshQr(signal)
                : null;
            if (signal.aborted || this.disposed)
                return;
            this.publish({
                ...this.snapshot,
                busy: 'idle',
                error: null,
                open: true,
                status: nextStatus.snapshot,
                qr: nextQr,
            });
            this.schedulePoll();
        });
    }
    async restart() {
        await this.runExclusive('restarting', async (signal) => {
            await this.api.restart(signal);
            if (signal.aborted || this.disposed)
                return;
            this.publish({
                ...this.snapshot,
                busy: 'restarting',
                copyState: 'idle',
                qr: null,
                error: null,
            });
            const nextStatus = await this.api.readStatus(signal);
            if (signal.aborted || this.disposed)
                return;
            this.publish({
                ...this.snapshot,
                busy: 'idle',
                status: nextStatus.snapshot,
                error: null,
            });
            this.schedulePoll();
        });
    }
    async copyUrl() {
        const url = this.snapshot.qr?.publicUrl
            ?? (this.snapshot.status?.status === 'ready' ? this.snapshot.status.publicUrl : null);
        if (typeof url !== 'string')
            return;
        try {
            await globalThis.navigator?.clipboard?.writeText(url);
            this.publish({ ...this.snapshot, copyState: 'copied' });
        }
        catch {
            this.publish({ ...this.snapshot, copyState: 'failed' });
        }
    }
    dispose() {
        this.disposed = true;
        this.clearPoll();
        this.activeAbort?.abort();
        this.listeners.clear();
    }
    async runExclusive(busy, work) {
        if (this.inFlight !== null)
            return this.inFlight;
        const controller = new AbortController();
        this.activeAbort = controller;
        this.publish({ ...this.snapshot, busy, error: null });
        const task = work(controller.signal).catch((error) => {
            if (controller.signal.aborted || this.disposed)
                return;
            const message = error instanceof Error ? error.message : 'Tunnel request failed';
            this.publish({ ...this.snapshot, busy: 'idle', error: message });
        }).finally(() => {
            if (this.inFlight === task)
                this.inFlight = null;
            if (this.activeAbort === controller)
                this.activeAbort = null;
            if (!this.disposed) {
                this.publish({ ...this.snapshot, busy: 'idle' });
                this.schedulePoll();
            }
        });
        this.inFlight = task;
        return task;
    }
    schedulePoll() {
        this.clearPoll();
        if (!this.snapshot.open || this.disposed)
            return;
        this.pollHandle = setTimeout(() => {
            this.pollHandle = null;
            if (this.inFlight === null)
                void this.refresh();
        }, this.pollMs);
    }
    clearPoll() {
        if (this.pollHandle !== null)
            clearTimeout(this.pollHandle);
        this.pollHandle = null;
    }
    publish(next) {
        this.snapshot = next;
        for (const listener of [...this.listeners])
            listener();
    }
}
//# sourceMappingURL=store.js.map