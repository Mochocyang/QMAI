import win32gui
import win32ui
import win32con
from ctypes import windll
from PIL import Image
import time
import sys

TARGET_TITLES = ['青幕AI写作', 'qingmuai', 'qmai', 'com.qingmuai', 'AI 小说创作工作台', 'AI Novel Production Engine', 'Novel Production Engine']

def find_main_window():
    candidates = []
    def callback(hwnd, extra):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        cls = win32gui.GetClassName(hwnd)
        for t in TARGET_TITLES:
            if t.lower() in title.lower() or t.lower() in cls.lower():
                rect = win32gui.GetWindowRect(hwnd)
                width = rect[2] - rect[0]
                height = rect[3] - rect[1]
                if width > 200 and height > 200:
                    candidates.append((hwnd, title, cls, width * height))
                break
    win32gui.EnumWindows(callback, None)
    if not candidates:
        return None
    # 选择面积最大的窗口
    candidates.sort(key=lambda x: x[3], reverse=True)
    return candidates[0][0]

def capture_window(hwnd, save_path):
    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    # SetForegroundWindow 在 Windows 前台锁定策略下会抛
    # `pywintypes.error: (0, 'SetForegroundWindow', ...)`（没有错误消息）。
    # 那**不影响**截图：PrintWindow 按窗口句柄取像素，不要求窗口在前台。
    # 所以这里吞掉异常继续 —— 否则一次无关的前台竞争会让整次验证拿不到截图。
    try:
        win32gui.SetForegroundWindow(hwnd)
    except Exception as exc:
        print(f'SetForegroundWindow failed (ignored): {exc}')
    time.sleep(1.5)

    rect = win32gui.GetWindowRect(hwnd)
    x, y, x2, y2 = rect
    width = x2 - x
    height = y2 - y
    print(f'Window rect: {rect}, size: {width}x{height}')

    if width <= 0 or height <= 0:
        print('Invalid window size')
        return False

    hwndDC = win32gui.GetWindowDC(hwnd)
    mfcDC = win32ui.CreateDCFromHandle(hwndDC)
    saveDC = mfcDC.CreateCompatibleDC()
    saveBitMap = win32ui.CreateBitmap()
    saveBitMap.CreateCompatibleBitmap(mfcDC, width, height)
    saveDC.SelectObject(saveBitMap)

    result = windll.user32.PrintWindow(hwnd, saveDC.GetSafeHdc(), 2)
    print('PrintWindow result:', result)

    bmpinfo = saveBitMap.GetInfo()
    bmpstr = saveBitMap.GetBitmapBits(True)

    im = Image.frombuffer(
        'RGB',
        (bmpinfo['bmWidth'], bmpinfo['bmHeight']),
        bmpstr, 'raw', 'BGRX', 0, 1)

    im.save(save_path)
    print(f'Saved screenshot to {save_path}')

    win32gui.DeleteObject(saveBitMap.GetHandle())
    saveDC.DeleteDC()
    mfcDC.DeleteDC()
    win32gui.ReleaseDC(hwnd, hwndDC)
    return True

def main():
    hwnd = None
    for i in range(30):
        hwnd = find_main_window()
        print(f'Try {i+1}: hwnd={hwnd}')
        if hwnd:
            break
        time.sleep(1.0)

    if hwnd is None:
        print('Could not find QMAI main window')
        sys.exit(1)

    save_path = sys.argv[1] if len(sys.argv) > 1 else r'c:\QMAI_C\QMAI-main\qmai-runtime-screenshot.png'
    ok = capture_window(hwnd, save_path)
    if not ok:
        sys.exit(1)

if __name__ == '__main__':
    main()
