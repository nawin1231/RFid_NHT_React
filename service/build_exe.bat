@echo off
REM ============================================================
REM  build_exe.bat  (run on DEV machine)
REM  build rfid_service.exe -> pack into service\deploy_exe\
REM  then copy the whole deploy_exe folder to the server's service folder
REM  and run deploy_exe\install_exe.bat there
REM ============================================================
cd /d %~dp0

REM must be 32-bit Python (SID_U861.dll is 32-bit) and it is the one with PyInstaller
set PY=C:\Users\bptk654\AppData\Local\Programs\Python\Python314-32\python.exe

echo [1/3] Building with PyInstaller ...
"%PY%" -m PyInstaller --clean -y rfid_service.spec
if errorlevel 1 goto :fail
if not exist dist\rfid_service\rfid_service.exe goto :fail

echo [2/3] Packing deploy_exe\ ...
if exist deploy_exe rmdir /s /q deploy_exe
mkdir deploy_exe
copy /y dist\rfid_service\rfid_service.exe deploy_exe\ >nul
xcopy /e /i /q /y dist\rfid_service\_internal deploy_exe\_internal >nul
copy /y install_exe.bat deploy_exe\ >nul
REM never ship config files - server keeps its own readers_config.json / location_ports.json
del /q deploy_exe\_internal\readers_config.json deploy_exe\_internal\location_ports.json 2>nul
echo built %date% %time% > deploy_exe\BUILD_INFO.txt

echo [3/3] Done. New exe:
dir deploy_exe\rfid_service.exe | findstr rfid_service.exe
echo.
echo Next: copy folder  %~dp0deploy_exe  to the server's  service\  folder
echo       then run     service\deploy_exe\install_exe.bat  on the server
pause
exit /b 0

:fail
echo.
echo *** BUILD FAILED - see messages above ***
pause
exit /b 1
