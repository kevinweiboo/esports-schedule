@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

REM 把本地改动提交并推送到 GitHub，Pages 会在一两分钟后自动更新
REM 第一次用之前先跑一次「发布到GitHub.bat」完成授权

git status --short
echo.

set /p MSG=提交说明（直接回车用默认「更新数据」）: 
if "%MSG%"=="" set MSG=更新数据

git add -A
git commit -m "%MSG%"
if errorlevel 1 echo （没有需要提交的改动）

git push
if errorlevel 1 (
  echo.
  echo 推送失败。若提示未授权，先运行一次「发布到GitHub.bat」。
)

echo.
echo 完成。站点通常在 1~2 分钟内更新：https://kevinweiboo.github.io/esports-schedule/
pause
