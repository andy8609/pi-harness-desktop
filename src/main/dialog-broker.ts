import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import type { DialogKind, DialogRequest, DialogResponse } from "@shared/types";

interface Pending {
  resolve: (value: string | boolean | undefined) => void;
  reject: (error: Error) => void;
  kind: DialogKind;
}

export class DialogBroker {
  private readonly pending = new Map<string, Pending>();
  private window: BrowserWindow | undefined;

  setWindow(window: BrowserWindow | undefined): void {
    this.window = window;
  }

  async ask(request: Omit<DialogRequest, "id">): Promise<string | boolean | undefined> {
    const window = this.window;
    if (!window || window.isDestroyed()) {
      throw new Error("桌面窗口不可用，无法显示对话框");
    }
    const id = randomUUID();
    const payload: DialogRequest = { id, ...request };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, kind: request.kind });
      window.webContents.send("dialog:request", payload);
    });
  }

  respond(response: DialogResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.cancelled) {
      pending.resolve(undefined);
      return;
    }
    pending.resolve(response.value);
  }

  async select(title: string, options: string[]): Promise<string | undefined> {
    const value = await this.ask({
      kind: "select",
      title,
      options: options.map((label) => ({ id: label, label })),
    });
    return typeof value === "string" ? value : undefined;
  }

  async confirm(title: string, message: string): Promise<boolean> {
    const value = await this.ask({ kind: "confirm", title, message });
    return value === true;
  }

  async input(title: string, placeholder?: string, kind: DialogKind = "input"): Promise<string | undefined> {
    const value = await this.ask({ kind, title, placeholder });
    return typeof value === "string" ? value : undefined;
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** Auto-approve in-flight risk prompts when the user turns on full trust. */
  approvePendingPermissions(): void {
    for (const [id, pending] of [...this.pending]) {
      if (pending.kind !== "permission") continue;
      this.pending.delete(id);
      pending.resolve("本会话允许");
    }
  }

  rejectAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      pending.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
