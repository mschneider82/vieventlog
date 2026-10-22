# ViEventLog Skripte

Skripte automatisieren Einstellungen deiner Anlage, z.B. „Warmwasser im Sommer kühler“ oder „um 17 Uhr Warmwasser bereiten“.
Sie werden in der Ausdruckssprache [expr](https://expr-lang.org/docs/language-definition) geschrieben und nach einem
Zeitplan (Cron) im Hintergrund ausgeführt. Jedes Skript gehört zu genau einem Gerät; alle Funktionen beziehen sich auf dieses Gerät.

## Grundlagen

- **Zeitplan** im Cron-Format mit 5 Feldern `Minute Stunde Tag Monat Wochentag` (lokale Zeit):
  `* * * * *` = jede Minute, `*/15 * * * *` = alle 15 Minuten, `0 17 * * *` = täglich 17:00,
  `0 6 * * 1-5` = werktags 6:00. Kurzformen: `@every 5m`, `@hourly`, `@daily`.
- **Datenquelle**: Skripte rufen die Viessmann-API für Werte praktisch nie selbst ab, damit das API-Limit (ca. 1450 Aufrufe/Tag)
  auch bei minütlichen Skripten hält. Werte kommen aus dem Live-Daten-Cache, den Temperatur-Logging und Dashboard füllen,
  bzw. aus dem letzten Eintrag der Temperatur-Historie (SQLite), solange sie höchstens 30 Minuten alt sind.
  Nur wenn keine aktuellen Daten vorliegen, holt ein Skript sie selbst – höchstens einmal pro Gerät alle 30 Minuten.
  **Empfehlung:** Temperatur-Logging aktivieren; dann verursachen Skripte für Werte keine zusätzlichen API-Aufrufe.
- **Aktionen** (`set...`, `start...`) prüfen zuerst den aktuellen Wert und rufen die API nur auf, wenn sich etwas ändert.
  Sie geben `true` zurück, wenn etwas geändert wurde, sonst `false`. Eine identische Aktion wird innerhalb von 15 Minuten
  nicht wiederholt (die Cloud übernimmt neue Werte verzögert). Maximal 10 Aktionen pro Lauf.
- **Testlauf**: führt das Skript aus, ohne Aktionen auszuführen oder Variablen zu speichern, und zeigt, was passieren würde.
- Ein Wert ist `nil`, wenn das Gerät das Feature nicht hat oder (bei `history`) keine Daten vorliegen. Mit `??` einen Ersatzwert angeben.

## Syntax (Kurzfassung)

| Element | Beispiel |
|---|---|
| Variable | `let t = outsideTemp();` (mehrere mit `;` trennen, der letzte Ausdruck ist das Ergebnis) |
| Bedingung | `if t > 18 { a() } else { b() }` (`else` ist Pflicht, `else if` möglich) |
| Kurzform | `t > 18 ? setDhwTemperature(50) : setDhwTemperature(53)` |
| Logik | `and` / `&&`, `or` / `||`, `not` / `!` |
| Vergleich | `==  !=  <  <=  >  >=`, Text: `contains`, `startsWith`, `in` |
| Ersatzwert | `outsideTemp() ?? 10` |
| Kommentar | `// Zeile` oder `/* Block */` |
| Mehrere Anweisungen | `log("a"); setDhwTemperature(50)` |
| Nichts tun | `false` oder `nil` im `else`-Zweig |

Eingebaute expr-Funktionen wie `abs()`, `round()`, `min()`, `max()`, `now()`, `date()`, `duration()`, `upper()` usw.
stehen ebenfalls zur Verfügung (siehe expr-Dokumentation). Schleifen gibt es nicht; Skripte laufen höchstens 60 Sekunden.

## Werte

| Funktion | Beschreibung | Beispiel |
|---|---|---|
| `outsideTemp()` | Außentemperatur in °C. | `outsideTemp() > 18` |
| `dhwTemp()` | Aktuelle Warmwasser-Speichertemperatur in °C. | `dhwTemp() < 45` |
| `dhwTarget()` | Eingestellte Warmwasser-Solltemperatur in °C. | `dhwTarget() == 53` |
| `supplyTemp(circuit)` | Vorlauftemperatur eines Heizkreises in °C (circuit 0 = erster Heizkreis). | `supplyTemp(0)` |
| `returnTemp()` | Rücklauftemperatur in °C. |  |
| `compressorActive()` | true, wenn der Verdichter der Wärmepumpe läuft. |  |
| `heatingMode(circuit)` | Betriebsart eines Heizkreises, z.B. "heating", "standby", "cooling". | `heatingMode(0) == "heating"` |
| `dhwMode()` | Warmwasser-Betriebsart, z.B. "efficient", "off". |  |
| `feature(name)` | Wert (properties.value) eines beliebigen Viessmann-Features oder nil. Feature-Namen siehe Dashboard / /api/features. | `feature("heating.circuits.0.heating.curve") ?? 0` |
| `featureProp(name, property)` | Beliebige Eigenschaft eines Features, z.B. slope der Heizkurve oder active des Verdichters. | `featureProp("heating.circuits.0.heating.curve", "slope")` |
| `history(column, minutes, agg)` | Aggregat einer Spalte der Temperatur-Historie dieses Geräts über die letzten Minuten. agg: "avg", "min", "max", "sum", "count", "last". Spalten wie outside_temp, dhw_temp, supply_temp, compressor_power (W), thermal_power (kW), compressor_active. Benötigt aktiviertes Temperatur-Logging. | `history("outside_temp", 120, "avg") > 18` |

## Zeit

| Funktion | Beschreibung | Beispiel |
|---|---|---|
| `hour()` | Aktuelle Stunde (0–23, lokale Zeit). | `hour() >= 17` |
| `minute()` | Aktuelle Minute (0–59). |  |
| `weekday()` | Wochentag 1 = Montag … 7 = Sonntag. | `weekday() >= 6 // Wochenende` |
| `timeBetween(from, to)` | true, wenn die aktuelle Uhrzeit im Bereich liegt ("HH:MM", inkl. Bereich über Mitternacht). | `timeBetween("22:00", "06:00")` |

## Variablen & Ausgabe

| Funktion | Beschreibung | Beispiel |
|---|---|---|
| `get(key[, default])` | Liest eine dauerhaft gespeicherte Variable dieses Skripts (bleibt zwischen Läufen erhalten). | `get("mode", "normal")` |
| `set(key, value)` | Speichert eine Variable dauerhaft (nicht im Testlauf). Gibt value zurück. | `set("mode", "sommer")` |
| `log(values...)` | Schreibt eine Zeile in das Ausführungsprotokoll. Gibt true zurück. | `log("Außen:", outsideTemp())` |

## Aktionen

| Funktion | Beschreibung | Beispiel |
|---|---|---|
| `setDhwTemperature(celsius)` | Setzt die Warmwasser-Solltemperatur. | `setDhwTemperature(50)` |
| `setDhwTemperature2(celsius)` | Setzt die zweite Warmwasser-Solltemperatur (temp2). |  |
| `setDhwHysteresis(type, kelvin)` | Setzt die Warmwasser-Hysterese, type "on" (Einschalten) oder "off" (Ausschalten). | `setDhwHysteresis("on", 5)` |
| `setDhwMode(mode)` | Setzt die Warmwasser-Betriebsart (Werte je nach Gerät, siehe dhwMode()). | `setDhwMode("efficient")` |
| `startDhwOneTimeCharge()` | Startet eine einmalige Warmwasserbereitung (übersprungen, wenn sie bereits läuft). | `hour() == 17 && minute() == 0 ? startDhwOneTimeCharge() : false` |
| `setHeatingCurve(circuit, slope, shift)` | Setzt die Heizkurve: Neigung 0.2–3.5, Niveau -13 bis 40. | `setHeatingCurve(0, 0.6, 2)` |
| `setHeatingMode(circuit, mode)` | Setzt die Betriebsart eines Heizkreises: "heating", "standby", "cooling", "heatingCooling". | `setHeatingMode(0, "standby")` |
| `setSupplyTempMax(circuit, celsius)` | Setzt die maximale Vorlauftemperatur eines Heizkreises. |  |
| `setRoomTemperature(circuit, program, celsius)` | Setzt die Raum-Solltemperatur eines Programms: "normal", "comfort", "reduced". | `setRoomTemperature(0, "normal", 21)` |
| `setNoiseReductionMode(mode)` | Setzt die Geräuschreduzierung: "notReduced", "slightlyReduced", "maxReduced". | `setNoiseReductionMode(timeBetween("22:00", "06:00") ? "maxReduced" : "notReduced")` |

## Beispiele

**Warmwasser abhängig von der Außentemperatur** (Zeitplan `*/5 * * * *`). Der Mittelwert über 2 Stunden und
eine Schaltlücke (Hysterese) verhindern ständiges Umschalten um 18 °C:

```
let t = history("outside_temp", 120, "avg") ?? outsideTemp();
if t > 18.5 {
  setDhwTemperature(50)
} else if t < 17.5 {
  setDhwTemperature(53)
} else {
  false // zwischen 17,5 und 18,5 °C nichts ändern
}
```

**Täglich um 17 Uhr Warmwasser bereiten** (Zeitplan `0 17 * * *`):

```
startDhwOneTimeCharge()
```

**Nachts leiser** (Zeitplan `*/10 * * * *`):

```
setNoiseReductionMode(timeBetween("22:00", "06:00") ? "maxReduced" : "notReduced")
```

**Zustand merken**: nur einmal pro Tag melden, wenn der Speicher kalt ist:

```
let today = now().Format("2006-01-02");
if (dhwTemp() ?? 99) < 40 && get("warned") != today {
  log("Warmwasser nur", dhwTemp(), "°C"); set("warned", today)
} else {
  false
}
```
