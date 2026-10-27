@echo off
title Wallpaper Picker
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js and make sure "node" is on PATH.
  pause
  exit /b 1
)
node "%~dp0viewer.mjs"
echo.
echo Server stopped.
pause
