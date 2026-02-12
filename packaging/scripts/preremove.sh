#!/bin/bash
set -e

# Service stoppen vor Deinstallation
if [ -d /run/systemd/system ] && systemctl is-active --quiet vieventlog.service; then
    systemctl stop vieventlog.service >/dev/null 2>&1 || true
fi

# Service deaktivieren
if [ "$1" = "remove" ]; then
    systemctl disable vieventlog.service >/dev/null 2>&1 || true
fi

exit 0
