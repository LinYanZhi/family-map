@echo off
setlocal
cd /d "%~dp0"
node "server\shutdown.mjs"
if errorlevel 1 (
  echo.
  echo [map-app] stop reported a problem. See messages above.
  pause
)
endlocal
