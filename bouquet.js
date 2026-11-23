/**
 * 3D ASCII Flower Bouquet Engine
 * Features:
 * - True 3D perspective projection with z-buffering and Lambertian lighting
 * - Full 360-degree rotation with interactive drag (mouse & touch)
 * - Detailed blooms: 5 star lilies, 9 swirl roses, 8 curled leaves
 * - 3D florist wrapping paper cone with wavy ruffles, gathered stems, satin bow
 * - Ambient baby's breath starlets and drifting sparkles
 * - High-speed span grouping into a single <pre> element (60 FPS)
 * - Responsive auto-sizing for mobile and desktop screens
 */
(function () {
  'use strict';

  var container = document.getElementById('bouquet-container');
  var pre = document.getElementById('bouquet');
  var dragHint = document.getElementById('drag-hint');
  var playBtn = document.getElementById('btn-spin');

  if (!pre) return;

  // Character ramps
  var SHADE = ' .,:;=+*oO#%@';
  var PETAL_SHADE = ' .:+*oO#%@';

  // 3D Camera & Projection Parameters
  var CAM_DIST = 4.4;
  var PIVOT_Y = 0.08;
  var BASE_TILT = 0.24;

  // Directional Light Vector (Normalized)
  var LX = -0.4, LY = 0.65, LZ = 0.65;
  var Llen = Math.sqrt(LX * LX + LY * LY + LZ * LZ);
  var nLX = LX / Llen, nLY = LY / Llen, nLZ = LZ / Llen;

  // Monospace font character geometry (typical aspect ~ 1.75)
  var CW = 0.6, LH = 1.05;
  var ASPECT = LH / CW;

  // Grid dimensions
  var COLS = 96;
  var ROWS = 52;

  // Render buffers
  var zbuf = new Float32Array(COLS * ROWS);
  var chars = new Array(COLS * ROWS);
  var classes = new Array(COLS * ROWS);

  // Animation & Interaction state
  var isPlaying = true;
  var angle = 0;
  var tilt = BASE_TILT;
  var spinSpeed = 0.42; // radians per second (~15s for full 360)
  var isDragging = false;
  var lastX = 0, lastY = 0;
  var dragVelX = 0, dragVelY = 0;
  var lastTime = performance.now();
  var animFrameId = null;

  // Seeded PRNG for reproducible 3D scene placement
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function norm(v) {
    var m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
    return [v[0] / m, v[1] / m, v[2] / m];
  }

  // Build Procedural 3D Scene Geometry
  function buildScene() {
    var rnd = mulberry(20261124);
    var pts = [];
    var flowers = [];
    var neck = [0, -0.16, 0];
    var C = [0, 0.16, 0];
    var D = 0.64;

    // 14 flower heads on a Fibonacci hemispherical dome
    var N = 14;
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < N; i++) {
      var el = (86 - 56 * Math.sqrt(i / (N - 1))) * (Math.PI / 180);
      var az = i * golden;
      var d = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
      var pos = [C[0] + d[0] * D, C[1] + d[1] * D, C[2] + d[2] * D];
      var isLily = (i % 3 === 0);
      flowers.push({
        pos: pos,
        axis: norm(d),
        type: isLily ? 'lily' : 'rose',
        R: isLily ? 0.138 : 0.126,
        seed: i * 1.618 + rnd() * 0.4
      });

      // Internal stem leading to bouquet neck
      for (var j = 0; j < 50; j++) {
        var t = j / 49;
        var sp = [
          pos[0] + (neck[0] - pos[0]) * t,
          pos[1] + (neck[1] - pos[1]) * t,
          pos[2] + (neck[2] - pos[2]) * t
        ];
        pts.push({
          p: sp,
          n: [d[0] * 0.6, 0, d[2] * 0.6],
          kind: 'stem',
          tone: -0.12
        });
      }
    }

    // 8 Curled framing greenery leaves around the collar
    for (var li = 0; li < 8; li++) {
      var la = (li + 0.35) / 8 * Math.PI * 2;
      var lc = Math.cos(la), ls = Math.sin(la);
      var base = [0.28 * lc, 0.28, 0.28 * ls];
      var ld = norm([lc, 0.12, ls]);
      var side = [-ls, 0, lc];
      var ln = norm([ls * 0.12, -0.99, -lc * 0.12]);
      var L = 0.28, W = 0.065;
      for (var ti = 0; ti < 26; ti++) {
        var lt = ti / 25;
        for (var wi = -4; wi <= 4; wi++) {
          var w = wi / 4;
          var curl = 0.02 * w * w;
          var lp = [
            base[0] + ld[0] * L * lt + side[0] * W * Math.sin(Math.PI * lt) * w + ln[0] * curl,
            base[1] + ld[1] * L * lt - 0.08 * lt * lt + ln[1] * curl,
            base[2] + ld[2] * L * lt + side[2] * W * Math.sin(Math.PI * lt) * w + ln[2] * curl
          ];
          pts.push({
            p: lp,
            n: ln,
            kind: 'leaf',
            tone: wi === 0 ? 0.22 : (1 - Math.abs(w)) * 0.1
          });
        }
      }
    }

    // 3D Florist wrapping cone with wavy fluted ruffles
    var y0 = -0.24, y1 = 0.32, r0 = 0.07, r1 = 0.40;
    var coneK = (r1 - r0) / (y1 - y0);
    var rings = 46;
    for (var ri = 0; ri < rings; ri++) {
      var rt = ri / (rings - 1);
      var cr = r0 + (r1 - r0) * rt;
      var count = Math.max(12, Math.floor(165 * cr));
      for (var cj = 0; cj < count; cj++) {
        var ph = (cj / count) * Math.PI * 2;
        var cc = Math.cos(ph), cs = Math.sin(ph);
        var py = y0 + (y1 - y0) * rt;
        if (rt > 0.82) py += 0.032 * Math.sin(9 * ph);
        var fold = 0.28 * (Math.abs(Math.sin(5 * ph)) - 0.5);
        var nn = norm([cc, -coneK, cs]);
        pts.push({
          p: [cr * cc, py, cr * cs],
          n: nn,
          kind: 'paper',
          tone: fold
        });
      }
    }

    // Stems emerging cleanly below the cone base
    for (var si = 0; si < 7; si++) {
      var sa = (si / 7) * Math.PI * 2;
      var sx = 0.028 * Math.cos(sa), sz = 0.028 * Math.sin(sa);
      for (var sj = 0; sj < 36; sj++) {
        var st = sj / 35;
        pts.push({
          p: [sx * (1 + 1.1 * st), -0.22 - 0.26 * st, sz * (1 + 1.1 * st)],
          n: [Math.cos(sa), 0, Math.sin(sa)],
          kind: 'stem',
          tone: -0.08
        });
      }
    }

    // Satin Ribbon Band & Tied Bow
    var by = -0.14;
    var br = r0 + coneK * (by - y0) + 0.012;
    for (var bi = 0; bi < 90; bi++) {
      var bph = (bi / 90) * Math.PI * 2;
      for (var bdy = -0.014; bdy <= 0.014; bdy += 0.014) {
        pts.push({
          p: [br * Math.cos(bph), by + bdy, br * Math.sin(bph)],
          n: [Math.cos(bph), 0, Math.sin(bph)],
          kind: 'ribbon',
          tone: 0.15
        });
      }
    }
    // Bow knot & loops
    var knot = [0, by, br + 0.012];
    for (var side = -1; side <= 1; side += 2) {
      for (var bj = 0; bj < 65; bj++) {
        var ba = (bj / 65) * Math.PI * 2;
        var blx = side * (0.075 + 0.075 * Math.cos(ba));
        var bly = 0.042 * Math.sin(ba) + 0.02 * (0.075 + 0.075 * Math.cos(ba)) / 0.15;
        for (var bFill = 0.72; bFill <= 1.0; bFill += 0.28) {
          pts.push({
            p: [knot[0] + blx * bFill, knot[1] + bly * bFill, knot[2] + 0.012],
            n: [side * 0.35, 0.2, 0.92],
            kind: 'ribbon',
            tone: 0.25
          });
        }
      }
      for (var sj = 0; sj < 32; sj++) {
        var s_t = sj / 31;
        pts.push({
          p: [knot[0] + side * 0.065 * s_t, knot[1] - 0.16 * s_t, knot[2] + 0.018],
          n: [side * 0.2, 0, 0.98],
          kind: 'ribbon',
          tone: -0.05 + 0.06 * Math.sin(s_t * 8)
        });
      }
    }
    pts.push({ p: [0, by, knot[2] + 0.02], n: [0, 0, 1], kind: 'ribbon', tone: 0.4 });

    // Baby's breath clouds (delicate twinkling starlets around crown)
    var babies = [];
    for (var bbi = 0; bbi < 75; bbi++) {
      var bba = rnd() * Math.PI * 2;
      var bbel = 0.35 + rnd() * 1.1;
      var bbr = 0.40 + rnd() * 0.22;
      babies.push({
        p: [bbr * Math.cos(bba) * Math.cos(bbel), C[1] + bbr * Math.sin(bbel), bbr * Math.sin(bba) * Math.cos(bbel)],
        phase: rnd() * Math.PI * 2
      });
    }

    // Drifting ambient sparkles
    var sparkles = [];
    for (var spi = 0; spi < 32; spi++) {
      var spa = rnd() * Math.PI * 2;
      var spr = 0.65 + rnd() * 0.32;
      sparkles.push({
        p: [spr * Math.cos(spa), -0.28 + rnd() * 1.15, spr * Math.sin(spa)],
        phase: rnd() * Math.PI * 2,
        speed: 1.5 + rnd() * 2.5
      });
    }

    return { pts: pts, flowers: flowers, babies: babies, sparkles: sparkles };
  }

  var scene = buildScene();

  // Responsive Grid Resolution & Font Sizing
  function resize() {
    var rect = container ? container.getBoundingClientRect() : { width: window.innerWidth, height: 600 };
    var w = rect.width || 500;

    if (w < 380) {
      COLS = 60;
      ROWS = 38;
    } else if (w < 480) {
      COLS = 68;
      ROWS = 42;
    } else if (w < 720) {
      COLS = 80;
      ROWS = 46;
    } else if (w < 1024) {
      COLS = 90;
      ROWS = 50;
    } else {
      COLS = 98;
      ROWS = 52;
    }

    var total = COLS * ROWS;
    if (zbuf.length !== total) {
      zbuf = new Float32Array(total);
      chars = new Array(total);
      classes = new Array(total);
    }

    // Font size scaling: ensure pre element fits cleanly with padding
    var availW = Math.max(260, w - 16);
    var charW = availW / COLS;
    var fs = Math.max(6.5, Math.min(13.5, charW / CW));
    pre.style.fontSize = fs.toFixed(2) + 'px';
  }

  window.addEventListener('resize', resize);
  resize();

  // 3D Perspective Projection & Shading Render
  function renderFrame(timeSec) {
    var total = COLS * ROWS;
    for (var i = 0; i < total; i++) {
      zbuf[i] = -1e9;
      chars[i] = ' ';
      classes[i] = null;
    }

    var scale = Math.min((ROWS - 2) / 1.5, (COLS - 2) / (1.5 * ASPECT));
    var sx_scale = scale * ASPECT;
    var cx = COLS / 2;
    var cy = ROWS * 0.52;

    var ca = Math.cos(angle), sa = Math.sin(angle);
    var ct = Math.cos(tilt), st = Math.sin(tilt);

    function project(x, y, z) {
      var xr = x * ca - z * sa;
      var zr = x * sa + z * ca;
      var yp = y - PIVOT_Y;
      var yt = yp * ct - zr * st;
      var zt = yp * st + zr * ct;
      var f = CAM_DIST / (CAM_DIST - zt);
      return {
        col: Math.round(cx + xr * f * sx_scale),
        row: Math.round(cy - yt * f * scale),
        zt: zt,
        f: f
      };
    }

    function plot(c, r, z, ch, cls) {
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
        var idx = r * COLS + c;
        if (z > zbuf[idx]) {
          zbuf[idx] = z;
          chars[idx] = ch;
          classes[idx] = cls;
        }
      }
    }

    // 1. Draw 3D scene elements (cone wrap, ribbon, framing leaves, stems)
    var pCount = scene.pts.length;
    for (var pi = 0; pi < pCount; pi++) {
      var pt = scene.pts[pi];
      var pr = project(pt.p[0], pt.p[1], pt.p[2]);

      var nx = pt.n[0], ny = pt.n[1], nz = pt.n[2];
      var nxr = nx * ca - nz * sa;
      var nzr = nx * sa + nz * ca;
      var nyt = ny * ct - nzr * st;
      var nzt = ny * st + nzr * ct;

      var dot = nxr * nLX + nyt * nLY + nzt * nLZ;
      if (dot < 0) dot = -dot * 0.4;
      var b = 0.22 + 0.78 * Math.max(0, dot) + (pt.tone || 0);
      if (b < 0) b = 0; else if (b > 0.999) b = 0.999;

      var ch = SHADE[Math.floor(b * SHADE.length)];
      var clsName = 'c-leaf';
      if (pt.kind === 'paper') clsName = 'c-paper';
      else if (pt.kind === 'ribbon') clsName = 'c-ribbon';

      plot(pr.col, pr.row, pr.zt, ch, clsName);
    }

    // 2. Draw 3D flower blooms (Star Lilies & Spiral Roses)
    var fCount = scene.flowers.length;
    for (var fi = 0; fi < fCount; fi++) {
      var fl = scene.flowers[fi];
      var fpr = project(fl.pos[0], fl.pos[1], fl.pos[2]);
      var rx = fl.R * fpr.f * sx_scale;
      var ry = fl.R * fpr.f * scale;

      // Distance dimming for blooms turning to the back
      var dim = -0.32 * (1 - Math.max(0, Math.min(1, (fpr.zt + 0.6) / 1.2)));
      var rot = fl.seed + angle * 0.7;

      var r0 = Math.floor(fpr.row - ry), r1 = Math.ceil(fpr.row + ry);
      var c0 = Math.floor(fpr.col - rx), c1 = Math.ceil(fpr.col + rx);

      for (var r = r0; r <= r1; r++) {
        var dy = (r - fpr.row) / ry;
        for (var c = c0; c <= c1; c++) {
          var dx = (c - fpr.col) / rx;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 1.0) continue;

          if (fl.type === 'lily') {
            // Star Lily with 6 pointed flaring petals and golden center
            var la = Math.atan2(dy, dx) + rot;
            var llobe = 0.5 + 0.5 * Math.cos(6 * la);
            var reach = 0.38 + 0.62 * Math.pow(llobe, 1.4);
            if (dist > reach) continue;
            var lu = dist / reach;
            var lb = 0.50 + 0.50 * Math.pow(lu, 0.6) * Math.pow(llobe, 0.6) + dim;
            var isStamen = (lu < 0.24);
            if (isStamen) lb = Math.min(1, lb + 0.38);
            if (lb < 0) lb = 0; else if (lb > 0.999) lb = 0.999;

            var lch = PETAL_SHADE[Math.floor(lb * PETAL_SHADE.length)];
            plot(c, r, fpr.zt + 0.05 * (1 - dist), lch, isStamen ? 'c-gold' : 'c-lily');
          } else {
            // Swirl Rose with curved overlapping petals and dark velvet core
            var ra = Math.atan2(dy, dx) + rot;
            var swirl = ra + dist * 2.5;
            var rlobe = 0.5 + 0.5 * Math.cos(5 * swirl);
            if (dist > 0.88 + 0.12 * rlobe) continue;
            var ring = dist * 3.5;
            var crest = Math.sin((ring - Math.floor(ring)) * Math.PI);
            var rb = 0.38 + 0.62 * Math.pow(crest, 0.7) * (0.6 + 0.4 * rlobe) + dim;
            if (dist < 0.2) rb *= 0.48; // Velvet core
            if (rb < 0) rb = 0; else if (rb > 0.999) rb = 0.999;

            var rch = PETAL_SHADE[Math.floor(rb * PETAL_SHADE.length)];
            plot(c, r, fpr.zt + 0.05 * (1 - dist), rch, 'c-rose');
          }
        }
      }
    }

    // 3. Baby's breath starlets
    var bCount = scene.babies.length;
    for (var bi = 0; bi < bCount; bi++) {
      var bb = scene.babies[bi];
      var bpr = project(bb.p[0], bb.p[1], bb.p[2]);
      var isStar = Math.sin(timeSec * 2.5 + bb.phase) > 0.5;
      plot(bpr.col, bpr.row, bpr.zt + 0.02, isStar ? '*' : '·', 'c-sparkle');
    }

    // 4. Ambient floating sparkles
    var sCount = scene.sparkles.length;
    for (var si = 0; si < sCount; si++) {
      var sp = scene.sparkles[si];
      var spr = project(sp.p[0], sp.p[1], sp.p[2]);
      var tw = Math.sin(timeSec * sp.speed + sp.phase);
      if (tw > 0.82) {
        plot(spr.col, spr.row, spr.zt, '✦', 'c-sparkle');
      } else if (tw > 0.45) {
        plot(spr.col, spr.row, spr.zt, '*', 'c-sparkle');
      } else if (tw > 0.1) {
        plot(spr.col, spr.row, spr.zt, '·', 'c-sparkle');
      }
    }

    // 5. High-speed contiguous span grouping
    var lines = [];
    for (var row = 0; row < ROWS; row++) {
      var rOffset = row * COLS;
      var curCls = null;
      var buf = '';
      var line = '';

      for (var col = 0; col < COLS; col++) {
        var idx = rOffset + col;
        var ch = chars[idx];
        var k = classes[idx];

        if (k !== curCls) {
          if (buf.length > 0) {
            line += curCls ? '<span class="' + curCls + '">' + buf + '</span>' : buf;
          }
          curCls = k;
          buf = ch;
        } else {
          buf += ch;
        }
      }

      if (buf.length > 0) {
        line += curCls ? '<span class="' + curCls + '">' + buf + '</span>' : buf;
      }
      lines.push(line);
    }

    pre.innerHTML = lines.join('\n');
  }

  // Animation Loop with 360 Spin & Momentum Damping
  function loop(timestamp) {
    var dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.1) dt = 0.1; // clamp delta on tab switch

    if (isDragging) {
      angle += dragVelX;
      tilt += dragVelY;
      dragVelX *= 0.85;
      dragVelY *= 0.85;
    } else {
      if (Math.abs(dragVelX) > 0.001) {
        angle += dragVelX;
        dragVelX *= 0.94;
      } else if (isPlaying) {
        angle += spinSpeed * dt;
      }

      // Smoothly restore tilt to natural angle
      tilt += (BASE_TILT - tilt) * 0.08;
    }

    // Keep angle in [0, 2PI]
    var TWO_PI = Math.PI * 2;
    angle = (angle % TWO_PI + TWO_PI) % TWO_PI;

    renderFrame(timestamp / 1000);
    animFrameId = requestAnimationFrame(loop);
  }

  // Interactive Drag-to-Rotate (Pointer events: Mouse & Touch)
  function onPointerDown(e) {
    isDragging = true;
    lastX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    lastY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
    dragVelX = 0;
    dragVelY = 0;
    if (dragHint) dragHint.classList.add('active');
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    var x = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    var y = e.clientY || (e.touches && e.touches[0].clientY) || 0;
    var dx = x - lastX;
    var dy = y - lastY;
    lastX = x;
    lastY = y;

    dragVelX = dx * 0.008;
    dragVelY = -dy * 0.006;

    angle += dragVelX;
    tilt = Math.max(-0.15, Math.min(0.65, tilt + dragVelY));

    if (e.cancelable && e.type.startsWith('touch')) {
      e.preventDefault();
    }
  }

  function onPointerUp() {
    isDragging = false;
    if (dragHint) dragHint.classList.remove('active');
  }

  if (container) {
    container.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    container.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
  }

  // Play / Pause button toggle
  if (playBtn) {
    playBtn.addEventListener('click', function () {
      isPlaying = !isPlaying;
      playBtn.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
      playBtn.textContent = isPlaying ? 'Pause ang spin' : 'Resume ang spin';
    });
  }

  // Respect system reduced-motion preference
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    isPlaying = false;
    if (playBtn) playBtn.textContent = 'Resume ang spin';
  }

  // Initial render & kick off loop
  renderFrame(0);
  animFrameId = requestAnimationFrame(loop);

  // Expose API for testing
  window.Bouquet3D = {
    setAngle: function (a) {
      angle = a;
      renderFrame(performance.now() / 1000);
    },
    getAngle: function () { return angle; },
    togglePlay: function () { isPlaying = !isPlaying; return isPlaying; }
  };
})();
