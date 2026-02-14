#!/bin/bash
set -e

# System-User vieventlog erstellen falls nicht vorhanden
if ! getent passwd vieventlog >/dev/null; then
    useradd --system --home-dir /var/lib/vieventlog --no-create-home \
            --shell /usr/sbin/nologin --comment "Viessmann Event Viewer" \
            --user-group vieventlog
fi

# Config-Verzeichnis mit korrekten Berechtigungen
mkdir -p /var/lib/vieventlog
chown vieventlog:vieventlog /var/lib/vieventlog
chmod 750 /var/lib/vieventlog

# Systemd daemon reload
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload >/dev/null 2>&1 || true
fi

# Service aktivieren (bei Neuinstallation nicht automatisch starten)
if [ "$1" = "configure" ] && [ -z "$2" ]; then
    # Neuinstallation
    systemctl enable vieventlog.service >/dev/null 2>&1 || true
    echo ""
    echo "ViEventLog wurde erfolgreich installiert!"
    echo ""
    echo "Nächste Schritte:"
    echo "  1. Konfiguration bearbeiten: sudo nano /etc/default/vieventlog"
    echo "  2. Service starten: sudo systemctl start vieventlog"
    echo "  3. Status prüfen: sudo systemctl status vieventlog"
    echo "  4. Logs anzeigen: sudo journalctl -u vieventlog -f"
    echo ""
    echo "Web-Interface: http://localhost:5000"
    echo ""
elif [ "$1" = "configure" ] && [ -n "$2" ]; then
    # Upgrade - neu starten falls bereits laufend
    if systemctl is-active --quiet vieventlog.service; then
        systemctl restart vieventlog.service >/dev/null 2>&1 || true
        echo "ViEventLog wurde aktualisiert und neu gestartet."
    fi
fi

exit 0
