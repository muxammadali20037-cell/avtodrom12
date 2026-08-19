@echo off
setlocal
cd /d "%~dp0"
title AVTODROM - Ishga tushirish

echo ========================================
echo        AVTODROM MANAGEMENT SYSTEM
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [XATO] Node.js topilmadi.
  echo Node.js 20+ o'rnatilgan bo'lishi kerak.
  echo.
  pause
  exit /b 1
)

if not exist "backend\node_modules" (
  echo [1/3] Backend kutubxonalari o'rnatilmoqda...
  cd backend
  call npm install
  if errorlevel 1 (
    echo [XATO] npm install bajarilmadi.
    pause
    exit /b 1
  )
  cd ..
)

if not exist "backend\.env" (
  if exist "backend\.env.example" (
    copy /Y "backend\.env.example" "backend\.env" >nul
    echo [!] backend\.env yaratildi.
    echo [!] DATABASE_URL va JWT_SECRET ni tekshiring.
  )
)

echo [2/3] Avtodrom serveri ishga tushmoqda...
start "AVTODROM SERVER" cmd /k "cd /d "%~dp0backend" && npm start"

timeout /t 3 /nobreak >nul

echo [3/3] Brauzer ochilmoqda...
start "" "http://localhost:3000"

echo.
echo AVTODROM ishga tushirildi.
echo Manzil: http://localhost:3000
echo Server oynasini yopmang.
echo.
endlocal
