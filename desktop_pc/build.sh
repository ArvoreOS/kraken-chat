#!/bin/bash
# Empacota o Kraken pra Windows como um .exe único (PyInstaller), sem
# precisar de Python instalado na máquina de quem vai usar.
#
# Uso: bash desktop_pc/build.sh
# Gera: desktop_pc/dist/Kraken.exe
set -e
cd "$(dirname "$0")"
SRC=../app/src/main/python

pip install --quiet --upgrade pyinstaller

python -m PyInstaller --onefile --windowed --name Kraken --icon kraken.ico \
  --distpath dist --workpath build \
  --add-data "$SRC/static;static" \
  --add-data "$SRC/templates;templates" \
  --hidden-import engineio.async_drivers.threading \
  --hidden-import engineio.async_drivers \
  "$SRC/server.py"

echo
echo "Pronto: desktop_pc/dist/Kraken.exe"
