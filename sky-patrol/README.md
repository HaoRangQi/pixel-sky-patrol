# 天际巡航 / SKY PATROL

本目录是当前推荐的新版入口：秋日湖谷中的中文像素飞行与空战游戏，包含湖岸巡航、秋林低飞和波次截击，以及追尾、座舱、近距俯瞰三种视角。

[项目介绍、快速开始与完整操作表](../README.md) · [新版游戏](index.html) · [验收记录](VERIFICATION.md)

## 运行与构建

使用支持 WebGL2 的现代浏览器打开本目录的 `index.html`。也可按根 README 启动静态服务，再访问 <http://127.0.0.1:8765/sky-patrol/>。

以下命令均在仓库根目录运行，推荐使用 Node.js 24，无需安装 npm 依赖：

```bash
node sky-patrol/build.mjs
```

构建复用 `src/` 中的世界、飞行、渲染和战斗模块，加入本目录的外壳、湖谷场景、机体、仪表和适配层，生成自包含的 `sky-patrol/index.html`。脚本、样式和 SVG 均已内联；开发时修改源文件后重新构建。

根目录的 [index.html](../index.html) 保留旧美术入口，也接收共享引擎修正。未改动的旧 UI 归档位于分支 `feature/sky-patrol-ui` 的提交 `37167ae`。

## 当前玩法

- **选择航程**：自由巡航从南岸湖区出发，秋林低飞从同一张地图的东侧草谷出发；两者没有敌军或战斗伤害，仍需避开地形。截击任务通过击落目标推进波次。默认正后追尾，空格或视角按钮循环切换座舱、俯瞰；巡航另有斜后追踪按钮。
- **暂停调参**：Esc 打开暂停菜单。巡航可设为 100–500 节，默认精确值为 112 m/s（约 218 节）；加力默认及最高均为 500 节，在上限允许时至少高于巡航 50 节。继续后速度平滑变化，按住 Shift 或触屏加速按钮使用加力。巡航设为 500 节时显示「已达上限」，Shift 不额外耗油。敌机速度默认 65%，可调 30–120%；这些设置在重开、切换航程时保留，刷新恢复默认。
- **飞行与倒飞**：WASD／方向键或触屏摇杆控制飞行。鼠标控制方向默认关闭，瞄准、左键开炮仍可用；可在暂停菜单开启鼠标驾驶。按住 A 或 D 至少 2 秒后松开，在 1.2 秒内双击同一个键，两次点击间隔不超过 0.35 秒，飞机将在 1.6 秒内翻转 180°并保持倒飞；重复操作可翻回。Q 仍执行完整桶滚，回到当前正飞或倒飞姿态。
- **使用武器**：机炮与导弹操作见根 README 和底栏提示。C／X 或底栏「C 干扰弹」按钮投放干扰弹，按钮显示真实余量及 7 秒冷却；触屏也可直接操作底栏按钮。

## 开发与验收

基础检查同时构建新旧入口，执行 Node 回归并检查补丁格式。完整回归也包含 Chrome／WebGL2 探针，需要下述浏览器环境：

```bash
node build.mjs && node sky-patrol/build.mjs && node --test tools/test_*.mjs && git diff --check
```

最新浏览器验收入口：

```bash
node tools/verify_sky_comfort.mjs
node tools/verify_sky_speed.mjs --prefix=sky_comfort_speed
node tools/verify_sky_flare.mjs
```

运行浏览器验收前，需要已有静态服务在 `127.0.0.1:8765` 提供仓库根目录。脚本使用独立无头 Chrome 配置；当前工具将浏览器路径固定为 macOS 默认的 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，使用 Node.js 24 运行。游戏本身不依赖 macOS；其他系统运行这些浏览器工具需要调整 Chrome 路径。

湖谷由 Blob Worker 生成，脚本会等待真实的 `window.__PI.ready()`，不能以固定延时替代就绪判断。新增浏览器用例也应检查就绪、页面异常与实际断言结果。

2026-11-21 的最新验收记录为全量 Node 回归 **182 项通过**，飞行舒适度 Chrome 汇总 **9 项通过**，并包含暂停菜单和干扰弹的 1440×900、390×844、844×390 检查。手机证据来自 Chrome 设备模拟；真机手机、Safari 和长期性能尚未验证。完整数据、复验边界与历次媒体见 [VERIFICATION.md](VERIFICATION.md)。

当前截图：[暂停设置](../shots/sky_comfort_pause_desktop.png) · [倒飞座舱](../shots/sky_comfort_crossview_a4s_chase_to_cockpit_1500.png) · [竖屏干扰弹](../shots/sky_flare_portrait.png)。

设计与实现选择见 [飞行舒适度说明](../.agents/notes/implemented/feature/2026-11-21-flight-comfort.md) 和 [干扰弹按钮说明](../.agents/notes/implemented/bug-fix/2026-11-21-flare-action.md)。
