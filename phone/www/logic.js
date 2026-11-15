// Логіка аналізатора, перенесена з chess_analyzer.py: класифікація ходів (як chess.com),
// точність, тренер, аналіз партії, база дебютів. Назви і пороги - ті самі, що в програмі для ПК.
import { Chess } from './chess.js';
import { D } from './data.js';

export const S = { lang: 'en' };
export const MATE = D.MATE_SCORE;
export const QUALITY = D.QUALITY;              // назва -> [колір, значок, пояснення]
export const BAD = new Set(D.BAD);
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const pick = (uk, en) => (S.lang === 'en' ? en : uk);
export const tr = uk => (S.lang === 'en' ? (D.TR_EN[uk] ?? uk) : uk);
export const qname = q => (S.lang === 'en' ? (D.QUALITY_EN[q] ?? q) : q);

// ------------------------------------------------------------- позиція ---
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FILES = 'abcdefgh';
export const sqName = (f, r) => FILES[f] + (r + 1);
export const fileOf = s => s.charCodeAt(0) - 97;
export const rankOf = s => s.charCodeAt(1) - 49;
const sqIndex = s => rankOf(s) * 8 + fileOf(s);
const other = c => (c === 'w' ? 'b' : 'w');

const STEPS = {
  n: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
  k: [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]],
};
const RAYS = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
RAYS.q = RAYS.b.concat(RAYS.r);

function attacksFrom(g, f, r, p) {
  const out = [];
  const ok = (ff, rr) => ff >= 0 && ff < 8 && rr >= 0 && rr < 8;
  if (p.type === 'p') {
    const d = p.color === 'w' ? 1 : -1;
    for (const df of [-1, 1]) if (ok(f + df, r + d)) out.push(sqName(f + df, r + d));
  } else if (p.type === 'n' || p.type === 'k') {
    for (const [df, dr] of STEPS[p.type]) if (ok(f + df, r + dr)) out.push(sqName(f + df, r + dr));
  } else {
    for (const [df, dr] of RAYS[p.type]) {
      let ff = f + df, rr = r + dr;
      while (ok(ff, rr)) {
        out.push(sqName(ff, rr));
        if (g[rr][ff]) break;
        ff += df; rr += dr;
      }
    }
  }
  return out;
}

/** Обгортка над chess.js з методами, як у python-chess (те, що потрібно тренеру й аналізу). */
export class Pos {
  constructor(fen = START_FEN) { this.c = new Chess(fen); this._legal = null; this._grid = null; }
  copy() { return new Pos(this.c.fen()); }
  fen() { return this.c.fen(); }
  get turn() { return this.c.turn(); }
  get fullmove() { return this.c.moveNumber(); }
  legal() { return (this._legal ??= this.c.moves({ verbose: true })); }
  find(uci) {
    if (!uci || uci.length < 4) return null;
    const from = uci.slice(0, 2), to = uci.slice(2, 4), pr = uci[4] || 'q';
    return this.legal().find(m => m.from === from && m.to === to && (!m.promotion || m.promotion === pr)) || null;
  }
  isLegal(uci) { return !!this.find(uci); }
  push(uci) {
    const m = this.find(uci);
    if (!m) throw new Error('illegal move ' + uci);
    this.c.move({ from: m.from, to: m.to, promotion: m.promotion });
    this._legal = null; this._grid = null;
    return m;
  }
  uciOf(m) { return m.from + m.to + (m.promotion || ''); }
  san(uci) { const m = this.find(uci); return m ? m.san : ''; }
  isCapture(uci) { const m = this.find(uci); return !!m && (m.flags.includes('c') || m.flags.includes('e')); }
  isCastling(uci) { const m = this.find(uci); return !!m && (m.flags.includes('k') || m.flags.includes('q')); }
  givesCheck(uci) { const m = this.find(uci); return !!m && /[+#]/.test(m.san); }
  isCheck() { return this.c.inCheck(); }
  isCheckmate() { return this.c.isCheckmate(); }
  isGameOver() { return this.c.isCheckmate() || this.c.isStalemate() || this.c.isInsufficientMaterial(); }
  grid() {
    if (!this._grid) { const b = this.c.board(); this._grid = []; for (let r = 0; r < 8; r++) this._grid.push(b[7 - r]); }
    return this._grid;
  }
  pieceAt(sq) { return this.grid()[rankOf(sq)][fileOf(sq)] || null; }
  /** Фігури у порядку python-chess piece_map(): від h8 до a1. */
  pieceMapDesc() {
    const g = this.grid(), out = [];
    for (let i = 63; i >= 0; i--) { const p = g[i >> 3][i & 7]; if (p) out.push([sqName(i & 7, i >> 3), p]); }
    return out;
  }
  attacks(sq) {
    const p = this.pieceAt(sq);
    if (!p) return [];
    return attacksFrom(this.grid(), fileOf(sq), rankOf(sq), p).sort((a, b) => sqIndex(a) - sqIndex(b));
  }
  attackers(color, sq) {
    const g = this.grid(), out = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const p = g[r][f];
      if (p && p.color === color && attacksFrom(g, f, r, p).includes(sq)) out.push(sqName(f, r));
    }
    return out;
  }
  king(color) {
    const g = this.grid();
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { const p = g[r][f]; if (p && p.type === 'k' && p.color === color) return sqName(f, r); }
    return null;
  }
  /** EPD як у python-chess: поле взяття на проході - лише якщо таке взяття справді можливе. */
  epd() {
    const p = this.c.fen().split(' ');
    let ep = p[3];
    if (ep !== '-' && !this.legal().some(m => m.flags.includes('e'))) ep = '-';
    return [p[0], p[1], p[2], ep].join(' ');
  }
}

export function material(b, color) {
  let s = 0;
  for (const row of b.grid()) for (const p of row) if (p && p.color === color) s += VAL[p.type] || 0;
  return s;
}
export const materialDiff = (b, color) => material(b, color) - material(b, other(color));

// ------------------------------------------------------------- тренер ---
const PNAME = { p: ['пішак', 'pawn'], n: ['кінь', 'knight'], b: ['слон', 'bishop'], r: ['тура', 'rook'], q: ['ферзь', 'queen'], k: ['король', 'king'] };
const PNAME_ACC = { p: ['пішака', 'pawn'], n: ['коня', 'knight'], b: ['слона', 'bishop'], r: ['туру', 'rook'], q: ['ферзя', 'queen'], k: ['короля', 'king'] };
const PNAME_A = { p: ['пішака', 'a pawn'], n: ['коня', 'a knight'], b: ['слона', 'a bishop'], r: ['туру', 'a rook'], q: ['ферзя', 'the queen'], k: ['короля', 'the king'] };
const pa = pt => pick(...PNAME_ACC[pt]);
export const pn = pt => pick(...PNAME[pt]);

function hanging(b, sq) {
  const p = b.pieceAt(sq);
  if (!p || p.type === 'k') return false;
  const att = b.attackers(other(p.color), sq);
  if (!att.length) return false;
  if (!b.attackers(p.color, sq).length) return true;
  return Math.min(...att.map(s => VAL[b.pieceAt(s).type] || 99)) < VAL[p.type];
}

function targets(b, sq) {
  const me = b.pieceAt(sq), out = [];
  for (const t of b.attacks(sq)) {
    const p = b.pieceAt(t);
    if (!p || p.color === me.color) continue;
    if (p.type === 'k' || VAL[p.type] > VAL[me.type] || (p.type !== 'p' && !b.attackers(p.color, t).length)) out.push([p.type, t]);
  }
  return out;
}

export function pvMoves(b, pv, limit) {
  const t = b.copy(), out = [];
  for (const u of (pv || []).slice(0, limit)) {
    if (!t.isLegal(u)) break;
    out.push(u); t.push(u);
  }
  return out;
}

/** Варіант у записі PGN: «13...Qc5+ 14. Kh1 Qxe5» (як board.variation_san у python-chess). */
export function variationSan(b, ucis) {
  const t = b.copy(), parts = [];
  ucis.forEach((u, i) => {
    const san = t.san(u);
    if (t.turn === 'w') parts.push(`${t.fullmove}. ${san}`);
    else parts.push(i === 0 ? `${t.fullmove}...${san}` : san);
    t.push(u);
  });
  return parts.join(' ');
}

const pvText = (b, pv, plies = 6) => { const m = pvMoves(b, pv, plies); return m.length ? variationSan(b, m) : ''; };

function pvGain(b, pv, color, base = 4) {
  const moves = pvMoves(b, pv, 10), t = b.copy(), start = materialDiff(t, color);
  for (let i = 0; i < moves.length; i++) {
    if (i >= base && !t.isCapture(moves[i])) break;
    t.push(moves[i]);
  }
  return materialDiff(t, color) - start;
}

function pvTrade(b, pv, color, base = 6) {
  const moves = pvMoves(b, pv, 10), t = b.copy(), took = { true: 0, false: 0 };
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    if (i >= base && !t.isCapture(mv)) break;
    if (t.isCapture(mv)) {
      const vic = t.pieceAt(mv.slice(2, 4));
      const pt = vic ? vic.type : 'p';
      const side = t.turn === color;
      if (!took[side] || VAL[pt] > VAL[took[side]]) took[side] = pt;
    }
    t.push(mv);
  }
  return [took[true], took[false]];
}

function gainWords(n) {
  if (n >= 9) return pick('ферзя', 'the queen');
  if (n >= 5) return pick('туру', 'a rook');
  if (n >= 3) return pick('фігуру', 'a piece');
  if (n === 2) return pick('два пішаки', 'two pawns');
  return pick('пішака', 'a pawn');
}

export function moveFacts(b, u) {
  const a = b.copy(); a.push(u);
  const from = u.slice(0, 2), to = u.slice(2, 4);
  const piece = b.pieceAt(from), me = b.turn, facts = [];
  if (b.isCastling(u)) facts.push(pick('рокіровка: король у безпеці, тура активніша', 'castling: the king gets safety, the rook gets active'));
  if (b.isCapture(u)) {
    const vic = b.pieceAt(to), vt = vic ? vic.type : 'p';
    facts.push(pick(`бере ${pa(vt)}`, `takes the ${pa(vt)}`));
  }
  if (a.isCheckmate()) { facts.push(pick('мат!', 'checkmate!')); return facts; }
  if (a.isCheck()) facts.push(pick('шах', 'check'));
  if (u.length > 4) facts.push(pick('перетворення пішака', 'pawn promotion'));
  if (!piece) return facts;

  const tg = targets(a, to);
  if (tg.length >= 2) {
    const n0 = pa(tg[0][0]), n1 = pa(tg[1][0]);
    facts.push(pick(`вилка: атакує ${n0} і ${n1}`, `fork: attacks the ${n0} and the ${n1}`));
  } else if (tg.length && tg[0][0] !== 'k') {
    const [pt, t] = tg[0];
    facts.push(pick(`атакує ${pa(pt)} на ${t}`, `attacks the ${pa(pt)} on ${t}`));
  }
  if (piece.type !== 'p' && hanging(b, from) && !hanging(a, to))
    facts.push(pick(`відводить ${pa(piece.type)} з-під удару`, `moves the ${pa(piece.type)} out of danger`));
  for (const [sq, p] of b.pieceMapDesc()) {
    if (p.color === me && sq !== from && hanging(b, sq) && !hanging(a, sq) && a.attackers(me, sq).includes(to)) {
      facts.push(pick(`захищає ${pa(p.type)} на ${sq}`, `defends the ${pa(p.type)} on ${sq}`));
      break;
    }
  }
  const early = b.fullmove <= 10, pt = piece.type;
  if ((pt === 'n' || pt === 'b') && (rankOf(from) === 0 || rankOf(from) === 7) && early) facts.push(pick('розвиток фігури', 'develops a piece'));
  if (pt === 'p' && ['e4', 'd4', 'e5', 'd5'].includes(to)) facts.push(pick('займає центр', 'takes the center'));
  if (pt === 'p' && early && (fileOf(from) === 5 || fileOf(from) === 6)) {
    const k = b.king(me);
    if (k && fileOf(k) === 4) facts.push(pick('послаблює укриття короля', "weakens the king's shelter"));
  }
  if (pt === 'q' && b.fullmove <= 5 && !facts.length) facts.push(pick('ранній вихід ферзя: його можуть ганяти фігури суперника', 'early queen move: enemy pieces can chase it'));
  if (pt === 'k' && !b.isCastling(u) && !facts.length) facts.push(pick('хід короля', 'king move'));
  return facts;
}

export function bookNote(row) {
  if (!(row.book && row.opening)) return [];
  if (row.book_bad) return [pick(`📖 Хід є в дебютній теорії (${row.opening}), але рушій вважає його слабким`,
    `📖 This move is in opening theory (${row.opening}), but the engine considers it weak`)];
  return [pick(`📖 Дебютна теорія: ${row.opening}`, `📖 Opening theory: ${row.opening}`)];
}

/** Пояснення ходу тренером (якість ходу й оцінку тренер не показує). */
export function coachLines(fenBefore, uci, quality, bestSan, peBefore, peAfter) {
  peBefore = peBefore || {}; peAfter = peAfter || {};
  const b = new Pos(fenBefore);
  const san = b.san(uci), me = b.turn;
  const a = b.copy(); a.push(uci);
  const facts = moveFacts(b, uci);
  const lines = [`${san}: ` + (facts.length ? facts : [pick('тихий хід', 'quiet move')]).join('; ')];
  if (a.isGameOver()) return lines;

  const pvAfter = peAfter.pv || (peAfter.best ? [peAfter.best] : []);
  if (BAD.has(quality)) {
    const cp = peAfter.cp || 0, myCp = me === 'w' ? cp : -cp;
    const line = pvText(a, pvAfter);
    const head = quality === 'Неточність' ? pick('Чому неточно', "Why it's inaccurate") : pick('Чому погано', "Why it's bad");
    let checks = false;
    const t = a.copy();
    for (const mv of pvMoves(a, pvAfter, 6)) { if (t.turn !== me && t.givesCheck(mv)) checks = true; t.push(mv); }
    const gain = pvGain(b, [uci, ...pvAfter], other(me), 6);
    let why;
    if (myCp <= -(MATE - 100)) why = pick('суперник ставить мат', 'the opponent has a forced mate');
    else if (gain >= 1) {
      const [mine, theirs] = pvTrade(b, [uci, ...pvAfter], me);
      if (mine && theirs && VAL[theirs] > VAL[mine])
        why = pick(`хід віддає ${PNAME_A[theirs][0]} лише за ${PNAME_A[mine][0]}`, `the move gives up ${PNAME_A[theirs][1]} for just ${PNAME_A[mine][1]}`);
      else why = pick(`суперник виграє ${gainWords(gain)}`, `the opponent wins ${gainWords(gain)}`);
    } else if (checks) why = pick('король стає вразливим', 'the king becomes exposed');
    else if (quality === 'Пропуск') why = pick('перевага втрачена', 'the advantage slips away');
    else why = pick('суперник отримує кращу гру', 'the opponent gets the better game');
    lines.push(`${head}: ${why}` + (line ? ` — ${line}` : ''));

    if (bestSan && bestSan !== san && peBefore.best) {
      const best = peBefore.best, details = [];
      if (b.isLegal(best)) {
        const g = pvGain(b, peBefore.pv || [best], me);
        let bcp = 0;
        if (peBefore.cp != null) {
          bcp = me === 'w' ? peBefore.cp : -peBefore.cp;
          if (bcp >= MATE - 100) details.push(pick('веде до мату', 'leads to mate'));
        }
        if (!details.length && g >= 1 && bcp >= 100) details.push(pick(`виграє ${gainWords(g)}`, `wins ${gainWords(g)}`));
        details.push(...moveFacts(b, best));
      }
      let txt = pick(`Краще було ${bestSan}`, `Better was ${bestSan}`);
      if (details.length) txt += ': ' + details.slice(0, 2).join('; ');
      lines.push(txt);
    }
    return lines;
  }

  if (pvAfter.length && a.isLegal(pvAfter[0])) {
    const r = pvAfter[0], rs = a.san(r);
    const c = a.copy(); c.push(r);
    const gain = pvGain(b, [uci, ...pvAfter], other(me));
    let text;
    if (c.isCheckmate()) text = pick(`Загроза мату: ${rs}`, `Mate threat: ${rs}`);
    else if (gain >= 1 && r.slice(2, 4) === uci.slice(2, 4) && a.isCapture(r))
      text = pick(`Жертва: після ${rs} у суперника більше матеріалу, але рушій вважає хід добрим`,
        `Sacrifice: after ${rs} the opponent is up material, but the engine considers the move good`);
    else {
      const rf = moveFacts(a, r);
      text = pick(`Суперник, ймовірно, відповість ${rs}`, `The opponent will likely reply ${rs}`);
      if (rf.length) text += ` (${rf.slice(0, 2).join('; ')})`;
    }
    lines.push(text);
  }
  return lines;
}

// ------------------------------------------------------------- оцінка ---
const logistic = (cp, k) => 100 / (1 + Math.exp(-k * cp));

/** Крутизна кривої шансів: без рейтингу - стала lichess, з рейтингом - як у chess.com (rating_k у програмі для ПК). */
export function ratingK(rating = null) {
  if (!rating) return D.WIN_K;
  const [k0, k1, lo, hi] = D.RATING_K;
  return k0 + k1 * Math.min(Math.max(rating, lo), hi);
}

/** Очікувані очки (0-100) за оцінкою рушія з точки зору гравця: крива lichess з крутизною за рейтингом. */
export function expectedPoints(cp, rating = null) { return logistic(cp, ratingK(rating)); }

/** Win% точно як у lichess: оцінка обмежена ±10 пішаками. */
export const lichessWin = cp => logistic(Math.max(-1000, Math.min(1000, cp)), D.WIN_K);

/** Точність ходу за оцінками до і після ходу (сталі підібрано за числами chess.com). */
export function moveAccuracy(cpBefore, cpAfter) {
  const loss = Math.max(0, logistic(cpBefore, D.ACC_K) - logistic(cpAfter, D.ACC_K));
  return 100 * Math.exp(-D.ACC_DECAY * loss);
}

/** Точність партії: степеневе середнє точностей ходів. */
export function gameAccuracy(accs) {
  if (!accs.length) return 0;
  return (accs.reduce((x, a) => x + Math.max(1, a) ** D.ACC_POWER, 0) / accs.length) ** (1 / D.ACC_POWER);
}

const zone = w => (w < 35 ? 0 : w < 65 ? 1 : 2);

/** Межа «партія ще не виграна» для «Геніального»: новачкам щедріше (competitive_limit у програмі для ПК). */
export function competitiveLimit(rating = null) {
  const [hi, lo, r0, r1, def] = D.BRILLIANT_LIMIT;
  const r = rating || def;
  return hi - (hi - lo) * Math.min(Math.max((r - r0) / (r1 - r0), 0), 1);
}

/** Класифікація ходу за схемою chess.com Classification V2 (як grade() у програмі для ПК). */
export function grade(drop, isBest, winB, winA, sacrifice, secondW, prevDrop, recapture, rating = null, missedMate = false,
  soundLoss = null, endgame = false, hard = false) {
  const generous = rating != null && rating < 1200;
  const minSac = 1;            // 1.25.12: жертва фігури, навіть якщо повертається до двох пішаків            // жертва фігури або якості - на будь-якому рейтингу
  const baseline = isBest && secondW != null ? secondW : winB;
  // Геніальний (chess.com): добра жертва фігури, позиція після неї не погана, без неї партія ще не виграна;
  // в ендшпілі - лише якщо це єдиний добрий хід
  if (soundLoss == null) soundLoss = drop;
  const onlyGood = isBest && secondW != null && winB - secondW >= 10;
  // 1.27.5 (користувач): «Геніальний» і в уже виграній позиції - умову «без цього ходу ще не виграно» прибрано
  if (sacrifice >= minSac && drop <= 5 && soundLoss <= 2 && winA >= 45 && (onlyGood || !endgame)) return 'Геніальний';
  // 1.25.6: «Чудовий» - найкращий хід, який дуже важко помітити (рушій на малій глибині його не бачить)
  if (greatCandidate(isBest, recapture, winB, secondW) && hard) return 'Чудовий';
  if (isBest) return 'Найкращий';
  if (missedMate) return 'Пропуск';
  if (drop <= 2) return 'Відмінний';
  if (drop <= 5) return 'Добрий';
  const base = drop <= 10 ? 'Неточність' : drop <= 20 ? 'Помилка' : 'Груба помилка';
  if (prevDrop >= 10 && winB >= 65 && winA < 65 && winA >= 35) return 'Пропуск';
  const gift = winB - prevDrop;          // наші очікувані очки до помилки суперника
  if (prevDrop >= 10 && winA >= gift - 5) return 'Пропуск';
  // те саме за класом позиції: помилка суперника перевела в кращий клас, а хід повернув туди, де були до неї
  if (prevDrop >= 10 && zone(winB) > zone(gift) && zone(winA) >= zone(gift)) return 'Пропуск';
  return base;
}

export function fmtEval(cp) {
  if (Math.abs(cp) >= MATE - 100) {
    const n = MATE - Math.abs(cp), sign = cp > 0 ? '+' : '-';
    return n ? `${sign}M${n}` : `${sign}M`;
  }
  const v = cp / 100;
  return (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(2);
}

/** Стислий опис позиції: оцінка (для білих), найкращий хід, головний і другий варіанти. */
export function posEval(infos, reqDepth = null) {
  const pv = infos[0].pv || [];
  return { cp: infos[0].cp, best: pv[0] || null, pv: pv.slice(0, 10), second: infos.length > 1 ? infos[1].cp : null,
    depth: infos[0].depth ?? null, req_depth: reqDepth };
}

// ------------------------------------------------------------- дебюти ---
export class Book {
  constructor(json) { this.book = json.book; this.next = json.next; }
  has(epd) { return Object.prototype.hasOwnProperty.call(this.book, epd); }
  name(epd) { const v = this.book[epd]; return v ? v : null; }
}

// ------------------------------------------------------------- аналіз ---
// Жертва (1.23.1, як sacrifice_amount у програмі для ПК): після ходу суперник може взяти ФІГУРУ (не пішака) і
// лишитися з матеріалом - бере він чи ні. Не жертва: розмін; фігура, що висіла ще до ходу; «втрата замість
// втрати» (фігура, що пішла, сама була під боєм); те, що хід сам узяв, віднімається.
const SEE_ORDER = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
// Нижче працюємо прямо з chess.js: _moves() дає дозволені ходи без запису нотації (moves({verbose}) рахує її
// для кожного ходу й у сотні разів повільніший), _makeMove()/_undoMove() - хід і повернення. Поля - у форматі 0x88.
const to88 = sq => (7 - rankOf(sq)) * 16 + fileOf(sq);
const from88 = s => (7 - (s >> 4)) * 8 + (s & 15);           // номер поля, як у python-chess (a1 = 0 ... h8 = 63)
const rawChess = fen => new Chess(fen, { skipValidation: true });

/** Скільки матеріалу виграє сторона, чий хід, розміном на полі sq (бере найдешевшою фігурою, може не брати). */
function see(c, sq) {
  const victim = c._board[sq];
  if (!victim || victim.type === 'k') return 0;
  let best = null, bk = 0;
  for (const m of c._moves({ legal: true })) {
    if (m.to !== sq || (m.promotion && m.promotion !== 'q')) continue;
    const key = SEE_ORDER[m.piece] * 100 + from88(m.from);
    if (best === null || key < bk) { best = m; bk = key; }
  }
  if (!best) return 0;
  c._makeMove(best);
  const reply = see(c, sq);
  c._undoMove();
  return Math.max(0, VAL[victim.type] + (best.promotion ? 8 : 0) - reply);
}

/** Найбільше, що сторона, чий хід, може виграти одним розміном будь-де на дошці. */
function bestCapture(c) {
  const me = c._turn;
  let best = 0;
  for (let i = 0; i < 120; i++) {
    if (i & 0x88) { i += 7; continue; }
    const p = c._board[i];
    if (!p || p.color === me || p.type === 'k' || !c._attacked(me, i)) continue;
    best = Math.max(best, see(c, i));
  }
  return best;
}

/** Ендшпіль за правилом lichess: не більше шести фігур без королів і пішаків. */
export function isEndgame(b) {
  let n = 0;
  for (const [, p] of b.pieceMapDesc()) if (p.type !== 'p' && p.type !== 'k') n++;
  return n <= 6;
}

export function sacrificeAmount(board, uci, after) {
  if (board.isCheck()) return 0;                      // вихід з-під шаху - вимушений хід, не жертва
  const mover = board.turn, opp = other(mover), from = uci.slice(0, 2), to = uci.slice(2, 4);
  const mv = board.find(uci);
  let gained = mv.captured ? VAL[mv.captured] : 0;
  if (mv.promotion) gained += VAL[mv.promotion] - 1;
  const ca = rawChess(after.fen());
  let caps = null, flipped = null, riskMoved = null, best = 0;
  for (const [sq, p] of after.pieceMapDesc()) {
    if (p.color !== mover || p.type === 'p' || p.type === 'k') continue;
    const s88 = to88(sq);
    if (!ca._attacked(opp, s88)) continue;
    let pre = 0;
    if (sq !== to) {
      if (!flipped) {                                 // та сама позиція, але ходить суперник: що вже було під боєм
        const f = board.fen().split(' ');
        f[1] = opp; f[3] = '-';
        flipped = rawChess(f.join(' '));
      }
      if (see(flipped, s88) > 0) continue;            // висіла ще до ходу
      if (riskMoved === null) riskMoved = see(flipped, to88(from));
      pre = riskMoved;
    }
    caps ??= ca._moves({ legal: true });
    let worst = 0;
    for (const c of caps) {
      if (c.to !== s88 || (c.promotion && c.promotion !== 'q')) continue;
      ca._makeMove(c);
      worst = Math.max(worst, VAL[p.type] + (c.promotion ? 8 : 0) - bestCapture(ca));
      ca._undoMove();
    }
    best = Math.max(best, worst - gained - pre);
  }
  return Math.max(0, best);
}

/**
 * Оцінює один хід. board - позиція ДО ходу, hist - {root, moves} цієї позиції (для рушія),
 * peBefore - posEval цієї позиції. Повертає [рядок результату, posEval після ходу].
 */
export function greatCandidate(isBest, recapture, winB, secondW) {
  return isBest && !recapture && secondW != null && winB < D.WON_ANYWAY && winB - secondW >= D.GREAT_GAP;
}

/** Хід важко помітити: рушій без хешу на глибинах HARD_DEPTHS обирає інший хід. */
export async function hardToFind(eng, hist, uci) {
  try {
    for (const d of D.HARD_DEPTHS) {
      await eng.clearHash();
      const r = await eng.analyse(hist.root, hist.moves, d, 1);
      if (r[0] && r[0].pv && r[0].pv[0] === uci) return false;
    }
    return true;
  } catch (_) { return false; }
}

/** Скільки матеріалу хід втрачає порівняно з найкращим (за варіантами рушія, як pvGain). */
export function blunderMaterial(board, uci, after, peBefore, peAfter, mover) {
  const best = pvGain(board, peBefore.pv || [], mover, 6);
  let played = materialDiff(after, mover) - materialDiff(board, mover);
  if (!after.isGameOver()) played += pvGain(after, peAfter.pv || [], mover, 5);
  return best - played;
}

export async function evaluateMove(eng, depth, board, hist, uci, peBefore, prevDrop = 0, prevCap = null, rating = null, bookHit = false, checkHard = true) {
  const mover = board.turn, sign = mover === 'w' ? 1 : -1;
  const beforeM = sign * peBefore.cp;
  const best = peBefore.best || null;
  const secondM = peBefore.second != null ? sign * peBefore.second : null;
  const bestSan = best ? board.san(best) : '';
  const playedSan = board.san(uci);
  const label = mover === 'w' ? `${board.fullmove}.` : `${board.fullmove}…`;
  const d0 = materialDiff(board, mover);
  const isCap = board.isCapture(uci);
  const recapture = isCap && prevCap === uci.slice(2, 4);
  const after = board.copy(); after.push(uci);
  let sacrifice = 0, peAfter;
  if (after.isCheckmate()) peAfter = { cp: mover === 'w' ? MATE : -MATE, best: null, second: null };
  else if (after.isGameOver()) peAfter = { cp: 0, best: null, second: null };
  else {
    peAfter = posEval(await eng.analyse(hist.root, [...hist.moves, uci], depth), depth);
    sacrifice = sacrificeAmount(board, uci, after);
  }
  const afterM = sign * peAfter.cp;
  const winB = expectedPoints(beforeM, rating), winA = expectedPoints(afterM, rating);
  const drop = Math.max(0, winB - winA);
  const secondW = secondM != null ? expectedPoints(secondM, rating) : null;
  const loss = Math.max(0, beforeM - afterM);
  const isBest = best != null && best === uci;
  const missedMate = beforeM >= MATE - 100 && afterM < MATE - 100;
  const soundLoss = Math.max(0, lichessWin(beforeM) - lichessWin(afterM));
  // checkHard=false (аналіз партії): перевірка після всіх ходів, щоб очищення хешу не змінювало оцінок
  const great = greatCandidate(isBest, recapture, winB, secondW);
  const hard = great && checkHard && await hardToFind(eng, hist, uci);
  let quality = grade(drop, isBest, winB, winA, sacrifice, secondW, prevDrop, recapture, rating, missedMate, soundLoss, isEndgame(board), hard);
  // 1.25.15: «Пропуск» лише якщо найкращий хід вигравав матеріал (більше пішака) або мат
  if (quality === 'Пропуск' && !missedMate && zone(winA) >= zone(winB) && blunderMaterial(board, uci, after, peBefore, peAfter, mover) < D.MISS_MATERIAL
    && Math.max(Math.abs(beforeM), Math.abs(afterM)) < MATE - 100)
    quality = grade(drop, isBest, winB, winA, sacrifice, secondW, 0, recapture, rating, false, soundLoss, isEndgame(board), hard);
  // 1.22.2: хід, рівноцінний найкращому (втрата до 0.5 очікуваних очок - шум рушія), - теж «Найкращий»;
  // але не тоді, коли в оцінці мат і він став гіршим (довший свій або ближчий чужий)
  const mateWorse = afterM < beforeM && Math.max(Math.abs(beforeM), Math.abs(afterM)) >= MATE - 100;
  if (quality === 'Відмінний' && (afterM >= beforeM || (drop <= D.BEST_TOLERANCE && !mateWorse))) quality = 'Найкращий';
  // 1.25.13 (правило користувача): віддав пішака чи менше - «Помилка», не «Груба помилка»
  if (quality === 'Груба помилка' && drop < D.BLUNDER_SURE && blunderMaterial(board, uci, after, peBefore, peAfter, mover) <= 1
    && Math.max(Math.abs(beforeM), Math.abs(afterM)) < MATE - 100) quality = 'Помилка';
  const bookBad = bookHit && BAD.has(quality) && afterM < -D.BOOK_MAX_DEFICIT;
  if (bookBad) bookHit = false;
  else if (bookHit) quality = 'Теорія';
  const acc = bookHit ? 100 : moveAccuracy(beforeM, afterM);
  return [{
    label, san: playedSan, uci, best_uci: best, best_san: bestSan, loss: Math.trunc(loss), quality,
    book: bookHit || bookBad, book_bad: bookBad, opening: '', fen: after.fen(), acc,
    drop: bookHit ? 0 : drop, cap_sq: isCap ? uci.slice(2, 4) : null, ...(great && !checkHard && quality === 'Найкращий' ? { _great: true } : {}),
    // 1.26.6: тут був «Геніальний» хід (best_san), але зіграно інший
    ...(quality !== 'Геніальний' && quality !== 'Теорія' && !isBest && missedBrilliant(board, peBefore, rating) ? { missed_bril: true } : {}),
  }, peAfter];
}

/** 1.26.6: чи був найкращий хід рушія «Геніальним» (як missed_brilliant у ПК: drop 0, позиція після = до). */
export function missedBrilliant(board, peBefore, rating = null) {
  const best = peBefore && peBefore.best;
  if (!best || !board.find(best)) return false;
  const sign = board.turn === 'w' ? 1 : -1;
  const winB = expectedPoints(sign * peBefore.cp, rating);
  const secondW = peBefore.second != null ? expectedPoints(sign * peBefore.second, rating) : null;
  const after = board.copy(); after.push(best);
  if (after.isGameOver()) return false;
  return grade(0, true, winB, winB, sacrificeAmount(board, best, after), secondW, 0, false, rating, false, 0,
    isEndgame(board), false) === 'Геніальний';
}

const elo = v => { const n = parseInt(v, 10); return Number.isFinite(n) && String(n) === String(v).trim() ? n : null; };

/** Аналіз партії: game = {root, moves: [uci], headers}. */
export async function analyzeGame(eng, game, depth, { progress, cancelled, book } = {}) {
  if (!game.moves.length) throw new Error(tr('У партії немає жодного ходу.'));
  const h = game.headers || {};
  const ratings = { w: elo(h.WhiteElo), b: elo(h.BlackElo) };
  const board = new Pos(game.root);
  const hist = { root: game.root, moves: [] };
  const fens = [board.fen()], evals = [], posInfo = [], bookPath = [!!book], rows = [];
  const acc = { w: [], b: [] };
  const counts = { w: Object.fromEntries(Object.keys(QUALITY).map(q => [q, 0])), b: Object.fromEntries(Object.keys(QUALITY).map(q => [q, 0])) };
  await eng.newGame();
  let peBefore = posEval(await eng.analyse(game.root, [], depth), depth);
  evals.push(peBefore.cp); posInfo.push(peBefore);
  let prevDrop = 0, prevCap = null, inBook = true, opening = null;
  for (let i = 0; i < game.moves.length; i++) {
    if (cancelled && cancelled()) throw new Error(tr('Скасовано.'));
    const move = game.moves[i], mover = board.turn;
    let bookHit = false;
    if (inBook && book) {
      const tmp = board.copy(); tmp.push(move);
      const key = tmp.epd();
      if (book.has(key)) { bookHit = true; if (book.name(key)) opening = book.name(key); }
      else inBook = false;
    }
    const [row, peAfter] = await evaluateMove(eng, depth, board, hist, move, peBefore, prevDrop, prevCap, ratings[mover], bookHit, false);
    if (opening && bookHit) row.opening = `${opening[0]} · ${opening[1]}`;
    const stillBook = row.quality === 'Теорія';
    if (!stillBook) inBook = false;
    bookPath.push(stillBook);
    board.push(move); hist.moves.push(move);
    fens.push(row.fen); evals.push(peAfter.cp); posInfo.push(peAfter);
    counts[mover][row.quality] += 1; acc[mover].push(row.acc); rows.push(row);
    prevDrop = row.drop; prevCap = row.cap_sq; peBefore = peAfter;
    // знімок уже проаналізованих ходів (1.22.0): їх можна дивитися, поки аналіз іде далі
    if (progress) progress(i + 1, game.moves.length, { fens: [...fens], evals: [...evals], pos_info: [...posInfo],
      moves: [...rows], summary: summarize(), book_path: [...bookPath], depth, partial: true, total: game.moves.length });
  }
  // «Чудовий» (1.25.6): найкращі ходи з великим розривом - чи важко їх помітити
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i]._great) continue;
    delete rows[i]._great;
    if (await hardToFind(eng, { root: game.root, moves: game.moves.slice(0, i) }, game.moves[i])) {
      const mover = fens[i].split(' ')[1];
      counts[mover][rows[i].quality] -= 1; rows[i].quality = 'Чудовий'; counts[mover]['Чудовий'] += 1;
    }
  }
  return { fens, evals, pos_info: posInfo, moves: rows, summary: summarize(), book_path: bookPath, depth };
  function summarize() {
    const avg = gameAccuracy;
    return {
      white: h.White || 'Білі', black: h.Black || 'Чорні', white_elo: h.WhiteElo || '', black_elo: h.BlackElo || '',
      result: h.Result || '*', opening, white_rating: ratings.w, black_rating: ratings.b,
      white_acc: avg(acc.w), black_acc: avg(acc.b), white_counts: { ...counts.w }, black_counts: { ...counts.b },
    };
  }
}

// ------------------------------------------------------------- ШІ-тренер ---
// З 1.23.2 (як ai_facts / fetch_ai_coach у програмі для ПК): модель Gemma 4 на безплатному Cloudflare Workers AI
// переказує живою мовою факти від Stockfish. Ключів у програмі немає.
const AI_VERDICT = {
  'Геніальний': ['сильна жертва: хід віддає матеріал, але це найкращий або майже найкращий хід, і позиція лишається доброю',
    'a strong sacrifice: the move gives up material, but it is the best or nearly best move and the position stays good'],
  'Чудовий': ['найкращий хід, який дуже важко помітити (інші ходи помітно гірші)', 'the best move, and a very hard one to spot (other moves are clearly worse)'],
  'Найкращий': ['найкращий хід', 'the best move'],
  'Відмінний': ['дуже добрий хід, майже такий самий, як найкращий', 'a very good move, almost as good as the best one'],
  'Добрий': ['непоганий хід, але був трохи кращий', 'a decent move, but there was a slightly better one'],
  'Теорія': ['відомий дебютний хід', 'a known opening move'],
  'Неточність': ['неточний хід: частина переваги втрачається', 'an inaccurate move: part of the advantage is lost'],
  'Помилка': ['помилковий хід: позиція помітно погіршується', 'a mistake: the position gets clearly worse'],
  'Груба помилка': ['груба помилка: позиція сильно погіршується', 'a serious error: the position gets much worse'],
  'Пропуск': ['пропущена нагода: суперник щойно помилився, а цей хід цим не скористався',
    'a missed chance: the opponent just erred, and this move did not take advantage of it'],
};

const movesWord = n => (n % 10 === 1 && n % 100 !== 11 ? 'хід' : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? 'ходи' : 'ходів');

function pvCaptures(b, pv, base = 4) {
  const took = { w: [], b: [] }, t = b.copy(), moves = pvMoves(b, pv, 10);
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i], cap = t.isCapture(mv);
    if (i >= base && !cap) break;
    if (cap) { const vic = t.pieceAt(mv.slice(2, 4)); took[t.turn].push(vic ? vic.type : 'p'); }
    t.push(mv);
  }
  return took;
}

/** Факти для ШІ-тренера мовою інтерфейсу - усе з даних Stockfish. */
export function aiFacts(fenBefore, uci, quality, bestSan, peBefore, peAfter) {
  peBefore = peBefore || {}; peAfter = peAfter || {};
  const b = new Pos(fenBefore), me = b.turn, san = b.san(uci);
  const a = b.copy(); a.push(uci);
  const side = me === 'w' ? pick('білі', 'White') : pick('чорні', 'Black');
  const out = [pick(`Ходять ${side}. Зіграний хід: ${san}.`, `${side} to move. Move played: ${san}.`)];
  if (AI_VERDICT[quality]) out.push(pick('Висновок рушія про хід: ', "Engine's verdict on the move: ") + pick(...AI_VERDICT[quality]) + '.');
  if (a.isCheckmate()) { out.push(pick('Хід ставить мат.', 'The move gives checkmate.')); return out.join('\n'); }
  const cp = peAfter.cp;
  if (cp != null) {
    const my = me === 'w' ? cp : -cp;
    let w;
    if (Math.abs(my) >= MATE - 100) {
      const n = Math.max(1, MATE - Math.abs(my));
      w = my > 0 ? pick(`${side} ставлять мат за ${n} ${movesWord(n)}`, `${side} can force mate in ${n}`)
        : pick(`суперник ставить мат за ${n} ${movesWord(n)}`, `the opponent can force mate in ${n}`);
    } else if (Math.abs(my) < 50) w = pick('приблизно рівна', 'roughly equal');
    else {
      const lead = Math.abs(my);
      const size = lead < 150 ? pick('невелика', 'a small') : lead < 400 ? pick('помітна', 'a clear') : pick('вирішальна', 'a decisive');
      const who = my > 0 ? pick(me === 'w' ? 'у білих' : 'у чорних', side) : pick('у суперника', 'the opponent');
      w = pick(`${size} перевага ${who}`, `${size} advantage for ${who}`);
    }
    out.push(pick('Позиція після ходу: ', 'Position after the move: ') + w + '.');
  }
  const pvAfter = (peAfter.pv && peAfter.pv.length) ? peAfter.pv : (peAfter.best ? [peAfter.best] : []);
  if (pvAfter.length) {
    const line = pvText(a, pvAfter, 8);
    if (line) {
      out.push(pick('Варіант рушія після ходу: ', 'Engine line after the move: ') + line + '.');
      const took = pvCaptures(a, pvAfter), opp = other(me);
      const names = ts => ts.map(t => pick(...PNAME_A[t])).join(', ');
      const parts = [];
      if (took[opp].length) parts.push(pick(`суперник забирає ${names(took[opp])}`, `the opponent takes ${names(took[opp])}`));
      if (took[me].length) parts.push(pick(`${side} забирають ${names(took[me])}`, `${side} take ${names(took[me])}`));
      if (parts.length) out.push(pick('За цим варіантом ', 'In this line ') + parts.join('; ') + '.');
    }
  }
  if (bestSan && bestSan !== san && !['Найкращий', 'Геніальний', 'Чудовий', 'Теорія'].includes(quality)) {
    const line = (peBefore.pv && peBefore.pv.length ? pvText(b, peBefore.pv, 6) : '') || bestSan;
    out.push(pick(`Найкращий хід рушія був ${bestSan} (варіант: ${line}).`, `The engine's best move was ${bestSan} (line: ${line}).`));
  }
  try {
    const coach = coachLines(fenBefore, uci, quality, bestSan, peBefore, peAfter);
    if (coach && coach.length) out.push(pick('Що помітив тренер:', 'What the coach noticed:') + '\n' + coach.join('\n'));
  } catch (_) { /* */ }
  return out.join('\n').slice(0, 2400);
}

const PNAME_N = { p: ['пішак', 'pawn'], n: ['кінь', 'knight'], b: ['слон', 'bishop'], r: ['тура', 'rook'], q: ['ферзь', 'queen'], k: ['король', 'king'] };

/** Факти про позицію для запитання до ШІ-тренера (1.23.5) - як ask_facts у ПК. */
export function askFacts(fen, pe, sans = [], last = null) {
  pe = pe || {};
  const b = new Pos(fen), white = b.turn === 'w';
  const out = [pick('Позиція (FEN): ', 'Position (FEN): ') + fen,
    pick(white ? 'Ходять білі.' : 'Ходять чорні.', white ? 'White to move.' : 'Black to move.')];
  for (const color of ['w', 'b']) {
    const parts = [];
    for (const pt of ['k', 'q', 'r', 'b', 'n', 'p']) {
      const sq = [];
      for (let r = 1; r <= 8; r++) for (const f of 'abcdefgh') {
        const pc = b.pieceAt(f + r);
        if (pc && pc.type === pt && pc.color === color) sq.push(f + r);
      }
      if (sq.length) parts.push(pick(...PNAME_N[pt]) + ' ' + sq.join(', '));
    }
    out.push(pick(color === 'w' ? 'Білі: ' : 'Чорні: ', color === 'w' ? 'White: ' : 'Black: ') + parts.join('; ') + '.');
  }
  const over = b.isGameOver();
  if (b.isCheckmate()) out.push(pick('Це мат.', 'This is checkmate.'));
  else if (b.c.isStalemate()) out.push(pick('Це пат (нічия).', 'This is stalemate (a draw).'));
  else if (b.isCheck()) out.push(pick('Король під шахом.', 'The king is in check.'));
  const cp = pe.cp;
  if (cp != null && !over) {
    let w;
    if (Math.abs(cp) >= MATE - 100) {
      const n = Math.max(1, MATE - Math.abs(cp)), who = pick(cp > 0 ? 'білі' : 'чорні', cp > 0 ? 'White' : 'Black');
      w = pick(`${who} ставлять мат за ${n} ${movesWord(n)}`, `${who} can force mate in ${n}`);
    } else if (Math.abs(cp) < 50) w = pick('приблизно рівна', 'roughly equal');
    else {
      const a = Math.abs(cp);
      const size = a < 150 ? pick('невелика', 'a small') : a < 400 ? pick('помітна', 'a clear') : pick('вирішальна', 'a decisive');
      w = pick(`${size} перевага ${cp > 0 ? 'білих' : 'чорних'}`, `${size} advantage for ${cp > 0 ? 'White' : 'Black'}`);
    }
    out.push(pick('Оцінка Stockfish: ', 'Stockfish evaluation: ') + w + '.');
  }
  const pv = (pe.pv && pe.pv.length) ? pe.pv : (pe.best ? [pe.best] : []);
  if (pv.length && !over) {
    const line = pvText(b, pv, 10);
    if (line) out.push(pick('Найкращий хід за Stockfish: ', "Stockfish's best move: ") + b.san(pvMoves(b, pv, 1)[0]) + '. '
      + pick('Варіант рушія: ', 'Engine line: ') + line + '.');
  }
  const legal = b.legal().map(m => m.san);
  if (legal.length) out.push(pick('Можливі ходи: ', 'Legal moves: ') + legal.slice(0, 60).join(', ') + '.');
  if (sans && sans.length) {
    const start = Math.max(0, sans.length - 60);
    const txt = sans.map((s, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : '') + s).filter((_, i) => i >= start).join(' ');
    out.push(pick('Ходи партії до цієї позиції: ', 'Game moves up to this position: ') + txt);
  }
  if (last) {
    try { out.push(pick('Про останній хід:', 'About the last move:') + '\n' + aiFacts(...last).slice(0, 1200)); } catch (_) { /* */ }
  }
  return out.join('\n').slice(0, 4000);
}

// ------------------------------------------------------------------ боти (1.24.0) ---
// Як у ПК: бот - Stockfish на силі гравця + дебютний репертуар + стиль (bot_book_move, bot_style_bonus, bot_choose).
const BOT_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const sqDist = (a, b) => Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(+a[1] - +b[1]));

/** Наступний хід з репертуару бота, якщо партія досі йде одним з його варіантів (інакше null). */
export function botBookMove(bot, ucis, white) {
  const n = ucis.length, key = ucis.join(' ');
  if (bot.id === 'wittyalien' && D.WITTY_BOOK) {      // 1.27.4: його ходи з тією ж частотою, що в його партіях
    const raw = D.WITTY_BOOK[white ? 'w' : 'b'][key];
    if (raw) {
      const opts = raw.split(',').map(x => x.split(':')).map(([u, c]) => [u, +c]);
      let r = Math.random() * opts.reduce((s, o) => s + o[1], 0);
      for (const [u, c] of opts) { r -= c; if (r < 0) return u; }
      return opts[opts.length - 1][0];
    }
  }
  const nxt = (white ? bot.w : bot.b).filter(ln => ln.length > n && ln.slice(0, n).join(' ') === key).map(ln => ln[n]);
  return nxt.length ? nxt[Math.floor(Math.random() * nxt.length)] : null;
}

/** Наскільки хід личить стилю (сантипішаки): aggr > 0 - шахи, взяття, фігури до короля суперника, жертви. */
export function botStyleBonus(board, uci, aggr) {
  const m = board.find(uci);
  if (!m) return 0;
  const piece = m.piece, me = board.turn, foe = other(me);
  let bonus = 0;
  if (/[+#]/.test(m.san)) bonus += 25;
  if (m.flags.includes('c') || m.flags.includes('e')) {
    const victim = m.flags.includes('e') ? 'p' : m.captured;
    bonus += piece === 'q' && victim === 'q' ? -30 : 10;
  }
  const king = board.king(foe);
  if (king && piece !== 'k') bonus += 6 * Math.max(-3, Math.min(3, sqDist(m.from, king) - sqDist(m.to, king)));
  if (piece !== 'p' && piece !== 'k') {
    const after = board.copy();
    after.push(uci);
    const foes = after.attackers(foe, m.to);
    if (foes.length) {
      const cheapest = Math.min(...foes.map(s => BOT_VAL[after.pieceAt(s).type]));
      if (cheapest < BOT_VAL[piece] || !after.attackers(me, m.to).length) bonus += 30;
    }
  }
  return bonus * aggr;
}

/** Хід бота: cands [{uci, cp}] від рушія (найкращий перший), sfMove - вибір Stockfish на заданій силі. */
export function botChoose(board, sfMove, cands, bot) {
  if (!cands.length) return sfMove;
  const top = cands[0].cp, sf = cands.find(c => c.uci === sfMove);
  if (!sf || top - sf.cp > bot.risk) return sfMove;
  let best = sfMove, bestV = null;
  for (const c of cands) {
    if (top - c.cp > bot.risk) continue;
    const v = c.cp + botStyleBonus(board, c.uci, bot.aggr);
    if (bestV === null || v > bestV) { best = c.uci; bestV = v; }
  }
  return best;
}

/** Зірки за партію (як bot_stars_for у ПК): ★ перемога; ★★ на силі шахіста; ★★★ - ще й без повернень і підказки. */
export function botStarsFor(won, real, undos, hints) {
  if (!won) return 0;
  if (!real) return 1;
  return !undos && !hints ? 3 : 2;
}
export const starsText = n => '★'.repeat(n) + '☆'.repeat(3 - n);

const BOT_PNAME = { p: ['пішака', 'pawn'], n: ['коня', 'knight'], b: ['слона', 'bishop'], r: ['туру', 'rook'], q: ['ферзя', 'queen'], k: ['короля', 'king'] };

/** Факти для репліки бота (як bot_chat_facts у ПК): лише видиме на дошці, жодних даних рушія. */
export function botChatFacts(event, root, ucis, botColor, result = null) {
  const me = botColor === 'w' ? pick('білими', 'White') : pick('чорними', 'Black');
  const out = [pick(`Ти граєш ${me}. Суперник - людина.`, `You play ${me}. Your opponent is a human.`)];
  if (event === 'start') { out.push(pick('Подія: партія тільки починається, привітайся.', 'Event: the game is just starting, greet the opponent.')); return out.join('\n'); }
  if (event === 'alien') { out.push(pick('Подія: людина щойно відповіла 1...c6 - Каро-Канн. Ти чекав саме цього. Привітай її по-своєму.', 'Event: the human just answered 1...c6 - the Caro-Kann. You were waiting for exactly this. Greet them in your own way.')); return out.join('\n'); }
  if (event === 'end') {
    const won = result && result !== '1/2-1/2' && ((result === '1-0') === (botColor === 'w'));
    const what = result === '1/2-1/2' ? pick('нічия', 'a draw') : won ? pick('ти переміг', 'you won') : pick('людина перемогла тебе', 'the human beat you');
    out.push(pick(`Подія: партія закінчилась - ${what}. Попрощайся.`, `Event: the game is over - ${what}. Say goodbye.`));
    return out.join('\n');
  }
  const c = new Chess(root);
  for (const u of ucis) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  out.push(pick(`Хід ${c.moveNumber()}.`, `Move ${c.moveNumber()}.`));
  for (const m of c.history({ verbose: true }).slice(-2)) {
    const byBot = m.color === botColor, vic = m.captured;
    let s = byBot ? pick(`Ти зіграв ${m.san}`, `You played ${m.san}`) : pick(`Людина зіграла ${m.san}`, `The human played ${m.san}`);
    if (vic) s += byBot ? pick(` і забрав ${BOT_PNAME[vic][0]} людини`, ` and took the human's ${BOT_PNAME[vic][1]}`)
      : pick(` і забрала твого ${BOT_PNAME[vic][0]}`, ` and took your ${BOT_PNAME[vic][1]}`);
    out.push(s + '.');
  }
  const diff = materialDiff(new Pos(c.fen()), botColor);
  out.push(diff === 0 ? pick('Матеріал рівний.', 'Material is equal.')
    : pick(`Матеріал: у тебе на ${Math.abs(diff)} ${diff > 0 ? 'більше' : 'менше'}.`, `Material: you are ${Math.abs(diff)} ${diff > 0 ? 'up' : 'down'}.`));
  return out.join('\n');
}

/** Стан партії з ботом після ходів ucis від root: {fen, turn, over: [результат, причина] | null}; null - хід не той. */
export function botState(root, ucis) {
  const c = new Chess(root);
  try { for (const u of ucis) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch (_) { return null; }
  const turn = c.turn();
  let over = null;
  if (c.isCheckmate()) over = [turn === 'w' ? '0-1' : '1-0', 'mate'];
  else if (c.isStalemate()) over = ['1/2-1/2', 'stalemate'];
  else if (c.isInsufficientMaterial()) over = ['1/2-1/2', 'material'];
  else if (c.isThreefoldRepetition()) over = ['1/2-1/2', 'repetition'];
  else if (c.isDraw()) over = ['1/2-1/2', 'fifty'];
  return { fen: c.fen(), turn, over };
}

/** Пояснення від ШІ-тренера (або відповідь на запитання - question, history [{q, a}]);
 *  помилка - Error('quota' | 'rate' | 'net' | ...). */
export async function fetchAiCoach(facts, lang, question = null, history = null, bot = null) {
  let r;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 40000);
  try {
    r = await fetch(D.AI_COACH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bot ? { lang, facts, mode: 'bot', bot } : question ? { lang, facts, question, history: (history || []).slice(-3) } : { lang, facts }),
      signal: ctl.signal });
  } catch (_) { throw new Error('net'); } finally { clearTimeout(t); }
  let data = {};
  try { data = await r.json(); } catch (_) { /* */ }
  if (!r.ok) throw new Error(data.error || String(r.status));
  const text = String(data.text || '').trim();
  if (!text) throw new Error('empty');
  return text;
}
