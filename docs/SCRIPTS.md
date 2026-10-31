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
- **Wetter**: Die Wetter-Funktionen nutzen [OpenWeatherMap](https://openweathermap.org/api) (kostenloser API-Key). Einrichten auf der
  Skript-Seite unter **🌤️ Wetter** (API-Key, PLZ oder Ort, Land). ViEventLog ruft das Wetter im Hintergrund ab (Standard stündlich,
  2 API-Aufrufe), Skripte lesen nur aus diesem Cache. Die Vorhersage reicht 5 Tage in 3-Stunden-Schritten; ein Schritt gilt für
  1,5 Stunden vor bis 1,5 Stunden nach seiner Uhrzeit (der Wert für 16:00 also für 14:30–17:30). Alle Zeiten sind lokale Zeit.
- **Externe Daten**: `httpGet` liest Werte aus anderen Systemen im Heimnetz (evcc, Home Assistant, Shelly, Tasmota, ioBroker …),
  `readFile` aus Dateien, die ein anderes Programm schreibt. Ist eine Quelle nicht erreichbar, ist der Wert `nil`
  und der Grund steht im Log; das Skript läuft weiter. Einzelne Werte werden mit einem **Pfad** herausgezogen (siehe unten).
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

## Wetter

| Funktion | Beschreibung | Beispiel |
|---|---|---|
| `weather()` | Aktuelles Wetter als Map: temp, feelsLike (°C), humidity (%), clouds (Bewölkung %), wind (m/s), rain, snow (mm in der letzten Stunde), condition ("Clear", "Clouds", "Rain", "Drizzle", "Thunderstorm", "Snow", "Mist" …), description (z.B. "leichter Regen"), daylight, sunny, city. | `weather().temp < 0 or weather().condition == "Snow"` |
| `forecast(field, hours, agg)` | Aggregat der Vorhersage für die nächsten Stunden. field: temp, feelsLike, humidity, clouds, pop (Regenwahrscheinlichkeit %), rain, snow (mm je 3 h), wind. agg: "avg", "min", "max", "sum". nil, wenn keine Vorhersage vorliegt. | `forecast("temp", 24, "avg") > 16` |
| `sunny(hours[, maxClouds])` | true, wenn es in den nächsten Stunden überwiegend sonnig ist: mittlere Bewölkung bei Tageslicht ≤ maxClouds % (Standard 30). Ohne Tageslicht (nachts) false. | `sunny(3) ? startDhwOneTimeCharge() : false` |
| `sunnyBetween(from, to[, maxClouds])` | true, wenn es im Zeitfenster ("HH:MM", wie timeBetween) sonnig ist: mittlere Bewölkung bei Tageslicht ≤ maxClouds % (Standard 30). Gemeint ist das nächste Vorkommen: heute, oder morgen, wenn das Fenster heute schon vorbei ist; ein laufendes Fenster ab jetzt. Ohne Tageslicht false. | `setDhwTemperature(sunnyBetween("12:00", "16:00") ? 45 : 50)` |
| `rainy(hours[, minPop])` | true, wenn in den nächsten Stunden Niederschlag erwartet wird: Regenwahrscheinlichkeit mindestens minPop % (Standard 50). | `rainy(6)` |
| `dayForecast(day)` | Tageswerte als Map, day 0 = heute (restliche Stunden), 1 = morgen … 5: min, max, avg (°C), clouds (Bewölkung tagsüber %), sunHours (geschätzte Sonnenstunden), sunny, rain, snow (mm), pop (max. Regenwahrscheinlichkeit %), wind (max. m/s), condition, description. nil, wenn für den Tag keine Vorhersage vorliegt (heute ab ca. 22 Uhr). | `(dayForecast(1)?.max ?? 0) > 25` |
| `forecastList(hours)` | Vorhersage der nächsten Stunden als Liste von 3-Stunden-Schritten mit den Feldern von weather() plus time ("HH:MM"), date und pop. Für eigene Auswertungen mit any(), all(), filter(), map(). | `any(forecastList(12), .temp < 0)` |
| `sunrise()` | Sonnenaufgang heute als "HH:MM". | `timeBetween(sunrise(), sunset())` |
| `sunset()` | Sonnenuntergang heute als "HH:MM". |  |

## Externe Daten

| Funktion | Beschreibung | Beispiel |
|---|---|---|
| `httpGet(url[, path][, headers])` | Ruft eine URL im Heimnetz oder Internet ab (HTTP GET, max. 10 s), z.B. evcc, Home Assistant, Shelly, Tasmota, ioBroker. JSON kommt als Map/Liste/Zahl zurück, anderes als Text. path zieht einen einzelnen Wert heraus (siehe Pfade unten), headers ist eine Map, z.B. für Tokens. nil, wenn die Quelle nicht erreichbar ist oder der Pfad nicht existiert (Grund im Log). Jede URL wird pro Lauf nur einmal abgerufen. | `httpGet("http://192.168.1.10:7070/api/state", "grid.power") ?? 0` |
| `readFile(name[, path][, maxAge])` | Liest eine Datei, die ein anderes Programm schreibt (JSON oder Text), aus dem Verzeichnis für Skript-Dateien (Umgebungsvariable SCRIPT_FILES_DIR, Standard: Unterordner script-files im Config-Verzeichnis, im Container /config/script-files). path wie bei httpGet. maxAge in Minuten: nil, wenn die Datei länger nicht geändert wurde. nil, wenn die Datei fehlt (Grund im Log). | `readFile("sensors.json", "sensor_1", 15)` |
| `jsonPath(value, path)` | Zieht einen Wert aus einer Map/Liste (z.B. einem vorher mit httpGet geholten Ergebnis) oder aus JSON-Text heraus. nil, wenn der Pfad nicht existiert. | `jsonPath(state, "loadpoints[0].chargePower")` |
| `toNumber(value)` | Wandelt Text in eine Zahl: "22.5", "22,5", "22.5 °C", "100%"; true/false werden 1/0. nil, wenn es keine Zahl ist (z.B. "unavailable" bei Home Assistant), dann mit ?? einen Ersatzwert angeben. | `toNumber(httpGet(url, "state", headers)) ?? 20` |
| `regexFind(text, pattern)` | Sucht einen regulären Ausdruck (Go-Syntax) in einem Text, der kein JSON ist, z.B. HTML oder Prometheus-Metriken, und gibt die erste Klammergruppe als Text zurück (ohne Klammern den ganzen Treffer), nil ohne Treffer. Enthält das Muster \, es in Backticks statt Anführungszeichen schreiben, sonst muss jedes \ verdoppelt werden. | `toNumber(regexFind(httpGet(url), "power_watts ([0-9.]+)"))` |

## Zeit

| Funktion | Beschreibung | Beispiel |
|---|---|---|
| `hour()` | Aktuelle Stunde (0–23, lokale Zeit). | `hour() >= 17` |
| `minute()` | Aktuelle Minute (0–59). |  |
| `weekday()` | Wochentag 1 = Montag … 7 = Sonntag. | `weekday() >= 6 // Wochenende` |
| `timeBetween(from, to)` | true, wenn die aktuelle Uhrzeit im Bereich liegt ("HH:MM", inkl. Bereich über Mitternacht). | `timeBetween("22:00", "06:00")` |
| `date(value[, layout[, timezone]])` | Zeitpunkt aus Text oder Unix-Zeitstempel (Sekunden oder Millisekunden), z.B. für Zeitstempel externer Daten. Erkennt "2026-10-26T12:00:00+01:00" (RFC3339), "2026-10-26 12:00:00", "2026-10-26" und "12:00:00", sonst ein Go-Layout angeben. Ohne Zeitzone gilt lokale Zeit. now() - date(...) ergibt eine Dauer. nil, wenn value nil ist. | `now() - date(ts) < duration("15m")` |

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

## Pfade: Werte aus externen Daten herausziehen

`httpGet`, `readFile` und `jsonPath` ziehen mit einem Pfad einen einzelnen Wert aus einer JSON-Antwort. Beispiel-Antwort
von evcc (`http://evcc:7070/api/state`, gekürzt):

```
{"grid": {"power": -2592.3}, "pvPower": 5400, "homePower": 650,
 "loadpoints": [{"title": "Garage", "chargePower": 0, "vehicleSoc": 64}]}
```

| Pfad | Ergebnis | Bedeutung |
|---|---|---|
| `grid.power` | `-2592.3` | Schlüssel mit Punkt verbinden |
| `.grid.power` oder `$.grid.power` | `-2592.3` | Schreibweise wie jq bzw. JSONPath geht auch |
| `loadpoints[0].vehicleSoc` | `64` | Listen-Element, 0 = erstes |
| `loadpoints.0.vehicleSoc` | `64` | dasselbe |
| `loadpoints[-1].title` | `"Garage"` | negativ = vom Ende, -1 = letztes |
| `["grid"]["power"]` | `-2592.3` | Schlüssel mit Punkten, Leerzeichen oder Bindestrichen in Anführungszeichen |
| `gridPower` | `nil` | gibt es nicht: `nil`, mit `??` einen Ersatzwert angeben |
| leer | ganze Antwort | als Map/Liste zum Weiterverarbeiten |

Ohne Pfad kommt die ganze Antwort zurück; auf sie lässt sich auch direkt mit `.` zugreifen und Listen lassen sich mit den
expr-Funktionen auswerten:

```
let s = httpGet("http://evcc:7070/api/state");
let laden = sum(map(s?.loadpoints ?? [], .chargePower));       // Ladeleistung aller Ladepunkte
let garage = find(s?.loadpoints ?? [], .title == "Garage")?.vehicleSoc;
s?.grid?.power ?? 0                                             // ?. liefert nil statt eines Fehlers, wenn s nil ist
```

Werte, die als Text kommen (z.B. `"state": "21.5"` bei Home Assistant), mit `toNumber()` in eine Zahl umwandeln.
Antworten, die kein JSON sind (HTML, Prometheus-Metriken), kommen als Text zurück; dort hilft `regexFind()`.

**Dateien**: `readFile` liest nur aus dem Verzeichnis für Skript-Dateien, Unterordner sind erlaubt. Es wird mit der
Umgebungsvariable `SCRIPT_FILES_DIR` festgelegt, Standard ist der Unterordner `script-files` im Config-Verzeichnis
(Container: `/config/script-files`). Im Container z.B. per Volume einbinden: `./sensoren:/config/script-files:ro`.

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

**Warmwasser mit Sonnenstrom**: mittags bei sonniger Vorhersage einmal täglich Warmwasser bereiten,
z.B. für PV-Überschuss (Zeitplan `0 11-14 * * *`, benötigt Wetter-Einstellungen):

```
let today = now().Format("2006-01-02");
if sunny(3) && get("sunCharge") != today {
  startDhwOneTimeCharge(); set("sunCharge", today)
} else {
  false
}
```

**PV-Überschuss aus evcc** (Zeitplan `*/5 * * * *`): Warmwasser bereiten, wenn seit 30 Minuten mehr als 2 kW
eingespeist werden. `grid.power` ist positiv bei Netzbezug und negativ bei Einspeisung; die IP durch die des evcc-Rechners ersetzen:

```
let grid = httpGet("http://192.168.1.10:7070/api/state", "grid.power");
let since = grid != nil && grid < -2000 ? get("surplusSince", now().Unix()) : nil;
set("surplusSince", since);                    // Beginn des Überschusses merken, nil = kein Überschuss
let minutes = since == nil ? 0 : (now().Unix() - since) / 60;
log("Netz:", grid, "W, Überschuss seit", round(minutes), "min");
if minutes >= 30 && (dhwTemp() ?? 99) < 45 {
  startDhwOneTimeCharge()
} else {
  false
}
```

**Raumtemperatur aus Home Assistant** (Zeitplan `*/10 * * * *`): Token unter Profil → Sicherheit → „Langlebige Zugangstoken“ erstellen.
Home Assistant liefert den Zustand als Text, daher `toNumber`:

```
let ha = {"Authorization": "Bearer DEIN_TOKEN"};
let raum = toNumber(httpGet("http://homeassistant:8123/api/states/sensor.wohnzimmer_temperatur", "state", ha));
log("Wohnzimmer:", raum, "°C");
if raum == nil {
  false // Sensor nicht verfügbar
} else if raum > 22.5 {
  setRoomTemperature(0, "normal", 20)
} else if raum < 21 {
  setRoomTemperature(0, "normal", 21)
} else {
  false
}
```

**Werte aus einer Datei**, die ein anderes Programm schreibt, z.B. `sensors.json` im Verzeichnis für Skript-Dateien mit
`{"timestamp": "2026-10-26T12:00:00+01:00", "sensor_1": 22.1}`. Mit maxAge 15 ist der Wert `nil`, wenn die Datei
seit mehr als 15 Minuten nicht aktualisiert wurde:

```
let t = readFile("sensors.json", "sensor_1", 15);
log("Sensor 1:", t ?? "nicht verfügbar");
false
```

**Heizung nach Wetterprognose** (Zeitplan `0 */3 * * *`): Standby, wenn die nächsten 24 Stunden im Mittel
warm werden, mit Schaltlücke gegen ständiges Umschalten:

```
let t = forecast("temp", 24, "avg") ?? outsideTemp();
log("Prognose 24 h:", t, "°C, morgen:", dayForecast(1)?.description);
if t > 16 {
  setHeatingMode(0, "standby")
} else if t < 14 {
  setHeatingMode(0, "heating")
} else {
  false
}
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
