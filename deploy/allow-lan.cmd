@echo off
rem Allow inbound access for map-app's own nginx (LAN test from phone on same Wi-Fi).
rem Run as Administrator: right-click -> "Run as administrator".
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo [!] Administrator required. Right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)

set "NGX=%~dp0nginx\nginx.exe"
if not exist "%NGX%" (
  echo [!] nginx.exe not found: %NGX%
  pause
  exit /b 1
)

echo Removing stale block rules for this nginx path...
netsh advfirewall firewall delete rule name=all dir=in program="%NGX%" >nul 2>&1

echo Adding inbound allow rules (Private network)...
netsh advfirewall firewall add rule name="map-app nginx (program)" dir=in action=allow program="%NGX%" enable=yes profile=private >nul
netsh advfirewall firewall add rule name="map-app nginx (LAN 8800-8801)" dir=in action=allow protocol=TCP localport=8800-8801 enable=yes profile=private >nul
if errorlevel 1 (
  echo [!] Failed to add firewall rules.
  pause
  exit /b 1
)

echo Done. Phone on the same Wi-Fi can open http://^<this-PC-LAN-IP^>:8800/
pause
endlocal
