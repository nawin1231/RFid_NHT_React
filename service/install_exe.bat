@echo off
REM ============================================================
REM  install_exe.bat  (run on SERVER, from inside service\deploy_exe\)
REM  1. stop start_rfid + all rfid_service.exe
REM  2. backup old exe + _internal -> service\exe_backup\<date>\
REM  3. copy new exe + _internal into service\
REM  4. start start_rfid.vbs again
REM  Does NOT touch readers_config.json / location_ports.json / start_rfid.py
REM ============================================================
setlocal
set SRC=%~dp0
for %%I in ("%~dp0..") do set TARGET=%%~fI

if not exist "%TARGET%\start_rfid.py" (
    echo *** %TARGET% has no start_rfid.py
    echo *** put deploy_exe inside the server's service folder, then run again
    pause & exit /b 1
)
if not exist "%SRC%rfid_service.exe" (
    echo *** no rfid_service.exe next to this script
    pause & exit /b 1
)

findstr /r /c:"^ *USE_EXE *= *True" "%TARGET%\start_rfid.py" >nul
if errorlevel 1 (
    echo *** WARNING: start_rfid.py on this server has USE_EXE = False
    echo *** it will run python source, not the exe. Set USE_EXE = True first.
    pause & exit /b 1
)

echo Target : %TARGET%
echo This will STOP all RFID readers for about 10-20 seconds.
choice /m "Continue"
if errorlevel 2 exit /b 0

echo [1/4] Stopping start_rfid.py and rfid_service.exe ...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*start_rfid.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
taskkill /F /IM rfid_service.exe >nul 2>&1
timeout /t 3 /nobreak >nul
tasklist | findstr /i rfid_service.exe >nul
if not errorlevel 1 (
    echo *** rfid_service.exe still running - close it manually and run again
    pause & exit /b 1
)

echo [2/4] Backing up old exe ...
for /f %%D in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmm"') do set STAMP=%%D
set BK=%TARGET%\exe_backup\%STAMP%
mkdir "%BK%" 2>nul
if exist "%TARGET%\rfid_service.exe" move /y "%TARGET%\rfid_service.exe" "%BK%\" >nul
if exist "%TARGET%\_internal" move /y "%TARGET%\_internal" "%BK%\_internal" >nul

echo [3/4] Copying new exe ...
copy /y "%SRC%rfid_service.exe" "%TARGET%\" >nul
if errorlevel 1 goto :restore
xcopy /e /i /q /y "%SRC%_internal" "%TARGET%\_internal" >nul
if errorlevel 1 goto :restore

echo [4/4] Starting readers ...
start "" wscript "%TARGET%\start_rfid.vbs"

echo.
echo Installed:
dir "%TARGET%\rfid_service.exe" | findstr rfid_service.exe
type "%SRC%BUILD_INFO.txt" 2>nul
echo Old version backed up in: %BK%
pause
exit /b 0

:restore
echo *** copy failed - restoring old exe from %BK%
if exist "%BK%\rfid_service.exe" move /y "%BK%\rfid_service.exe" "%TARGET%\" >nul
if exist "%BK%\_internal" move /y "%BK%\_internal" "%TARGET%\_internal" >nul
start "" wscript "%TARGET%\start_rfid.vbs"
pause
exit /b 1
