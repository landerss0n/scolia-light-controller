@echo off
title Scolia Dart Simulator
echo.
echo ================================================
echo   SCOLIA DART SIMULATOR
echo   Testa ljuseffekter utan darttavla
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
    pause
    exit /b 1
)

REM Kontrollera om node_modules finns
if not exist "node_modules\" (
    echo Dependencies saknas, installerar...
    call npm install
    echo.
)

REM Starta simulatorn
node simulator.js

pause
