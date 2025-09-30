# ViEventLog

Ein benutzerfreundlicher Web-Viewer zur Visualisierung und Analyse von Betriebszuständen und Events Ihrer Viessmann Heizungsanlage über die Viessmann Developer API.

## Hintergrund

Mit der [Abschaltung von ViGuide](https://community.viessmann.de/t5/Konnektivitaet/Bekanntmachung-Abschaltung-von-ViGuide-fuer-ViCare-Benutzer/td-p/433964) durch Viessmann verlieren Anlageneigentümer die bisherige Möglichkeit, das Event-Log ihrer Heizung einzusehen. ViEventLog bietet hier eine moderne Alternative und macht diese wichtigen Informationen wieder zugänglich.

**Entwicklungshinweis:** Dieses Projekt wurde mit Unterstützung von AI entwickelt und steht als Open-Source-Lösung für die Community zur Verfügung.

**Tipp:** Wenn Sie sich für Verbraucherschutz-Tools interessieren, schauen Sie sich auch mein Projekt [RauchmelderApp.de](https://www.RauchmelderApp.de) an – eine kostenfreie Alternative zu teuren Ablesefirmen für die jährliche Rauchmelderwartung.

![ViEventLog Screenshot](screenshot1.png)

## Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert.

## Wichtige Hinweise

**Nur für private, nicht-kommerzielle Nutzung**

Diese Anwendung verwendet die Viessmann Developer API und unterliegt den Nutzungsbedingungen des Viessmann Developer Portal. Die Nutzung ist ausschließlich für private, nicht-kommerzielle Zwecke und zur Steuerung eigener Viessmann-Anlagen gestattet.

**Eigener Developer Portal Account erforderlich**

Jeder Benutzer muss einen eigenen Account im Viessmann Developer Portal erstellen und seine eigenen API-Credentials verwenden. Die Weitergabe von API-Credentials an Dritte ist nicht gestattet.

## Voraussetzungen

### Viessmann Developer Portal Account erstellen

Bevor Sie den Event Viewer nutzen können, müssen Sie einen API-Client im Viessmann Developer Portal erstellen:

1. **Anmelden beim Developer Portal**
   - Öffnen Sie https://app.developer.viessmann.com/
   - Melden Sie sich mit Ihren ViCare App Zugangsdaten an (die gleichen
     Credentials, die Sie in der ViCare App verwenden), Sofern schon eine
     HomeAssitant integration verwendet wird, kann auch die ClientID von
     HomeAssitant verwendet werden.

2. **API Client erstellen**
   - Klicken Sie auf "API-Client erstellen" oder "Create API Client"
   - Geben Sie folgende Daten ein:
     - **Name**: EventViewer (oder ein beliebiger Name für Ihre Anwendung)
     - **Google reCAPTCHA**: Deaktiviert (disabled)
     - **Redirect URIs**: `vicare://oauth-callback/everest`
   - Bestätigen Sie die Erstellung

3. **Client ID notieren**
   - Nach der Erstellung wird Ihnen eine **Client ID** angezeigt
   - Kopieren Sie diese Client ID - Sie benötigen sie für die Einrichtung des Event Viewers
   - Die Client ID ist eine lange alphanumerische Zeichenfolge (z.B. `ab741319e11245de5f91d15ff4cac2c1`)

### Systemanforderungen

- Go 1.21 oder höher (für die Kompilierung)
- Linux: libsecret / gnome-keyring für sichere Credential-Speicherung
- macOS: Keychain (bereits vorhanden)
- Windows: Credential Manager (bereits vorhanden)

## Installation

### Option 1: Binary herunterladen (empfohlen)

Laden Sie die vorkompilierte Binary für Ihr Betriebssystem von den [GitHub Releases](https://github.com/mschneider82/vieventlog/releases) herunter.

### Option 2: Aus Quellcode kompilieren

```bash
go mod download
go build
```

Nach erfolgreicher Kompilierung erhalten Sie eine ausführbare Datei `vieventlog`.

## Verwendung

### Erste Schritte

1. **ViEventLog starten**
   ```bash
   ./vieventlog
   ```

2. **Browser öffnen**

   Öffnen Sie `http://localhost:5000` in Ihrem Browser

3. **Anmelden**

   Beim ersten Start werden Sie zur Login-Seite weitergeleitet. Geben Sie folgende Daten ein:
   - **E-Mail**: Ihre ViCare App E-Mail-Adresse
   - **Passwort**: Ihr ViCare App Passwort
   - **Client ID**: Die Client ID aus dem Developer Portal (siehe Voraussetzungen)

4. **Zugangsdaten werden gespeichert**

   Nach erfolgreicher Anmeldung werden Ihre Zugangsdaten sicher im System-Keyring gespeichert. Sie müssen sich beim nächsten Start nicht erneut anmelden.

### Port ändern (optional)

Standardmäßig läuft ViEventLog auf Port 5000. Sie können einen anderen Port verwenden:

```bash
PORT=8080 ./vieventlog
```

## Features

### Multi-Account-Unterstützung

Der Event Viewer unterstützt mehrere Viessmann-Accounts gleichzeitig. Dies ist nützlich, wenn Sie mehrere Heizungsanlagen mit unterschiedlichen ViCare-Accounts verwalten.

**Account-Verwaltung aufrufen:**
- Klicken Sie auf das Zahnrad-Symbol oben rechts in der Hauptansicht
- Oder öffnen Sie direkt: `http://localhost:5000/accounts`

**Funktionen:**
- Mehrere Accounts hinzufügen
- Accounts aktivieren/deaktivieren
- Accounts bearbeiten oder löschen
- Events von allen aktiven Accounts werden kombiniert angezeigt
- Jedes Event zeigt den zugehörigen Account und Standort

### Timeline-Visualisierung

Die Timeline zeigt grafisch die Betriebszustände Ihrer Heizungsanlage über die Zeit:

- Farbcodierte Zustände: Heizen, Warmwasser, Vorlauf, Nachlauf, Aus
- Anzeige von Dauer und Start-/Ende-Zeiten
- Berücksichtigung von Ventilstellungen (Heizen vs. Warmwasser-Bereitung)

### Event-Liste mit Filterung

- Chronologische Sortierung (neueste zuerst)
- Filterung nach Installation/Gerät
- Filterung nach Event-Typ (Status-Codes/Fehler-Codes/Aktive Events)
- Freitext-Suche über alle Event-Felder
- Zeitraum-Filter: 24 Stunden bis alle Events

### Deutsche Error-Code-Übersetzung

Automatische Übersetzung von Viessmann Status- und Fehler-Codes:

- **S-Codes (Status)**: Betriebszustände wie "Heizen", "Warmwasser-Bereitung", "Abtauung"
- **F-Codes (Fehler)**: Störungen wie Sensorfehler, Druckprobleme
- Automatische Kategorisierung und Schweregrad-Erkennung

### Sichere Credential-Speicherung

Ihre Zugangsdaten werden sicher im System-Keyring gespeichert, nicht auf der Festplatte:

- **Linux**: libsecret / gnome-keyring
- **macOS**: Keychain
- **Windows**: Credential Manager

### Event-Caching und Performance

- Events werden 5 Minuten gecacht für schnellere Ladezeiten
- Thread-safe Implementierung mit Mutex-Synchronisation
- OAuth2 Token werden pro Account gecacht
- Automatisches Token-Refresh

## API Endpoints

### Hauptseiten

- `GET /` - Web UI (Event-Viewer)
- `GET /login` - Login-Seite
- `GET /accounts` - Account-Verwaltung

### API

#### Events und Status
- `GET /api/events?days=7` - Events abrufen (Parameter: 1, 7, 14, 30 oder 365 für "Alle")
- `GET /api/status` - Verbindungsstatus und Account-Info
- `GET /api/devices` - Geräteliste gruppiert nach Installation

#### Account-Verwaltung
- `GET /api/accounts` - Liste aller gespeicherten Accounts
- `POST /api/accounts/add` - Account hinzufügen
  ```json
  {
    "name": "Haupthaus",
    "email": "ihre@email.de",
    "password": "ihr-passwort",
    "clientId": "ihre-client-id",
    "active": true
  }
  ```
- `POST /api/accounts/toggle` - Account aktivieren/deaktivieren
  ```json
  {
    "id": "account-id",
    "active": true
  }
  ```
- `POST /api/accounts/delete` - Account löschen
  ```json
  {
    "id": "account-id"
  }
  ```

#### Login
- `POST /api/login` - Anmeldung mit Viessmann-Credentials
  ```json
  {
    "email": "ihre@email.de",
    "password": "ihr-passwort",
    "clientId": "ihre-client-id"
  }
  ```
- `GET /api/credentials/check` - Prüft, ob gespeicherte Credentials vorhanden sind

## Technische Details

### Architektur

- **Backend**: Go mit integriertem HTTP-Server
- **Frontend**: Vanilla JavaScript, keine externen Frameworks
- **Templates**: Embedded HTML-Templates (keine externen Dateien erforderlich)
- **Storage**: System-Keyring für Credentials, Memory-Cache für Events und Tokens

### Dependencies

- Go Standard Library
- System-Keyring Libraries (plattformabhängig)

### Build-Eigenschaften

- Standalone Binary ohne externe Abhängigkeiten zur Laufzeit
- Alle Templates sind im Binary eingebettet
- Geringer Memory-Footprint
- Schnelle Startzeit

## Troubleshooting

### Login schlägt fehl

- Überprüfen Sie Ihre ViCare App Zugangsdaten
- Stellen Sie sicher, dass die Client ID korrekt aus dem Developer Portal kopiert wurde
- Prüfen Sie, ob die Redirect URI im Developer Portal korrekt konfiguriert ist: `vicare://oauth-callback/everest`

### Events werden nicht angezeigt

- Überprüfen Sie, ob mindestens ein Account aktiviert ist (Account-Verwaltung)
- Stellen Sie sicher, dass Ihre Viessmann-Anlage Events generiert hat
- Prüfen Sie den Zeitraum-Filter (Standard: "Alle")

### Keyring-Fehler unter Linux

Falls der Keyring nicht verfügbar ist, installieren Sie:
```bash
# Debian/Ubuntu
sudo apt-get install gnome-keyring libsecret-1-0

# Fedora/RHEL
sudo dnf install gnome-keyring libsecret
```

## Entwicklung

### Tests ausführen

```bash
go test -v ./...
```

### Code formatieren

```bash
go fmt ./...
go vet ./...
```

### Dependencies aktualisieren

```bash
go mod tidy
```

## Beiträge

Contributions sind willkommen! Bitte beachten Sie:
- Code sollte den Go-Konventionen folgen (`go fmt`, `go vet`)
- Neue Features sollten dokumentiert werden
- Bug-Reports mit reproduzierbaren Schritten sind hilfreich

## Support

**Hinweis:** Diese Software wurde größtenteils mit AI-Unterstützung entwickelt.

Bei Fragen, Problemen oder Anregungen öffnen Sie bitte ein Issue auf GitHub. Wir freuen uns über Bug-Reports und Feature-Vorschläge!

## Haftungsausschluss

Diese Software wird "wie besehen" ohne jegliche Garantie bereitgestellt. Die Nutzung erfolgt auf eigenes Risiko. Der Autor übernimmt keine Haftung für Schäden, die durch die Nutzung dieser Software entstehen.

Diese Software ist nicht offiziell von Viessmann unterstützt. Sie verwendet die öffentliche Viessmann Developer API gemäß den Nutzungsbedingungen.