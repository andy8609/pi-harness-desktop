/**
 * 通过 CDP 驱动真实渲染进程做界面回归。
 * 仅使用 Node 内置 fetch 与 WebSocket（Node >= 22）。
 */
const PORT = process.env.CDP_PORT || "9222";

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

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
  let list = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      list = await targets();
      if (list.some((t) => t.type === "page")) break;
    } catch {
      /* 端口还没起来 */
    }
    await sleep(1000);
  }
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("找不到渲染进程页面目标");

  const client = await connect(page.webSocketDebuggerUrl);
  await client.send("Runtime.enable");

  const evaluate = async (expression) => {
    const result = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || "evaluate 失败");
    }
    return result.result.value;
  };

  // 在页面内注入的可重复使用的小工具：只看到真正可见的元素（hidden 视图仍在 DOM 中）
  const VIS = `const isVisible = (el) => Boolean(el) && el.getClientRects().length > 0;
    const visAll = (selector, root = document) => [...root.querySelectorAll(selector)].filter(isVisible);
    const visText = (selector) => { const el = visAll(selector)[0]; return el ? el.textContent.trim() : null; };`;

  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
  };

  // 1. 应用外壳与分组导航
  const shell = await evaluate(`(() => {
    const aside = document.querySelector('aside[aria-label="主导航"]');
    const main = document.querySelector('main[aria-label="主内容"]');
    return {
      aside: Boolean(aside),
      main: Boolean(main),
      navText: aside ? aside.innerText : "",
      view: main ? main.dataset.view : null,
      groups: aside ? [...aside.querySelectorAll('nav > div > div')].map((n) => n.textContent.trim()) : [],
      theme: document.documentElement.dataset.theme,
      status: Boolean(document.querySelector('footer[aria-label="状态栏"]')),
    };
  })()`);
  check("侧栏与主区挂载", shell.aside && shell.main, JSON.stringify({ view: shell.view }));
  check("导航分组「工作区 / 资源」", shell.groups.includes("工作区") && shell.groups.includes("资源"), shell.groups.join("/"));
  check("状态栏存在", shell.status, "");
  check("主题已写入 data-theme", shell.theme === "dark" || shell.theme === "light", shell.theme);

  // 2. 导航到设置页
  const settings = await evaluate(`(async () => {
    ${VIS}
    const find = (text) => [...document.querySelectorAll('aside button')].find((b) => b.textContent.trim() === text);
    find("设置")?.click();
    await new Promise((r) => setTimeout(r, 300));
    const main = document.querySelector('main[aria-label="主内容"]');
    const groups = [...document.querySelectorAll('nav[aria-label="设置分组"] button')].map((b) => b.textContent.trim());
    return { view: main.dataset.view, h1: visText('main h1'), groups };
  })()`);
  check("导航到设置页", settings.view === "settings" && (settings.h1 || "").startsWith("设置"), JSON.stringify({ view: settings.view, h1: settings.h1 }));
  check("设置页 4 个分组", settings.groups.length === 4, settings.groups.join("/"));

  // 3. 外观切换（即时生效）
  const themeSwitch = await evaluate(`(async () => {
    const buttons = [...document.querySelectorAll('[role="tablist"][aria-label="界面外观"] [role="tab"]')];
    const light = buttons.find((b) => b.textContent.includes("浅色"));
    light?.click();
    await new Promise((r) => setTimeout(r, 300));
    return { theme: document.documentElement.dataset.theme, count: buttons.length };
  })()`);
  check("设置页外观分段控件", themeSwitch.count === 3, String(themeSwitch.count));
  check("浅色主题即时生效", themeSwitch.theme === "light", themeSwitch.theme);

  // 4. 行为分组：保存栏与禁用态
  const behavior = await evaluate(`(async () => {
    ${VIS}
    [...document.querySelectorAll('nav[aria-label="设置分组"] button')].find((b) => b.textContent.includes("行为"))?.click();
    await new Promise((r) => setTimeout(r, 300));
    const save = visAll('main button').find((b) => b.textContent.trim() === "保存更改");
    const switches = visAll('main [role="switch"]').length;
    const text = visAll('main').map((el) => el.innerText).join(" ");
    return { save: Boolean(save), disabled: save ? save.disabled : null, switches, dirtyHint: text.includes("已与") };
  })()`);
  check("行为分组 3 个开关", behavior.switches === 3, String(behavior.switches));
  check("未修改时保存按钮禁用", behavior.save && behavior.disabled === true, String(behavior.disabled));
  check("保存区显示同步状态", behavior.dirtyHint, String(behavior.dirtyHint));

  // 5. 其余页面可导航且渲染页头
  const pages = await evaluate(`(async () => {
    ${VIS}
    const out = {};
    const find = (text) => [...document.querySelectorAll('aside button')].find((b) => b.textContent.trim() === text);
    for (const [key, label] of [["sessions","会话"],["extensions","扩展"],["skills","Skills"],["models","模型"],["chat","对话"]]) {
      find(label)?.click();
      await new Promise((r) => setTimeout(r, 500));
      const main = document.querySelector('main[aria-label="主内容"]');
      out[key] = {
        view: main.dataset.view,
        h1: visText('main h1'),
        dangerText: visAll('main .text-danger').map((el) => el.textContent.trim()).slice(0, 3),
        overflowX: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1,
      };
    }
    return out;
  })()`);
  check("会话页", pages.sessions.view === "sessions" && pages.sessions.h1 === "会话", JSON.stringify(pages.sessions));
  check("扩展页", pages.extensions.view === "extensions" && pages.extensions.h1 === "扩展", JSON.stringify(pages.extensions));
  check("Skills 页", pages.skills.view === "skills" && pages.skills.h1 === "Skills", JSON.stringify(pages.skills));
  check("模型页", pages.models.view === "models" && pages.models.h1 === "模型配置", JSON.stringify(pages.models));
  check("回到对话页", pages.chat.view === "chat", JSON.stringify(pages.chat));

  // 6. 工作区面板
  const work = await evaluate(`(async () => {
    // 工作区开关已从侧栏移到对话页头（纯图标按钮，用 aria-label 识别）
    const toggle = () => [...document.querySelectorAll('button')]
      .find((b) => /打开工作区|收起工作区/.test(b.getAttribute('aria-label') || ""));
    const inHeader = Boolean(toggle() && toggle().closest('header'));
    const read = () => {
      const aside = document.querySelector('aside[aria-label="工作区"]');
      return { open: Boolean(aside), tabs: aside ? [...aside.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()) : [] };
    };
    let state = read();
    if (!state.open) {
      toggle()?.click();
      await new Promise((r) => setTimeout(r, 400));
      state = read();
    }
    return { ...state, inHeader };
  })()`);
  check("工作区面板可打开", work.open, JSON.stringify(work.tabs));
  check("工作区开关位于对话页头", work.inHeader, String(work.inHeader));

  // 7. 横向溢出检测：默认视口 + 两档窄窗口
  const overflowAt = async (width, height) => {
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);
    return evaluate(`(() => {
      const el = document.scrollingElement;
      const sidebar = document.querySelector('aside[aria-label="主导航"]');
      return {
        width: window.innerWidth,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflow: el.scrollWidth > el.clientWidth + 1,
        sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
      };
    })()`);
  };

  const wide = await overflowAt(1440, 900);
  check("1440px 无横向溢出", !wide.overflow, JSON.stringify(wide));
  check("1440px 侧栏展开 236px", wide.sidebarWidth === 236, String(wide.sidebarWidth));

  const narrow = await overflowAt(1000, 800);
  check("1000px 无横向溢出", !narrow.overflow, JSON.stringify(narrow));
  check("1000px 侧栏折叠为 60px", narrow.sidebarWidth === 60, String(narrow.sidebarWidth));

  const tiny = await overflowAt(820, 700);
  check("820px 无横向溢出", !tiny.overflow, JSON.stringify(tiny));

  await client.send("Emulation.clearDeviceMetricsOverride");
  await sleep(300);

  // 7.5 输入区与主操作可用性（不触发真实模型调用）
  const composer = await evaluate(`(() => {
    ${VIS}
    const textarea = visAll('textarea')[0];
    const send = visAll('button').find((b) => b.textContent.trim() === "发送");
    const newSession = visAll('button').find((b) => b.textContent.trim() === "新会话");
    const reload = visAll('button').find((b) => b.textContent.trim() === "重载");
    return {
      textarea: Boolean(textarea),
      placeholder: textarea ? textarea.placeholder.slice(0, 12) : null,
      send: Boolean(send),
      newSession: Boolean(newSession),
      reload: Boolean(reload),
      composerZone: Boolean(document.querySelector('textarea')?.closest('.rounded-panel')),
    };
  })()`);
  check("输入区存在且可聚焦", composer.textarea, composer.placeholder);
  check("发送按钮存在（未触发调用）", composer.send, String(composer.send));
  check("页头「新会话 / 重载」按钮存在", composer.newSession && composer.reload, JSON.stringify({ newSession: composer.newSession, reload: composer.reload }));
  check("输入框采用容器化焦点样式", composer.composerZone, String(composer.composerZone));

  // 8. 焦点环样式存在
  const focus = await evaluate(`(() => {
    const btn = document.querySelector('aside button');
    btn?.focus();
    const style = btn ? getComputedStyle(btn) : null;
    return { outlineWidth: style ? style.outlineWidth : null, focused: document.activeElement === btn };
  })()`);
  check("键盘焦点可见", focus.focused && focus.outlineWidth && focus.outlineWidth !== "0px", JSON.stringify(focus));

  // 还原为深色并回到对话页，避免影响用户
  const restored = await evaluate(`(async () => {
    const find = (t) => [...document.querySelectorAll('aside button')].find((b) => b.textContent.trim() === t);
    find("设置")?.click();
    await new Promise((r) => setTimeout(r, 300));
    [...document.querySelectorAll('[role="tablist"][aria-label="界面外观"] [role="tab"]')]
      .find((b) => b.textContent.includes("深色"))?.click();
    await new Promise((r) => setTimeout(r, 200));
    find("对话")?.click();
    await new Promise((r) => setTimeout(r, 200));
    return document.documentElement.dataset.theme;
  })()`);
  check("可还原为深色并回到对话页", restored === "dark", String(restored));

  client.close();

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  → ${c.detail}` : ""}`);
  }
  console.log(`\n合计 ${checks.length} 项，通过 ${checks.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("探针失败:", error.message);
  process.exit(2);
});
