#!/usr/bin/env bash
# Ejecuta un comando y, si falla, publica sus últimas líneas como anotación
# de error de GitHub Actions (visible en el resumen del workflow).
# Uso: annotate.sh "Título" comando args...
set -uo pipefail
title="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  # Quita códigos de color y codifica para la anotación
  msg="$(tail -n 60 "$log" | sed -e 's/\x1b\[[0-9;]*m//g' | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}' | sed -e 's/\r/%0D/g')"
  echo "::error title=${title}::${msg}"
fi
exit "$status"
