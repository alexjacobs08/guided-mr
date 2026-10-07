import type { Guide } from '../types'

// The page is static: the guide rides along as JSON and the script below draws it.
// diff2html and Mermaid load from jsDelivr; without them the page falls back to plain diffs.
export function renderHtml(guide: Guide): string {
  const data = JSON.stringify({ ...guide, diagram: guide.diagram ?? '' }).replace(/</g, '\\u003c')
  const title = guide.title.replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Guided MR</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/diff2html@3/bundles/css/diff2html.min.css">
<script src="https://cdn.jsdelivr.net/npm/diff2html@3/bundles/js/diff2html-ui.min.js"></script>
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <div class="brand"><span class="dot"></span>Guided MR</div>
  <div class="progress"><div class="progress-fill" id="progress-fill"></div></div>
  <div class="progress-label" id="progress-label"></div>
  <div class="controls">
    <button id="toggle-layout" title="s">Side by side</button>
    <button id="expand-all">Expand all</button>
  </div>
</header>
<div class="layout">
  <nav class="rail" id="rail"></nav>
  <main id="main"></main>
</div>
<div class="keys"><kbd>j</kbd>/<kbd>k</kbd> step <kbd>x</kbd> reviewed <kbd>s</kbd> layout</div>
<script id="guide-data" type="application/json">${data}</script>
<script>${SCRIPT}</script>
<script type="module">
  const el = document.getElementById('diagram');
  if (el) {
    try {
      const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
      const dark = matchMedia('(prefers-color-scheme: dark)').matches;
      mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'strict', themeVariables: dark
        ? { background: '#171a23', primaryColor: '#232838', primaryTextColor: '#e6e8ef', primaryBorderColor: '#e8875b', lineColor: '#7aa2f7', fontFamily: 'Inter, system-ui, sans-serif' }
        : { background: '#ffffff', primaryColor: '#fff4ee', primaryTextColor: '#1d2030', primaryBorderColor: '#d9703f', lineColor: '#3d6fd9', fontFamily: 'Inter, system-ui, sans-serif' } });
      const { svg } = await mermaid.render('guide-diagram', el.dataset.source);
      el.innerHTML = svg;
    } catch (error) {
      el.classList.add('diagram-fallback');
    }
  }
</script>
</body>
</html>
`
}

const CSS = `
:root {
  --bg: #0f1117; --panel: #171a23; --panel-2: #1e2230; --line: #2a2f40; --text: #e6e8ef; --muted: #8b91a7;
  --accent: #e8875b; --accent-soft: rgba(232,135,91,.14); --blue: #7aa2f7; --green: #9ece6a; --red: #f7768e; --amber: #e0af68;
  --radius: 14px; --mono: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace;
  --sans: Inter, "SF Pro Text", system-ui, -apple-system, sans-serif;
}
@media (prefers-color-scheme: light) {
  :root { --bg: #f6f5f2; --panel: #ffffff; --panel-2: #f1efe9; --line: #e3e0d8; --text: #1d2030; --muted: #6b6f80;
    --accent: #d9703f; --accent-soft: rgba(217,112,63,.10); --blue: #3d6fd9; --green: #2f8a3a; --red: #c8364f; --amber: #a86b00; }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 76px; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
body::before { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: -1;
  background: radial-gradient(900px 500px at 85% -10%, var(--accent-soft), transparent 60%),
              radial-gradient(700px 400px at -10% 20%, rgba(122,162,247,.08), transparent 60%); }
code { font-family: var(--mono); font-size: .88em; background: var(--panel-2); border: 1px solid var(--line); padding: .05em .4em; border-radius: 6px; }

.topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 18px; padding: 12px 28px;
  background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
.brand { font-weight: 700; letter-spacing: .02em; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 12px var(--accent); }
.progress { flex: 1; height: 6px; border-radius: 99px; background: var(--panel-2); overflow: hidden; }
.progress-fill { height: 100%; width: 0; background: linear-gradient(90deg, var(--accent), var(--amber)); transition: width .4s ease; }
.progress-label { color: var(--muted); font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.controls { display: flex; gap: 8px; }
button { font: inherit; font-size: 13px; color: var(--text); background: var(--panel); border: 1px solid var(--line);
  border-radius: 9px; padding: 6px 12px; cursor: pointer; transition: border-color .15s, background .15s; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
button.done { background: transparent; border-color: var(--green); color: var(--green); }

.layout { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 32px; max-width: 1500px; margin: 0 auto; padding: 28px; }
.rail { position: sticky; top: 76px; align-self: start; max-height: calc(100vh - 100px); overflow: auto; }
.rail a { display: grid; grid-template-columns: 30px 1fr; gap: 10px; align-items: start; padding: 10px 12px; margin-bottom: 4px;
  border-radius: 12px; color: var(--text); text-decoration: none; border: 1px solid transparent; transition: background .15s; }
.rail a:hover { background: var(--panel); }
.rail a.active { background: var(--panel); border-color: var(--line); box-shadow: inset 3px 0 0 var(--accent); }
.rail .t { font-size: 13.5px; line-height: 1.35; font-weight: 550; }
.rail .meta { display: block; font-size: 12px; color: var(--muted); margin-top: 4px; }
.badge { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 13px;
  background: var(--accent-soft); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); }
.reviewed .badge { background: color-mix(in srgb, var(--green) 18%, transparent); color: var(--green); border-color: color-mix(in srgb, var(--green) 45%, transparent); }
.bar { display: inline-block; vertical-align: middle; width: 60px; height: 5px; border-radius: 99px; background: var(--panel-2); overflow: hidden; margin-left: 6px; }
.bar i { display: block; height: 100%; background: var(--blue); border-radius: 99px; }

.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px 28px; margin-bottom: 24px;
  box-shadow: 0 1px 0 rgba(255,255,255,.03) inset, 0 10px 30px -18px rgba(0,0,0,.5); }
.hero .kicker { text-transform: uppercase; letter-spacing: .14em; font-size: 12px; color: var(--accent); font-weight: 700; }
.hero h1 { font-size: 30px; line-height: 1.2; margin: 8px 0 10px; letter-spacing: -.01em; }
.hero p { font-size: 17px; color: var(--muted); margin: 0 0 18px; max-width: 75ch; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { font-size: 12.5px; padding: 4px 10px; border-radius: 99px; background: var(--panel-2); border: 1px solid var(--line); color: var(--muted); }
.chip.add { color: var(--green); } .chip.del { color: var(--red); }
.section-title { font-size: 12px; text-transform: uppercase; letter-spacing: .14em; color: var(--muted); font-weight: 700; margin: 0 0 14px; }
#diagram { display: flex; justify-content: center; overflow-x: auto; }
#diagram svg { max-width: 100%; height: auto; }
.diagram-fallback { white-space: pre; font-family: var(--mono); font-size: 13px; color: var(--muted); justify-content: flex-start !important; }

.step { scroll-margin-top: 80px; }
.step-head { display: flex; gap: 16px; align-items: flex-start; }
.step-head .badge { width: 40px; height: 40px; font-size: 17px; flex: none; }
.step-head h2 { font-size: 21px; line-height: 1.3; margin: 6px 0 0; flex: 1; letter-spacing: -.005em; }
.summary { margin: 14px 0 0 56px; max-width: 80ch; }
.watch { margin: 14px 0 0 56px; padding: 10px 14px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--amber) 40%, transparent);
  background: color-mix(in srgb, var(--amber) 9%, transparent); color: var(--amber); font-size: 14px; }
.watch b { margin-right: 6px; }
.files { margin: 14px 0 0 56px; }
.diffs { margin-top: 20px; }
.diff-wrap { position: relative; border-radius: 12px; overflow: hidden; border: 1px solid var(--line); margin-bottom: 14px; }
.diff-wrap.collapsed { max-height: 520px; }
.diff-wrap.collapsed::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 90px; background: linear-gradient(transparent, var(--panel)); }
.expand { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); z-index: 2; }
.note { margin-bottom: 14px; padding: 10px 14px; border-radius: 10px; background: var(--panel-2); color: var(--muted); font-style: italic; }
.note b { font-style: normal; color: var(--blue); font-family: var(--mono); font-weight: 500; margin-right: 8px; }
pre.plain { margin: 0; padding: 12px 0; font: 12.5px/1.55 var(--mono); overflow-x: auto; background: var(--panel-2); }
pre.plain span { display: block; padding: 0 14px; white-space: pre; }
pre.plain .a { background: color-mix(in srgb, var(--green) 14%, transparent); }
pre.plain .d { background: color-mix(in srgb, var(--red) 14%, transparent); }
pre.plain .h { color: var(--blue); }
.d2h-wrapper .d2h-file-wrapper { border: 0; margin: 0; border-radius: 0; }
.d2h-file-header { font-family: var(--mono); }
.keys { position: fixed; right: 18px; bottom: 16px; font-size: 12px; color: var(--muted); background: var(--panel); border: 1px solid var(--line);
  border-radius: 10px; padding: 6px 10px; }
kbd { font-family: var(--mono); font-size: 11px; padding: 1px 6px; border-radius: 5px; border: 1px solid var(--line); background: var(--panel-2); margin: 0 2px; }
@media (max-width: 960px) { .layout { grid-template-columns: 1fr; } .rail { position: static; max-height: none; } }
`

const SCRIPT = `
(function () {
  var guide = JSON.parse(document.getElementById('guide-data').textContent);
  var storeKey = 'guided-mr:' + guide.source + ':' + guide.title;
  var reviewed = new Set(JSON.parse(localStorage.getItem(storeKey) || '[]'));
  var sideBySide = localStorage.getItem('guided-mr:layout') !== 'line';
  var byId = {};
  guide.hunks.forEach(function (h) { byId[h.id] = h; });

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function md(s) { return esc(s).replace(/\\x60([^\\x60]+)\\x60/g, '<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>'); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function hunksOf(step) { return step.hunkIds.map(function (id) { return byId[id]; }).filter(Boolean); }
  function sum(list, key) { return list.reduce(function (n, h) { return n + h[key]; }, 0); }

  var sizes = guide.steps.map(function (s) { var h = hunksOf(s); return sum(h, 'added') + sum(h, 'removed'); });
  var maxSize = Math.max.apply(null, [1].concat(sizes));
  var main = document.getElementById('main');
  var rail = document.getElementById('rail');

  var files = new Set(guide.hunks.map(function (h) { return h.path; })).size;
  var hero = el('section', 'card hero');
  hero.innerHTML = '<div class="kicker">Guided review</div><h1>' + esc(guide.title) + '</h1><p>' + md(guide.context) + '</p>' +
    '<div class="chips"><span class="chip">' + esc(guide.source) + '</span><span class="chip">' + guide.steps.length + ' steps</span>' +
    '<span class="chip">' + files + ' files</span><span class="chip add">+' + sum(guide.hunks, 'added') + '</span>' +
    '<span class="chip del">\\u2212' + sum(guide.hunks, 'removed') + '</span></div>';
  main.appendChild(hero);

  if (guide.diagram) {
    var d = el('section', 'card');
    d.appendChild(el('div', 'section-title', 'How the pieces connect'));
    var holder = el('div');
    holder.id = 'diagram';
    holder.dataset.source = guide.diagram;
    holder.textContent = guide.diagram;
    d.appendChild(holder);
    main.appendChild(d);
  }

  function diffText(hunks) {
    var byPath = [], groups = {};
    hunks.forEach(function (h) {
      if (h.note) return;
      if (!groups[h.path]) { groups[h.path] = []; byPath.push(h.path); }
      groups[h.path].push(h);
    });
    return byPath.map(function (p) {
      return 'diff --git a/' + p + ' b/' + p + '\\n--- a/' + p + '\\n+++ b/' + p + '\\n' +
        groups[p].map(function (h) { return h.source; }).join('\\n');
    });
  }

  function drawPlain(target, text) {
    var pre = el('pre', 'plain');
    text.split('\\n').forEach(function (line) {
      var s = el('span', line[0] === '+' && !line.startsWith('+++') ? 'a' : line[0] === '-' && !line.startsWith('---') ? 'd' : line.startsWith('@@') ? 'h' : '');
      s.textContent = line || ' ';
      pre.appendChild(s);
    });
    target.appendChild(pre);
  }

  function drawDiffs(container, step) {
    container.innerHTML = '';
    hunksOf(step).filter(function (h) { return h.note; }).forEach(function (h) {
      container.appendChild(el('div', 'note', '<b>' + esc(h.path) + '</b>' + esc(h.note)));
    });
    diffText(hunksOf(step)).forEach(function (text) {
      var wrap = el('div', 'diff-wrap');
      var target = el('div');
      wrap.appendChild(target);
      container.appendChild(wrap);
      if (window.Diff2HtmlUI) {
        var ui = new Diff2HtmlUI(target, text, { drawFileList: false, matching: 'lines', highlight: true, colorScheme: 'auto',
          outputFormat: sideBySide ? 'side-by-side' : 'line-by-line', fileContentToggle: false, synchronisedScroll: true });
        ui.draw();
        ui.highlightCode();
      } else {
        drawPlain(target, text);
      }
      requestAnimationFrame(function () {
        if (wrap.scrollHeight > 640) {
          wrap.classList.add('collapsed');
          var b = el('button', 'expand', 'Show all ' + text.split('\\n').length + ' lines');
          b.onclick = function () { wrap.classList.remove('collapsed'); b.remove(); };
          wrap.appendChild(b);
        }
      });
    });
  }

  var sections = [];
  guide.steps.forEach(function (step, i) {
    var hunks = hunksOf(step);
    var paths = Array.from(new Set(hunks.map(function (h) { return h.path; })));
    var s = el('section', 'card step');
    s.id = 'step-' + (i + 1);
    s.innerHTML = '<div class="step-head"><div class="badge">' + (i + 1) + '</div><h2>' + esc(step.title) + '</h2></div>' +
      '<div class="summary">' + md(step.summary) + '</div>' +
      (step.watch ? '<div class="watch"><b>\\u26A0 Check</b>' + md(step.watch) + '</div>' : '') +
      '<div class="files chips">' + paths.map(function (p) { return '<span class="chip"><code>' + esc(p) + '</code></span>'; }).join('') +
      '<span class="chip add">+' + sum(hunks, 'added') + '</span><span class="chip del">\\u2212' + sum(hunks, 'removed') + '</span></div>';
    var btn = el('button');
    btn.onclick = function () { toggleReviewed(i); };
    s.querySelector('.step-head').appendChild(btn);
    var diffs = el('div', 'diffs');
    s.appendChild(diffs);
    main.appendChild(s);
    drawDiffs(diffs, step);

    var link = el('a');
    link.href = '#step-' + (i + 1);
    link.innerHTML = '<div class="badge">' + (i + 1) + '</div><div><span class="t">' + esc(step.title) + '</span>' +
      '<span class="meta">' + paths.length + ' files<span class="bar"><i style="width:' + Math.max(6, Math.round(sizes[i] / maxSize * 100)) + '%"></i></span></span></div>';
    rail.appendChild(link);
    sections.push({ section: s, link: link, button: btn, diffs: diffs, step: step });
  });

  function paint() {
    sections.forEach(function (x, i) {
      var done = reviewed.has(i);
      x.section.classList.toggle('reviewed', done);
      x.link.classList.toggle('reviewed', done);
      x.link.querySelector('.badge').textContent = done ? '\\u2713' : String(i + 1);
      x.section.querySelector('.badge').textContent = done ? '\\u2713' : String(i + 1);
      x.button.className = done ? 'done' : 'primary';
      x.button.textContent = done ? '\\u2713 Reviewed' : 'Mark reviewed';
    });
    var n = guide.steps.length ? reviewed.size / guide.steps.length : 0;
    document.getElementById('progress-fill').style.width = (n * 100) + '%';
    document.getElementById('progress-label').textContent = reviewed.size + ' of ' + guide.steps.length + ' reviewed';
    document.getElementById('toggle-layout').textContent = sideBySide ? 'Unified' : 'Side by side';
  }
  function toggleReviewed(i) {
    if (reviewed.has(i)) reviewed.delete(i); else reviewed.add(i);
    localStorage.setItem(storeKey, JSON.stringify(Array.from(reviewed)));
    paint();
  }
  function toggleLayout() {
    sideBySide = !sideBySide;
    localStorage.setItem('guided-mr:layout', sideBySide ? 'side' : 'line');
    sections.forEach(function (x) { drawDiffs(x.diffs, x.step); });
    paint();
  }
  document.getElementById('toggle-layout').onclick = toggleLayout;
  document.getElementById('expand-all').onclick = function () {
    document.querySelectorAll('.diff-wrap.collapsed').forEach(function (w) { w.classList.remove('collapsed'); });
    document.querySelectorAll('.expand').forEach(function (b) { b.remove(); });
  };

  var active = 0;
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      active = sections.findIndex(function (x) { return x.section === e.target; });
      sections.forEach(function (x, i) { x.link.classList.toggle('active', i === active); });
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  sections.forEach(function (x) { observer.observe(x.section); });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea/i.test(e.target.tagName)) return;
    var go = function (i) { var x = sections[Math.max(0, Math.min(sections.length - 1, i))]; if (x) x.section.scrollIntoView(); };
    if (e.key === 'j' || e.key === 'n') go(active + 1);
    else if (e.key === 'k' || e.key === 'p') go(active - 1);
    else if (e.key === 'x') toggleReviewed(active);
    else if (e.key === 's') toggleLayout();
  });
  paint();
})();
`
