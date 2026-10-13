import { BrowserWindow } from "electron";
export function createEventPump(host) {
    let paused = false;
    let pendingText = "";
    let pendingThinking = "";
    let lastActivity;
    let snapshotDirty = false;
    let flushTimer;
    function broadcast(event) {
        for (const window of BrowserWindow.getAllWindows()) {
            if (window.isDestroyed())
                continue;
            window.webContents.send("session:event", event);
        }
    }
    function flushDeltas() {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = undefined;
        }
        if (pendingThinking) {
            const delta = pendingThinking;
            pendingThinking = "";
            broadcast({ type: "thinking_delta", delta });
        }
        if (pendingText) {
            const delta = pendingText;
            pendingText = "";
            broadcast({ type: "text_delta", delta });
        }
    }
    function scheduleFlush(delayMs) {
        if (flushTimer)
            return;
        flushTimer = setTimeout(() => {
            flushTimer = undefined;
            flushDeltas();
        }, delayMs);
    }
    function emit(event) {
        if (event.type === "text_delta") {
            pendingText += event.delta ?? "";
            scheduleFlush(paused ? 500 : 50);
            return;
        }
        if (event.type === "thinking_delta") {
            pendingThinking += event.delta ?? "";
            scheduleFlush(paused ? 500 : 50);
            return;
        }
        if (event.type === "activity") {
            lastActivity = event;
            if (!paused)
                broadcast(event);
            return;
        }
        if (event.type === "snapshot") {
            if (paused) {
                snapshotDirty = true;
                return;
            }
            flushDeltas();
            broadcast(event);
            return;
        }
        if (paused && (event.type === "bash_delta" || event.type === "tool_update")) {
            return;
        }
        if (paused) {
            snapshotDirty = true;
            if (event.type === "toast")
                broadcast(event);
            return;
        }
        flushDeltas();
        broadcast(event);
    }
    function setPaused(value) {
        if (paused === value)
            return;
        paused = value;
        if (value)
            return;
        if (snapshotDirty) {
            pendingText = "";
            pendingThinking = "";
            snapshotDirty = false;
            host.pushUiSnapshot();
        }
        else {
            flushDeltas();
        }
        if (lastActivity?.message)
            broadcast(lastActivity);
    }
    return { emit, setPaused };
}
