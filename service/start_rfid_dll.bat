@echo off
start "Register"  cmd /k "set READER_INDEX=0&& uvicorn main_dll:app --port 8000 --log-level warning" 
@REM start "Pallet WS-01" cmd /k "set READER_INDEX=1&& uvicorn main_dll:app --port 8001 "
@REM start "Washing"   cmd /k "set READER_INDEX=2&& uvicorn main_dll:app --port 8002 --log-level warning"
@REM start "MBR1"      cmd /k "set READER_INDEX=3&& uvicorn main_dll:app --port 8003"asd