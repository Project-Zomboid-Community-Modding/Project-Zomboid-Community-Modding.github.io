
function parseMarkup(str) {
  const chunks = str.split('<').filter(s => s.length > 0);
  let canvas = { width: 1240, height: 1754 };
  const elements = [];
  for (const chunk of chunks) {
    const gtIdx = chunk.indexOf('>');
    if (gtIdx === -1) continue;
    const paramsStr = chunk.slice(0, gtIdx);
    const content = chunk.slice(gtIdx + 1);
    const params = {};
    for (const rawPair of paramsStr.split(',')) {
      const colonIdx = rawPair.indexOf(':');
      if (colonIdx === -1) continue;
      const key = rawPair.slice(0, colonIdx).trim();
      let value = rawPair.slice(colonIdx + 1).trim();
      params[key] = value;
    }
    if (params.type === 'parent') {
      canvas.width = parseFloat(params.width) || 1240;
      canvas.height = parseFloat(params.height) || 1754;
    } else if (params.type === 'texture') {
      elements.push({
        type: 'texture',
        x: numOr(params.x, 0), y: numOr(params.y, 0),
        width: numOr(params.width, 200), height: numOr(params.height, 200),
        pivotX: numOr(params.pivotX, 0), pivotY: numOr(params.pivotY, 0),
        scaleX: numOr(params.scaleX, 1), scaleY: numOr(params.scaleY, 1),
        angle: numOr(params.angle, 0),
        r: numOr(params.r, 1), g: numOr(params.g, 1), b: numOr(params.b, 1), a: numOr(params.a, 1),
        texturePath: stripQuotes(params.texture) || '',
        img: null
      });
    } else if (params.type === 'text') {
      elements.push({
        type: 'text',
        x: numOr(params.x, 0), y: numOr(params.y, 0),
        pivotX: numOr(params.pivotX, 0), pivotY: numOr(params.pivotY, 0),
        scaleX: numOr(params.scaleX, 1), scaleY: numOr(params.scaleY, 1),
        r: numOr(params.r, 0), g: numOr(params.g, 0), b: numOr(params.b, 0), a: numOr(params.a, 1),
        textLeading: numOr(params.textLeading, 0),
        font: params.font || 'SdfRegular',
        autoWidth: params.autoWidth !== undefined ? numOr(params.autoWidth, 0) : null,
        text: content
      });
    }
  }
  return { canvas, elements };
}

function numOr(v, fallback) {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}
function stripQuotes(v) {
  if (!v) return v;
  return v.replace(/^"(.*)"$/, '$1');
}
function fmtNum(n) {
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return String(Math.round(n * 10000) / 10000);
}

function serializeMarkup(canvas, elements) {
  let s = `<type:parent, width:${fmtNum(canvas.width)}, height:${fmtNum(canvas.height)}>`;
  for (const el of elements) {
    if (el.type === 'texture') {
      const parts = ['type:texture'];
      if (el.texturePath) parts.push(`texture:${el.texturePath}`);
      parts.push(`x:${fmtNum(el.x)}`, `y:${fmtNum(el.y)}`, `width:${fmtNum(el.width)}`, `height:${fmtNum(el.height)}`);
      parts.push(`pivotX:${fmtNum(el.pivotX)}`, `pivotY:${fmtNum(el.pivotY)}`);
      if (el.scaleX !== 1) parts.push(`scaleX:${fmtNum(el.scaleX)}`);
      if (el.scaleY !== 1) parts.push(`scaleY:${fmtNum(el.scaleY)}`);
      if (el.angle) parts.push(`angle:${fmtNum(el.angle)}`);
      parts.push(`r:${fmtNum(el.r)}`, `g:${fmtNum(el.g)}`, `b:${fmtNum(el.b)}`, `a:${fmtNum(el.a)}`);
      s += `<${parts.join(', ')}>`;
    } else if (el.type === 'text') {
      const parts = ['type:text', `x:${fmtNum(el.x)}`, `y:${fmtNum(el.y)}`,
        `r:${fmtNum(el.r)}`, `g:${fmtNum(el.g)}`, `b:${fmtNum(el.b)}`, `a:${fmtNum(el.a)}`,
        `pivotX:${fmtNum(el.pivotX)}`, `pivotY:${fmtNum(el.pivotY)}`,
        `scaleX:${fmtNum(el.scaleX)}`, `scaleY:${fmtNum(el.scaleY)}`,
        `textLeading:${fmtNum(el.textLeading)}`, `font:${el.font}`];
      if (el.autoWidth) parts.push(`autoWidth:${fmtNum(el.autoWidth)}`);
      s += `<${parts.join(', ')}>${el.text}`;
    }
  }
  return s;
}


let canvasSize = { width: 1240, height: 1754 };
let elements = [];
let selected = -1;
let textureFileMap = new Map();
let folderPresets = {};
let currentPresetKey = '';
let currentPresetSourceLabel = '';

let historyStack = [];
let historyIndex = -1;
let suppressHistory = false;
const MAX_HISTORY = 100;

function snapshotState() {
  return JSON.stringify({
    canvasSize,
    elements: elements.map(({ img, ...rest }) => rest),
    selected,
  });
}

function pushHistory() {
  if (suppressHistory) return;
  const snap = snapshotState();
  if (historyStack[historyIndex] === snap) return;
  historyStack = historyStack.slice(0, historyIndex + 1);
  historyStack.push(snap);
  historyIndex = historyStack.length - 1;
  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift();
    historyIndex--;
  }
}

function restoreSnapshot(snap) {
  const data = JSON.parse(snap);
  canvasSize = data.canvasSize;
  elements = data.elements.map(el => ({ ...el, img: null }));
  selected = Math.min(data.selected, elements.length - 1);
  resolveAllTextures();
  refreshAll();
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  suppressHistory = true;
  restoreSnapshot(historyStack[historyIndex]);
  suppressHistory = false;
}

function redo() {
  if (historyIndex >= historyStack.length - 1) return;
  historyIndex++;
  suppressHistory = true;
  restoreSnapshot(historyStack[historyIndex]);
  suppressHistory = false;
}

window.addEventListener('keydown', (e) => {
  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
  if (!isCtrlOrCmd) return;
  const key = e.key.toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  } else if (key === 'y') {
    e.preventDefault();
    redo();
  }
});

document.addEventListener('blur', (e) => {
  const t = e.target;
  if (!t.tagName) return;
  if ((t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
      && (document.getElementById('propsPanel').contains(t) || document.querySelector('.general-settings').contains(t))) {
    pushHistory();
  }
}, true);


let loadedFonts = {};

const stage = document.getElementById('stage');
const ctx = stage.getContext('2d');

function fontCss(fontName, px) {
  const map = {
    'SdfOldBold': `bold ${px}px ${'Georgia, serif'}`,
    'SdfOldRegular': `${px}px Georgia, serif`,
    'SdfOldBoldItalic': `italic bold ${px}px Georgia, serif`,
    'SdfRegular': `${px}px Arial, sans-serif`,
    'SdfBold': `bold ${px}px Arial, sans-serif`,
  };
  return map[fontName] || `${px}px Georgia, serif`;
}

function colorCss(r, g, b, a) {
  return `rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${a})`;
}

let FONT_SIZE_CONSTANT = 40;
let LINE_SPACING_MULT = 1.35;

function render() {
  stage.width = canvasSize.width;
  stage.height = canvasSize.height;
  document.getElementById('canvasHint').textContent = `${Math.round(canvasSize.width)} × ${Math.round(canvasSize.height)}`;

  const area = document.querySelector('.canvas-area');
  const maxW = area.clientWidth - 60;
  const maxH = area.clientHeight - 60;
  const scale = Math.min(maxW / canvasSize.width, maxH / canvasSize.height, 1);
  stage.style.width = (canvasSize.width * scale) + 'px';
  stage.style.height = (canvasSize.height * scale) + 'px';

  ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
  ctx.fillStyle = '#f4f2ee';
  ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

  elements.forEach((el, i) => {
    if (el.hidden) return;
    if (el.type === 'texture') drawTexture(el);
    else if (el.type === 'text') drawText(el);
  });

  if (selected >= 0 && elements[selected]) {
    const el = elements[selected];
    const box = getBounds(el);
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = Math.max(5, canvasSize.width / 160);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.lineWidth = Math.max(2.5, canvasSize.width / 340);
    ctx.strokeStyle = '#8fe0ac';
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();

    if (el.type === 'texture') {
      const hs = getHandleSize();
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(box.x + box.w - hs/2 - 2, box.y + box.h - hs/2 - 2, hs + 4, hs + 4);
      ctx.fillStyle = '#8fe0ac';
      ctx.fillRect(box.x + box.w - hs/2, box.y + box.h - hs/2, hs, hs);
      ctx.restore();
    }
  }
}

function getHandleSize() {
  return Math.max(14, canvasSize.width / 60);
}

function drawTexture(el) {
  const angleRad = -(el.angle || 0) * Math.PI / 180;
  ctx.save();
  ctx.translate(el.x, el.y);
  ctx.rotate(angleRad);
  ctx.scale(el.scaleX, el.scaleY);
  const dx = -el.pivotX * el.width;
  const dy = -el.pivotY * el.height;
  if (el.img) {
    ctx.globalAlpha = el.a;
    ctx.drawImage(el.img, dx, dy, el.width, el.height);
  } else {
    ctx.fillStyle = colorCss(el.r, el.g, el.b, el.a);
    ctx.fillRect(dx, dy, el.width, el.height);
    ctx.strokeStyle = 'rgba(150,150,150,0.6)';
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(dx, dy, el.width, el.height);
  }
  ctx.restore();
}

function drawText(el) {
  const fontData = loadedFonts[(el.font || '').toLowerCase()];
  if (fontData) {
    drawTextReal(el, fontData);
  } else {
    drawTextApprox(el);
  }
}

function wrapParagraph(para, measureFn, maxWidth) {
  const lines = [];
  let current = '';
  let currentWidth = 0;
  let i = 0;
  while (i < para.length) {
    let wordEnd = i;
    while (wordEnd < para.length && para[wordEnd] !== ' ') wordEnd++;
    const word = para.slice(i, wordEnd);
    let spaceEnd = wordEnd;
    while (spaceEnd < para.length && para[spaceEnd] === ' ') spaceEnd++;
    const trailingSpaces = spaceEnd - wordEnd;

    if (word.length > 0) {
      const wordWidth = measureFn(word);
      if (currentWidth + wordWidth > maxWidth && current.trim() !== '') {
        lines.push(current);
        current = '';
        currentWidth = 0;
      }
      current += word;
      currentWidth += wordWidth;
    }

    for (let s = 0; s < trailingSpaces; s++) {
      const spWidth = measureFn(' ');
      if (currentWidth + spWidth > maxWidth) {
        lines.push(current);
        current = '';
        currentWidth = 0;
      } else {
        current += ' ';
        currentWidth += spWidth;
      }
    }
    i = spaceEnd;
  }
  lines.push(current);
  return lines;
}

function measureRealText(text, fontData, scale) {
  let width = 0;
  let prevCode = null;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const glyph = fontData.chars.get(code) || fontData.chars.get(63);
    if (!glyph) continue;
    if (prevCode !== null) {
      const k = fontData.kernings.get(prevCode + ',' + code);
      if (k) width += k * scale;
    }
    width += glyph.xadvance * scale;
    prevCode = code;
  }
  return width;
}

function drawTextReal(el, fontData) {
  const scale = el.scaleY;
  const stretchX = el.scaleX / el.scaleY;
  const maxWidthUnscaled = el.autoWidth ? el.autoWidth * scale : Infinity;
  const realLineStep = fontData.lineHeight * scale + el.textLeading;

  const paragraphs = el.text.split('^');
  let lineObjs = [];
  for (const para of paragraphs) {
    if (para === '') { lineObjs.push({ text: '', justify: false }); continue; }
    const wrapped = wrapParagraph(para, t => measureRealText(t, fontData, scale), maxWidthUnscaled);
    wrapped.forEach((text, idx) => {
      lineObjs.push({ text, justify: el.autoWidth != null && idx < wrapped.length - 1 });
    });
  }

  let unscaledWidth = 0;
  lineObjs.forEach(l => {
    const w = l.justify ? maxWidthUnscaled : measureRealText(l.text, fontData, scale);
    unscaledWidth = Math.max(unscaledWidth, w);
  });
  const unscaledHeight = (lineObjs.length - 1) * realLineStep + fontData.lineHeight * scale;
  const blockWidth = unscaledWidth * stretchX;
  const blockHeight = unscaledHeight;
  el._lastBlockWidth = blockWidth;
  el._lastBlockHeight = blockHeight;
  if (unscaledWidth <= 0 || unscaledHeight <= 0) return;

  const mask = document.createElement('canvas');
  mask.width = Math.max(1, Math.ceil(unscaledWidth));
  mask.height = Math.max(1, Math.ceil(unscaledHeight));
  const mctx = mask.getContext('2d');

  lineObjs.forEach((lineObj, li) => {
    const line = lineObj.text;
    let penX = 0;
    let prevCode = null;
    const origin = li * realLineStep;

    let extraPerInteriorSpace = 0;
    if (lineObj.justify) {
      const natural = measureRealText(line, fontData, scale);
      const diff = maxWidthUnscaled - natural;
      let spaceCount = 0, seenNonSpace = false, interiorSpaces = 0;
      for (const ch of line) {
        if (ch === ' ') { if (seenNonSpace) interiorSpaces++; spaceCount++; }
        else seenNonSpace = true;
      }
      if (interiorSpaces > 0) extraPerInteriorSpace = diff / interiorSpaces;
    }

    let seenNonSpaceForDraw = false;
    for (const ch of line) {
      const code = ch.codePointAt(0);
      const glyph = fontData.chars.get(code) || fontData.chars.get(63);
      if (!glyph) continue;
      if (prevCode !== null) {
        const k = fontData.kernings.get(prevCode + ',' + code);
        if (k) penX += k * scale;
      }
      if (glyph.width > 0 && fontData.pageCanvases[glyph.page]) {
        mctx.drawImage(fontData.pageCanvases[glyph.page], glyph.x, glyph.y, glyph.width, glyph.height,
          penX + glyph.xoffset * scale, origin + glyph.yoffset * scale, glyph.width * scale, glyph.height * scale);
      }
      penX += glyph.xadvance * scale;
      if (ch === ' ') {
        if (seenNonSpaceForDraw) penX += extraPerInteriorSpace;
      } else {
        seenNonSpaceForDraw = true;
      }
      prevCode = code;
    }
  });

  mctx.globalCompositeOperation = 'source-in';
  mctx.fillStyle = colorCss(el.r, el.g, el.b, el.a);
  mctx.fillRect(0, 0, mask.width, mask.height);

  const dx = el.x - el.pivotX * blockWidth;
  const dy = el.y - el.pivotY * blockHeight;
  ctx.drawImage(mask, dx, dy, blockWidth, blockHeight);
}


function drawTextApprox(el) {
  const px = el.scaleY * FONT_SIZE_CONSTANT;
  const stretchX = el.scaleX / el.scaleY;
  ctx.font = fontCss(el.font, px);
  ctx.fillStyle = colorCss(el.r, el.g, el.b, el.a);
  ctx.textBaseline = 'alphabetic';

  const maxWidthUnscaled = el.autoWidth ? el.autoWidth * el.scaleY : Infinity;

  const paragraphs = el.text.split('^');
  let lineObjs = [];
  for (const para of paragraphs) {
    if (para === '') { lineObjs.push({ text: '', justify: false }); continue; }
    const wrapped = wrapParagraph(para, t => ctx.measureText(t).width, maxWidthUnscaled);
    wrapped.forEach((text, idx) => {
      lineObjs.push({ text, justify: el.autoWidth != null && idx < wrapped.length - 1 });
    });
  }

  const lineHeight = px * LINE_SPACING_MULT + el.textLeading;
  let unscaledWidth = 0;
  lineObjs.forEach(l => {
    const w = l.justify ? maxWidthUnscaled : ctx.measureText(l.text).width;
    unscaledWidth = Math.max(unscaledWidth, w);
  });
  const blockWidth = unscaledWidth * stretchX;
  const blockHeight = lineObjs.length * lineHeight + px * 0.2;

  const dx = el.x - el.pivotX * blockWidth;
  const dy = el.y - el.pivotY * blockHeight;

  lineObjs.forEach((lineObj, i) => {
    const line = lineObj.text;
    ctx.save();
    ctx.translate(dx, dy + i * lineHeight + px * 0.85);
    ctx.scale(stretchX, 1);
    if (lineObj.justify) {
      const natural = ctx.measureText(line).width;
      const diff = maxWidthUnscaled - natural;
      let interiorSpaces = 0, seenNonSpace = false;
      for (const ch of line) {
        if (ch === ' ') { if (seenNonSpace) interiorSpaces++; } else seenNonSpace = true;
      }
      const extraPerSpace = interiorSpaces > 0 ? diff / interiorSpaces : 0;
      let penX = 0, seenNonSpaceDraw = false;
      for (const ch of line) {
        ctx.fillText(ch, penX, 0);
        penX += ctx.measureText(ch).width;
        if (ch === ' ') {
          if (seenNonSpaceDraw) penX += extraPerSpace;
        } else seenNonSpaceDraw = true;
      }
    } else {
      ctx.fillText(line, 0, 0);
    }
    ctx.restore();
  });

  el._lastBlockWidth = blockWidth;
  el._lastBlockHeight = blockHeight;
}

function getBounds(el) {
  if (el.type === 'texture') {
    const w = el.width * el.scaleX, h = el.height * el.scaleY;
    if (!el.angle) {
      return { x: el.x - el.pivotX * w, y: el.y - el.pivotY * h, w, h };
    }
    const rad = -(el.angle) * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const localCorners = [
      [-el.pivotX * w, -el.pivotY * h],
      [w - el.pivotX * w, -el.pivotY * h],
      [w - el.pivotX * w, h - el.pivotY * h],
      [-el.pivotX * w, h - el.pivotY * h],
    ];
    const pts = localCorners.map(([lx, ly]) => [el.x + lx * cos + ly * sin, el.y - lx * sin + ly * cos]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  } else {
    const w = el._lastBlockWidth || 100;
    const h = el._lastBlockHeight || 40;
    return { x: el.x - el.pivotX*w, y: el.y - el.pivotY*h, w, h };
  }
}


const LOCK_ICON_CLOSED = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
const LOCK_ICON_OPEN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 9.5-2.2"></path></svg>';
const EYE_ICON_OPEN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const EYE_ICON_CLOSED = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.6 21.6 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a21.6 21.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><path d="M1 1l22 22"></path></svg>';

function renderList() {
  const list = document.getElementById('elementsList');
  list.innerHTML = '';
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    const row = document.createElement('div');
    row.className = 'el-item' + (i === selected ? ' selected' : '') + (el.locked ? ' locked' : '') + (el.hidden ? ' hidden-layer' : '');
    const tag = document.createElement('span');
    tag.className = 'tag ' + el.type;
    tag.textContent = el.type;
    const label = document.createElement('span');
    label.className = 'label';
    const fullLabel = el.type === 'text' ? el.text.replace(/\^/g, ' / ') : (el.texturePath || '(no texture)');
    label.textContent = el.type === 'text' ? (el.text.split('^')[0] || '(empty)') : (el.texturePath || '(no texture)');
    label.title = fullLabel || '(empty)';
    row.appendChild(tag);
    row.appendChild(label);

    const lock = document.createElement('button');
    lock.className = 'mv' + (el.locked ? ' loaded-indicator' : ''); lock.title = el.locked ? 'Unlock (allow canvas clicks/drag)' : 'Lock (canvas clicks pass through to what\'s underneath)';
    lock.innerHTML = el.locked ? LOCK_ICON_CLOSED : LOCK_ICON_OPEN;
    lock.onclick = (e) => { e.stopPropagation(); el.locked = !el.locked; refreshAll(); pushHistory(); };
    const eye = document.createElement('button');
    eye.className = 'mv' + (el.hidden ? ' loaded-indicator' : ''); eye.title = el.hidden ? 'Show (currently hidden from canvas)' : 'Hide (temporarily removes from canvas and clicks)';
    eye.innerHTML = el.hidden ? EYE_ICON_CLOSED : EYE_ICON_OPEN;
    eye.onclick = (e) => { e.stopPropagation(); el.hidden = !el.hidden; refreshAll(); pushHistory(); };
    const up = document.createElement('button');
    up.className = 'mv'; up.title = 'Bring forward'; up.textContent = '↑';
    up.onclick = (e) => { e.stopPropagation(); if (i<elements.length-1) { [elements[i+1],elements[i]]=[elements[i],elements[i+1]]; selected=i+1; refreshAll(); pushHistory(); } };
    const down = document.createElement('button');
    down.className = 'mv'; down.title = 'Send backward'; down.textContent = '↓';
    down.onclick = (e) => { e.stopPropagation(); if (i>0) { [elements[i-1],elements[i]]=[elements[i],elements[i-1]]; selected=i-1; refreshAll(); pushHistory(); } };
    const del = document.createElement('button');
    del.className = 'mv'; del.textContent = '✕';
    del.onclick = (e) => { e.stopPropagation(); elements.splice(i,1); if (selected===i) selected=-1; else if (selected>i) selected--; refreshAll(); pushHistory(); };

    row.appendChild(lock); row.appendChild(eye); row.appendChild(up); row.appendChild(down); row.appendChild(del);
    row.onclick = () => { selected = i; refreshAll(); };
    list.appendChild(row);
  }
}


function renderProps() {
  const panel = document.getElementById('propsPanel');
  if (selected < 0 || !elements[selected]) {
    panel.innerHTML = `<div class="empty-state">Select an element to edit it, or click on the canvas.<br><br>Canvas size and calibration are in General settings, above the layer list.</div>`;
    return;
  }
  const el = elements[selected];
  if (el.type === 'texture') {
    panel.innerHTML = `
      <h2>Texture element</h2>
      <div class="field"><label>Texture path (what goes in the JSON)</label><input type="text" id="p_path" value="${escapeHtml(el.texturePath)}"></div>
      <div class="field"><label>Preview image (local upload, doesn't affect export)</label><input type="file" id="p_file" accept="image/*">
        ${el.manualImg ? '<div class="hint">Manually pinned - won\'t be replaced by folder auto-matching. <a href="#" id="clearOverride" style="color:var(--accent)">Clear and use auto-match</a></div>' : ''}
      </div>
      <div class="row2">
        <div class="field"><label>x</label><input type="number" id="p_x" value="${el.x}"></div>
        <div class="field"><label>y</label><input type="number" id="p_y" value="${el.y}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>width</label><input type="number" id="p_w" value="${el.width}"></div>
        <div class="field"><label>height</label><input type="number" id="p_h" value="${el.height}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>pivotX</label><input type="number" step="0.1" id="p_pvx" value="${el.pivotX}"></div>
        <div class="field"><label>pivotY</label><input type="number" step="0.1" id="p_pvy" value="${el.pivotY}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>scaleX</label><input type="number" step="0.05" id="p_tsx" value="${el.scaleX}"></div>
        <div class="field"><label>scaleY</label><input type="number" step="0.05" id="p_tsy" value="${el.scaleY}"></div>
      </div>
      <div class="field"><label>angle (degrees)</label><input type="number" step="0.5" id="p_tangle" value="${el.angle}"></div>
      <div class="field"><label>Tint / fallback color (used if no image loaded)</label>
        <div class="color-row">
          <input type="color" id="p_color" value="${rgbToHex(el.r,el.g,el.b)}">
          <input type="number" id="p_alpha" step="0.05" min="0" max="1" value="${el.a}" style="width:70px">
          <span class="hint">alpha</span>
        </div>
      </div>
      <div class="hint">pivotX/Y = 0 anchors the top-left corner at (x,y). 0.5 centers it there.</div>
    `;
    document.getElementById('p_path').oninput = e => { el.texturePath = e.target.value; el.manualImg = false; renderList(); exportNow(); resolveAllTextures(); };
    document.getElementById('p_x').oninput = e => { el.x = parseFloat(e.target.value)||0; updateFromField(); };
    document.getElementById('p_y').oninput = e => { el.y = parseFloat(e.target.value)||0; updateFromField(); };
    document.getElementById('p_w').oninput = e => { el.width = parseFloat(e.target.value)||1; updateFromField(); };
    document.getElementById('p_h').oninput = e => { el.height = parseFloat(e.target.value)||1; updateFromField(); };
    document.getElementById('p_pvx').oninput = e => { el.pivotX = parseFloat(e.target.value)||0; updateFromField(); };
    document.getElementById('p_pvy').oninput = e => { el.pivotY = parseFloat(e.target.value)||0; updateFromField(); };
    document.getElementById('p_tsx').oninput = e => { el.scaleX = parseFloat(e.target.value)||0.01; updateFromField(); };
    document.getElementById('p_tsy').oninput = e => { el.scaleY = parseFloat(e.target.value)||0.01; updateFromField(); };
    document.getElementById('p_tangle').oninput = e => { el.angle = parseFloat(e.target.value)||0; updateFromField(); };
    document.getElementById('p_color').oninput = e => { const [r,g,b]=hexToRgb(e.target.value); el.r=r; el.g=g; el.b=b; updateFromField(); };
    document.getElementById('p_alpha').oninput = e => { el.a = parseFloat(e.target.value); updateFromField(); };
    document.getElementById('p_file').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      const currentPath = el.texturePath || 'media/textures/printMedia/';
      const lastSlash = currentPath.lastIndexOf('/');
      const dir = lastSlash >= 0 ? currentPath.slice(0, lastSlash + 1) : 'media/textures/printMedia/';
      el.texturePath = dir + f.name;
      const img = new Image();
      img.onload = () => { el.img = img; el.manualImg = true; render(); renderProps(); renderList(); exportNow(); };
      img.src = URL.createObjectURL(f);
    };
    const clearOverrideLink = document.getElementById('clearOverride');
    if (clearOverrideLink) {
      clearOverrideLink.onclick = (ev) => {
        ev.preventDefault();
        el.manualImg = false;
        el.img = null;
        resolveAllTextures();
        renderProps();
      };
    }
  } else {
    panel.innerHTML = `
      <h2>Text element</h2>
      <div class="field"><label>Text content (use ^ for a line break)</label><textarea id="p_text">${escapeHtml(el.text)}</textarea></div>
      <div class="row2">
        <div class="field"><label>x</label><input type="number" id="p_x" value="${el.x}"></div>
        <div class="field"><label>y</label><input type="number" id="p_y" value="${el.y}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>pivotX</label><input type="number" step="0.1" id="p_pvx" value="${el.pivotX}"></div>
        <div class="field"><label>pivotY</label><input type="number" step="0.1" id="p_pvy" value="${el.pivotY}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>scaleX</label><input type="number" step="0.01" id="p_sx" value="${el.scaleX}"></div>
        <div class="field"><label>scaleY</label><input type="number" step="0.01" id="p_sy" value="${el.scaleY}"></div>
      </div>
      <div class="field"><label>font</label>
        <select id="p_font">
          ${['SdfOldBold','SdfOldRegular','SdfOldBoldItalic','SdfRegular','SdfBold'].map(f=>`<option ${f===el.font?'selected':''}>${f}</option>`).join('')}
        </select>
      </div>
      <div class="row2">
        <div class="field"><label>textLeading</label><input type="number" id="p_tl" value="${el.textLeading}"></div>
        <div class="field"><label>autoWidth (blank = no wrap)</label><input type="number" id="p_aw" value="${el.autoWidth ?? ''}"></div>
      </div>
      <div class="field"><label>Color</label>
        <div class="color-row">
          <input type="color" id="p_color" value="${rgbToHex(el.r,el.g,el.b)}">
          <input type="number" id="p_alpha" step="0.05" min="0" max="1" value="${el.a}" style="width:70px">
          <span class="hint">alpha</span>
        </div>
      </div>
      <div class="hint">A block only centers correctly under pivotX:0.5 when every ^-separated line is short enough to never hit autoWidth's wrap point - once a line wraps automatically, every wrapped line shares one offset instead of centering individually. Break long lines manually with ^ if you want each one centered.</div>
    `;
    document.getElementById('p_text').oninput = e => { el.text = e.target.value; updateFromField(); };
    document.getElementById('p_x').oninput = e => { el.x = parseFloat(e.target.value)||0; updateFromField(); };
    document.getElementById('p_y').oninput = e => { el.y = parseFloat(e.target.value)||0; updateFromField(); };
    document.getElementById('p_pvx').oninput = e => { el.pivotX = parseFloat(e.target.value)||0; updateFromField(); };
    document.getElementById('p_pvy').oninput = e => { el.pivotY = parseFloat(e.target.value)||0; updateFromField(); };
    document.getElementById('p_sx').oninput = e => { el.scaleX = parseFloat(e.target.value)||0.1; updateFromField(); };
    document.getElementById('p_sy').oninput = e => { el.scaleY = parseFloat(e.target.value)||0.1; updateFromField(); };
    document.getElementById('p_font').onchange = e => { el.font = e.target.value; updateFromField(); };
    document.getElementById('p_tl').oninput = e => { el.textLeading = parseFloat(e.target.value)||0; updateFromField(); };
    document.getElementById('p_aw').oninput = e => { const v = e.target.value; el.autoWidth = v === '' ? null : parseFloat(v); updateFromField(); };
    document.getElementById('p_color').oninput = e => { const [r,g,b]=hexToRgb(e.target.value); el.r=r; el.g=g; el.b=b; updateFromField(); };
    document.getElementById('p_alpha').oninput = e => { el.a = parseFloat(e.target.value); updateFromField(); };
  }
}

function escapeHtml(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function rgbToHex(r,g,b) { const h = v => Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0'); return '#'+h(r)+h(g)+h(b); }
function hexToRgb(hex) { const n = parseInt(hex.slice(1),16); return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255]; }


function exportNow() {
  const str = serializeMarkup(canvasSize, elements);
  document.getElementById('exportBox').value = str;
  document.getElementById('exportBadge').textContent = str.length + ' chars';
  document.getElementById('exportBadge').className = 'badge';
}

document.getElementById('importBtn').onclick = () => {
  const raw = document.getElementById('importBox').value.trim();
  if (!raw) return;
  try {
    const { canvas, elements: parsed } = parseMarkup(raw);
    canvasSize = canvas;
    elements = parsed;
    selected = elements.length ? 0 : -1;
    resolveAllTextures();
    refreshAll();
    document.getElementById('exportBadge').textContent = 'imported';
    pushHistory();
  } catch (err) {
    document.getElementById('exportBadge').textContent = 'parse error';
    document.getElementById('exportBadge').className = 'badge err';
  }
};
document.getElementById('copyBtn').onclick = () => {
  const raw = document.getElementById('exportBox').value;
  const escaped = JSON.stringify(raw).slice(1, -1);
  navigator.clipboard.writeText(escaped).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = escaped;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
  const b = document.getElementById('copyBtn');
  const old = b.textContent;
  b.textContent = 'Copied!';
  setTimeout(() => b.textContent = old, 1200);
};


document.getElementById('addTexture').onclick = () => {
  elements.push({ type:'texture', x:0, y:0, width:400, height:400, pivotX:0, pivotY:0, scaleX:1, scaleY:1, angle:0, r:1,g:1,b:1,a:1, texturePath:'media/textures/printMedia/', img:null });
  selected = elements.length - 1;
  refreshAll();
  pushHistory();
};
document.getElementById('addText').onclick = () => {
  elements.push({ type:'text', x:canvasSize.width/2, y:100, pivotX:0.5, pivotY:0, scaleX:1, scaleY:1, r:0.05,g:0.05,b:0.05,a:1, textLeading:6, font:'SdfOldBold', autoWidth:null, text:'NEW TEXT' });
  selected = elements.length - 1;
  refreshAll();
  pushHistory();
};
document.getElementById('newBtn').onclick = () => {
  if (!confirm('Clear the current layout and start blank?')) return;
  canvasSize = { width: 1240, height: 1754 };
  elements = [];
  selected = -1;
  refreshAll();
  pushHistory();
};


let dragState = null;

function canvasCoords(e) {
  const rect = stage.getBoundingClientRect();
  const scaleX = canvasSize.width / rect.width;
  const scaleY = canvasSize.height / rect.height;
  return { cx: (e.clientX - rect.left) * scaleX, cy: (e.clientY - rect.top) * scaleY };
}

function hitTestHandle(cx, cy) {
  if (selected < 0 || !elements[selected] || elements[selected].type !== 'texture' || elements[selected].locked || elements[selected].hidden) return false;
  const box = getBounds(elements[selected]);
  const hs = getHandleSize();
  const hx = box.x + box.w, hy = box.y + box.h;
  return cx >= hx - hs && cx <= hx + hs && cy >= hy - hs && cy <= hy + hs;
}

function hitTestElement(cx, cy) {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (elements[i].locked || elements[i].hidden) continue;
    const b = getBounds(elements[i]);
    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) return i;
  }
  return -1;
}

stage.addEventListener('mousedown', (e) => {
  const { cx, cy } = canvasCoords(e);

  if (hitTestHandle(cx, cy)) {
    const el = elements[selected];
    dragState = { mode: 'resize', index: selected, startCx: cx, startCy: cy, startW: el.width, startH: el.height };
    e.preventDefault();
    return;
  }

  if (selected >= 0 && elements[selected] && !elements[selected].locked && !elements[selected].hidden) {
    const b = getBounds(elements[selected]);
    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
      const el = elements[selected];
      dragState = { mode: 'move', index: selected, startCx: cx, startCy: cy, startX: el.x, startY: el.y };
      e.preventDefault();
      return;
    }
  }

  const hit = hitTestElement(cx, cy);
  if (hit >= 0) {
    selected = hit;
    const el = elements[hit];
    dragState = { mode: 'move', index: hit, startCx: cx, startCy: cy, startX: el.x, startY: el.y };
    refreshAll();
    e.preventDefault();
  } else {
    selected = -1;
    refreshAll();
  }
});

window.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  const { cx, cy } = canvasCoords(e);
  const dx = cx - dragState.startCx;
  const dy = cy - dragState.startCy;
  const el = elements[dragState.index];
  if (!el) return;

  if (dragState.mode === 'move') {
    el.x = Math.round(dragState.startX + dx);
    el.y = Math.round(dragState.startY + dy);
    syncFieldsDuringDrag({ p_x: el.x, p_y: el.y });
  } else if (dragState.mode === 'resize') {
    el.width = Math.max(1, Math.round(dragState.startW + dx / (el.scaleX || 1)));
    el.height = Math.max(1, Math.round(dragState.startH + dy / (el.scaleY || 1)));
    syncFieldsDuringDrag({ p_w: el.width, p_h: el.height });
  }
  render();
  renderList();
  exportNow();
});

window.addEventListener('mouseup', () => {
  if (dragState) {
    dragState = null;
    refreshAll();
    pushHistory();
  }
});

function syncFieldsDuringDrag(values) {
  for (const [id, val] of Object.entries(values)) {
    const input = document.getElementById(id);
    if (input) input.value = val;
  }
}

stage.addEventListener('click', (e) => {
  e.stopPropagation();
});

stage.addEventListener('mousemove', (e) => {
  if (dragState) return;
  const { cx, cy } = canvasCoords(e);
  if (hitTestHandle(cx, cy)) {
    stage.style.cursor = 'nwse-resize';
  } else if (hitTestElement(cx, cy) >= 0) {
    stage.style.cursor = 'move';
  } else {
    stage.style.cursor = 'default';
  }
});

document.querySelector('.canvas-area').addEventListener('click', (e) => {
  if (e.target === stage) return;
  selected = -1;
  refreshAll();
});

function refreshAll() {
  render();
  renderList();
  renderProps();
  exportNow();
  syncGeneralSettingsFields();
}

function updateFromField() {
  render();
  renderList();
  exportNow();
}

const presetSelect = document.getElementById('presetSelect');
presetSelect.onchange = () => {
  const val = presetSelect.value;
  if (!val) return;
  const fullKey = val.slice('folder::'.length);
  const markup = folderPresets[fullKey];
  if (!markup) return;
  const { canvas, elements: parsed } = parseMarkup(markup);
  canvasSize = canvas;
  elements = parsed;
  selected = elements.length ? 0 : -1;
  resolveAllTextures();
  refreshAll();
  pushHistory();

  const sepIdx = fullKey.indexOf(' :: ');
  currentPresetKey = sepIdx >= 0 ? fullKey.slice(sepIdx + 4) : fullKey;
  currentPresetSourceLabel = sepIdx >= 0 ? fullKey.slice(0, sepIdx) : fullKey;
  document.getElementById('saveKeyInput').value = currentPresetKey;
  refreshSaveUI();
};
rebuildPresetDropdown();


function basename(path) {
  return path.split(/[\\/]/).pop();
}

function normalizedStem(filename) {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  return withoutExt.toLowerCase().replace(/[_\-\s]/g, '');
}


function parseFntFile(text) {
  const lines = text.split(/\r?\n/);
  const info = { chars: new Map(), kernings: new Map(), pages: [], lineHeight: 0, base: 25, size: 32, scaleW: 512, scaleH: 512 };
  const attrRe = /(\w+)=("[^"]*"|\S+)/g;
  for (const line of lines) {
    const tag = line.trim().split(' ')[0];
    if (!tag) continue;
    const attrs = {};
    let m;
    attrRe.lastIndex = 0;
    while ((m = attrRe.exec(line))) {
      let val = m[2];
      if (val.startsWith('"')) val = val.slice(1, -1);
      attrs[m[1]] = val;
    }
    if (tag === 'info') {
      if (attrs.size) info.size = parseFloat(attrs.size);
    } else if (tag === 'common') {
      info.base = parseFloat(attrs.base);
      info.scaleW = parseFloat(attrs.scaleW);
      info.scaleH = parseFloat(attrs.scaleH);
    } else if (tag === 'page') {
      info.pages[parseInt(attrs.id)] = attrs.file;
    } else if (tag === 'char') {
      const id = parseInt(attrs.id);
      const height = parseFloat(attrs.height), yoffset = parseFloat(attrs.yoffset);
      info.chars.set(id, {
        x: parseFloat(attrs.x), y: parseFloat(attrs.y),
        width: parseFloat(attrs.width), height,
        xoffset: parseFloat(attrs.xoffset), yoffset,
        xadvance: parseFloat(attrs.xadvance), page: parseInt(attrs.page) || 0,
      });
      if (id !== 32) {
        info.lineHeight = Math.max(info.lineHeight, height + yoffset);
      }
    } else if (tag === 'kerning') {
      info.kernings.set(attrs.first + ',' + attrs.second, parseFloat(attrs.amount));
    }
  }
  return info;
}

function thresholdSdfPage(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx2 = canvas.getContext('2d');
  ctx2.drawImage(img, 0, 0);
  const imgData = ctx2.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const edge0 = 128 - 30, edge1 = 128 + 30;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    let t = (a - edge0) / (edge1 - edge0);
    t = Math.max(0, Math.min(1, t));
    const smoothed = t * t * (3 - 2 * t);
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
    data[i + 3] = Math.round(smoothed * 255);
  }
  ctx2.putImageData(imgData, 0, 0);
  return canvas;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

document.getElementById('loadFontsBtn').onclick = async () => {
  if ('showDirectoryPicker' in window) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      await loadFontsFromDirectoryHandle(dirHandle);
      await saveHandle('lastFonts', dirHandle);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn(err);
    }
  } else {
    document.getElementById('fontsInput').click();
  }
};

const RELEVANT_FONT_NAMES = new Set(['SdfOldBold', 'SdfOldRegular', 'SdfOldBoldItalic', 'SdfOldItalic',
  'sdfBold', 'sdfRegular', 'sdfBoldItalic', 'sdfItalic', 'sdfCaveat', 'sdfRobertoSans']);

async function walkForFontFiles(dirHandle, foundFiles) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory') {
      await walkForFontFiles(handle, foundFiles);
    } else if (handle.kind === 'file') {
      const lower = name.toLowerCase();
      const stem = name.replace(/\.fnt$/i, '');
      if ((lower.endsWith('.fnt') && RELEVANT_FONT_NAMES.has(stem)) || lower.endsWith('.png')) {
        foundFiles.push(await handle.getFile());
      }
    }
  }
}

async function loadFontsFromDirectoryHandle(dirHandle) {
  const files = [];
  document.getElementById('fontStatus').textContent = 'Scanning for fonts...';
  await walkForFontFiles(dirHandle, files);
  await loadFontsFromFiles(files);
}

async function loadFontsFromFiles(files) {
  const status = document.getElementById('fontStatus');
  status.textContent = 'Loading fonts...';

  const fntFiles = files.filter(f => {
    const stem = f.name.replace(/\.fnt$/i, '');
    return f.name.toLowerCase().endsWith('.fnt') && RELEVANT_FONT_NAMES.has(stem);
  });
  const pngByName = new Map();
  for (const f of files) {
    if (f.name.toLowerCase().endsWith('.png')) pngByName.set(f.name, f);
  }

  let loadedCount = 0;
  for (const fntFile of fntFiles) {
    try {
      const text = await fntFile.text();
      const info = parseFntFile(text);
      const pageCanvases = [];
      for (const pageFileName of info.pages) {
        const pngFile = pngByName.get(pageFileName);
        if (!pngFile) { pageCanvases.push(null); continue; }
        const img = await loadImageFromFile(pngFile);
        pageCanvases.push(thresholdSdfPage(img));
      }
      info.pageCanvases = pageCanvases;
      const fontName = fntFile.name.replace(/\.fnt$/i, '');
      loadedFonts[fontName.toLowerCase()] = info;
      loadedCount++;
    } catch (err) {
      console.warn('Could not load font', fntFile.name, err);
    }
  }

  status.textContent = `Loaded ${loadedCount} real font${loadedCount===1?'':'s'} - matching fonts now render with actual game glyphs`;
  updateLoadButtonStates();
  render();
}

document.getElementById('fontsInput').onchange = async (e) => {
  await loadFontsFromFiles(Array.from(e.target.files));
};


const HANDLE_DB_NAME = 'printMediaEditorHandles';
const HANDLE_STORE = 'handles';

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(HANDLE_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(key, handle) {
  try {
    const db = await openHandleDB();
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).put(handle, key);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (err) { console.warn('Could not save handle for next time:', err); }
}

async function loadHandle(key) {
  try {
    const db = await openHandleDB();
    const tx = db.transaction(HANDLE_STORE, 'readonly');
    const req = tx.objectStore(HANDLE_STORE).get(key);
    return await new Promise((res, rej) => { req.onsuccess = () => res(req.result || null); req.onerror = () => rej(req.error); });
  } catch (err) { return null; }
}

async function ensurePermission(handle, mode = 'readwrite') {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function rememberLastLoaded(type, handle) {
  await saveHandle('lastLoaded', { type, handle });
}

async function checkForResumableSession() {
  if (!('showDirectoryPicker' in window)) return;
  const [last, lastFonts] = await Promise.all([loadHandle('lastLoaded'), loadHandle('lastFonts')]);
  if (!last && !lastFonts) return;
  const btn = document.getElementById('resumeBtn');
  const parts = [];
  if (last) parts.push(last.handle.name);
  if (lastFonts) parts.push(lastFonts.name + ' (fonts)');
  btn.textContent = 'Resume';
  btn.title = `Resume: ${parts.join(' + ')}`;
  btn.style.display = '';
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Resuming...';
    try {
      if (last) {
        if (!(await ensurePermission(last.handle))) throw new Error('Permission not granted');
        if (last.type === 'folder') await loadFromDirectoryHandle(last.handle);
        else if (last.type === 'json') await loadJsonFromHandle(last.handle);
        else if (last.type === 'textures') await loadTexturesFromDirectoryHandle(last.handle);
      }
      if (lastFonts) {
        if (!(await ensurePermission(lastFonts, 'read'))) throw new Error('Font permission not granted');
        await loadFontsFromDirectoryHandle(lastFonts);
      }
      btn.style.display = 'none';
    } catch (err) {
      btn.textContent = 'Resume failed - pick again';
      btn.disabled = false;
      console.warn(err);
    }
  };
}

document.getElementById('loadFolderBtn').onclick = async () => {
  if ('showDirectoryPicker' in window) {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await loadFromDirectoryHandle(dirHandle);
      rememberLastLoaded('folder', dirHandle);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn(err);
    }
  } else {
    document.getElementById('folderInput').click();
  }
};

async function walkDirectory(dirHandle, pathPrefix, foundTextures, jsonEntries) {
  for await (const [name, handle] of dirHandle.entries()) {
    const relPath = pathPrefix ? `${pathPrefix}/${name}` : name;
    if (handle.kind === 'directory') {
      await walkDirectory(handle, relPath, foundTextures, jsonEntries);
    } else if (handle.kind === 'file') {
      const ext = name.split('.').pop().toLowerCase();
      const segments = relPath.split('/').map(s => s.toLowerCase());
      const inPrintMediaFolder = segments.slice(0, -1).some(s => s.replace(/[_\-\s]/g, '') === 'printmedia');
      if (['png', 'jpg', 'jpeg'].includes(ext) && inPrintMediaFolder) {
        const file = await handle.getFile();
        foundTextures.set(name.toLowerCase(), file);
      } else if (ext === 'json' && normalizedStem(name) === 'printmedia' && segments.includes('en')) {
        jsonEntries.push({ handle, rel: relPath });
      }
    }
  }
}

async function loadFromDirectoryHandle(dirHandle) {
  const status = document.getElementById('imageStatus');
  const jsonStat = document.getElementById('jsonStatus');
  status.textContent = 'Scanning...';

  const foundTextures = new Map();
  const jsonEntries = [];
  await walkDirectory(dirHandle, dirHandle.name, foundTextures, jsonEntries);
  textureFileMap = foundTextures;

  let jsonCount = 0;
  let entryCount = 0;
  folderPresets = {};
  for (const { handle, rel } of jsonEntries) {
    const file = await handle.getFile();
    const result = await ingestJsonFile(file, rel);
    if (result.jsonCount) {
      jsonHandlesByLabel.set(rel, { handle, fileName: basename(rel) });
    }
    jsonCount += result.jsonCount;
    entryCount += result.entryCount;
  }

  rebuildPresetDropdown();
  updateLoadButtonStates();
  resolveAllTextures();
  refreshSaveUI();

  status.textContent = `${textureFileMap.size} image${textureFileMap.size===1?'':'s'} loaded`;
  jsonStat.textContent = jsonCount
    ? `${entryCount} preset${entryCount===1?'':'s'} from ${jsonCount} JSON file${jsonCount===1?'':'s'} - writable`
    : 'No PrintMedia.json found';
}

document.getElementById('loadJsonBtn').onclick = async () => {
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'PrintMedia JSON', accept: { 'application/json': ['.json'] } }],
      });
      await loadJsonFromHandle(handle);
      rememberLastLoaded('json', handle);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn(err);
    }
  } else {
    document.getElementById('jsonInput').click();
  }
};

let jsonHandlesByLabel = new Map();

async function loadJsonFromHandle(handle) {
  const status = document.getElementById('jsonStatus');
  status.textContent = 'Loading...';
  const file = await handle.getFile();
  const { jsonCount, entryCount } = await ingestJsonFile(file, file.name);
  if (jsonCount) {
    jsonHandlesByLabel.set(file.name, { handle, fileName: file.name });
  }
  updateLoadButtonStates();
  rebuildPresetDropdown();
  refreshSaveUI();
  status.textContent = jsonCount
    ? `Loaded ${entryCount} preset${entryCount===1?'':'s'} from ${file.name} - writable, changes can be saved directly back to it`
    : `${file.name} has no Print_Media_..._info entries`;
}

function refreshSaveUI() {
  const datalist = document.getElementById('saveKeyOptions');
  const btn = document.getElementById('saveToFileBtn');
  datalist.innerHTML = '';
  Object.keys(folderPresets).forEach(k => {
    const parts = k.split(' :: ');
    const rawKey = parts.length > 1 ? parts[1] : parts[0];
    const opt = document.createElement('option');
    opt.value = rawKey;
    datalist.appendChild(opt);
  });
  const entry = jsonHandlesByLabel.get(currentPresetSourceLabel);
  if (entry) {
    btn.disabled = false;
    btn.textContent = `Save to ${entry.fileName}`;
  } else {
    btn.disabled = true;
    btn.textContent = ('showDirectoryPicker' in window || 'showOpenFilePicker' in window)
      ? 'Load a writable file first'
      : "Your browser can't write files directly - use Copy instead";
  }
}

document.getElementById('saveToFileBtn').onclick = async () => {
  const entry = jsonHandlesByLabel.get(currentPresetSourceLabel);
  if (!entry) return;
  const key = document.getElementById('saveKeyInput').value.trim();
  const status = document.getElementById('jsonStatus');
  if (!key) {
    status.textContent = 'Type a key name first (e.g. Print_Media_YourMod.ItemName_info)';
    return;
  }
  try {
    const file = await entry.handle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);
    data[key] = document.getElementById('exportBox').value;
    const writable = await entry.handle.createWritable();
    await writable.write(JSON.stringify(data, null, 4));
    await writable.close();
    status.textContent = `Saved "${key}" to ${entry.fileName}`;
    folderPresets[currentPresetSourceLabel + ' :: ' + key] = data[key];
    refreshSaveUI();
  } catch (err) {
    status.textContent = 'Save failed: ' + err.message;
    console.error(err);
  }
};

async function ingestJsonFile(file, rel) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const relevantKeys = Object.keys(data).filter(k => k.startsWith('Print_Media_') && k.endsWith('_info'));
    if (relevantKeys.length === 0) return { jsonCount: 0, entryCount: 0 };
    for (const k of relevantKeys) {
      folderPresets[`${rel} :: ${k}`] = data[k];
    }
    return { jsonCount: 1, entryCount: relevantKeys.length };
  } catch (err) {
    console.warn('Could not parse', rel, err);
    return { jsonCount: 0, entryCount: 0 };
  }
}

document.getElementById('jsonInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = document.getElementById('jsonStatus');
  status.textContent = 'Loading...';
  const { jsonCount, entryCount } = await ingestJsonFile(file, file.name);
  updateLoadButtonStates();
  rebuildPresetDropdown();
  status.textContent = jsonCount
    ? `Loaded ${entryCount} preset${entryCount===1?'':'s'} from ${file.name}`
    : `${file.name} has no Print_Media_..._info entries`;
};

function scanFiles(files) {
  const foundTextures = new Map();
  const jsonCandidates = [];
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name;
    const ext = rel.split('.').pop().toLowerCase();
    const segments = rel.split(/[\\/]/).map(s => s.toLowerCase());
    const inPrintMediaFolder = segments.slice(0, -1).some(s => s.replace(/[_\-\s]/g, '') === 'printmedia');

    if (['png', 'jpg', 'jpeg'].includes(ext) && inPrintMediaFolder) {
      foundTextures.set(basename(rel).toLowerCase(), f);
    } else if (ext === 'json' && normalizedStem(basename(rel)) === 'printmedia' && segments.includes('en')) {
      jsonCandidates.push({ file: f, rel });
    }
  }
  return { foundTextures, jsonCandidates };
}

document.getElementById('folderInput').onchange = async (e) => {
  const files = Array.from(e.target.files);
  const status = document.getElementById('imageStatus');
  const jsonStat = document.getElementById('jsonStatus');
  status.textContent = 'Scanning...';

  const { foundTextures, jsonCandidates } = scanFiles(files);
  textureFileMap = foundTextures;

  let jsonCount = 0;
  let entryCount = 0;
  folderPresets = {};
  for (const { file, rel } of jsonCandidates) {
    const result = await ingestJsonFile(file, rel);
    jsonCount += result.jsonCount;
    entryCount += result.entryCount;
  }

  rebuildPresetDropdown();
  updateLoadButtonStates();
  resolveAllTextures();
  refreshSaveUI();

  status.textContent = `${textureFileMap.size} image${textureFileMap.size===1?'':'s'} loaded`;
  jsonStat.textContent = jsonCount
    ? `${entryCount} preset${entryCount===1?'':'s'} from ${jsonCount} JSON file${jsonCount===1?'':'s'}`
    : 'No PrintMedia.json found';
};

document.getElementById('loadTexturesBtn').onclick = async () => {
  if ('showDirectoryPicker' in window) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      await loadTexturesFromDirectoryHandle(dirHandle);
      rememberLastLoaded('textures', dirHandle);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn(err);
    }
  } else {
    document.getElementById('texturesInput').click();
  }
};

async function loadTexturesFromDirectoryHandle(dirHandle) {
  const status = document.getElementById('imageStatus');
  status.textContent = 'Scanning...';
  const foundTextures = new Map();
  const jsonEntries = [];
  await walkDirectory(dirHandle, dirHandle.name, foundTextures, jsonEntries);
  for (const [name, file] of foundTextures) {
    textureFileMap.set(name, file);
  }
  updateLoadButtonStates();
  const resolved = resolveAllTextures();
  status.textContent = foundTextures.size === 0
    ? 'No images found inside a printMedia/ folder there - point it at the mod root, or anywhere above that folder.'
    : `${foundTextures.size} image${foundTextures.size===1?'':'s'} loaded, matched ${resolved} to element${resolved===1?'':'s'} already on the canvas`;
}

document.getElementById('texturesInput').onchange = (e) => {
  const files = Array.from(e.target.files);
  const status = document.getElementById('imageStatus');
  const { foundTextures } = scanFiles(files);

  for (const [name, file] of foundTextures) {
    textureFileMap.set(name, file);
  }
  updateLoadButtonStates();
  const resolved = resolveAllTextures();

  if (foundTextures.size === 0) {
    status.textContent = 'No images found inside a printMedia/ folder there - point it at the mod root, or anywhere above that folder.';
  } else {
    status.textContent = `Loaded ${foundTextures.size} image${foundTextures.size===1?'':'s'}, matched ${resolved} to element${resolved===1?'':'s'} already on the canvas`;
  }
};

function updateLoadButtonStates() {
  const hasTextures = textureFileMap.size > 0;
  const hasJson = Object.keys(folderPresets).length > 0;
  const hasFonts = Object.keys(loadedFonts).length > 0;
  document.getElementById('loadTexturesBtn').classList.toggle('loaded-indicator', hasTextures);
  document.getElementById('loadJsonBtn').classList.toggle('loaded-indicator', hasJson);
  document.getElementById('loadFolderBtn').classList.toggle('loaded-indicator', hasTextures || hasJson);
  document.getElementById('loadFontsBtn').classList.toggle('loaded-indicator', hasFonts);
}

function rebuildPresetDropdown() {
  const presetSelect = document.getElementById('presetSelect');
  presetSelect.innerHTML = '<option value="">Load a preset...</option>';

  if (Object.keys(folderPresets).length > 0) {
    const grp = document.createElement('optgroup');
    grp.label = 'From loaded mod folder';
    Object.keys(folderPresets).forEach(k => {
      const opt = document.createElement('option');
      opt.value = 'folder::' + k;
      opt.textContent = k;
      grp.appendChild(opt);
    });
    presetSelect.appendChild(grp);
  }
}

function resolveAllTextures() {
  let resolved = 0;
  for (const el of elements) {
    if (el.type !== 'texture' || el.manualImg) continue;
    const name = basename(el.texturePath || '').toLowerCase();
    if (!name) continue;
    const file = textureFileMap.get(name);
    if (file) {
      const img = new Image();
      img.onload = () => render();
      img.src = URL.createObjectURL(file);
      el.img = img;
      resolved++;
    }
  }
  render();
  return resolved;
}

window.addEventListener('resize', render);

document.getElementById('cw').oninput = e => { canvasSize.width = parseFloat(e.target.value)||1240; updateFromField(); };
document.getElementById('ch').oninput = e => { canvasSize.height = parseFloat(e.target.value)||1754; updateFromField(); };

function syncGeneralSettingsFields() {
  document.getElementById('cw').value = canvasSize.width;
  document.getElementById('ch').value = canvasSize.height;
}

refreshAll();
refreshSaveUI();
updateLoadButtonStates();
checkForResumableSession();
pushHistory();

document.getElementById('undoBtn').onclick = undo;
document.getElementById('redoBtn').onclick = redo;
