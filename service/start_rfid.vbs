Set WshShell = CreateObject("WScript.Shell")
    ' Python readers Server
    ' WshShell.Run "cmd /k cd /d D:\WebApp\NHT_Bearing\RFID_Washing\service && python start_rfid.py", 1, False
    ' Python readers Local
    WshShell.Run "cmd /k cd /d D:\RFid_NHT_Washing\service && C:\Users\bptk654\AppData\Local\Programs\Python\Python314-32\python.exe start_rfid.py", 1, False