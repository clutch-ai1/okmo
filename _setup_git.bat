@echo off
REM ========================================================================
REM  Okmo: Git-Setup Script
REM  Loescht das kaputte .git, initialisiert neu, committet alles.
REM  Doppelklicken zum Ausfuehren.
REM ========================================================================
setlocal
cd /d "%~dp0"
echo.
echo === [1/6] Loesche altes .git Verzeichnis ===
rmdir /s /q .git 2>nul
echo OK

echo.
echo === [2/6] git init ===
git init -b main
if errorlevel 1 (
  echo FEHLER: git scheint nicht installiert zu sein.
  echo Installiere git von https://git-scm.com/download/win und versuche es nochmal.
  pause
  exit /b 1
)

echo.
echo === [3/6] Git-User pruefen ===
git config user.name >nul 2>&1
if errorlevel 1 (
  git config user.name "Volkan"
  git config user.email "karamani.vlkn@gmail.com"
  echo Git-User gesetzt: Volkan / karamani.vlkn@gmail.com
) else (
  echo Git-User bereits konfiguriert.
)

echo.
echo === [4/6] git add . ===
git add -A
if errorlevel 1 (
  echo FEHLER beim git add.
  pause
  exit /b 1
)

echo.
echo === [5/6] git commit ===
git commit -m "Initial commit"
if errorlevel 1 (
  echo FEHLER beim git commit.
  pause
  exit /b 1
)

echo.
echo === [6/6] Status ===
git log --oneline -5 > _setup_git_done.txt 2>&1
echo Done. > _setup_git_done.txt
git log --oneline -5 >> _setup_git_done.txt 2>&1
echo.
echo ========================================================================
echo  FERTIG! Schliesse dieses Fenster und sag Claude Bescheid.
echo ========================================================================
timeout /t 5
endlocal
