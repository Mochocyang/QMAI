/**
 * 安装器进度协议测试。
 *
 * 这层是 NSIS 安装段与动效壳之间唯一的接口，出错的表现是「界面卡住」或
 * 「进度倒退」，在用户机器上极难复现。所以边界值全部在单元测试里锁死。
 */
import { describe, expect, it } from 'vitest';
import './protocol.js';

const P = globalThis.QmaiProtocol;

describe('进度协议 · 单行解析', () => {
  it('解析一个正常进度行', () => {
    expect(P.parseLine('42|1|解压核心文件|webview\\assets\\index-8f3a.js')).toEqual({
      type: 'progress',
      percent: 42,
      stageIndex: 1,
      label: '解压核心文件',
      detail: 'webview\\assets\\index-8f3a.js'
    });
  });

  it('detail 里含竖线时整段保留，不截断', () => {
    const ev = P.parseLine('10|0|准备|a|b|c');
    expect(ev.detail).toBe('a|b|c');
  });

  it('容忍行尾 \\r（安装段用 $\\r$\\n 写文件）', () => {
    expect(P.parseLine('7|0|准备环境|').percent).toBe(7);
  });

  it('空行、纯空白、非字符串一律返回 null', () => {
    expect(P.parseLine('')).toBeNull();
    expect(P.parseLine('   ')).toBeNull();
    expect(P.parseLine('\r')).toBeNull();
    expect(P.parseLine(null)).toBeNull();
    expect(P.parseLine(undefined)).toBeNull();
    expect(P.parseLine(42)).toBeNull();
  });

  it('字段不足 4 段视为脏数据', () => {
    expect(P.parseLine('42|1|解压核心')).toBeNull();
    expect(P.parseLine('42')).toBeNull();
  });

  it('百分比非数字视为脏数据，但 0 是合法值', () => {
    expect(P.parseLine('abc|0|准备|')).toBeNull();
    expect(P.parseLine('|0|准备|')).toBeNull();
    expect(P.parseLine('0|0|准备|').percent).toBe(0);
  });

  it('百分比越界收敛到 0..100，而不是报错卡死界面', () => {
    expect(P.parseLine('-20|0|准备|').percent).toBe(0);
    expect(P.parseLine('180|0|准备|').percent).toBe(100);
  });

  it('阶段序号越界或非整数视为脏数据', () => {
    expect(P.parseLine('50|9|准备|')).toBeNull();
    expect(P.parseLine('50|-1|准备|')).toBeNull();
    expect(P.parseLine('50|1.5|准备|')).toBeNull();
    expect(P.parseLine('50|abc|准备|')).toBeNull();
  });

  it('解析 done 终止行', () => {
    expect(P.parseLine('done')).toEqual({ type: 'done' });
  });

  it('解析 err 终止行，code 为空则判为脏数据', () => {
    expect(P.parseLine('err|E1024|写入字体失败')).toEqual({
      type: 'error',
      code: 'E1024',
      message: '写入字体失败'
    });
    expect(P.parseLine('err||缺 code')).toBeNull();
    expect(P.parseLine('err|E1|')).toEqual({ type: 'error', code: 'E1', message: '' });
  });
});

describe('进度协议 · 状态归约', () => {
  it('初始状态为空闲、0%、未开始的阶段 0', () => {
    expect(P.initial()).toEqual({
      phase: 'idle',
      percent: 0,
      stageIndex: 0,
      label: '',
      detail: '',
      error: null
    });
  });

  it('收到进度事件后进入 installing', () => {
    const s = P.applyEvent(P.initial(), P.parseLine('18|1|解压核心|a.dll'));
    expect(s.phase).toBe('installing');
    expect(s.percent).toBe(18);
    expect(s.stageIndex).toBe(1);
    expect(s.label).toBe('解压核心');
  });

  it('百分比与阶段序号都单调不减：滞后行整条丢弃，文字不跳回上一阶段', () => {
    let s = P.initial();
    s = P.applyEvent(s, P.parseLine('60|2|写入字体|x.otf'));
    s = P.applyEvent(s, P.parseLine('20|1|解压核心|old.dll'));
    expect(s.percent).toBe(60);
    expect(s.stageIndex).toBe(2);
    expect(s.label).toBe('写入字体');
    expect(s.detail).toBe('x.otf');
  });

  it('同百分比但阶段前进的行仍然接受（安装段可能先写阶段再写总量）', () => {
    let s = P.applyEvent(P.initial(), P.parseLine('50|1|解压核心|a'));
    s = P.applyEvent(s, P.parseLine('50|2|写入字体|b'));
    expect(s.percent).toBe(50);
    expect(s.stageIndex).toBe(2);
    expect(s.label).toBe('写入字体');
  });

  it('label 为空时保留上一个标签，避免界面闪成空白', () => {
    let s = P.applyEvent(P.initial(), P.parseLine('30|1|解压核心|a'));
    s = P.applyEvent(s, P.parseLine('35|1||b'));
    expect(s.label).toBe('解压核心');
    expect(s.detail).toBe('b');
  });

  it('done 强制百分比为 100 且进入终态', () => {
    let s = P.applyEvent(P.initial(), P.parseLine('70|2|写入字体|a'));
    s = P.applyEvent(s, P.parseLine('done'));
    expect(s.phase).toBe('done');
    expect(s.percent).toBe(100);
    expect(s.stageIndex).toBe(P.STAGES.length - 1);
  });

  it('终态不可逆：done 之后的任何事件都被忽略', () => {
    let s = P.applyEvent(P.initial(), P.parseLine('done'));
    const before = s;
    s = P.applyEvent(s, P.parseLine('10|0|回退|'));
    s = P.applyEvent(s, P.parseLine('err|E9|后到的错误'));
    expect(s).toBe(before);
  });

  it('error 记录错误码并进入终态，保留已完成的百分比', () => {
    let s = P.applyEvent(P.initial(), P.parseLine('55|2|写入字体|x.otf'));
    s = P.applyEvent(s, P.parseLine('err|E1024|磁盘写入失败'));
    expect(s.phase).toBe('error');
    expect(s.percent).toBe(55);
    expect(s.error).toEqual({ code: 'E1024', message: '磁盘写入失败' });
  });

  it('无法识别的行不改变状态', () => {
    const s = P.applyEvent(P.initial(), P.parseLine('垃圾数据'));
    expect(s).toEqual(P.initial());
  });
});

describe('进度协议 · 整流读取（幂等）', () => {
  it('末尾没有换行的残行不会被提前消费', () => {
    const r = P.applyContent(P.initial(), '20|1|解压核心|a.dll\n30|1|解压核心|b');
    expect(r.state.percent).toBe(20);
    expect(r.tail).toBe('30|1|解压核心|b');
  });

  it('残行补齐后能正常吃进去', () => {
    const first = P.applyContent(P.initial(), '20|1|解压核心|a.dll\n30|1|解压');
    const second = P.applyContent(first.state, '20|1|解压核心|a.dll\n30|1|解压核心|b.dll\n');
    expect(second.state.percent).toBe(30);
    expect(second.tail).toBe('');
    expect(second.state.detail).toBe('b.dll');
  });

  it('同一份内容重复读取结果不变（壳每 200ms 重读整个文件的前提）', () => {
    const text = '10|0|准备环境|\n25|0|准备环境|a\n';
    const once = P.applyContent(P.initial(), text);
    const twice = P.applyContent(once.state, text);
    const thrice = P.applyContent(twice.state, text);
    expect(twice.state).toEqual(once.state);
    expect(thrice.state).toEqual(once.state);
    expect(once.changed).toBe(true);
    expect(twice.changed).toBe(false);
  });

  it('空文件 / 完全没写入时保持初始状态', () => {
    expect(P.applyContent(null, '').state).toEqual(P.initial());
    expect(P.applyContent(null, '').changed).toBe(false);
    expect(P.applyContent(undefined, undefined).state).toEqual(P.initial());
  });

  it('脏行混在正常行中间时只跳过脏行', () => {
    const r = P.applyContent(P.initial(), '10|0|准备环境|\n这不是一行\n45|2|写入字体|x\n');
    expect(r.state.percent).toBe(45);
    expect(r.state.stageIndex).toBe(2);
  });

  it('文件被清空重写后，已完成的状态不会被抹掉', () => {
    const first = P.applyContent(P.initial(), '80|3|创建快捷方式|a\n');
    const afterTruncate = P.applyContent(first.state, '');
    expect(afterTruncate.state.percent).toBe(80);
  });
});

describe('进度协议 · 阶段展示状态', () => {
  it('未开始 / 进行中 / 已完成三档', () => {
    const idle = P.initial();
    expect(P.stageStatus(idle, 0)).toBe('pending');

    const running = P.applyEvent(idle, P.parseLine('50|2|写入字体|a'));
    expect(P.stageStatus(running, 0)).toBe('done');
    expect(P.stageStatus(running, 1)).toBe('done');
    expect(P.stageStatus(running, 2)).toBe('active');
    expect(P.stageStatus(running, 3)).toBe('pending');

    const done = P.applyEvent(running, P.parseLine('done'));
    expect(P.stageStatus(done, 0)).toBe('done');
    expect(P.stageStatus(done, 3)).toBe('done');
  });
});
