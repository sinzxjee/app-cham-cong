/*
 * schedule-parser.js — đọc lời nhắn/lịch làm tiếng Việt thành danh sách ca.
 * Chạy hoàn toàn trên máy, không phụ thuộc thư viện. Dùng được trong trình duyệt
 * (window.ScheduleParser) và Node (require).
 *
 *   const r = ScheduleParser.parseSchedule(text, { templates, today: '2026-11-20' });
 *   r.shifts  -> [{date,start,end,overnight,breakMinutes,template,source,warnings}]
 *   r.off     -> [{date,source}]   ngày nghỉ
 *   r.ignored -> [chuỗi không hiểu]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScheduleParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ORDER = [1, 2, 3, 4, 5, 6, 0]; // tuần bắt đầu từ thứ Hai
  const WORD_N = { hai: 2, ba: 3, tu: 4, nam: 5, sau: 6, bay: 7 };
  const DEFAULT_TEMPLATES = [
    { name: 'Ca sáng', start: '06:00', end: '14:00' },
    { name: 'Ca chiều', start: '14:00', end: '22:00' },
    { name: 'Ca đêm', start: '22:00', end: '06:00' }
  ];

  const norm = s => String(s).toLowerCase().replace(/đ/g, 'd')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const pad = n => String(n).padStart(2, '0');
  const fmt = m => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
  const parseHM = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const addDays = (d, n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const epochDay = d => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  const monOf = d => addDays(d, -((d.getDay() + 6) % 7));

  const DOWTOK = '(?:thu\\s*(?:[2-7]|hai|ba|tu|nam|sau|bay)|t[2-7]|cn|chu\\s*nhat)';
  const RE_DOW_RANGE = new RegExp('\\b(' + DOWTOK + ')\\s*(?:-|–|—|~|den)\\s*(' + DOWTOK + ')\\b');
  const RE_DOW = new RegExp('\\b' + DOWTOK + '\\b', 'g');
  const RE_DATERANGE = /(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:-|–|—|~|den)\s*(\d{1,2})\s*\/\s*(\d{1,2})/;
  const RE_ISO = /(\d{4})-(\d{1,2})-(\d{1,2})/g;
  const RE_DATE = /(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/g;
  const RE_NGAYTHANG = /ngay\s*(\d{1,2})\s*thang\s*(\d{1,2})/g;
  const T = '(\\d{1,2})(?:\\s*(h|gio|:)\\s*(\\d{2})?)?\\s*(am|pm|sang|chieu|toi|dem)?';
  const RE_RANGE = new RegExp('(?:\\btu\\s+)?' + T + '\\s*(?:-|–|—|~|den)\\s*' + T);
  const RE_BREAK = /nghi\s*(?:giua\s*ca\s*)?(\d+(?:[.,]\d+)?)\s*(p|phut|h|gio)\b/;

  function dowFromToken(tok) {
    tok = tok.replace(/\s+/g, ' ').trim();
    if (tok === 'cn' || tok === 'chu nhat') return 0;
    let m = /^t(\d)$/.exec(tok);
    if (m) return +m[1] - 1;
    m = /^thu ?(\d|hai|ba|tu|nam|sau|bay)$/.exec(tok);
    const v = m[1];
    return (/\d/.test(v) ? +v : WORD_N[v]) - 1;
  }

  function expandDowRange(a, b) {
    const out = []; let i = ORDER.indexOf(a); const j = ORDER.indexOf(b);
    for (let k = 0; k < 7; k++) { out.push(ORDER[i]); if (i === j) break; i = (i + 1) % 7; }
    return out;
  }

  function mkDate(d, m, y, ctx) {
    if (d < 1 || d > 31 || m < 1 || m > 12) return null;
    const ty = ctx.today.getFullYear();
    let year = y === undefined ? ty : (y < 100 ? 2000 + y : y);
    if (y === undefined) {
      const diff = (new Date(ty, m - 1, d, 12) - ctx.today) / 86400000;
      if (diff > 183) year = ty - 1; else if (diff < -183) year = ty + 1;
    }
    const dt = new Date(year, m - 1, d, 12);
    return dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
  }

  function resolveDow(dow, ctx) {
    const idx = ORDER.indexOf(dow);
    if (ctx.anchor) return addDays(ctx.anchor, ((dow - ctx.anchor.getDay()) + 7) % 7);
    if (ctx.weekMode) {
      const base = addDays(monOf(ctx.today), { this: 0, next: 7, prev: -7 }[ctx.weekMode]);
      return addDays(base, idx);
    }
    ctx.usedDefault = true;
    return addDays(ctx.today, ((dow - ctx.today.getDay()) + 7) % 7); // lần gần nhất từ hôm nay
  }

  function toMin(h, sep, m, per, flags) {
    let hh = +h; const mm = m ? +m : 0;
    if (hh > 24 || mm > 59) return null;
    if (per === 'pm' || per === 'chieu' || per === 'toi') { if (hh < 12) hh += 12; }
    else if (per === 'am') { if (hh === 12) hh = 0; }
    else if (per === 'dem') { if (hh === 12) hh = 0; else if (hh >= 6 && hh < 12) hh += 12; }
    if (!sep && !per) flags.bare = true;
    return hh * 60 + mm;
  }

  function parseSegment(s, ctx, templates, snap) {
    const out = { dates: [], days: [], dayRanges: [], range: null, time: null, off: false, tpl: null, breakMin: null, sawWeek: false, warnings: [] };
    let t = ' ' + s + ' ';

    const wm = /tuan\s*(nay|sau|toi|truoc|qua)/.exec(t);
    if (wm) {
      ctx.weekMode = { nay: 'this', sau: 'next', toi: 'next', truoc: 'prev', qua: 'prev' }[wm[1]];
      t = t.replace(wm[0], ' '); out.sawWeek = true;
    }

    t = t.replace(RE_ISO, (_, y, m, d) => { const x = mkDate(+d, +m, +y, ctx); if (x) out.dates.push(x); return ' '; });

    const dr = RE_DATERANGE.exec(t);
    if (dr) {
      const a = mkDate(+dr[1], +dr[2], undefined, ctx), b = mkDate(+dr[3], +dr[4], undefined, ctx);
      if (a && b && b >= a && epochDay(b) - epochDay(a) <= 31) out.range = { a, b };
      t = t.replace(dr[0], ' ');
    }
    t = t.replace(RE_NGAYTHANG, (_, d, m) => { const x = mkDate(+d, +m, undefined, ctx); if (x) out.dates.push(x); return ' '; });
    t = t.replace(RE_DATE, (_, d, m, y) => {
      const x = mkDate(+d, +m, y === undefined ? undefined : +y, ctx);
      if (x) out.dates.push(x); else out.warnings.push('Ngày không hợp lệ: ' + d + '/' + m);
      return ' ';
    });

    const rel = [[/hom nay/, 0], [/ngay mai/, 1], [/hom qua/, -1], [/ngay kia/, 2], [/\bmai\b/, 1]];
    for (const [re, off] of rel) {
      if (re.test(t)) { out.dates.push(addDays(ctx.today, off)); t = t.replace(re, ' '); break; }
    }

    const rg = RE_DOW_RANGE.exec(t);
    if (rg) { out.dayRanges.push(expandDowRange(dowFromToken(rg[1]), dowFromToken(rg[2]))); t = t.replace(rg[0], ' '); }
    t = t.replace(RE_DOW, tok => { out.days.push(dowFromToken(tok)); return ' '; });

    const rm = RE_RANGE.exec(t);
    if (rm) {
      const flags = {};
      const a = toMin(rm[1], rm[2], rm[3], rm[4], flags), b = toMin(rm[5], rm[6], rm[7], rm[8], flags);
      if (a !== null && b !== null) {
        out.time = { start: a, end: b, bare: !!flags.bare };
        t = t.replace(rm[0], ' ');
      }
    }

    const bm = RE_BREAK.exec(t);
    if (bm && out.time) {
      const v = parseFloat(bm[1].replace(',', '.'));
      out.breakMin = /^(h|gio)$/.test(bm[2]) ? Math.round(v * 60) : Math.round(v);
      t = t.replace(bm[0], ' ');
    }

    if (!out.time) {
      let best = null;
      for (const tp of templates) if (t.includes(tp.key) && (!best || tp.key.length > best.key.length)) best = tp;
      if (best) out.tpl = best;
      else { const g = /\bca\s*(sang|chieu|toi|dem)\b/.exec(t); if (g) out.missingTpl = 'ca ' + g[1]; }
    }
    if (!out.time && !out.tpl && /\b(nghi|off)\b/.test(t)) out.off = true;

    out.hasContent = !!(out.time || out.tpl || out.off || out.missingTpl);
    return out;
  }

  function parseSchedule(text, opts) {
    opts = opts || {};
    const today = opts.today ? new Date(opts.today + 'T12:00:00') : (() => { const n = new Date(); n.setHours(12, 0, 0, 0); return n; })();
    const snap = opts.snapMinutes === undefined ? 30 : opts.snapMinutes;
    const templates = (opts.templates || DEFAULT_TEMPLATES).map(t => ({ ...t, key: norm(t.name) }));
    const ctx = { today, weekMode: null, anchor: null };
    const shifts = [], off = [], ignored = [];

    function addEntry(date, r, raw) {
      const warnings = r.warnings.slice();
      if (r.off) { off.push({ date: ymd(date), source: raw }); return; }
      let start, end, tpl = null;
      if (r.time) {
        start = r.time.start; end = r.time.end;
        if (r.time.bare) warnings.push('Giờ không ghi "h" nên được hiểu là ' + fmt(start) + '–' + fmt(end % 1440) + ', hãy kiểm tra');
        if (snap) {
          const s2 = Math.round(start / snap) * snap, e2 = Math.round(end / snap) * snap;
          if (s2 !== start) warnings.push('Giờ vào ' + fmt(start) + ' làm tròn thành ' + fmt(s2 % 1440));
          if (e2 !== end) warnings.push('Giờ ra ' + fmt(end % 1440) + ' làm tròn thành ' + fmt(e2 % 1440));
          start = s2 % 1440; end = e2;
        }
      } else {
        tpl = r.tpl; start = parseHM(tpl.start); end = parseHM(tpl.end);
      }
      if (end <= start) end += 1440;
      const dur = end - start;
      if (dur <= 0) { warnings.push('Giờ vào và giờ ra trùng nhau'); }
      if (dur > 16 * 60) warnings.push('Ca dài hơn 16 giờ, hãy kiểm tra');
      if (dur > 0 && dur < 60) warnings.push('Ca ngắn hơn 1 giờ, hãy kiểm tra');
      shifts.push({
        date: ymd(date), start: fmt(start), end: fmt(end), overnight: end >= 1440,
        breakMinutes: r.breakMin, template: tpl ? tpl.name : null, source: raw, warnings,
        _abs: epochDay(date) * 1440 + start, _dur: dur
      });
    }

    String(text || '').split(/\r?\n/).forEach(line => {
      const clean = line.replace(/^[\s\-•*·]+/, '');
      if (!clean.trim()) return;
      let pending = [];
      clean.split(/[;,]+/).forEach(segRaw => {
        const raw = segRaw.trim(); if (!raw) return;
        const r = parseSegment(norm(raw), ctx, templates, snap);
        const own = [...r.dates, ...r.days.map(d => resolveDow(d, ctx)),
          ...r.dayRanges.flatMap(list => { const f = resolveDow(list[0], ctx); return list.map((_, k) => addDays(f, k)); })];

        if (!r.hasContent) {
          if (r.range && !own.length && epochDay(r.range.b) - epochDay(r.range.a) <= 7) { ctx.anchor = r.range.a; return; }
          if (r.range) { for (let d = r.range.a; d <= r.range.b; d = addDays(d, 1)) pending.push(d); }
          if (own.length) pending.push(...own);
          if (r.range || own.length || r.sawWeek) return;
          ignored.push(raw); return;
        }

        const dates = [...pending, ...own];
        if (r.range) for (let d = r.range.a; d <= r.range.b; d = addDays(d, 1)) dates.push(d);
        pending = [];
        if (!dates.length) { ignored.push(raw + '  (không rõ ngày)'); return; }
        if (r.missingTpl) { ignored.push(raw + '  (chưa có mẫu "' + r.missingTpl + '")'); return; }
        const seen = new Set();
        dates.forEach(d => { const k = ymd(d); if (!seen.has(k)) { seen.add(k); addEntry(d, r, raw); } });
      });
    });

    shifts.sort((a, b) => a._abs - b._abs);
    for (let i = 1; i < shifts.length; i++) {
      const p = shifts[i - 1], c = shifts[i];
      if (c._abs < p._abs + p._dur) {
        c.warnings.push('Trùng giờ với ca ' + p.date + ' ' + p.start + '–' + p.end);
        p.warnings.push('Trùng giờ với ca ' + c.date + ' ' + c.start + '–' + c.end);
      }
    }
    shifts.forEach(s => { delete s._abs; delete s._dur; });
    off.sort((a, b) => a.date.localeCompare(b.date));
    const assumptions = ctx.usedDefault
      ? ['Các thứ trong tuần được hiểu là ngày gần nhất tính từ hôm nay (' + ymd(today) + '). Thêm "tuần sau" hoặc ngày cụ thể nếu cần.']
      : [];
    return { shifts, off, ignored, assumptions };
  }

  return { parseSchedule, DEFAULT_TEMPLATES };
});