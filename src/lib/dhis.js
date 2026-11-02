// DHIS2 conventions: 11-character UIDs, period codes, and indicator expressions.

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALNUM = LETTERS + '0123456789';
export const UID_RE = /^[A-Za-z][A-Za-z0-9]{10}$/;

// Same shape as DHIS2's CodeGenerator: a letter followed by 10 letters/digits.
export function dhisUid() {
  const b = crypto.getRandomValues(new Uint8Array(11));
  let s = LETTERS[b[0] % LETTERS.length];
  for (let i = 1; i < 11; i++) s += ALNUM[b[i] % ALNUM.length];
  return s;
}

// ---------- periods ----------
export const MONTH_RE = /^(\d{4})(0[1-9]|1[0-2])$/;
export const QUARTER_RE = /^(\d{4})Q([1-4])$/;
export const YEAR_RE = /^(\d{4})$/;

export function periodType(pe) {
  if (MONTH_RE.test(pe)) return 'MONTH';
  if (QUARTER_RE.test(pe)) return 'QUARTER';
  if (YEAR_RE.test(pe)) return 'YEAR';
  return null;
}

// Months (YYYYMM) that make up a period.
export function monthsOf(pe) {
  let m;
  if ((m = MONTH_RE.exec(pe))) return [pe];
  if ((m = QUARTER_RE.exec(pe))) {
    const q = Number(m[2]);
    return [1, 2, 3].map((i) => `${m[1]}${String((q - 1) * 3 + i).padStart(2, '0')}`);
  }
  if ((m = YEAR_RE.exec(pe))) return Array.from({ length: 12 }, (_, i) => `${m[1]}${String(i + 1).padStart(2, '0')}`);
  return [];
}

export function nextPeriod(pe) {
  let m;
  if ((m = MONTH_RE.exec(pe))) {
    const y = Number(m[1]); const mo = Number(m[2]);
    return mo === 12 ? `${y + 1}01` : `${y}${String(mo + 1).padStart(2, '0')}`;
  }
  if ((m = QUARTER_RE.exec(pe))) {
    const y = Number(m[1]); const q = Number(m[2]);
    return q === 4 ? `${y + 1}Q1` : `${y}Q${q + 1}`;
  }
  if ((m = YEAR_RE.exec(pe))) return String(Number(m[1]) + 1);
  return null;
}

// Inclusive list of periods from start to end (same type), capped to avoid runaway requests.
export function periodRange(start, end, max = 60) {
  const t = periodType(start);
  if (!t || t !== periodType(end)) return null;
  const out = [];
  let p = start;
  while (out.length < max) {
    out.push(p);
    if (p === end) return out;
    p = nextPeriod(p);
  }
  return null;
}

export function periodName(pe) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let m;
  if ((m = MONTH_RE.exec(pe))) return `${months[Number(m[2]) - 1]} ${m[1]}`;
  if ((m = QUARTER_RE.exec(pe))) return `Q${m[2]} ${m[1]}`;
  return pe;
}

// Current reporting month in Nigeria (UTC+1): the month just ended.
export function lastCompletedMonth(ms = Date.now()) {
  const d = new Date(ms + 3600000);
  const y = d.getUTCFullYear(); const mo = d.getUTCMonth() + 1;
  return mo === 1 ? `${y - 1}12` : `${y}${String(mo - 1).padStart(2, '0')}`;
}

// ---------- indicator expressions ----------
// Supported: #{dataElementUid}, numbers, + - * / and parentheses (a safe subset of DHIS2 syntax).
const TOKEN_RE = /\s*(#\{([A-Za-z][A-Za-z0-9]{10})\}|\d+(?:\.\d+)?|[-+*/()])/y;

export function parseExpression(src) {
  const s = String(src || '').trim();
  if (!s) throw new Error('Expression is empty');
  const tokens = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < s.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(s);
    if (!m) throw new Error(`Unexpected text at “${s.slice(pos, pos + 12)}”`);
    tokens.push(m[2] ? { t: 'de', id: m[2] } : /\d/.test(m[1][0]) ? { t: 'num', v: Number(m[1]) } : { t: 'op', v: m[1] });
    pos = TOKEN_RE.lastIndex;
    while (pos < s.length && s[pos] === ' ') pos++;
  }
  let i = 0;
  const peek = () => tokens[i];
  function primary() {
    const tk = tokens[i++];
    if (!tk) throw new Error('Expression ends too early');
    if (tk.t === 'num') return { k: 'num', v: tk.v };
    if (tk.t === 'de') return { k: 'de', id: tk.id };
    if (tk.v === '(') { const e = sum(); if (!peek() || peek().v !== ')') throw new Error('Missing “)”'); i++; return e; }
    if (tk.v === '-') return { k: 'neg', a: primary() };
    throw new Error(`Unexpected “${tk.v}”`);
  }
  function product() {
    let a = primary();
    while (peek() && (peek().v === '*' || peek().v === '/')) { const op = tokens[i++].v; a = { k: op, a, b: primary() }; }
    return a;
  }
  function sum() {
    let a = product();
    while (peek() && (peek().v === '+' || peek().v === '-')) { const op = tokens[i++].v; a = { k: op, a, b: product() }; }
    return a;
  }
  const tree = sum();
  if (i !== tokens.length) throw new Error(`Unexpected “${tokens[i].v}”`);
  const ids = [...new Set(tokens.filter((t) => t.t === 'de').map((t) => t.id))];
  return { tree, ids };
}

// Evaluates with values[deId]; a data element with no value counts as 0 (DHIS2 "skip missing" off).
export function evaluate(tree, values) {
  switch (tree.k) {
    case 'num': return tree.v;
    case 'de': return Number(values[tree.id] ?? 0);
    case 'neg': return -evaluate(tree.a, values);
    case '+': return evaluate(tree.a, values) + evaluate(tree.b, values);
    case '-': return evaluate(tree.a, values) - evaluate(tree.b, values);
    case '*': return evaluate(tree.a, values) * evaluate(tree.b, values);
    case '/': { const d = evaluate(tree.b, values); return d === 0 ? NaN : evaluate(tree.a, values) / d; }
    default: throw new Error('bad expression');
  }
}

// ---------- reporting frequency ----------
export const FREQUENCIES = { MONTHLY: 'MONTH', QUARTERLY: 'QUARTER', YEARLY: 'YEAR' };
export const FREQUENCY_NAMES = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', YEARLY: 'Yearly' };

export function periodMatches(pe, frequency) {
  return periodType(pe) === FREQUENCIES[frequency];
}

// The reporting periods of a data set that fall inside an analysis period (e.g. 2026Q1 for a
// monthly data set -> 202601..202603). Empty when the frequency is coarser than the period.
export function periodsWithin(pe, frequency) {
  const t = periodType(pe);
  const want = FREQUENCIES[frequency];
  if (!t || !want) return [];
  if (t === want) return [pe];
  const months = monthsOf(pe);
  if (want === 'MONTH') return months;
  if (want === 'QUARTER' && t === 'YEAR') return [1, 2, 3, 4].map((q) => `${pe}Q${q}`);
  return [];
}

// Last day of a period, as YYYY-MM-DD.
function lastMonthOf(pe) { const m = monthsOf(pe); return m[m.length - 1]; }

// Due date: the given day of the month after the period ends (UTC ms at 23:59:59 West Africa Time).
export function dueAt(pe, dueDay) {
  const lm = lastMonthOf(pe);
  if (!lm) return null;
  let y = Number(lm.slice(0, 4)); let m = Number(lm.slice(4)) + 1;
  if (m === 13) { m = 1; y++; }
  return Date.UTC(y, m - 1, dueDay, 22, 59, 59);
}

// The most recent period of this frequency that has fully ended (Nigeria time, UTC+1).
export function lastCompletedPeriod(frequency, ms = Date.now()) {
  const d = new Date(ms + 3600000);
  const y = d.getUTCFullYear(); const mo = d.getUTCMonth() + 1;
  if (frequency === 'YEARLY') return String(y - 1);
  if (frequency === 'QUARTERLY') { const q = Math.ceil(mo / 3) - 1; return q === 0 ? `${y - 1}Q4` : `${y}Q${q}`; }
  return mo === 1 ? `${y - 1}12` : `${y}${String(mo - 1).padStart(2, '0')}`;
}

// Recent periods to offer in the data-entry period picker, newest first.
export function recentPeriods(frequency, count = 12, ms = Date.now()) {
  const out = [];
  let p = lastCompletedPeriod(frequency, ms);
  const prev = (pe) => {
    let m;
    if ((m = MONTH_RE.exec(pe))) { const yy = Number(m[1]); const mm = Number(m[2]); return mm === 1 ? `${yy - 1}12` : `${yy}${String(mm - 1).padStart(2, '0')}`; }
    if ((m = QUARTER_RE.exec(pe))) { const yy = Number(m[1]); const q = Number(m[2]); return q === 1 ? `${yy - 1}Q4` : `${yy}Q${q - 1}`; }
    return String(Number(pe) - 1);
  };
  while (out.length < count) { out.push(p); p = prev(p); }
  return out;
}
