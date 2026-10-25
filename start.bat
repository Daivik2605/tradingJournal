@echo off
REM Starts Chart Journal at http://localhost:5173 (close this window to stop)
REM Port 5173 is fixed in the PersonalOS registry; if it's taken we stop instead of picking another.
cd /d "%~dp0"
set PORT=5173
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  echo Chart Journal needs port %PORT%, but something is already using it.
  echo Stop that program ^(or an older Chart Journal window^), then run this again.
  echo See what it is:  netstat -ano ^| findstr :%PORT%
  pause
  exit /b 1
)
echo Chart Journal running at http://localhost:%PORT%  (close this window to stop)
start "" http://localhost:%PORT%
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)
npx --yes serve -l %PORT% .
