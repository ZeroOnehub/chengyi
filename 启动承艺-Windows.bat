@echo off
chcp 65001 >nul
cd /d "%~dp0server"
for %%V in (3.14 3.13 3.12 3) do (
  py -%%V -c "import sys; sys.exit(sys.version_info < (3,12))" >nul 2>&1
  if not errorlevel 1 (
    py -%%V scripts\launch_shared.py --port 8010
    goto finish
  )
)
python scripts\launch_shared.py --port 8010
:finish
pause
