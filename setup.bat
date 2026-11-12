@echo off
title RoadWatch AI setup
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
echo Installing web app packages...
call npm install --no-fund --no-audit || (echo npm install failed. & pause & exit /b 1)
node scripts\setup.js %*
pause
