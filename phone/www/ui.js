// Телефонна версія аналізатора: екран, навігація, власні варіанти, дослідження, налаштування.
// Поведінка повторює chess_analyzer.py (App), назви функцій - схожі.
import { D } from './data.js';
import { Chess } from './chess.js';
import { aiFacts, askFacts, fetchAiCoach, botBookMove, botChoose, botState, botStarsFor, starsText, botChatFacts, gameAccuracy } from './logic.js';
import { S, pick, tr, qname, uiLang, QUALITY, BAD, START_FEN, MATE, Pos, coachLines, bookNote, fmtEval,
  expectedPoints, evaluateMove, analyzeGame, posEval, Book } from './logic.js';
import { Engine } from './engine.js';
import { BoardView, badgeSvg } from './board.js';

const $ = id => document.getElementById(id);
const bridge = window.AndroidBridge || null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* */ } },
};

// ------------------------------------------------------------ налаштування ---
const DEF = { lang: 'en', board: D.DEFAULTS.board, depth: D.DEFAULTS.depth, arrow: D.DEFAULTS.arrow,
  anim: D.DEFAULTS.anim, coach: D.DEFAULTS.coach, evalbar: D.DEFAULTS.evalbar, ai: D.DEFAULTS.ai_coach,
  engine: window.AndroidBridge && window.AndroidBridge.engineStart ? 'native' : 'lite',
  bot: [D.BOTS[0].id, 0, 0], botStars: {} };      // останній вибір у «Ботах»: хто, колір (0 білі / 1 чорні / 2 випадково), сила
const saved = store.get('ca.settings', null);
const cfg = Object.assign({}, DEF, saved || {});
// мова за замовчуванням - англійська, як на ПК (1.22.5: раніше бралась мова телефона)
S.lang = cfg.lang === 'uk' ? 'uk' : 'en'; S.xl = ['pt', 'es'].includes(cfg.lang) ? cfg.lang : null;
const saveCfg = () => store.set('ca.settings', cfg);

// ---- 1.27.12: АНОНІМНА СТАТИСТИКА (лише з дозволу гравця; вимикач у ⚙). Надсилається: випадковий ID пристрою,
// платформа, версія, мова і лічильники подій. Не надсилається: партії, ніки, PGN, тексти повідомлень, IP.
const TELE = Object.assign({ on: null, id: '', pending: {} }, store.get('ca.tele', {}) || {});
if (!/^[0-9a-f]{32}$/.test(TELE.id || '')) TELE.id = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
delete TELE.busy;
if (!TELE.pending || typeof TELE.pending !== 'object') TELE.pending = {};
const teleSave = () => store.set('ca.tele', TELE);
teleSave();
const QUALITY_CODE = { 'Геніальний': 'brilliant', 'Чудовий': 'great', 'Теорія': 'book', 'Найкращий': 'best', 'Відмінний': 'excellent',
  'Добрий': 'good', 'Неточність': 'inaccuracy', 'Пропуск': 'miss', 'Помилка': 'mistake', 'Груба помилка': 'blunder' };
function tele(key, n = 1) {
  if (TELE.on !== true || !n) return;
  TELE.pending[key] = Math.round(((TELE.pending[key] || 0) + n) * 100) / 100;
  teleSave();
}
async function teleSend() {
  if (TELE.on !== true || !Object.keys(TELE.pending).length || TELE.busy) return;
  const sent = { ...TELE.pending };
  TELE.busy = true;
  try {
    const r = await fetch(D.AI_COACH_URL + '/t', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: TELE.id, p: 'phone', v: D.APP_VERSION, lang: S.lang, c: sent }) });
    if (r.ok) {
      for (const [k, v] of Object.entries(sent)) {
        const left = Math.round(((TELE.pending[k] || 0) - v) * 100) / 100;
        if (left > 0) TELE.pending[k] = left; else delete TELE.pending[k];
      }
    }
  } catch (_) { /* без інтернету - наступного разу */ }
  TELE.busy = false;
  delete TELE.busy;
  teleSave();
}
function teleAnalysis(res) {
  const moves = res.moves || [];
  tele('an.games'); tele('an.moves', moves.length);
  for (const m of moves) { const c = QUALITY_CODE[m.quality]; if (c) tele('q.' + c); }
  const s = res.summary || {};
  for (const k of ['white_acc', 'black_acc']) if (typeof s[k] === 'number' && isFinite(s[k])) { tele('acc.sum', s[k]); tele('acc.n'); }
}
function teleSet(on) {
  if (TELE.on === on) return;
  TELE.on = on;
  if (!on) TELE.pending = {};
  teleSave();
  if (on) { tele('start'); teleSend(); }
}
function teleStart() {
  if (TELE.on === null) { if (!A.boxKind) openBox('tele'); return; }
  if (TELE.on) { tele('start'); teleSend(); }
}
function appStatsText(a) {
  const c = a.counters || {}, n = k => Math.round(c[k] || 0), pl = a.platforms || {};
  const acc = c['acc.n'] ? (c['acc.sum'] || 0) / c['acc.n'] : null;
  const bots = Object.entries(c).filter(([k]) => k.startsWith('bot.g.')).sort((x, y) => y[1] - x[1]);
  const spec = bots.length && D.BOTS.find(b => b.id === bots[0][0].slice(6));
  const top = spec ? pick(`; найпопулярніший — ${botName(spec)} (${Math.round(bots[0][1])})`, `; most popular: ${botName(spec)} (${Math.round(bots[0][1])})`) : '';
  const countries = (a.countries || []).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ');
  const a1 = a.active_1d || 0, a7 = a.active_7d || 0, a30 = a.active_30d || 0;
  const lines = [pick(`📊 Гравців: ${a.devices || 0} (💻 ПК ${pl.pc || 0}, 📱 телефон ${pl.phone || 0}); сьогодні ${a1}, за 7 днів ${a7}, за 30 днів ${a30}`,
    `📊 Players: ${a.devices || 0} (💻 PC ${pl.pc || 0}, 📱 phone ${pl.phone || 0}); today ${a1}, last 7 days ${a7}, last 30 days ${a30}`)];
  if (countries) lines.push(pick('🌍 Країни: ', '🌍 Countries: ') + countries);
  lines.push(pick(`♟ Проаналізовано партій: ${n('an.games')} (ходів ${n('an.moves')})`, `♟ Games analyzed: ${n('an.games')} (${n('an.moves')} moves)`)
    + (acc !== null ? pick(`, середня точність ${acc.toFixed(1)}`, `, average accuracy ${acc.toFixed(1)}`) : ''));
  lines.push(pick(`💎 Геніальних ходів: ${n('q.brilliant')}, ❗ Чудових: ${n('q.great')}, ⁇ Грубих помилок: ${n('q.blunder')}`,
    `💎 Brilliant moves: ${n('q.brilliant')}, ❗ Great: ${n('q.great')}, ⁇ Blunders: ${n('q.blunder')}`));
  lines.push(pick(`🤖 Партій з ботами: ${n('bot.games')} — перемог ${n('bot.win')}, нічиїх ${n('bot.draw')}, поразок ${n('bot.loss')}${top}; ⭐ зірок ${n('bot.stars')}`,
    `🤖 Games vs bots: ${n('bot.games')} — ${n('bot.win')} won, ${n('bot.draw')} drawn, ${n('bot.loss')} lost${top}; ⭐ ${n('bot.stars')} stars`));
  lines.push(pick(`👽 Режим прибульця: ${n('alien.on')}, 💬 повідомлень ботам: ${n('bot.chat')}, 🧠 пояснень ШІ-тренера: ${n('f.ai')}`,
    `👽 Alien mode: ${n('alien.on')}, 💬 messages to bots: ${n('bot.chat')}, 🧠 AI coach explanations: ${n('f.ai')}`));
  lines.push(pick(`🧩 Задач розв'язано: ${n('pz.ok')} (з першої спроби), не вийшло з першої: ${n('pz.fail')}, відкрито задач: ${n('f.puzzle')}`,
    `🧩 Puzzles solved: ${n('pz.ok')} (on the first try), missed on the first try: ${n('pz.fail')}, puzzles opened: ${n('f.puzzle')}`));   // 1.29.4
  return lines.join('\n');
}
const DEPTHS = [8, 10, 12, 14, 16, 18, 20, 22, 24];
const ARROW_LABELS = {
  off: ['вимкнено', 'off'], bad: ['після помилок', 'after mistakes'],
  all: ['після кожного ходу', 'after every move'], hint: ['найкращий хід зараз', 'best move now'],
};

const engine = new Engine();
engine.maxMs = 0;                 // без межі часу на хід - як на ПК (аналіз може бути довгим)
const board = new BoardView($('board'), { onMove: (u, d) => onUserMove(u, d), onShapes: sh => onShapes(sh) });
board.theme = cfg.board;

const A = {
  aiCache: {}, aiFailed: {}, aiBusy: new Set(), aiCur: null, aiTimer: null, aiErr: null, aiOff: false, coachLines: null,
  askThreads: {}, askCtx: null, coachLast: [null, null, false, false],
  bot: null, botInject: false, coachHead: null,
  res: null, game: null, index: 0, v: null, varBusy: false, varToken: 0,
  lines: [], notes: {}, shapes: {}, docId: 0, jobs: 0, cancel: false, analysing: false,
  study: null, studyId: null, chapter: null, playing: false, playTimer: null, names: null,
  book: undefined, bookErr: null, saveTimer: null, statusFn: () => '',
};

// ------------------------------------------------------------ дрібниці ---
function setStatus(fn) { A.statusFn = typeof fn === 'function' ? fn : () => fn; $('statusText').textContent = A.statusFn(); }
function progress(i, n) {
  const p = $('progress');
  p.hidden = !n;
  if (n) p.firstElementChild.style.width = (100 * i / n).toFixed(1) + '%';
}
function keepAwake(on) { try { bridge && bridge.keepAwake(!!on); } catch (_) { /* */ } }
function now() { const d = new Date(), z = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; }
function plural(n, uk, en) {
  if (S.lang === 'en') return `${n} ${n === 1 ? en[0] : en[1]}`;
  const m10 = n % 10, m100 = n % 100;
  const f = m10 === 1 && m100 !== 11 ? uk[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? uk[1] : uk[2];
  return `${n} ${f}`;
}

function modal(text, btns) {
  return new Promise(resolve => {
    $('mText').textContent = text;
    const box = $('mBtns'); box.innerHTML = '';
    for (const [label, val] of btns) {
      const b = document.createElement('button');
      b.textContent = label;
      if (val === true) b.className = 'primary';
      b.onclick = () => { $('modal').hidden = true; A.modalClose = null; resolve(val); };
      box.appendChild(b);
    }
    A.modalClose = () => { $('modal').hidden = true; A.modalClose = null; resolve(false); };
    $('modal').hidden = false;
  });
}
const msg = text => modal(text, [['OK', true]]);
const ask = text => modal(text, [[pick('Скасувати', 'Cancel'), false], [pick('Так', 'Yes'), true]]);

// ------------------------------------------------------------ база дебютів ---
async function getBook() {
  if (A.book !== undefined) return A.book;
  try {
    const r = await fetch('book.json');
    A.book = new Book(await r.json());
    A.bookErr = null;
  } catch (e) { A.book = null; A.bookErr = String(e); }
  return A.book;
}

// ------------------------------------------------------------ розмітка ---
function layout() {
  const W = window.innerWidth, H = window.innerHeight;
  const wide = W > H && W >= 600;
  $('app').classList.toggle('wide', wide);
  const showEval = cfg.evalbar && !botLive();       // у партії з ботом шкали немає
  $('evalbar').hidden = !showEval;
  const evalW = showEval ? 20 : 0;
  const top = $('top').offsetHeight + $('actions').offsetHeight;
  const fixed = 52 + $('nav').offsetHeight + ($('drawBar').hidden ? 0 : 32) + ($('botBar').hidden ? 0 : $('botBar').offsetHeight + 6) + 8;
  let size = wide ? Math.min(H - top - fixed, W * 0.55 - evalW) : Math.min(W - 20 - evalW, H - top - fixed - 150);
  size = Math.max(200, Math.floor(size / 8) * 8);
  board.setSize(size);
  $('evalbar').style.height = size + 'px';
  if (wide) $('boardArea').style.width = (size + evalW + 20) + 'px'; else $('boardArea').style.width = '';
  drawGraph();
}

function applyLang() {
  S.lang = cfg.lang === 'uk' ? 'uk' : 'en'; S.xl = ['pt', 'es'].includes(cfg.lang) ? cfg.lang : null;
  document.documentElement.lang = cfg.lang;
  document.title = tr('Аналізатор шахових партій');
  const T = (id, uk, en) => { $(id).textContent = pick(uk, en); };
  T('title', '♞ Аналізатор', '♞ Chess Analyzer');
  if (A.alienMode) $('title').textContent = '👽 C̷h̴e̵s̶s̷ ̸A̵n̶a̷l̴y̵z̶e̷r̸';
  $('ver').textContent = 'v' + D.APP_VERSION;
  T('bCc', '♞ Партії Chess.com', '♞ Chess.com Games'); T('bBots', '🤖 Боти', '🤖 Bots'); T('bPz', '🧩 Задачі', '🧩 Puzzles'); T('bStudies', '📚  Дослідження', '📚  Studies'); try { accChanged(); } catch (_) { /* ще не готово */ } T('bNew', '♟ Нова', '♟ New');
  setRunLabel();
  $('varTitle').textContent = tr('ВАШ ВАРІАНТ');
  $('vBack').textContent = tr('↩ До партії'); $('vUndo').textContent = tr('⟲ Скасувати хід');
  $('vDel').textContent = tr('🗑 Видалити варіант');
  T('drawHint', 'Торкніться — коло, проведіть — стрілка', 'Tap: circle, swipe: arrow');
  T('drawClear', 'Стерти', 'Clear');
  $('stTitle').textContent = tr('📚  ДОСЛІДЖЕННЯ'); $('stChTitle').textContent = tr('РОЗДІЛИ');
  $('stChNameL').textContent = tr('Назва розділу'); $('stAdd').textContent = tr('➕ Додати поточну партію');
  $('stDel').textContent = tr('🗑 Видалити'); $('stExport').textContent = tr('⤓ Експорт PGN');
  $('stAll').textContent = tr('Усі дослідження');
  T('stHint', '✏️ під дошкою — стрілки й кола: торкніться клітинки — коло, проведіть пальцем — стрілка. '
    + 'Та сама позначка ще раз — стерти.', '✏️ below the board draws arrows and circles: tap a square for a circle, '
    + 'swipe for an arrow. Draw the same mark again to erase it.');
  $('statusText').textContent = A.statusFn();
  renderPlayers(); renderSummary(); renderMoves(); drawGraph(); renderStudyPanel(); renderUpdate();
  refreshView();
  if (A.boxKind) reopenBox();
}

function setRunLabel() {
  const running = A.analysing && A.runDoc === A.docId;
  $('bRun').textContent = running ? pick('■ Стоп', '■ Stop') : pick('▶ Аналіз', '▶ Analyze');
}

// ------------------------------------------------------------ гравці, шкала ---
function setNames(white, we, black, be) { A.names = [white, we, black, be]; renderPlayers(); }
function clockAt(res, k, white) {
  if (!res || !res.clocks) return null;
  let t = res.clk0 == null ? null : res.clk0;
  for (let i = 0; i < Math.min(k, res.clocks.length, res.fens.length); i++)
    if (res.clocks[i] != null && (res.fens[i].split(' ')[1] === 'w') === white) t = res.clocks[i];
  return t;
}
function fmtClock(sec) {
  sec = Math.max(0, sec);
  if (sec < 20) return '0:' + sec.toFixed(1).padStart(4, '0');
  const s = Math.floor(sec), p = x => String(x).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
}
function renderPlayers() {
  const [white, we, black, be] = A.names || ['Білі', '', 'Чорні', ''];
  const w = `○  ${tr(white)}` + (we ? `  (${we})` : ''), b = `●  ${tr(black)}` + (be ? `  (${be})` : '');
  let wa = '', ba = '';
  if (A.res && !A.res.free && A.res.summary) {
    const cw = clockAt(A.res, A.index, true), cb = clockAt(A.res, A.index, false);   // 1.27.14: лише час з годинника партії
    if (cw != null) wa = '⏱ ' + fmtClock(cw);
    if (cb != null) ba = '⏱ ' + fmtClock(cb);
  }
  const [top, bot] = board.flipped ? [[w, wa], [b, ba]] : [[b, ba], [w, wa]];
  $('pTop').querySelector('.pname').textContent = top[0]; $('pTop').querySelector('.pacc').textContent = top[1];
  $('pBot').querySelector('.pname').textContent = bot[0]; $('pBot').querySelector('.pacc').textContent = bot[1];
}

function setEval(cp) {
  const wp = expectedPoints(cp), fill = $('evalFill'), t = $('evalText');
  fill.style.height = wp + '%';
  fill.style.top = board.flipped ? '0' : 'auto'; fill.style.bottom = board.flipped ? 'auto' : '0';
  const a = Math.abs(cp);
  t.textContent = a >= MATE - 100 ? (MATE - a ? 'M' + (MATE - a) : 'M') : (a / 100).toFixed(1);
  const whiteAhead = cp >= 0, atBottom = whiteAhead !== board.flipped;
  t.style.top = atBottom ? 'auto' : '3px'; t.style.bottom = atBottom ? '3px' : 'auto';
  t.style.color = whiteAhead ? '#2b2927' : '#f0efec';
}

function currentCp() {
  if (A.v) { const pe = A.v.pes[A.v.index]; return pe ? pe.cp : 0; }
  return A.res ? A.res.evals[A.index] || 0 : 0;
}

// ------------------------------------------------------------ графік ---
function drawGraph() {
  const cv = $('graph'), dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 300, h = cv.clientHeight || 90;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const ev = A.res ? A.res.evals : [];
  if (ev.length < 2) {
    g.fillStyle = D.COLORS.MUTED; g.font = '12px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(tr("Графік оцінки з'явиться після аналізу"), w / 2, h / 2 + 4);
    return;
  }
  const n = ev.length - 1, X = i => i / n * w;
  const pts = ev.map((cp, i) => [X(i), h * (1 - expectedPoints(cp) / 100)]);
  g.fillStyle = '#d8d6d2';
  g.beginPath(); g.moveTo(0, h); for (const [x, y] of pts) g.lineTo(x, y); g.lineTo(w, h); g.closePath(); g.fill();
  g.strokeStyle = '#6b6762'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.setLineDash([]); g.strokeStyle = '#ffffff'; g.lineWidth = 1;
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  A.res.moves.forEach((m, i) => {
    if (!D.GRAPH_MARKS.includes(m.quality)) return;
    const [x, y] = pts[i + 1];
    g.fillStyle = QUALITY[m.quality][0]; g.strokeStyle = '#1f1d1b';
    g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
  });
  const k = A.v ? A.v.base : A.index;
  g.strokeStyle = D.COLORS.ACCENT; g.lineWidth = 2;
  g.beginPath(); g.moveTo(X(k), 0); g.lineTo(X(k), h); g.stroke();
}

function graphPick(e) {
  if (!A.res || A.res.evals.length < 2) return;
  const rc = $('graph').getBoundingClientRect(), n = A.res.evals.length - 1;
  jump(Math.round(Math.min(Math.max(e.clientX - rc.left, 0), rc.width) / rc.width * n));
}

// ------------------------------------------------------------ списки ходів ---
function lineText(line, budget = 34) {
  const parts = [];
  for (let i = 0; i < line.rows.length; i++) {
    const r = line.rows[i];
    const part = (i === 0 || r.label.endsWith('.') ? r.label + r.san : r.san) + (botLive() ? (r.fake_bril ? '!!' : r.fake_blunder ? '??' : '') : '');
    if (parts.length && [...parts, part].join(' ').length > budget) { parts.push('…'); break; }
    parts.push(part);
  }
  return parts.join(' ');
}

function qBadge(q, r = null) {
  if (botLive()) {                           // у партії з ботом - без оцінок (1.26.10: крім «!!» за Nxf7 Witty Alien)
    if (!r || !(r.fake_bril || r.fake_blunder)) return '';
    q = r.fake_bril ? 'Геніальний' : 'Груба помилка';
  }
  if (!QUALITY[q]) return '<span class="dot pend">…</span>';     // хід ще оцінюється
  const [c, s] = QUALITY[q];
  return badgeSvg(s, c);
}

function renderMoves() {
  const el = $('moves');
  if (!A.res) { el.innerHTML = `<div class="empty">${esc(pick('Тут з\'являться ходи партії.', 'The game moves will appear here.'))}</div>`; return; }
  const res = A.res, n = res.moves.length;
  const byParent = {};
  for (const ln of [...A.lines].sort((a, b) => a.base - b.base)) {
    if (!ln.rows.length || ln.id == null) continue;
    (byParent[Math.min(ln.base + 1, n)] ||= []).push(ln);
  }
  const lineHtml = ln => {
    const pe = ln.pes[ln.pes.length - 1];
    return `<div class="line${A.v === ln ? ' cur' : ''}" data-line="${ln.id}">↳ ${qBadge(ln.rows[0].quality)}<span>${esc(lineText(ln))}</span>`
      + `<span class="ev" style="margin-left:auto">${pe && !botLive() ? fmtEval(pe.cp) : ''}</span></div>`;
  };
  const html = (byParent[0] || []).map(lineHtml);
  if (!n && !html.length) { el.innerHTML = `<div class="empty">${esc(pick('Ходів ще немає.', 'No moves yet.'))}</div>`; return; }
  const cell = (m, k) => `<span class="mv${!A.v && A.index === k ? ' cur' : ''}" data-k="${k}">${qBadge(m.quality)}`
    + `<span>${esc(m.san)}</span><span class="ev">${fmtEval(res.evals[k])}</span></span>`;
  let row = null;
  const flush = () => {
    if (!row) return;
    html.push(`<span class="num">${row.num}</span>${row.w}${row.b}`);
    for (const k of row.plies) for (const ln of byParent[k] || []) html.push(lineHtml(ln));
    row = null;
  };
  res.moves.forEach((m, i) => {
    const k = i + 1, num = parseInt(m.label, 10);
    if (m.label.endsWith('.')) { flush(); row = { num: num + '.', w: cell(m, k), b: '<span></span>', plies: [k], open: true }; }
    else if (row && row.open && row.num === num + '.') { row.b = cell(m, k); row.plies.push(k); row.open = false; }
    else { flush(); row = { num: num + '…', w: '<span></span>', b: cell(m, k), plies: [k] }; }
  });
  flush();
  el.innerHTML = html.join('');
  scrollToCurrent();
}

function scrollToCurrent() {
  const box = $('movesCard'), cur = $('moves').querySelector('.cur');
  if (!cur) return;
  const top = cur.offsetTop, bottom = top + cur.offsetHeight;
  if (top < box.scrollTop) box.scrollTop = top - 8;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 8;
}

function markCurrent() {
  for (const e of $('moves').querySelectorAll('.cur')) e.classList.remove('cur');
  if (A.v) { const e = $('moves').querySelector(`[data-line="${A.v.id}"]`); if (e) e.classList.add('cur'); }
  else { const e = $('moves').querySelector(`[data-k="${A.index}"]`); if (e) e.classList.add('cur'); }
  scrollToCurrent();
}

function renderSummary() {
  const el = $('summaryCard');
  if (!A.res || A.res.free || !A.res.summary) { el.hidden = true; return; }
  el.hidden = false;
  const s = A.res.summary;
  const rows = [`<tr><th></th><th>○ ${esc(tr('Білі'))}</th><th>● ${esc(tr('Чорні'))}</th></tr>`,
    `<tr class="acc"><td>${esc(tr('Точність'))}</td><td class="n">${s.white_acc.toFixed(1)}%</td><td class="n">${s.black_acc.toFixed(1)}%</td></tr>`];
  for (const q of Object.keys(QUALITY)) {
    rows.push(`<tr><td>${qBadge(q)} <span style="color:${QUALITY[q][0]}">${esc(qname(q))}</span></td>`
      + `<td class="n">${(s.white_counts || {})[q] || 0}</td><td class="n">${(s.black_counts || {})[q] || 0}</td></tr>`);
  }
  // 1.26.6 (користувач): пропущені «Геніальні» - торкання числа показує їх по черзі
  const mb = w => { const n = missedList(w).length; return `<td class="n">${n ? `<button class="missedBtn" data-missed="${w ? 'w' : 'b'}">${n}</button>` : 0}</td>`; };
  rows.push(`<tr class="missed"><td>💎 <span style="color:${QUALITY['Геніальний'][0]}">${esc(pick('Пропущені геніальні', 'Missed brilliants'))}</span></td>${mb(true)}${mb(false)}</tr>`);
  el.innerHTML = `<div class="cardHead">${esc(tr('ОЦІНКА ПАРТІЇ'))}</div><table>${rows.join('')}</table>`
    + (analysing() ? '' : `<button class="gotwBtn" data-gotw="1">${esc(pick('🏆 Подати заявку на гру тижня', '🏆 Apply for game of the week'))}</button>`);
}

function missedList(white) {
  const r = A.res;
  if (!r || r.free) return [];
  return r.moves.map((m, i) => (m.missed_bril && r.fens[i].includes(' w ') === white ? i : -1)).filter(i => i >= 0);
}

/** Торкання числа пропущених «Геніальних»: наступна така позиція (по колу) зі стрілкою геніального ходу. */
function gotoMissed(white) {
  const idx = missedList(white);
  if (!idx.length) return;
  const k = idx.find(i => i > A.index || (i === A.index && !A.missedShown)) ?? idx[0];
  goto(k, false);
  const m = A.res.moves[k], n = idx.indexOf(k) + 1;
  board.arrow = m.best_uci; board.render();
  setInfo(esc(pick(`💎 Пропущений геніальний хід ${n} з ${idx.length}: ${m.label} ${m.best_san} (зіграно ${m.san}).`,
    `💎 Missed brilliant move ${n} of ${idx.length}: ${m.label} ${m.best_san} (${m.san} was played).`)),
    esc(pick('Торкнись числа ще раз — наступний.', 'Tap the number again for the next one.')));
  A.missedShown = true;
  $('boardArea').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ------------------------------------------------------------ підказки ---
function flash(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

function setInfo(first, adv = '', theory = '', badge = null) {
  flash($('info'));
  $('info').innerHTML = `<div class="l1">${badge ? badgeSvg(badge[1], badge[0], '') : ''}<div>${first}</div></div>`
    + (adv ? `<div class="l2">${esc(adv)}</div>` : '') + (theory ? `<div class="l3">${esc(theory)}</div>` : '');
}

function moveInfo(m) {
  const [color, , note] = QUALITY[m.quality];
  let s = `${esc(m.label)} ${esc(m.san)} — <span class="q" style="color:${color}">${esc(qname(m.quality))}</span>. ${esc(tr(note))}.`;
  if (m.book && m.opening) s += `<br>${esc(m.opening)}`;
  if (BAD.has(m.quality) && m.best_san) s += `<br>${esc(tr('Краще було'))} ${esc(m.best_san)} (${esc(tr('втрата'))} ${(m.loss / 100).toFixed(2)})`;
  else if (m.best_san && !m.book && m.best_san !== m.san && !['Найкращий', 'Геніальний', 'Чудовий', 'Теорія'].includes(m.quality))
    s += `<br>${esc(pick('Найкращий хід:', 'Best move:'))} ${esc(m.best_san)}`;      // 1.22.1
  return s;
}
// «Хід білих» / «Хід чорних» - щоб порада рушія не читалась як заміна щойно зіграного ходу (1.22.1)
const toMove = fen => (/ w /.test(fen) ? pick('Хід білих', 'White to move') : pick('Хід чорних', 'Black to move'));

function theoryLine(fen, onPath = true) {
  if (!onPath || !A.book || botLive()) return '';      // у партії з ботом дебютних підказок немає
  const b = new Pos(fen), key = b.epd(), ucis = A.book.next[key];
  if (!ucis || !ucis.length) return '';
  const sans = ucis.map(u => b.san(u)).filter(Boolean);
  if (!sans.length) return '';
  const name = A.book.name(key);
  return '📖 ' + pick('Теорія', 'Theory') + ': ' + sans.slice(0, 8).join(', ') + (name ? `  ·  ${name[0]} ${name[1]}` : '');
}

function recommend(fen, pe) {
  if (!pe || !pe.best) return '';
  const san = new Pos(fen).san(pe.best);
  return san ? `${san} (${fmtEval(pe.cp)})` : '';
}

function bestArrow(row, peNow) {
  const mode = cfg.arrow;
  if (A.pz) return null;                     // 1.28.2: у тренуванні стрілки немає зовсім
  if (botLive()) return botHintArrow();      // у партії з ботом - лише взята підказка (1.25.0)
  if (mode === 'hint') return (peNow || {}).best || null;
  if (mode === 'off' || !row || !row.best_uci) return null;
  if (row.quality === 'Теорія') return null;           // після теоретичного ходу «що було краще» не показуємо
  if (mode === 'all') return row.best_uci === row.uci || ['Найкращий', 'Геніальний', 'Чудовий'].includes(row.quality) ? null : row.best_uci;
  return BAD.has(row.quality) ? row.best_uci : null;
}

function showCoach(lines, ai = null) {
  // 1.23.2: ai - дані ходу для ШІ-тренера; поки він думає або недоступний - звичайний тренер
  A.coachLines = lines; A.aiCur = null; A.coachHead = null;
  if (lines && botLive()) {                  // партія з ботом: замість тренера - суперник і чий хід
    const [head, blines] = botCoach();
    A.coachHead = head;
    renderCoach(blines);
    return;
  }
  if (lines && ai && cfg.ai && cfg.coach && !A.aiOff) {
    const key = `${ai[0]}|${ai[1]}|${uiLang()}|${ai[2]}`;     // з 1.23.7 - і якість (рання відповідь за швидкою оцінкою)
    A.aiCur = key; A.aiCurArgs = ai;
    if (A.aiCache[key]) { renderCoach(lines, A.aiCache[key]); return; }
    if (A.aiBusy.has(key)) { renderCoach(lines, null, true); return; }
    renderCoach(lines, null, false, A.aiFailed[key] != null);   // 1.28.1: ШІ - лише після кнопки «Пояснити»
    return;
  }
  renderCoach(lines, null, false, !!(ai && cfg.ai));
}

// 1.28.1 / 1.31.0: ліміт ШІ-тренера - AI_DAILY на день НА АКАУНТ (рахує Worker, адмін - без ліміту)
const AI_DAILY = 5;
const aiQuotaLeft = () => ACC.user ? (ACC.user.admin ? 99 : ACC.user.ai_left || 0) : 0;

// ---------- 1.31.0: акаунти (нік + пароль на нашому Worker; пароль не зберігається - лише токен сесії)
const FREE_ANALYSES = 5, LICHESS_CLIENT = 'chess-analyzer';
const ACC = Object.assign({ token: '', user: null, free: 0 }, store.get('ca.acc', {}));
globalThis.caAcc = ACC;                          // logic.js fetchAiCoach бере звідси токен і залишок ШІ
function accSave() { store.set('ca.acc', ACC); }
function accSet(token, user) {
  if (!token || (user || {}).nick !== (ACC.user || {}).nick) ACC.sync = { since: '', sent: {} };   // інший акаунт - з нуля
  ACC.token = token || ''; ACC.user = token ? user : null; accSave(); accChanged();
}
async function accHttp(path, body) {
  try {
    const r = await fetch(D.AI_COACH_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let d = {};
    try { d = await r.json(); } catch (_) { /* */ }
    return { code: r.status, d };
  } catch (_) { return { code: 0, d: { error: 'net' } }; }
}
function accChanged() {
  const b = $('bAcc');
  if (b) {   // 1.31.3.4: кружечок профілю вгорі праворуч - перша літера ніка (зелений) або 👤
    const n = ACC.user ? ACC.user.nick : '';
    b.classList.toggle('on', !!n);
    b.textContent = n ? n[0].toUpperCase() : '👤';
    b.title = n ? n + ' · ' + pick('Мій профіль', 'My profile') : pick('👤 Акаунт', '👤 Account');
    b.setAttribute('aria-label', b.title);
  }
  if (ACC.user && ACC.user.chesscom && !CC.user) { CC.user = ACC.user.chesscom; store.set('ca.ccUser', CC.user); }
  if (A.coachLast && A.coachLast[0]) renderCoach(...A.coachLast, true);
  if (A.boxKind === 'acc') openBox('acc');
}
async function accRefresh() {
  const tok = ACC.token;
  if (!tok) return;
  const { code, d } = await accHttp('/acc/me', { token: tok });
  if (ACC.token !== tok) return;
  if (code === 200 && d.user) { ACC.user = d.user; accSave(); accChanged(); } else if (code === 401 || code === 403) accSet('', null);
}
function accErr(d) {
  return ({
    net: pick("Немає з'єднання з інтернетом.", 'No internet connection.'),
    nick: pick('Нік: 3–20 латинських літер, цифр, _ або -.', 'Nickname: 3–20 Latin letters, digits, _ or -.'),
    pass: pick('Пароль — від 6 символів.', 'Password must be 6+ characters.'),
    taken: pick('Цей нік уже зайнятий.', 'This nickname is taken.'),
    wrong: pick('Неправильний нік або пароль.', 'Wrong nickname or password.'),
    banned: pick('Цей акаунт заблоковано.', 'This account is banned.'),
    code: pick('Цей нік зарезервовано — потрібен правильний код.', 'This nickname is reserved — the correct code is needed.'),
    rate: pick('Забагато спроб. Спробуйте за хвилину.', 'Too many attempts. Try again in a minute.'),
    auth: pick('Сесія закінчилась — увійдіть знову.', 'Session expired — sign in again.'),
    lichess: pick('lichess не відповів. Спробуйте ще раз.', 'lichess did not answer. Try again.'),
    admin: pick('Адміна заблокувати не можна.', 'An admin cannot be banned.'),
  })[d.error] || pick('Не вдалося. Спробуйте пізніше.', 'Failed. Try later.');
}
function accStatus(t) { const e = $('acStatus'); if (e) e.textContent = t; }
function accOpen(reason = null) { A.accReason = reason; openBox('acc'); }
function accBody() {
  const u = ACC.user;
  if (!u) {
    return (A.accReason ? `<div class="hint" style="color:inherit;font-weight:600">${esc(A.accReason)}</div>` : '')
      + `<div class="row"><button id="acGoogle" class="google">${esc(pick('G   Увійти через Google', 'G   Sign in with Google'))}</button></div>`
      + `<label class="f">${esc(pick('Нік:', 'Nickname:'))}</label><input id="acNick" type="text" maxlength="20" autocapitalize="off" autocomplete="username" spellcheck="false">`
      + `<label class="f">${esc(pick('Пароль (від 6 символів):', 'Password (6+ characters):'))}</label><input id="acPass" type="password" maxlength="200" autocomplete="current-password">`
      + `<div id="acCodeRow" hidden><label class="f">${esc(pick('Код для цього ніка:', 'Code for this nickname:'))}</label><input id="acCode" type="text" maxlength="40" autocapitalize="characters" autocomplete="off"></div>`
      + `<div class="hint">${esc(pick("Нік: 3–20 латинських літер, цифр, _ або -. Пароль ми не зберігаємо, лише його захищений відбиток — відновити його неможливо, запам'ятайте.",
        'Nickname: 3–20 Latin letters, digits, _ or -. We never store your password, only a protected fingerprint — it cannot be recovered, remember it.'))}</div>`
      + `<div class="hint" id="acStatus"></div>`
      + `<div class="row"><button id="acReg">${esc(pick('Створити акаунт', 'Create account'))}</button><button id="acLogin" class="primary">${esc(pick('Увійти', 'Sign in'))}</button></div>`;
  }
  const daily = u.ai_daily || AI_DAILY;
  return `<div style="font-weight:700;font-size:1.15em">👤 ${esc(u.nick)}${u.admin ? esc(pick(' · адмін', ' · admin')) : ''}</div>`
    + `<div class="hint">${esc(u.admin ? pick('🤖 ШІ-тренер: без ліміту', '🤖 AI coach: unlimited')
      : pick(`🤖 ШІ-тренер сьогодні: ще ${u.ai_left} з ${daily}`, `🤖 AI coach today: ${u.ai_left} of ${daily} left`))}</div>`
    + `<div style="white-space:pre-line;margin:6px 0">${esc(accProfileText())}</div>`
    + `<label class="f">chess.com</label><div class="row ccrow"><input id="acCc" type="text" maxlength="30" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="${esc(pick('ваш нік на chess.com', 'your chess.com username'))}" value="${esc(u.chesscom || '')}"><button id="acCcSave">${esc(pick('Зберегти', 'Save'))}</button></div>`
    + `<div class="hint">${esc(pick('Впишіть свій нік на chess.com (як у вашому профілі chess.com, напр. Hikaru) і натисніть «Зберегти» — тоді «♞ Партії Chess.com» одразу показуватимуть ваші партії.', 'Type your chess.com username (as in your chess.com profile, e.g. Hikaru) and press «Save» — then «♞ Chess.com games» will show your games right away.'))}</div>`
    + `<label class="f">Google</label><div class="row"><span style="flex:1;align-self:center">${esc(u.google ? pick('підключено', 'connected') : pick('не підключено', 'not connected'))}</span>${u.google ? '' : `<button id="acGoogle">${esc(pick('Підключити', 'Connect'))}</button>`}</div>`
    + `<label class="f">lichess</label><div class="row"><span style="flex:1;align-self:center">${esc(u.lichess || pick('не підключено', 'not connected'))}</span><button id="acLi">${esc(u.lichess ? pick('Відключити', 'Disconnect') : pick('Підключити', 'Connect'))}</button></div>`
    + (u.admin ? `<label class="f">${esc(pick('Адмін', 'Admin'))}</label>`
      + `<div class="row"><button id="acAdmG">${esc(pick('🏆 Заявки', '🏆 Submissions'))}</button><button id="acAdmB">${esc(pick('🐞 Звіти', '🐞 Bug reports'))}</button></div>`
      + `<div class="row"><input id="acBanNick" type="text" maxlength="20" autocapitalize="off" spellcheck="false" placeholder="${esc(pick('нік', 'nickname'))}"><button id="acBan">${esc(pick('⛔ Бан', '⛔ Ban'))}</button><button id="acUnban">${esc(pick('Розбан', 'Unban'))}</button></div>` : '')
    + `<div class="hint" id="acStatus"></div>`
    + `<div class="row"><button id="acSync">${esc(pick('🔄 Синхронізувати', '🔄 Sync now'))}</button><button id="acOut">${esc(pick('Вийти', 'Sign out'))}</button></div>`;
}
function accWire() {
  const on = (id, fn) => { const e = $(id); if (e) e.addEventListener('click', fn); };
  on('acLogin', () => accAuth('login'));
  on('acReg', () => accAuth('register'));
  if ($('acPass')) $('acPass').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); accAuth('login'); } });
  on('acOut', () => { const tok = ACC.token; accSet('', null); accHttp('/acc/logout', { token: tok }); });
  on('acCcSave', () => accCall('/acc/chesscom', { chesscom: $('acCc').value.trim() }, d => {
    accTake(d);
    if (d.user && d.user.chesscom) { CC.user = d.user.chesscom; store.set('ca.ccUser', CC.user); }
    accStatus(pick('✓ chess.com збережено.', '✓ chess.com saved.'));
  }));
  on('acLi', accLichess);
  on('acGoogle', accGoogle);
  on('acSync', syncRun);
  on('acAdmG', () => { A.admMode = 'gotw'; openBox('admin'); });
  on('acAdmB', () => { A.admMode = 'bugs'; openBox('admin'); });
  const ban = v => { const n = $('acBanNick').value.trim(); if (n) accCall('/admin/ban', { nick: n, on: v }, () => accStatus(v ? pick(`⛔ ${n} заблоковано.`, `⛔ ${n} banned.`) : pick(`✓ ${n} розблоковано.`, `✓ ${n} unbanned.`))); };
  on('acBan', () => ban(true));
  on('acUnban', () => ban(false));
}
function accTake(d) { if (d.user) { ACC.user = d.user; accSave(); accChanged(); } }
async function accCall(path, body, ok) {
  accStatus(pick('Зачекайте…', 'Please wait…'));
  const { code, d } = await accHttp(path, { ...body, token: ACC.token });
  if (code === 200) { accStatus(''); ok(d); return; }
  if (code === 401) accSet('', null);
  accStatus(accErr(d));
}
async function accAuth(kind) {
  if (kind === 'register' && A.gState) { accGoogleDone(await accHttp('/acc/google', { state: A.gState, nick: $('acNick').value.trim() }), A.gState); return; }
  const body = { nick: $('acNick').value.trim(), pass: $('acPass').value };
  if (!$('acCodeRow').hidden && $('acCode').value.trim()) body.code = $('acCode').value.trim();
  accStatus(pick('Зачекайте…', 'Please wait…'));
  const { code, d } = await accHttp('/acc/' + kind, body);
  if (A.boxKind !== 'acc') return;
  if (code === 200 && d.token) {
    tele(kind === 'login' ? 'f.login' : 'f.register');
    const reason = A.accReason;
    accSet(d.token, d.user);
    accStatus(pick('✓ Готово!', '✓ Done!'));
    syncRun();
    if (reason) setTimeout(() => { if (A.boxKind === 'acc') closeBox(); }, 900);
    return;
  }
  if (d.error === 'code') $('acCodeRow').hidden = false;
  accStatus(accErr(d));
}
function b64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
// 1.31.3: вхід / прив'язка Google: браузер -> Google -> наш Worker; програма забирає результат за state
async function accGoogle() {
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  const state = [...rnd(16)].map(b => b.toString(16).padStart(2, '0')).join('');
  const verifier = b64url(rnd(32));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const u = D.AI_COACH_URL + '/acc/google/go?' + new URLSearchParams({ state, challenge });
  if (bridge && bridge.openUrl) bridge.openUrl(u); else window.open(u, '_blank');
  accStatus(pick('Підтвердіть вхід у браузері (Google)…', 'Confirm sign-in in the browser (Google)…'));
  A.gState = null;
  const t0 = Date.now(), tok = ACC.token;
  while (ACC.token === tok && Date.now() - t0 < 300000) {
    await new Promise(r => setTimeout(r, 2500));
    const r = await accHttp('/acc/google', { state, verifier, ...(tok ? { token: tok } : {}) });
    if (r.code === 202 || r.code === 0) continue;
    accGoogleDone(r, state);
    return;
  }
}
function accGoogleDone({ code, d }, state) {
  if (code === 200 && d.need_nick) {
    A.gState = state;
    if ($('acNick')) $('acNick').value = d.suggest || '';
    accStatus(pick('Google підтвердив. Придумайте нік і натисніть «Створити акаунт» (пароль не потрібен).', 'Google confirmed. Choose a nickname and press «Create account» (no password needed).'));
    return;
  }
  if (code === 200 && d.token) {
    A.gState = null;
    const reason = A.accReason;
    accSet(d.token, d.user);
    accStatus(pick('✓ Готово!', '✓ Done!'));
    syncRun();
    if (reason) setTimeout(() => { if (A.boxKind === 'acc') closeBox(); }, 900);
    return;
  }
  if (code === 200 && d.user) { accTake(d); accStatus(pick('✓ Google підключено.', '✓ Google connected.')); return; }
  accStatus(d.error === 'google_taken' ? pick("Цей Google уже прив'язаний до іншого акаунта.", 'This Google account is linked to another account.') : accErr(d));
}
async function accLichess() {
  if (ACC.user && ACC.user.lichess) { accCall('/acc/lichess', { unlink: true }, accTake); return; }
  // OAuth PKCE: браузер -> lichess -> наш Worker зберігає код; програма забирає його за state
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  const state = [...rnd(16)].map(b => b.toString(16).padStart(2, '0')).join('');
  const verifier = b64url(rnd(32));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const u = 'https://lichess.org/oauth?' + new URLSearchParams({ response_type: 'code', client_id: LICHESS_CLIENT,
    redirect_uri: D.AI_COACH_URL + '/acc/lichess/cb', code_challenge_method: 'S256', code_challenge: challenge, state });
  if (bridge && bridge.openUrl) bridge.openUrl(u); else window.open(u, '_blank');
  accStatus(pick('Підтвердіть вхід у браузері (lichess)…', 'Confirm sign-in in the browser (lichess)…'));
  const t0 = Date.now(), tok = ACC.token;
  while (ACC.token === tok && Date.now() - t0 < 300000) {
    await new Promise(r => setTimeout(r, 2500));
    const { code, d } = await accHttp('/acc/lichess', { token: tok, state, verifier });
    if (code === 202 || code === 0) continue;
    if (code === 200) { accTake(d); accStatus(pick('✓ lichess підключено.', '✓ lichess connected.')); } else accStatus(accErr(d));
    return;
  }
}
function accGate() {
  if (ACC.token) return true;
  if (ACC.free >= FREE_ANALYSES) {
    accOpen(pick(`Ви використали ${FREE_ANALYSES} пробних аналізів. Увійдіть або створіть безплатний акаунт, щоб аналізувати далі.`,
      `You have used ${FREE_ANALYSES} trial analyses. Sign in or create a free account to keep analyzing.`));
    return false;
  }
  ACC.free++; accSave();
  return true;
}

// ---------- 1.31.1: синхронізація акаунта між пристроями (задачі, зірки ботів, дослідження) - як у ПК
const SYNC_MAX_ITEM = 1400000;
function jhash(obj) {                              // cyrb53 від JSON - лише щоб помітити зміни
  const s = JSON.stringify(obj);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function puzzlesMerge(a, b) {
  const done = [...new Set([...(a.done || []), ...(b.done || [])])].slice(-2000), gone = new Set(done), by = new Map();
  for (const x of [...(a.list || []), ...(b.list || [])]) {
    if (!x.id || gone.has(x.id)) continue;
    const y = by.get(x.id);
    if (!y || (x.ok || 0) > (y.ok || 0) || ((x.ok || 0) === (y.ok || 0) && (x.due || 0) > (y.due || 0))) by.set(x.id, x);
  }
  return { list: [...by.values()].slice(-PZ_MAX), done };
}
let syncing = false;
async function syncRun() {
  if (!ACC.token || syncing) return;
  syncing = true;
  try { await syncOnce(); } catch (_) { /* наступна спроба за 5 хв */ }
  syncing = false;
  if (A.boxKind === 'acc') openBox('acc');
}
async function syncOnce() {
  const tok = ACC.token, st = ACC.sync || (ACC.sync = { since: '', sent: {} }), sent = st.sent || (st.sent = {});
  const r = await accHttp('/acc/sync', { token: tok, since: st.since || '' });
  if (ACC.token !== tok) return;
  if (r.code === 401) { accSet('', null); return; }
  if (r.code !== 200) return;
  flushSave();
  const ids = store.get('ca.studies', []);
  const local = new Map();
  for (const id of ids) { const s = store.get('ca.study.' + id, null); if (s && s.sid) local.set(s.sid, { id, s }); }
  for (const it of r.d.items || []) {
    let obj = null;
    try { obj = it.data ? JSON.parse(it.data) : null; } catch (_) { continue; }
    const hk = it.kind + ':' + it.key;
    if (it.kind === 'puzzles' && obj) { sent[hk] = jhash(obj); const mine = pzLoad(), m = puzzlesMerge(mine, obj); if (jhash(m) !== jhash(mine)) pzSave(m); }
    else if (it.kind === 'stars' && obj) {
      sent[hk] = jhash(obj);
      const cur = cfg.botStars || (cfg.botStars = {});
      let ch = false;
      for (const [k, v] of Object.entries(obj)) if ((+v || 0) > (cur[k] || 0)) { cur[k] = +v; ch = true; }
      if (ch) saveCfg();
    } else if (it.kind === 'study') {
      const loc = local.get(it.key);
      if (!obj) {                                    // видалено на іншому пристрої
        delete sent[hk];
        if (loc && loc.id !== A.studyId) {
          store.del('ca.study.' + loc.id);
          store.set('ca.studies', store.get('ca.studies', []).filter(x => x !== loc.id));
          local.delete(it.key);
        }
        continue;
      }
      sent[hk] = jhash(obj);
      if (loc && loc.id === A.studyId) continue;     // відкрите зараз - лишаємо своє
      if (!loc || (obj.updated || '') > (loc.s.updated || '')) {
        const id = loc ? loc.id : 'study-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        if (store.set('ca.study.' + id, obj)) {
          const all = store.get('ca.studies', []);
          if (!all.includes(id)) { all.push(id); store.set('ca.studies', all); }
          local.set(it.key, { id, s: obj });
        }
      }
    }
  }
  const put = [];
  const pz = pzLoad();
  if ((pz.list.length || pz.done.length) && jhash(pz) !== sent['puzzles:all']) put.push({ kind: 'puzzles', key: 'all', data: JSON.stringify(pz) });
  const stars = cfg.botStars || {};
  if (Object.keys(stars).length && jhash(stars) !== sent['stars:all']) put.push({ kind: 'stars', key: 'all', data: JSON.stringify(stars) });
  const have = new Set();
  for (const id of store.get('ca.studies', [])) {
    const s = store.get('ca.study.' + id, null);
    if (!s) continue;
    if (!s.sid) {
      s.sid = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (id === A.studyId && A.study) A.study.sid = s.sid;   // інакше автозбереження загубить sid
      store.set('ca.study.' + id, s);
    }
    have.add(s.sid);
    const data = JSON.stringify(s);
    if (data.length <= SYNC_MAX_ITEM && jhash(s) !== sent['study:' + s.sid]) put.push({ kind: 'study', key: s.sid, data });
  }
  for (const hk of Object.keys(sent)) if (hk.startsWith('study:') && !have.has(hk.slice(6))) put.push({ kind: 'study', key: hk.slice(6), data: null });
  if (put.length) {
    const r2 = await accHttp('/acc/sync', { token: tok, put, get: false });
    if (ACC.token !== tok) return;
    if (r2.code === 401) { accSet('', null); return; }
    if (r2.code !== 200) return;
    for (const it of put) { const hk = it.kind + ':' + it.key; if (it.data == null) delete sent[hk]; else sent[hk] = jhash(JSON.parse(it.data)); }
  }
  st.since = r.d.now || '';
  st.at = new Date().toTimeString().slice(0, 5);
  accSave();
}
function accProfileText() {
  const u = ACC.user || {}, pz = pzLoad();
  const stars = Object.values(cfg.botStars || {}).reduce((a, b) => a + (+b || 0), 0);
  const nSt = store.get('ca.studies', []).length, at = (ACC.sync || {}).at;
  return [u.created ? pick(`📅 З нами з ${u.created}`, `📅 Member since ${u.created}`) : '',
    pick(`🧩 Задачі: ${pz.list.length} у тренуванні, ${pz.done.length} вивчено`, `🧩 Puzzles: ${pz.list.length} in training, ${pz.done.length} learned`),
    pick(`⭐ Зірок у ботів: ${stars}`, `⭐ Bot stars: ${stars}`),
    pick(`📚 Досліджень: ${nSt}`, `📚 Studies: ${nSt}`),
    pick(`🏆 Заявок на гру тижня: ${u.gotw || 0} (❤ ${u.likes || 0})`, `🏆 Game of the week submissions: ${u.gotw || 0} (❤ ${u.likes || 0})`),
    at ? pick(`🔄 Синхронізовано о ${at}`, `🔄 Synced at ${at}`) : pick('🔄 Ще не синхронізовано', '🔄 Not synced yet')].filter(Boolean).join('\n');
}

const LOGIN_AI = () => pick('ШІ-тренер працює з безплатним акаунтом: увійдіть або створіть його.', 'The AI coach needs a free account: sign in or create one.');

// ---------- адмін: заявки «Партія тижня» і звіти про помилки
const ADM = { rows: [] };
async function admLoad() {
  const mode = A.admMode, list = $('admList');
  const { code, d } = await accHttp(mode === 'gotw' ? '/admin/gotw' : '/admin/bugs', { token: ACC.token });
  if (A.boxKind !== 'admin' || A.admMode !== mode) return;
  if (code !== 200) { list.textContent = accErr(d); return; }
  ADM.rows = (mode === 'gotw' ? d.games : d.bugs) || [];
  admRender();
}
function admRender() {
  const gotw = A.admMode === 'gotw';
  $('admList').innerHTML = ADM.rows.length ? ADM.rows.map(g => gotw
    ? `<div class="glrow"><div><b>№${g.n}</b> ${g.chosen ? '✓ ' : ''}${esc(`${g.white || '?'} – ${g.black || '?'} ${g.result || ''}`)}`
      + `<div class="hint">${esc(`${g.nick || '—'} · ${(g.at || '').slice(0, 10)} · ❤${g.likes || 0}`)}${g.comment ? '<br>' + esc(g.comment) : ''}</div></div>`
      + `<div class="row"><button data-adm-open="${g.n}">♟</button><button data-adm-choose="${g.n}"${g.chosen ? ' disabled' : ''}>${esc(pick('✓ Вибрати', '✓ Choose'))}</button><button data-adm-del="${g.n}">🗑</button></div></div>`
    : `<div class="glrow"><div><b>№${g.n}</b> ${esc(`${g.platform} ${g.version} ${g.country || ''} · ${(g.at || '').slice(0, 10)}`)}`
      + `<div style="white-space:pre-wrap">${esc(g.text || '')}</div>${g.contact ? `<div class="hint">${esc(g.contact)}</div>` : ''}</div>`
      + (g.pgn_len ? `<div class="row"><button data-adm-open="${g.n}">♟ PGN</button></div>` : '') + '</div>').join('')
    : esc(pick('Порожньо.', 'Empty.'));
}
async function admClick(e) {
  const b = e.target.closest('[data-adm-open],[data-adm-choose],[data-adm-del]');
  if (!b) return;
  const gotw = A.admMode === 'gotw';
  if (b.dataset.admOpen) {
    const { code, d } = await accHttp(gotw ? '/admin/gotw/pgn' : '/admin/bugs/pgn', { token: ACC.token, n: +b.dataset.admOpen });
    const pgn = code === 200 ? (gotw ? d.game.pgn : d.pgn) : '';
    if (!pgn) { msg(pick('PGN немає.', 'No PGN.')); return; }
    closeBox(); loadPgn(pgn);
  } else if (b.dataset.admChoose) {
    const n = +b.dataset.admChoose, { code, d } = await accHttp('/admin/gotw/choose', { token: ACC.token, n });
    if (code !== 200) { msg(accErr(d)); return; }
    const g = ADM.rows.find(x => x.n === n); if (g) g.chosen = 1;
    admRender();
    msg(pick('✓ Вибрано. PGN у папку «Партії тижня» зберігає ПК (адмін-вікно або gotw.ps1 save).', '✓ Chosen. The PC saves the PGN to the «Партії тижня» folder (admin window or gotw.ps1 save).'));
  } else if (b.dataset.admDel) {
    const n = +b.dataset.admDel;
    if (!confirm(pick(`Видалити заявку №${n} назавжди?`, `Delete submission #${n} forever?`))) return;
    const { code, d } = await accHttp('/admin/gotw/delete', { token: ACC.token, n });
    if (code !== 200) { msg(accErr(d)); return; }
    ADM.rows = ADM.rows.filter(x => x.n !== n);
    admRender();
  }
}

function aiExplain() {
  if (!ACC.token) { accOpen(LOGIN_AI()); return; }
  const key = A.aiCur, ai = A.aiCurArgs;
  if (!key || !ai || aiQuotaLeft() <= 0 || A.aiBusy.has(key)) return;
  delete A.aiFailed[key];
  renderCoach(A.coachLines, null, true);
  aiStart(key, ai);
}

function aiNote() {
  const e = A.aiErr;
  if (!e) return '';
  if (e === 'quota') return pick('🤖 ШІ-тренер на сьогодні вичерпав безплатний ліміт — працює звичайний тренер.', "🤖 The AI coach has used up today's free limit — the regular coach is shown.");
  if (e === 'rate') return pick('🤖 Забагато запитів до ШІ-тренера — спробуйте за хвилину.', '🤖 Too many AI coach requests — try again in a minute.');
  if (e === 'net') return pick('🤖 ШІ-тренер недоступний (немає інтернету?) — працює звичайний тренер.', '🤖 The AI coach is unavailable (no internet?) — the regular coach is shown.');
  return pick('🤖 ШІ-тренер зараз не відповів — працює звичайний тренер.', '🤖 The AI coach did not answer — the regular coach is shown.');
}

function renderCoach(lines, aiText = null, waiting = false, note = false, noFlash = false) {
  A.coachLast = [lines, aiText, waiting, note];
  const el = $('coach'), body = $('coachBody');
  el.hidden = !cfg.coach || !lines;
  if (!lines) return;
  if (!noFlash) flash(el);
  const bl = botLive();                       // 1.27.11: у партії з ботом - чат з ботом
  $('askRow').hidden = !cfg.ai && !bl;
  const inp = $('askIn');
  inp.placeholder = bl ? pick('Написати ботові…', `Message ${botName(A.bot.spec)}…`)
    : pick('Спитати ШІ-тренера про позицію…', 'Ask the AI coach about the position…');
  $('askClear').textContent = pick('🗑 Очистити', '🗑 Clear');
  let html;
  if (A.coachHead) html = `<div class="ch">${esc(A.coachHead)}</div>`
    + lines.map(l => `<div class="${l.startsWith('🗨') ? 'q' : 'ai'}">${esc(l)}</div>`).join('');
  else if (aiText) html = `<div class="ch">${esc(pick('🤖 ШІ-тренер', '🤖 AI coach'))}</div><div class="ai">${esc(aiText)}</div>`;
  // 1.23.3: поки ШІ думає - лише його заголовок; звичайний тренер - тільки якщо ШІ недоступний
  else if (waiting) html = `<div class="ch">${esc(pick('🤖 ШІ-тренер', '🤖 AI coach'))}</div><div class="aimuted">${esc(pick('Думає…', 'Thinking…'))}</div>`;
  else {
    const extra = note ? aiNote() : '';
    html = `<div class="ch">${esc(pick('🎓 Тренер', '🎓 Coach'))}</div><ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
      + (extra ? `<div class="aimuted">${esc(extra)}</div>` : '');
    if (A.aiCur && A.aiCurArgs && cfg.ai && !A.aiOff && !bl) {      // 1.28.1: кнопка «Пояснити»
      const left = aiQuotaLeft();
      html += `<button id="aiExplain" class="primary aibtn"${left || !ACC.token ? '' : ' disabled'}>${esc(!ACC.token
        ? pick('🤖 Пояснити (ШІ) · увійдіть в акаунт', '🤖 Explain (AI) · sign in')
        : ACC.user.admin ? pick('🤖 Пояснити (ШІ)', '🤖 Explain (AI)') : left
        ? pick(`🤖 Пояснити (ШІ) · ще ${left} з ${AI_DAILY} сьогодні`, `🤖 Explain (AI) · ${left} of ${AI_DAILY} left today`)
        : pick(`🤖 Ліміт ШІ на сьогодні вичерпано (${AI_DAILY})`, `🤖 AI limit for today is used up (${AI_DAILY})`))}</button>`;
    }
  }
  // запитання гравця до цієї позиції і відповіді ШІ (1.23.5)
  const thread = cfg.ai ? (A.askThreads[askKey()] || []) : [];
  for (const it of thread) {
    html += `<div class="q">❓ ${esc(it.q)}</div>` + (it.a ? `<div class="ai">${esc(it.a)}</div>`
      : `<div class="aimuted">${esc(it.err ? askErrText(it.err) : pick('Думає…', 'Thinking…'))}</div>`);
  }
  body.innerHTML = html;
  const eb = $('aiExplain');
  if (eb) eb.addEventListener('click', aiExplain);
}

// ---- запитання до ШІ-тренера (1.23.5) ----
function askKey() { const c = A.askCtx; return c ? c.fen + '|' + c.sans.join(' ') : ''; }

function askSetMain(k) {
  const res = A.res;
  try { A.askCtx = { fen: res.fens[k], pe: res.pos_info[k], sans: res.moves.slice(0, k).map(m => m.san), last: aiMain(k) }; }
  catch (_) { A.askCtx = null; }
}

function askSetVar(j) {
  const v = A.v, res = A.res;
  try {
    const sans = res.moves.slice(0, v.base).map(m => m.san).concat(v.rows.slice(0, j).map(r => r.san));
    A.askCtx = { fen: v.fens[j], pe: v.pes[j] || {}, sans, last: j ? aiVar(j) : null };
  } catch (_) { A.askCtx = null; }
}

function askErrText(e) {
  if (e === 'limit') return pick(`🤖 Ліміт ШІ на сьогодні вичерпано (${AI_DAILY} пояснень і запитань). Завтра знову.`, `🤖 Today's AI limit is used up (${AI_DAILY} explanations and questions). Back tomorrow.`);
  if (e === 'quota') return pick('🤖 ШІ-тренер на сьогодні вичерпав безплатний ліміт.', "🤖 The AI coach has used up today's free limit.");
  if (e === 'rate') return pick('🤖 Забагато запитів — спробуйте за хвилину.', '🤖 Too many requests — try again in a minute.');
  if (e === 'net') return pick("🤖 Немає зв'язку з ШІ-тренером (немає інтернету?).", "🤖 Can't reach the AI coach (no internet?).");
  return pick('🤖 ШІ-тренер зараз не відповів — спробуйте ще раз.', '🤖 The AI coach did not answer — try again.');
}

// 1.23.6: очистити чат у поточній позиції
function askClear() {
  if (botLive()) { A.bot.chat = A.bot.chat.filter(x => typeof x === 'string'); showCoach(A.coachLines); return; }   // 1.27.11
  const key = askKey();
  if (A.askThreads[key]) { delete A.askThreads[key]; if (A.coachLast[0]) renderCoach(...A.coachLast, true); }
}

async function askSend() {
  const inp = $('askIn'), q = inp.value.trim().slice(0, 500), ctx = A.askCtx, key = askKey();
  if (botLive()) { if (q) botChatSend(q.slice(0, 300)); return; }   // 1.27.11: повідомлення ботові
  if (!q || !ctx || !cfg.ai) return;
  if (!ACC.token) { accOpen(LOGIN_AI()); return; }
  inp.value = '';
  tele('f.ask');
  const thread = (A.askThreads[key] ??= []);
  const history = thread.filter(it => it.a).map(it => ({ q: it.q, a: it.a }));
  const item = { q, a: null, err: null };
  thread.push(item);
  const rerender = () => { if (A.coachLast[0]) renderCoach(...A.coachLast, true); };
  if (aiQuotaLeft() <= 0) { item.err = 'limit'; rerender(); return; }   // 1.28.1
  rerender();
  let facts;
  try { facts = askFacts(ctx.fen, ctx.pe, ctx.sans, ctx.last); } catch (_) { facts = pick('Позиція (FEN): ', 'Position (FEN): ') + ctx.fen; }
  try { item.a = await fetchAiCoach(facts, uiLang(), q, history); } catch (e) { item.err = e.message || 'ai'; }
  if (askKey() === key) rerender();
}

// 1.23.7: ШІ починає думати, щойно є швидка оцінка ходу (повний аналіз Stockfish ще йде)
function aiPrefetch(ai) {
  return;                                    // 1.28.1: вимкнено - ШІ лише після кнопки «Пояснити» (ліміт)
  if (!ai || !cfg.ai || !cfg.coach || A.aiOff) return;
  const key = `${ai[0]}|${ai[1]}|${uiLang()}|${ai[2]}`;
  if (A.aiCache[key] || A.aiBusy.has(key) || A.aiFailed[key] != null) return;
  aiStart(key, ai, true);
}

async function aiStart(key, ai, force = false) {
  if ((key !== A.aiCur && !force) || A.aiBusy.has(key)) return;
  let facts;
  try { facts = aiFacts(...ai); } catch (_) { A.aiFailed[key] = Date.now(); A.aiErr = 'facts'; if (key === A.aiCur) renderCoach(A.coachLines, null, false, true); return; }
  A.aiBusy.add(key);
  tele('f.ai');
  let text = null;
  try { text = await fetchAiCoach(facts, key.split('|')[2]); A.aiCache[key] = text; A.aiErr = null; }
  catch (e) { A.aiFailed[key] = Date.now(); A.aiErr = e.message; if (e.message === 'quota') A.aiOff = true; }
  A.aiBusy.delete(key);
  if (key === A.aiCur) renderCoach(A.coachLines, text, false, !text);
}

function aiMain(k) {
  const res = A.res;
  if (!res || res.free || k <= 0) return null;
  const m = res.moves[k - 1];
  if (!m || !m.quality || !res.pos_info || !res.pos_info[k]) return null;
  return [res.fens[k - 1], m.uci, m.quality, m.best_san || '', res.pos_info[k - 1], res.pos_info[k]];
}

function aiVar(j) {
  const v = A.v, row = v && v.rows[j - 1];
  if (!row || row.pending || !row.quality || !v.pes[j]) return null;
  return [v.fens[j - 1], row.uci, row.quality, row.best_san || '', v.pes[j - 1], v.pes[j]];
}

function coachMain(k) {
  const res = A.res;
  if (k === 0) return [pick('Почніть партію: перетягніть фігуру або торкніться її.', 'Start the game: drag a piece or tap it.')];
  const m = res.moves[k - 1];
  return [...coachLines(res.fens[k - 1], m.uci, m.quality, m.best_san, res.pos_info[k - 1], res.pos_info[k]), ...bookNote(m)];
}

function coachVar(j) {
  const v = A.v, row = v.rows[j - 1];
  return [...coachLines(v.fens[j - 1], row.uci, row.quality, row.best_san, v.pes[j - 1], v.pes[j]), ...bookNote(row)];
}

// ------------------------------------------------------------ партія ---
function parsePgn(text) {
  const t = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!t) return null;
  const first = t.split(/\n\s*\n(?=\s*\[Event\s)/)[0];
  const c = new Chess();
  try { c.loadPgn(first); } catch (_) { return null; }
  const hist = c.history({ verbose: true });
  if (!hist.length) return null;
  const headers = (c.getHeaders ? c.getHeaders() : c.header()) || {};
  const g = { root: hist[0].before || START_FEN, moves: hist.map(m => m.from + m.to + (m.promotion || '')), headers };
  try {                                     // 1.27.13: залишок годинника [%clk] після кожного ходу
    const cm = {};
    for (const x of (c.getComments ? c.getComments() : [])) cm[x.fen] = x.comment;
    const clocks = hist.map(m => {
      const r = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(cm[m.after] || '');
      return r ? +r[1] * 3600 + +r[2] * 60 + +r[3] : null;
    });
    if (clocks.some(x => x != null)) { g.clocks = clocks; const t = /^(\d+)/.exec(String(headers.TimeControl || '').trim()); g.clk0 = t ? +t[1] : null; }
  } catch (_) {}
  return g;
}

function loadPgn(text) {
  tele('f.pgn');
  const g = parsePgn(text);
  if (!g) { msg(tr('Не вдалося прочитати PGN або в ньому немає ходів.')); return false; }
  stopPlay();
  newDoc();
  A.game = g;
  resetView();
  const h = g.headers, white = h.White || 'Білі', black = h.Black || 'Чорні';
  setNames(white, h.WhiteElo || '', black, h.BlackElo || '');
  setStatus(() => `${tr('Завантажено:')} ${tr(white)} — ${tr(black)}`);
  startAnalysis();
  return true;
}

function startFree(res = null) {
  stopPlay(); clearVar();
  if (!res) {
    newDoc();
    res = { free: true, fens: [START_FEN], evals: [0], pos_info: [null], moves: [], book_path: [true], depth: null,
      summary: { white: 'Білі', black: 'Чорні', white_rating: null, black_rating: null, white_acc: 0, black_acc: 0,
        white_counts: {}, black_counts: {}, result: '*', opening: null } };
  }
  A.game = null; A.res = res; A.index = 0;
  setNames('Білі', '', 'Чорні', '');
  renderSummary(); renderMoves(); drawGraph();
  goto(0, false);
  setStatus(() => pick('Грай з початкової позиції: перетягни фігуру або торкнися її.', 'Play from the starting position: drag a piece or tap it.'));
  getBook();
}

function resetView() {
  clearVar();
  A.res = null; A.index = 0; board.interactive = false;
  renderPlayers(); renderSummary(); renderMoves(); drawGraph();
  board.setPosition(START_FEN);
  setEval(0); setInfo(''); showCoach(null);
}

async function startAnalysis() {
  if (A.analysing && A.runDoc === A.docId) { A.cancel = true; engine.stop(); return; }
  if (!A.game) { msg(tr('Спочатку завантаж партію (PGN з буфера або файл).')); return; }
  if (!accGate()) return;                          // 1.31.0: без акаунта - FREE_ANALYSES пробних
  clearVar();
  board.interactive = false;
  A.cancel = false;
  const doc = A.docId, game = A.game, depth = cfg.depth;
  A.analysing = true; A.runDoc = doc; A.jobs++;
  setRunLabel();
  progress(0, game.moves.length);
  keepAwake(true);
  try {
    setStatus(() => tr('Готую базу дебютів…'));
    const book = await getBook();
    setStatus(() => pick('Запускаю Stockfish…', 'Starting Stockfish…'));
    await ensureEngine();
    if (doc !== A.docId) return;
    engine.searchMs = 0; engine.slowestMs = 0;
    var tAnalysis = performance.now();
    setInfo(esc(pick('⏳ Аналіз на телефоні може тривати кілька хвилин, а деякі ходи — по 5–10 секунд. Це нормально: '
      + 'телефон рахує повільніше за комп\'ютер.',
    '⏳ Analysis on a phone can take a few minutes, and some moves 5–10 seconds. This is normal: '
      + 'a phone calculates more slowly than a computer.')));
    setStatus(() => tr('Аналіз…'));
    const res = await analyzeGame(engine, game, depth, {
      book, cancelled: () => A.cancel || doc !== A.docId,
      progress: (i, n, part) => {
        if (doc !== A.docId) return;
        progress(i, n);
        const nps = engine.nps ? `  ·  ${Math.round(engine.nps / 1000)} ${pick('тис. поз./с', 'k pos/s')}` : '';
        setStatus(() => `${tr('Аналіз…')} ${tr('хід')} ${i} ${tr('з')} ${n}${nps}  ·  `
          + pick('готові ходи вже можна дивитися', 'finished moves can be viewed already'));
        if (part) showPartial(part);
      },
    });
    if (doc === A.docId) {
      teleAnalysis(res);
      showResults(res);
      // розбивка часу: увесь аналіз / сам рушій (щоб було видно, що гальмує)
      const all = (performance.now() - tAnalysis) / 1000, eng = (engine.searchMs || 0) / 1000;
      const base = A.statusFn();
      setStatus(() => `${base}  ·  ${pick('за', 'in')} ${all.toFixed(0)} ${tr('с')} (${pick('рушій', 'engine')} `
        + `${eng.toFixed(0)} ${tr('с')}, ${tr('глибина')} ${depth}, ${res.moves.length} ${pick('ходів', 'moves')}, `
        + `${pick('найдовший хід', 'slowest move')} ${((engine.slowestMs || 0) / 1000).toFixed(1)} ${tr('с')})`);
    }
  } catch (e) {
    if (doc === A.docId) {
      if (A.res && A.res.partial) {          // лишаємо те, що встигли проаналізувати
        delete A.res.partial; A.partialSeen = false;
        goto(A.index, false);
      }
      if (A.cancel) setStatus(() => tr('Скасовано.'));
      else { setStatus(() => tr('Помилка аналізу')); msg(`${tr('Помилка аналізу')}: ${e.message || e}`); }
    }
  } finally {
    A.jobs--;
    if (A.runDoc === doc) A.analysing = false;
    if (A.jobs <= 0) keepAwake(false);
    if (doc === A.docId) progress(0, 0);
    setRunLabel();
  }
}

function showResults(res, save = true) {
  if (!res.clocks && !res.free && A.game && A.game.clocks) { res.clocks = A.game.clocks; res.clk0 = A.game.clk0; }
  A.res = res;
  if (save && A.chapter) { A.chapter.result = res; autosave(); }
  const s = res.summary;
  let extra = '';
  if (s.opening) extra = `  ·  ${s.opening[0]} ${s.opening[1]}`;
  else if (A.bookErr) extra = '  ·  ' + tr('без теорії (базу дебютів не завантажено)');
  setStatus(() => `${tr('Готово')} · ${tr('результат')} ${s.result}${extra}`);
  renderPlayers(); renderSummary(); renderMoves(); drawGraph();
  puzzlesCollect(res);
  board.interactive = true;
  const keep = A.partialSeen && A.index >= 0 && A.index < res.fens.length;
  A.partialSeen = false;
  if (keep && A.v) { showVarState(A.v.index, false); return; }   // 1.26.7: гравець у своєму варіанті - лишаємо там
  goto(keep ? A.index : 0, false);        // гравець уже гортав готові ходи - лишаємо там
}

// Проміжний результат аналізу (1.22.0): готові ходи видно й можна гортати, поки рушій рахує далі.
// Дошка в цей час лише для перегляду (без власних варіантів), розділ дослідження не зберігається.
const analysing = () => !!(A.res && A.res.partial);

function showPartial(res) {
  const first = !(A.res && A.res.partial);
  if (first && A.v) clearVar();
  A.res = res; A.partialSeen = true;           // 1.26.7: варіант гравця не скидається - ходити можна під час аналізу
  const sc = [$('moves'), $('panel'), $('moves').parentElement].map(e => [e, e.scrollTop]);   // не смикати прокрутку
  renderPlayers(); renderSummary(); renderMoves();
  if (first) { goto(0, false); return; }
  for (const [e, y] of sc) e.scrollTop = y;
  if (A.v) markCurrent();
  else {
    const cur = $('moves').querySelector(`[data-k="${A.index}"]`);
    if (cur) cur.classList.add('cur');
  }
  drawGraph();
}

// ------------------------------------------------------------ навігація ---
function step(delta) {
  if (A.v) {
    if (A.varBusy) return;
    const j = A.v.index + delta;
    if (j < 0) exitVar(); else gotoVar(j);
  } else goto(A.index + delta);
}
function goStart() { if (A.v) clearVar(); goto(0); }
function goEnd() { if (A.v) { if (!A.varBusy) gotoVar(A.v.rows.length); } else goto(1e6); }
function jump(k) { if (A.v) { if (A.varBusy) return; clearVar(); } goto(k); }

function goto(k, animate = null) {
  if (!A.res) return;
  if (A.v) clearVar();
  const res = A.res, n = res.fens.length - 1;
  k = Math.max(0, Math.min(n, k));
  A.missedShown = false;                    // 1.26.6: показ пропущеного «Геніального» - лише після gotoMissed
  const prev = A.index;
  A.index = k;
  renderPlayers();
  if (animate === null) animate = k === prev + 1;
  let last = null, badge = null, info = esc(tr('Початкова позиція'));
  const rec = recommend(res.fens[k], res.pos_info[k]);
  if (k >= 1) {
    const m = res.moves[k - 1];
    last = m.uci; badge = [QUALITY[m.quality][0], QUALITY[m.quality][1]];
    info = moveInfo(m);
  }
  let adv = '';
  if (rec && k < n && !botLive()) {
    const d = (res.pos_info[k] || {}).depth || res.depth;
    adv = `${toMove(res.fens[k])} — ${tr('Stockfish радить:')} ${rec}` + (d ? `  (${tr('глибина')} ${d})` : '');
  }
  const arrow = bestArrow(k >= 1 ? res.moves[k - 1] : null, k < n ? res.pos_info[k] : null);
  const fen = res.fens[k], shapes = A.shapes[String(k)] || [];
  if (animate && k >= 1 && cfg.anim) {
    const prevLast = k >= 2 ? res.moves[k - 2].uci : null;
    board.animate(res.fens[k - 1], prevLast, last, () => board.setPosition(fen, last, badge, arrow, shapes), badge);
  } else board.setPosition(fen, last, badge, arrow, shapes);
  board.interactive = true;                  // 1.26.7: і поки аналіз партії ще йде
  setEval(res.evals[k] || 0);
  const onPath = k < (res.book_path || []).length ? res.book_path[k] : true;
  setInfo(info, adv, theoryLine(fen, onPath), badge);
  askSetMain(k);
  showCoach(coachMain(k), aiMain(k));
  if (A.bot || A.botUi) setTimeout(botTick, 30);
  renderVar();
  markCurrent();
  drawGraph();
  showNote();
}

function refreshView() {
  if (A.v) showVarState(A.v.index, false);
  else if (A.res) goto(A.index, false);
}

function togglePlay() {
  if (!A.res) return;
  if (A.v) exitVar();
  if (A.playing) { stopPlay(); return; }
  if (A.index >= A.res.fens.length - 1) goto(0, false);
  A.playing = true;
  $('nPlay').classList.add('on');
  playTick();
}
function playTick() {
  if (!A.playing || !A.res) return;
  if (A.index >= A.res.fens.length - 1) { stopPlay(); return; }
  step(1);
  A.playTimer = setTimeout(playTick, 900);
}
function stopPlay() {
  A.playing = false;
  clearTimeout(A.playTimer); A.playTimer = null;
  $('nPlay').classList.remove('on');
}

function flipBoard() {
  board.flip();
  renderPlayers();
  setEval(currentCp());
  docChanged();
}

// ------------------------------------------------------------ власні варіанти ---
async function onUserMove(uci, dragged) {
  const redraw = () => board.setPosition(board.fen, board.last, board.badge, board.arrow, board.shapes);
  if (!A.res || A.varBusy) { redraw(); return; }
  // партія з ботом: фігурами бота ходить лише бот
  if (botLive() && !A.botInject && (A.v ? A.v.fens[A.v.index] : A.res.fens[A.index]).split(' ')[1] === A.bot.color) { redraw(); return; }
  stopPlay();
  const res = A.res;
  if (A.v) {
    const v = A.v, j = v.index, base = v.base;
    if (j < v.rows.length && v.rows[j].uci === uci) { gotoVar(j + 1, !dragged); return; }
    if (j === 0 && base < res.moves.length && res.moves[base].uci === uci) { clearVar(); goto(base + 1, !dragged); return; }
    const same = findLine(base, [...v.rows.slice(0, j).map(r => r.uci), uci]);
    if (same) { openLine(same, j + 1, !dragged); return; }
  }
  if (!A.v) {
    const k = A.index;
    if (k < res.moves.length && res.moves[k].uci === uci) { goto(k + 1, !dragged); return; }
    // 1.26.7: аналіз ще йде, а це наступний хід партії, якого ще не оцінено - не робимо з нього варіант
    if (res.partial && k === res.moves.length && A.game && A.game.moves[k] === uci) {
      goto(k, false);
      setStatus(() => pick('Цей хід партії ще аналізується — зачекай трохи.', 'This game move is still being analysed — wait a moment.'));
      return;
    }
    const same = findLine(k, [uci]);
    if (same) { openLine(same, 1, !dragged); return; }
    const prev = k >= 1 ? res.moves[k - 1] : null;
    let baseOpening = '';
    if (res.book_path[k]) for (const m of res.moves.slice(0, k).reverse()) if (m.opening) { baseOpening = m.opening; break; }
    A.v = { base: k, rows: [], index: 0, fens: [res.fens[k]], pes: [res.pos_info[k]],
      prev_drop: prev ? prev.drop : 0, prev_cap: prev ? prev.cap_sq : null,
      book_path: [!!res.book_path[k]], base_opening: baseOpening, opening: baseOpening, id: null };
  }
  let v = A.v;
  let j = v.index;
  if (j < v.rows.length) {
    // новий хід посеред варіанту: старий лишається, новий - його копія до цього місця плюс хід
    v = { ...v, id: null, rows: v.rows.slice(0, j), fens: v.fens.slice(0, j + 1), pes: v.pes.slice(0, j + 1),
      book_path: v.book_path.slice(0, j + 1) };
    v.opening = j >= 1 ? (v.rows[j - 1].opening || v.base_opening) : v.base_opening;
    A.v = v;
  }
  const b = new Pos(v.fens[j]);
  if (!b.isLegal(uci)) { showVarState(j, false); return; }
  // хід з'являється одразу (позначка «…»), а Stockfish оцінює його у фоні - можна ходити далі
  const after = b.copy(); after.push(uci);
  const row = { label: b.turn === 'w' ? `${b.fullmove}.` : `${b.fullmove}…`, san: b.san(uci), uci,
    fen: after.fen(), pending: true, quality: null, ...(A.botInject && A.fakeBril ? { fake_bril: true } : {}) };
  // 1.27.7: Каро-Канн проти Witty Alien - «??» лише поки йде гра
  if (!A.botInject && uci === 'c7c6' && b.fullmove === 1 && botLive() && A.bot.spec.id === 'wittyalien' && A.bot.color === 'w') row.fake_blunder = true;
  v.rows.push(row); v.fens.push(row.fen); v.pes.push(null);
  v.index = v.rows.length;
  if (!A.lines.includes(v)) { v.id = nextLineId(); A.lines.push(v); }
  renderMoves();
  showVarState(v.index, !dragged);
  queueEval(v, row);
  if (A.pz) puzzleInstant(v, row);
}

// ---- черга оцінок ходів гравця: по одному, по порядку (кожна оцінка спирається на попередню)
function queueEval(v, row) {
  deepCancel();                                    // 1.30.1: новий хід - глибше над старим не думаємо
  if (!A.pendingEvals) A.statusBeforeEval = A.statusFn;
  A.pendingEvals = (A.pendingEvals || 0) + 1;
  evalStatus();
  A.evalChain = (A.evalChain || Promise.resolve()).then(() => evalRow(v, row)).catch(() => {}).then(() => {
    A.pendingEvals--;
    evalStatus();
    if (!A.pendingEvals) deepStart();
  });
}

// ---------- 1.30.1: поки гравець дивиться на свій хід, Stockfish думає глибше (+2, +4 … до +DEEP_EXTRA)
const DEEP_EXTRA = 10, DEEP_MAX = 30;
A.deepTok = 0;
function deepCancel() {
  A.deepTok++;
  if (A.deepBusy) engine.stop();                   // поточний глибокий пошук закінчиться одразу
}
function deepStart() {
  deepCancel();
  const v = A.v;
  if (!v || A.pendingEvals || !A.res || analysing() || botLive() || A.pz || v.index < 1 || v.index > v.rows.length) return;
  const row = v.rows[v.index - 1], depth = cfg.depth, top = Math.min(DEEP_MAX, depth + DEEP_EXTRA);
  if (row.pending || row.failed || row.quality === 'Теорія' || (row.deep_depth || depth) >= top) return;
  const tok = A.deepTok;
  // рушій лише для цього пошуку: після скасування нові запити не йдуть, щоб хід гравця не чекав
  const live = () => tok === A.deepTok;
  const eng = {
    analyse: (...a) => live() ? engine.analyse(...a) : Promise.reject(new Error('cancel')),
    clearHash: () => live() ? engine.clearHash() : Promise.reject(new Error('cancel')),
  };
  const prevStatus = A.statusFn;
  let shown = null;
  (async () => {
    let d = row.deep_depth || depth;
    try {
      while (d < top && live()) {
        d = Math.min(top, d + 2);
        A.deepBusy = true;
        const ok = await deepStep(tok, eng, v, row, d);
        A.deepBusy = false;
        if (!ok || !live()) break;
        renderMoves();
        if (A.v === v && v.rows[v.index - 1] === row) showVarState(v.index, false);
        if (!A.pendingEvals) {
          shown = () => `🔍 ${pick('Stockfish думає глибше', 'Stockfish is thinking deeper')}: ${pick('глибина', 'depth')} ${d}`;
          setStatus(shown);
        }
      }
    } catch (_) { /* глибша оцінка - лише бонус, звичайна вже є */ }
    A.deepBusy = false;
    if (shown && A.statusFn === shown) setStatus(prevStatus);
    if (shown) docChanged();
  })();
}
async function deepStep(tok, eng, v, row, d) {
  const j = v.rows.indexOf(row) + 1;
  if (j <= 0 || A.v !== v || v.index !== j || !A.res) return false;
  const res = A.res, prevRow = j >= 2 ? v.rows[j - 2] : null;
  const b = new Pos(v.fens[j - 1]), s = res.summary || {};
  const rating = b.turn === 'w' ? s.white_rating : s.black_rating;
  const prevDrop = prevRow ? prevRow.drop : v.prev_drop, prevCap = prevRow ? prevRow.cap_sq : v.prev_cap;
  const prevQ = prevRow ? prevRow.quality : (v.base >= 1 && res.moves[v.base - 1] ? res.moves[v.base - 1].quality : null);
  const hist = { root: v.fens[j - 1], moves: [] };
  const pb = posEval(await eng.analyse(hist.root, [], d), d);
  if (tok !== A.deepTok) return false;
  const [r, peAfter] = await evaluateMove(eng, d, b, hist, row.uci, pb, prevDrop, prevCap, rating, false, true, prevQ === 'Геніальний');
  if (tok !== A.deepTok) return false;
  r.elapsed = row.elapsed; r.opening = row.opening || '';
  Object.assign(row, r);
  row.deep_depth = d;
  for (const L of new Set([...A.lines, ...(A.v ? [A.v] : [])])) {
    const i = L.rows.indexOf(row) + 1;
    if (i > 0) { L.pes[i - 1] = pb; L.pes[i] = peAfter; }
  }
  return true;
}

function evalStatus() {
  if (A.pendingEvals > 0) setStatus(() => `⏳ ${pick('Stockfish оцінює ходи', 'Stockfish is evaluating moves')}… (${A.pendingEvals})`);
  else if (A.statusBeforeEval) { setStatus(A.statusBeforeEval); A.statusBeforeEval = null; }
}

async function evalRow(v, row) {
  let j = v.rows.indexOf(row) + 1;                 // номер ходу у варіанті (позиція до ходу - j-1)
  if (j <= 0 || !row.pending || !A.res) return;    // хід уже скасували або оцінили
  const res = A.res, prevRow = j >= 2 ? v.rows[j - 2] : null;
  if (prevRow && prevRow.pending) return;
  const b = new Pos(v.fens[j - 1]);
  const s = res.summary || {};
  const rating = b.turn === 'w' ? s.white_rating : s.black_rating;
  const prevDrop = prevRow ? prevRow.drop : v.prev_drop;
  const prevCap = prevRow ? prevRow.cap_sq : v.prev_cap;
  const depth = cfg.depth, book = A.book || null;
  let bookHit = false, openingStr = prevRow ? (prevRow.opening || v.base_opening) : v.base_opening;
  const epd = new Pos(row.fen).epd();
  if (book && v.book_path[j - 1] && book.has(epd)) {
    bookHit = true;
    const name = book.name(epd);
    if (name) openingStr = `${name[0]} · ${name[1]}`;
  }
  try {
    if (!engine.w) setStatus(() => pick('Запускаю Stockfish…', 'Starting Stockfish…'));
    await ensureEngine();
    const t0 = performance.now(), hist = { root: v.fens[j - 1], moves: [] };
    let pb = v.pes[j - 1];
    if (!pb && j === 1 && res.pos_info) pb = res.pos_info[v.base] || null;   // 1.28.2: пораховано у фоні
    if (!pb || pb.req_depth !== depth) pb = posEval(await engine.analyse(hist.root, [], depth), depth);
    // 1.23.7: спершу швидка оцінка (на 4 глибини менше) - за нею ШІ-тренер починає думати одразу
    const qd = depth - 4;
    if (false && qd >= 8 && cfg.ai && cfg.coach && !A.aiOff && !botLive()) {   // 1.28.2: ШІ лише за кнопкою
      try {
        const [rq, peq] = await evaluateMove(engine, qd, new Pos(v.fens[j - 1]), { root: v.fens[j - 1], moves: [] }, row.uci, pb,
          prevDrop, prevCap, rating, bookHit, !analysing());
        if (row.pending) aiPrefetch([v.fens[j - 1], row.uci, rq.quality, rq.best_san || '', pb, peq]);
      } catch (_) { /* */ }
    }
    // 1.26.7: поки йде аналіз партії (той самий рушій) - без перевірки «Чудового»: вона очищає хеш і змінила б оцінки партії
    const prevQ = prevRow ? prevRow.quality : (v.base >= 1 && res.moves[v.base - 1] ? res.moves[v.base - 1].quality : null);
    const [r, peAfter] = await evaluateMove(engine, depth, b, hist, row.uci, pb, prevDrop, prevCap, rating, bookHit, !analysing(), prevQ === 'Геніальний');
    r.elapsed = (performance.now() - t0) / 1000;
    r.opening = bookHit ? openingStr : '';
    Object.assign(row, r);
    delete row.pending;
    // той самий хід може бути в кількох варіантах (гілки ділять початок) - оновлюємо всі
    for (const L of new Set([...A.lines, ...(A.v ? [A.v] : [])])) {
      const i = L.rows.indexOf(row) + 1;
      if (i <= 0) continue;
      L.pes[i - 1] = pb; L.pes[i] = peAfter;
      L.book_path[i] = bookHit && row.quality === 'Теорія';
      if (i === L.rows.length) L.opening = r.opening || openingStr;
    }
  } catch (e) {
    row.pending = false; row.failed = true;
    row.quality = 'Добрий'; row.best_uci = null; row.best_san = ''; row.drop = 0; row.cap_sq = null; row.acc = 100;
    msg(`${pick('Помилка Stockfish', 'Stockfish error')}: ${e.message || e}`);
  }
  renderMoves();
  docChanged();
  if (A.pz) puzzleCheck(v, row);
  if (A.v && A.v.rows.includes(row)) {
    const at = A.v.rows.indexOf(row) + 1;
    if (A.v.index === at || A.v.index === at - 1) showVarState(A.v.index, false); else renderVar();
  }
}

function gotoVar(j, animate = null) {
  const v = A.v;
  if (!v || A.varBusy) return;
  j = Math.max(0, Math.min(v.rows.length, j));
  const prev = v.index;
  v.index = j;
  if (animate === null) animate = j === prev + 1;
  showVarState(j, animate);
  deepStart();                                     // 1.30.1: думати глибше над ходом, на який дивимось
}

function showVarState(j, animate = false) {
  const v = A.v;
  if (!v) return;
  const res = A.res, fen = v.fens[j];
  let last = null, badge = null, info;
  const rec = recommend(fen, v.pes[j]);
  if (j === 0) info = esc(tr('Початок варіанту — позиція з партії.'));
  else {
    const row = v.rows[j - 1];
    last = row.uci;
    const fake = row.fake_bril ? 'Геніальний' : row.fake_blunder ? 'Груба помилка' : null;
    if (fake && botLive()) { badge = [QUALITY[fake][0], QUALITY[fake][1]]; info = esc(`${row.label} ${row.san} — ${qname(fake)}.`); }
    else if (row.pending) info = esc(`⏳ ${row.label} ${row.san} — ${pick('Stockfish оцінює цей хід…', 'Stockfish is evaluating this move…')}`);
    else { badge = botLive() ? null : [QUALITY[row.quality][0], QUALITY[row.quality][1]]; info = moveInfo(row); }
  }
  let adv = '';
  if (rec && !botLive() && !pzHide()) {
    const d = v.pes[j].depth, el = j >= 1 ? v.rows[j - 1].elapsed : null;
    const parts = [...(d ? [`${tr('глибина')} ${d}`] : []), ...(el ? [`${el.toFixed(1)} ${tr('с')}`] : [])];
    adv = `${toMove(fen)} — ${tr('Stockfish радить:')} ${rec}` + (parts.length ? `  (${parts.join(', ')})` : '');
  }
  const arrow = bestArrow(j >= 1 ? v.rows[j - 1] : null, v.pes[j]);
  const shapes = A.shapes[lineKey(v, j)] || [];
  if (animate && j >= 1 && cfg.anim) {
    const prevLast = j >= 2 ? v.rows[j - 2].uci : v.base >= 1 ? res.moves[v.base - 1].uci : null;
    board.animate(v.fens[j - 1], prevLast, last, () => board.setPosition(fen, last, badge, arrow, shapes), badge);
  } else board.setPosition(fen, last, badge, arrow, shapes);
  board.interactive = true;
  let known = j;                                       // поки хід оцінюється - остання відома оцінка
  while (known > 0 && !v.pes[known]) known--;
  setEval(v.pes[known] ? v.pes[known].cp : 0);
  const onPath = j < v.book_path.length ? !!v.book_path[j] : false;
  setInfo(info, adv, theoryLine(fen, onPath), badge);
  const pend = j >= 1 && v.rows[j - 1].pending;
  askSetVar(j);
  showCoach(j === 0 ? [tr('Початок варіанту — позиція з партії.')]
    : pend ? [pick('Тренер пояснить хід, щойно Stockfish його оцінить.', 'The coach will explain the move once Stockfish has evaluated it.')]
      : coachVar(j), j >= 1 && !pend ? aiVar(j) : null);
  if (pend && cfg.ai && cfg.coach && !A.aiOff && !botLive()) renderCoach(A.coachLines, null, true);   // 1.23.7: ШІ вже думає
  if (A.bot || A.botUi) setTimeout(botTick, 30);
  renderVar();
  markCurrent();
  drawGraph();
  showNote();
}

function renderVar() {
  const v = A.v, card = $('varCard');
  card.hidden = !v || botLive();             // у партії з ботом кнопки - під дошкою
  if (!v) return;
  $('varMoves').innerHTML = v.rows.map((r, i) => `<span class="mchip${v.index === i + 1 ? ' cur' : ''}" data-j="${i + 1}">`
    + `${qBadge(r.quality, r)}${esc(r.label + r.san)}</span>`).join('');
  $('vUndo').disabled = !v.rows.length;
  $('vDel').disabled = false;
}

function undoVar(bot = false) {
  if (bot !== true && botLive()) { botUndo(); return; }
  const v = A.v;
  if (!v || A.varBusy || !v.rows.length) return;
  v.rows.pop(); v.fens.pop(); v.pes.pop();
  v.book_path.length = Math.min(v.book_path.length, v.rows.length + 1);
  const rows = v.rows;
  v.opening = rows.length ? (rows[rows.length - 1].opening || v.base_opening) : v.base_opening;
  if (!rows.length) { dropLine(v); exitVar(); renderMoves(); docChanged(); return; }
  const twin = findLine(v.base, rows.map(r => r.uci), v);
  if (twin) { dropLine(v); renderMoves(); docChanged(); openLine(twin, rows.length); return; }
  pruneAnnotations(); renderMoves(); docChanged();
  v.index = rows.length;
  showVarState(v.index, false);
}

function deleteVar() {
  const v = A.v;
  if (!v || A.varBusy) return;
  dropLine(v); exitVar(); renderMoves(); docChanged();
}

const lineById = id => A.lines.find(ln => String(ln.id) === String(id)) || null;
const nextLineId = () => Math.max(0, ...A.lines.map(ln => ln.id || 0)) + 1;
function findLine(base, ucis, exclude = null) {
  return A.lines.find(ln => ln !== exclude && ln.base === base && ln.rows.length >= ucis.length
    && ucis.every((u, i) => ln.rows[i].uci === u)) || null;
}
function dropLine(line) {
  const i = A.lines.indexOf(line);
  if (i >= 0) A.lines.splice(i, 1);
  pruneAnnotations();
}
function pruneAnnotations() {
  if (!A.res) return;
  const keys = new Set(A.res.fens.map((_, k) => String(k)));
  for (const ln of A.lines) for (let j = 1; j <= ln.rows.length; j++) keys.add(lineKey(ln, j));
  for (const d of [A.notes, A.shapes]) for (const k of Object.keys(d)) if (!keys.has(k)) delete d[k];
}
const lineKey = (line, j) => [String(line.base), ...line.rows.slice(0, j).map(r => r.uci)].join('/');
const nodeKey = () => (A.v ? lineKey(A.v, A.v.index) : String(A.index));

function openLine(line, j = 1, animate = false) {
  if (A.varBusy) return;
  stopPlay();
  if (A.v !== line) { A.varToken++; A.v = line; A.index = line.base; }
  line.index = Math.max(0, Math.min(line.rows.length, j));
  showVarState(line.index, animate);
}
function exitVar() { if (!A.v) return; const base = A.v.base; clearVar(); goto(base, false); }
function clearVar() {
  A.v = null; A.varToken++; A.varBusy = false;
  deepCancel();
  renderVar();
  board.interactive = !!A.res;
}

// ------------------------------------------------------------ дослідження ---
// ------------------------------------------------------------ 1.28.0: «🧩 Тренування» ---
// Задачі з власних помилок: позиція перед поганим ходом, треба знайти найкращий. Те саме, що в ПК (puzzles_*).
const PZ_QUALS = ['Груба помилка', 'Помилка', 'Пропуск'], PZ_OK = ['Найкращий', 'Геніальний', 'Чудовий'];
const PZ_DAYS = [1, 3, 7, 30], PZ_MAX = 400;
const pzLoad = () => { const d = store.get('ca.puzzles', null); return d && Array.isArray(d.list) ? { list: d.list, done: d.done || [] } : { list: [], done: [] }; };
const pzSave = d => store.set('ca.puzzles', d);
const pzHide = () => !!(A.pz && !A.pz.solved && !A.pz.shown);
function puzzlesFromResult(res, me) {
  if (!res || res.free || res.partial) return [];
  const s = res.summary || {}, src = `${s.white || '?'} – ${s.black || '?'}`, out = [];
  (res.moves || []).forEach((row, k) => {
    const pe = (res.pos_info || [])[k];
    if (!pe || !pe.best || row.uci === pe.best) return;
    if (!PZ_QUALS.includes(row.quality) && !row.missed_bril) return;
    const fen = res.fens[k], white = fen.split(' ')[1] === 'w';
    if (me != null && me !== white) return;
    out.push({ id: fen.split(' ').slice(0, 4).join(' ') + '|' + pe.best, fen, best: pe.best, played: row.san,
      q: PZ_QUALS.includes(row.quality) ? row.quality : 'missed', src, move: `${Math.floor(k / 2) + 1}${white ? '.' : '…'}`, due: 0, ok: 0 });
  });
  return out;
}
function puzzlesCollect(res) {
  try {
    const s = res.summary || {}, nick = (CC.user || '').trim().toLowerCase();
    const me = nick && nick === String(s.white || '').toLowerCase() ? true : nick && nick === String(s.black || '').toLowerCase() ? false : null;
    const fresh = puzzlesFromResult(res, me);
    if (!fresh.length) return;
    const d = pzLoad(), have = new Set([...d.list.map(x => x.id), ...d.done]);
    const add = fresh.filter(x => !have.has(x.id) && have.add(x.id));
    if (!add.length) return;
    d.list = d.list.concat(add).slice(-PZ_MAX);
    pzSave(d);
    const old = A.statusFn;
    setStatus(() => old() + '  ·  ' + pick(`🧩 нових задач: ${add.length}`, `🧩 new puzzles: ${add.length}`));
  } catch (_) { /* */ }
}
function pzNext(d, now, skip) {
  const due = d.list.filter(x => (x.due || 0) <= now && x.id !== skip);
  due.sort((a, b) => (a.due || 0) - (b.due || 0) || (a.ok || 0) - (b.ok || 0));
  return due[0] || null;
}
function pzResult(id, solved) {
  const d = pzLoad(), now = Date.now() / 1000, x = d.list.find(p => p.id === id);
  if (x) {
    if (solved) {
      x.ok = (x.ok || 0) + 1;
      if (x.ok > PZ_DAYS.length) { d.list.splice(d.list.indexOf(x), 1); d.done = d.done.concat([id]).slice(-2000); }
      else x.due = now + PZ_DAYS[x.ok - 1] * 86400;
    } else { x.ok = 0; x.due = now; }
  }
  pzSave(d);
}
function puzzleStart() {
  if (botLive()) { msg(pick('Спершу завершіть партію з ботом.', 'Finish the game with the bot first.')); return; }
  tele('f.puzzle');
  const now = Date.now() / 1000, d = pzLoad(), cur = A.pz;
  const p = pzNext(d, now, cur && d.list.length > 1 ? cur.id : null) || pzNext(d, now, null);
  if (!p) {
    let text;
    if (!d.list.length) text = pick('Задач ще немає. Проаналізуйте свої партії - позиції з помилками стануть задачами.', 'No puzzles yet. Analyze your games - positions with mistakes become puzzles.');
    else {
      const days = Math.max(1, Math.round((Math.min(...d.list.map(x => x.due || 0)) - now) / 86400));
      text = pick(`На сьогодні все розв'язано! Наступна задача - через ${days} дн.`, `All done for today! Next puzzle in ${days} day(s).`);
    }
    if (cur) { cur.solved = true; puzzleRender(text); } else msg(text);
    return;
  }
  const left = d.list.filter(x => (x.due || 0) <= now).length;
  const res = { free: true, fens: [p.fen], evals: [0], pos_info: [null], moves: [], book_path: [false], depth: null,
    summary: { white: 'Білі', black: 'Чорні', white_rating: null, black_rating: null, white_acc: 0, black_acc: 0,
      white_counts: {}, black_counts: {}, result: '*', opening: null } };
  A.pzLoading = true;
  try { newDoc(); A.pz = { ...p, res, tried: false, solved: false, shown: false, arrow: null, left }; startFree(res); }
  finally { A.pzLoading = false; }
  const white = p.fen.split(' ')[1] === 'w';
  if (white === board.flipped) flipBoard();
  $('pzCard').hidden = false;
  puzzleRender();
  $('pzCard').scrollIntoView({ block: 'nearest' });
  // 1.28.2: поки гравець думає - Stockfish рахує позицію задачі (в черзі оцінок, тож хід потім оцінюється швидше)
  const depth = cfg.depth;
  A.evalChain = (A.evalChain || Promise.resolve()).then(async () => {
    if (A.res !== res || res.pos_info[0]) return;
    await ensureEngine();
    const pe = posEval(await engine.analyse(p.fen, [], depth), depth);
    if (A.res !== res) return;
    res.pos_info[0] = pe;
    if (A.v && A.v.base === 0 && !A.v.pes[0]) A.v.pes[0] = pe;
  }).catch(() => {});
}
function puzzleInstant(v, row) {
  const pz = A.pz;
  if (pz.solved || pz.shown || A.res !== pz.res || v.base !== 0 || v.rows[0] !== row || row.uci !== pz.best) return;
  pz.solved = true;
  const first = !pz.tried;
  if (first) { pzResult(pz.id, true); tele('pz.ok'); }
  const extra = first ? '' : pick(' (не з першої спроби)', ' (not on the first try)');
  puzzleRender(pick(`✓ Правильно! ${row.san}${extra} - тисніть «Наступна».`, `✓ Correct! ${row.san}${extra} - press «Next».`));
}
function puzzleSan() { try { return new Pos(A.pz.fen).san(A.pz.best) || A.pz.best; } catch (_) { return A.pz.best; } }
function puzzleRender(text = null) {
  const pz = A.pz, white = pz.fen.split(' ')[1] === 'w';
  const qn = pz.q === 'missed' ? pick('пропущений геніальний', 'missed brilliant') : qname(pz.q).toLowerCase();
  if (text == null) text = pick(`Знайдіть найкращий хід за ${white ? 'білих' : 'чорних'}.`, `Find the best move for ${white ? 'White' : 'Black'}.`)
    + '\n' + pick(`Партія ${pz.src}, хід ${pz.move} - там зіграно ${pz.played} (${qn}).`, `Game ${pz.src}, move ${pz.move} - ${pz.played} was played (${qn}).`);
  const off = pz.solved || pz.shown ? ' disabled' : '';
  $('pzCard').innerHTML = `<div class="pzt">${esc(pick(`🧩 ТРЕНУВАННЯ · у черзі: ${pz.left}`, `🧩 TRAINING · in queue: ${pz.left}`))}</div>`
    + `<div class="pzx">${esc(text)}</div><div class="row">`
    + `<button id="pzHint"${off}>${esc(pick('💡 Підказка', '💡 Hint'))}</button>`
    + `<button id="pzShow"${off}>${esc(pick("✔ Розв'язок", '✔ Solution'))}</button>`
    + `<button id="pzNext" class="primary">${esc(pick('⏭ Наступна', '⏭ Next'))}</button>`
    + `<button id="pzExit">${esc(pick('✕ Вийти', '✕ Exit'))}</button></div>`;
  $('pzHint').addEventListener('click', puzzleHint);
  $('pzShow').addEventListener('click', puzzleShow);
  $('pzNext').addEventListener('click', puzzleStart);
  $('pzExit').addEventListener('click', () => { puzzleHide(); startFree(); });
}
function pzTried() { if (!A.pz.tried) { A.pz.tried = true; pzResult(A.pz.id, false); } }
function puzzleHint() {
  const pz = A.pz;
  if (!pz || pz.solved) return;
  const from = pz.best.slice(0, 2), t = new Pos(pz.fen).c.get(from);
  const names = { p: ['пішак', 'pawn'], n: ['кінь', 'knight'], b: ['слон', 'bishop'], r: ['тура', 'rook'], q: ['ферзь', 'queen'], k: ['король', 'king'] };
  const nm = pick(...names[t ? t.type : 'p']);
  pzTried();
  puzzleRender(pick(`💡 Ходить ${nm} з ${from}.`, `💡 Move the ${nm} on ${from}.`));
}
function puzzleShow() {
  const pz = A.pz;
  if (!pz || pz.solved) return;
  pzTried();
  pz.shown = true;
  if (A.v) { clearVar(); goto(0, false); }    // 1.28.2: прибрати свій хід і зіграти розв'язок на дошці
  onUserMove(pz.best, false);
  puzzleRender(pick(`Розв'язок: ${puzzleSan()}. Задача повернеться пізніше.`, `Solution: ${puzzleSan()}. The puzzle will come back later.`));
}
function puzzleCheck(v, row) {
  const pz = A.pz;
  if (pz.solved || pz.shown || A.res !== pz.res || !v || v.base !== 0 || v.rows[0] !== row || row.pending || row.failed) return;
  if (row.uci === pz.best || PZ_OK.includes(row.quality)) {
    pz.solved = true;
    const first = !pz.tried;
    if (first) { pzResult(pz.id, true); tele('pz.ok'); }
    const extra = first ? '' : pick(' (не з першої спроби)', ' (not on the first try)');
    puzzleRender(pick(`✓ Правильно! ${row.san}${extra} - тисніть «Наступна».`, `✓ Correct! ${row.san}${extra} - press «Next».`));
  } else {
    if (!pz.tried) tele('pz.fail');
    pzTried();
    const qn = qname(row.quality).toLowerCase();
    puzzleRender(pick(`✗ ${row.san} - ${qn}. Поверніть хід (↶) і спробуйте ще, або подивіться розв'язок.`,
      `✗ ${row.san} - ${qn}. Take the move back (↶) and try again, or see the solution.`));
  }
}
function puzzleHide() { A.pz = null; $('pzCard').hidden = true; $('pzCard').innerHTML = ''; }

function newDoc() {
  flushSave();
  if (A.pz && !A.pzLoading) puzzleHide();     // 1.28.0: інша партія - тренування закінчилось
  A.bot = null;                              // партія з ботом (якщо була) на цьому закінчується
  if (A.botUi) setTimeout(botUiSync, 0);
  if (A.alienMode) alienSet(false);          // 1.26.8
  A.docId++;
  A.lines = []; A.notes = {}; A.shapes = {}; A.chapter = null;
  if (A.analysing) engine.stop();
  setRunLabel();
  renderStudyPanel();
}
function docChanged(delay = 0) { if (A.chapter) autosave(delay); }
function autosave(delay = 0) {
  if (!A.study) return;
  clearTimeout(A.saveTimer);
  A.saveTimer = setTimeout(saveStudyNow, delay);
}
function flushSave() { if (A.saveTimer) { clearTimeout(A.saveTimer); A.saveTimer = null; saveStudyNow(); } }
function saveStudyNow() {
  A.saveTimer = null;
  if (!A.study) return;
  if (A.chapter) A.chapter.flipped = board.flipped;
  A.study.updated = now();
  if (!store.set('ca.study.' + A.studyId, A.study)) {
    msg(`${tr('Не вдалося зберегти дослідження:')} ${pick('у телефоні замало місця для даних програми.', 'not enough storage for the app data.')}`);
    return;
  }
  const ids = store.get('ca.studies', []);
  if (!ids.includes(A.studyId)) { ids.push(A.studyId); store.set('ca.studies', ids); }
}
function listStudies() {
  return store.get('ca.studies', []).map(id => ({ id, s: store.get('ca.study.' + id, null) })).filter(x => x.s)
    .sort((a, b) => String(b.s.updated || '').localeCompare(String(a.s.updated || '')));
}

function onShapes(shapes) {
  if (!A.res) return;
  const key = nodeKey();
  if (shapes.length) A.shapes[key] = shapes; else delete A.shapes[key];
  docChanged();
}

function nodeTitle() {
  if (A.v) {
    const j = A.v.index;
    if (j >= 1) { const r = A.v.rows[j - 1]; return `↳ ${r.label}${r.san}`; }
    return tr('Початок варіанту — позиція з партії.');
  }
  if (A.res && A.index >= 1) { const m = A.res.moves[A.index - 1]; return `${m.label} ${m.san}`; }
  return tr('Початкова позиція');
}

function showNote() {
  if (!A.study) return;
  const ta = $('stNote');
  $('stNoteL').textContent = pick('КОМЕНТАР', 'COMMENT') + ' · ' + nodeTitle();
  const on = !!A.chapter && !!A.res;
  ta.disabled = !on;
  ta.placeholder = on ? pick('Ваш коментар до цієї позиції…', 'Your comment on this position…')
    : pick('Додайте партію в дослідження, щоб писати коментарі.', 'Add the game to the study to write comments.');
  A.noteKey = nodeKey();
  if (document.activeElement !== ta || ta.value !== (A.notes[A.noteKey] || '')) ta.value = on ? (A.notes[A.noteKey] || '') : '';
}
function onNoteEdit() {
  if (!A.chapter || !A.res) return;
  const text = $('stNote').value;
  if (text.trim()) A.notes[A.noteKey] = text; else delete A.notes[A.noteKey];
  docChanged(700);
}

function renderStudyPanel() {
  const st = A.study;
  $('studyCard').hidden = !st;
  if (!st) return;
  if (document.activeElement !== $('stName')) $('stName').value = st.name;
  const cur = A.chapter ? st.chapters.indexOf(A.chapter) : -1;
  $('stChapters').innerHTML = st.chapters.length ? st.chapters.map((ch, i) => `<div class="it${i === cur ? ' cur' : ''}" data-ch="${i}">`
    + `${esc(ch.name || '?')}<small>${esc(ch.result && ch.result.free ? pick('вільна гра', 'free play') : plural((ch.result.moves || []).length, ['хід', 'ходи', 'ходів'], ['move', 'moves']))}</small></div>`).join('')
    : `<div class="hint">${esc(tr('У дослідженні ще немає розділів.'))}</div>`;
  if (document.activeElement !== $('stChName')) $('stChName').value = A.chapter ? A.chapter.name : '';
  $('stChName').disabled = !A.chapter;
  $('stDel').disabled = !A.chapter;
  $('stAdd').disabled = !A.res || !!A.chapter;
  $('stStatus').textContent = plural(st.chapters.length, ['розділ', 'розділи', 'розділів'], ['chapter', 'chapters'])
    + (A.chapter ? '' : (A.res ? '  ·  ' + pick('партія на дошці не в дослідженні', 'the game on the board is not in the study') : ''));
  showNote();
}

function chapterGame(ch) {
  const res = ch.result;
  return { root: res.fens[0], moves: res.moves.map(m => m.uci), headers: ch.headers || {} };
}

function openChapter(i) {
  const st = A.study, ch = st && st.chapters[i];
  if (!ch) return;
  const res = ch.result;
  if (!res || !Array.isArray(res.fens) || !res.fens.length || !Array.isArray(res.moves)) { msg(tr('Розділ пошкоджений, його не вдалося відкрити.')); return; }
  stopPlay();
  newDoc();
  A.chapter = ch;
  A.lines = (ch.lines ||= []); A.notes = (ch.notes ||= {}); A.shapes = (ch.shapes ||= {});
  // ходи, які не встигли оцінити до закриття програми, відкидаємо (їх оцінка вже не прийде)
  for (let i = A.lines.length - 1; i >= 0; i--) {
    const ln = A.lines[i], p = ln.rows.findIndex(r => r.pending);
    if (p < 0) continue;
    ln.rows.length = p; ln.fens.length = p + 1; ln.pes.length = p + 1;
    ln.book_path.length = Math.min(ln.book_path.length, p + 1);
    if (!ln.rows.length) A.lines.splice(i, 1);
  }
  st.current = i;
  if (!!ch.flipped !== board.flipped) board.flip();
  if (res.free) startFree(res);
  else {
    A.game = chapterGame(ch);
    resetView();
    const s = res.summary || {};
    setNames(s.white || 'Білі', s.white_elo || '', s.black || 'Чорні', s.black_elo || '');
    showResults(res, false);
  }
  renderStudyPanel();
  autosave();
}

function addDocToStudy(st) {
  if (!A.res) return false;
  const free = !!A.res.free, s = A.res.summary || {};
  const name = free ? `${pick('Розділ', 'Chapter')} ${st.chapters.length + 1}` : `${s.white || '?'} – ${s.black || '?'}`;
  const ch = { name, headers: A.game ? { ...A.game.headers } : {}, result: A.res, lines: A.lines, notes: A.notes,
    shapes: A.shapes, flipped: board.flipped };
  st.chapters.push(ch);
  st.current = st.chapters.length - 1;
  A.chapter = ch;
  return true;
}

function addChapter() {
  if (!A.study) return;
  if (A.analysing && A.runDoc === A.docId) { msg(tr('Зачекайте, поки закінчиться аналіз партії.')); return; }
  if (A.chapter || !addDocToStudy(A.study)) return;
  saveStudyNow(); renderStudyPanel(); showNote();
}

async function deleteChapter() {
  const st = A.study, ch = A.chapter;
  if (!st || !ch) return;
  if (!await ask(pick(`Видалити розділ «${ch.name}»?`, `Delete the chapter "${ch.name}"?`))) return;
  const i = st.chapters.indexOf(ch);
  if (i >= 0) st.chapters.splice(i, 1);
  A.chapter = null;
  st.current = Math.max(0, Math.min(st.current || 0, st.chapters.length - 1));
  saveStudyNow(); renderStudyPanel();
}

function closeStudy() { flushSave(); A.study = null; A.studyId = null; A.chapter = null; renderStudyPanel(); }

function shapeComment(shapes) {
  const csl = (shapes || []).filter(s => s.length === 3), cal = (shapes || []).filter(s => s.length === 5);
  return [csl.length ? `[%csl ${csl.join(',')}]` : '', cal.length ? `[%cal ${cal.join(',')}]` : ''].filter(Boolean).join(' ');
}

/** Розділ у PGN: основна лінія, варіанти гравця, коментарі, стрілки ([%csl]/[%cal]) - як chapter_pgn. */
function chapterPgn(ch, studyName = '') {
  const res = ch.result, notes = ch.notes || {}, shapes = ch.shapes || {};
  const root = { children: [] }, byKey = { 0: root };
  let node = root;
  res.moves.forEach((m, i) => { const c = { uci: m.uci, san: m.san, children: [] }; node.children.push(c); node = c; byKey[i + 1] = c; });
  for (const ln of ch.lines || []) {
    let nd = byKey[ln.base];
    if (!nd) continue;
    let path = String(ln.base);
    for (const r of ln.rows) {
      path += '/' + r.uci;
      let c = nd.children.find(x => x.uci === r.uci);
      if (!c) { c = { uci: r.uci, san: r.san, children: [] }; nd.children.push(c); }
      nd = c; byKey[path] = nd;
    }
  }
  for (const [key, nd] of Object.entries(byKey)) {
    nd.comment = [shapeComment(shapes[key]), (notes[key] || '').replace(/[{}]/g, '').trim()].filter(Boolean).join(' ');
  }
  const out = [];
  const num = (p, force) => (p.turn === 'w' ? `${p.fullmove}. ` : force ? `${p.fullmove}... ` : '');
  const walk = (pos, nd, needNum) => {
    while (nd.children.length) {
      const [main, ...alts] = nd.children;
      out.push(num(pos, needNum) + main.san);
      if (main.comment) out.push(`{ ${main.comment} }`);
      let need = !!main.comment;
      for (const alt of alts) {
        out.push('(' + num(pos, true) + alt.san);
        if (alt.comment) out.push(`{ ${alt.comment} }`);
        const p2 = pos.copy(); p2.push(alt.uci);
        walk(p2, alt, !!alt.comment);
        out[out.length - 1] += ')';
        need = true;
      }
      pos = pos.copy(); pos.push(main.uci); nd = main; needNum = need;
    }
  };
  if (root.comment) out.push(`{ ${root.comment} }`);
  walk(new Pos(res.fens[0]), root, true);
  const h = { ...(ch.headers || {}) };
  const result = h.Result || (res.summary && res.summary.result) || '*';
  const tags = [['Event', studyName ? `${studyName}: ${ch.name || ''}` : ch.name || '?'], ['Site', h.Site || '?'],
    ['Date', h.Date || '????.??.??'], ['Round', h.Round || '?'], ['White', h.White || '?'], ['Black', h.Black || '?'], ['Result', result]];
  for (const k of ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'FEN', 'SetUp']) delete h[k];
  if (res.fens[0] !== START_FEN) tags.push(['SetUp', '1'], ['FEN', res.fens[0]]);
  for (const [k, v] of Object.entries(h)) tags.push([k, v]);
  const head = tags.map(([k, v]) => `[${k} "${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('\n');
  return `${head}\n\n${out.join(' ')} ${result}\n`;
}

function shareText(text, filename) {
  if (bridge && bridge.share) { bridge.share(text, filename); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/x-chess-pgn' }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportStudy() {
  const st = A.study;
  if (!st) return;
  flushSave();
  if (!st.chapters.length) { msg(tr('У дослідженні ще немає розділів.')); return; }
  const text = st.chapters.map(ch => chapterPgn(ch, st.name)).join('\n');
  const name = (st.name || 'study').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || 'study';
  shareText(text, name + '.pgn');
}

function openStudy(id) {
  flushSave();
  const st = store.get('ca.study.' + id, null);
  if (!st || !Array.isArray(st.chapters)) { msg(tr('Не вдалося відкрити дослідження.')); return; }
  A.study = st; A.studyId = id; A.chapter = null;
  closeBox();
  renderStudyPanel();
  if (st.chapters.length) openChapter(Math.min(st.current || 0, st.chapters.length - 1));
  showStudyCard();
}

function showStudyCard() { $('panel').scrollTop = Math.max(0, $('studyCard').offsetTop - 8); }

async function deleteStudy(id) {
  const st = store.get('ca.study.' + id, null);
  if (!await ask(pick(`Видалити дослідження «${st ? st.name : ''}»? Його не можна буде відновити.`,
    `Delete the study "${st ? st.name : ''}"? It cannot be restored.`))) return;
  if (A.studyId === id) { clearTimeout(A.saveTimer); A.saveTimer = null; A.study = null; A.studyId = null; A.chapter = null; renderStudyPanel(); }
  store.del('ca.study.' + id);
  store.set('ca.studies', store.get('ca.studies', []).filter(x => x !== id));
  reopenBox();
}

function createStudy(name) {
  if (A.analysing && A.runDoc === A.docId) { msg(tr('Зачекайте, поки закінчиться аналіз партії.')); return; }
  flushSave();
  const st = { name: name.trim() || pick('Нове дослідження', 'New study'), created: now(), updated: now(), current: 0, chapters: [] };
  A.study = st; A.studyId = 'study-' + Date.now().toString(36); A.chapter = null;
  addDocToStudy(st);
  saveStudyNow();
  closeBox();
  renderStudyPanel();
  showStudyCard();
}

// ------------------------------------------------------------ партії з chess.com (з 1.21.0) ---
// Відкритий API chess.com (без входу - лише нік): місяці з партіями, далі партії місяця з PGN.
const CC_API = 'https://api.chess.com/pub/player/';
const CC_CLASSES = [['bullet', 'Куля', 'Bullet'], ['blitz', 'Бліц', 'Blitz'], ['rapid', 'Рапід', 'Rapid'], ['daily', 'Щоденні', 'Daily']];
const CC_MONTHS = [['Січень', 'January'], ['Лютий', 'February'], ['Березень', 'March'], ['Квітень', 'April'], ['Травень', 'May'],
  ['Червень', 'June'], ['Липень', 'July'], ['Серпень', 'August'], ['Вересень', 'September'], ['Жовтень', 'October'],
  ['Листопад', 'November'], ['Грудень', 'December']];
const CC = { user: store.get('ca.ccUser', ''), months: [], month: 0, type: 'all', rows: [], cache: {}, seq: 0, status: null };

async function ccGet(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!r.ok) { const e = new Error('http'); e.code = r.status; throw e; }
  return r.json();
}
function ccGames(data, user) {
  const me = user.toLowerCase(), rows = [];
  for (const g of data.games || []) {
    if ((g.rules || 'chess') !== 'chess' || !g.pgn) continue;
    const w = g.white || {}, b = g.black || {};
    const white = (w.username || '').toLowerCase() === me;
    const [mine, opp] = white ? [w, b] : [b, w];
    const result = mine.result === 'win' ? 'win' : opp.result === 'win' ? 'loss' : 'draw';
    let opening = '';
    const m = /\[ECOUrl "[^"]*\/openings\/([^"]+)"\]/.exec(g.pgn);
    if (m) opening = m[1].split(/(?:-|\.\.\.)\d/)[0].replace(/-/g, ' ');
    rows.push({ end: g.end_time || 0, white, opp: opp.username || '?', oppRating: opp.rating || null, result,
      cls: g.time_class || '', tc: String(g.time_control || ''), opening, pgn: g.pgn });
  }
  return rows.sort((a, b) => b.end - a.end);
}
function ccTime(tc) {
  if (tc.includes('/')) { const d = Math.floor(+tc.split('/')[1] / 86400); return isNaN(d) ? tc : pick(`${d} д`, `${d} d`); }
  const [base, inc] = tc.split('+'), b = +base;
  if (isNaN(b)) return tc;
  const main = b >= 60 ? String(Math.floor(b / 60)) : pick(`${b} с`, `${b} s`);
  return inc && inc !== '0' ? `${main}+${inc}` : main + (b >= 60 ? pick(' хв', ' min') : '');
}
function ccSetStatus(fn) { CC.status = fn; const el = $('ccStatus'); if (el) el.textContent = fn ? fn() : ''; }
function ccErr(e, user) {
  if (e && e.code === 404) return () => pick(`Гравця «${user}» на chess.com не знайдено.`, `Player «${user}» was not found on chess.com.`);
  if (e && e.code === 429) return () => pick('chess.com просить зачекати хвилинку — спробуйте ще раз.', 'chess.com asks to wait a minute — please try again.');
  return () => pick('Не вдалося з’єднатися з chess.com. Перевірте інтернет.', 'Could not connect to chess.com. Check your internet connection.');
}
function ccView() { return CC.rows.filter(r => CC.type === 'all' || r.cls === CC.type); }
function ccCount() {
  const n = ccView().length;
  return () => `${plural(n, ['партія', 'партії', 'партій'], ['game', 'games'])} · ${pick('торкніться партії — аналіз', 'tap a game to analyze')}`;
}

// ------------------------------------------------------------ боти (1.24.0; 1.25.0 - зірки, фото, екран гри) ---
// Гра проти Stockfish у стилі відомих шахістів: звичайна вільна гра, де за одну сторону ходить бот.
// Поки партія йде - екран гри: фото й зірки, репліки бота (ШІ), «Повернути хід» / «Підказка» (1 раз) / «Здатися»;
// аналізу немає (шкала, графік, «Оцінка партії», оцінки ходів). Після партії - зірки й звичайний аналізатор.
const botById = id => D.BOTS.find(b => b.id === id) || D.BOTS[0];
const botName = b => pick(b.uk, b.en);
const botPhoto = id => 'data:image/png;base64,' + D.BOT_PHOTOS[id];
// 1.26.0: «тривожний» Witty Alien (задум автора програми) - поки його видно, фото інколи «збоїть»;
// наведення або дотик - він «дивиться» (очі горять). Картинки з data-alien - картка партії, меню ботів.
const ALIEN = 'wittyalien';
const alienSrc = k => 'data:image/png;base64,' + D.BOT_PHOTO_FX[ALIEN][k];
// 1.26.8: «режим прибульця» (користувач) - чорними проти Witty Alien у Каро-Канн (1.e4 c6): страшне фото, дошка,
// фігури-прибульці, темний фон, «збої». Поза ним - звичайне фото без ефектів.
function alienWanted() {
  const b = A.bot;
  if (!b || b.spec.id !== ALIEN || b.color !== 'w' || !A.res || A.res !== b.res) return false;
  const m = botMoves();
  return m[0] === 'e2e4' && m[1] === 'c7c6';
}
// 1.26.9: «лютий глюк» (~1,8 с), коли Witty Alien бере конем на f7: усе трясеться й розсипається, фото й назва збоять,
// тріск зі звуку. Потім усе як було.
function alienRage() {
  if (A.rage) return;
  A.rage = true;
  document.body.classList.add('rage');
  const titles = ['Ṅ̷̢x̸̨f̵̛7̶̕', 'C̸̡̛h̷̢e̵̕s̶̨s̸ ̷A̵̢n̶a̸̛l̷y̵z̶̕e̸r̷', '▓▒░ 👽 ░▒▓', 'E̷R̸R̵O̶R̷ ̸F̵7̶', 'Ẅ̵̡I̷̛T̸̨T̶Y̷'];
  const fx = document.createElement('div');
  fx.id = 'rageFx';
  document.body.appendChild(fx);
  const img = $('botCard') && $('botCard').querySelector('img');
  let i = 0;
  const tick = () => {
    if (i++ >= 22) {
      fx.remove(); document.body.classList.remove('rage'); A.rage = false;
      $('title').textContent = A.alienMode ? '👽 C̷h̴e̵s̶s̷ ̸A̵n̶a̷l̴y̵z̶e̷r̸' : pick('♞ Аналізатор', '♞ Chess Analyzer');
      if (botLive()) renderBotCard();
      setStatus(() => pick('👽 Кінь на f7. Він це зробив.', '👽 Knight on f7. He did it.'));
      return;
    }
    $('title').textContent = titles[Math.floor(Math.random() * titles.length)];
    if (img) img.src = alienSrc(['glitch', 'neg', 'stare', 'glitch'][Math.floor(Math.random() * 4)]);
    fx.style.setProperty('--y', Math.floor(Math.random() * 90) + '%');
    fx.style.setProperty('--h', (4 + Math.random() * 18) + '%');
    fx.textContent = Math.random() < 0.3 ? ['N x f 7', 'ERROR', '👽', 'f7 f7 f7', 'SIGNAL LOST'][Math.floor(Math.random() * 5)] : '';
    setTimeout(tick, 45 + Math.random() * 65);
  };
  tick();
  try {                                       // тріск: шум і «пищання» Web Audio
    const ctx = A.audio || (A.audio = new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime, dur = 1.1;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (Math.floor(k / 1800) % 3 ? 0.35 : 0.05);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t0); g.gain.linearRampToValueAtTime(0, t0 + dur);
    src.connect(g).connect(ctx.destination); src.start(t0);
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'square';
    for (let k = 0; k < 14; k++) o.frequency.setValueAtTime([90, 140, 220, 400, 900, 1700, 2600][Math.floor(Math.random() * 7)], t0 + k * 0.06);
    og.gain.setValueAtTime(0.06, t0); og.gain.linearRampToValueAtTime(0, t0 + 0.9);
    o.connect(og).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.9);
  } catch (_) { /* без звуку */ }
}

// 1.26.11: звуки «режиму прибульця» - «голос прибульця» на кожен хід і жуткий саундтрек фоном. Ті самі формули,
// що й у ПК (alien_sfx_samples / alien_bg_samples), звуки згенеровані, не взяті з відео.
const ALIEN_SR = 16000, ALIEN_BG_T = 24;
function alienSfxSamples(kind, sr = ALIEN_SR) {
  const tau = 2 * Math.PI, dur = [1.3, 1.05, 1.45][kind], n = Math.floor(sr * dur);
  let seed = 11 + kind;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const contour = [[[0, 95], [0.35, 72], [1, 50]], [[0, 68], [0.5, 80], [1, 56]], [[0, 62], [0.25, 90], [0.6, 66], [1, 48]]][kind];
  const vow = { U: [300, 870, 2240], A: [730, 1090, 2440], O: [570, 840, 2410], M: [260, 1000, 2200] };
  const path = ['UAO', 'MUM', 'OAUO'][kind];
  const interp = (pts, x) => { for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts[pts.length - 1][1]; };
  const formants = x => {
    const k = x * (path.length - 1), i = Math.min(Math.floor(k), path.length - 2), f = k - i;
    const a = vow[path[i]], b = vow[path[i + 1]];
    return [0, 1, 2].map(j => 0.62 * (a[j] + (b[j] - a[j]) * f));
  };
  const st = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], co = [null, null, null];
  const gains = [1.0, 0.35, 0.1], qs = [6, 9, 12];
  let ph = 0, ph2 = 0, jit = 0, jitT = 0, chest = 0, lp = 0;
  const kc = 1 - Math.exp(-tau * 250 / sr), kl = 1 - Math.exp(-tau * 1800 / sr), flut = 26 + 5 * rnd();
  const tail = Math.floor(sr * 0.6), dry = new Float32Array(n + tail);
  for (let i = 0; i < n; i++) {
    const t = i / sr, x = t / dur;
    if (t >= jitT) { jit = 0.03 * (rnd() - 0.5); jitT = t + 0.02; }
    const f0 = interp(contour, x) * (1 + jit);
    ph += f0 / sr; ph2 += f0 / (2 * sr);
    let src = 0.75 * (2 * (ph % 1) - 1) + 0.45 * Math.sin(tau * ph2);
    src *= 0.62 + 0.38 * Math.sin(tau * flut * t);                       // гарчання
    if (kind === 2 && t < 0.32 && (t % 0.045) < 0.006) src += 1.6 * (rnd() * 2 - 1);   // клацання
    if (i % 32 === 0) formants(x).forEach((fc, j) => {
      const w0 = tau * fc / sr, al = Math.sin(w0) / (2 * qs[j]), a0 = 1 + al;
      co[j] = [al / a0, -al / a0, -2 * Math.cos(w0) / a0, (1 - al) / a0];
    });
    let y = 0;
    for (let j = 0; j < 3; j++) {
      const [b0, b2, a1, a2] = co[j], s = st[j];
      const v = b0 * src + b2 * s[1] - a1 * s[2] - a2 * s[3];
      s[1] = s[0]; s[0] = src; s[3] = s[2]; s[2] = v;
      y += gains[j] * v;
    }
    chest += kc * (src - chest);
    y += 0.6 * chest;
    lp += kl * (y - lp);
    y = lp * (0.78 + 0.22 * Math.sin(tau * 38 * t));
    dry[i] = y * Math.min(1, t / 0.06) * Math.min(1, (dur - t) / 0.3);
  }
  const wet = new Float32Array(dry.length);
  for (const [d, g] of [[403, 0.8], [431, 0.79], [463, 0.78], [491, 0.77]]) {
    const buf = new Float32Array(d); let k = 0;
    for (let i = 0; i < dry.length; i++) { const o = buf[k]; buf[k] = dry[i] + o * g; wet[i] += o; k = (k + 1) % d; }
  }
  for (const [d, g] of [[151, 0.5], [53, 0.5]]) {
    const buf = new Float32Array(d); let k = 0;
    for (let i = 0; i < wet.length; i++) { const v = wet[i], o = buf[k]; buf[k] = v + o * g; wet[i] = o - g * v; k = (k + 1) % d; }
  }
  const out = new Float32Array(dry.length);
  let peak = 1e-9;
  for (let i = 0; i < dry.length; i++) { out[i] = dry[i] + 0.22 * wet[i]; peak = Math.max(peak, Math.abs(out[i])); }
  for (let i = 0; i < out.length; i++) out[i] *= 0.7 / peak;
  return out;
}
function alienBgSamples(sr = ALIEN_SR, T = ALIEN_BG_T) {
  const n = sr * T, out = new Float32Array(n), tau = 2 * Math.PI;
  let lp = 0, tp = 0, seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 1073741824 - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let x = 0.22 * Math.sin(tau * 55 * t) + 0.18 * Math.sin(tau * 55.75 * t)
      + 0.10 * Math.sin(tau * 82.5 * t) * (0.6 + 0.4 * Math.sin(tau * t / 8))
      + 0.08 * Math.sin(tau * 77.75 * t) * (0.5 + 0.5 * Math.sin(tau * t / 12 + 1));
    lp += 0.02 * (rnd() - lp);
    x += 2.2 * lp * Math.sin(Math.PI * t / T) ** 2 * (0.6 + 0.4 * Math.sin(tau * t / 6));
    const tb = t % 1.6;
    if (tb < 0.2) x += 0.5 * Math.sin(tau * 48 * tb) * Math.exp(-tb * 25);
    else if (tb >= 0.28 && tb < 0.48) x += 0.35 * Math.sin(tau * 44 * (tb - 0.28)) * Math.exp(-(tb - 0.28) * 25);
    for (const t0 of [3, 11, 19]) if (t >= t0 && t < t0 + 3) {
      const v = (t - t0) / 3;
      tp += tau * (700 + 400 * Math.sin(Math.PI * v) + 25 * Math.sin(tau * 6 * (t - t0))) / sr;
      x += 0.12 * Math.sin(Math.PI * v) ** 2 * Math.sin(tp);
    }
    out[i] = 0.9 * x / (1 + Math.abs(x));
  }
  return out;
}
function alienAudioCtx() {
  try {
    const ctx = A.audio || (A.audio = new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch (_) { return null; }
}
function alienBuf(ctx, data) { const b = ctx.createBuffer(1, data.length, ALIEN_SR); b.getChannelData(0).set(data); return b; }
function alienSfx() {
  const ctx = alienAudioCtx();
  if (!ctx) return;
  A.alienSfxBufs ||= [0, 1, 2].map(k => alienBuf(ctx, alienSfxSamples(k)));
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = A.alienSfxBufs[Math.floor(Math.random() * 3)];
  g.gain.value = 1.0;
  src.connect(g).connect(ctx.destination); src.start();
}
function alienBg(on) {
  const ctx = alienAudioCtx();
  if (!ctx) return;
  if (!on) {
    if (A.alienBgSrc) {
      const { src, g } = A.alienBgSrc; A.alienBgSrc = null;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => { try { src.stop(); } catch (_) { /* */ } }, 1500);
    }
    return;
  }
  if (A.alienBgSrc) return;
  A.alienBgBuf ||= alienBuf(ctx, alienBgSamples());
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = A.alienBgBuf; src.loop = true;
  g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(0.45, ctx.currentTime + 2);
  src.connect(g).connect(ctx.destination); src.start();
  A.alienBgSrc = { src, g };
}
// програма згорнута - звук на паузі (інакше Android грав би саундтрек у фоні)
document.addEventListener('visibilitychange', () => {
  if (!A.audio) return;
  if (document.hidden) A.audio.suspend(); else if (A.alienBgSrc) A.audio.resume();
});

// 1.27.8: звук на 1...c6 проти Witty Alien - рик величезного печерного монстра (як alien_rage2_samples у ПК)
function alienRage2Samples(sr = ALIEN_SR) {
  const tau = 2 * Math.PI, dur = 2.8, n = Math.floor(sr * dur);
  let seed = 29;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const vow = { A: [730, 1090, 2440], O: [570, 840, 2410], U: [300, 870, 2240] }, path = 'AAOU';
  const qs = [4, 6, 8], gains = [1, 0.45, 0.15], st = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], co = [null, null, null];
  let ph = 0, ph2 = 0, phs = 0, jit = 0, jitT = 0, rough = 0, breath = 0, lp = 0;
  const kl = 1 - Math.exp(-tau * 800 / sr), tail = Math.floor(sr * 1.2), dry = new Float32Array(n + tail);
  for (let i = 0; i < n; i++) {
    const t = i / sr, x = t / dur;
    if (t >= jitT) { jit = 0.06 * (rnd() - 0.5); rough = rnd(); jitT = t + 0.008; }
    const f0 = (70 - 28 * x) * (1 + jit);
    ph += f0 / sr; ph2 += f0 / (2 * sr);
    let src = 0.7 * (2 * (ph % 1) - 1) + 0.8 * Math.sin(tau * ph2);
    breath += 0.3 * ((rnd() * 2 - 1) - breath);
    src = src * (0.55 + 0.45 * Math.abs(Math.sin(tau * 33 * t + 3 * rough))) + 0.5 * breath;
    if (i % 32 === 0) {
      const k = x * (path.length - 1), j0 = Math.min(Math.floor(k), path.length - 2), fr = k - j0;
      const a = vow[path[j0]], b = vow[path[j0 + 1]];
      for (let j = 0; j < 3; j++) {
        const fc = 0.55 * (a[j] + (b[j] - a[j]) * fr), w0 = tau * fc / sr, al = Math.sin(w0) / (2 * qs[j]), a0 = 1 + al;
        co[j] = [al / a0, -al / a0, -2 * Math.cos(w0) / a0, (1 - al) / a0];
      }
    }
    let y = 0;
    for (let j = 0; j < 3; j++) {
      const [b0, b2, a1, a2] = co[j], s = st[j], v = b0 * src + b2 * s[1] - a1 * s[2] - a2 * s[3];
      s[1] = s[0]; s[0] = src; s[3] = s[2]; s[2] = v; y += gains[j] * v;
    }
    y = Math.tanh(2.5 * y);
    phs += (60 + 30 * Math.sin(tau * 0.9 * t)) / sr;
    y += 0.35 * Math.tanh(3 * Math.sin(tau * phs));
    lp += kl * (y - lp);
    dry[i] = lp * Math.min(1, t / 0.25) * Math.min(1, (dur - t) / 0.8);
  }
  const wet = new Float32Array(dry.length);
  for (const [d, g] of [[797, 0.85], [863, 0.84], [929, 0.83], [1013, 0.82]]) {
    const buf = new Float32Array(d); let k = 0;
    for (let i = 0; i < dry.length; i++) { const o = buf[k]; buf[k] = dry[i] + o * g; wet[i] += o; k = (k + 1) % d; }
  }
  for (const [d, g] of [[233, 0.6], [79, 0.6]]) {
    const buf = new Float32Array(d); let k = 0;
    for (let i = 0; i < wet.length; i++) { const v = wet[i], o = buf[k]; buf[k] = v + o * g; wet[i] = o - g * v; k = (k + 1) % d; }
  }
  const out = new Float32Array(dry.length);
  let peak = 1e-9;
  for (let i = 0; i < dry.length; i++) { out[i] = dry[i] + 0.45 * wet[i]; peak = Math.max(peak, Math.abs(out[i])); }
  for (let i = 0; i < out.length; i++) out[i] *= 0.85 / peak;
  return out;
}

// 1.27.7: другий «лютий глюк» (~2,4 с) - на 1...c6 проти Witty Alien: телевізійний шум, фігури тремтять,
// чорна смуга котиться вниз, як на старій касеті, спалахи негативу, «c6??»; свій звук
function alienRage2() {
  if (A.rage) return;
  A.rage = true;
  document.body.classList.add('rage2');
  const fx = document.createElement('canvas');
  fx.id = 'rage2Fx';
  const W = fx.width = 120, H = fx.height = 200;
  document.body.appendChild(fx);
  const g2 = fx.getContext('2d');
  const img = $('botCard') && $('botCard').querySelector('img');
  const titles = ['c̷6̸?̵?̶', '▓▓ C6 ▓▓', 'Ẅ̵̡I̷̛T̸̨T̶Y̷ ̸S̷E̸E̵S̶', '░ ?? ░'];
  try {
    const ctx = alienAudioCtx();
    if (ctx) {
      A.rage2Buf ||= alienBuf(ctx, alienRage2Samples());
      const src = ctx.createBufferSource(); src.buffer = A.rage2Buf; src.connect(ctx.destination); src.start();
    }
  } catch (_) { /* без звуку */ }
  let i = 0;
  const tick = () => {
    if (i++ >= 30) {
      fx.remove(); document.body.classList.remove('rage2'); A.rage = false;
      $('title').textContent = A.alienMode ? '👽 C̷h̴e̵s̶s̷ ̸A̵n̶a̷l̴y̵z̶e̷r̸' : pick('♞ Аналізатор', '♞ Chess Analyzer');
      board.render();
      if (botLive()) renderBotCard();
      setStatus(() => pick("👽 c6?? Він це запам'ятав.", '👽 c6?? He will remember that.'));
      return;
    }
    const im = g2.createImageData(W, H), d = im.data;              // телевізійний шум
    for (let k = 0; k < d.length; k += 4) { const v = Math.random() * 255; d[k] = v * 0.6; d[k + 1] = v; d[k + 2] = v * 0.6; d[k + 3] = Math.random() < 0.45 ? 150 : 0; }
    g2.putImageData(im, 0, 0);
    const yb = (i * H / 10) % H;                                    // смуга, що котиться
    g2.fillStyle = '#000'; g2.fillRect(0, yb, W, H / 16);
    if (i % 5 === 1 || i % 5 === 2) { g2.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.55)' : 'rgba(255,0,51,.5)'; g2.fillRect(0, 0, W, H); }
    g2.fillStyle = Math.random() < 0.5 ? '#ff1744' : '#fff';
    g2.font = 'bold 26px Consolas, monospace'; g2.textAlign = 'center';
    g2.fillText(Math.random() < 0.6 ? 'c6??' : pick('ПОМИЛКА', 'ERROR'), W / 2 + (Math.random() - 0.5) * 30, H / 2 + (Math.random() - 0.5) * 60);
    $('title').textContent = titles[Math.floor(Math.random() * titles.length)];
    if (img) img.src = alienSrc(['neg', 'stare', 'glitch', 'stare'][Math.floor(Math.random() * 4)]);
    for (const p of document.querySelectorAll('#board svg image')) p.style.transform = `translate(${(Math.random() - 0.5) * 0.7}px, ${(Math.random() - 0.5) * 0.7}px)`;
    setTimeout(tick, 60 + Math.random() * 40);
  };
  tick();
}

function alienCheck() { const on = alienWanted(); if (on !== !!A.alienMode) alienSet(on); }
function alienSet(on) {
  A.alienMode = on;
  document.body.classList.toggle('alien', on);
  board.alien = on; if (A.bot) board.alienSide = A.bot.color; board.render();
  $('title').textContent = on ? '👽 C̷h̴e̵s̶s̷ ̸A̵n̶a̷l̴y̵z̶e̷r̸' : pick('♞ Аналізатор', '♞ Chess Analyzer');
  alienBg(on);
  if (on) tele('alien.on');
  if (on) { setStatus(() => pick('👽 Сигнал перехоплено. Каро-Канн… Він на це чекав.', '👽 Signal intercepted. The Caro-Kann… He was waiting for this.')); if (botMoves().slice(-1)[0] === 'c7c6') setTimeout(alienRage2, 250); else alienSfx(); if (botLive()) botSay('alien'); }
  else { clearTimeout(A.alienT); A.alienT = 0; A.alienHover = false; }
  if (botLive()) renderBotCard();
}
const alienImgs = () => [...document.querySelectorAll('img[data-alien]')].filter(i => i.offsetParent);
function alienShow(k) { const s = alienSrc(k); for (const i of alienImgs()) i.src = s; }
function alienKick() { if (!A.alienT && alienImgs().length) A.alienT = setTimeout(alienTick, 2500 + Math.random() * 4000); }
function alienTick() {
  A.alienT = 0;
  if (!alienImgs().length) return;
  if (!A.alienHover) {
    const seqs = [[['glitch', 70], ['base', 60], ['glitch', 110]], [['neg', 55], ['glitch', 90]],
      [['glitch', 60], ['neg', 40], ['glitch', 80], ['base', 50], ['stare', 450]], [['stare', 900]]];
    const seq = seqs[Math.floor(Math.random() * seqs.length)];
    const play = i => { if (A.alienHover) return; if (i >= seq.length) { alienShow('base'); return; } alienShow(seq[i][0]); setTimeout(() => play(i + 1), seq[i][1]); };
    play(0);
  }
  alienKick();
}
document.addEventListener('pointerover', e => { if (e.target.matches && e.target.matches('img[data-alien]')) { A.alienHover = true; alienShow('stare'); } });
document.addEventListener('pointerout', e => { if (e.target.matches && e.target.matches('img[data-alien]')) { A.alienHover = false; alienShow('base'); } });
const botCanned = ev => { const C = A.alienMode && D.ALIEN_CANNED ? D.ALIEN_CANNED : D.BOT_CANNED, l = C[ev] || C.move;   // 1.27.6
  return pick(...l[Math.floor(Math.random() * l.length)]); };
function botLive() { const b = A.bot; return !!(b && !b.over && A.res === b.res); }
const creditLink = () => `<button class="credit" data-credits="1">ⓘ ${esc(pick('Ліцензія фото', 'Photo license'))}</button>`;

function botResultText() {
  const b = A.bot, name = botName(b.spec);
  let text;
  if (b.result === '1/2-1/2') {
    const why = { stalemate: pick('пат', 'stalemate'), material: pick('недостатньо матеріалу', 'insufficient material'),
      repetition: pick('триразове повторення позиції', 'threefold repetition'), fifty: pick('правило 50 ходів', 'the 50-move rule') }[b.reason] || '';
    text = pick('Нічия', 'Draw') + (why ? ` (${why})` : '') + '.';
  } else if (b.reason === 'resign') text = pick(`Ви здалися. Переміг бот «${name}».`, `You resigned. The ${name} bot wins.`);
  else if ((b.result === '1-0') === (b.color === 'b')) text = pick(`Мат! Ви перемогли бота «${name}». 🏆`, `Checkmate! You beat the ${name} bot. 🏆`);
  else text = pick(`Мат. Переміг бот «${name}».`, `Checkmate. The ${name} bot wins.`);
  if (b.stars) text += '\n' + pick('Зірки: ', 'Stars: ') + starsText(b.stars) + (b.record ? pick('  — новий рекорд!', '  — a new record!') : '');
  if (b.quote) text += `\n💬 ${name}: ${b.quote}`;
  return text + '\n' + pick('Тепер можна гортати ходи: видно оцінку кожного ходу, підказки й тренера.',
    "You can now browse the moves: every move's grade, hints and the coach are shown.");
}

function botRules(spec, real) {
  return pick(`★  перемога на будь-якій силі\n★★  перемога на силі шахіста (${spec.elo})\n★★★  те саме — і жодного разу не повернути хід і не взяти підказку`,
    `★  win at any strength\n★★  win at the player's strength (${spec.elo})\n★★★  the same — without a single takeback and without the hint`)
    + (real ? '' : pick('\n\nНа цій силі можна заробити лише ★.', '\n\nAt this strength you can earn only ★.'));
}

function botsRenderBody() {
  if (A.boxKind !== 'bots') return;
  const [id, colorI, levelI] = cfg.bot, spec = botById(id), b = A.bot, stars = cfg.botStars || {};
  const opt = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  const done = b && b.over && A.res === b.res;
  // 1.26.0: галерея карток за групами (сучасні зірки, легенди, стрімери) + панель вибраного шахіста
  const alien = () => '';            // 1.26.8: у меню - звичайне фото (страшне лише в «режимі прибульця»)
  const card = x => `<div class="bc${x.id === spec.id ? ' cur' : ''}" data-id="${x.id}"><img src="${botPhoto(x.id)}" alt=""${alien(x)}>`
    + `<b>${esc(botName(x))}</b><small>${x.elo}</small><span class="st">${starsText(stars[x.id] || 0)}</span></div>`;
  const groups = [['modern', pick('СУЧАСНІ ЗІРКИ', "TODAY'S STARS")], ['legend', pick('ЛЕГЕНДИ', 'LEGENDS')], ['streamer', pick('СТРІМЕРИ', 'STREAMERS')]];
  const cat = { modern: pick('сучасна зірка', "today's star"), legend: pick('легенда', 'legend'), streamer: pick('стрімер', 'streamer') }[spec.cat] || '';
  $('boxBody').innerHTML = (done ? `<div class="botres" style="white-space:pre-line">${esc(botResultText())}</div>` : '')
    + `<div class="botgal" id="btList">${groups.map(([c, t]) => `<div class="gh">${esc(t)}</div><div class="gg">`
      + D.BOTS.filter(x => x.cat === c).map(card).join('') + '</div>').join('')}</div>`
    + `<div class="botsel"><div class="bothead"><img src="${botPhoto(spec.id)}" alt=""${alien(spec)}><div><b>${esc(botName(spec))}</b><br>`
    + `<small>${esc(spec.years)} · ${esc(pick('рейтинг', 'rating'))} ${spec.elo} · ${esc(cat)}</small>`
    + `<div class="st">${starsText(stars[spec.id] || 0)} <small style="color:var(--muted);letter-spacing:0">${esc(pick('ваш рекорд', 'your record'))}</small></div></div></div>`
    + `<div class="botdesc">${esc(pick(spec.d_uk, spec.d_en))}</div>`
    + `<div class="botfact">💡 ${esc(pick(spec.fact_uk, spec.fact_en))}</div>`
    + `<div class="botopen">♟ ${esc(pick(spec.open_uk, spec.open_en))}</div>`
    + `<label class="f">${esc(pick('Ваш колір', 'Your colour'))}</label><div class="seg" id="btColor">`
    + [pick('♔ Білими', '♔ White'), pick('♚ Чорними', '♚ Black'), pick('🎲 Навмання', '🎲 Random')]
      .map((l, i) => `<button data-c="${i}"${i === colorI ? ' class="on"' : ''}>${esc(l)}</button>`).join('') + '</div>'
    + `<label class="f">${esc(pick('Сила гри', 'Strength'))}</label><select id="btLevel">`
    + [pick(`Як у шахіста (${spec.elo})`, `Like the player (${spec.elo})`), ...D.BOT_LEVELS].map((l, i) => opt(i, String(l), levelI)).join('') + '</select>'
    + `<div class="botrules" id="btRules">${esc(botRules(spec, levelI === 0))}</div>`
    + `<button id="btPlay" class="primary big">${esc(pick('⚔ Почати гру', '⚔ Start game'))}</button>`
    + `<div class="hint">${esc(pick('Бот грає дебюти цього шахіста й наслідує його стиль, а силу гри дає Stockfish; репліки пише ШІ. Це імітація, '
      + 'із самими гравцями вона не пов\'язана. Під час партії аналізу немає; після неї видно оцінку кожного ходу.',
    'The bot plays this player\'s openings and imitates the style, while the strength comes from Stockfish; the lines are written by AI. '
      + 'It is an imitation and is not affiliated with the players. No analysis during the game; afterwards you see the grade of every move.'))}</div>`
    + creditLink() + '</div>';
  $('btList').addEventListener('click', e => {
    const it = e.target.closest('[data-id]');
    if (!it) return;
    const top = $('btList').scrollTop;
    cfg.bot[0] = it.dataset.id; saveCfg(); botsRenderBody();
    $('btList').scrollTop = top;
  });
  $('btColor').addEventListener('click', e => {
    const bt = e.target.closest('[data-c]');
    if (!bt) return;
    cfg.bot[1] = +bt.dataset.c; saveCfg();
    for (const x of $('btColor').children) x.classList.toggle('on', x === bt);
  });
  $('btLevel').addEventListener('change', e => { cfg.bot[2] = +e.target.value; saveCfg(); $('btRules').textContent = botRules(spec, cfg.bot[2] === 0); });
  $('btPlay').addEventListener('click', botPlay);
  const cur = $('btList').querySelector('.cur');
  if (cur && !done) cur.scrollIntoView({ block: 'nearest' });
  alienKick();
  const box = $('box');
  if (box.offsetTop + box.offsetHeight > window.innerHeight - 8)
    box.style.top = Math.max(12, window.innerHeight - box.offsetHeight - 12) + 'px';
}

function creditsRenderBody() {
  $('boxBody').innerHTML = `<div class="hint">${esc(pick('Фото шахістів — з Вікісховища (Wikimedia Commons), вільні ліцензії. Зображення обрізано й зменшено. '
    + 'Ліцензії CC BY-SA дозволяють поширювати їх з указанням автора й ліцензії.',
  'Player photos are from Wikimedia Commons under free licenses. The images were cropped and resized. '
    + 'CC BY-SA licenses allow sharing with credit to the author and the license.'))}</div><div class="credits">`
    + D.BOTS.filter(b => D.BOT_PHOTO_CREDITS[b.id]).map(b => { const [author, lic, url] = D.BOT_PHOTO_CREDITS[b.id];   // Witty Alien - значок, не фото
      return `<div><b>${esc(botName(b))}</b> — ${esc(author)}, ${esc(lic)}<br><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></div>`; }).join('')
    + `<div class="hint">${esc(pick(...D.BOT_PHOTO_NOTE))}</div></div>`;
}

/** Екран гри або аналізатора - за тим, чи йде партія з ботом. */
function botUiSync() {
  alienCheck();
  const live = botLive();
  if (live) renderBotCard();
  if (live === !!A.botUi) return;
  A.botUi = live;
  $('botCard').hidden = !live;
  $('botBar').hidden = !live;
  for (const el of [document.querySelector('.graphCard'), $('summaryCard'), $('info')]) el.hidden = live;
  $('bRun').disabled = live;
  board.premoveColor = live ? (A.bot.color === 'w' ? 'b' : 'w') : null;   // 1.25.3: хід наперед
  if (!live) board.premoves = [];
  renderVar(); renderMoves(); layout();
}

function renderBotCard() {
  const b = A.bot, spec = b.spec, real = b.elo === spec.elo, ok = '✓', no = '✗';
  const side = b.color === 'w' ? pick('білими', 'White') : pick('чорними', 'Black');
  const al = spec.id === ALIEN && A.alienMode;
  $('botCard').innerHTML = `<img src="${al ? alienSrc(A.alienHover ? 'stare' : 'base') : botPhoto(spec.id)}" alt=""${al ? ' data-alien="1"' : ''}><div class="bi">`
    + `<div class="bn"><span>${esc(botName(spec))}</span>${creditLink()}</div>`
    + `<div class="bm">${esc(spec.years)} · ${esc(pick('грає', 'plays'))} ${esc(side)} · ${esc(pick('сила', 'strength'))} ${b.elo}</div>`
    + `<div class="st">${starsText((cfg.botStars || {})[spec.id] || 0)} <small style="color:var(--muted)">${esc(pick('ваш рекорд', 'your record'))}</small></div>`
    + `<div class="goal">${esc(pick('Для ★★★: ', 'For ★★★: '))}${esc(pick('сила', 'strength'))} ${spec.elo} ${real ? ok : no} · `
    + `${esc(pick('без повернень', 'no takebacks'))} ${b.undos ? no : ok} · ${esc(pick('без підказки', 'no hint'))} ${b.hints ? no : ok}</div></div>`;
  $('bbUndo').textContent = pick('↶ Повернути хід', '↶ Take back');
  $('bbHint').textContent = pick('💡 Підказка', '💡 Hint') + (b.hints ? ' (0)' : ' (1)');
  $('bbHint').disabled = !!b.hints || !!b.hintWait;
  $('bbResign').textContent = pick('🏳 Здатися', '🏳 Resign');
  if (al) alienKick();
}

function botPlay() {
  const spec = botById(cfg.bot[0]);
  const userWhite = [true, false, Math.random() < 0.5][cfg.bot[1]] ?? true;
  const elo = cfg.bot[2] >= 1 && D.BOT_LEVELS[cfg.bot[2] - 1] ? D.BOT_LEVELS[cfg.bot[2] - 1] : spec.elo;
  closeBox();
  startFree();
  tele('bot.games'); tele('bot.g.' + spec.id);
  if (board.flipped === userWhite) flipBoard();           // гравець завжди внизу дошки
  A.bot = { spec, color: userWhite ? 'b' : 'w', elo, over: false, thinking: false, token: 0, res: A.res, result: '*', reason: '',
    undos: 0, hints: 0, hint: null, hintWait: false, chat: [], saidAt: 0, botMoves: 0, stars: 0, record: false, quote: '' };
  const s = A.res.summary;
  [s.white, s.black] = userWhite ? ['You', spec.en + ' (bot)'] : [spec.en + ' (bot)', 'You'];
  if (userWhite) setNames('Ви', '', spec.uk, String(elo)); else setNames(spec.uk, String(elo), 'Ви', '');
  botUiSync();
  botSay('start');
  refreshView();                                            // якщо бот білими - він ходить першим
  setStatus(() => pick(`Партія з ботом «${botName(spec)}» (${elo}).`, `Game against the ${botName(spec)} bot (${elo}).`));
}

function botCoach() {
  const b = A.bot, items = b.chat, lines = [];
  // 1.25.2: лише остання репліка; 1.27.11 - або остання розмова з гравцем і що бот сказав після неї
  let me = -1;
  items.forEach((x, i) => { if (typeof x === 'object') me = i; });
  for (const x of (me >= 0 && items.length - me <= 3 ? items.slice(me) : items.slice(-1))) {
    if (typeof x === 'object') lines.push('🗨 ' + pick('Ви', 'You') + ': ' + x.me, x.a || pick('Пише…', 'Typing…'));
    else lines.push(x);
  }
  if (b.thinking) lines.push('⏳ ' + pick('Думає над ходом…', 'Thinking about the move…'));
  else if (!lines.length) lines.push(pick('Ваш хід.', 'Your move.'));
  return [`💬 ${botName(b.spec)}`, lines];
}

/** Репліка бота: ШІ (у характері шахіста, без підказок) або запасна фраза. */
async function botSay(event, ucis = null) {
  const b = A.bot;
  if (!b) return;
  let text = null;
  if (!['undo', 'hint'].includes(event) && cfg.ai && !A.aiOff) {
    try {
      const facts = botChatFacts(event, A.res.fens[0], ucis || botMoves(), b.color, b.result);
      text = await fetchAiCoach(facts, uiLang(), null, null, { name: botName(b.spec), style: pick(b.spec.d_uk, b.spec.d_en), ...(A.alienMode ? { mood: 'alien' } : {}) });
    } catch (_) { text = null; }
  }
  if (A.bot !== b) return;
  text = text || botCanned(event);
  b.chat.push(text);
  if (event === 'end') { b.quote = text; if (A.boxKind === 'bots') botsRenderBody(); if (A.boxKind === 'botend') botendRenderBody(); }
  else if (botLive()) showCoach(A.coachLines);
}

/** 1.27.11: повідомлення гравця ботові - відповідь ШІ в характері шахіста, без підказок. */
async function botChatSend(q) {
  const b = A.bot;
  tele('bot.chat');
  $('askIn').value = '';
  const history = b.chat.filter(x => typeof x === 'object' && x.a).map(x => ({ q: x.me, a: x.a })).slice(-3);
  const item = { me: q, a: null };
  b.chat.push(item);
  showCoach(A.coachLines);
  let text = null;
  if (cfg.ai && !A.aiOff) {
    try {
      const facts = botChatFacts('chat', A.res.fens[0], botMoves(), b.color, b.result);
      text = await fetchAiCoach(facts, uiLang(), null, null, { name: botName(b.spec), style: pick(b.spec.d_uk, b.spec.d_en),
        message: q, history, ...(A.alienMode ? { mood: 'alien' } : {}) });
    } catch (_) { text = null; }
  }
  item.a = text || botCanned('chat');
  if (A.bot === b && botLive()) showCoach(A.coachLines);
}

/** Ходи від початку партії до кінця поточної лінії. */
function botMoves() {
  const res = A.res, v = A.v;
  return [...res.moves.slice(0, v ? v.base : A.index).map(m => m.uci), ...(v ? v.rows.map(r => r.uci) : [])];
}

function botTick() { botUiSync(); if (A.bot) botKick(); }

/** На дошці кінець лінії: партія закінчилась - підсумок; хід бота - бот думає. */
function botKick() {
  const b = A.bot;
  if (!botLive() || b.thinking) return;
  const v = A.v;
  if (v && v.index !== v.rows.length) return;               // гравець переглядає попередні ходи
  const ucis = botMoves(), st = botState(A.res.fens[0], ucis);
  if (!st) return;
  if (st.over) botFinish(st.over[0], st.over[1]);
  else if (st.turn === b.color) botThink(ucis, st.fen);
}

async function botThink(ucis, fen) {
  const b = A.bot, token = ++b.token, t0 = performance.now();
  b.thinking = true;
  showCoach(A.coachLines);                                  // «Думає над ходом…»
  let uci = null, err = null;
  try {
    uci = botBookMove(b.spec, ucis, b.color === 'w');
    if (!uci) {
      await ensureEngine();
      const r = await engine.botMove(A.res.fens[0], ucis, b.elo, 800);
      uci = botChoose(new Pos(fen), r.best, r.cands, b.spec);
      if (b.elo < 1320 && r.cands.length > 1 && Math.random() < (1320 - b.elo) / 1320 * 0.8) uci = r.cands[r.cands.length - 1].uci;
    }
  } catch (e) { err = (e && e.message) || String(e); }
  const wait = 700 - (performance.now() - t0);              // миттєва відповідь виглядає неприродно
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  if (A.bot !== b || token !== b.token) return;             // хід скасовано (нова партія, «Повернути хід»)
  b.thinking = false;
  if (!botLive()) return;
  if (err || !uci) { showCoach(A.coachLines); msg(pick('Бот не зміг зробити хід: ', 'The bot could not move: ') + (err || '?')); return; }
  const v = A.v;
  if (v && v.index !== v.rows.length) gotoVar(v.rows.length, false);
  if (botMoves().join(' ') !== ucis.join(' ')) { showCoach(A.coachLines); setTimeout(botKick, 30); return; }   // інша лінія
  A.botInject = true;
  // 1.25.10: є ходи наперед або фігура в руці - хід бота без анімації (як на chess.com)
  const quick = board.premoves.length > 0 || !!board.drag;
  // 1.26.9 (користувач): Witty Alien жертвує коня на f7 (чорними - на f2) - «лютий глюк»
  const pc = new Pos(fen).pieceAt(uci.slice(0, 2));
  const rage = b.spec.id === ALIEN && pc && pc.type === 'n' && uci.slice(2, 4) === (b.color === 'w' ? 'f7' : 'f2');
  A.fakeBril = rage;
  try { await onUserMove(uci, quick); } finally { A.botInject = false; A.fakeBril = false; }
  if (rage) setTimeout(alienRage, quick ? 30 : 220);
  if (A.alienMode) alienSfx();                 // 1.27.6: глибокий «голос прибульця» - на кожен хід Witty Alien
  if (board.premoves.length) setTimeout(botPremove, 15);           // хід наперед - одразу після ходу бота
  b.botMoves++;
  const all = botMoves(), st = botState(A.res.fens[0], all);
  if (st && !st.over) {
    const c = new Chess(A.res.fens[0]);
    for (const u of all) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    const sharp = c.history({ verbose: true }).slice(-2).some(m => m.captured || /[+#]/.test(m.san));
    const gap = b.botMoves - b.saidAt;
    if ((sharp && gap >= 2) || gap >= 4) { b.saidAt = b.botMoves; botSay('move', all); }
  }
}

/** «Підказка»: один раз за партію - стрілка найкращого ходу (Stockfish на повну силу). */
async function botHint() {
  const b = A.bot;
  if (!botLive() || b.hints || b.thinking || b.hintWait) return;
  tele('bot.hint');
  const ucis = botMoves(), st = botState(A.res.fens[0], ucis);
  if (!st || st.over || st.turn === b.color) return;
  b.hintWait = true; renderBotCard();
  try {
    await ensureEngine();
    const r = await engine.analyse(A.res.fens[0], ucis, Math.max(12, cfg.depth), 1);
    const uci = r[0] && r[0].pv && r[0].pv[0];
    if (uci && A.bot === b && botLive()) { b.hint = [st.fen, uci]; b.hints++; botSay('hint'); refreshView(); }
  } catch (e) { msg(pick('Підказка не вийшла: ', 'The hint failed: ') + ((e && e.message) || e)); }
  b.hintWait = false;
  if (botLive()) renderBotCard();
}

function botHintArrow() {
  const b = A.bot;
  if (!b || !b.hint) return null;
  const cur = A.v ? A.v.fens[A.v.index] : A.res.fens[A.index];
  return b.hint[0] === cur ? b.hint[1] : null;
}

function botFinish(result, reason) {
  const b = A.bot;
  Object.assign(b, { over: true, thinking: false, result, reason });
  board.premoves = [];
  b.token++;
  const won = reason !== 'resign' && result !== '1/2-1/2' && ((result === '1-0') === (b.color === 'b'));
  b.stars = botStarsFor(won, b.elo === b.spec.elo, b.undos, b.hints);
  tele(won ? 'bot.win' : result === '1/2-1/2' && reason !== 'resign' ? 'bot.draw' : 'bot.loss'); tele('bot.stars', b.stars);
  cfg.botStars = cfg.botStars || {};
  if (b.stars > (cfg.botStars[b.spec.id] || 0)) { cfg.botStars[b.spec.id] = b.stars; b.record = true; saveCfg(); }
  A.res.summary.result = result;
  botUiSync();
  refreshView();
  setStatus(() => botResultText().split('\n')[0]);
  docChanged();
  botSay('end', botMoves());
  openBox('botend');
}

// 1.26.1: квадрат «Кінець партії» - результат, зірки, слово бота, підсумок, аналіз / реванш / інший бот
function botendStats() {
  const b = A.bot, rows = A.v ? A.v.rows : [];
  const mine = rows.filter(r => (r.label || '').endsWith('.') === (b.color === 'b'));
  const pending = mine.some(r => r.pending), done = mine.filter(r => !r.pending && r.quality);
  const parts = [pick('Ходів: ', 'Moves: ') + Math.ceil(rows.length / 2)];
  if (done.length) {
    parts.push(pick('ваша точність ', 'your accuracy ') + gameAccuracy(done.map(r => r.acc)).toFixed(1) + '%');
    for (const q of ['Геніальний', 'Чудовий', 'Найкращий', 'Помилка', 'Груба помилка']) {
      const k = done.filter(r => r.quality === q).length;
      if (k) parts.push(`${qname(q).toLowerCase()}: ${k}`);
    }
  }
  if (pending) parts.push(pick('ще оцінюю ходи…', 'still grading moves…'));
  const lines = [];
  const best = ['Геніальний', 'Чудовий'].map(q => done.find(r => r.quality === q)).find(Boolean);
  if (best) lines.push('⭐ ' + pick('Ваш найкращий хід: ', 'Your best move: ') + `${best.label}${best.san} (${qname(best.quality)})`);
  const worst = done.reduce((w, r) => (!w || (r.drop || 0) > (w.drop || 0) ? r : w), null);
  if (worst && (worst.drop || 0) >= 10) lines.push('⚠ ' + pick('Найдорожча помилка: ', 'Costliest mistake: ') + `${worst.label}${worst.san} (${qname(worst.quality)})`);
  return { stats: parts.join(' · '), lines, pending };
}

function botendRenderBody() {
  if (A.boxKind !== 'botend' || !A.bot || !A.bot.over) return;
  const b = A.bot, spec = b.spec, name = botName(spec);
  const won = b.reason !== 'resign' && b.result !== '1/2-1/2' && ((b.result === '1-0') === (b.color === 'b'));
  const draw = b.result === '1/2-1/2';
  const title = won ? pick('Перемога! 🏆', 'Victory! 🏆') : draw ? pick('Нічия', 'Draw') : pick('Поразка', 'Defeat');
  const st = botendStats(), rec = (cfg.botStars || {})[spec.id] || 0;
  const al = spec.id === ALIEN && A.alienMode;
  const photo = al && !won && !draw ? alienSrc('stare') : (al ? alienSrc('base') : botPhoto(spec.id));
  $('boxBody').innerHTML = `<div class="behead"><img src="${photo}" alt=""${al ? ' data-alien="1"' : ''}><div>`
    + `<div class="bet ${won ? 'win' : draw ? 'draw' : 'lose'}">${esc(title)}</div>`
    + `<small>${esc(botResultText().split('\n')[0])}<br>${esc(pick('Суперник: ', 'Opponent: '))}${esc(name)} (${b.elo})</small>`
    + `<div class="bes">${starsText(b.stars)}</div><small class="rec">${esc(b.record ? pick('Новий рекорд!', 'A new record!') : pick('Ваш рекорд: ', 'Your record: ') + starsText(rec))}</small></div></div>`
    + `<div class="bequote"><small>💬 ${esc(name.toUpperCase())}</small><div>${esc(b.quote || pick('Пише…', 'Typing…'))}</div></div>`
    + `<div class="bestats">${esc(st.stats)}</div>` + st.lines.map(l => `<div class="bemove">${esc(l)}</div>`).join('')
    + `<button id="beAnalyze" class="primary big">${esc(pick('📊 Аналізувати партію', '📊 Analyze the game'))}</button>`
    + `<div class="row berow"><button id="beRematch">${esc(pick('🔁 Реванш', '🔁 Rematch'))}</button>`
    + `<button id="beChange">${esc(pick('🤖 Інший бот', '🤖 Another bot'))}</button></div>`;
  $('beAnalyze').addEventListener('click', botendAnalyze);
  $('beRematch').addEventListener('click', botendRematch);
  $('beChange').addEventListener('click', () => { cfg.bot[0] = spec.id; saveCfg(); openBox('bots'); });
  if (st.pending || !b.quote) setTimeout(botendRenderBody, 700);
}

/** Повний аналіз щойно зіграної партії - як звичайної (графік, точність, оцінки). */
function botendAnalyze() {
  const b = A.bot, userWhite = b.color === 'b', me = pick('Ви', 'You'), bot = botName(b.spec);
  const p = new Pos(START_FEN), sans = [];
  for (const u of botMoves()) { sans.push(p.san(u)); p.push(u); }
  const [w, bl] = userWhite ? [me, bot] : [bot, me];
  const text = `[Event "${pick('Партія з ботом', 'Game against a bot')}"]\n[White "${w}"]\n[Black "${bl}"]\n`
    + `[${userWhite ? 'BlackElo' : 'WhiteElo'} "${b.elo}"]\n[Result "${b.result}"]\n\n`
    + sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ') + ' ' + b.result;
  closeBox();
  if (loadPgn(text) && board.flipped !== !userWhite) flipBoard();   // свої фігури - знизу
}

/** Реванш: той самий шахіст і сила, кольори міняються. */
function botendRematch() {
  const b = A.bot, li = b.elo === b.spec.elo ? 0 : D.BOT_LEVELS.indexOf(b.elo) + 1;
  cfg.bot = [b.spec.id, b.color === 'b' ? 1 : 0, li > 0 ? li : 0];
  saveCfg();
  closeBox();
  botPlay();
}

/** Зіграти перший хід наперед з черги, якщо після ходу бота він можливий; інакше скасувати всю чергу. */
function botPremove() {
  if (!board.premoves.length) return;
  const uci = board.premoves.shift();
  const st = botLive() ? botState(A.res.fens[0], botMoves()) : null;
  if (st && !st.over && st.turn !== A.bot.color && new Pos(st.fen).isLegal(uci)) onUserMove(uci, true);   // без анімації; решта - після ходу бота
  else { board.premoves = []; board.render(); }
}

function botResign() { const b = A.bot; if (botLive()) botFinish(b.color === 'b' ? '0-1' : '1-0', 'resign'); }

/** «Повернути хід» у партії з ботом: назад до свого ходу (хід бота і свій перед ним). */
function botUndo() {
  const b = A.bot;
  tele('bot.undo');
  b.token++; b.thinking = false;
  if (!A.v || !A.v.rows.length) return;
  b.undos++;
  board.premoves = [];
  undoVar(true);
  const v = A.v;
  if (v && v.rows.length && v.fens[v.fens.length - 1].split(' ')[1] === b.color) undoVar(true);
  botSay('undo');
  renderBotCard();
  setTimeout(botKick, 60);
}

function ccRenderBody() {
  if (A.boxKind !== 'chesscom') return;
  const body = $('boxBody');
  const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
  const names = Object.fromEntries(CC_CLASSES.map(([k, uk, en]) => [k, pick(uk, en)]));
  const res = { win: pick('Перемога', 'Win'), loss: pick('Поразка', 'Loss'), draw: pick('Нічия', 'Draw') };
  const z = x => String(x).padStart(2, '0');
  const view = ccView();
  const fam = CC_FAMOUS.map(n => `<button class="chip" data-ccfam="${n}">${n}</button>`).join('');
  const typeOpts = [['all', pick('Усі', 'All')], ...CC_CLASSES.map(([k, uk, en]) => [k, pick(uk, en)])];
  body.innerHTML = `<label class="f">${esc(pick('Нік на chess.com', 'chess.com username'))}</label>`
    + `<div class="row ccrow"><input type="text" id="ccUser" maxlength="30" autocapitalize="off" autocomplete="off" spellcheck="false" value="${esc(CC.who || CC.user)}">`
    + `<button id="ccFind" class="primary">${esc(pick('🔍 Знайти', '🔍 Find'))}</button></div>`
    + `<div class="hint">${esc(pick('Гросмейстери:', 'Grandmasters:'))}</div><div class="famrow">${fam}</div>`
    + (CC.months.length ? `<div class="row ccrow"><select id="ccMonth">${CC.months.map(([y, m], i) => opt(i, `${pick(...CC_MONTHS[m - 1])} ${y}`, CC.month)).join('')}</select>`
      + `<select id="ccType">${typeOpts.map(([k, l]) => opt(k, l, CC.type)).join('')}</select></div>` : '')
    + `<div class="hint" id="ccStatus"></div>`
    + (view.length ? `<div class="list cclist" id="ccList">${view.map((r, i) => {
      const d = new Date(r.end * 1000);
      const when = r.end ? `${z(d.getDate())}.${z(d.getMonth() + 1)} ${z(d.getHours())}:${z(d.getMinutes())}` : '';
      const tc = [names[r.cls] || r.cls, ccTime(r.tc)].filter(Boolean).join(' · ');
      return `<div class="it cc-${r.result}" data-i="${i}"><span class="ccres">${esc(res[r.result])}</span> ${r.white ? '●' : '○'} ${esc(r.opp)}${r.oppRating ? ` (${r.oppRating})` : ''}`
        + `<small>${esc(when)} · ${esc(tc)}${r.opening ? ' · ' + esc(r.opening) : ''}</small></div>`;
    }).join('')}</div>` : '');
  ccSetStatus(CC.status || (() => pick('Введіть свій нік на chess.com і натисніть «Знайти».', 'Enter your chess.com username and press «Find».')));
  $('ccFind').addEventListener('click', () => ccSearch());
  body.querySelectorAll('[data-ccfam]').forEach(b => b.addEventListener('click', () => ccSearch(b.dataset.ccfam)));
  $('ccUser').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ccSearch(); } });
  if ($('ccMonth')) $('ccMonth').addEventListener('change', e => { CC.month = +e.target.value; ccLoadMonth(); });
  if ($('ccType')) $('ccType').addEventListener('change', e => { CC.type = e.target.value; CC.status = ccCount(); ccRenderBody(); });
  if ($('ccList')) $('ccList').addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) ccAnalyze(view[+it.dataset.i]); });
  const box = $('box');                                    // квадрат виріс - не вилазити за низ екрана
  if (box.offsetTop + box.offsetHeight > window.innerHeight - 8)
    box.style.top = Math.max(12, window.innerHeight - box.offsetHeight - 12) + 'px';
}

async function ccSearch(famous = null) {
  const user = (famous || ($('ccUser') ? $('ccUser').value : CC.user)).trim();
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(user)) { ccSetStatus(() => pick('Введіть свій нік на chess.com (латиницею).', 'Enter your chess.com username.')); return; }
  CC.who = user;                           // 1.29.0: гросмейстер - не перезаписує свій нік
  if (!famous && user !== CC.user) { CC.user = user; store.set('ca.ccUser', user); }
  const seq = ++CC.seq;
  CC.months = []; CC.rows = []; CC.cache = {}; CC.month = 0;
  CC.status = () => pick('Шукаю партії на chess.com…', 'Looking for games on chess.com…');
  ccRenderBody();
  try {
    const data = await ccGet(CC_API + user.toLowerCase() + '/games/archives');
    if (seq !== CC.seq) return;
    CC.months = (data.archives || []).map(u => /\/(\d{4})\/(\d{2})$/.exec(u)).filter(Boolean)
      .map(m => [+m[1], +m[2], m.input]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    if (!CC.months.length) { CC.status = () => pick(`У гравця «${user}» ще немає партій.`, `Player «${user}» has no games yet.`); ccRenderBody(); return; }
    ccLoadMonth();
  } catch (e) {
    if (seq !== CC.seq) return;
    CC.status = ccErr(e, user); ccRenderBody();
  }
}
async function ccLoadMonth() {
  const mo = CC.months[CC.month];
  if (!mo) return;
  const url = mo[2], user = CC.who || CC.user;
  if (CC.cache[url]) { CC.rows = CC.cache[url]; CC.status = ccCount(); ccRenderBody(); return; }
  const seq = ++CC.seq;
  CC.rows = []; CC.status = () => pick('Завантажую партії…', 'Loading games…');
  ccRenderBody();
  try {
    const rows = ccGames(await ccGet(url), user);
    if (seq !== CC.seq) return;
    CC.cache[url] = CC.rows = rows;
    CC.status = ccCount(); ccRenderBody();
  } catch (e) {
    if (seq !== CC.seq) return;
    CC.status = ccErr(e, user); ccRenderBody();
  }
}
function ccAnalyze(r) {
  if (!r) return;
  closeBox();
  if (loadPgn(r.pgn) && board.flipped !== !r.white) flipBoard();   // свої фігури - знизу
}
// ------------------------------------------------------------ 1.29.0: база партій майстрів ---
const CC_FAMOUS = ["Hikaru", "MagnusCarlsen", "DanielNaroditsky", "FabianoCaruana", "GukeshDommaraju", "Firouzja2003", "AnishGiri", "LyonBeast", "RpragChess", "GothamChess"];
const MASTERS_URL = 'https://explorer.lichess.ovh/masters';
const MS = { fen: null, cache: {}, seq: 0, data: null, err: null };
function dbTick() {
  if (A.boxKind !== 'db') return;
  if (board.fen !== MS.fen) { MS.fen = board.fen; dbLoad(MS.fen); }
  setTimeout(dbTick, 500);
}
async function dbLoad(fen) {
  if (MS.cache[fen]) { MS.data = MS.cache[fen]; MS.err = null; dbRender(); return; }
  const seq = ++MS.seq;
  MS.data = null; MS.err = 'loading'; dbRender();
  try {
    const r = await fetch(`${MASTERS_URL}?${new URLSearchParams({ fen, moves: 12, topGames: 10 })}`);
    if (!r.ok) throw new Error(r.status === 429 ? 'rate' : 'err');
    const d = await r.json();
    MS.cache[fen] = d;
    if (seq === MS.seq) { MS.data = d; MS.err = null; dbRender(); }
  } catch (e) { if (seq === MS.seq) { MS.err = e.message === 'rate' ? 'rate' : 'net'; dbRender(); } }
}
function dbRender() {
  if (A.boxKind !== 'db') return;
  const d = MS.data, pc = (x, t) => (t ? Math.round(100 * x / t) + '%' : '–');
  let html;
  if (!d) html = `<div class="hint">${esc(MS.err === 'loading' ? pick('Завантажую…', 'Loading…') : MS.err === 'rate' ? pick('База просить зачекати хвилинку.', 'The database asks to wait a minute.') : pick("Немає з'єднання з базою.", "Can't reach the database."))}</div>`;
  else {
    const tot = (d.white || 0) + (d.draws || 0) + (d.black || 0), op = d.opening;
    html = `<div style="font-weight:700">${esc((op ? `${op.eco} ${op.name} · ` : '') + pick(`Партій: ${tot.toLocaleString('uk')}`, `Games: ${tot.toLocaleString('en')}`))}</div>`
      + `<div class="hint">${esc(pick(`Білі ${pc(d.white, tot)} · нічия ${pc(d.draws, tot)} · чорні ${pc(d.black, tot)}. Партії гравців FIDE 2200+ (lichess Masters). Торкніться ходу, щоб зіграти.`,
        `White ${pc(d.white, tot)} · draw ${pc(d.draws, tot)} · Black ${pc(d.black, tot)}. Games of FIDE 2200+ players (lichess Masters). Tap a move to play it.`))}</div>`
      + `<table class="dbt"><tr><th>${esc(pick('Хід', 'Move'))}</th><th>${esc(pick('Партій', 'Games'))}</th><th>${esc(pick('Б / Н / Ч', 'W / D / B'))}</th><th>Ø</th></tr>`
      + (d.moves || []).map(m => { const n = m.white + m.draws + m.black; return `<tr data-dbmove="${m.uci}"><td><b>${esc(m.san)}</b></td><td>${n.toLocaleString('uk')}</td><td>${pc(m.white, n)} / ${pc(m.draws, n)} / ${pc(m.black, n)}</td><td>${m.averageRating || ''}</td></tr>`; }).join('')
      + `</table>`
      + ((d.topGames || []).length ? `<label class="f">${esc(pick('Відомі партії (торкніться, щоб відкрити)', 'Famous games (tap to open)'))}</label><div class="list">`
        + d.topGames.map(g => `<div class="it" data-dbgame="${g.id}">${esc(`${g.white.name} (${g.white.rating}) – ${g.black.name} (${g.black.rating})`)}<small>${g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '½-½'} · ${g.year}</small></div>`).join('') + '</div>' : '')
      + (!tot ? `<div class="hint">${esc(pick('У базі майстрів такої позиції немає.', 'This position is not in the masters database.'))}</div>` : '');
  }
  $('boxBody').innerHTML = html + `<div class="row"><button id="dbClose">${esc(pick('Закрити', 'Close'))}</button></div>`;
  $('dbClose').addEventListener('click', closeBox);
  $('boxBody').querySelectorAll('[data-dbmove]').forEach(tr => tr.addEventListener('click', () => dbPlay(tr.dataset.dbmove)));
  $('boxBody').querySelectorAll('[data-dbgame]').forEach(it => it.addEventListener('click', () => dbOpen(it.dataset.dbgame)));
}
function dbPlay(uci) {
  if (!A.res) startFree();
  if (analysing()) { msg(pick('Зачекайте, поки закінчиться аналіз.', 'Wait until the analysis finishes.')); return; }
  if (!new Pos(board.fen).isLegal(uci)) return;
  onUserMove(uci, false);
}
async function dbOpen(id) {
  try {
    const r = await fetch(`${MASTERS_URL}/pgn/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error('err');
    const pgn = await r.text();
    closeBox();
    loadPgn(pgn);
  } catch (_) { msg(pick('Не вдалося завантажити партію.', 'Could not load the game.')); }
}

function openChesscom() {
  if (A.boxKind === 'chesscom') { closeBox(); return; }
  openBox('chesscom');
  tele('f.chesscom');
  if (!CC.months.length && CC.user && CC.seq === 0) ccSearch();
}

// ------------------------------------------------------------ статистика (з 1.23.0) ---
// stats.json у репозиторії: перегляди сторінки GitHub і канал Telegram; файл оновлює автор під час релізу.
const STATS_URL = 'https://raw.githubusercontent.com/volod4ik4-code/chess-analyzer/main/stats.json';
function statsText() {
  const s = A.stats, app = A.appStats ? appStatsText(A.appStats) + '\n' : '';
  if (s === undefined) return pick('Завантажую…', 'Loading…');
  if (s === null) return pick('Не вдалося отримати статистику. Перевірте інтернет.', 'Could not get the statistics. Check your internet connection.');
  const g = s.github || {}, tg = s.telegram || {}, V = [['перегляд', 'перегляди', 'переглядів'], ['view', 'views']];
  const nV = plural(g.views || 0, ...V), nP = plural(g.visitors || 0, ['відвідувач', 'відвідувачі', 'відвідувачів'], ['visitor', 'visitors']);
  const nS = plural(tg.subscribers || 0, ['підписник', 'підписники', 'підписників'], ['subscriber', 'subscribers']), nT = plural(tg.views || 0, ...V);
  return app + pick(`🐙 GitHub: ${nV} сторінки, ${nP}\n✈ Telegram (t.me/chessanalyser): ${nS}, ${nT} дописів\n(оновлено ${s.updated || ''})`,
    `🐙 GitHub: ${nV} of the page, ${nP}\n✈ Telegram (t.me/chessanalyser): ${nS}, ${nT} of posts\n(updated ${s.updated || ''})`);
}
async function loadStats() {
  const show = () => { const el = $('sStats'); if (el) el.textContent = statsText(); };
  show();
  if (A.statsBusy || (A.stats && Date.now() - (A.statsTime || 0) < 600000)) return;
  A.statsBusy = true;
  try {
    const r = await fetch(`${STATS_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    A.stats = await r.json(); A.statsTime = Date.now();
  } catch (_) { if (!A.stats) A.stats = null; }
  try {                                          // 1.27.12: загальна статистика програми
    const r = await fetch(`${D.AI_COACH_URL}/stats?t=${Math.floor(Date.now() / 300000)}`);
    if (r.ok) A.appStats = await r.json();
  } catch (_) { /* */ }
  A.statsBusy = false;
  show();
}

// ------------------------------------------------------------ квадрати (налаштування тощо) ---
function openBox(kind) {
  A.boxKind = kind;
  const body = $('boxBody');
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const chk = (id, label, on) => `<label class="check"><input type="checkbox" id="${id}"${on ? ' checked' : ''}>${esc(label)}</label>`;
  if (kind === 'settings') {
    $('boxTitle').textContent = tr('⚙  Налаштування');
    body.innerHTML = `<label class="f">${esc(tr('Мова'))}</label>${sel('sLang', [['uk', 'Українська'], ['en', 'English'], ['pt', 'Português'], ['es', 'Español']], cfg.lang)}`
      + `<label class="f">${esc(tr('Дошка'))}</label>${sel('sBoard', Object.keys(D.BOARD_THEMES).map(k => [k, k]), cfg.board)}`
      + `<label class="f">${esc(tr('Глибина'))}</label>${sel('sDepth', DEPTHS.map(d => [d, d]), cfg.depth)}`
      + `<label class="f">${esc(pick('Рушій', 'Engine'))}</label>${sel('sEngine', [
        ...(DEF.engine === 'native' ? [['native', pick('Stockfish 19 — швидкий (для Android)', 'Stockfish 19 — fast (for Android)')]] : []),
        ['lite', pick('Stockfish 19 lite — швидший, слабший', 'Stockfish 19 lite — faster, weaker')]], cfg.engine)}`
      + (A.engDl ? `<div class="hint">${esc(pick('Рушій «усі ядра» завантажується…', 'The "all cores" engine is downloading…'))}</div>` : '')
      + `<label class="f">${esc(tr('Стрілка'))}</label>${sel('sArrow', D.ARROW_MODES.map(m => [m, pick(...ARROW_LABELS[m])]), cfg.arrow)}`
      + chk('sAnim', tr('Анімація ходів'), cfg.anim) + chk('sCoach', tr('Тренер'), cfg.coach) + chk('sAi', tr('ШІ-тренер (потрібен інтернет)'), cfg.ai) + chk('sEval', tr('Шкала оцінки'), cfg.evalbar)
      + `<div class="row"><button id="sBench">${esc(pick('🔍 Перевірити швидкість рушія', '🔍 Test engine speed'))}</button></div>`
      + `<div class="row"><button id="sUpd">${esc(pick('⬆ Перевірити оновлення', '⬆ Check for updates'))}</button></div>`
      + `<div class="row"><button id="sBug">${esc(pick('🐞 Повідомити про помилку', '🐞 Report a bug'))}</button></div>`
      + `<label class="f">${esc(pick('Статистика', 'Statistics'))}</label>`
      + chk('sTele', pick('Надсилати анонімну статистику', 'Send anonymous statistics'), TELE.on === true)
      + `<div class="hint" id="sStats" style="white-space:pre-line"></div>`
      + `<label class="f">${esc(pick('Ми в мережі', 'Follow us'))}</label><div class="social">`   // 1.26.6: з верху сторінки сюди
      + `<button data-link="TIKTOK_URL">♪ TikTok</button><button data-link="TELEGRAM_URL">✈ Telegram</button>`
      + `<button data-link="GITHUB_URL">🐙 GitHub</button></div>`
      + `<div class="hint">${esc(pick('Версія', 'Version'))} ${esc(D.APP_VERSION)}</div>`
      + `<div class="row"><button id="sReset">${esc(tr('Скинути налаштування'))}</button><button id="sDone" class="primary">${esc(tr('Готово'))}</button></div>`;
    const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
    on('sLang', 'change', e => { cfg.lang = e.target.value; saveCfg(); applyLang(); });
    on('sBoard', 'change', e => { cfg.board = e.target.value; board.theme = cfg.board; board.render(); saveCfg(); });
    on('sDepth', 'change', e => { cfg.depth = +e.target.value; saveCfg(); });
    on('sEngine', 'change', e => { if (!A.engDl) pickEngine(e.target.value); else openBox('settings'); });
    on('sArrow', 'change', e => { cfg.arrow = e.target.value; saveCfg(); refreshView(); });
    on('sAnim', 'change', e => { cfg.anim = e.target.checked; saveCfg(); });
    on('sCoach', 'change', e => { cfg.coach = e.target.checked; saveCfg(); refreshView(); if (!A.res) showCoach(null); });
    on('sAi', 'change', e => { cfg.ai = e.target.checked; saveCfg(); refreshView(); });
    on('sEval', 'change', e => { cfg.evalbar = e.target.checked; saveCfg(); layout(); });
    on('sTele', 'change', e => teleSet(e.target.checked));
    on('sReset', 'click', () => {
      Object.assign(cfg, DEF, { lang: cfg.lang });
      saveCfg(); board.theme = cfg.board; layout(); refreshView(); board.render(); openBox('settings');
    });
    on('sDone', 'click', closeBox);
    on('sUpd', 'click', () => checkUpdate(true));
    on('sBug', 'click', () => openBox('bug'));
    on('sBench', 'click', benchEngine);
    tele('f.settings');
    loadStats();  } else if (kind === 'tele') {      // 1.27.12: згода на анонімну статистику
    $('boxTitle').textContent = pick('📊  Анонімна статистика', '📊  Anonymous statistics');
    body.innerHTML = `<div style="white-space:pre-line">${esc(pick(
      'Можна допомогти зробити програму кращою: надсилати анонімну статистику — скільки партій проаналізовано, які оцінки ходів, '
      + 'з якими ботами грають, якими функціями користуються, версію програми, мову й країну.\n\nНе надсилаються: партії, ніки, '
      + 'тексти повідомлень, IP-адреса. Загальні цифри видно всім у ⚙ «Статистика». Вимкнути можна будь-коли в ⚙.',
      'You can help make the app better by sending anonymous statistics: how many games were analyzed, move grades, which bots '
      + 'people play, which features are used, the app version, language and country.\n\nNot sent: games, usernames, message texts, '
      + 'IP address. The totals are visible to everyone in ⚙ Statistics. You can turn it off any time in ⚙.'))}</div>`
      + `<div class="row"><button id="tNo">${esc(pick('Ні, дякую', 'No, thanks'))}</button>`
      + `<button id="tYes" class="primary">${esc(pick('Так, надсилати', 'Yes, send'))}</button></div>`;
    $('tYes').addEventListener('click', () => { closeBox(); teleSet(true); });
    $('tNo').addEventListener('click', () => { closeBox(); teleSet(false); });
  } else if (kind === 'gotwlist') {     // 1.29.1: «Партії тижня»
    $('boxTitle').textContent = pick('🏆  Партії тижня', '🏆  Games of the week');
    glLoad();
  } else if (kind === 'db') {           // 1.29.0: база партій майстрів
    $('boxTitle').textContent = pick('📖  База партій майстрів', '📖  Masters games database');
    MS.fen = null; dbTick();
  } else if (kind === 'acc') {          // 1.31.0: акаунт
    $('boxTitle').textContent = pick('👤  Акаунт', '👤  Account');
    body.innerHTML = accBody();
    accWire();
  } else if (kind === 'admin') {
    $('boxTitle').textContent = A.admMode === 'gotw' ? pick('🛡  Заявки «Партія тижня»', '🛡  Game of the week submissions') : pick('🛡  Звіти про помилки', '🛡  Bug reports');
    body.innerHTML = `<div id="admList" style="max-height:60vh;overflow:auto">${esc(pick('Завантаження…', 'Loading…'))}</div>`
      + `<div class="row"><button id="admBack">${esc(pick('← Акаунт', '← Account'))}</button></div>`;
    $('admList').addEventListener('click', admClick);
    $('admBack').addEventListener('click', () => openBox('acc'));
    admLoad();
  } else if (kind === 'gotw') {         // 1.28.3: «Партія тижня»
    const s = (A.res && A.res.summary) || {};
    $('boxTitle').textContent = pick('🏆  Подати заявку на гру тижня', '🏆  Apply for game of the week');
    body.innerHTML = `<div class="hint">${esc(pick('Цікава партія? Подайте заявку. Її побачать інші гравці у вкладці «🏆 Партії тижня» (з іменами гравців з партії) і зможуть поставити ❤, а найкращі покажемо в нашому Telegram-каналі.',
      'An interesting game? Apply with it. Other players will see it in the «🏆 Games of the week» tab (with the player names from the game) and can give it a ❤, and the best ones will be shown in our Telegram channel.'))}</div>`
      + `<div style="font-weight:700;margin:8px 0">${esc(`${tr(s.white || '?')} – ${tr(s.black || '?')} · ${s.result || '*'} · ${(s.white_acc || 0).toFixed(1)}% / ${(s.black_acc || 0).toFixed(1)}%`)}</div>`
      + `<label class="f">${esc(pick("Як вас підписати (необов'язково):", 'How to credit you (optional):'))}</label><input id="gwNick" type="text" maxlength="60" autocomplete="off"${ACC.user ? ` value="${esc(ACC.user.nick)}" disabled` : ''}>`
      + `<label class="f">${esc(pick("Чим цікава партія (необов'язково):", 'What makes it interesting (optional):'))}</label><textarea id="gwText" rows="3" maxlength="500"></textarea>`
      + `<div class="hint" id="gwStatus"></div>`
      + `<div class="row"><button id="gwCancel">${esc(tr('Скасувати'))}</button><button id="gwSend" class="primary">${esc(pick('Надіслати', 'Send'))}</button></div>`;
    $('gwCancel').addEventListener('click', closeBox);
    $('gwSend').addEventListener('click', gotwSend);
  } else if (kind === 'bug') {          // 1.27.18: звіт про помилку без акаунта GitHub
    $('boxTitle').textContent = pick('🐞  Повідомити про помилку', '🐞  Report a bug');
    body.innerHTML = `<div class="hint">${esc(pick('Опишіть, що сталося і що ви робили перед цим. Звіт отримає автор програми.',
      'Describe what happened and what you did before it. The report goes to the author of the app.'))}</div>`
      + `<textarea id="bugText" rows="6"></textarea>`
      + `<label class="f">${esc(pick("Як з вами зв'язатися (необов'язково): Telegram, пошта…", 'How to contact you (optional): Telegram, email…'))}</label>`
      + `<input id="bugContact" type="text" autocomplete="off">`
      + `<label class="check"><input type="checkbox" id="bugPgn"> ${esc(pick('Додати поточну партію (PGN)', 'Attach the current game (PGN)'))}</label>`
      + `<div class="hint" id="bugStatus"></div>`
      + `<div class="row"><button id="bugGh">${esc(pick('🐙 Через GitHub', '🐙 Via GitHub'))}</button>`
      + `<button id="bugSend" class="primary">${esc(pick('Надіслати', 'Send'))}</button></div>`;
    $('bugGh').addEventListener('click', bugGithub);
    $('bugSend').addEventListener('click', bugSend);
    $('bugText').focus();
  } else if (kind === 'donate') {
    $('boxTitle').textContent = tr('☕  Підтримати кавою');
    body.innerHTML = `<div>${esc(pick('Програма безкоштовна. Якщо вона вам подобається, можна пригостити автора кавою — переказ на картку:',
      'The app is free. If you like it, you can treat the author to a coffee — a transfer to the card:'))}</div>`
      + `<div style="font-size:22px;font-weight:700;text-align:center;margin:14px 0 2px;user-select:all">${esc(D.DONATE_CARD)}</div>`
      + `<div class="hint" id="dBank" style="text-align:center">${esc(pick('monobank, Україна', 'monobank, Ukraine'))}</div>`
      + `<div class="row"><button id="dCopy" class="primary">${esc(pick('📋 Копіювати номер', '📋 Copy number'))}</button>`
      + `<button id="dClose">${esc(tr('Закрити'))}</button></div>`;
    $('dCopy').addEventListener('click', copyCard);
    $('dClose').addEventListener('click', closeBox);
  } else if (kind === 'news') {
    $('boxTitle').textContent = tr('✨  Що нового');
    body.innerHTML = `<div class="news">${D.CHANGELOG.map(([ver, date, items]) => `<h4>${esc(ver)} <small>${esc(String(date).replace(/^(\d{4})-(\d\d)-(\d\d)/, '$1-$3-$2'))}</small></h4>`
      + `<ul>${items.map(([uk, en]) => `<li>${esc(pick(uk, en))}</li>`).join('')}</ul>`).join('')}</div>`;
  } else if (kind === 'pgn') {
    $('boxTitle').textContent = pick('📋 PGN партії', '📋 Game PGN');
    body.innerHTML = `<div class="hint">${esc(pick('Вставте PGN партії (наприклад, скопійований з chess.com або lichess).', 'Paste the game PGN (for example, copied from chess.com or lichess).'))}</div>`
      + `<textarea id="pgnText" rows="9" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>`
      + `<div class="row"><button id="pgnPaste">${esc(pick('📋 Вставити', '📋 Paste'))}</button><button id="pgnLoad" class="primary">${esc(pick('▶ Аналізувати', '▶ Analyze'))}</button></div>`;
    const paste = async () => {
      let t = '';
      try { t = bridge && bridge.readClipboard ? bridge.readClipboard() : await navigator.clipboard.readText(); } catch (_) { /* */ }
      if (t) $('pgnText').value = t;
      return t;
    };
    $('pgnPaste').addEventListener('click', async () => { if (!await paste()) $('pgnText').focus(); });
    $('pgnLoad').addEventListener('click', () => { if (loadPgn($('pgnText').value)) closeBox(); });
    if (bridge && bridge.readClipboard) { const t = bridge.readClipboard(); if (t && /\d\.\s*\S|\[\w+\s+"/.test(t)) $('pgnText').value = t; }
  } else if (kind === 'bots') {
    $('boxTitle').textContent = pick('🤖  Грати з ботом', '🤖  Play a bot');
    $('overlay').hidden = false;
    botsRenderBody();
  } else if (kind === 'botend') {
    $('boxTitle').textContent = pick('🏁  Кінець партії', '🏁  Game over');
    $('overlay').hidden = false;
    botendRenderBody();
  } else if (kind === 'credits') {
    $('boxTitle').textContent = pick('ⓘ  Ліцензія фото', 'ⓘ  Photo license');
    creditsRenderBody();
  } else if (kind === 'chesscom') {
    $('boxTitle').textContent = pick('♞  Партії з chess.com', '♞  Games from chess.com');
    $('overlay').hidden = false;
    ccRenderBody();
  } else if (kind === 'studies') {
    $('boxTitle').textContent = tr('📚  Дослідження');
    const items = listStudies();
    body.innerHTML = `<label class="f">${esc(tr('Збережені дослідження'))}</label>`
      + (items.length ? `<div class="list" id="sdList">${items.map(({ id, s }) => `<div class="it${id === A.studyId ? ' cur' : ''}" data-id="${esc(id)}">`
        + `${esc(s.name)}<small>${esc(plural((s.chapters || []).length, ['розділ', 'розділи', 'розділів'], ['chapter', 'chapters']))} · ${esc(s.updated || '')}</small></div>`).join('')}</div>`
        + `<div class="row"><button id="sdOpen" class="primary" disabled>${esc(tr('Відкрити'))}</button><button id="sdDel" disabled>${esc(tr('Видалити'))}</button></div>`
        : `<div class="hint">${esc(pick('Досліджень ще немає.', 'No studies yet.'))}</div>`)
      + `<label class="f">${esc(tr('Нове дослідження'))}</label><input type="text" id="sdName" maxlength="80">`
      + `<div class="row"><button id="sdCreate" class="primary">${esc(tr('Створити'))}</button></div>`
      + `<div class="hint">${esc(tr('Перший розділ — партія, яка зараз на дошці.'))}</div>`;
    let chosen = null;
    const list = $('sdList');
    if (list) list.addEventListener('click', e => {
      const it = e.target.closest('.it');
      if (!it) return;
      if (chosen === it.dataset.id) { openStudy(chosen); return; }
      chosen = it.dataset.id;
      for (const x of list.children) x.classList.toggle('cur', x === it);
      $('sdOpen').disabled = $('sdDel').disabled = false;
    });
    if ($('sdOpen')) $('sdOpen').addEventListener('click', () => chosen && openStudy(chosen));
    if ($('sdDel')) $('sdDel').addEventListener('click', () => chosen && deleteStudy(chosen));
    $('sdCreate').addEventListener('click', () => createStudy($('sdName').value));
  }
  $('overlay').hidden = false;
  placeBox();
}
function reopenBox() { if (A.boxKind) { const k = A.boxKind; const b = $('box'), l = b.style.left, t = b.style.top; openBox(k); b.style.left = l; b.style.top = t; clampBox(); } }
// 1.29.1: вкладка «Партії тижня» - заявки гравців і лайки
const GL = { sort: 'new', rows: [], err: null, loading: false };
function glLikes() {
  let d = store.get('ca.likes', null);
  if (!d || !/^[0-9a-f]{32}$/.test(d.id || '')) {
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    d = { id: [...a].map(x => x.toString(16).padStart(2, '0')).join(''), liked: [] };
    store.set('ca.likes', d);
  }
  return d;
}
async function glLoad() {
  GL.loading = true; GL.err = null; glRender();
  try {
    const r = await fetch(`${D.AI_COACH_URL}/gotw/list?sort=${GL.sort}`);
    if (!r.ok) throw new Error(r.status === 429 ? 'rate' : 'err');
    GL.rows = (await r.json()).games || [];
  } catch (e) { GL.err = e.message === 'rate' ? 'rate' : 'net'; }
  GL.loading = false; glRender();
}
function glRender() {
  if (A.boxKind !== 'gotwlist') return;
  const L = glLikes();
  const seg = (k, l) => `<button data-glsort="${k}" class="${GL.sort === k ? 'primary' : ''}">${esc(l)}</button>`;
  let html = `<div class="row">${seg('new', pick('🆕 Нові', '🆕 Newest'))}${seg('top', pick('❤ Найкращі', '❤ Best'))}</div>`
    + `<div class="hint">${esc(pick('Партії, які надіслали гравці. Торкніться партії, щоб відкрити, або ♡, щоб поставити лайк.', 'Games sent by players. Tap a game to open it, or ♡ to like it.'))}</div>`;
  if (GL.loading) html += `<div class="hint">${esc(pick('Завантажую…', 'Loading…'))}</div>`;
  else if (GL.err) html += `<div class="hint">${esc(GL.err === 'rate' ? pick('Забагато запитів - спробуйте за хвилину.', 'Too many requests - try in a minute.') : pick("Немає з'єднання з інтернетом.", 'No internet connection.'))}</div>`;
  else if (!GL.rows.length) html += `<div class="hint">${esc(pick('Ще ніхто не подав заявку - будьте першим!', 'No applications yet - be the first!'))}</div>`;
  else html += `<div class="list gllist">` + GL.rows.map(g => {
    const liked = L.liked.includes(g.n), acc = g.white_acc != null && g.black_acc != null ? ` · ${Math.round(g.white_acc)}% / ${Math.round(g.black_acc)}%` : '';
    return `<div class="it glit" data-gln="${g.n}"><button class="glheart${liked ? ' on' : ''}" data-gllike="${g.n}">${liked ? '❤' : '♡'} ${g.likes || 0}</button>`
      + `<div class="glmain">${esc(`${g.white || '?'} – ${g.black || '?'} ${g.result || ''}`)}<small>${esc(`${g.nick || '—'} · ${(g.at || '').slice(0, 10)}${acc}`)}</small>`
      + (g.comment ? `<small class="glc">💬 ${esc(g.comment)}</small>` : '') + `</div></div>`;
  }).join('') + `</div>`;
  html += `<div class="row"><button id="glClose">${esc(pick('Закрити', 'Close'))}</button></div>`;
  $('boxBody').innerHTML = html;
  $('glClose').addEventListener('click', closeBox);
  $('boxBody').querySelectorAll('[data-glsort]').forEach(b => b.addEventListener('click', () => { GL.sort = b.dataset.glsort; glLoad(); }));
  $('boxBody').querySelectorAll('[data-gllike]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); glLike(+b.dataset.gllike); }));
  $('boxBody').querySelectorAll('[data-gln]').forEach(it => it.addEventListener('click', () => glOpen(+it.dataset.gln)));
}
async function glLike(n) {
  const L = glLikes(), on = !L.liked.includes(n);
  tele('gotw.like');
  try {
    const r = await fetch(`${D.AI_COACH_URL}/gotw/like`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ n, id: L.id, on }) });
    if (!r.ok) throw new Error('x');
    const d = await r.json();
    L.liked = on ? [...L.liked, n] : L.liked.filter(x => x !== n);
    store.set('ca.likes', L);
    const g = GL.rows.find(x => x.n === n);
    if (g) g.likes = d.likes;
    glRender();
  } catch (_) { msg(pick("Не вдалося - немає з'єднання?", 'Failed - no connection?')); }
}
async function glOpen(n) {
  try {
    const r = await fetch(`${D.AI_COACH_URL}/gotw/pgn?n=${n}`);
    const d = await r.json();
    if (!d.pgn) throw new Error('x');
    closeBox();
    loadPgn(d.pgn);
  } catch (_) { msg(pick('Не вдалося завантажити партію.', 'Could not load the game.')); }
}

async function gotwSend() {
  const st = $('gwStatus'), btn = $('gwSend'), res = A.res, s = (res && res.summary) || {};
  if (!res || res.free || analysing()) return;
  const pgn = bugPgnText((A.game && A.game.headers && A.game.headers.Event) || '?');
  if (!pgn) { st.textContent = pick('Не вдалося зібрати партію.', 'Could not build the game.'); return; }
  btn.disabled = true; st.textContent = pick('Надсилаю…', 'Sending…');
  tele('f.gotw');
  let r = 'net';
  try {
    const x = await fetch(D.AI_COACH_URL + '/gotw', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pgn, nick: $('gwNick').value.trim(), comment: $('gwText').value.trim(), white: s.white, black: s.black,
        result: s.result, white_acc: s.white_acc, black_acc: s.black_acc, p: 'phone', v: D.APP_VERSION, lang: cfg.lang, public: true,
        ...(ACC.token ? { token: ACC.token } : {}) }) });
    r = x.ok ? ((await x.json()).ok ? true : 'error') : (x.status === 429 ? 'rate' : 'error');
  } catch (_) { /* немає мережі */ }
  if (A.boxKind !== 'gotw') return;
  if (r === true) { st.textContent = pick('✓ Дякуємо! Заявку подано - партія вже у «🏆 Партіях тижня».', '✓ Thank you! Applied - the game is in «🏆 Games of the week».'); setTimeout(() => { if (A.boxKind === 'gotw') closeBox(); }, 1800); return; }
  btn.disabled = false;
  st.textContent = r === 'net' ? pick("Немає з'єднання з інтернетом. Спробуйте пізніше.", 'No internet connection. Try later.')
    : r === 'rate' ? pick('Забагато спроб. Спробуйте за хвилину.', 'Too many attempts. Try again in a minute.')
    : pick('Не вдалося надіслати. Спробуйте пізніше.', 'Could not send. Try later.');
}
function bugPlatform() {
  const m = /Android [\d.]+/.exec(navigator.userAgent);
  return (m ? m[0] : 'Android') + (bridge ? '' : ' (browser)');
}
function bugGithub() {
  const body = `**Version:** ${D.APP_VERSION}\n**Platform:** ${bugPlatform()}\n\n**What happened?**\n\n\n**Steps to reproduce:**\n1. \n\n**PGN (if any):**\n`;
  const u = D.GITHUB_URL + '/issues/new?' + new URLSearchParams({ title: 'Bug: ', body, labels: 'bug' });
  if (bridge && bridge.openUrl) bridge.openUrl(u); else window.open(u, '_blank');
}
function bugPgnText(name = 'bug') {
  try {
    if (!A.res || !A.res.moves || !A.res.moves.length) return "";
    return chapterPgn({ name, headers: A.game ? { ...A.game.headers } : {}, result: A.res, lines: A.lines, notes: {}, shapes: {} });
  } catch (_) { return ''; }
}
async function bugSend() {
  const st = $('bugStatus'), btn = $('bugSend'), text = $('bugText').value.trim();
  if (text.length < 3) { st.textContent = pick('Напишіть кілька слів про проблему.', 'Write a few words about the problem.'); return; }
  btn.disabled = true; st.textContent = pick('Надсилаю…', 'Sending…');
  let r = 'net';
  try {
    const res = await fetch(D.AI_COACH_URL + '/bug', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, contact: $('bugContact').value.trim(), pgn: $('bugPgn').checked ? bugPgnText() : '',
        p: 'phone', v: D.APP_VERSION, lang: cfg.lang }) });
    r = res.ok ? ((await res.json()).ok ? true : 'error') : (res.status === 429 ? 'rate' : 'error');
  } catch (_) { /* немає мережі */ }
  if (A.boxKind !== 'bug') return;
  if (r === true) {
    $('bugText').value = '';
    st.textContent = pick('✓ Дякуємо! Звіт надіслано.', '✓ Thank you! The report was sent.');
    setTimeout(() => { if (A.boxKind === 'bug') closeBox(); }, 1800);
    return;
  }
  btn.disabled = false;
  st.textContent = r === 'net' ? pick("Немає з'єднання з інтернетом. Спробуйте пізніше або через GitHub.", 'No internet connection. Try later or via GitHub.')
    : r === 'rate' ? pick('Забагато звітів. Спробуйте за хвилину.', 'Too many reports. Try again in a minute.')
    : pick('Не вдалося надіслати. Спробуйте через GitHub.', 'Could not send. Try via GitHub.');
}
// 1.31.3.4: клавіатура не закриває квадрат - стискаємо його до видимої частини екрана, поле - по центру
let fullH = window.innerHeight;
function fitBoxToKeyboard() {
  const vv = window.visualViewport, b = $('box');
  fullH = Math.max(fullH, window.innerHeight);
  if (!vv || !b || $('overlay').hidden) return;
  if (vv.height < fullH - 120) {
    b.style.maxHeight = Math.round(vv.height - 24) + 'px';
    b.style.top = Math.round(vv.offsetTop + 12) + 'px';
    const f = document.activeElement;
    if (f && b.contains(f)) f.scrollIntoView({ block: 'center' });
  } else if (b.style.maxHeight) { b.style.maxHeight = ''; clampBox(); }
}
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitBoxToKeyboard);
document.addEventListener('focusin', e => { if (e.target.matches('input, textarea') && $('box').contains(e.target)) setTimeout(fitBoxToKeyboard, 350); });
function closeBox() { A.boxKind = null; $('overlay').hidden = true; $('boxBody').innerHTML = ''; }
function toggleBox(kind) { if (A.boxKind === kind) closeBox(); else openBox(kind); }
function placeBox() {
  const b = $('box');
  b.style.left = Math.round((window.innerWidth - b.offsetWidth) / 2) + 'px';
  b.style.top = Math.round(Math.max(12, (window.innerHeight - b.offsetHeight) / 2)) + 'px';
}
function clampBox() {
  const b = $('box');
  const x = Math.min(Math.max(0, b.offsetLeft), Math.max(0, window.innerWidth - b.offsetWidth));
  const y = Math.min(Math.max(0, b.offsetTop), Math.max(0, window.innerHeight - 48));
  b.style.left = x + 'px'; b.style.top = y + 'px';
}
(function dragBox() {
  const head = $('boxHead');
  let d = null;
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    d = { x: e.clientX - $('box').offsetLeft, y: e.clientY - $('box').offsetTop };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', e => {
    if (!d) return;
    $('box').style.left = (e.clientX - d.x) + 'px'; $('box').style.top = (e.clientY - d.y) + 'px';
    clampBox();
  });
  const end = () => { d = null; };
  head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
})();

// ------------------------------------------------------------ оновлення ---
// Нові версії - релізи GitHub (тег «v1.7.0», у релізі файл .apk). Програма сама завантажує APK
// і відкриває установник Android; користувачу лишається підтвердити.
const UPDATE_REPO = 'volod4ik4-code/chess-analyzer';
// 1.26.0: версії з 4 чисел - багфікс X.Y.Z.N (у звичайної версії четверте число 0)
const verNum = s => { const m = String(s || '').match(/(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/); return m ? m.slice(1).map(x => +(x || 0)) : []; };
const verStr = v => (v[3] ? v : v.slice(0, 3)).join('.');
function isNewer(a, b) { for (let i = 0; i < 4; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); return false; }
const mb = n => (n / 1048576 < 10 ? (n / 1048576).toFixed(1) : (n / 1048576).toFixed(0));
function localTime(iso) {
  const d = new Date(iso), z = x => String(x).padStart(2, '0');
  return isNaN(d) ? '' : `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

async function checkUpdate(manual = false) {
  A.lastUpdCheck = Date.now();
  try {
    // найновіший реліз, у якому є файл для телефона; релізи лише для комп'ютера пропускаємо
    const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=20`,
      { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok && r.status !== 404) throw new Error('HTTP ' + r.status);
    const rels = (r.ok ? await r.json() : []).filter(x => !x.draft && !x.prerelease
      && verNum(x.tag_name || x.name).length === 4
      && (x.assets || []).some(a => /\.apk$/i.test(a.name) || /-web-n\d+\.zip$/i.test(a.name)));
    // версія - з назви файлу телефона («ChessAnalyzer-1.18.8-Android.apk»), а не з номера релізу: у релізі лише
    // для ПК лежить той самий старий APK, і телефон його не пропонує (з 1.18.8)
    const relVer = x => { const a = (x.assets || []).find(a => /\.apk$/i.test(a.name)) || (x.assets || []).find(a => /-web-n\d+\.zip$/i.test(a.name));
      const v = verNum(a && a.name); return v.length === 4 ? v : verNum(x.tag_name || x.name); };
    const j = rels.reduce((b, x) => (!b || isNewer(relVer(x), relVer(b)) ? x : b), null) || {};
    const v = j.assets ? relVer(j) : [];
    const apk = (j.assets || []).find(a => /\.apk$/i.test(a.name));
    // маленьке оновлення лише сторінки (без рушія): «…-web-nN.zip», де N - потрібний рівень Java-частини
    const web = (j.assets || []).find(a => /-web-n\d+\.zip$/i.test(a.name));
    const level = bridge && bridge.nativeLevel ? bridge.nativeLevel() : 0;
    const useWeb = web && level >= +web.name.match(/-web-n(\d+)\.zip$/i)[1];
    const asset = useWeb ? web : apk;
    if (v.length === 4 && asset && isNewer(v, verNum(D.APP_VERSION))) {
      if (!A.upd || A.upd.version !== v.join('.')) {
        // що нового в усіх версіях, новіших за встановлену (пропущені оновлення теж видно), з 1.22.4
        const cur = verNum(D.APP_VERSION);
        const changes = rels.filter(x => isNewer(relVer(x), cur)).sort((a, b) => (isNewer(relVer(a), relVer(b)) ? -1 : 1))
          .map(x => [verStr(relVer(x)), x.body || '']);
        A.upd = { version: v.join('.'), date: localTime(j.published_at), notes: j.body || '', changes, url: asset.browser_download_url,
          apiUrl: asset.url || '', size: asset.size, state: 'available', kind: useWeb ? 'web' : 'apk' };
      }
      A.upd.hidden = false;
      renderUpdate();
      if (manual) { closeBox(); $('panel').scrollTop = 0; }
      // 1.23.8: маленьке оновлення (без нового APK) ставиться саме, без питань
      if (A.upd.kind === 'web' && A.upd.state === 'available' && !A.upd.auto && bridge && bridge.installWebUpdate) {
        A.upd.auto = true;
        downloadUpdate();
      }
    } else if (manual) msg(pick(`У вас найновіша версія (${D.APP_VERSION}).`, `You have the latest version (${D.APP_VERSION}).`));
  } catch (e) {
    if (manual) msg(pick('Не вдалося перевірити оновлення. Перевірте інтернет.', 'Could not check for updates. Check your internet connection.'));
  }
}

/** Опис релізу двома мовами: українська, потім рядок «— English —» і англійська. */
function notesFor(body) {
  body = body || '';
  const i = body.indexOf('— English —');
  if (i >= 0) body = S.lang === 'en' ? body.slice(i + '— English —'.length) : body.slice(0, i);
  // список файлів релізу не показуємо (1.22.4); з 1.25.1 українська частина - в HTML-коментарі
  return body.split(/^\s*(?:Файли|Files)\s*:/m)[0].replace(/<!--|-->/g, '').trim();
}
/** Що нового для картки оновлення: кожна нова версія окремо, новіші зверху. */
function changesText(u) {
  const parts = (u.changes || []).map(([v, b]) => [v, notesFor(b)]).filter(([, n]) => n);
  if (!parts.length) return notesFor(u.notes);
  if (parts.length === 1) return parts[0][1];
  return parts.map(([v, n]) => `${v}\n${n}`).join('\n\n');
}

function renderUpdate() {
  const u = A.upd, el = $('updCard');
  el.hidden = !u || u.hidden;
  if (el.hidden) return;
  let html = `<div class="t">⬆ ${esc(pick(`Доступна нова версія ${u.version}`, `New version ${u.version} is available`))}</div>`
    + (u.date ? `<div class="d">${esc(pick('Вийшла', 'Released'))} ${esc(u.date)}</div>` : '')
    + (u.notes || (u.changes || []).length ? `<div class="notes">${esc(changesText(u))}</div>` : '');
  if (u.state === 'downloading') {
    const pct = u.total > 0 ? Math.min(100, 100 * u.done / u.total) : 0;
    html += `<div class="bar"><div style="width:${pct.toFixed(1)}%"></div></div><div class="d">${esc(pick('Завантаження…', 'Downloading…'))} `
      + `${mb(u.done || 0)} / ${mb(u.total > 0 ? u.total : u.size)} ${esc(pick('МБ', 'MB'))}</div>`;
  } else if (u.state === 'ready') {
    html += `<div class="row"><button id="uInstall" class="primary">${esc(pick('📲 Встановити', '📲 Install'))}</button></div>`;
  } else if (u.state === 'web-ready') {
    html += `<div class="d">${esc(u.later ? pick('Оновлення встановлено — запрацює після перезапуску.', 'The update is installed — it will apply after a restart.')
      : pick('Оновлення встановлено, програма перезапускається…', 'The update is installed, restarting…'))}</div>`
      + `<div class="row"><button id="uReload" class="primary">${esc(pick('🔄 Перезапустити', '🔄 Restart'))}</button></div>`;
  } else {
    if (u.state === 'error') html += `<div class="d">${esc(pick('Помилка завантаження:', 'Download error:'))} ${esc(u.err || '')}</div>`;
    html += `<div class="row"><button id="uGet" class="primary">${esc(pick(`⬇ Завантажити (${mb(u.size)} МБ)`, `⬇ Download (${mb(u.size)} MB)`))}</button>`
      + `<button id="uLater">${esc(pick('Пізніше', 'Later'))}</button></div>`;
  }
  el.innerHTML = html;
  if ($('uGet')) $('uGet').onclick = downloadUpdate;
  if ($('uLater')) $('uLater').onclick = () => { u.hidden = true; renderUpdate(); };
  if ($('uInstall')) $('uInstall').onclick = installUpdate;
  if ($('uReload')) $('uReload').onclick = () => { flushSave(); location.reload(); };
}

function downloadUpdate() {
  const u = A.upd;
  if (!u) return;
  if (!bridge || !bridge.downloadUpdate) { window.open(u.url, '_blank'); return; }
  u.state = 'downloading'; u.done = 0; u.total = u.size; u.tries = 0;
  renderUpdate();
  startDownload(u);
}
// GitHub інколи відповідає 504 на звичайне посилання: новіша Java-частина вміє качати через API (інший шлях),
// а при помилці пробуємо ще (до 4 разів, по черзі API і звичайне посилання)
function startDownload(u) {
  const api = u.apiUrl && bridge.apiDownloads && u.tries % 2 === 0;
  const url = api ? u.apiUrl : u.url;
  if (u.kind === 'web' && bridge.installWebUpdate) bridge.installWebUpdate(url);
  else bridge.downloadUpdate(url);
}
// маленьке оновлення встановлено - програма перезапускається сама (за секунду, щоб було видно повідомлення)
window.onWebUpdateReady = () => {
  // 1.23.8: якщо на дошці вже партія чи йде аналіз - не перериваємо, оновлення запрацює при наступному запуску
  // одразу після запуску (перші 20 с) перезапуск нічого не зіпсує, хіба що вже йде аналіз
  const busy = !!((A.res && A.res.partial) || ((A.res || A.v) && performance.now() > 20000));
  if (A.upd) { A.upd.state = 'web-ready'; A.upd.later = busy; renderUpdate(); }
  flushSave();
  if (!busy) setTimeout(() => location.reload(), 1200);
};
window.onUpdateProgress = (done, total) => { if (A.upd) { A.upd.done = done; A.upd.total = total; renderUpdate(); } };
window.onUpdateReady = () => { if (A.upd) { A.upd.state = 'ready'; renderUpdate(); installUpdate(); } };
window.onUpdateError = err => {
  const u = A.upd;
  if (!u) return;
  if (u.state === 'downloading' && (u.tries || 0) < 3 && !/HTTP 404/.test(err || '')) {
    u.tries = (u.tries || 0) + 1;
    setTimeout(() => startDownload(u), 2000 * u.tries);
    return;
  }
  u.state = 'error'; u.err = err; renderUpdate();
};

function installUpdate() {
  flushSave();
  const r = bridge && bridge.installUpdate ? bridge.installUpdate() : 'missing';
  if (r === 'permission') {
    msg(pick('Дозвольте цій програмі встановлювати оновлення (перемикач на екрані, що відкрився), '
      + 'поверніться сюди і натисніть «📲 Встановити» ще раз.',
    'Allow this app to install updates (the switch on the screen that opened), then come back and tap "📲 Install" again.'));
  } else if (r === 'missing') { A.upd.state = 'available'; renderUpdate(); }
}

// ------------------------------------------------------------ рушій «усі ядра» ---
// Багатопотоковий Stockfish 19 (у ~3 рази швидший). Потрібні cross-origin isolation і потоки в потоці;
// файли (~90 МБ) завантажуються один раз. Якщо він не запуститься - повертаємось до звичайного.
const ENGINE_URL = 'https://github.com/volod4ik4-code/chess-analyzer/releases/download/engine-sf19-mt/ChessAnalyzer-engine-mt.zip';

async function probeMT() {
  if (!self.crossOriginIsolated || !bridge || !bridge.downloadEngine) return false;
  try {
    const src = `const w = new Worker(${JSON.stringify(new URL('probe.js', location.href).href)});
      w.onmessage = e => postMessage(e.data); w.onerror = () => postMessage('fail');`;
    const outer = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    const ok = await new Promise(res => {
      const t = setTimeout(() => res(false), 4000);
      outer.onmessage = e => { clearTimeout(t); res(e.data === 'ok'); };
      outer.onerror = () => { clearTimeout(t); res(false); };
    });
    outer.terminate();
    return ok;
  } catch (_) { return false; }
}

/** Перевірка швидкості: одна позиція середини гри до глибини 16 тим рушієм, що вибрано. */
async function benchEngine() {
  if (A.analysing || A.varBusy) { msg(tr('Зачекайте, поки закінчиться аналіз партії.')); return; }
  closeBox();
  setStatus(() => pick('Перевіряю швидкість рушія…', 'Testing the engine speed…'));
  try {
    const t0 = performance.now();
    await ensureEngine();
    const tStart = performance.now() - t0;
    engine.nps = 0;
    const keepMax = engine.maxMs;
    engine.maxMs = 0;                                    // перевірка - без межі часу
    const t1 = performance.now();
    try {
      await engine.analyse('r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N2N2/PP2BPPP/R2QKB1R w KQ - 0 9', [], 16, 1);
    } finally { engine.maxMs = keepMax; }
    const sec = (performance.now() - t1) / 1000;
    const name = cfg.engine === 'native' ? (engine.idName || 'Stockfish (Android)') : 'Stockfish 19 lite (WebAssembly)';
    const text = pick(
      `Рушій: ${name}\nПотоків: ${cfg.engine === 'native' ? engine.threads : 1} (ядер у телефоні: ${navigator.hardwareConcurrency || '?'})\n`
      + `Запуск: ${(tStart / 1000).toFixed(1)} с\nГлибина 16: ${sec.toFixed(1)} с\nШвидкість: ${Math.round((engine.nps || 0) / 1000)} тис. позицій/с\n\n`
      + 'Для порівняння: комп\'ютер рахує це приблизно за 0,5–1 с (близько 1000 тис. позицій/с на ядро).',
      `Engine: ${name}\nThreads: ${cfg.engine === 'native' ? engine.threads : 1} (phone cores: ${navigator.hardwareConcurrency || '?'})\n`
      + `Start: ${(tStart / 1000).toFixed(1)} s\nDepth 16: ${sec.toFixed(1)} s\nSpeed: ${Math.round((engine.nps || 0) / 1000)}k positions/s\n\n`
      + 'For comparison: a computer does this in about 0.5–1 s (around 1000k positions/s per core).');
    setStatus(() => pick('Перевірку швидкості завершено.', 'Speed test finished.'));
    msg(text);
  } catch (e) {
    setStatus(() => pick('Перевірка швидкості не вдалася.', 'The speed test failed.'));
    msg(`${pick('Помилка рушія', 'Engine error')}: ${e.message || e}`);
  }
}

async function ensureEngine() {
  try {
    await engine.ensure(cfg.engine);
  } catch (e) {
    if (cfg.engine === 'lite') throw e;
    cfg.engine = 'lite'; saveCfg();
    msg(pick('Швидкий Stockfish 19 не запустився на цьому телефоні, тож працює Stockfish 19 lite.',
      'The fast Stockfish 19 could not start on this phone, so Stockfish 19 lite is used.'));
    await engine.ensure('lite');
  }
}

function pickEngine(value) {
  if (value !== 'mt') { cfg.engine = value; saveCfg(); return; }
  if (bridge.hasEngine()) { cfg.engine = 'mt'; saveCfg(); return; }
  ask(pick('Для рушія «усі ядра» треба один раз завантажити ~90 МБ. Завантажити?',
    'The "all cores" engine needs a one-time ~90 MB download. Download it?')).then(yes => {
    if (!yes) { openBox('settings'); return; }
    A.engDl = true;
    setStatus(() => pick('Завантажую рушій «усі ядра»…', 'Downloading the "all cores" engine…'));
    progress(0, 1);
    bridge.downloadEngine(ENGINE_URL);
  });
  openBox('settings');
}
window.onEngineProgress = (d, t) => {
  progress(d, t || 1);
  setStatus(() => `${pick('Завантажую рушій «усі ядра»…', 'Downloading the "all cores" engine…')} ${mb(d)} / ${mb(t)} ${pick('МБ', 'MB')}`);
};
window.onEngineReady = () => {
  A.engDl = false; progress(0, 0);
  cfg.engine = 'mt'; saveCfg();
  setStatus(() => pick('Рушій «усі ядра» готовий.', 'The "all cores" engine is ready.'));
  if (A.boxKind === 'settings') openBox('settings');
};
window.onEngineError = err => {
  A.engDl = false; progress(0, 0);
  setStatus(() => pick('Не вдалося завантажити рушій: ', 'Could not download the engine: ') + err);
  if (A.boxKind === 'settings') openBox('settings');
};

function openDonate() {
  if (D.DONATE_URL) {
    if (bridge && bridge.openUrl) bridge.openUrl(D.DONATE_URL); else window.open(D.DONATE_URL, '_blank');
  } else toggleBox('donate');
}

async function copyCard() {
  const num = D.DONATE_CARD.replace(/\s/g, '');
  let ok = false;
  try { await navigator.clipboard.writeText(num); ok = true; } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = num; document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (_) { /* */ }
    ta.remove();
  }
  const el = $('dBank');
  if (el) el.textContent = ok ? pick('Номер скопійовано ✓', 'Number copied ✓') : pick('Скопіюйте номер вручну', 'Copy the number manually');
}

function toggleDraw() {
  board.drawMode = !board.drawMode;
  $('nDraw').classList.toggle('on', board.drawMode);
  $('drawBar').hidden = !board.drawMode;
  board.selected = null; board.render();
  layout();
}

// ------------------------------------------------------------ події ---
function wire() {
  const click = (id, fn) => $(id).addEventListener('click', fn);
  click('bSettings', () => toggleBox('settings'));
  click('bNews', () => toggleBox('news'));
  click('bDonate', openDonate);
  click('bAcc', () => { if (A.boxKind === 'acc') closeBox(); else accOpen(); });   // 1.31.0
  accChanged(); setTimeout(accRefresh, 1500); setTimeout(syncRun, 5000); setInterval(syncRun, 300000);   // 1.31.1
  click('bCc', openChesscom); click('bBots', () => toggleBox('bots')); click('bPz', puzzleStart); click('nGw', () => { if (A.boxKind === 'gotwlist') closeBox(); else { tele('f.gotwlist'); openBox('gotwlist'); } }); click('nDb', () => { if (A.boxKind === 'db') closeBox(); else { tele('f.masters'); openBox('db'); } });
  click('bbUndo', () => undoVar()); click('bbHint', botHint); click('bbResign', botResign);
  document.addEventListener('click', e => { if (e.target.closest('[data-credits]')) openBox('credits'); });
  document.addEventListener('click', e => { if (e.target.closest('[data-gotw]')) openBox('gotw'); });   // 1.28.3
  document.addEventListener('click', e => { const b = e.target.closest('[data-missed]'); if (b) gotoMissed(b.dataset.missed === 'w'); });
  document.addEventListener('click', e => {     // TikTok / Telegram / GitHub під верхніми кнопками (1.26.2)
    const b = e.target.closest('[data-link]'), u = b && D[b.dataset.link];
    if (u) { if (bridge && bridge.openUrl) bridge.openUrl(u); else window.open(u, '_blank'); }
  });
  click('bPgn', () => toggleBox('pgn'));
  click('bNew', () => { tele('f.free'); startFree(); });
  click('bStudies', () => { if (A.boxKind !== 'studies') tele('f.study'); toggleBox('studies'); });
  click('bRun', startAnalysis);
  click('nStart', goStart); click('nPrev', () => { stopPlay(); step(-1); }); click('nNext', () => { stopPlay(); step(1); });
  click('nEnd', goEnd); click('nPlay', togglePlay); click('nFlip', flipBoard); click('nDraw', toggleDraw);
  click('drawClear', () => { board.shapes = []; board.render(); onShapes([]); });
  click('vBack', exitVar); click('vUndo', undoVar); click('vDel', deleteVar);
  click('askBtn', askSend); click('askClear', askClear);
  $('askIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); askSend(); } });
  click('stClose', closeStudy); click('stAll', () => openBox('studies')); click('stAdd', addChapter);
  click('stDel', deleteChapter); click('stExport', exportStudy);
  $('stName').addEventListener('input', e => { if (A.study) { A.study.name = e.target.value.trim() || pick('Без назви', 'Untitled'); autosave(700); } });
  $('stChName').addEventListener('input', e => {
    if (!A.chapter) return;
    A.chapter.name = e.target.value.trim() || '?';
    const it = $('stChapters').querySelector('.it.cur');
    if (it && it.firstChild) it.firstChild.textContent = A.chapter.name;
    autosave(700);
  });
  $('stNote').addEventListener('input', onNoteEdit);
  $('stChapters').addEventListener('click', e => {
    const it = e.target.closest('[data-ch]');
    if (it && A.study && A.study.chapters[+it.dataset.ch] !== A.chapter) openChapter(+it.dataset.ch);
  });
  $('moves').addEventListener('click', e => {
    const ln = e.target.closest('[data-line]');
    if (ln) { const line = lineById(ln.dataset.line); if (line && line !== A.v) openLine(line, 1); return; }
    const mv = e.target.closest('[data-k]');
    if (mv) { stopPlay(); const k = +mv.dataset.k; if (A.v || k !== A.index) jump(k); }
  });
  $('varMoves').addEventListener('click', e => {
    const c = e.target.closest('[data-j]');
    if (c && A.v && !A.varBusy && +c.dataset.j !== A.v.index) gotoVar(+c.dataset.j);
  });
  const gr = $('graph');
  let gDown = false;
  gr.addEventListener('pointerdown', e => { gDown = true; graphPick(e); });
  gr.addEventListener('pointermove', e => { if (gDown) graphPick(e); });
  window.addEventListener('pointerup', () => { gDown = false; });
  $('fileInput').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = () => loadPgn(String(r.result || ''));
    r.onerror = () => msg(tr('Не вдалося прочитати PGN або в ньому немає ходів.'));
    r.readAsText(f);
  });
  $('boxX').addEventListener('click', closeBox);
  $('overlay').addEventListener('pointerdown', e => { if (e.target === $('overlay')) closeBox(); });
  window.addEventListener('resize', () => { layout(); if (A.boxKind) clampBox(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { flushSave(); teleSend(); return; }
    // повернулися в програму (напр. зі сповіщення) - перевірити оновлення, не частіше разу на 10 хв
    if (Date.now() - (A.lastUpdCheck || 0) > 600000) checkUpdate(false);
  });
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
  });
  // кнопка «Назад» на Android: спершу закриває вікна й варіант, потім виходить з програми
  window.onAndroidBack = () => {
    if (A.modalClose) { A.modalClose(); return true; }
    if (A.boxKind) { closeBox(); return true; }
    if (board.drawMode) { toggleDraw(); return true; }
    if (A.v && !A.varBusy) { exitVar(); return true; }
    flushSave();
    return false;
  };
}

wire();
applyLang();
layout();
startFree();
setStatus(() => pick('Вставте PGN партії (📋 PGN) або відкрийте файл. Можна й просто ходити на дошці.',
  'Paste a game PGN (📋 PGN) or open a file. You can also just play on the board.'));
setTimeout(() => checkUpdate(false), 2500);
setTimeout(teleStart, 1800);                       // 1.27.12
setInterval(teleSend, 600000);
// старі налаштування (рушії «full» і «усі ядра» WebAssembly з версій до 1.11) -> справжній Stockfish
if (!['native', 'lite'].includes(cfg.engine) || (cfg.engine === 'native' && DEF.engine !== 'native')) { cfg.engine = DEF.engine; saveCfg(); }
window.__app = { A, cfg, engine, board, loadPgn, chapterPgn, parsePgn, checkUpdate, goto };
