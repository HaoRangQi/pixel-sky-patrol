# 玩家机炮与敌机血条实施计划

**目标：** 左键或 F 点按单发、按住扫射，右键或 E 发射导弹，Q 桶滚；为可见敌机显示实时血条。

**架构：** 在现有输入层分发机炮和导弹动作；复用世界坐标曳光、机炮音效和伤害函数。血条随已有目标框投影并保留锁定环。

**技术栈：** JavaScript、WebGL2、Canvas2D、Chrome DevTools Protocol。

- [x] 先写 `tools/test_player_guns.js`，用实际输入事件与 `__PI` 断言单发、扫射、松键停火、右键不被左键拦截、Shift 加力、走偏不命中及血条变短。更新 `tools/test_cockpit_controls.js`，用 Q 单独测试桶滚。
- [x] 旧版运行 `node tools/cdp.mjs run 'file:///Users/macos/Downloads/Projects/Games/KongZhan/index.html?adapt=0' tools/test_player_guns.js --width=960 --height=560 --wait=5000` 应报告欠缺的机炮、加力及血条行为。
- [x] `src/10_core.js` 让鼠标独立发出 `mousedown`/`mouseup`，触屏继续走指针事件；拆掉已与独立武器操作冲突的双键组合。`src/52_ui_screens.js` 接入 F 和左键的开火动作、更新中文说明；右键、E、Q、X、WASD 保留各自用途，Shift 接回加力。
- [x] `src/40_game.js` 每帧推进机炮冷却和持续输入；`src/42_combat.js` 的 `firePlayerGuns()` 以机头方向选最近且没有地形阻挡的目标，每 0.1 游戏秒发射一发，复用 `hitDrone()` / `hitGround()`、曳光和现有音效。
- [x] `src/50_ui_hud.js` 在敌机目标框附近以 `clamp01(t.hp / DRONE_MAX_HP)` 绘制血条。重新构建并运行机炮测试、驾驶位测试、WASD 和短时战斗回归。
