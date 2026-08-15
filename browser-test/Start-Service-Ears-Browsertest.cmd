@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Service Ears - gratis browsertest

if not exist "node\node.exe" (
  echo FOUT: De vertrouwde Node-runtime ontbreekt.
  echo Pak of kopieer de volledige map Service-Ears-Browsertest.
  pause
  exit /b 1
)

if not exist "app\server-bootstrap.cjs" (
  echo FOUT: De Service Ears-appbestanden ontbreken.
  echo Pak of kopieer de volledige map Service-Ears-Browsertest.
  pause
  exit /b 1
)

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo FOUT: Microsoft Edge is niet gevonden.
  echo Installeer of herstel Microsoft Edge en probeer opnieuw.
  pause
  exit /b 1
)

set "HOSTNAME=127.0.0.1"
set "PORT=3210"
set "NODE_PATH=%CD%\app\runtime_modules"
set "POS_ADAPTER=mock"
set "ORDER_ENGINE_MODE=deterministic"
set "DEBUG_RETAIN_CONVERSATION=false"
set "OPENAI_API_KEY="
set "LOCAL_WHISPER_CLI="
set "LOCAL_WHISPER_MODEL="

echo Service Ears start op http://127.0.0.1:3210/
echo Microsoft Edge opent automatisch na enkele seconden.
echo.
echo Laat dit venster open tijdens het testen.
echo Sluit het venster of druk Ctrl+C om Service Ears te stoppen.
echo.

start "" /B powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process -FilePath '%EDGE%' -ArgumentList 'http://127.0.0.1:3210/'"
"node\node.exe" "app\server-bootstrap.cjs"

echo.
echo Service Ears is gestopt.
pause
