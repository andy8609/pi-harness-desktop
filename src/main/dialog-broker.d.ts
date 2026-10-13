import type { BrowserWindow } from "electron";
import type { DialogKind, DialogRequest, DialogResponse } from "@shared/types";
export declare class DialogBroker {
    private readonly pending;
    private window;
    setWindow(window: BrowserWindow | undefined): void;
    ask(request: Omit<DialogRequest, "id">): Promise<string | boolean | undefined>;
    respond(response: DialogResponse): void;
    select(title: string, options: string[]): Promise<string | undefined>;
    confirm(title: string, message: string): Promise<boolean>;
    input(title: string, placeholder?: string, kind?: DialogKind): Promise<string | undefined>;
    hasPending(): boolean;
    rejectAll(reason: string): void;
}
