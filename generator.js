// ── Seeded PRNG (Mulberry32) ──────────────────────────────────────────
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

// ── Metaball charges (normalized 0-1 space) ───────────────────────────
function placeCharges(rng, count, minR, maxR, scatterSeed, density) {
  const refSize = 800;
  // Use a separate RNG for positions so scatter seed re-rolls layout independently
  const posRng = mulberry32(scatterSeed);
  const charges = [];

  // density 0 = fully uniform/spread, 100 = heavily clustered
  // At low density: positions are jittered grid to fill evenly
  // At high density: fully random, allowing natural clumping
  const clusterAmount = density / 100; // 0-1

  // Grid-based spreading for low density values
  const gridCols = Math.ceil(Math.sqrt(count * 1.5));
  const gridRows = Math.ceil(count / gridCols);

  for (let i = 0; i < count; i++) {
    // Grid position (evenly spread)
    const gc = i % gridCols;
    const gr = Math.floor(i / gridCols);
    const gridX = (gc + 0.5) / gridCols;
    const gridY = (gr + 0.5) / gridRows;

    // Random position
    const randX = posRng();
    const randY = posRng();

    // Blend between grid and random based on density
    // Add jitter to grid positions so they're not perfectly aligned
    const jitter = 0.4 / gridCols;
    const spreadX = gridX + (posRng() - 0.5) * jitter * 2;
    const spreadY = gridY + (posRng() - 0.5) * jitter * 2;

    const x = spreadX + (randX - spreadX) * clusterAmount;
    const y = spreadY + (randY - spreadY) * clusterAmount;

    charges.push({
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      r: (minR + rng() * (maxR - minR)) / refSize,
    });
  }
  return charges;
}

// ── Scalar field (normalized space, tiles at x ± 1) ───────────────────
function evalField(x, y, charges) {
  let sum = 0;
  for (const c of charges) {
    const dy = y - c.y;
    const r2 = c.r * c.r;
    const dx0 = x - c.x;
    sum += r2 / (dx0 * dx0 + dy * dy + 1e-6);
    const dxL = x - (c.x - 1);
    sum += r2 / (dxL * dxL + dy * dy + 1e-6);
    const dxR = x - (c.x + 1);
    sum += r2 / (dxR * dxR + dy * dy + 1e-6);
  }
  return sum / charges.length;
}

// ── Gradient magnitude ────────────────────────────────────────────────
function gradientMag(x, y, charges, step) {
  const fx1 = evalField(x + step, y, charges);
  const fx0 = evalField(x - step, y, charges);
  const fy1 = evalField(x, y + step, charges);
  const fy0 = evalField(x, y - step, charges);
  const gx = (fx1 - fx0) / (2 * step);
  const gy = (fy1 - fy0) / (2 * step);
  return Math.sqrt(gx * gx + gy * gy);
}

// ── Marching Squares ──────────────────────────────────────────────────
function marchingSquares(field, cols, rows, threshold) {
  const segments = [];
  function lerp(t1, t2) {
    if (Math.abs(t2 - t1) < 1e-10) return 0.5;
    return (threshold - t1) / (t2 - t1);
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const tl = field[j * cols + i];
      const tr = field[j * cols + i + 1];
      const br = field[(j + 1) * cols + i + 1];
      const bl = field[(j + 1) * cols + i];
      const code = (tl >= threshold ? 8 : 0) | (tr >= threshold ? 4 : 0) |
                   (br >= threshold ? 2 : 0) | (bl >= threshold ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top    = { x: i + lerp(tl, tr), y: j };
      const right  = { x: i + 1, y: j + lerp(tr, br) };
      const bottom = { x: i + lerp(bl, br), y: j + 1 };
      const left   = { x: i, y: j + lerp(tl, bl) };
      const add = (a, b) => segments.push([a, b]);
      switch (code) {
        case 1:  add(left, bottom); break;
        case 2:  add(bottom, right); break;
        case 3:  add(left, right); break;
        case 4:  add(top, right); break;
        case 5:  add(left, top); add(bottom, right); break;
        case 6:  add(top, bottom); break;
        case 7:  add(left, top); break;
        case 8:  add(top, left); break;
        case 9:  add(top, bottom); break;
        case 10: add(top, right); add(left, bottom); break;
        case 11: add(top, right); break;
        case 12: add(left, right); break;
        case 13: add(bottom, right); break;
        case 14: add(left, bottom); break;
      }
    }
  }
  return segments;
}

// ── Chain segments into polylines ─────────────────────────────────────
function chainSegments(segments, eps) {
  if (!segments.length) return [];
  eps = eps || 0.01;
  const used = new Array(segments.length).fill(false);
  const rawChains = [];
  function ptEq(a, b) {
    return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
  }
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const chain = [segments[start][0], segments[start][1]];
    let changed = true;
    while (changed) {
      changed = false;
      const tail = chain[chain.length - 1];
      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        if (ptEq(tail, segments[i][0])) { chain.push(segments[i][1]); used[i] = true; changed = true; break; }
        if (ptEq(tail, segments[i][1])) { chain.push(segments[i][0]); used[i] = true; changed = true; break; }
      }
    }
    changed = true;
    while (changed) {
      changed = false;
      const head = chain[0];
      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        if (ptEq(head, segments[i][1])) { chain.unshift(segments[i][0]); used[i] = true; changed = true; break; }
        if (ptEq(head, segments[i][0])) { chain.unshift(segments[i][1]); used[i] = true; changed = true; break; }
      }
    }
    if (chain.length >= 2) rawChains.push(chain);
  }
  // Split chains at large jumps (more than 2 grid cells apart)
  const maxJump = 2.5;
  const chains = [];
  for (const chain of rawChains) {
    let sub = [chain[0]];
    for (let i = 1; i < chain.length; i++) {
      const dx = chain[i].x - chain[i - 1].x;
      const dy = chain[i].y - chain[i - 1].y;
      if (dx * dx + dy * dy > maxJump * maxJump) {
        if (sub.length >= 2) chains.push(sub);
        sub = [chain[i]];
      } else {
        sub.push(chain[i]);
      }
    }
    if (sub.length >= 2) chains.push(sub);
  }
  return chains;
}

// ── Catmull-Rom bezier helpers ────────────────────────────────────────
function cmCP(p0, p1, p2, p3) {
  return {
    cp1x: p1.x + (p2.x - p0.x) / 6, cp1y: p1.y + (p2.y - p0.y) / 6,
    cp2x: p2.x - (p3.x - p1.x) / 6, cp2y: p2.y - (p3.y - p1.y) / 6,
  };
}

// Draw smooth closed path on canvas
function drawClosedSmooth(ctx, pts) {
  if (pts.length < 3) return;
  const n = pts.length;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c = cmCP(p0, p1, p2, p3);
    ctx.bezierCurveTo(c.cp1x, c.cp1y, c.cp2x, c.cp2y, p2.x, p2.y);
  }
}

// Draw smooth open path on canvas
function drawOpenSmooth(ctx, pts) {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i];
    const p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c = cmCP(p0, p1, p2, p3);
    ctx.bezierCurveTo(c.cp1x, c.cp1y, c.cp2x, c.cp2y, p2.x, p2.y);
  }
}

// SVG closed path string
function closedSVGPath(pts) {
  if (pts.length < 3) return '';
  const n = pts.length;
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c = cmCP(p0, p1, p2, p3);
    d += ` C ${c.cp1x.toFixed(2)} ${c.cp1y.toFixed(2)}, ${c.cp2x.toFixed(2)} ${c.cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d + ' Z';
}

// SVG ribbon path string from left/right arrays
function ribbonSVGPath(left, right) {
  const rr = right.slice().reverse();
  let d = `M ${left[0].x.toFixed(2)} ${left[0].y.toFixed(2)}`;
  for (let i = 0; i < left.length - 1; i++) {
    const p0 = left[Math.max(0, i - 1)], p1 = left[i], p2 = left[i + 1], p3 = left[Math.min(left.length - 1, i + 2)];
    const c = cmCP(p0, p1, p2, p3);
    d += ` C ${c.cp1x.toFixed(2)} ${c.cp1y.toFixed(2)}, ${c.cp2x.toFixed(2)} ${c.cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  d += ` L ${rr[0].x.toFixed(2)} ${rr[0].y.toFixed(2)}`;
  for (let i = 0; i < rr.length - 1; i++) {
    const p0 = rr[Math.max(0, i - 1)], p1 = rr[i], p2 = rr[i + 1], p3 = rr[Math.min(rr.length - 1, i + 2)];
    const c = cmCP(p0, p1, p2, p3);
    d += ` C ${c.cp1x.toFixed(2)} ${c.cp1y.toFixed(2)}, ${c.cp2x.toFixed(2)} ${c.cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d + ' Z';
}

// ── Compute ribbon geometry ───────────────────────────────────────────
function ribbonGeometry(points, widths) {
  if (points.length < 2) return null;
  const left = [], right = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = widths[i] * 0.5;
    left.push({ x: points[i].x + nx * w, y: points[i].y + ny * w });
    right.push({ x: points[i].x - nx * w, y: points[i].y - ny * w });
  }
  return { left, right };
}

// Continue smooth path on canvas WITHOUT moveTo (appends to current subpath)
function continueOpenSmooth(ctx, pts) {
  if (pts.length < 2) return;
  ctx.lineTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i];
    const p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c = cmCP(p0, p1, p2, p3);
    ctx.bezierCurveTo(c.cp1x, c.cp1y, c.cp2x, c.cp2y, p2.x, p2.y);
  }
}

// Draw ribbon on canvas
function drawRibbonOnCanvas(ctx, ribbon) {
  ctx.beginPath();
  drawOpenSmooth(ctx, ribbon.left);
  continueOpenSmooth(ctx, ribbon.right.slice().reverse());
  ctx.closePath();
  ctx.fill();
}

// ── Compute all scene geometry from params ────────────────────────────
function computeScene(params) {
  const {
    seed, chargeCount, minRadius, maxRadius,
    gridRes, isoLevels, isoSpacing, fillThreshold,
    baseWidth, widthVariation,
    width, height,
  } = params;

  const seedNum = typeof seed === 'number' ? seed : hashString(String(seed));
  const rng = mulberry32(seedNum);
  const scatterSeedNum = typeof params.scatterSeed === 'number' ? params.scatterSeed : hashString(String(params.scatterSeed || '0'));
  const density = params.chargeDensity !== undefined ? params.chargeDensity : 50;
  const charges = placeCharges(rng, chargeCount, minRadius, maxRadius, scatterSeedNum, density);
  const aspect = height / width;

  // Evaluate field on grid (normalized space)
  const cols = Math.ceil(width / gridRes) + 1;
  const rows = Math.ceil(height / gridRes) + 1;
  const field = new Float64Array(cols * rows);
  const ndx = 1 / (cols - 1);
  const ndy = aspect / (rows - 1);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      field[j * cols + i] = evalField(i * ndx, j * ndy, charges);
    }
  }

  // ── 1. Fill shapes: closed contours at fillThreshold ────────────────
  const fillSegs = marchingSquares(field, cols, rows, fillThreshold);
  const fillChains = chainSegments(fillSegs, 0.1);
  const fillShapes = fillChains
    .map(chain => chain.map(p => ({ x: (p.x / (cols - 1)) * width, y: (p.y / (rows - 1)) * height })))
    .filter(s => s.length >= 4);

  // ── 2. Contour line ribbons at multiple iso-levels ──────────────────
  const center = fillThreshold;
  const thresholds = [center];
  for (let lv = 1; lv <= Math.floor(isoLevels / 2); lv++) {
    thresholds.push(center + lv * isoSpacing);
    thresholds.push(center - lv * isoSpacing);
  }
  if (isoLevels % 2 === 0 && isoLevels > 1) {
    thresholds.push(center + (Math.floor(isoLevels / 2) + 1) * isoSpacing);
  }
  const validThresholds = thresholds.filter(t => t > 0).slice(0, isoLevels);

  const ribbons = [];
  const normGradStep = ndx;

  for (const threshold of validThresholds) {
    const segs = marchingSquares(field, cols, rows, threshold);
    const chains = chainSegments(segs, 0.1);
    for (const chain of chains) {
      let pts = chain.map(p => ({ x: (p.x / (cols - 1)) * width, y: (p.y / (rows - 1)) * height }));
      if (pts.length < 3) continue;
      if (pts.length > 200) {
        const step = Math.floor(pts.length / 150);
        const sub = [pts[0]];
        for (let i = step; i < pts.length - 1; i += step) sub.push(pts[i]);
        sub.push(pts[pts.length - 1]);
        pts = sub;
      }
      const widths = pts.map(p => {
        const nx = p.x / width, ny = (p.y / height) * aspect;
        const g = gradientMag(nx, ny, charges, normGradStep);
        const gNorm = Math.min(g, 2) / 2;
        return Math.max(0.3, baseWidth + widthVariation * (1 - gNorm));
      });
      const geo = ribbonGeometry(pts, widths);
      if (geo) ribbons.push(geo);
    }
  }

  return { fillShapes, ribbons, charges };
}

// ── Canvas 2D live preview ────────────────────────────────────────────
function renderToCanvas(canvas, params) {
  const { bgColor, fillColor, shadowColor, lightColor,
    shadowOpacity, shadowDepth, shadowBlur,
    lightOpacity, lightOffset,
    width, height } = params;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const scene = computeScene(params);

  // Background (white — the gap channel color)
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  // Shadow outlines layer — offset, under fills
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.translate(shadowDepth, shadowDepth);
  ctx.globalAlpha = shadowOpacity;
  if (shadowBlur > 0) ctx.filter = `blur(${shadowBlur}px)`;
  ctx.fillStyle = shadowColor;
  for (const r of scene.ribbons) drawRibbonOnCanvas(ctx, r);
  ctx.restore();

  // Filled blob shapes
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.globalAlpha = 1;
  ctx.fillStyle = fillColor;
  for (const shape of scene.fillShapes) {
    ctx.beginPath();
    drawClosedSmooth(ctx, shape);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Light contour lines — on top of fills
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.translate(-lightOffset, -lightOffset);
  ctx.globalAlpha = lightOpacity;
  ctx.fillStyle = lightColor;
  for (const r of scene.ribbons) drawRibbonOnCanvas(ctx, r);
  ctx.restore();

}

// ── SVG builders ──────────────────────────────────────────────────────
function svgHead(width, height, shadowBlur) {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  s += `<defs>`;
  if (shadowBlur > 0) {
    s += `<filter id="sBlur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${shadowBlur}"/></filter>`;
  }
  s += `<clipPath id="canvas"><rect width="${width}" height="${height}"/></clipPath>`;
  s += `</defs>`;
  return s;
}

function generateSVG(params) {
  const scene = computeScene(params);
  const { bgColor, fillColor, shadowColor, lightColor,
    shadowOpacity, shadowDepth, shadowBlur,
    lightOpacity, lightOffset, width, height } = params;

  let svg = svgHead(width, height, shadowBlur);
  svg += `<rect width="${width}" height="${height}" fill="${bgColor}"/>`;

  // Shadow ribbons
  const sFilter = shadowBlur > 0 ? ' filter="url(#sBlur)"' : '';
  svg += `<g clip-path="url(#canvas)" fill="${shadowColor}" opacity="${shadowOpacity}" transform="translate(${shadowDepth},${shadowDepth})"${sFilter}>`;
  for (const r of scene.ribbons) svg += `<path d="${ribbonSVGPath(r.left, r.right)}"/>`;
  svg += `</g>`;

  // Filled shapes
  svg += `<g clip-path="url(#canvas)" fill="${fillColor}">`;
  for (const shape of scene.fillShapes) svg += `<path d="${closedSVGPath(shape)}"/>`;
  svg += `</g>`;

  // Light ribbons
  svg += `<g clip-path="url(#canvas)" fill="${lightColor}" opacity="${lightOpacity}" transform="translate(${-lightOffset},${-lightOffset})">`;
  for (const r of scene.ribbons) svg += `<path d="${ribbonSVGPath(r.left, r.right)}"/>`;
  svg += `</g>`;

  svg += `</svg>`;
  return svg;
}

function generateLayerSVG(params, layer) {
  const scene = computeScene(params);
  const { shadowBlur, shadowDepth, lightOffset, width, height } = params;

  let svg = svgHead(width, height, shadowBlur);
  svg += `<rect width="${width}" height="${height}" fill="white"/>`;

  if (layer === 'shadow') {
    const sFilter = shadowBlur > 0 ? ' filter="url(#sBlur)"' : '';
    svg += `<g clip-path="url(#canvas)" fill="#000" transform="translate(${shadowDepth},${shadowDepth})"${sFilter}>`;
    for (const r of scene.ribbons) svg += `<path d="${ribbonSVGPath(r.left, r.right)}"/>`;
    svg += `</g>`;
  } else if (layer === 'light') {
    svg += `<g clip-path="url(#canvas)" fill="#000" transform="translate(${-lightOffset},${-lightOffset})">`;
    for (const r of scene.ribbons) svg += `<path d="${ribbonSVGPath(r.left, r.right)}"/>`;
    svg += `</g>`;
  } else if (layer === 'fill') {
    svg += `<g clip-path="url(#canvas)" fill="#000">`;
    for (const shape of scene.fillShapes) svg += `<path d="${closedSVGPath(shape)}"/>`;
    svg += `</g>`;
  }

  svg += `</svg>`;
  return svg;
}

// ── UI Wiring ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function readParams() {
  return {
    seed: $('seed').value,
    chargeCount: +$('chargeCount').value,
    chargeDensity: +$('chargeDensity').value,
    scatterSeed: $('scatterSeed').value,
    minRadius: +$('minRadius').value,
    maxRadius: +$('maxRadius').value,
    gridRes: +$('gridRes').value,
    isoLevels: +$('isoLevels').value,
    isoSpacing: +$('isoSpacing').value / 100,
    fillThreshold: +$('fillThreshold').value / 100,
    bgColor: $('bgColor').value,
    fillColor: $('fillColor').value,
    shadowColor: $('shadowColor').value,
    lightColor: $('lightColor').value,
    shadowDepth: +$('shadowDepth').value,
    shadowBlur: +$('shadowBlur').value,
    shadowOpacity: +$('shadowOpacity').value / 100,
    lightOffset: +$('lightOffset').value,
    lightOpacity: +$('lightOpacity').value / 100,
    baseWidth: +$('baseWidth').value,
    widthVariation: +$('widthVariation').value,
    width: Math.max(400, Math.min(3000, +$('canvasWidth').value || 800)),
    height: Math.max(400, Math.min(2000, +$('canvasHeight').value || 600)),
  };
}

function updateValueDisplays() {
  $('chargeCountVal').textContent = $('chargeCount').value;
  $('chargeDensityVal').textContent = $('chargeDensity').value + '%';
  $('minRadiusVal').textContent = $('minRadius').value + 'px';
  $('maxRadiusVal').textContent = $('maxRadius').value + 'px';
  $('gridResVal').textContent = $('gridRes').value + 'px';
  $('isoLevelsVal').textContent = $('isoLevels').value;
  $('isoSpacingVal').textContent = (+$('isoSpacing').value / 100).toFixed(2);
  $('fillThresholdVal').textContent = (+$('fillThreshold').value / 100).toFixed(2);
  $('shadowDepthVal').textContent = $('shadowDepth').value + 'px';
  $('shadowBlurVal').textContent = $('shadowBlur').value + 'px';
  $('shadowOpacityVal').textContent = $('shadowOpacity').value + '%';
  $('lightOffsetVal').textContent = $('lightOffset').value + 'px';
  $('lightOpacityVal').textContent = $('lightOpacity').value + '%';
  $('baseWidthVal').textContent = $('baseWidth').value + 'px';
  $('widthVariationVal').textContent = $('widthVariation').value + 'px';
}

let renderQueued = false;

function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    updateValueDisplays();
    const params = readParams();
    let canvas = $('previewCanvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'previewCanvas';
      $('preview').innerHTML = '';
      $('preview').appendChild(canvas);
    }
    renderToCanvas(canvas, params);
  });
}

document.querySelectorAll('.sidebar input').forEach(el => {
  el.addEventListener('input', render);
  el.addEventListener('change', render);
});

$('randomize').addEventListener('click', () => {
  $('seed').value = Math.floor(Math.random() * 999999);
  render();
});

$('rescatter').addEventListener('click', () => {
  $('scatterSeed').value = Math.floor(Math.random() * 999999);
  render();
});

function randBetween(min, max) { return min + Math.random() * (max - min); }

$('randomizeAll').addEventListener('click', () => {
  $('seed').value = Math.floor(Math.random() * 999999);
  $('scatterSeed').value = Math.floor(Math.random() * 999999);
  $('chargeCount').value = Math.round(randBetween(10, 40));
  $('chargeDensity').value = Math.round(randBetween(20, 90));
  const minR = Math.round(randBetween(30, 80));
  $('minRadius').value = minR;
  $('maxRadius').value = Math.round(randBetween(minR + 20, Math.min(minR + 120, 300)));
  $('gridRes').value = Math.round(randBetween(4, 10));
  $('isoLevels').value = Math.round(randBetween(2, 6));
  $('isoSpacing').value = Math.round(randBetween(10, 50));
  $('fillThreshold').value = Math.round(randBetween(50, 100));
  $('baseWidth').value = randBetween(0.8, 3.5).toFixed(1);
  $('widthVariation').value = randBetween(1, 7).toFixed(1);
  $('shadowDepth').value = randBetween(1, 6).toFixed(1);
  $('lightOffset').value = randBetween(0.5, 4).toFixed(1);
  render();
});

function downloadSVG(svgContent, filename) {
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadPNG(svgContent, filename, w, h) {
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0);
    c.toBlob(pb => {
      const u = URL.createObjectURL(pb);
      const a = document.createElement('a');
      a.href = u; a.download = filename; a.click();
      URL.revokeObjectURL(u);
    }, 'image/png');
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

$('exportSVG').addEventListener('click', () => { const p = readParams(); downloadSVG(generateSVG(p), `stencil-${p.seed}-combined.svg`); });
$('exportPNG').addEventListener('click', () => { const p = readParams(); downloadPNG(generateSVG(p), `stencil-${p.seed}-combined.png`, p.width, p.height); });
$('exportShadowSVG').addEventListener('click', () => { const p = readParams(); downloadSVG(generateLayerSVG(p, 'shadow'), `stencil-${p.seed}-shadow.svg`); });
$('exportShadowPNG').addEventListener('click', () => { const p = readParams(); downloadPNG(generateLayerSVG(p, 'shadow'), `stencil-${p.seed}-shadow.png`, p.width, p.height); });
$('exportLightSVG').addEventListener('click', () => { const p = readParams(); downloadSVG(generateLayerSVG(p, 'light'), `stencil-${p.seed}-light.svg`); });
$('exportLightPNG').addEventListener('click', () => { const p = readParams(); downloadPNG(generateLayerSVG(p, 'light'), `stencil-${p.seed}-light.png`, p.width, p.height); });
$('exportFillSVG').addEventListener('click', () => { const p = readParams(); downloadSVG(generateLayerSVG(p, 'fill'), `stencil-${p.seed}-fill.svg`); });
$('exportFillPNG').addEventListener('click', () => { const p = readParams(); downloadPNG(generateLayerSVG(p, 'fill'), `stencil-${p.seed}-fill.png`, p.width, p.height); });

updateValueDisplays();
render();
