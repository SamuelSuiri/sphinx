// WCAG contrast for the site's text/background token pairs. Run: node contrast.mjs
const lum = hex => { const c = hex.match(/\w\w/g).map(x => parseInt(x, 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = {
  light: [['ink', '#121b2e', '#f5f7fb'], ['muted', '#4a5568', '#f5f7fb'], ['muted on surface', '#4a5568', '#ffffff'], ['accent text', '#2448d1', '#ffffff'], ['accent text on evidence', '#2448d1', '#e9efff'], ['on-accent button', '#ffffff', '#315cf5'],
    ['add on add-bg', '#1a7f37', '#e6f6ea'], ['del on del-bg', '#b42318', '#fdecea'], ['ink on add-bg', '#121b2e', '#e6f6ea'], ['miss', '#8a4300', '#fff3e0'], ['muted line numbers on evidence', '#4a5568', '#e9efff'], ['ink on evidence', '#121b2e', '#e9efff'],
    ['chrome ink', '#e6ebf5', '#111b32'], ['chrome muted', '#a9b4cc', '#111b32'], ['chrome muted on files', '#a9b4cc', '#1a2643'], ['chrome add', '#6fd08c', '#111b32'], ['chrome del', '#ff9a8f', '#111b32'], ['file add', '#6fd08c', '#1a2643'], ['file del', '#ff9a8f', '#1a2643'], ['rel mark', '#8fa8ff', '#2a3a66'], ['selected file', '#e6ebf5', '#2a3a66']],
  dark: [['ink', '#e6ebf5', '#0b1222'], ['muted', '#a9b4cc', '#0b1222'], ['muted on surface', '#a9b4cc', '#121b2e'], ['accent text', '#8fa8ff', '#121b2e'], ['accent text on evidence', '#8fa8ff', '#1c2b57'], ['on-accent button', '#ffffff', '#315cf5'],
    ['add on add-bg', '#6fd08c', '#0f2a1a'], ['del on del-bg', '#ff9a8f', '#3a1517'], ['ink on add-bg', '#e6ebf5', '#0f2a1a'], ['miss', '#ffb866', '#33230d'], ['muted line numbers on evidence', '#a9b4cc', '#1c2b57'], ['ink on evidence', '#e6ebf5', '#1c2b57'], ['chrome muted', '#a9b4cc', '#070d1a']],
};
let fail = 0;
for (const [scheme, list] of Object.entries(pairs)) for (const [name, fg, bg] of list) { const r = ratio(fg, bg); if (r < 4.5) fail++; console.log(scheme.padEnd(6), name.padEnd(32), r.toFixed(2), r >= 4.5 ? 'AA' : 'FAIL'); }
process.exitCode = fail ? 1 : 0;
