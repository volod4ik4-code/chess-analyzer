// Stockfish 19 (WebAssembly, stockfish.js) у фоновому потоці. Запити йдуть по черзі.
import { MATE } from './logic.js';

// native - справжній Stockfish 19 для Android (процес у Java, усі ядра); lite - запасний (WebAssembly)
const FILES = { lite: 'stockfish/stockfish-19-lite-single' };

export class Engine {
  constructor() {
    this.w = null; this.flavor = null; this.ready = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.multipv = 1;
    this.blobs = [];
  }

  _spawn(url) {
    const w = new Worker(url);
    w.onmessage = e => { const line = String(e.data); for (const l of [...this.listeners]) l(line); };
    return w;
  }

  _waitFor(pred, ms, failOn) {
    return new Promise((resolve, reject) => {
      const done = (fn, v) => { clearTimeout(t); this.listeners.delete(l); fn(v); };
      const l = line => { if (pred(line)) done(resolve, line); };
      const t = setTimeout(() => done(reject, new Error('Stockfish: timeout')), ms);
      this.listeners.add(l);
      if (failOn) failOn(err => done(reject, err));
    });
  }

  async _boot(url, ms) {
    const w = this._spawn(url);
    this.w = w;
    const errHook = cb => { w.onerror = ev => { ev.preventDefault?.(); cb(new Error('Stockfish: ' + (ev.message || 'worker error'))); }; };
    const ok = this._waitFor(l => l === 'uciok', ms, errHook);
    w.postMessage('uci');
    await ok;
    const rd = this._waitFor(l => l === 'readyok', ms);
    w.postMessage('isready');
    await rd;
  }

  async _start(flavor) {
    if (flavor === 'native') {
      const b = window.AndroidBridge;
      if (!b || !b.engineStart || !b.engineStart()) throw new Error('native engine unavailable');
      this.w = { postMessage: c => b.engineSend(c), terminate: () => b.engineStop() };
      window.__sfLines = text => {
        for (const line of text.split('\n')) if (line) for (const l of [...this.listeners]) l(line);
      };
      const idl = l => { if (l.startsWith('id name ')) this.idName = l.slice(8); };
      this.listeners.add(idl);
      const ok = this._waitFor(l => l === 'uciok', 20000);
      this.w.postMessage('uci');
      await ok;
      this.listeners.delete(idl);
      // 1 потік: з кількома потоками пошук «до глибини N» інколи довго дораховує позицію
      // (перевірено на ПК: 4 потоки - 33 с на партію і ходи по 12 с, 1 потік - 8 с), та й результат як на ПК
      const threads = 1;
      this.threads = threads;
      const rd = this._waitFor(l => l === 'readyok', 20000);
      this.w.postMessage('setoption name Threads value ' + threads);
      // Hash - стандартні 16 МБ, як у програмі для ПК: з 64 МБ оцінки трохи інші (напр. 5...Nxd5 у захисті
      // двох коней -0.90 замість -1.14) і погані дебютні ходи лишалися «Теорією»
      this.w.postMessage('isready');
      await rd;
      this.multipv = 1;
      return;
    }
    if (flavor === 'mt') {
      // рушій «усі ядра» (завантажується окремо): mt-boot.js підставляє рушію адресу його скрипту
      const wasm = encodeURIComponent(new URL('stockfish/stockfish-19.wasm', location.href).href);
      await this._boot('stockfish/mt-boot.js#' + wasm, 90000);
      const threads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
      const rd = this._waitFor(l => l === 'readyok', 30000);
      this.w.postMessage('setoption name Threads value ' + threads);
      this.w.postMessage('setoption name Hash value 64');
      this.w.postMessage('isready');
      await rd;
      this.multipv = 1;
      return;
    }
    const base = FILES[flavor];
    try {
      await this._boot(base + '.js', flavor === 'full' ? 60000 : 20000);
    } catch (e) {
      // запасний шлях: файли рушія читає головна сторінка і передає потоку як blob
      this._kill();
      const [js, wasm] = await Promise.all([fetch(base + '.js').then(r => r.blob()), fetch(base + '.wasm').then(r => r.arrayBuffer())]);
      const jsUrl = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
      const wasmUrl = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
      this.blobs.push(jsUrl, wasmUrl);
      await this._boot(jsUrl + '#' + encodeURIComponent(wasmUrl), 90000);
    }
    this.multipv = 1;
  }

  /** Запускає рушій потрібного типу (full - точний, lite - швидкий). */
  ensure(flavor) {
    if (this.w && this.flavor === flavor && this.ready) return this.ready;
    this._kill();
    this.flavor = flavor;
    this.queue = Promise.resolve();
    this.ready = this._start(flavor).catch(e => { this._kill(); this.ready = null; throw e; });
    return this.ready;
  }

  _kill() {
    if (this.w) { try { this.w.terminate(); } catch (_) { /* */ } }
    this.w = null;
    this.listeners.clear();
    for (const u of this.blobs) URL.revokeObjectURL(u);
    this.blobs = [];
  }

  _job(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  newGame() {
    return this._job(async () => {
      await this.ready;
      const rd = this._waitFor(l => l === 'readyok', 30000);
      this.w.postMessage('ucinewgame');
      this.w.postMessage('isready');
      await rd;
    });
  }

  /** Зупиняє поточний пошук (результат прийде одразу). */
  stop() { if (this.w) this.w.postMessage('stop'); }

  /**
   * Хід бота (1.24.0): Stockfish, обмежений до сили elo (UCI_Elo 1320–3190), думає ms мілісекунд, 4 варіанти.
   * Повертає {best: uci (вибір рушія на цій силі), cands: [{uci, cp}] - оцінки для того, хто ходить, найкращий перший}.
   * Після ходу обмеження сили знімається - аналіз іде на повну.
   */
  botMove(root, moves, elo, ms = 800) {
    return this._job(async () => {
      await this.ready;
      const w = this.w;
      if (!w) throw new Error('Stockfish не запущено');
      const infos = [];
      const onLine = line => {
        if (!line.startsWith('info ') || line.includes(' string ')) return;
        const t = line.split(' ');
        const si = t.indexOf('score'), pi = t.indexOf('pv'), mi = t.indexOf('multipv');
        if (si < 0 || pi < 0) return;
        const v = parseInt(t[si + 2], 10);
        const cp = t[si + 1] === 'cp' ? v : v > 0 ? MATE - v : v < 0 ? -MATE - v : -MATE;
        infos[(mi >= 0 ? parseInt(t[mi + 1], 10) || 1 : 1) - 1] = { uci: t[pi + 1], cp };
      };
      this.listeners.add(onLine);
      try {
        w.postMessage('setoption name UCI_LimitStrength value true');
        w.postMessage('setoption name UCI_Elo value ' + Math.max(1320, Math.min(3190, Math.round(elo))));
        w.postMessage('setoption name MultiPV value 4');
        this.multipv = 4;
        const done = this._waitFor(l => l.startsWith('bestmove'), 60000);
        w.postMessage('position fen ' + root + (moves.length ? ' moves ' + moves.join(' ') : ''));
        w.postMessage('go movetime ' + ms);
        const bm = (await done).split(' ')[1];
        const cands = infos.filter(x => x && x.uci).sort((a, b) => b.cp - a.cp);
        const best = bm && bm !== '(none)' ? bm : (cands[0] || {}).uci;
        if (!best) throw new Error('no move');
        return { best, cands };
      } finally {
        this.listeners.delete(onLine);
        if (this.w) this.w.postMessage('setoption name UCI_LimitStrength value false');
      }
    });
  }

  /**
   * Аналіз позиції root + moves до глибини depth, multipv варіантів.
   * Повертає [{cp (для білих, мат = ±(10000 - n)), pv: [uci], depth}, ...].
   */
  /** Очистити хеш рушія (1.25.6: перевірка, чи хід важко помітити на малій глибині). */
  clearHash() {
    return this._job(async () => { await this.ready; if (this.w) this.w.postMessage('setoption name Clear Hash'); });
  }

  analyse(root, moves, depth, multipv = 2) {
    return this._job(async () => {
      await this.ready;
      const w = this.w;
      if (!w) throw new Error('Stockfish не запущено');
      const blackToMove = (root.split(' ')[1] === 'b') !== (moves.length % 2 === 1);
      const infos = [];
      const onLine = line => {
        if (!line.startsWith('info ') || line.includes(' string ')) return;
        const t = line.split(' ');
        const get = k => { const i = t.indexOf(k); return i >= 0 ? t[i + 1] : undefined; };
        const k = (parseInt(get('multipv'), 10) || 1) - 1;
        const cur = infos[k] || (infos[k] = {});
        const d = get('depth'); if (d !== undefined && t.includes('score')) cur.depth = parseInt(d, 10);
        const si = t.indexOf('score');
        if (si >= 0) {
          const kind = t[si + 1], v = parseInt(t[si + 2], 10);
          let cp;
          if (kind === 'cp') cp = v;
          else cp = v > 0 ? MATE - v : v < 0 ? -MATE - v : -MATE;
          cur.cp = blackToMove ? -cp : cp;
        }
        const np = get('nps'); if (np) this.nps = +np;
        const pi = t.indexOf('pv');
        if (pi >= 0) cur.pv = t.slice(pi + 1);
      };
      this.listeners.add(onLine);
      try {
        if (this.multipv !== multipv) { w.postMessage('setoption name MultiPV value ' + multipv); this.multipv = multipv; }
        const done = this._waitFor(l => l.startsWith('bestmove'), 600000);
        w.postMessage('position fen ' + root + (moves.length ? ' moves ' + moves.join(' ') : ''));
        const tGo = performance.now();
        // maxMs: межа часу на одну позицію (якщо глибину не досягнуто - береться те, що встиг порахувати)
        w.postMessage('go depth ' + depth + (this.maxMs ? ' movetime ' + this.maxMs : ''));
        const bm = await done;
        const spent = performance.now() - tGo;
        this.searchMs = (this.searchMs || 0) + spent;                        // скільки часу рахував сам рушій
        this.slowestMs = Math.max(this.slowestMs || 0, spent);
        const res = infos.filter(x => x && x.cp !== undefined);
        if (!res.length) {
          const m = bm.split(' ')[1];
          return [{ cp: 0, pv: m && m !== '(none)' ? [m] : [], depth: 0 }];
        }
        return res;
      } finally {
        this.listeners.delete(onLine);
      }
    });
  }
}
