@echo off
rem ============================================================
rem  Publish to GitHub + enable GitHub Pages
rem  The git repo and the first commit are already prepared.
rem  This script only does: login -> create repo -> push -> pages
rem ============================================================
cd /d "%~dp0"

set "PATH=%PATH%;C:\Program Files\GitHub CLI"
set REPO=esports-schedule

echo.
echo ===== Step 1/3 : Login to GitHub =====
echo.
echo   A browser window will open and show a one-time code.
echo   Just follow it: copy code, paste in browser, click Authorize.
echo.
echo   If it asks you to choose, press Enter to accept the default:
echo     - Where do you use GitHub?      -^> GitHub.com
echo     - Protocol                      -^> HTTPS
echo     - Authenticate Git with creds?  -^> Y
echo.
pause

gh auth login -h github.com -p https -w
if errorlevel 1 goto fail

echo.
echo ===== Step 2/3 : Create repo and push =====
echo   Repo name: %REPO%
echo.
gh repo create %REPO% --public --source=. --push
if errorlevel 1 goto fail

echo.
echo ===== Step 3/3 : Enable GitHub Pages =====
for /f "usebackq delims=" %%u in (`gh api user --jq .login`) do set GHUSER=%%u
gh api -X POST "repos/%GHUSER%/%REPO%/pages" -f "source[branch]=main" -f "source[path]=/" >nul 2>&1

echo.
echo ===== All done =====
echo.
echo   Repository : https://github.com/%GHUSER%/%REPO%
echo   Public site: https://%GHUSER%.github.io/%REPO%/
echo.
echo   Pages needs 1-2 minutes to build. Share the "Public site" link.
echo.
pause
exit /b 0

:fail
echo.
echo Something went wrong - see the message above.
echo If the repo name already exists, edit REPO in this .bat file.
echo.
pause
exit /b 1
