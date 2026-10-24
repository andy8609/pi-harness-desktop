/**
 * 通过 CDP 为各界面截图（Motion Off，对应规范 ArcMotionLevel.Off）。
 * 输出目录：docs/ui/shots/
 */
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT || "9222";
const OUT_DIR = "docs/ui/shots";

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          const messageId = ++id;
          ws.send(JSON.stringify({ id: messageId, method, params }));
          return new Promise((res, rej) => pending.set(messageId, { res, rej }));
        },
        close: () => ws.close(),
      }),
    );
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (!data.id || !pending.has(data.id)) return;
      const { res, rej } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) rej(new Error(JSON.stringify(data.error)));
      else res(data.result);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("找不到渲染进程页面目标");

  const client = await connect(page.webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(400);

  const evaluate = async (expression) => {
    const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate 失败");
    return result.result.value;
  };

  // Motion Off：所有变化立即落终态
  await evaluate(`document.documentElement.dataset.motion = "off"; true`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const shot = async (name) => {
    await sleep(350);
    const { data } = await client.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, "base64"));
    console.log(`saved ${name}.png`);
  };

  const go = async (label) => {
    await evaluate(`(async () => {
      const find = (t) => [...document.querySelectorAll('aside[aria-label="主导航"] button')].find((b) => b.textContent.trim() === t);
      find(${JSON.stringify(label)})?.click();
      await new Promise((r) => setTimeout(r, 450));
      window.scrollTo(0, 0);
      return true;
    })()`);
  };

  const setTheme = async (label) => {
    await evaluate(`(async () => {
      const find = (t) => [...document.querySelectorAll('aside[aria-label="主导航"] button')].find((b) => b.textContent.trim() === t);
      find("设置")?.click();
      await new Promise((r) => setTimeout(r, 350));
      [...document.querySelectorAll('[role="tablist"][aria-label="界面外观"] [role="tab"]')]
        .find((b) => b.textContent.includes(${JSON.stringify(label)}))?.click();
      await new Promise((r) => setTimeout(r, 350));
      return document.documentElement.dataset.theme;
    })()`);
  };

  const openSettingsGroup = async (label) => {
    await evaluate(`(async () => {
      [...document.querySelectorAll('nav[aria-label="设置分组"] button')]
        .find((b) => b.textContent.includes(${JSON.stringify(label)}))?.click();
      await new Promise((r) => setTimeout(r, 350));
      return true;
    })()`);
  };

  // 深色主题下的各界面
  await setTheme("深色");
  await go("对话");
  await shot("01-chat-dark");

  await go("会话");
  await shot("02-sessions-dark");

  await go("扩展");
  await shot("03-extensions-dark");

  await go("Skills");
  await shot("04-skills-dark");

  await go("模型");
  await shot("05-models-dark");

  await go("设置");
  await openSettingsGroup("外观");
  await shot("06-settings-appearance-dark");

  await openSettingsGroup("行为");
  await shot("07-settings-behavior-dark");

  await openSettingsGroup("项目与权限");
  await shot("08-settings-project-dark");

  await openSettingsGroup("资源文件");
  await shot("09-settings-resources-dark");

  // 工作区面板
  await evaluate(`(async () => {
    const toggle = () => [...document.querySelectorAll('aside[aria-label="主导航"] button')]
      .find((b) => /打开工作区|收起工作区/.test(b.textContent.trim()));
    if (!document.querySelector('aside[aria-label="工作区"]')) {
      toggle()?.click();
      await new Promise((r) => setTimeout(r, 400));
    }
    return true;
  })()`);
  await go("对话");
  await shot("10-chat-workpanel-dark");

  // 浅色主题抽查：对话 + 设置外观
  await setTheme("浅色");
  await go("对话");
  await shot("11-chat-light");

  await setTheme("浅色");
  await openSettingsGroup("外观");
  await shot("12-settings-appearance-light");

  // 窄窗口：1000px（侧栏折叠）
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
  await go("会话");
  await shot("13-sessions-1000px-light");

  // 还原
  await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await setTheme("深色");
  await go("对话");
  await evaluate(`delete document.documentElement.dataset.motion; true`);

  client.close();
  console.log("done");
}

main().catch((error) => {
  console.error("截图失败:", error.message);
  process.exit(1);
});
