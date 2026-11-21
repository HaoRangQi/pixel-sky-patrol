// 按用户提供的两张游戏画面手工重建；不读取参考游戏资源。模型坐标延用 -Z 朝前、+Y 向上。
const SKY_WING_TRAIL_REAR = 1.30;
const skySharedFighter = buildFighter;
buildFighter = function (kind) {
  if (kind !== 'player') return skySharedFighter(kind);

  const mb = new MeshBuilder(), p = v3;
  const ink = {
    belly: rgb('#4a4f5d'), seam: rgb('#4c5260'), flank: rgb('#626673'), slate: rgb('#818592'),
    metal: rgb('#a8a9a7'), silver: rgb('#c5c4b8'), bone: rgb('#dfd2aa'),
    navy: rgb('#2d3345'), navyTop: rgb('#3a4252'), gunmetal: rgb('#383946'),
    rust: rgb('#d46348'), buff: rgb('#d5b47c'), tip: rgb('#7caaa2'),
  };
  const mean = row => vmul(row.reduce(vadd, p()), 1 / row.length);
  function join(a, b, colors, count = a.length) {
    mb.center = vmul(vadd(mean(a), mean(b)), .5);
    for (let j = 0; j < count; j++) {
      const k = (j + 1) % a.length;
      mb.quad(a[j], a[k], b[k], b[j], colors[j]);
    }
  }
  function cap(row, back, color) {
    mb.center = mean(row);
    mb.center.z -= back ? .1 : -.1;
    mb.poly(row, color);
  }

  // 尖鼻到中机身的梯形截面提供平坦背板与连续的斜肩，而非沿每节随机换迷彩色。
  const body = [
    [-5.67, .19, .14, .02, -.10], [-3.92, .56, .42, .03, -.30], [-3.67, .64, .49, .04, -.34],
    [-2.33, .78, .58, .06, -.45], [-.09, 1.05, .61, .08, -.51],
    [1.75, 1.10, .54, .10, -.53], [3.15, .85, .37, .05, -.37], [4.0, .50, .15, .03, -.22],
  ];
  const shell = body.map(([z, w, roof, side, bottom]) => [
    p(-w*.54, roof, z), p(w*.54, roof, z), p(w, side, z), p(w*.85, bottom*.66, z),
    p(w*.43, bottom, z), p(-w*.43, bottom, z), p(-w*.85, bottom*.66, z), p(-w, side, z),
  ]);
  const nose = p(0, .025, -6.59), radome = [ink.navyTop, ink.navy, ink.navy, ink.navy, ink.navy, ink.navy, ink.navy, ink.navy];
  mb.center = p(0, .021, -5.94);
  for (let j = 0; j < 8; j++) mb.tri(nose, shell[0][j], shell[0][(j + 1) % 8], radome[j]);
  for (let i = 0; i < shell.length - 1; i++) {
    const top = i === 1 ? ink.silver : ink.metal;
    join(shell[i], shell[i + 1], i === 0 ? radome : [top, ink.slate, ink.flank, ink.belly, ink.belly, ink.belly, ink.flank, ink.slate]);
  }
  cap(shell.at(-1), true, ink.gunmetal);

  const canopy = [
    [-4.00,.24,.34,.14], [-3.70,.42,.37,.37], [-3.13,.58,.43,.63], [-1.68,.65,.43,.81],
    [-1.09,.59,.43,.71], [-.73,.39,.48,.22],
  ].map(([z,w,y,h]) => [p(-w,y,z),p(-w*.70,y+h*.72,z),p(-w*.34,y+h,z),p(w*.34,y+h,z),p(w*.70,y+h*.72,z),p(w,y,z)]);
  const roof = ['#a4774b','#d6a45d','#f9db97','#d6a05e','#a87d4f'].map(rgb);
  const windscreen = ['#a87e56','#d4b078','#ffe8ae','#d7b27e','#a47e55'].map(rgb);
  const rim = ['#413d44','#5c5148','#6f6051','#5c5148','#413d44'].map(rgb);
  for (let i = 0; i < canopy.length - 1; i++) join(canopy[i], canopy[i+1], i < 2 ? windscreen : i === 4 ? rim : roof, 5);
  cap(canopy[0], false, ink.gunmetal);
  cap(canopy.at(-1), true, ink.gunmetal);

  // 中间留较深的双发动机间隙，暖芯凹入喷口而不是贴两个亮点在机背上。
  const steps = 8;
  const ring = (x, y, z, w, h) => Array.from({length:steps}, (_, i) => {
    const a = (i + .5) * TAU / steps;
    return p(x + w*Math.cos(a), y + h*Math.sin(a), z);
  });
  const cowl = [ink.slate, ink.metal, ink.slate, ink.flank, ink.seam, ink.belly, ink.seam, ink.flank];
  const iron = ['#53505c','#68616b','#56535f','#45414d','#45414d','#44404b','#3b3946','#45414d'].map(rgb);
  const liner = rgb('#282331');
  const exhaust = [rgb('#e28348'), rgb('#ffe2a2')];
  const foilTop = [ink.slate, ink.slate, ink.metal, ink.flank];
  function foilRow(side, [x,nose,tail,y,t]) {
    const z = f => nose + (tail-nose)*f;
    return [p(side*x,y,nose),p(side*x,y+t*.64,z(.14)),p(side*x,y+t*.56,z(.51)),
      p(side*x,y+t*.24,z(.96)),p(side*x,y,tail)];
  }
  function foil(side, sections, paint) {
    const rows = sections.map(s => foilRow(side,s));
    for (let i = 0; i < rows.length - 1; i++) {
      const shades = paint[i] || foilTop;
      join(rows[i],rows[i+1],[...shades,ink.belly]);
    }
    mb.center = mean(rows.at(-1)); mb.center.x -= side * .10;
    mb.poly(rows.at(-1), paint.at(-1)?.[0] || ink.seam);
    return rows;
  }
  const wing = [
    [.81,-2.03,2.24,.04,.29], [1.91,-1.28,2.21,.035,.25], [3.12,-.39,1.95,.021,.19],
    [4.20,.45,1.78,.010,.12], [4.38,.61,1.70,0,.108], [4.54,.74,1.63,0,.099],
    [4.70,.79,1.54,0,.078], [4.90,.92,SKY_WING_TRAIL_REAR,0,.040],
  ];
  const paint = [
    [ink.metal,ink.flank,ink.slate,ink.seam], [ink.slate,ink.slate,ink.silver,ink.flank],
    [ink.metal,ink.slate,ink.silver,ink.flank], foilTop,
    [ink.buff,ink.buff,ink.bone,ink.buff], [ink.rust,ink.rust,ink.rust,ink.rust], [ink.tip,ink.tip,ink.tip,ink.tip],
  ];
  const tail = [[1.25,2.27,3.92,.10,.17],[2.15,2.63,4.01,.08,.14],[2.99,3.46,3.89,.05,.07]];
  function wingMark(a, b) {
    // 单侧暖浅识别块沿实际翼面铺设，不悬浮在机翼上方。
    const at = (x, t) => {
      const q = vlerp(vlerp(a[1],a[2],t), vlerp(b[1],b[2],t), x);
      q.y += .013;
      return q;
    };
    mb.center = p(0,-1,0);
    mb.quad(at(.18,.16),at(.76,.16),at(.76,.76),at(.18,.76),ink.bone);
  }
  const fin = [[1.17,.33,1.72,3.90,.100], [1.63,1.52,2.52,3.68,.071],
    [1.675,1.65,2.67,3.63,.065], [1.80,2.04,3.02,3.48,.048]];
  const rails = {pos:p(),renderBasis:basisFrom(0,0,0)};
  for (const side of [-1, 1]) {
    const planform = foil(side, wing, paint);
    if (side < 0) wingMark(planform[2],planform[3]);
    foil(side, tail, [[ink.slate,ink.metal,ink.silver,ink.seam]]);

    const engine = [
      [1.00,-.035,-1.73,.37,.27], [1.20,-.02,-.90,.59,.40],
      [1.25,0,3.57,.52,.43], [1.25,0,4.30,.49,.45],
    ].map(([x,y,z,w,h]) => ring(side*x,y,z,w,h));
    cap(engine[0], false, ink.navy);
    for (let i = 0; i < engine.length - 1; i++) {
      if (i !== 1) { join(engine[i],engine[i+1],i === 2 ? iron : cowl); continue; }
      const a = engine[i], b = engine[i+1];
      mb.center = vmul(vadd(mean(a),mean(b)),.5);
      for (let j = 0; j < steps; j++) {
        const k = (j+1)%steps;
        if (j !== 1) { mb.quad(a[j],a[k],b[k],b[j],cowl[j]); continue; }
        // 只细分朝上的检修面：前盖、窄接缝、后盖，侧面仍沿用完整机舱。
        for (const [from,to,shade] of [[0,2.22/4.47,ink.silver],[2.22/4.47,2.36/4.47,ink.seam],[2.36/4.47,1,ink.slate]]) {
          mb.quad(vlerp(a[j],b[j],from),vlerp(a[k],b[k],from),vlerp(a[k],b[k],to),vlerp(a[j],b[j],to),shade);
        }
      }
    }
    const rx = side * 1.25;
    const mouth = ring(rx,0,4.30,.303,.279), throat = ring(rx,0,4.18,.235,.217);
    join(engine.at(-1), mouth, iron);
    // 外环和内管都应在尾部有受光方向，不用朝外法线渲染内腔。
    mb.center = p(rx,0,4.09);
    for (let i = 0; i < steps; i++) mb.quad(mouth[i],mouth[(i+1)%steps],throat[(i+1)%steps],throat[i],liner);
    cap(throat, true, liner);
    mb.center = p(rx,0,4.1);
    mb.disc(rx,0,4.207,.179,8,exhaust[0],.31);
    mb.disc(rx+.016*side,.016,4.225,.112,7,exhaust[1],.56);

    const rudder = fin.map(([x,y,z0,z1,w]) => [p(side*(x-w),y,z0),p(side*(x+w),y,z0+.045),
      p(side*(x+w),y,z1),p(side*(x-w),y,z1-.035)]);
    for (const [i, shade] of [[ink.flank,ink.slate,ink.seam,ink.metal],Array(4).fill(ink.buff),Array(4).fill(ink.rust)].entries()) {
      join(rudder[i],rudder[i+1],shade);
    }
    mb.center = p(side*1.77,1.82,3.22);
    mb.poly(rudder.at(-1),ink.rust);

    for (const slot of side < 0 ? [0,2] : [1,3]) {
      const {x,y,z} = wingRailPosition(rails,slot);
      const end = Math.abs(x) > 3 ? .67 : .39;
      const bracket = (a, h, t) => [p(x-t,y+.131,a),p(x+t,y+.131,a),p(x+t,h,a),p(x-t,h,a)];
      const front = bracket(z+.12,y+.22,.048), root = bracket(end,.07,.067);
      join(front,root,[ink.gunmetal,ink.seam,ink.seam,ink.seam]);
      cap(front,false,ink.gunmetal); cap(root,true,ink.gunmetal);
    }
  }
  return mb.radius(6.7).build();
};
