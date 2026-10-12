"""
只把鼠标移到某点并停留，然后截图 —— 用于验证**悬停提示**（tooltip / title）。

为什么不直接用 click-title-and-capture.py：那个脚本会真的按下左键。
对「计划」这种**开关**按钮，点一下就把状态反转了，截出来的悬停提示
会变成「已开启…」的文案，验的就不是用户要看的那一态。
所以这里只 SetCursorPos + sleep，不发任何鼠标按键事件。

坐标换算同 click-title-and-capture.py：PrintWindow 抓整个窗口矩形，
截图的 (0,0) 即 GetWindowRect 的 (x, y)，故屏幕点 = 窗口原点 + 图像坐标。
"""
import sys
import time
from ctypes import windll

import win32api
import win32gui
import win32con
import win32ui
from PIL import Image

TARGET_TITLES = ['青幕AI写作', 'qingmuai', 'qmai', 'com.qingmuai',
                 'AI 小说创作工作台', 'AI Novel Production Engine']


def find_main_window():
    candidates = []

    def callback(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        cls = win32gui.GetClassName(hwnd)
        for t in TARGET_TITLES:
            if t.lower() in title.lower() or t.lower() in cls.lower():
                r = win32gui.GetWindowRect(hwnd)
                w, h = r[2] - r[0], r[3] - r[1]
                if w > 200 and h > 200:
                    candidates.append((hwnd, w * h))
                break

    win32gui.EnumWindows(callback, None)
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[1], reverse=True)
    return candidates[0][0]


def capture(hwnd, save_path):
    r = win32gui.GetWindowRect(hwnd)
    x, y, x2, y2 = r
    w, h = x2 - x, y2 - y
    dc = win32gui.GetWindowDC(hwnd)
    mfc = win32ui.CreateDCFromHandle(dc)
    save = mfc.CreateCompatibleDC()
    bmp = win32ui.CreateBitmap()
    bmp.CreateCompatibleBitmap(mfc, w, h)
    save.SelectObject(bmp)
    windll.user32.PrintWindow(hwnd, save.GetSafeHdc(), 2)
    info = bmp.GetInfo()
    im = Image.frombuffer('RGB', (info['bmWidth'], info['bmHeight']),
                          bmp.GetBitmapBits(True), 'raw', 'BGRX', 0, 1)
    im.save(save_path)
    win32gui.DeleteObject(bmp.GetHandle())
    save.DeleteDC()
    mfc.DeleteDC()
    win32gui.ReleaseDC(hwnd, dc)
    return im.size


def main():
    out = sys.argv[1]
    ix, iy = int(sys.argv[2]), int(sys.argv[3])
    hover_ms = int(sys.argv[4]) if len(sys.argv) > 4 else 1400

    hwnd = None
    for _ in range(30):
        hwnd = find_main_window()
        if hwnd:
            break
        time.sleep(1.0)
    if hwnd is None:
        print('Could not find QMAI main window')
        sys.exit(1)

    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    try:
        win32gui.SetForegroundWindow(hwnd)
    except Exception as exc:  # 前台锁定偶尔失败，不影响 SetCursorPos + 截图
        print(f'SetForegroundWindow failed (ignored): {exc}')
    time.sleep(1.0)

    r = win32gui.GetWindowRect(hwnd)
    print(f'window rect = {r}, size = {r[2]-r[0]}x{r[3]-r[1]}')

    sx, sy = r[0] + ix, r[1] + iy
    print(f'hover only (no click) at screen ({sx}, {sy})')
    # 增量移动，而不是一步跳到目标点。
    #
    # 为什么必须这样：WebView2 里的浮层（Radix Tooltip）监听的是真实的
    # pointermove/pointerenter 事件链。`SetCursorPos` 直接落到目标点时，
    # 中间没有「经过」的移动事件，某些情况下 enter 不会被派发 —— 悬停浮层就不出现。
    # 从一个偏离点开始、分若干小步逼近，就能稳定触发。
    start_x, start_y = sx + 90, sy + 70
    win32api.SetCursorPos((start_x, start_y))
    time.sleep(0.35)
    steps = 12
    for i in range(1, steps + 1):
        mx = int(start_x + (sx - start_x) * i / steps)
        my = int(start_y + (sy - start_y) * i / steps)
        win32api.SetCursorPos((mx, my))
        time.sleep(0.05)
    # 落点后再做一次极小抖动：确认 enter 之后还有 move，浮层才会稳定渲染
    time.sleep(0.3)
    win32api.SetCursorPos((sx + 1, sy))
    time.sleep(0.15)
    win32api.SetCursorPos((sx, sy))
    time.sleep(hover_ms / 1000.0)
    # 移动过程中不按键，落点保持在目标上再截图
    time.sleep(0.4)

    size = capture(hwnd, out)
    print(f'captured {size} -> {out}')


if __name__ == '__main__':
    main()
