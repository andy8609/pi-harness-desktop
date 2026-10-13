import type { StreamEvent } from "@shared/types";
import type { AgentHost } from "./agent-host";
export declare function createEventPump(host: AgentHost): {
    emit: (event: StreamEvent) => void;
    setPaused: (value: boolean) => void;
};
