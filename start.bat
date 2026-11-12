@echo off
title RoadWatch AI
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org & pause & exit /b 1)
node scripts\start-all.js %*
pause
