@echo off
cd /d "%~dp0"

REM 把本地改动提交并推送到 GitHub，Pages 会在一两分钟后自动更新
REM 第一次用之前先跑一次「发布到GitHub.bat」完成授权
REM
REM 为什么必须「先拉再推」：
REM   GitHub Actions 每 3 小时会自动往 main 推一次数据（chore: refresh schedule data）。
REM   本地不先同步就直接 push，会被拒（non-fast-forward），
REM   而且以前只提示「可能未授权」，很容易让人以为推成功了，代码就一直卡在本地。
REM
REM 数据文件冲突一律以线上为准（-X ours：rebase 时 ours = 线上那份）：
REM   线上数据是 Actions 每 3 小时现抓的，比本地的新，覆盖掉本地完全没关系。
REM   代码文件不会冲突（Actions 只动 data/）。

git status --short
echo.

set /p MSG=提交说明（直接回车用默认「更新数据」）: 
if "%MSG%"=="" set MSG=更新数据

git add -A
git commit -m "%MSG%"
if errorlevel 1 echo （没有需要提交的改动）
echo.

echo [1/3] 拉取线上改动（数据以线上为准）...
git fetch origin
git pull --rebase -X ours origin main
if errorlevel 1 (
  echo.
  echo 合并失败，需要手动处理：
  echo     git status              查看冲突文件
  echo     git rebase --continue   解决后继续
  echo     git rebase --abort      放弃本次合并
  pause
  exit /b 1
)
echo.

echo [2/3] 推送到 GitHub ...
git push
if errorlevel 1 (
  echo.
  echo 推送失败。若提示未授权，先运行一次「发布到GitHub.bat」。
  pause
  exit /b 1
)
echo.

echo [3/3] 完成。站点通常在 1~2 分钟内更新：https://kevinweiboo.github.io/esports-schedule/
pause
