// DOM负责标志、遥测与菜单，Canvas仅绘制飞行和战斗叠加。
// 本文件在60_main前载入，BOOT只能在稍后执行的绘制函数中读取。
const SKY_OCCLUSION = [];

function skyHeadingTape() {
  if (!G.player) return;
  const heading = compassDeg(G.player.yaw), cx = VW / 2;
  const span = Math.min(88, VW * 0.23), scale = span / 35;
  for (let d = Math.ceil((heading - 35) / 5) * 5; d <= heading + 35; d += 5) {
    const x = cx + (d - heading) * scale;
    const major = d % 15 === 0;
    line(x, 13, x, major ? 18 : 16, '#f4e8d1', 1, 0.85);
    if (major) drawText(pad((d % 360 + 360) % 360, 3), x, 27, {
      size: 6, mono: true, align: 'center', color: '#fff0d7', shadow: '#35323a'
    });
  }
  line(cx - 2, 7, cx, 10, '#f5c38a');
  line(cx + 2, 7, cx, 10, '#f5c38a');
}

hudBlocked = (x, y) => (Math.abs(x - VW / 2) < Math.min(94, VW * 0.25) && y < 32)
  || SKY_OCCLUSION.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);

drawHUD = function () {
  if (!G.player || !G.camera) return;
  skyHeadingTape();
  if (G.view === 0 && G.viewBlend > 0.55) drawTopPlayerIcon();
  if (flightMode === 'intercept') {
    drawTargetMarkers();
    drawAimReticle();
    drawThreats();
  }
  drawWarnings();
  if (G.banner && G.banner.t < G.banner.life && G.mode === 'play') {
    const alpha = Math.min(clamp01(G.banner.t / 0.4), clamp01((G.banner.life - G.banner.t) / 0.6));
    drawText(G.banner.title, VW / 2, 49, { size: 10, align: 'center', color: '#ffe2bb', shadow: '#24232c', alpha });
  }
  if ((G.mode === 'play' || G.mode === 'waveclear') && (!INPUT.touchMode || TOUCH.active)) {
    drawMousePip(INPUT.mx, INPUT.my, '#e7eadc');
  }
};

drawTitle = function () { skyHeadingTape(); };

drawLoading = function () {
  rect(0, 0, VW, VH, '#263440');
  rect(0, VH * 0.6, VW, VH * 0.4, '#1b2a31');
  const w = Math.min(220, VW * 0.6), x = (VW - w) / 2, y = VH * 0.69;
  drawText(BOOT.error ? '无法起飞' : '准备飞行', VW / 2, y - 15, {
    size: 14, color: '#f6e7d3', align: 'center', bold: true
  });
  rect(x, y, w, 2, '#4a535a');
  rect(x, y, w * clamp01(BOOT.progress), 2, '#f1bd83');
  drawText(BOOT.error ? '请查看页面上方提示' : (BOOT.stage || '初始化'), VW / 2, y + 17, {
    size: 9, color: '#c3cbc9', align: 'center'
  });
};

drawWaveClear = function () {
  const w = Math.min(230, VW - 28), x = (VW - w) / 2;
  panel(x, 39, w, 36, { fill: '#202328', stroke: '#b8a18c', alpha: 0.88 });
  drawText(`第 ${pad(G.wave, 2)} 波完成`, VW / 2, 53, { size: 11, align: 'center', color: '#f6e5cb' });
  drawText(`补给中 · ${Math.max(0, Math.ceil(G.respite))} 秒后继续`, VW / 2, 67, {
    size: 9, align: 'center', color: '#c5d5cb'
  });
};

drawPause = function () { rect(0, 0, VW, VH, 'rgba(15,18,23,0.38)'); };
drawFailed = function () { rect(0, 0, VW, VH, 'rgba(20,16,22,0.52)'); };

drawTouchControls = function () {
  if (!G.player || !TOUCH.active) return;
  circleLine(TOUCH.startX, TOUCH.startY, 22, '#e7eadc', 0.28);
  circleLine(TOUCH.x, TOUCH.y, 14, '#e7eadc', 0.55);
  circleFill(TOUCH.x, TOUCH.y, 2, '#f8e9cf', 0.8);
};
