@echo off
cd /d "%~dp0"
echo Pulling latest changes...
git pull
echo.
echo Done. Now go to chrome://extensions and click Reload on:
echo   - FreeFit Seyata + 3CX Sync
echo   - Maof Fireberry + 3CX Sync
echo (only needed if they show a new version number)
pause
