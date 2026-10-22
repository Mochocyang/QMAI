/**
 * 青幕AI写作 —— 安装器进度协议（客户端解析部分）
 *
 * 这份文件定义「NSIS 安装段」与「动效壳界面」之间唯一的数据契约。
 * 双方只通过一个追加写的文本文件通信，不共享内存、不建管道、不引插件：
 *
 *   文件：%TEMP%\qmai-setup-<pid>.progress
 *   写入：安装段每完成一个阶段，追加一行，行尾 $\r$\n
 *   读取：壳每 200ms 重新读整个文件（不是读增量），因此下面的解析必须是幂等的
 *
 * 行格式（ASCII 竖线分隔，四段）：
 *
 *   <percent>|<stageIndex>|<label>|<detail>
 *     42|1|解压核心文件|webview\assets\index-8f3a.js
 *
 * 两个终止行：
 *
 *   done                     安装成功，界面切完成页
 *   err|<code>|<message>     安装失败，界面切错误页
 *
 * 设计取舍：
 * 1) percent 单调不减。重复读、乱序读、重读半截文件都不会让进度倒退；
 *    百分比低于当前值的行整条丢弃（连它的 label/detail 一起丢，否则文字会跳回上一阶段）。
 * 2) percent 越界按 0..100 收敛，而不是报错。安装器面向普通用户，
 *    宁可显示一个接近真实的数字，也不要因为一行脏数据把界面卡死。
 * 3) 尾行不完整（文件正写到一半）时丢弃最后一段，等下一次轮询。
 * 4) 到达 done / error 后不再接受任何后续事件，终态不可逆。
 *
 * 本文件刻意不使用 import / export：
 * 既能被 index.html 用经典 <script> 加载（双击即可预览，无需构建），
 * 也能被 vitest 直接 import 执行（无导出语句的模块同样会执行顶层代码）。
 */
(function (root) {
  'use strict';

  /**
   * 安装阶段。stageIndex 由安装段显式给出，界面不猜。
   *
   * 顺序必须与 _tauri-installer-template.nsi 的 Section Install 实际执行顺序一致：
   *   解压文件 → 注册表/快捷方式 → 随包字体。
   * 早期版本把"字体"排在"快捷方式"之前，结果安装段发来的序号在真实流程里
   * 是倒退的，阶段勾选会先点亮第 3 个再跳回第 2 个。顺序对齐后才是单调的。
   */
  var STAGES = [
    { key: 'prepare', label: '准备环境' },
    { key: 'extract', label: '解压核心' },
    { key: 'shortcut', label: '创建快捷方式' },
    { key: 'fonts', label: '写入字体' }
  ];

  var FIELD_COUNT = 4;
  var TERMINAL_PHASES = { done: true, error: true };

  function initial() {
    return {
      phase: 'idle', // idle | installing | done | error
      percent: 0,
      stageIndex: 0,
      label: '',
      detail: '',
      error: null // { code, message }
    };
  }

  function isTerminal(state) {
    return !!(state && TERMINAL_PHASES[state.phase]);
  }

  /** 越界收敛到 0..100；无法解析返回 null（区别于合法 0）。 */
  function toPercent(text) {
    var raw = String(text).trim();
    if (!raw) return null;
    var n = Number(raw);
    if (!isFinite(n)) return null;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return Math.round(n);
  }

  function toStageIndex(text) {
    var raw = String(text).trim();
    if (!raw) return null;
    var n = Number(raw);
    if (!isFinite(n) || Math.floor(n) !== n) return null;
    if (n < 0 || n >= STAGES.length) return null;
    return n;
  }

  /**
   * 解析单行。合法返回事件对象，非法返回 null（调用方直接忽略）。
   * 注意：非法的行不改变状态，也不报错——安装段写坏了不该让界面崩。
   */
  function parseLine(raw) {
    if (typeof raw !== 'string') return null;

    // 去掉行尾 \r 与首尾空白
    var line = raw.replace(/\r$/, '').trim();
    if (!line) return null;

    if (line === 'done') return { type: 'done' };

    if (line.indexOf('err|') === 0) {
      var errParts = line.split('|');
      var code = (errParts[1] || '').trim();
      if (!code) return null;
      return {
        type: 'error',
        code: code,
        message: errParts.slice(2).join('|').trim()
      };
    }

    var parts = line.split('|');
    if (parts.length < FIELD_COUNT) return null;

    var percent = toPercent(parts[0]);
    if (percent === null) return null;

    var stageIndex = toStageIndex(parts[1]);
    if (stageIndex === null) return null;

    return {
      type: 'progress',
      percent: percent,
      stageIndex: stageIndex,
      label: (parts[2] || '').trim(),
      // detail 里允许出现竖线（Windows 路径不会，但文件名理论上可以），全部保留
      detail: parts.slice(3).join('|').trim()
    };
  }

  /** 纯函数式归约：不修改传入 state，返回新对象。 */
  function applyEvent(state, event) {
    if (!state) state = initial();
    if (!event) return state;
    if (isTerminal(state)) return state; // 终态不可逆

    if (event.type === 'progress') {
      // 滞后行整条忽略：百分比回退说明这条是旧数据（重读文件、并发写、缓冲乱序都可能），
      // 若只取 max(percent) 而照抄它的 label/detail，界面就会出现"进度条不动、
      // 文字跳回上一阶段"的错觉。整条丢弃最干净。
      if (event.percent < state.percent) return state;

      return {
        phase: 'installing',
        percent: Math.max(state.percent, event.percent),
        stageIndex: Math.max(state.stageIndex, event.stageIndex),
        label: event.label || state.label,
        detail: event.detail === '' ? '' : event.detail || state.detail,
        error: null
      };
    }

    if (event.type === 'done') {
      return {
        phase: 'done',
        percent: 100,
        stageIndex: STAGES.length - 1,
        label: '',
        detail: '',
        error: null
      };
    }

    if (event.type === 'error') {
      return {
        phase: 'error',
        percent: state.percent,
        stageIndex: state.stageIndex,
        label: state.label,
        detail: state.detail,
        error: { code: event.code, message: event.message || '' }
      };
    }

    return state;
  }

  /**
   * 把「整个文件内容」切成完整行。
   * 末尾没有换行的最后一段视为写到一半的残行，交给 tail 留到下次。
   */
  function splitCompleteLines(text) {
    if (typeof text !== 'string' || text === '') {
      return { complete: [], tail: '' };
    }
    var cut = text.lastIndexOf('\n');
    if (cut === -1) return { complete: [], tail: text };
    var head = text.slice(0, cut);
    var tail = text.slice(cut + 1);
    return { complete: head.split('\n'), tail: tail };
  }

  /**
   * 读取一次文件内容 → 新状态。
   * 因为 percent / stageIndex 都单调，同一份内容重复喂进来结果不变（幂等），
   * 所以壳可以每 200ms 无脑重读整个文件，不需要记录读取偏移。
   *
   * 返回 { state, tail, changed }：
   *   tail    —— 本文件尚未写完的残行，调用方下次拼在内容前面即可（当前实现重读全文，可忽略）
   *   changed —— 状态是否真的变了，用于避免无意义的重绘
   */
  function applyContent(state, content) {
    var base = state || initial();
    var split = splitCompleteLines(content);
    var next = base;

    for (var i = 0; i < split.complete.length; i++) {
      var event = parseLine(split.complete[i]);
      if (event) next = applyEvent(next, event);
    }

    return {
      state: next,
      tail: split.tail,
      changed: !sameState(base, next)
    };
  }

  function sameState(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
      a.phase === b.phase &&
      a.percent === b.percent &&
      a.stageIndex === b.stageIndex &&
      a.label === b.label &&
      a.detail === b.detail &&
      (a.error ? a.error.code : null) === (b.error ? b.error.code : null)
    );
  }

  /** 给界面用：某个阶段此刻是「未开始 / 进行中 / 已完成」。 */
  function stageStatus(state, index) {
    if (!state) return 'pending';
    if (state.phase === 'done') return 'done';
    if (index < state.stageIndex) return 'done';
    if (index === state.stageIndex && state.phase === 'installing') return 'active';
    return 'pending';
  }

  root.QmaiProtocol = {
    STAGES: STAGES,
    initial: initial,
    parseLine: parseLine,
    applyEvent: applyEvent,
    splitCompleteLines: splitCompleteLines,
    applyContent: applyContent,
    stageStatus: stageStatus,
    isTerminal: isTerminal
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
