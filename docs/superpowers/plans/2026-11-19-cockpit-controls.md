# 驾驶位快捷键与桶滚镜头实施计划

**目标：** Q 桶滚、E 发射导弹；驾驶位的地平线随桶滚翻转一圈，座舱面板保持固定。

**做法：** 在现有按键分发中接入桶滚和发射动作，并在驾驶位使用已有的机体渲染姿态。保留 F、鼠标、触屏、WASD 以及原有躲弹、冷却判定。

**技术栈：** JavaScript、WebGL2、Canvas2D、Chrome DevTools Protocol。

- [x] 在 `tools/test_cockpit_controls.js` 使用 `__PI.start('cockpit')` 启动真实场景。发送 Q/E 键盘事件，检查 Q 启动桶滚、桶滚中点 `camera.up.y < -0.8`、结束时 `camera.up.y > 0.8`，以及 E 每次按下发射一枚且忽略系统重复事件。用原鼠标桶滚独立复现镜头问题。
- [x] 运行 `node tools/cdp.mjs run 'file:///Users/macos/Downloads/Projects/Games/KongZhan/index.html?adapt=0' tools/test_cockpit_controls.js --width=960 --height=560 --wait=5000`。预期旧版报告 Q、E 和镜头三处失败。
- [x] 在 `src/52_ui_screens.js` 的 `onKeyDown` 加入 `if (code === 'KeyQ') { triggerBarrelRoll(); return; }`，将原 `KeyF` 分支条件扩为 `code === 'KeyE' || code === 'KeyF'`，标题操作条显示 `Q / 短按左键 桶滚`、`E / 右键 发射`。
- [x] 在 `src/40_game.js` 的 `computePose` 中只让驾驶位的 `pos`、`target` 和 `up` 引用 `p.renderBasis`；其余视角及座舱面板不变。
- [x] 执行 `node build.mjs` 生成 `index.html`，重跑驾驶位用例与现有 `tools/test_wasd.js`、`tools/smoke_sim.js`，预期无页面错误且飞行、武器功能正常。
