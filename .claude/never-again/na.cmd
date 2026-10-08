@echo off
rem never-again CLI wrapper for cmd.exe and PowerShell, where the sh/python
rem polyglot next to this file cannot be run directly.
setlocal
set "NA=%~dp0na"
if defined NA_PYTHON ( "%NA_PYTHON%" "%NA%" %* & exit /b %errorlevel% )
python -c "import sys" >nul 2>&1 && ( python "%NA%" %* & exit /b %errorlevel% )
py -c "import sys" >nul 2>&1 && ( py "%NA%" %* & exit /b %errorlevel% )
echo never-again: no working python found 1>&2
exit /b 1
