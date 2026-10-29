// Farm-name sign texture (CONTRACT_V25 §4): a wooden plank drawn on a canvas, text auto-shrunk to fit 1-2 lines.
// Without a DOM canvas (test env) it returns a 1x1 DataTexture and never throws.

const FALLBACK_FONT = 'Mali, sans-serif';

function gameFont() {
  try {
    const f = getComputedStyle(document.body).fontFamily;
    return f && f.trim() ? f : FALLBACK_FONT;
  } catch { return FALLBACK_FONT; }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Biggest font size (<= maxPx) at which `text` fits; wraps at spaces into at most 2 lines. */
function layout(ctx, text, family, maxW, maxH) {
  const words = text.split(/\s+/).filter(Boolean);
  const font = px => `bold ${px}px ${family}`;
  for (let px = Math.min(96, maxH); px >= 14; px -= 2) {
    ctx.font = font(px);
    if (ctx.measureText(words.join(' ')).width <= maxW) return { px, lines: [words.join(' ')] };
    if (words.length > 1 && px * 2.1 <= maxH) {
      let best = null;
      for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
        const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
        if (w <= maxW && (!best || w < best.w)) best = { w, lines: [a, b] };
      }
      if (best) return { px, lines: best.lines };
    }
  }
  return { px: 14, lines: [words.join(' ')] };
}

function draw(canvas, text, width, height, fg, bg) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  // plank
  roundRect(ctx, 3, 3, width - 6, height - 6, 22);
  ctx.fillStyle = bg;
  ctx.fill();
  // faint grain
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(90,58,30,0.07)';
  ctx.lineWidth = 2;
  for (let y = 18; y < height; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(width * 0.3, y - 5, width * 0.6, y + 6, width, y - 2);
    ctx.stroke();
  }
  ctx.restore();
  // border
  roundRect(ctx, 3, 3, width - 6, height - 6, 22);
  ctx.strokeStyle = 'rgba(90,58,30,0.55)';
  ctx.lineWidth = 6;
  ctx.stroke();
  // nails
  ctx.fillStyle = 'rgba(70,45,25,0.8)';
  for (const nx of [20, width - 20]) {
    ctx.beginPath();
    ctx.arc(nx, height / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // text
  const clean = String(text == null ? '' : text).trim();
  if (!clean) return;
  const family = gameFont();
  const { px, lines } = layout(ctx, clean, family, width - 90, height - 36);
  ctx.font = `bold ${px}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  const lh = px * 1.15, y0 = height / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((l, i) => ctx.fillText(l, width / 2, y0 + i * lh));
}

export function makeSignTexture(THREE, text, { width = 512, height = 160, fg = '#5a3a1e', bg = '#f3dfb8' } = {}) {
  let canvas = null;
  try {
    if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      if (!canvas.getContext || !canvas.getContext('2d')) canvas = null;
    }
  } catch { canvas = null; }

  if (!canvas) {
    const texture = new THREE.DataTexture(new Uint8Array([243, 223, 184, 255]), 1, 1);
    texture.needsUpdate = true;
    return { texture, setText() { texture.needsUpdate = true; }, dispose() { texture.dispose(); } };
  }

  let current = text;
  let disposed = false;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const redraw = () => {
    try { draw(canvas, current, width, height, fg, bg); } catch { /* keep the previous drawing */ }
    texture.needsUpdate = true;
  };
  redraw();
  try {
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) redraw(); }).catch(() => {});
  } catch { /* no font API */ }

  return {
    texture,
    setText(t) { current = t; redraw(); },
    dispose() { disposed = true; texture.dispose(); },
  };
}
