@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0submit.ps1" %*
exit /b %errorlevel%
