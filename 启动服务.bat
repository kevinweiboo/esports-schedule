@echo off
rem ============================================================
rem  Esports schedule - local server
rem  Starts the server and opens the page in your browser.
rem  The server shuts itself down when you close the page.
rem  Close this window (or press Ctrl+C) to stop the server.
rem ============================================================
cd /d "%~dp0"

set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "C://Users//kevin//.workbuddy//binaries//node//versions//22.22.2-6//node.exe" set "NODE=C://Users//kevin//.workbuddy//binaries//node//versions//22.22.2-6//node.exe"

if not defined NODE (
  echo [!] Node not found in PATH.
  echo     Install Node.js or edit this file and set NODE to your node.exe path.
  echo.
  pause
  exit /b 1
)

"%NODE%" scripts\serve.mjs
echo.
echo Server stopped. Press any key to close this window.
pause >nul
