@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Service Ears 0.3.11 starten

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Service-Ears-Lokaal.ps1"
if errorlevel 1 (
  echo.
  echo Service Ears kon niet worden gestart. De technische logs staan in:
  echo %LOCALAPPDATA%\Service Ears\logs
  echo.
  pause
  exit /b 1
)
exit /b 0
