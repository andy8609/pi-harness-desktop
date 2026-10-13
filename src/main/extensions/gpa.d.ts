import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type GpaState } from "@shared/gpa";
import type { DialogBroker } from "../dialog-broker";
export declare function createGpaExtension(getState: () => GpaState, dialogs: DialogBroker): (pi: ExtensionAPI) => void;
