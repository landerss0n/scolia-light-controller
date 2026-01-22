@echo off
title Installation - Scolia Light Controller
echo.
echo ================================================
echo   SCOLIA LIGHT CONTROLLER
echo   Installerar dependencies...
echo ================================================
echo.

REM Kontrollera om node är installerat
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [FEL] Node.js är inte installerat!
    echo.
    echo Ladda ner och installera Node.js från:
    echo https://nodejs.org/
    echo.
    echo Välj LTS-versionen (Long Term Support)
    echo.
    pause
    exit /b 1
)

echo Node.js version:
node --version
echo.

echo NPM version:
npm --version
echo.

echo Installerar paket...
call npm install

echo.
echo ================================================
echo   INSTALLATION KLAR!
echo ================================================
echo.
echo Nästa steg:
echo 1. Redigera config.json med era inställningar
echo 2. Dubbelklicka på simulator.bat för att testa
echo 3. När allt fungerar, dubbelklicka på start.bat
echo.
pause
