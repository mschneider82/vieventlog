package main

import "strings"

// Status codes (S-codes) - typically operational states
var statusCodes = map[string]string{
	// Heating and Cooling Operations
	"S.10": "Standby - Bereitschaftsmodus",
	"S.11": "Kompressor läuft - Heizbetrieb",
	"S.12": "Kompressor läuft - Kühlbetrieb",
	"S.13": "Abtauung aktiv",
	"S.14": "Notbetrieb/Störung",
	"S.15": "Verdichter-Anlaufverzögerung",

	// Temperature Management
	"S.20": "Vorlauftemperatur zu hoch",
	"S.21": "Vorlauftemperatur zu niedrig",
	"S.22": "Rücklauftemperatur zu hoch",
	"S.23": "Rücklauftemperatur zu niedrig",
	"S.24": "Außentemperatur zu niedrig",
	"S.25": "Außentemperatur zu hoch",

	// Pump Operations
	"S.30": "Umwälzpumpe läuft",
	"S.31": "Umwälzpumpe aus",
	"S.32": "Pumpe Heizkreis 1 läuft",
	"S.33": "Pumpe Heizkreis 2 läuft",
	"S.34": "Ladepumpe läuft",
	"S.35": "Zirkulationspumpe läuft",

	// Heat Generator
	"S.40": "Wärmepumpe läuft",
	"S.41": "Zusatzheizung aktiv",
	"S.42": "Elektrische Zusatzheizung aktiv",
	"S.43": "Bivalente Heizung aktiv",

	// Hot Water
	"S.50": "Warmwasserbereitung",
	"S.51": "Warmwasser-Nachladung",
	"S.52": "Legionellenschutz aktiv",
	"S.53": "Warmwasser-Zirkulation",

	// Defrost and Protection
	"S.60": "Frostschutz aktiv",
	"S.61": "Abtauung läuft",
	"S.62": "Abtauung beendet",
	"S.63": "Verdampfer-Abtauung",

	// System Tests
	"S.70": "Testbetrieb",
	"S.71": "Relaistest",
	"S.72": "Sensortest",

	// Communication
	"S.80": "Kommunikation OK",
	"S.81": "Kommunikation gestört",
	"S.82": "Bus-Kommunikation aktiv",

	// Energy Management
	"S.90": "EVU-Sperre aktiv",
	"S.91": "Smart Grid aktiv",
	"S.92": "PV-Überschuss-Nutzung",

	// Specific Vitocal Status Codes (100+)
	"S.100": "Heizen - Normalbetrieb",
	"S.101": "Heizen - Reduzierter Betrieb",
	"S.102": "Heizen - Komfortbetrieb",
	"S.103": "Heizen - Eco-Betrieb",
	"S.104": "Heizen - Partybetrieb",
	"S.105": "Heizen - Urlaubsbetrieb",

	"S.110": "Kühlen - Normalbetrieb",
	"S.111": "Kühlen - Reduzierter Betrieb",
	"S.112": "Kühlen - Silent Mode",
	"S.113": "Kühlen - Boost Mode",
	"S.114": "Kühlen - Nachtabsenkung",

	// Heat Pump Specific Status Codes (from ViGuide)
	"S.115": "4/3-Wege Ventil in Position Trinkwasserbereitung",
	"S.118": "4/3 Wege-Ventil in Position (Heiz-/Kühl-) Pufferspeicher",
	"S.119": "Verdichter-Mindestlaufzeit",

	"S.123": "Wärmepumpe Aus",
	"S.124": "Wärmepumpe Vorlaufphase",
	"S.125": "Wärmepumpe Heizen",
	"S.129": "Wärmepumpe Nachlaufphase",

	"S.134": "4/3-Wege-Ventil in Position Leerlauf",

	"S.140": "Pufferspeicher wird geladen",
	"S.141": "Pufferspeicher entlädt",
	"S.142": "Pufferspeicher Temperatur OK",

	"S.150": "Solar-Ertrag",
	"S.151": "Solarkreispumpe läuft",
	"S.152": "Solar-Überhitzungsschutz",

	"S.160": "Lüftung - Stufe 1",
	"S.161": "Lüftung - Stufe 2",
	"S.162": "Lüftung - Stufe 3",
	"S.163": "Lüftung - Bypass offen",
	"S.164": "Lüftung - Wärmerückgewinnung",

	"S.170": "Systemcheck läuft",
	"S.171": "Initialisierung",
	"S.172": "Software-Update",

	"S.180": "Betriebsstundenzähler",
	"S.181": "Starts Verdichter",
	"S.182": "Energieverbrauch heute",

	"S.190": "Service erforderlich",
	"S.191": "Filter reinigen",
	"S.192": "Wartung fällig",

	"S.200": "Systemstart",
	"S.201": "System bereit",
	"S.202": "System im Standby",
}

// Fault codes (F-codes) - actual errors
var faultCodes = map[string]string{
	// Sensor Faults
	"F.01": "Außentemperatursensor defekt",
	"F.02": "Vorlauftemperatursensor 1 defekt",
	"F.03": "Speichertemperatursensor defekt",
	"F.04": "Rücklauftemperatursensor defekt",
	"F.05": "Abgastemperatursensor defekt",
	"F.10": "Kurzschluss Außentemperatursensor",
	"F.11": "Kurzschluss Vorlauftemperatursensor",
	"F.12": "Kurzschluss Speichertemperatursensor",
	"F.13": "Kurzschluss Rücklauftemperatursensor",

	// Pressure and Flow
	"F.20": "Wasserdruck zu niedrig",
	"F.21": "Wasserdruck zu hoch",
	"F.22": "Kein Durchfluss",
	"F.23": "Durchfluss zu gering",

	// Heat Pump Specific
	"F.454": "Kältekreis gesperrt",
	"F.472": "Fernbedienung nicht erreichbar",
	"F.518": "Keine Kommunikation mit Energiezähler",
	"F.519": "Betrieb mit internen Sollwerten",
	"F.542": "Mischer schließt",
	"F.543": "Mischer öffnet",
	"F.685": "HPMU Kommunikationsfehler",
	"F.686": "HPMU Modul defekt",
	"F.687": "HPMU Verbindungsfehler",
	"F.770": "Frostschutz aktiviert",
	"F.771": "Passiver Frostschutz",
	"F.788": "Kältekreis startet nicht",
}

func getErrorDescription(code string) string {
	code = strings.TrimSpace(strings.ToUpper(code))

	if strings.HasPrefix(code, "S.") {
		if desc, ok := statusCodes[code]; ok {
			return desc
		}
		return code + " - Unbekannter Statuscode"
	}

	if strings.HasPrefix(code, "F.") {
		if desc, ok := faultCodes[code]; ok {
			return desc
		}
		return code + " - Unbekannter Fehlercode"
	}

	return code
}

func getCodeCategory(code string) string {
	code = strings.TrimSpace(strings.ToUpper(code))

	if strings.HasPrefix(code, "S.") {
		return "status"
	} else if strings.HasPrefix(code, "F.") {
		return "fault"
	}
	return "unknown"
}

func getSeverity(code string) string {
	code = strings.TrimSpace(strings.ToUpper(code))

	if strings.HasPrefix(code, "S.") {
		// Most status codes are informational
		warningCodes := []string{"S.14", "S.81", "S.128", "S.138"}
		for _, wc := range warningCodes {
			if code == wc {
				return "warning"
			}
		}
		return "info"
	}

	if strings.HasPrefix(code, "F.") {
		// All fault codes are errors
		return "error"
	}

	return "unknown"
}