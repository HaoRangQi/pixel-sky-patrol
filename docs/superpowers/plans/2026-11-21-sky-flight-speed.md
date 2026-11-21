# 暂停调速续作计划

- Goal：完成用户已确认的新版暂停调速，可用键盘和触屏调整，恢复后平滑生效。
- Architecture：`65_app.js` 持有页面参数，正式玩家携带 `cruiseSpeed`／`burnSpeed`；共享飞行模型读取参数，原入口继续使用原常量。
- Tech Stack：原生 HTML range、现有 JavaScript 适配层、Node VM、独立 Chrome CDP。
- Baseline/Authority Refs：[已确认设计](../specs/2026-11-21-sky-flight-speed-design.md)、现有新版 README、`src/10_core.js`／`40_game.js`／`52_ui_screens.js`。
- Compatibility Boundary：只在新版增加设置；默认精确 112／204 m/s；待命演示、相机、敌机、耗油率和操纵键保持现有合同。已有未提交工作保留。
- Verification：双入口构建、`node --test tools/test_*.mjs`、原入口飞行回归、三尺寸 Chrome 原生键触与截图、`git diff --check`。

## 实施顺序

1. 新建 `tools/test_sky_speed.mjs`，通过真实暂停与 range 事件覆盖参数、精确默认、逐帧飞行、重开与待命。先确认缺少调速功能导致预期失败。
2. 在 `sky-patrol/65_app.js` 添加页面参数与暂停更新，正式玩家创建时使用所选巡航。沿用 `src/40_game.js` 已有速度块，检验降低上限平滑减速和无参数默认兼容。
3. 在 `sky-patrol/00_shell.html` 的暂停操作中增加两项滑块、节数和恢复默认。保留继续按钮为首个焦点；Tab 圈含输入；捕获暂停按键而保留原生方向键，Esc 恢复并清除隐藏焦点。短横屏允许原生滚动。
4. 新建 `tools/verify_sky_speed.mjs`；用独立 Chrome 测试 1440×900、390×844、844×390，检查真实滑块键触、暂停不推进、恢复连续、触屏加力、滚动命中与页面错误，保存三尺寸暂停图。
5. 两入口重建并运行全部 Node 测试和相关浏览器回归，目视暂停图。更新 README／VERIFICATION，记录实际结果和未覆盖设备。

## 所有权、风险与收尾

root 持有生产状态机、现有测试夹具及文档；`speed_regression` 仅写新增 Node 测试；`speed_browser` 仅写新增 Chrome 验收与截图。共享引擎文件已超过 800 行，本次只替换已有速度计算块，不增加新职责；页面参数留在现有 375 行适配层。

重点风险是范围控件方向键被旧全局输入拦截，以及短横屏顶端因居中溢出而无法触达。以浏览器原生键盘、触摸与滚动命中验证。原速度常量作为旧入口和待命的有效默认继续保留；新版不再有独立固定巡航目标。不添加存储、实时调速键或俯瞰拉宽，不提交、推送或发布。
