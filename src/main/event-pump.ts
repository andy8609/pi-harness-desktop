import { BrowserWindow } from "electron";
import type { StreamEvent } from "@shared/types";
import type { AgentHost } from "./agent-host";

const HIGH_FREQ = new Set(["text_delta", "thinking_delta", "bash_delta", "tool_update", "activity"]);

export function createEventPump(host: AgentHost) {
  let paused = false;
  let pendingText = "";
  let pendingThinking = "";
  let lastActivity: StreamEvent | undefined;
  let snapshotDirty = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  function broadcast(event: StreamEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send("session:event", event);
    }
  }

  function flushDeltas(): void {
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

  function scheduleFlush(delayMs: number): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      flushDeltas();
    }, delayMs);
  }

  function emit(event: StreamEvent): void {
    if (event.type === "text_delta") {
      pendingText += event.delta ?? "";
      if (!paused) scheduleFlush(50);
      return;
    }
    if (event.type === "thinking_delta") {
      pendingThinking += event.delta ?? "";
      if (!paused) scheduleFlush(50);
      return;
    }
    if (event.type === "activity") {
      lastActivity = event;
      if (!paused) broadcast(event);
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
    if (paused && HIGH_FREQ.has(event.type)) {
      return;
    }
    if (paused) {
      snapshotDirty = true;
      if (event.type === "toast") broadcast(event);
      return;
    }
    flushDeltas();
    broadcast(event);
  }

  function setPaused(value: boolean): void {
    if (paused === value) return;
    paused = value;
    if (value) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      return;
    }
    if (snapshotDirty || host.isBusy()) {
      pendingText = "";
      pendingThinking = "";
      snapshotDirty = false;
      host.pushUiSnapshot();
    } else {
      flushDeltas();
    }
    if (lastActivity?.message) broadcast(lastActivity);
  }

  return { emit, setPaused };
}
