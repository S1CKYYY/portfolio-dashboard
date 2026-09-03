@echo off
cd /d "%~dp0"
python tools/update_fedwatch.py
if %errorlevel% equ 0 (
    git add fedwatch_cache.json
    git diff --staged --quiet || git commit -m "chore: FedWatch auto-update %date%"
    git push
    echo FedWatch aktualizovan OK
) else (
    echo FedWatch selhal - ZQ futures nedostupne mimo obchodni hodiny
)
