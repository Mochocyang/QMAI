/**
 * 青幕AI写作 —— 安装器动效壳：宿主桥接层
 *
 * 界面永远只认这一层的四个能力，不直接碰文件系统，也不认识 Tauri：
 *
 *   readProgress()  读取安装段写下的进度文本（整个文件）
 *   start()         用户点了「开始安装」，通知宿主启动安装段
 *   cancel()        用户在安装开始前退出
 *   abort()         用户在安装进行中中止（安装段会清理半成品）
 *   retry()         失败后重试
 *   launch()        装完后拉起主程序
 *   openLog()       打开安装日志
 *   useClassic()    放弃动效界面，切回原生 MUI2 向导
 *   close()         关闭动效壳窗口
 *   drag()          开始拖动窗口（标题栏按下时触发）
 *
 * 真实宿主（第二期接进 NSIS 的 Tauri 壳）只需在页面加载前注入：
 *
 *   window.__QMAI_SETUP_HOST__ = { readProgress, start, cancel, abort, retry, launch, openLog, useClassic, close, drag }
 *
 * 没有注入时自动落到 demo 桥：它把同一套协议行写进内存缓冲，
 * 再走完全相同的解析与渲染路径。这样"预览能跑通"和"真机跑通"用的是同一段代码。
 */
(function (root) {
  'use strict';

  var POLL_MS = 200;

  /* ---------------- 演示桥：按真实时间轴吐协议行 ---------------- */

  // 时刻(ms) → 协议行。刻意在 38% 和 72% 附近各停一下，
  // 模拟真实安装里解压大文件和拷贝字体时的停顿。
  // 阶段序号必须与 protocol.js 的 STAGES 一致：0准备 1解压 2快捷方式 3字体。
  var DEMO_SCRIPT = [
    [300, '4|0|准备安装环境|正在校验安装包完整性'],
    [900, '11|0|准备安装环境|校验通过'],
    [1500, '18|1|解压核心文件|qmcore.dll'],
    [2300, '26|1|解压核心文件|webview\\assets\\index-8f3a.js'],
    [3100, '34|1|解压核心文件|resources\\skills\\novel-writing.md'],
    [4300, '38|1|解压核心文件|native\\qm_pdf.dll'],
    [5000, '52|2|创建开始菜单与桌面快捷方式|QMaiWrite.lnk'],
    [5900, '61|2|创建开始菜单与桌面快捷方式|开始菜单\\青幕AI写作'],
    [6800, '72|2|注册文件关联|.qmai'],
    [8100, '80|3|写入字体|fonts\\SourceHanSansSC-Regular.otf'],
    [8900, '92|3|写入字体|fonts\\LXGWWenKai-Regular.ttf'],
    [9700, '99|3|正在完成最后配置|'],
    [10300, 'done']
  ];

  function createDemoBridge() {
    var started = 0;
    var cursor = 0;
    var buffer = '';
    var timers = [];
    var log = [];

    function stamp(line) {
      log.push(line);
      buffer += line + '\n';
    }

    function start() {
      started = Date.now();
      cursor = 0;
      buffer = '';
      log = [];
      timers.forEach(clearTimeout);
      timers = [];
      DEMO_SCRIPT.forEach(function (entry) {
        timers.push(setTimeout(function () { stamp(entry[1]); }, entry[0]));
      });
    }

    return {
      mode: 'demo',
      start: start,
      pollMs: POLL_MS,
      readProgress: function () {
        return Promise.resolve(buffer);
      },
      cancel: function () {
        start(); // 演示里"取消"等价于重来
      },
      abort: function () {
        stamp('err|E499|用户中止安装');
      },
      retry: function () {
        start();
      },
      launch: function () {
        start();
      },
      openLog: function () {
        return Promise.resolve(log.join('\n'));
      },
      useClassic: function () {
        start();
      },
      close: function () {
        // 演示/预览里没有窗口可关，空实现即可
      },
      drag: function () {
        // 预览是普通网页，拖动窗口无意义
      }
    };
  }

  /* ---------------- 宿主桥：包住注入进来的真实能力 ---------------- */

  function createHostBridge(host) {
    return {
      mode: 'host',
      start: function () { return host.start && host.start(); },
      pollMs: POLL_MS,
      readProgress: function () {
        return Promise.resolve(host.readProgress()).then(function (text) {
          return typeof text === 'string' ? text : '';
        });
      },
      cancel: function () { return host.cancel && host.cancel(); },
      abort: function () { return host.abort && host.abort(); },
      retry: function () {
        if (host.retry) return host.retry();
        // 宿主没实现重试时，退回"用经典界面再来一次"——这是永远可用的兜底
        return host.useClassic && host.useClassic();
      },
      launch: function () { return host.launch && host.launch(); },
      openLog: function () { return host.openLog && host.openLog(); },
      useClassic: function () { return host.useClassic && host.useClassic(); },
      close: function () { return host.close && host.close(); },
      drag: function () { return host.drag && host.drag(); }
    };
  }

  function create() {
    var host = root.__QMAI_SETUP_HOST__;
    if (host && typeof host.readProgress === 'function') return createHostBridge(host);
    return createDemoBridge();
  }

  root.QmaiBridge = { create: create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
