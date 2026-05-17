// Headless sanity check for the polygon snap pipeline.
//
// Re-implements snapToNearestLine + snapToNearestCorner +
// isLikelyIntersection from lib/lineSnap.ts (browser-only imports), then
// builds a synthetic "house" mask (two perpendicular lines meeting at a
// corner) and asserts that clicks land where we expect.

function isLikelyIntersection(x, y, lm) {
  const { width: w, height: h, mask } = lm;
  if (x <= 0 || x >= w - 1 || y <= 0 || y >= h - 1) return false;
  let n = 0;
  let sumDx = 0;
  let sumDy = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (mask[(y + dy) * w + (x + dx)]) {
        n++;
        sumDx += dx;
        sumDy += dy;
      }
    }
  }
  if (n === 0) return false;
  if (n === 1) return true;
  if (n === 2) return !(sumDx === 0 && sumDy === 0);
  return true;
}

function snapToNearestLine(point, lm, r) {
  const { width: w, height: h, mask } = lm;
  const cx = Math.round(point.x);
  const cy = Math.round(point.y);
  if (cx >= 0 && cx < w && cy >= 0 && cy < h && mask[cy * w + cx]) {
    return { x: cx, y: cy };
  }
  let bestDist2 = Infinity;
  let bestX = -1;
  let bestY = -1;
  let foundShellRadius = -1;
  for (let shell = 1; shell <= r; shell++) {
    if (foundShellRadius > 0 && shell > foundShellRadius * Math.SQRT2 + 1)
      break;
    const x0 = Math.max(0, cx - shell);
    const x1 = Math.min(w - 1, cx + shell);
    for (const y of [cy - shell, cy + shell]) {
      if (y < 0 || y >= h) continue;
      for (let x = x0; x <= x1; x++) {
        if (mask[y * w + x]) {
          const d2 = (x - cx) ** 2 + (y - cy) ** 2;
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestX = x;
            bestY = y;
            if (foundShellRadius < 0) foundShellRadius = shell;
          }
        }
      }
    }
    const y0 = Math.max(0, cy - shell);
    const y1 = Math.min(h - 1, cy + shell);
    for (const x of [cx - shell, cx + shell]) {
      if (x < 0 || x >= w) continue;
      for (let y = y0 + 1; y <= y1 - 1; y++) {
        if (mask[y * w + x]) {
          const d2 = (x - cx) ** 2 + (y - cy) ** 2;
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestX = x;
            bestY = y;
            if (foundShellRadius < 0) foundShellRadius = shell;
          }
        }
      }
    }
  }
  return bestX < 0 ? null : { x: bestX, y: bestY };
}

function snapToNearestCorner(point, lm, r) {
  const { width: w, height: h, mask } = lm;
  const cx = Math.round(point.x);
  const cy = Math.round(point.y);
  if (
    cx >= 1 &&
    cx < w - 1 &&
    cy >= 1 &&
    cy < h - 1 &&
    mask[cy * w + cx] &&
    isLikelyIntersection(cx, cy, lm)
  ) {
    return { x: cx, y: cy };
  }
  let bestDist2 = Infinity;
  let bestX = -1;
  let bestY = -1;
  let foundShellRadius = -1;
  for (let shell = 1; shell <= r; shell++) {
    if (foundShellRadius > 0 && shell > foundShellRadius * Math.SQRT2 + 1)
      break;
    const x0 = Math.max(1, cx - shell);
    const x1 = Math.min(w - 2, cx + shell);
    const check = (x, y) => {
      if (!mask[y * w + x]) return;
      if (!isLikelyIntersection(x, y, lm)) return;
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestX = x;
        bestY = y;
        if (foundShellRadius < 0) foundShellRadius = shell;
      }
    };
    for (const y of [cy - shell, cy + shell]) {
      if (y < 1 || y > h - 2) continue;
      for (let x = x0; x <= x1; x++) check(x, y);
    }
    const y0 = Math.max(1, cy - shell);
    const y1 = Math.min(h - 2, cy + shell);
    for (const x of [cx - shell, cx + shell]) {
      if (x < 1 || x > w - 2) continue;
      for (let y = y0 + 1; y <= y1 - 1; y++) check(x, y);
    }
  }
  return bestX < 0 ? null : { x: bestX, y: bestY };
}

// Build a 200×200 mask with two perpendicular line segments meeting
// at (100, 100) — a synthetic house corner.
const W = 200;
const H = 200;
const mask = new Uint8Array(W * H);

// Vertical line x=100, y∈[40..100]
for (let y = 40; y <= 100; y++) mask[y * W + 100] = 1;
// Horizontal line y=100, x∈[100..160]
for (let x = 100; x <= 160; x++) mask[100 * W + x] = 1;

const lm = { width: W, height: H, mask };

let pass = 0;
let fail = 0;
function check(name, ok, info) {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${info ? "  " + info : ""}`);
  if (ok) pass++;
  else fail++;
}

// 1) Click directly on the line → returns same point
{
  const p = snapToNearestLine({ x: 100, y: 70 }, lm, 30);
  check(
    "exact-on-line returns same pixel",
    !!p && p.x === 100 && p.y === 70,
    JSON.stringify(p),
  );
}

// 2) Click 10 px to the right of the vertical line, well below the
//    corner → should snap to (100, y)
{
  const p = snapToNearestLine({ x: 110, y: 70 }, lm, 30);
  check(
    "snap right of vertical line → x=100",
    !!p && p.x === 100 && p.y === 70,
    JSON.stringify(p),
  );
}

// 3) Click on a "corner-ish" location near (100,100): test
//    isLikelyIntersection at the corner itself.
{
  const isCorner = isLikelyIntersection(100, 100, lm);
  check("(100,100) reports as corner/intersection", isCorner);
}

// 4) Click 15 px away from the corner along a diagonal, with a wide
//    corner radius — should snap to within 2px of the real corner.
//    (Exact pixel may be (100,100), (101,100) or (100,99) because the
//    junction's morphological neighbourhood spans those three pixels;
//    all three are equally valid corner targets.)
{
  const c = snapToNearestCorner({ x: 115, y: 85 }, lm, 30);
  check(
    "corner snap lands ≤2px from (100,100)",
    !!c && Math.abs(c.x - 100) <= 2 && Math.abs(c.y - 100) <= 2,
    JSON.stringify(c),
  );
}

// 5) Click on an empty area very far from any line — should return
//    null (not snap to anything outside its radius).
{
  const p = snapToNearestLine({ x: 10, y: 10 }, lm, 20);
  check("far-from-line returns null", p === null, JSON.stringify(p));
}

// 6) Two-stage simulation: corner-first, then line fallback. Mimics
//    PolygonSelect.resolveSnap.
function resolveSnap(raw, cornerR, lineR) {
  const c = snapToNearestCorner(raw, lm, cornerR);
  if (c) return { kind: "corner", snapped: c };
  const l = snapToNearestLine(raw, lm, lineR);
  if (l) return { kind: "line", snapped: l };
  return { kind: null, snapped: null };
}

{
  // Diagonal of synthetic image = sqrt(200²+200²) ≈ 282
  // CORNER_SNAP_RADIUS_FRACTION = 0.12 → ~34px
  // LINE_SNAP_RADIUS_FRACTION   = 0.05 → ~14px
  const diag = Math.hypot(W, H);
  const cornerR = diag * 0.12;
  const lineR = diag * 0.05;

  // 6a) Click ~7 px off the corner → expect corner snap within 2px
  const r1 = resolveSnap({ x: 95, y: 95 }, cornerR, lineR);
  check(
    "two-stage ~7px off corner → corner ≤2px",
    r1.kind === "corner" &&
      r1.snapped &&
      Math.abs(r1.snapped.x - 100) <= 2 &&
      Math.abs(r1.snapped.y - 100) <= 2,
    `${r1.kind} ${JSON.stringify(r1.snapped)}`,
  );

  // 6b) Click halfway down the horizontal line, well past the corner
  //     and the endpoint — should fall back to plain line snap.
  //     Distance from (130, 87) to (100,100) is √(30²+13²) ≈ 32.7,
  //     just under cornerR (~34), so we deliberately pick (130, 93)
  //     which is further from the corner but right above the line.
  //     d(130,93 -> 100,100) ≈ √(900+49) = 30.8 < 34 → still corner.
  //     The line is at y=100, x=[100..160]. Mid-segment pixels lie on
  //     the line; endpoint (160,100) is treated as a corner.
  //     Pick (130, 85) which is 15px above mid-segment: line snap
  //     finds (130,100), distance 15 ≈ lineR(14). Border case — use
  //     (130, 88) instead: d to (130,100)=12 < lineR, d to corners
  //     (100,100)=√(900+144)=32.3 < cornerR. Tighten further: pick
  //     (140, 90). d to (100,100)=√(1600+100)=41.2 > cornerR. d to
  //     (160,100)=√(400+100)=22.4 < cornerR. Still corner.
  //     Going to (135, 92): d(135,92→100,100)=√(1225+64)=35.9 > 34;
  //     d(135,92→160,100)=√(625+64)=26.2 < 34 — still corner via
  //     endpoint! This shows the design intent: endpoints ARE valid
  //     corner targets, so the line-only fallback is rarely hit on
  //     finite line segments. Verify the corner path instead.
  const r2 = resolveSnap({ x: 130, y: 95 }, cornerR, lineR);
  check(
    "two-stage near horizontal line → snap (corner or line, on line)",
    r2.snapped !== null &&
      Math.abs(r2.snapped.y - 100) <= 2 &&
      r2.snapped.x >= 100 &&
      r2.snapped.x <= 160,
    `${r2.kind} ${JSON.stringify(r2.snapped)}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
