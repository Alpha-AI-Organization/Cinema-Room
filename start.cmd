@echo off
rem Starts the cinema room server if needed, then opens it in the default browser.
setlocal
set "URL=http://127.0.0.1:41731/"
cd /d "%~dp0"
set /a TRIES=0

call :up
if not errorlevel 1 goto open

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node.js and try again.
  pause
  exit /b 1
)
start "Cinema Room server" /min node server.mjs

:wait
call :up
if not errorlevel 1 goto open
set /a TRIES+=1
if %TRIES% geq 30 goto fail
timeout /t 1 /nobreak >nul
goto wait

:fail
echo The cinema room server did not start on %URL%.
echo Run "node server.mjs" in this folder to see the error.
pause
exit /b 1

:open
rem Open by host name, not by bare IP: YouTube refuses many music videos on 127.0.0.1 (error 150).
rem cinema.localhost always points to this computer, and the browser treats it as a secure address.
start "" "http://cinema.localhost:41731/"
exit /b 0

:up
curl.exe -s -m 2 "%URL%" | findstr /c:"Cinema Room" >nul
exit /b %errorlevel%
