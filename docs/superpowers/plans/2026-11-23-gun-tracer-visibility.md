# 机炮前方曳光与上移准星

Goal：连续机炮从机鼻向前可见，松开后没有停在机尾的残线；900 米外的下坠可读，追尾与座舱准星上移 16 个逻辑像素且继续与真实弹道一致。

Architecture：炮弹持有自己的短段历史，HUD 仅投影真实飞行路径，不生成第二套弹道。准星坐标归战斗层统一提供，发射、锁定和两种 HUD 读取同一位置。

Tech Stack：现有 JS / Canvas2D / WebGL2，Node 测试及独立 Chrome CDP 验收，不加运行依赖。

Baseline/Authority Refs：用户截图与反馈、`PRODUCT.md`、[准星与资源合同](../../../.agents/notes/implemented/feature/2026-11-23-gun-sight-wingman-resources.md)。已读 `42_combat` 生产、`50_ui_hud` 消费、`54_cockpit`、`65_app`、相关真实物理和遮挡测试。

Compatibility Boundary：不改机炮伤害、900 米平直段、超程重力、碰撞、弹量、补给和僚机逻辑。旧入口准星保持居中，旧弹道不变。普通非弹体 `addTracer` 效果保留；实体机炮不再走静止残影路径。

Verification：`node --test tools/test_gun_sight_resources.mjs tools/test_projectile_trails.mjs tools/test_sky_overlay_occlusion.mjs`；双入口构建与全量现有测试；`node tools/verify_sky_gun_tracers.mjs` 的实际连续帧，桌面、竖屏、短横屏、座舱、俯瞰；复用自然追击实弹命中验收。

TDD Route：auto / strict。先以真实炮弹生产与绘制路径证明出生段向后越过炮口、静止残影、远端无亮弹头和准星位置问题，再实现并回归。

ArchitectureReviewRequired：yes。PatchShape：生产和绘制合同；CanonicalOwner：`spawnGunBullet` / `updateGunBullets` 持有飞行，HUD 持有投影；Decision：修改现有所有者。两文件超过 800 行，本轮只替换既有曳光逻辑及提取小型准星坐标函数，不扩展武器系统。

1. 用 `tools/verify_sky_gun_tracers.mjs --baseline` 保存当前连续射击与松开截图、后方残线数量。高空夹具只用于保持完整超程弹道不撞地；自然飞行另有独立序列。
2. 在 `test_projectile_trails` 添加真实出生、逐帧推进与绘制回归：不向炮口后方构造线；曳光只随存活弹体，采样有界、独立、不在释放后堆积；远段亮弹头仍可见，地形／机身遮挡仍有效。在 `test_gun_sight_resources` 用上移准星射线验证三距离真实命中并保留原入口。
3. 改 `42_combat.js` 与 `50_ui_hud.js`，使用最后 46 米、最多 16 点的真实飞行尾段加高对比短曳光和亮弹头，近段投影最多 8 像素。改 `54_cockpit.js` 与新版玩家初值，使开火、锁定、绘制共用准星坐标；姿态梯与仪表不移动。去掉覆盖机鼻的「搜索」文字。
4. 双构建，相关和全量测试，实际截图逐帧检查，并复用自然追击命中。更新既有准星笔记与验收说明，记录效果和界限。

Retirement：删除实体炮弹出生及每帧的 `addTracer` 写入，不保留两条并行绘制路径。通用短时直线效果继续由 `addTracer` 持有。验证完成后关闭本轮 Chrome 与临时 profile，只保留用户现有预览服务。

Risks：射线方向投影会使远处尾段很短；必须看实际像素弹头和下坠连续帧，不能只靠弹体数量判定可见。上移准星必须同时覆盖座舱、锁定和浏览器追击控制，防止旧中心假设残留。
