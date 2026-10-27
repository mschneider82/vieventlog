package main

import (
	"fmt"
	"strings"
)

// scriptDocs returns the script documentation as Markdown. It is generated from the function table,
// served in the UI and to the AI assistant, and written to docs/SCRIPTS.md (see TestScriptDocsUpToDate).
func scriptDocs() string {
	var sb strings.Builder
	sb.WriteString(`# ViEventLog Skripte

Skripte automatisieren Einstellungen deiner Anlage, z.B. „Warmwasser im Sommer kühler“ oder „um 17 Uhr Warmwasser bereiten“.
Sie werden in der Ausdruckssprache [expr](https://expr-lang.org/docs/language-definition) geschrieben und nach einem
Zeitplan (Cron) im Hintergrund ausgeführt. Jedes Skript gehört zu genau einem Gerät; alle Funktionen beziehen sich auf dieses Gerät.

## Grundlagen

- **Zeitplan** im Cron-Format mit 5 Feldern ` + "`Minute Stunde Tag Monat Wochentag`" + ` (lokale Zeit):
  ` + "`* * * * *`" + ` = jede Minute, ` + "`*/15 * * * *`" + ` = alle 15 Minuten, ` + "`0 17 * * *`" + ` = täglich 17:00,
  ` + "`0 6 * * 1-5`" + ` = werktags 6:00. Kurzformen: ` + "`@every 5m`" + `, ` + "`@hourly`" + `, ` + "`@daily`" + `.
- **Datenquelle**: Skripte rufen die Viessmann-API für Werte praktisch nie selbst ab, damit das API-Limit (ca. 1450 Aufrufe/Tag)
  auch bei minütlichen Skripten hält. Werte kommen aus dem Live-Daten-Cache, den Temperatur-Logging und Dashboard füllen,
  bzw. aus dem letzten Eintrag der Temperatur-Historie (SQLite), solange sie höchstens 30 Minuten alt sind.
  Nur wenn keine aktuellen Daten vorliegen, holt ein Skript sie selbst – höchstens einmal pro Gerät alle 30 Minuten.
  **Empfehlung:** Temperatur-Logging aktivieren; dann verursachen Skripte für Werte keine zusätzlichen API-Aufrufe.
- **Wetter**: Die Wetter-Funktionen nutzen [OpenWeatherMap](https://openweathermap.org/api) (kostenloser API-Key). Einrichten auf der
  Skript-Seite unter **🌤️ Wetter** (API-Key, PLZ oder Ort, Land). ViEventLog ruft das Wetter im Hintergrund ab (Standard stündlich,
  2 API-Aufrufe), Skripte lesen nur aus diesem Cache. Die Vorhersage reicht 5 Tage in 3-Stunden-Schritten; ein Schritt gilt für
  1,5 Stunden vor bis 1,5 Stunden nach seiner Uhrzeit (der Wert für 16:00 also für 14:30–17:30). Alle Zeiten sind lokale Zeit.
- **Aktionen** (` + "`set...`" + `, ` + "`start...`" + `) prüfen zuerst den aktuellen Wert und rufen die API nur auf, wenn sich etwas ändert.
  Sie geben ` + "`true`" + ` zurück, wenn etwas geändert wurde, sonst ` + "`false`" + `. Eine identische Aktion wird innerhalb von 15 Minuten
  nicht wiederholt (die Cloud übernimmt neue Werte verzögert). Maximal 10 Aktionen pro Lauf.
- **Testlauf**: führt das Skript aus, ohne Aktionen auszuführen oder Variablen zu speichern, und zeigt, was passieren würde.
- Ein Wert ist ` + "`nil`" + `, wenn das Gerät das Feature nicht hat oder (bei ` + "`history`" + `) keine Daten vorliegen. Mit ` + "`??`" + ` einen Ersatzwert angeben.

## Syntax (Kurzfassung)

| Element | Beispiel |
|---|---|
| Variable | ` + "`let t = outsideTemp();`" + ` (mehrere mit ` + "`;`" + ` trennen, der letzte Ausdruck ist das Ergebnis) |
| Bedingung | ` + "`if t > 18 { a() } else { b() }`" + ` (` + "`else`" + ` ist Pflicht, ` + "`else if`" + ` möglich) |
| Kurzform | ` + "`t > 18 ? setDhwTemperature(50) : setDhwTemperature(53)`" + ` |
| Logik | ` + "`and`" + ` / ` + "`&&`" + `, ` + "`or`" + ` / ` + "`||`" + `, ` + "`not`" + ` / ` + "`!`" + ` |
| Vergleich | ` + "`==  !=  <  <=  >  >=`" + `, Text: ` + "`contains`, `startsWith`, `in`" + ` |
| Ersatzwert | ` + "`outsideTemp() ?? 10`" + ` |
| Kommentar | ` + "`// Zeile`" + ` oder ` + "`/* Block */`" + ` |
| Mehrere Anweisungen | ` + "`log(\"a\"); setDhwTemperature(50)`" + ` |
| Nichts tun | ` + "`false`" + ` oder ` + "`nil`" + ` im ` + "`else`" + `-Zweig |

Eingebaute expr-Funktionen wie ` + "`abs()`, `round()`, `min()`, `max()`, `now()`, `date()`, `duration()`" + `, ` + "`upper()`" + ` usw.
stehen ebenfalls zur Verfügung (siehe expr-Dokumentation). Schleifen gibt es nicht; Skripte laufen höchstens 60 Sekunden.
`)

	categories := []string{"Werte", "Wetter", "Zeit", "Variablen & Ausgabe", "Aktionen"}
	funcs := scriptFunctions()
	for _, cat := range categories {
		sb.WriteString("\n## " + cat + "\n\n| Funktion | Beschreibung | Beispiel |\n|---|---|---|\n")
		for _, f := range funcs {
			if f.Category != cat {
				continue
			}
			example := ""
			if f.Example != "" {
				example = "`" + strings.ReplaceAll(f.Example, "|", "\\|") + "`"
			}
			sb.WriteString(fmt.Sprintf("| `%s` | %s | %s |\n", f.Sig, strings.ReplaceAll(f.Desc, "|", "\\|"), example))
		}
	}

	sb.WriteString(`
## Beispiele

**Warmwasser abhängig von der Außentemperatur** (Zeitplan ` + "`*/5 * * * *`" + `). Der Mittelwert über 2 Stunden und
eine Schaltlücke (Hysterese) verhindern ständiges Umschalten um 18 °C:

` + "```" + `
let t = history("outside_temp", 120, "avg") ?? outsideTemp();
if t > 18.5 {
  setDhwTemperature(50)
} else if t < 17.5 {
  setDhwTemperature(53)
} else {
  false // zwischen 17,5 und 18,5 °C nichts ändern
}
` + "```" + `

**Täglich um 17 Uhr Warmwasser bereiten** (Zeitplan ` + "`0 17 * * *`" + `):

` + "```" + `
startDhwOneTimeCharge()
` + "```" + `

**Warmwasser mit Sonnenstrom**: mittags bei sonniger Vorhersage einmal täglich Warmwasser bereiten,
z.B. für PV-Überschuss (Zeitplan ` + "`0 11-14 * * *`" + `, benötigt Wetter-Einstellungen):

` + "```" + `
let today = now().Format("2006-01-02");
if sunny(3) && get("sunCharge") != today {
  startDhwOneTimeCharge(); set("sunCharge", today)
} else {
  false
}
` + "```" + `

**Heizung nach Wetterprognose** (Zeitplan ` + "`0 */3 * * *`" + `): Standby, wenn die nächsten 24 Stunden im Mittel
warm werden, mit Schaltlücke gegen ständiges Umschalten:

` + "```" + `
let t = forecast("temp", 24, "avg") ?? outsideTemp();
log("Prognose 24 h:", t, "°C, morgen:", dayForecast(1)?.description);
if t > 16 {
  setHeatingMode(0, "standby")
} else if t < 14 {
  setHeatingMode(0, "heating")
} else {
  false
}
` + "```" + `

**Nachts leiser** (Zeitplan ` + "`*/10 * * * *`" + `):

` + "```" + `
setNoiseReductionMode(timeBetween("22:00", "06:00") ? "maxReduced" : "notReduced")
` + "```" + `

**Zustand merken**: nur einmal pro Tag melden, wenn der Speicher kalt ist:

` + "```" + `
let today = now().Format("2006-01-02");
if (dhwTemp() ?? 99) < 40 && get("warned") != today {
  log("Warmwasser nur", dhwTemp(), "°C"); set("warned", today)
} else {
  false
}
` + "```" + `
`)
	return sb.String()
}
