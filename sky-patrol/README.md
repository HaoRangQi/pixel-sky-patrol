# 天际巡航 / SKY PATROL

参考 Dusk Patrol 公开页面的界面结构，独立实现的中文像素空战游戏。采用深色外框、大像素字标、简洁飞行仪表、镜头按钮和底部操作栏；不复用参考站品牌、源码或素材。

## 打开与构建

新版入口为本目录 `index.html`，可直接用现代浏览器打开，需要 WebGL2。原版仍是根目录 `../index.html`。

```bash
node sky-patrol/build.mjs
```

构建从原 `src/` 复用世界、飞行、渲染和武器模块，插入本目录的独立外壳与适配层，只写 `sky-patrol/index.html`，不会覆盖原入口或共享源码。产物包含内联脚本、样式及原创SVG，无需安装包。

## 玩法

- **自由巡航**：不生成敌机、地面威胁或后续波次，可练习飞行和武器；战斗伤害关闭，地形碰撞仍有危险。
- **截击任务**：锁定敌机、发射导弹、机炮扫射，击落目标推进波次。
- 页面支持声音、全屏、暂停、继续、重开和返回待命。

| 操作 | 输入 |
| --- | --- |
| 转向／抬头／俯冲 | WASD、方向键或鼠标 |
| 桶滚 | Q |
| 加速 | 按住 Shift |
| 机炮 | 按住左键或 F |
| 导弹 | 右键或 E |
| 切换追尾／座舱／俯视 | Space 或镜头按钮 |
| 暂停／继续 | Esc / P 或页面按钮 |
| 音效 | M 或顶部按钮 |
| 干扰弹 | C / X |

触屏使用画面摇杆和底部操作按钮。设备兼容性以实际测试报告为准。辅助技术单次激活加速按钮会短加速1.2秒，按住Shift或触控按钮可持续加速。

## 验收命令

```bash
node --test tools/test_sky_build.mjs tools/test_sky_adapter.mjs
node --test tools/test_cdp_click.mjs
node tools/cdp.mjs run "file://$(pwd)/sky-patrol/index.html?adapt=0" tools/test_sky_runtime.js --width=1280 --height=760 --wait=4500
node tools/cdp.mjs run "file://$(pwd)/sky-patrol/index.html?adapt=0" tools/test_sky_layout.js --width=1440 --height=900 --wait=4500 --out=shots/sky_title_desktop.png
node tools/cdp.mjs run "file://$(pwd)/sky-patrol/index.html?adapt=0" tools/test_sky_layout.js --width=390 --height=844 --wait=4500 --out=shots/sky_title_mobile.png
node tools/cdp.mjs run "file://$(pwd)/sky-patrol/index.html?adapt=0" tools/test_sky_fullscreen.js --click='#sky-fullscreen' --width=1280 --height=760 --wait=4500
```

浏览器驱动使用独立 headless Chrome 配置，不接管桌面。`--click` 通过 CDP 发送受信任的浏览器鼠标输入，便于验证需要用户手势的全屏；默认行为保持不变。检查输出中的 `[evalerror]` / `[pageerror]`，不能仅凭进程退出码判断脚本通过。

`test_sky_runtime.js` 的120秒巡航用例会每秒补燃油并维持安全离地高度，只隔离验证“不生成敌军／不补波”，不代表默认飞行体验或性能测试。
