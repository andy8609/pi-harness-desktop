import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DialogBroker } from "../dialog-broker";
import type { PermissionStore } from "../permission-store";
/**
 * Built-in pi extension providing a permission gate with remembered decisions.
 *
 * pi does not ship permission popups, but an extension can intercept
 * `tool_call` and return `{ block, reason }`, while `ctx.ui`/the dialog broker
 * provides the approval surface.
 *
 * - Secret/credential paths are hard-blocked for read/write/edit.
 * - High-risk shell commands ask once, and can be remembered per session or
 *   persisted to disk.
 */
export declare function createPermissionExtension(dialogs: DialogBroker, store: PermissionStore): (pi: ExtensionAPI) => void;
