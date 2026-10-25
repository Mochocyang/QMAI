@echo off
chcp 65001 >nul
cd /d %~dp0..

set "PY=C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if not exist %PY% set "PY=python"

echo ============================================================
echo   青木 AI 写作 - 缓存命中率报告
echo ============================================================
echo.
echo 请把小说项目目录（含 .qmai 的那个文件夹）拖到本窗口，按回车。
echo 例如：C:\QM-BOOK\黑雨之下
echo.
set /p PROJ=项目目录:

if "%PROJ%"=="" (
    echo 没有输入，退出。
    pause
    exit /b 1
)

echo.
echo 正在统计 "%PROJ%" ...
echo.

"%PY%" scripts\cache-hit-report.py "%PROJ%" --timeline

echo.
echo ============================================================
echo   结果已显示在上面，把这段内容发给 AI 即可分析。
echo ============================================================
pause
