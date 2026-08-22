@echo off
chcp 936 >nul
cd /d "%~dp0"
set HTTPS_PROXY=http://127.0.0.1:7897
set HTTP_PROXY=http://127.0.0.1:7897
set ALL_PROXY=http://127.0.0.1:7897
echo ============================================
echo   Pushing updates to GitHub...
echo ============================================
echo.
"C:\Program Files\Git\cmd\git.exe" add -A
"C:\Program Files\Git\cmd\git.exe" commit -m "update site"
"C:\Program Files\Git\cmd\git.exe" push origin main
echo.
if %errorlevel%==0 (
    echo ============================================
    echo   SUCCESS! Site updated.
    echo ============================================
    echo   Visit:  https://wsr666914.github.io/
    echo.
) else (
    echo ============================================
    echo   FAILED - check proxy (Clash)
    echo ============================================
)
echo Press any key to close...
pause >nul
