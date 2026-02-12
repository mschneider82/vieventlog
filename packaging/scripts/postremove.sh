#!/bin/bash
set -e

# Systemd daemon reload
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload >/dev/null 2>&1 || true
fi

# Bei purge: User und Daten entfernen
if [ "$1" = "purge" ]; then
    if getent passwd vieventlog >/dev/null; then
        userdel vieventlog >/dev/null 2>&1 || true
    fi

    if [ -d /var/lib/vieventlog ]; then
        rm -rf /var/lib/vieventlog
    fi

    echo "ViEventLog wurde vollständig entfernt (inkl. Konfiguration und Daten)."
fi

exit 0
