/**
 * 青幕AI写作 —— 安装器动效壳：界面控制
 *
 * 职责边界很清楚：
 *   protocol.js  只做"文本 → 状态"的纯计算（可单测）
 *   bridge.js    只做"状态数据从哪来、按钮点了告诉谁"（宿主注入）
 *   app.js       只做"状态 → DOM"（本文件）
 *
 * 所以界面里没有任何业务判断：它不认识安装步骤、不认识错误码含义，
 * 只把 protocol 给出的 state 画出来。
 */
(function () {
  'use strict';

  var P = window.QmaiProtocol;
  var bridge = window.QmaiBridge.create();

  var shell = document.getElementById('shell');
  var acts = Array.prototype.slice.call(document.querySelectorAll('.act'));
  var stepsBox = document.getElementById('steps');
  var ringBar = document.getElementById('ringBar');
  var pctNum = document.getElementById('pctNum');
  var stageLabel = document.getElementById('stageLabel');
  var detailLine = document.getElementById('detailLine');
  var canvas = document.getElementById('fx');
  var ctx = canvas.getContext('2d');
  var modal = document.getElementById('modal');

  var R = 88;
  var C = 2 * Math.PI * R;
  ringBar.style.strokeDasharray = C.toFixed(2);
  ringBar.style.strokeDashoffset = C.toFixed(2);

  var state = P.initial();
  var shownAct = 'welcome';
  var polling = null;
  var lastRenderedPercent = -1;
  var motion = true;

  // 真机里版本号由安装包经命令行传进来（见 shell/src/main.rs）。
  // 预览态没有这个变量，保留 HTML 里的占位值。
  if (typeof window.__QMAI_SETUP_VERSION__ === 'string' && window.__QMAI_SETUP_VERSION__) {
    var verEl = document.getElementById('chromeVer');
    if (verEl) verEl.textContent = 'v' + window.__QMAI_SETUP_VERSION__.replace(/^v/i, '');
  }

  // 安装位置同理：NSIS 已经把算好的 $INSTDIR 传进来了，必须显示真实路径，
  // 不能留 HTML 里那个 %LOCALAPPDATA% 占位——用户会以为装到了别处。
  if (typeof window.__QMAI_SETUP_DIR__ === 'string' && window.__QMAI_SETUP_DIR__) {
    var dirEl = document.getElementById('installPath');
    if (dirEl) dirEl.textContent = window.__QMAI_SETUP_DIR__;
  }

  /* ---------------- 舞台切换 ---------------- */

  function showAct(name) {
    if (shownAct === name) return;
    shownAct = name;
    shell.dataset.act = name;
    acts.forEach(function (el) {
      el.classList.toggle('is-on', el.dataset.act === name);
    });
  }

  /* ---------------- 阶段条 ---------------- */

  var stepEls = P.STAGES.map(function (stage, index) {
    var el = document.createElement('span');
    el.className = 'step';
    el.dataset.status = 'pending';
    el.dataset.index = String(index);
    var badge = document.createElement('span');
    badge.className = 'b';
    badge.textContent = String(index + 1);
    el.appendChild(badge);
    el.appendChild(document.createTextNode(stage.label));
    stepsBox.appendChild(el);
    return el;
  });

  function renderSteps(s) {
    for (var i = 0; i < stepEls.length; i++) {
      var status = P.stageStatus(s, i);
      if (stepEls[i].dataset.status !== status) stepEls[i].dataset.status = status;
    }
  }

  /* ---------------- 渲染 ---------------- */

  function render(s, force) {
    var percent = s.percent;
    if (force || percent !== lastRenderedPercent) {
      lastRenderedPercent = percent;
      ringBar.style.strokeDashoffset = (C * (1 - percent / 100)).toFixed(2);
      pctNum.textContent = String(percent);
    }

    // 进度页的标签：优先用安装段给的，没有就退回阶段名
    var label = s.label || (P.STAGES[Math.min(s.stageIndex, P.STAGES.length - 1)] || {}).label || '';
    if (stageLabel.textContent !== label) stageLabel.textContent = label;

    var detail = s.phase === 'installing' ? s.detail : '';
    if (detailLine.textContent !== detail) detailLine.textContent = detail;

    renderSteps(s);

    if (s.phase === 'idle') showAct('welcome');
    else if (s.phase === 'installing') showAct('installing');
    else if (s.phase === 'done') showAct('done');
    else if (s.phase === 'error') {
      document.getElementById('errCode').textContent = s.error ? s.error.code : 'E0000';
      document.getElementById('errMsg').textContent = s.error && s.error.message ? s.error.message : '安装过程中出现未知错误。';
      showAct('error');
    }
  }

  /* ---------------- 轮询 ---------------- */

  function tick() {
    bridge.readProgress().then(function (text) {
      var result = P.applyContent(state, text);
      if (result.changed) {
        state = result.state;
        render(state, false);
      }
      if (P.isTerminal(state)) stopPolling();
    }).catch(function () {
      // 读不到进度文件是正常情况（安装段还没开始写），不能因此中断界面
    });
  }

  function startPolling() {
    if (polling) return;
    tick();
    polling = setInterval(tick, bridge.pollMs || 200);
  }

  function stopPolling() {
    if (!polling) return;
    clearInterval(polling);
    polling = null;
  }

  /* ---------------- 中止确认 ---------------- */

  function openModal() {
    modal.classList.add('is-on');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('btnModalNo').focus();
  }

  function closeModal() {
    modal.classList.remove('is-on');
    modal.setAttribute('aria-hidden', 'true');
  }

  /* ---------------- 事件 ---------------- */

  document.getElementById('btnStart').addEventListener('click', function () {
    showAct('installing');
    bridge.start();
    startPolling();
  });

  document.getElementById('btnAbort').addEventListener('click', openModal);
  document.getElementById('btnModalNo').addEventListener('click', closeModal);

  document.getElementById('btnModalYes').addEventListener('click', function () {
    closeModal();
    bridge.abort();
    startPolling();
  });

  document.getElementById('btnChromeClose').addEventListener('click', function () {
    if (shownAct === 'installing') { openModal(); return; }
    bridge.cancel();
  });

  // 标题栏拖动。窗口是无边框的（with_decorations(false)），系统不会自动给
  // 拖动能力，必须自己把"在标题栏按下"转成宿主的一次拖动请求。
  // 判定要严：只有左键、且按下处不是按钮，才拖；否则点关闭按钮会变成拖窗口。
  var chromeBar = document.querySelector('.chrome');
  if (chromeBar) {
    chromeBar.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button')) return;
      // 阻止默认行为，避免拖动时选中标题文字
      e.preventDefault();
      bridge.drag();
    });
  }

  document.getElementById('btnLaunch').addEventListener('click', function () {
    bridge.launch();
  });

  document.getElementById('btnFinish').addEventListener('click', function () {
    bridge.cancel();
  });

  document.getElementById('btnRetry').addEventListener('click', function () {
    state = P.initial();
    lastRenderedPercent = -1;
    render(state, true);
    bridge.retry();
  });

  document.getElementById('btnLog').addEventListener('click', function () {
    bridge.openLog();
  });

  document.getElementById('btnClassic').addEventListener('click', function () {
    bridge.useClassic();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (modal.classList.contains('is-on')) { closeModal(); return; }
    if (shownAct === 'installing') { openModal(); return; }
  });

  /* ---------------- 背景粒子（唯一直接画的地方） ---------------- */

  var W = 0, H = 0, DPR = 1, parts = [], rafId = 0;

  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seed();
  }

  function seed() {
    var n = Math.max(18, Math.min(60, Math.round(W * H / 17000)));
    parts = [];
    for (var i = 0; i < n; i++) {
      parts.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.5 + 0.4,
        vx: (Math.random() - 0.5) * 0.10,
        vy: -(Math.random() * 0.22 + 0.05),
        a: Math.random() * 0.42 + 0.12,
        ph: Math.random() * Math.PI * 2,
        sp: Math.random() * 0.8 + 0.35
      });
    }
  }

  function drawParts() {
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.x += p.vx;
      p.y += p.vy;
      p.ph += 0.012 * p.sp;
      if (p.y < -8) { p.y = H + 8; p.x = Math.random() * W; }
      if (p.x < -8) p.x = W + 8;
      if (p.x > W + 8) p.x = -8;
      var alpha = p.a * (0.55 + 0.45 * Math.sin(p.ph));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(111,227,206,' + alpha.toFixed(3) + ')';
      ctx.fill();
    }
  }

  function frame() {
    if (motion) drawParts();
    rafId = requestAnimationFrame(frame);
  }

  /* ---------------- 启动 ---------------- */

  if (window.ResizeObserver) {
    new ResizeObserver(resizeCanvas).observe(canvas);
  } else {
    window.addEventListener('resize', resizeCanvas);
  }
  resizeCanvas();
  rafId = requestAnimationFrame(frame);

  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (mq && mq.matches) {
    motion = false;
    shell.classList.add('is-static');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // 宿主驱动模式下安装段可能已经开始写进度，所以一进界面就先连上；
  // demo 模式下没有内容，读到空字符串不会改变状态。
  render(state, true);
  if (bridge.mode === 'host') startPolling();

  // 真机里窗口本身就是画布，不能留预览用的那圈外边距：
  // 预览时 .shell 是"浮在网页上的一张卡片"，而装进壳后窗口尺寸已经等于
  // 卡片尺寸，body 的 24px padding 会变成界面四周一圈深色黑框。
  // 这里只在宿主模式下收紧，双击预览仍是原样。
  if (bridge.mode === 'host') {
    document.documentElement.classList.add('is-app');
  }
})();
