// 21300000 -> "21.3M", 12500 -> "12.5k", 830 -> "830"
export function fmtCompact(n) {
  if (!Number.isFinite(n)) return '?';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  const f = (v, u) => s + v.toFixed(1).replace(/\.0$/, '') + u;
  if (a >= 1e9) return f(a / 1e9, 'B');
  if (a >= 1e6) return f(a / 1e6, 'M');
  if (a >= 1e3) return f(a / 1e3, 'k');
  return s + Math.round(a);
}
