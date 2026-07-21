Set WshShell = CreateObject("WScript.Shell")
    
    ' Node.js Backend
    ' WshShell.Run "cmd /c cd /d D:\RFid_NHT_React\backend && node server.js", 1, False
    
    ' Python readers
    WshShell.Run "cmd /k cd /d D:\RFid_NHT_WASHING\service && python start_rfid.py", 1, False
    
    ' React Frontend
    ' WshShell.Run "cmd /c cd /d D:\RFid_NHT_React\frontend && npm start", 0, False
    ' WshShell.Run "cmd /c serve -s D:\RFid_NHT_React\frontend\build -l 3000", 1, False
    
' Python readers (แต่ละตัวแยก process)
' WshShell.Run "cmd /c cd /d D:\RFid_NHT_React\service && set READER_INDEX=0 && uvicorn main_dll:app --port 8000 --log-level warning", 1, False
' WshShell.Run "cmd /c cd /d D:\RFid_NHT_React\service && set READER_INDEX=1 && uvicorn main_dll:app --port 8001 --log-level warning", 1, False
' WshShell.Run "cmd /c cd /d D:\RFid_NHT_React\service && set READER_INDEX=2 && uvicorn main_dll:app --port 8002 --log-level warning", 1, False
' WshShell.Run "cmd /c cd /d D:\RFid_NHT_React\service && set READER_INDEX=3 && uvicorn main_dll:app --port 8003 --log-level warning", 1, False
' WshShell.Run "cmd /c cd /d D:\RFid_NHT_React\service && set READER_INDEX=4 && uvicorn main_dll:app --port 8004 --log-level warning", 1, False
