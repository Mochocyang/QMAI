"""
点击 QMAI 章节标题后再截图，用于验证「聚焦时文字是否垂直居中」。

为什么需要它：标题的**显示态**是 h1、**输入态**是 textarea，两者共用同一条规则。
行高改动只在输入态（点进去之后）才看得出来，所以静态截图无法验证 —— 必须真点一下。

坐标换算：PrintWindow 抓的是整个窗口矩形，所以截图里的 (0,0) 就等于
GetWindowRect 给的屏幕坐标 (x, y)；把截图上的目标点加上窗口原点即为屏幕点。
"""
import sys
import time
from ctypes import windll

import win32api
import win32con
import win32gui
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
    # 截图上的目标点（标题文字处），由调用方按图像尺寸给出
    ix, iy = int(sys.argv[2]), int(sys.argv[3])

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
    # 把窗口真正提到最前。
    #
    # ⚠️ 只调 SetForegroundWindow 是不够的：Windows 的前台锁定策略会让它抛
    # `pywintypes.error: (0, 'SetForegroundWindow', ...)`（没有错误消息），
    # 而**失败之后窗口仍在后面** —— 此时按屏幕坐标发鼠标事件，点到的是
    # 压在上面的别的窗口（实测：点击落到了另一个应用的窗口上，
    # 截图里界面毫无变化，很容易误判成"点击没生效/功能坏了"）。
    # 所以这里用 SetWindowPos 先置顶并激活，点完再取消置顶（恢复到普通层级）。
    try:
        win32gui.SetWindowPos(hwnd, win32con.HWND_TOPMOST, 0, 0, 0, 0,
                              win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_SHOWWINDOW)
        win32gui.SetForegroundWindow(hwnd)
    except Exception as exc:
        print(f'bring-to-front failed (ignored): {exc}')
    time.sleep(1.5)

    r = win32gui.GetWindowRect(hwnd)
    print(f'window rect = {r}, size = {r[2]-r[0]}x{r[3]-r[1]}')

    # 点击标题（屏幕坐标 = 窗口原点 + 图像坐标）
    sx, sy = r[0] + ix, r[1] + iy
    print(f'click at screen ({sx}, {sy})')
    win32api.SetCursorPos((sx, sy))
    time.sleep(0.4)
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.12)
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    time.sleep(1.8)

    size = capture(hwnd, out)
    print(f'captured {size} -> {out}')

    # 取消置顶，把窗口恢复到普通层级（否则它会一直压在别的窗口上面）。
    try:
        win32gui.SetWindowPos(hwnd, win32con.HWND_NOTOPMOST, 0, 0, 0, 0,
                              win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
    except Exception as exc:
        print(f'restore z-order failed (ignored): {exc}')


if __name__ == '__main__':
    main()
