# 📊 Grafana-Style Timeline Prototyp

## Überblick

Dieser Prototyp verbessert die Event-Visualisierung von ViEventLog mit einem modernen, Grafana-ähnlichen Interface. Er bietet deutlich bessere Interaktivität, Zoom- und Pan-Funktionen sowie flexible Zeitsteuerung.

## 🎯 Features

### 1. **Moderne Timeline-Visualisierung mit Apache ECharts**
- **Warum ECharts?**
  - Hochperformant und optimiert für große Datenmengen
  - Native Zoom & Pan Unterstützung
  - Hervorragende Gantt/Timeline-Visualisierung
  - Von der Community bewährt (auch bei Grafana Labs)
  - Open Source und gut dokumentiert

### 2. **Interaktive Zoom & Pan Funktionen**
- **Mausrad-Zoom**: Scrollen zum Hinein-/Herauszoomen
- **Drag & Pan**: Timeline verschieben durch Ziehen
- **Touch-Support**: Pinch-to-Zoom auf mobilen Geräten
- **DataZoom-Slider**: Visueller Schieberegler unterhalb der Timeline
- **Doppelklick-Reset**: Zoom auf Standardansicht zurücksetzen

### 3. **Flexible Zeitbereichs-Steuerung**
- **Quick-Range Buttons**:
  - Letzte 1h, 6h, 12h, 24h, 3 Tage, 7 Tage
- **Benutzerdefinierte Zeitbereiche**:
  - Datum/Zeit-Picker für Start und Ende
  - Echtzeit-Aktualisierung beim Ändern
- **Zeitzone-Aware**: Verwendet Luxon.js für korrekte Zeitverarbeitung

### 4. **Erweiterte Filter-Funktionen**
- **Event-Typ Filter**:
  - Alle 22 Event-Typen als bunte Chips
  - Icons für bessere Erkennbarkeit (🔥 Heizen, 🚿 WW-Bereitung, etc.)
  - Click-to-toggle Aktivierung
- **Geräte-Filter**:
  - Nach Installation und Device filtern
  - Multi-Select möglich

### 5. **Verbesserte Tooltips**
- Detaillierte Informationen zu jedem Event:
  - Icon und Name des Event-Typs
  - Beschreibung
  - Start- und Endzeit (präzise auf Sekunde)
  - Berechnete Dauer (automatisch formatiert)
- Elegantes Dark-Theme Design

### 6. **Live-Statistiken**
- **Gesamt Events**: Anzahl aller geladenen Events
- **Angezeigte Events**: Nach Filter aktive Events
- **Geräte**: Anzahl der aktiven Geräte
- **Zeitspanne**: Aktuell angezeigte Zeitdauer

### 7. **Responsives Design**
- Optimiert für Desktop, Tablet und Mobile
- Automatische Anpassung der Timeline-Höhe
- Touch-optimierte Bedienung

## 🚀 Verwendung

### Zugriff
Nach dem Start der Anwendung:
```
http://localhost:3000/grafana-timeline
```

### Bedienung

#### Zeitbereich ändern
1. **Quick Range**: Klick auf einen der Buttons (z.B. "Letzte 24h")
2. **Benutzerdefiniert**:
   - Wähle Start- und Endzeit in den Datum/Zeit-Feldern
   - Klicke "Anwenden"

#### Zoomen
- **Mausrad**: Über Timeline scrollen
- **DataZoom-Slider**: Griffe am unteren Slider ziehen
- **Pinch**: Zwei Finger auf Touch-Geräten

#### Panning
- **Drag**: Timeline mit gedrückter Maustaste verschieben
- **Swipe**: Auf Touch-Geräten wischen

#### Filtern
- **Event-Typen**: Auf farbige Chips klicken zum An-/Ausschalten
- **Geräte**: Auf Geräte-Chips klicken zum Filtern

#### Zoom zurücksetzen
- **Button**: "Zoom zurücksetzen" Button klicken
- **Doppelklick**: Auf Timeline doppelklicken

## 🎨 Design-Philosophie

### Farben & Kontraste
- **Dunkles Theme**: Reduziert Augenbelastung bei langer Nutzung
- **Gradient-Hintergründe**: Moderne Ästhetik
- **Farbcodierung**: Konsistent mit Original (Event-Typen haben gleiche Farben)
- **Hoher Kontrast**: Gute Lesbarkeit auch bei Umgebungslicht

### Layout
- **Card-basiert**: Alle Bereiche in abgerundeten Karten
- **Spacing**: Großzügige Abstände für bessere Übersicht
- **Hierarchie**: Klare visuelle Hierarchie durch Größen und Farben

### Interaktivität
- **Hover-Effekte**: Alle interaktiven Elemente haben Hover-States
- **Transitions**: Sanfte Animationen bei Interaktionen
- **Feedback**: Visuelle Bestätigung bei jeder Aktion

## 🔧 Technische Details

### Dependencies
- **Apache ECharts 5.4.3**: Timeline-Visualisierung
- **Luxon 3.4.4**: Datum/Zeit-Verarbeitung (modern, besser als Moment.js)

### API-Integration
Verwendet die bestehende `/api/events?days=7` API:
```javascript
GET /api/events?days=7
Response: {
  events: [
    {
      eventTimestamp: "2025-11-14T10:30:00Z",
      errorCode: "S.125",
      active: true,
      deviceId: "...",
      modelId: "...",
      ...
    }
  ]
}
```

### Event-Processing
Der Prototyp implementiert die gleiche State-Machine-Logik wie das Original:
1. Events nach Device gruppieren
2. Aktive/Inaktive Pairs zu Spans umwandeln
3. Spezialbehandlung für:
   - S.125-WARMWATER (Overlay-Spans bei Ventilwechsel)
   - Ventilpositionen (S.112-S.118, S.134-S.136)
   - Fallback für Events ohne `active` Flag (5min Default-Dauer)

### Performance-Optimierungen
- **Lazy Rendering**: Nur sichtbare Bereiche werden gerendert
- **DataZoom**: ECharts rendert nur den gezoomten Bereich
- **Filter vor Render**: Events werden client-side gefiltert
- **Canvas-basiert**: ECharts nutzt Canvas für bessere Performance

## 📱 Browser-Kompatibilität

### Unterstützte Browser
- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Mobile Safari (iOS 14+)
- ✅ Chrome Mobile (Android 10+)

### Bekannte Einschränkungen
- IE11 wird nicht unterstützt (ECharts 5 Requirement)
- Ältere Android-Browser (<= Android 9) haben eingeschränkte Touch-Support

## 🎯 Vergleich: Original vs. Prototyp

| Feature | Original | Prototyp |
|---------|----------|----------|
| **Visualisierung** | Pure SVG (custom) | Apache ECharts |
| **Zoom** | ❌ | ✅ (Mausrad, Slider, Touch) |
| **Pan** | ❌ | ✅ (Drag, Swipe) |
| **Zeitbereichs-Auswahl** | Nur Tage-Filter | ✅ Quick-Range + Custom |
| **Performance** | Gut für wenige Events | ✅ Optimiert für Tausende |
| **Mobile Support** | Grundlegend | ✅ Touch-optimiert |
| **Tooltips** | Einfach | ✅ Detailliert + formatiert |
| **DataZoom-Minimap** | ❌ | ✅ |
| **Statistiken** | ❌ | ✅ Live-Stats |
| **Responsive** | Ja | ✅ Verbessert |

## 🚧 Zukünftige Erweiterungen

### Geplante Features
1. **Export-Funktionen**
   - PNG/SVG Export der Timeline
   - CSV Export der Events
   - PDF-Report mit Statistiken

2. **Erweiterte Filter**
   - Suche in Event-Details
   - Kombination mehrerer Filter (AND/OR)
   - Gespeicherte Filter-Presets

3. **Vergleichsmodus**
   - Mehrere Geräte nebeneinander anzeigen
   - Zeiträume vergleichen

4. **Annotations**
   - Benutzer-Markierungen auf Timeline
   - Notizen zu Events hinzufügen

5. **Live-Updates**
   - WebSocket-Integration für Echtzeit-Events
   - Auto-Refresh Option

6. **Datenanalyse**
   - Statistiken über Laufzeiten
   - Trend-Analysen
   - Anomalie-Erkennung

## 📝 Migration vom Original

### Schritt-für-Schritt
1. **Parallel-Betrieb**: Beide Versionen sind verfügbar
   - Original: `http://localhost:3000/`
   - Prototyp: `http://localhost:3000/grafana-timeline`

2. **Navigation hinzufügen** (optional):
   ```html
   <!-- In index.html -->
   <a href="/grafana-timeline">Grafana-Style Timeline ansehen</a>
   ```

3. **Feedback sammeln**: Teste beide Versionen mit echten Daten

4. **Finale Migration**: Original durch Prototyp ersetzen (wenn gewünscht)

## 🐛 Bekannte Probleme

### Aktuelle Bugs
- *(Keine bekannten Bugs im Moment)*

### Workarounds
- Bei sehr großen Datenmengen (>10.000 Events): API-Request auf kleinere Zeitbereiche beschränken

## 📚 Weitere Ressourcen

- [Apache ECharts Dokumentation](https://echarts.apache.org/)
- [Luxon.js Dokumentation](https://moment.github.io/luxon/)
- [ECharts Gantt Chart Examples](https://echarts.apache.org/examples/en/editor.html?c=custom-gantt-flight)

## 🤝 Beitragen

Feedback und Verbesserungsvorschläge sind willkommen!

---

**Entwickelt mit**: Apache ECharts, Luxon.js, Vanilla JavaScript
**Lizenz**: Gleiche wie Hauptprojekt
**Version**: 1.0.0-prototype
**Datum**: 2025-11-14
