/**
 * 后台共用主题：一套 CSS 变量 + 日/夜切换脚本。
 *
 * 之前的做法是每个页面各写一份深色样式，只有公告页另带一套浅色变量，
 * 于是「统计页切成日间」根本不会变色（写死了 #0f172a 这类颜色）。
 * 现在所有页面统一引用这份样式：颜色只出现在 :root 变量里，
 * 具体规则一律用 var(--x)，切主题只改 data-theme 属性。
 *
 * 主题选择记在 localStorage（键 `qmai-admin-theme`），默认跟随系统。
 */

export const ADMIN_THEME_KEY = "qmai-admin-theme"

/** 页面公共样式（含日/夜两套变量、开关按钮、所有后台组件）。 */
export const BASE_CSS = `
  :root {
    color-scheme: dark;
    --bg: #0f172a;
    --surface: #111827;
    --surface-2: #1e293b;
    --surface-3: #273449;
    --border: #334155;
    --border-soft: #1f2937;
    --fg: #e2e8f0;
    --fg-strong: #f8fafc;
    --fg-2: #cbd5e1;
    --muted: #94a3b8;
    --muted-2: #64748b;
    --accent: #38bdf8;
    --accent-hover: #7dd3fc;
    --accent-ink: #0b1220;
    --ok: #4ade80;
    --danger: #f87171;
    --metric-2: #c084fc;
    --metric-3: #fbbf24;
    --metric-4: #2dd4bf;
    --notice-border: #14532d;
    --notice-bg: #052e16;
    --shadow: 0 6px 24px rgba(2, 6, 23, 0.45);
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --bg: #f1f5f9;
    --surface: #ffffff;
    --surface-2: #f8fafc;
    --surface-3: #e2e8f0;
    --border: #cbd5e1;
    --border-soft: #e2e8f0;
    --fg: #0f172a;
    --fg-strong: #020617;
    --fg-2: #1e293b;
    --muted: #52627a;
    --muted-2: #64748b;
    --accent: #0284c7;
    --accent-hover: #0369a1;
    --accent-ink: #ffffff;
    --ok: #15803d;
    --danger: #dc2626;
    --metric-2: #7c3aed;
    --metric-3: #b45309;
    --metric-4: #0f766e;
    --notice-border: #86efac;
    --notice-bg: #f0fdf4;
    --shadow: 0 6px 24px rgba(15, 23, 42, 0.12);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--fg);
    padding: 2rem;
    min-height: 100vh;
  }
  body.centered { display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
  main { max-width: 1100px; margin: 0 auto; }
  main.narrow { max-width: 430px; }
  h1 { margin-bottom: 0.35rem; color: var(--fg-strong); font-size: 1.6rem; }
  h2 { margin: 2rem 0 1rem; color: var(--fg-2); font-size: 1.05rem; }
  .subtle { color: var(--muted); font-size: 0.9rem; }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1rem; margin-top: 1.25rem; }
  .card { background: var(--surface); border-radius: 8px; padding: 1.25rem; border: 1px solid var(--border); }
  .card .number { font-size: 2.2rem; font-weight: 700; color: var(--accent); }
  .card .label { margin-top: 0.35rem; color: var(--muted); font-size: 0.9rem; }
  .online .number { color: var(--ok); }
  .activity .number { color: var(--metric-2); }
  .retention .number { color: var(--metric-3); }
  .adopt .number { color: var(--metric-4); }
  .na { font-size: 1.1rem; color: var(--muted-2); font-weight: 500; }

  .panel { overflow: hidden; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.85rem; border-bottom: 1px solid var(--border-soft); text-align: left; vertical-align: top; font-size: 0.9rem; }
  th { color: var(--muted); background: var(--surface-2); font-weight: 600; }
  .empty { color: var(--muted-2); text-align: center; padding: 0.75rem; }

  .bar-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.55rem 0.85rem; border-bottom: 1px solid var(--border-soft); font-size: 0.9rem; }
  .bar-row:last-child { border-bottom: none; }
  .bar-label { width: 130px; flex: none; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { flex: 1; height: 8px; background: var(--surface-3); border-radius: 999px; overflow: hidden; }
  .bar-fill { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
  .bar-value { width: 110px; flex: none; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }

  .footer { margin-top: 1.5rem; color: var(--muted-2); font-size: 0.8rem; line-height: 1.7; }
  .topbar { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .topbar-actions { display: flex; gap: 1rem; align-items: center; }
  .topbar a { color: var(--muted); font-size: 0.85rem; text-decoration: none; border-bottom: 1px solid var(--border); }
  .topbar a:hover { color: var(--fg); }
  .notice { margin-top: 1rem; padding: 0.7rem 1rem; border-radius: 6px; border: 1px solid var(--notice-border); background: var(--notice-bg); color: var(--ok); font-size: 0.85rem; }

  .box { width: 100%; max-width: 380px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.75rem; box-shadow: var(--shadow); }
  .hint, .error { font-size: 0.85rem; margin-bottom: 1.25rem; color: var(--muted); line-height: 1.6; }
  .error { color: var(--danger); }
  .tip { margin-top: 1.25rem; font-size: 0.75rem; color: var(--muted-2); line-height: 1.7; }
  .back { display: block; margin-top: 1rem; text-align: center; color: var(--muted); font-size: 0.8rem; text-decoration: none; }
  .back:hover { color: var(--fg); }

  label { display: block; color: var(--muted); font-size: 0.82rem; margin: 0.9rem 0 0.35rem; }
  label:first-of-type { margin-top: 0; }
  input[type=text], input[type=password], textarea {
    width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    color: var(--fg); padding: 0.6rem 0.7rem; font: inherit; font-size: 0.92rem;
  }
  textarea { min-height: 150px; resize: vertical; font-family: ui-monospace, Consolas, monospace; line-height: 1.6; }
  input:focus, textarea:focus { outline: none; border-color: var(--accent); }

  button {
    font: inherit; font-size: 0.9rem; border-radius: 6px; border: 1px solid var(--border);
    background: var(--surface-2); color: var(--fg); padding: 0.5rem 0.9rem; cursor: pointer;
  }
  button:hover { background: var(--surface-3); }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
  button.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  button.wide { width: 100%; margin-top: 1rem; padding: 0.7rem; border: none; font-weight: 600; font-size: 0.95rem; background: var(--accent); color: var(--accent-ink); }
  button.wide:hover { background: var(--accent-hover); }
  button.link { background: none; border: none; color: var(--muted); padding: 0.2rem 0.3rem; font-size: 0.85rem; }
  button.link:hover { background: none; color: var(--fg); }
  button.danger { color: var(--danger); }

  fieldset { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); padding: 1.25rem; }
  legend { padding: 0 0.4rem; color: var(--muted); font-size: 0.85rem; }
  .row { display: flex; align-items: center; gap: 0.75rem; margin-top: 1rem; flex-wrap: wrap; }
  .check { display: flex; align-items: center; gap: 0.4rem; color: var(--muted); font-size: 0.85rem; margin: 0; }
  #status { margin-left: auto; color: var(--muted); font-size: 0.85rem; }
  #status.ok { color: var(--ok); }
  #status.err { color: var(--danger); }
  ul { list-style: none; }
  li { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); padding: 0.9rem 1rem; margin-bottom: 0.75rem; }
  .title { display: flex; align-items: baseline; gap: 0.5rem; }
  .title strong { font-size: 0.95rem; }
  .tag { font-size: 0.72rem; color: var(--ok); background: color-mix(in srgb, var(--ok) 16%, transparent); border-radius: 999px; padding: 0.05rem 0.5rem; }
  .meta { color: var(--muted-2); font-size: 0.78rem; margin-top: 0.3rem; word-break: break-all; }
  code { background: var(--bg); border-radius: 4px; padding: 0.05rem 0.3rem; font-family: ui-monospace, Consolas, monospace; font-size: 0.8rem; }

  .theme-toggle {
    font: inherit; font-size: 0.82rem; line-height: 1.4;
    background: var(--surface-2); color: var(--muted);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 0.25rem 0.6rem; cursor: pointer;
  }
  .theme-toggle:hover { background: var(--surface-3); color: var(--fg); }
  .theme-toggle-floating { position: fixed; top: 1rem; right: 1rem; z-index: 20; }
`

/** 顶栏里的切换按钮（有顶栏的页面用它）。 */
export const THEME_TOGGLE = `<button type="button" class="theme-toggle" data-theme-toggle>☾ 夜间</button>`

/**
 * 主题脚本：必须在 <head> 里同步执行（避免先闪一下深色再切浅色），
 * 错误地放在 body 末尾会在切到日间时出现一帧白闪。
 */
export const THEME_SCRIPT = `<script>
(function () {
  var KEY = '${ADMIN_THEME_KEY}';
  var root = document.documentElement;
  function preferred() {
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (error) {}
    if (saved === 'light' || saved === 'dark') return saved;
    var query = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    return query && query.matches ? 'light' : 'dark';
  }
  function paint(theme) {
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].textContent = theme === 'dark' ? '☀ 日间' : '☾ 夜间';
      buttons[i].setAttribute('aria-label', theme === 'dark' ? '切换到日间模式' : '切换到夜间模式');
      buttons[i].setAttribute('title', theme === 'dark' ? '切换到日间模式' : '切换到夜间模式');
    }
  }
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    paint(theme);
  }
  window.__qmAdminToggleTheme = function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (error) {}
    apply(next);
  };
  apply(preferred());
  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node !== document.body) {
      if (node.getAttribute && node.hasAttribute('data-theme-toggle')) {
        event.preventDefault();
        window.__qmAdminToggleTheme();
        return;
      }
      node = node.parentNode;
    }
  });
  document.addEventListener('DOMContentLoaded', function () {
    // 登录页 / 改密码页没有顶栏：自动补一个右上角浮动按钮
    if (!document.querySelector('[data-theme-toggle]')) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-toggle theme-toggle-floating';
      button.setAttribute('data-theme-toggle', '');
      document.body.appendChild(button);
    }
    apply(root.getAttribute('data-theme') || preferred());
  });
})();
</script>`
