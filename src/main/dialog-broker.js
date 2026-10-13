import { randomUUID } from "node:crypto";
export class DialogBroker {
    pending = new Map();
    window;
    setWindow(window) {
        this.window = window;
    }
    async ask(request) {
        const window = this.window;
        if (!window || window.isDestroyed()) {
            throw new Error("桌面窗口不可用，无法显示对话框");
        }
        const id = randomUUID();
        const payload = { id, ...request };
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            window.webContents.send("dialog:request", payload);
        });
    }
    respond(response) {
        const pending = this.pending.get(response.id);
        if (!pending)
            return;
        this.pending.delete(response.id);
        if (response.cancelled) {
            pending.resolve(undefined);
            return;
        }
        pending.resolve(response.value);
    }
    async select(title, options) {
        const value = await this.ask({
            kind: "select",
            title,
            options: options.map((label) => ({ id: label, label })),
        });
        return typeof value === "string" ? value : undefined;
    }
    async confirm(title, message) {
        const value = await this.ask({ kind: "confirm", title, message });
        return value === true;
    }
    async input(title, placeholder, kind = "input") {
        const value = await this.ask({ kind, title, placeholder });
        return typeof value === "string" ? value : undefined;
    }
    hasPending() {
        return this.pending.size > 0;
    }
    rejectAll(reason) {
        for (const [id, pending] of this.pending) {
            pending.reject(new Error(reason));
            this.pending.delete(id);
        }
    }
}
