// Дошка (SVG): фігури, підсвітка ходу кольором якості, значок якості, стрілки й кола,
// хід дотиком (клітинка - клітинка) або перетягуванням, малювання стрілок пальцем.
import { D } from './data.js';
import { Pos, START_FEN, fileOf, rankOf } from './logic.js';

const PIECE_URL = {};
for (const [k, v] of Object.entries(D.PIECES)) PIECE_URL[k] = 'data:image/png;base64,' + v;

export function mix(c1, c2, t) {
  const p = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1), b = p(c2);
  return '#' + a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, '0')).join('');
}

function glyph(shapes, fill) {
  return shapes.map(sh => {
    if (sh[0] === 'cap') {
      const [, x1, y1, x2, y2, r] = sh;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${fill}" stroke-width="${2 * r}" stroke-linecap="round"/>`;
    }
    if (sh[0] === 'dot') { const [, x, y, r] = sh; return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`; }
    return `<polygon points="${sh[1].map(p => p.join(',')).join(' ')}" fill="${fill}"/>`;
  }).join('');
}

/** Значок якості ходу в координатах -1..1 (як badge_rows у програмі для ПК: коло, тінь, білий символ). */
export function badgeInner(symbol, color) {
  const sh = D.BADGE_GLYPHS[symbol];
  if (!sh) return `<circle r="0.9" fill="${color}" stroke="#fff" stroke-width="0.12"/>` +
    `<text y="0.32" font-size="0.9" text-anchor="middle" fill="#fff" font-weight="700">${symbol}</text>`;
  return `<circle cy="0.07" r="0.92" fill="rgba(0,0,0,.35)"/><circle r="0.9" fill="${color}"/>` +
    `<g transform="scale(0.9)"><g transform="translate(0,0.06)">${glyph(sh, mix(color, '#000000', 0.28))}</g>${glyph(sh, '#fff')}</g>`;
}

export const badgeSvg = (symbol, color, cls = 'dot') => `<svg class="${cls}" viewBox="-1 -1 2 2">${badgeInner(symbol, color)}</svg>`;

function arrowSvg(x1, y1, x2, y2, color, w, headLen, headHalf, opacity = 1) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const bx = x2 - ux * headLen, by = y2 - uy * headLen, px = -uy * headHalf, py = ux * headHalf;
  return `<g opacity="${opacity}"><line x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>` +
    `<polygon points="${x2},${y2} ${bx + px},${by + py} ${bx - px},${by - py}" fill="${color}"/></g>`;
}

/** Куди фігура може піти за правилами свого ходу, не зважаючи на інші фігури (хід наперед, 1.25.7). */
function premoveTargets(p, sq) {
  const f = fileOf(sq), r = rankOf(sq), out = [];
  const add = (ff, rr) => { if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) out.push('abcdefgh'[ff] + (rr + 1)); };
  if (p.type === 'n') for (const [a, b] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) add(f + a, r + b);
  else if (p.type === 'k') {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) add(f + a, r + b);
    if (f === 4 && r === (p.color === 'w' ? 0 : 7)) { add(6, r); add(2, r); }
  } else if (p.type === 'p') {
    const d = p.color === 'w' ? 1 : -1;
    add(f, r + d); if (r === (p.color === 'w' ? 1 : 6)) add(f, r + 2 * d);
    add(f - 1, r + d); add(f + 1, r + d);
  } else {
    const dirs = [];
    if (p.type === 'b' || p.type === 'q') dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    if (p.type === 'r' || p.type === 'q') dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    for (const [a, b] of dirs) for (let k = 1; k < 8; k++) add(f + a * k, r + b * k);
  }
  return out;
}

export class BoardView {
  constructor(host, { onMove, onShapes }) {
    this.host = host; this.onMove = onMove; this.onShapes = onShapes;
    this.fen = START_FEN; this.last = null; this.badge = null; this.arrow = null; this.shapes = [];
    this.flipped = false; this.theme = 'Mint'; this.interactive = false; this.selected = null;
    this.drawMode = false; this.drawColor = 'G';
    this.premoveColor = null; this.premoves = []; this.onPremove = null;   // 1.25.7: черга ходів наперед   // 1.25.3: хід наперед проти бота
    this.drag = null; this.anim = null; this.px = 320;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    host.appendChild(this.svg);
    this.svg.addEventListener('pointerdown', e => this._down(e));
    this.svg.addEventListener('pointermove', e => this._move(e));
    this.svg.addEventListener('pointerup', e => this._up(e));
    this.svg.addEventListener('pointercancel', () => { this.drag = null; this.render(); });
    this.svg.addEventListener('contextmenu', e => e.preventDefault());
  }

  setSize(px) {
    this.px = px;
    this.host.style.width = this.host.style.height = px + 'px';
    this.svg.setAttribute('width', px); this.svg.setAttribute('height', px);
  }

  xy(sq) { const f = fileOf(sq), r = rankOf(sq); return this.flipped ? [7 - f, r] : [f, 7 - r]; }

  sqAt(cx, cy) {
    const rc = this.svg.getBoundingClientRect();
    const x = Math.floor((cx - rc.left) / rc.width * 8), y = Math.floor((cy - rc.top) / rc.height * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    const f = this.flipped ? 7 - x : x, r = this.flipped ? y : 7 - y;
    return 'abcdefgh'[f] + (r + 1);
  }

  /** Партія з ботом: фігура в руці / вибрана лишається, поки вона своя (1.25.10); інакше - зняти вибір. */
  _dropInput() {
    if (this.premoveColor && this.selected) {
      const p = this.premoves.length ? this._grid()[this.selected] : new Pos(this.fen).pieceAt(this.selected);
      if (p && p.color === this.premoveColor) return;   // з чергою - фігура вже на місці після ходів наперед
    }
    this.selected = null; this.drag = null;
  }

  _cancelAnim() { if (this.anim) { cancelAnimationFrame(this.anim.raf); clearTimeout(this.anim.timer); this.anim = null; } }

  setPosition(fen, last = null, badge = null, arrow = null, shapes = null) {
    this._cancelAnim();
    const same = fen === this.fen;      // та сама позиція (прийшла оцінка ходу) - фігура в руці лишається (1.26.5)
    this.fen = fen; this.last = last; this.badge = badge; this.arrow = arrow; this.shapes = shapes || [];
    if (!same) this._dropInput();
    this.render();
  }

  flip() { this.flipped = !this.flipped; this.render(); }

  /** Плавно переносить фігуру ходу uci з позиції fenBefore, потім викликає done(). */
  animate(fenBefore, prevLast, uci, done, badge = null) {
    this._cancelAnim();
    // 1.25.14: колір клітинок і значок ходу - одразу, а не після анімації
    this.fen = fenBefore; this.last = uci; this.badge = badge; this.arrow = null; this.shapes = [];
    this._dropInput();
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    const p = new Pos(fenBefore).pieceAt(from);
    if (!p) { done(); return; }
    const [x1, y1] = this.xy(from), [x2, y2] = this.xy(to);
    this.render(from);
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('href', PIECE_URL[p.color + p.type.toUpperCase()]);
    img.setAttribute('width', 1); img.setAttribute('height', 1);
    this.svg.appendChild(img);
    const t0 = performance.now(), dur = 130;   // 1.25.6: трохи швидше (було 170)
    // кінець анімації - гарантовано (таймер), навіть якщо кадри не малюються: інакше позиція
    // зі стрілкою найкращого ходу й значком не з'явилася б
    const finish = () => {
      if (!this.anim) return;
      cancelAnimationFrame(this.anim.raf); clearTimeout(this.anim.timer);
      this.anim = null;
      done();
    };
    this._animFinish = finish;
    const step = now => {
      if (!this.anim) return;
      const t = Math.min(1, (now - t0) / dur), e = 1 - (1 - t) * (1 - t);
      img.setAttribute('x', x1 + (x2 - x1) * e); img.setAttribute('y', y1 + (y2 - y1) * e);
      if (t < 1) this.anim.raf = requestAnimationFrame(step);
      else finish();
    };
    this.anim = { raf: requestAnimationFrame(step), timer: setTimeout(finish, dur + 80) };
  }

  render(hideSq = null) {
    const th = D.BOARD_THEMES[this.theme] || D.BOARD_THEMES.Mint;
    const pos = new Pos(this.fen);
    const grid = this.premoves.length ? this._grid() : null;      // фігури - уже на місцях після ходів наперед
    const lastFrom = this.last ? this.last.slice(0, 2) : null, lastTo = this.last ? this.last.slice(2, 4) : null;
    const qcolor = this.badge ? this.badge[0] : null;
    const targets = {};
    if (this.selected && this._premoving()) {
      const g = grid || this._grid(), p = g[this.selected];
      if (p) for (const to of premoveTargets(p, this.selected)) targets[to] = !!g[to] && g[to].color !== p.color;
    } else if (this.selected) for (const m of this._movePos().legal()) if (m.from === this.selected) targets[m.to] = m.flags.includes('c') || m.flags.includes('e');
    const preSqs = new Set(this.premoves.flatMap(u => [u.slice(0, 2), u.slice(2, 4)]));
    // анімації: колір клітинок ходу - лише для нового ходу, кружечки - лише для нового вибору фігури
    const posKey = this.last + '|' + (this.badge ? this.badge[0] : '');   // без fen - після анімації не наливається вдруге
    const newPos = posKey !== this._fxPos, newSel = !!this.selected && this.selected !== this._fxSel;
    this._fxPos = posKey; this._fxSel = this.selected;
    const out = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const sq = 'abcdefgh'[f] + (r + 1), [x, y] = this.xy(sq);
      const light = (f + r) % 2 === 1, base = light ? th.light : th.dark;
      let color = base;
      if (sq === lastFrom || sq === lastTo) color = qcolor ? mix(base, qcolor, sq === lastTo ? 0.75 : 0.45) : (light ? th.hl_light : th.hl_dark);
      if (preSqs.has(sq)) color = mix(base, '#c0504d', 0.55);   // хід наперед
      if (sq === this.selected) color = mix(base, '#ffe066', 0.6);
      const fx = newPos && color !== base && sq !== this.selected && !preSqs.has(sq) ? ` class="sqfx" style="--from:${base}"` : '';
      out.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"${fx}/>`);
      const tc = light ? th.dark : th.light;
      if (r === (this.flipped ? 7 : 0)) out.push(`<text x="${x + 0.93}" y="${y + 0.95}" font-size="0.2" font-weight="700" text-anchor="end" fill="${tc}">${'abcdefgh'[f]}</text>`);
      if (f === (this.flipped ? 7 : 0)) out.push(`<text x="${x + 0.06}" y="${y + 0.22}" font-size="0.2" font-weight="700" fill="${tc}">${r + 1}</text>`);
      if (sq in targets) {
        const hint = mix(base, '#000000', 0.28);
        const dfx = newSel ? ' class="dotfx"' : '';
        out.push(targets[sq] ? `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.43" fill="none" stroke="${hint}" stroke-width="0.075"${dfx}/>`
          : `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.17" fill="${hint}"${dfx}/>`);
      }
    }
    for (const [sq, p] of grid ? Object.entries(grid) : pos.pieceMapDesc()) {
      if (sq === hideSq || (this.drag && this.drag.mode === 'piece' && this.drag.moved && sq === this.drag.from)) continue;
      const [x, y] = this.xy(sq);
      out.push(`<image href="${PIECE_URL[p.color + p.type.toUpperCase()]}" x="${x}" y="${y}" width="1" height="1"/>`);
    }
    if (this.arrow) {
      const [x1, y1] = this.xy(this.arrow.slice(0, 2)), [x2, y2] = this.xy(this.arrow.slice(2, 4));
      out.push(arrowSvg(x1 + 0.5, y1 + 0.5, x2 + 0.5, y2 + 0.5, '#ff8a1f', 0.13, 0.3, 0.19, 0.9));
    }
    const shapes = [...this.shapes];
    if (this.drag && this.drag.mode === 'draw') shapes.push(this.drawColor + this.drag.from + (this.drag.to !== this.drag.from ? this.drag.to : ''));
    for (const sh of shapes) out.push(this._shapeSvg(sh));
    if (this.badge && lastTo) {
      const [x, y] = this.xy(lastTo);
      out.push(`<g transform="translate(${x + 0.8},${y + 0.2}) scale(0.2)">${badgeInner(this.badge[1], this.badge[0])}</g>`);
    }
    if (this.drag && this.drag.mode === 'piece' && this.drag.moved) {
      const p = grid ? grid[this.drag.from] : this._premoving() ? this._grid()[this.drag.from] : pos.pieceAt(this.drag.from);
      if (p) out.push(`<image href="${PIECE_URL[p.color + p.type.toUpperCase()]}" x="${this.drag.x - 0.5}" y="${this.drag.y - 0.5}" width="1" height="1"/>`);
    }
    this.svg.innerHTML = out.join('');
  }

  _shapeSvg(sh) {
    const color = D.SHAPE_COLORS[sh[0]] || D.SHAPE_COLORS.G;
    const a = sh.slice(1, 3), b = sh.slice(3, 5);
    const [x1, y1] = this.xy(a);
    if (!b) return `<circle cx="${x1 + 0.5}" cy="${y1 + 0.5}" r="0.45" fill="none" stroke="${color}" stroke-width="0.08" opacity="0.65"/>`;
    const [x2, y2] = this.xy(b);
    const df = Math.abs(fileOf(a) - fileOf(b)), dr = Math.abs(rankOf(a) - rankOf(b));
    if (df + dr === 3 && df && dr) {                     // хід конем - стрілка «Г»: спершу довша сторона (1.25.3)
      const [cx, cy] = Math.abs(x2 - x1) > Math.abs(y2 - y1) ? [x2, y1] : [x1, y2];
      return `<g opacity="0.65"><line x1="${x1 + 0.5}" y1="${y1 + 0.5}" x2="${cx + 0.5}" y2="${cy + 0.5}" stroke="${color}" stroke-width="0.15" stroke-linecap="square"/>`
        + arrowSvg(cx + 0.5, cy + 0.5, x2 + 0.5, y2 + 0.5, color, 0.15, 0.32, 0.22, 1) + '</g>';
    }
    return arrowSvg(x1 + 0.5, y1 + 0.5, x2 + 0.5, y2 + 0.5, color, 0.15, 0.32, 0.22, 0.65);
  }

  _local(e) {
    const rc = this.svg.getBoundingClientRect();
    return [(e.clientX - rc.left) / rc.width * 8, (e.clientY - rc.top) / rc.height * 8];
  }

  /** Позиція для вибору ходу: під час ходу суперника - хід наперед (черга передана гравцеві). */
  _premoving() { return !!this.premoveColor && this.fen.split(' ')[1] !== this.premoveColor; }
  _movePos() {
    if (!this._premoving()) return new Pos(this.fen);
    const p = this.fen.split(' ');
    p[1] = this.premoveColor; p[3] = '-';
    try { return new Pos(p.join(' ')); } catch (_) { return new Pos(this.fen); }
  }
  /** Фігури після всіх ходів наперед (без перевірки правил): {поле: {color, type}}. */
  _grid() {
    const g = {}, rows = this.fen.split(' ')[0].split('/');
    rows.forEach((row, i) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += +ch; continue; }
        g['abcdefgh'[f] + (8 - i)] = { color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() };
        f++;
      }
    });
    for (const u of this.premoves) {
      const a = u.slice(0, 2), b = u.slice(2, 4), p = g[a];
      if (!p) continue;
      delete g[a];
      if (p.type === 'k' && Math.abs(fileOf(b) - fileOf(a)) === 2) {          // рокіровка - і тура
        const [rf, rt] = fileOf(b) > fileOf(a) ? ['h', 'f'] : ['a', 'd'];
        const rook = g[rf + a[1]];
        if (rook) { delete g[rf + a[1]]; g[rt + a[1]] = rook; }
      }
      g[b] = u.length > 4 ? { color: p.color, type: 'q' } : p;
    }
    return g;
  }
  _play(mv, dragged) {
    this.selected = null;
    if (this._premoving()) { this.premoves.push(mv); this.render(); if (this.onPremove) this.onPremove(mv); return; }
    this.onMove(mv, dragged);
  }

  _findMove(from, to) {
    if (this._premoving()) {          // 1.25.7: хід наперед - як ходить фігура, не зважаючи на інші (як на chess.com)
      const p = this._grid()[from];
      if (!p || p.color !== this.premoveColor || !to || !premoveTargets(p, from).includes(to)) return null;
      return from + to + (p.type === 'p' && to[1] === (p.color === 'w' ? '8' : '1') ? 'q' : '');
    }
    const ms = this._movePos().legal().filter(m => m.from === from && m.to === to);
    if (!ms.length) return null;
    const m = ms.find(x => !x.promotion || x.promotion === 'q') || ms[0];
    return m.from + m.to + (m.promotion || '');
  }

  _down(e) {
    if (this.anim) {
      if (!this._animFinish) return;
      this._animFinish();                 // дотик під час анімації її завершує - можна ходити далі (1.26.1.5: і в аналізі)
    }
    const sq = this.sqAt(e.clientX, e.clientY);
    if (!sq) return;
    try { this.svg.setPointerCapture(e.pointerId); } catch (_) { /* */ }
    if (this.drawMode) { this.drag = { mode: 'draw', from: sq, to: sq }; this.render(); return; }
    if (!this.interactive) return;
    const pre = this._premoving(), pos = this._movePos(), p = pre ? this._grid()[sq] : pos.pieceAt(sq);
    if (this.selected && this.selected !== sq) {
      const mv = this._findMove(this.selected, sq);   // 1.25.18: хід наперед і на клітинку своєї фігури, якщо вибрана туди ходить
      if (mv) { this._play(mv, false); return; }
    }
    if (p && p.color === pos.turn) {
      const [x, y] = this._local(e);
      this.selected = sq;
      this.drag = { mode: 'piece', from: sq, x, y, x0: x, y0: y, moved: false };
    } else {
      this.selected = null;
      if (this.premoves.length) { this.premoves = []; if (this.onPremove) this.onPremove(null); }   // дотик на порожнє - скасувати ходи наперед
    }
    this.render();
  }

  _move(e) {
    if (!this.drag) return;
    if (this.drag.mode === 'draw') {
      const sq = this.sqAt(e.clientX, e.clientY);
      if (sq && sq !== this.drag.to) { this.drag.to = sq; this.render(); }
      return;
    }
    const [x, y] = this._local(e);
    this.drag.x = x; this.drag.y = y;
    if (!this.drag.moved && Math.hypot(x - this.drag.x0, y - this.drag.y0) > 0.2) this.drag.moved = true;
    if (this.drag.moved) this.render();
  }

  _up(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.mode === 'draw') {
      const body = d.from + (d.to !== d.from ? d.to : '');
      const shapes = this.shapes.filter(s => s.slice(1) !== body);
      const had = this.shapes.find(s => s.slice(1) === body);
      if (!had || had[0] !== this.drawColor) shapes.push(this.drawColor + body);
      this.shapes = shapes;
      this.render();
      if (this.onShapes) this.onShapes([...shapes]);
      return;
    }
    const sq = this.sqAt(e.clientX, e.clientY);
    if (d.moved && sq && sq !== d.from) {
      const mv = this._findMove(d.from, sq);
      if (mv) { this._play(mv, true); return; }
      this.selected = null;
    }
    this.render();
  }
}
