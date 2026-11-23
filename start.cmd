@echo off
setlocal
cd /d "%~dp0"
node "server\launch.mjs"
if errorlevel 1 (
  echo.
  echo [map-app] start failed. See messages above.
  pause
)
endlocal
