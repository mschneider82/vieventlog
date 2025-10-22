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

	// Additional Status Codes from PDF
	"S.60":  "Sommerbetrieb aktiv (Sparfunktion Aussentemperatur)",
	"S.61":  "Abtauung laeuft",
	"S.62":  "Abtauung beendet",
	"S.63":  "Verdampfer-Abtauung",
	"S.70":  "Testbetrieb",
	"S.71":  "Relaistest",
	"S.72":  "Sensortest",
	"S.74":  "Heizunterdrueckung Heizen bei Trinkwassererwaermung durch Sonnenkollektoren",
	"S.75":  "Zirkulationspumpe aktiv",
	"S.80":  "Kommunikation OK",
	"S.81":  "Kommunikation gestoert",
	"S.82":  "Bus-Kommunikation aktiv",
	"S.88":  "Solarkreispumpe aktiv",
	"S.89":  "Sonnenkollektoren in Stagnation",
	"S.90":  "EVU-Sperre aktiv",
	"S.91":  "Smart Grid aktiv",
	"S.92":  "PV-Ueberschuss-Nutzung",
	"S.100": "Heizen - Normalbetrieb",
	"S.101": "Heizen - Reduzierter Betrieb",
	"S.102": "Heizen - Komfortbetrieb",
	"S.103": "Heizen - Eco-Betrieb",
	"S.104": "Heizen - Partybetrieb",
	"S.105": "Heizen - Urlaubsbetrieb",
	"S.110": "Kuehlen - Normalbetrieb",
	"S.111": "Kuehlen - Reduzierter Betrieb",
	"S.112": "Initialisierung 4/3-Wege-Ventil",
	"S.113": "4/3-Wege-Ventil schaltet in Richtung Trinkwassererwaermung",
	"S.114": "4/3-Wege-Ventil schaltet in Richtung Heiz-/Kuehlkreis 1",
	"S.115": "4/3-Wege-Ventil in Position Trinkwassererwaermung",
	"S.116": "4/3-Wege-Ventil in Position Heiz-/Kuehlkreis 1",
	"S.117": "4/3-Wege-Ventil in Position Heiz-/Kuehlkreis 2",
	"S.118": "4/3-Wege-Ventil in Position Integrierter Pufferspeicher",
	"S.119": "Verdichter-Mindestlaufzeit",
	"S.120": "Smart Grid: Normalbetrieb aktiv",
	"S.121": "Smart Grid: Empfohlener Betrieb aktiv",
	"S.122": "Smart Grid: Erzwungener Betrieb aktiv",
	"S.123": "Waermepumpe aus",
	"S.124": "Waermepumpe Vorlaufphase",
	"S.125": "Waermepumpe im Heizbetrieb",
	"S.126": "Waermepumpe im Kuehlbetrieb",
	"S.127": "Waermepumpe: Abtauen vorbereiten",
	"S.128": "Waermepumpe im Abtaubetrieb",
	"S.129": "Waermepumpe Nachlaufphase",
	"S.130": "Heizwasser-Durchlauferhitzer ausgeschaltet",
	"S.131": "Heizwasser-Durchlauferhitzer: Stufe 1 aktiv",
	"S.132": "Heizwasser-Durchlauferhitzer: Stufe 2 aktiv",
	"S.133": "Heizwasser-Durchlauferhitzer: Stufe 3 aktiv",
	"S.134": "4/3-Wege-Ventil Leerlauf",
	"S.135": "4/3-Wege-Ventil Abtauen",
	"S.136": "4/3-Wege-Ventil Raumbeheizung/Raumkuehlung",
	"S.137": "Heizbetrieb in Anlaufphase",
	"S.138": "Heizbetrieb aktiv",
	"S.139": "Heizbetrieb inaktiv",
	"S.141": "Trinkwassererwaermung aktiv",
	"S.142": "Trinkwassererwaermung inaktiv",
	"S.143": "Kuehlbetrieb angefordert",
	"S.144": "Kuehlbetrieb aktiv",
	"S.145": "Kuehlbetrieb inaktiv",
	"S.146": "Abtauen angefordert",
	"S.147": "Waermebereitstellung fuer Abtauen aktiv",
	"S.148": "Abtauen ueber Waermepumpe aktiv",
	"S.149": "Abtauen ueber Waermepumpe inaktiv",
	"S.153": "Regelung im Standby",
	"S.160": "Lueftung - Stufe 1",
	"S.161": "Befuellung aktiv",
	"S.162": "Entlueftung aktiv",
	"S.163": "Waermepumpe: Systemstatus inaktiv",
	"S.164": "Waermepumpe: Systemstatus Wartung Standby",
	"S.165": "Waermepumpe: Systemstatus Regelung",
	"S.167": "Aktorentest aktiv",
	"S.168": "Lueftungsbypass offen",
	"S.169": "Lueftungsbypass geschlossen",
	"S.170": "Systemcheck laeuft",
	"S.171": "Initialisierung",
	"S.172": "Software-Update",
	"S.176": "Waermepumpenregelung: Abtauen angefordert",
	"S.180": "Betriebsstundenzaehler",
	"S.181": "Passiver Frostschutz Heiz-/Kuehlkreis 1 eingeschaltet",
	"S.182": "Passiver Frostschutz Heiz-/Kuehlkreis 2 eingeschaltet",
	"S.183": "Passiver Frostschutz Heiz-/Kuehlkreis 3 eingeschaltet",
	"S.184": "Passiver Frostschutz Heiz-/Kuehlkreis 4 eingeschaltet",
	"S.185": "Passiver Frostschutz Heizwasser-Durchlauferhitzer eingeschaltet",
	"S.186": "Passiver Frostschutz Speicher-Wassererwärmer eingeschaltet",
	"S.187": "Passiver Frostschutz Waermepumpe eingeschaltet",
	"S.188": "Passiver Frostschutz externer Heiz-/Kuehlwasser-Pufferspeicher eingeschaltet",
	"S.189": "Passiver Frostschutz externer Heizwasser-Pufferspeicher eingeschaltet",
	"S.190": "Passiver Frostschutz externer Kuehlwasser-Pufferspeicher eingeschaltet",
	"S.191": "Filter reinigen",
	"S.192": "Wartung faellig",
	"S.193": "Anforderung externer Waermeerzeuger ueber potenzialfreien Schaltkontakt",
	"S.195": "Smart Grid: EVU-Sperre aktiv",
	"S.196": "EVU-Sperre aktiv",
	"S.197": "Waermeanforderung Heiz-/Kuehlkreis 1",
	"S.198": "Kuehlanforderung Heiz-/Kuehlkreis 1",
	"S.199": "Waermeanforderung Heiz-/Kuehlkreis 2",
	"S.205": "Anforderung externer Heizwasser-Pufferspeicher",
	"S.206": "Anforderung externer Kuehlwasser-Pufferspeicher",
	"S.207": "Anforderung Trinkwassererwaermung",
	"S.208": "Erwaermung integrierter Pufferspeicher aktiv",
	"S.209": "Abbruch Befuellfunktion",
	"S.210": "Abbruch Entlueftungsfunktion",
	"S.211": "Befuellvorgang abgeschlossen",
	"S.212": "Entlueftungsvorgang abgeschlossen",
	"S.213": "Inbetriebnahme-Assistent aktiv",
	"S.214": "Abbruch Inbetriebnahme",
	"S.215": "Inbetriebnahme abgeschlossen",
	"S.216": "Aktorentest aktiv",
	"S.217": "Heizwasser-Durchlauferhitzer: Stufe 1 inaktiv",
	"S.218": "Heizwasser-Durchlauferhitzer: Stufe 2 inaktiv",
	"S.219": "Heizwasser-Durchlauferhitzer: Stufe 3 inaktiv",
	"S.220": "Kaeltekreis ausgeschaltet",
	"S.221": "Kaeltekreis Startphase Heizbetrieb",
	"S.222": "Kaeltekreis Startphase Kuehlbetrieb",
	"S.223": "Kaeltekreis Startphase Abtaubetrieb",
	"S.224": "Kaeltekreis im Heizbetrieb",
	"S.225": "Kaeltekreis im Kuehlbetrieb",
	"S.226": "Kaeltekreis im Abtaubetrieb im Betriebsprogramm Frostschutz",
	"S.227": "Kaeltekreis im Abtaubetrieb bei Regelbetrieb",
	"S.228": "Kaeltekreis Abschaltsignal",
	"S.229": "Kaeltekreisregler im Uebergang von Heizbetrieb zu Kuehlbetrieb",
	"S.230": "Kaeltekreisregler im Uebergang von Kuehlbetrieb zu Heizbetrieb",
	"S.231": "Kaeltekreisregler im Uebergang von Abtaubetrieb zu Heizbetrieb",
	"S.240": "Kaeltekreisregler im Standby",
	"S.392": "Kaeltekreisregler im Uebergang von Heizbetrieb zu Abtaubetrieb",
	"S.393": "Aktiver Frostschutz Heiz-/Kuehlkreis 1 eingeschaltet",
	"S.394": "Aktiver Frostschutz Heiz-/Kuehlkreis 2 eingeschaltet",
	"S.395": "Aktiver Frostschutz Heiz-/Kuehlkreis 3 eingeschaltet",
	"S.396": "Aktiver Frostschutz Heiz-/Kuehlkreis 4 eingeschaltet",
	"S.397": "Aktiver Frostschutz Heizwasser-Durchlauferhitzer eingeschaltet",
	"S.398": "Aktiver Frostschutz Speicher-Wassererwärmer eingeschaltet",
	"S.399": "Aktiver Frostschutz Waermepumpe eingeschaltet",
	"S.400": "Aktiver Frostschutz externer Heiz-/Kuehlwasser-Pufferspeicher eingeschaltet",
	"S.401": "Aktiver Frostschutz externer Heizwasser-Pufferspeicher eingeschaltet",
	"S.402": "Aktiver Frostschutz externer Kuehlwasser-Pufferspeicher eingeschaltet",

	// Missing codes from PDF
	"S.140": "Trinkwassererwaermung angefordert",
	"S.150": "Abtauen ueber Heiz-/Kuehlkreis 1 oder externen Heizwasser-Pufferspeicher (falls vorhanden) in Vorbereitung",
	"S.151": "Abtauen ueber Heiz-/Kuehlkreis 1 oder externen Heizwasser-Pufferspeicher (falls vorhanden) aktiv",
	"S.152": "Abtauen ueber Heiz-/Kuehlkreis 1 oder externen Heizwasser-Pufferspeicher (falls vorhanden) inaktiv",
	"S.200": "Kuehlanforderung Heiz-/Kuehlkreis 2",
	"S.201": "Waermeanforderung Heiz-/Kuehlkreis 3",
	"S.202": "Kuehlanforderung Heiz-/Kuehlkreis 3",
	"S.203": "Waermeanforderung Heiz-/Kuehlkreis 4",
	"S.204": "Kuehlanforderung Heiz-/Kuehlkreis 4",
}

// Maintenance codes (P-codes) - maintenance messages
var maintenanceCodes = map[string]string{
	"P.1":  "Wartung nach Zeitintervall steht bevor",
	"P.4":  "Heizwasser nachfuellen",
	"P.8":  "Wartung nach Betriebsstunden steht bevor",
	"P.34": "Wartung Heizwasserfilter",
}

// Alert codes (A-codes) - warning messages
var alertCodes = map[string]string{
	"A.2":   "Frostschutzgrenze unterschritten",
	"A.11":  "Anlagendruck zu niedrig",
	"A.12":  "Batterie im Elektronikmodul HPMU",
	"A.16":  "Mindestvolumenstrom unterschritten",
	"A.17":  "Erhöhte Trinkwasserhygiene",
	"A.19":  "Temperaturwächter hat ausgelöst",
	"A.21":  "Hydraulischer Anlagendruck",
	"A.62":  "PWM-Signal Heizkreispumpe Heiz-/Kühlkreis 1",
	"A.63":  "PWM-Signal Heizkreispumpe Heiz-/Kühlkreis 2",
	"A.65":  "Heizkreispumpe Heiz-/Kühlkreis 2 läuft trocken",
	"A.66":  "Heizkreispumpe Heiz-/Kühlkreis 1 läuft nicht",
	"A.68":  "Heizkreispumpe Heiz-/Kühlkreis 2 läuft nicht",
	"A.70":  "Filter im Kugelhahn Außeneinheit",
	"A.71":  "Überstrom am Verdichter",
	"A.72":  "Strom Leistungsfaktor-Korrekturfilter",
	"A.73":  "Frequenzabweichung Verdichterdrehzahl",
	"A.74":  "Druckverlust im Sekundärkreis",
	"A.75":  "Druckspitzen im Sekundärkreis",
	"A.80":  "Ventilator blockiert",
	"A.81":  "Unzureichende Wärmeübertragung Verdampfer",
	"A.82":  "Fehler Drucksensor CAN-BUS-Teilnehmer",
	"A.83":  "Signal Speichertemperatursensor fehlerhaft",
	"A.84":  "Signal Rücklauftemperatursensor Sekundärkreis",
	"A.85":  "Signal Vorlauftemperatursensor Sekundärkreis",
	"A.86":  "Signal Vorlauftemperatursensor Heiz-/Kühlkreis 1",
	"A.87":  "Signal Vorlauftemperatursensor Heiz-/Kühlkreis 2",
	"A.91":  "Kältekreis vorübergehend aus",
	"A.93":  "Heißgasdruck nicht plausibel",
	"A.94":  "Sauggasdruck nicht plausibel",
	"A.96":  "Luft im Sekundärkreis",
	"A.99":  "Vorlauftemperatur Sekundärkreis zu niedrig",
	"A.100": "Einstellungen gelöscht",
	"A.101": "Heißgastemperatur nicht plausibel",
	"A.102": "Sauggastemperatur nicht plausibel",
	"A.109": "Kesseltemperatur-Istwert zu niedrig",
	"A.110": "Temperatur externer Wärmeerzeuger 1",
	"A.111": "Temperatur externer Wärmeerzeuger 2",
	"A.130": "Warnschwelle Einsatzgrenzen für Kühlbetrieb unterschritten",
	"A.152": "Überlastschutz Wallbox nicht aktiv",
	"A.153": "Kein PV-optimiertes Laden",
	"A.159": "Werkseitige Einstellung Inverter",
	"A.162": "Inverter Überspannung Zwischenkreis",
	"A.163": "Überspannung im Zwischenkreis Inverter",
	"A.164": "Gleichspannung im Zwischenkreis Inverter",
	"A.174": "Innenraumtemperatur zu hoch",
}

// Information codes (I-codes) - informational messages
var informationCodes = map[string]string{
	"I.9":   "Estrichtrocknung aktiv",
	"I.10":  "Laufzeitbegrenzung Trinkwassererwaermung",
	"I.56":  "Extern Anfordern aktiv",
	"I.57":  "Extern Sperren aktiv",
	"I.63":  "Kuehlkreis nicht bereit",
	"I.70":  "Inverter: Laststrom im Zwischenkreis Inverter zu hoch (Ueberstrom)",
	"I.71":  "Inverter: Netzspannung zu hoch, Verdichter temporaer aus",
	"I.72":  "Inverter: Netzspannung zu niedrig, Verdichter temporaer aus",
	"I.73":  "Inverter: Gleichspannung im Zwischenkreis Inverter zu hoch (Ueberspannung)",
	"I.74":  "Inverter: Gleichspannung im Zwischenkreis Inverter zu niedrig (Unterspannung), Verdichter temporaer aus",
	"I.75":  "Inverter: Temperatur am internen Leistungsmodul zu hoch, Verdichter temporaer aus",
	"I.76":  "Inverter: Zu hohe Temperatur im Leistungsfaktor-Korrekturfilter (PFC), Verdichter temporaer aus",
	"I.77":  "Inverter: Zu hoher Strom im Leistungsfaktor-Korrekturfilter (PFC), Verdichter temporaer aus",
	"I.78":  "Inverter: Leistungsreduzierung durch Inverter bei zu hoher Leistungsanforderung (Derating)",
	"I.79":  "Inverter: Leistungsreduzierung durch Inverter bei zu hoher Leistungsanforderung des Verdichters (Derating)",
	"I.80":  "Inverter: Leistungsbegrenzung durch Inverter bei zu hoher Leistungsanforderung des Verdichters (Feldschwaechebetrieb)",
	"I.81":  "Inverter: Leistungsreduzierung durch Inverter bei zu hoher Temperatur am internen Leistungsmodul (Derating)",
	"I.82":  "Inverter: Leistungsreduzierung durch Inverter bei zu hoher Temperatur am Leistungsfaktor-Korrekturfilter (Derating)",
	"I.83":  "4/3-Wege-Ventil: Mindestvolumenstrom erreicht",
	"I.84":  "4/3-Wege-Ventil: Min. Ruecklauftemperatur erreicht",
	"I.85":  "Kontrollierte Regelniederdruckabschaltung Kaeltekreis",
	"I.86":  "Kontrollierte Regelhochdruckabschaltung Kaeltekreis",
	"I.89":  "Uhrzeit vorgestellt (Sommerzeit)",
	"I.90":  "Uhrzeit zurueckgestellt (Winterzeit)",
	"I.92":  "Energiebilanz zurueckgesetzt",
	"I.96":  "Unbekannte Folge-Waermepumpe (weiteres Viessmann Geraet)",
	"I.98":  "Neue Folge-Waermepumpe (weiteres Viessmann Geraet) wurde erkannt",
	"I.99":  "Zieltemperatur Hygienefunktion erreicht",
	"I.100": "Max. Verfluessigungsdruck erreicht",
	"I.101": "Min. Verdampfungsdruck fuer Heizbetrieb erreicht",
	"I.102": "Min. Verdampfungsdruck fuer Kuehlbetrieb erreicht",
	"I.103": "Max. Verdampfungsdruck erreicht",
	"I.104": "Max. Heissgastemperatur erreicht",
	"I.105": "Max. Laufzeit untere Verdampfungstemperatur erreicht",
	"I.106": "Max. Druckdifferenz Verdichter erreicht",
	"I.107": "Max. Verfluessigungstemperatur erreicht",
	"I.108": "Max. Drehmoment Verdichter erreicht",
	"I.109": "Max. Verdampfungstemperatur Verdichter erreicht",
	"I.110": "Min. Druckverhaeltnis Verdichter erreicht",
	"I.111": "Min. Verdampfungstemperatur Verdichter erreicht",
	"I.112": "Min. Austrittstemperatur am Verfluessiger erreicht",
	"I.113": "Smart Grid: Erzwungene Abschaltung aktiv",
	"I.114": "Smart Grid: Normalbetrieb aktiv",
	"I.115": "Smart Grid: Empfohlene Einschaltung aktiv",
	"I.116": "Smart Grid: Erzwungene Einschaltung aktiv",
	"I.117": "Energie-Management-System aktiv",
	"I.118": "Fussbodentemperaturbegrenzer Heiz-/Kuehlkreis 1 aktiv",
	"I.119": "Fussbodentemperaturbegrenzer Heiz-/Kuehlkreis 2 aktiv",
	"I.120": "Geraeuschreduzierter Betrieb Waermepumpe aktiv",
	"I.121": "Feuchteanbauschalter Heiz-/Kuehlkreis 1 aktiv",
	"I.122": "Feuchteanbauschalter Heiz-/Kuehlkreis 2 aktiv",
	"I.123": "Max. Ruecklauftemperatur Kaeltekreis erreicht",
	"I.124": "Min. Ruecklauftemperatur Kaeltekreis erreicht",
	"I.125": "Max. Lufteintrittstemperatur Kaeltekreis erreicht",
	"I.126": "Min. Lufteintrittstemperatur Kaeltekreis erreicht",
	"I.127": "Max. Druckdifferenz fuer Verdichterstart erreicht",
	"I.128": "Min. Oelsumpftemperatur erreicht",
	"I.129": "Kaeltekreisumkehr: Druckunterschied zu gering",
	"I.130": "Startphase Waermepumpe: Zeitueberschreitung",
	"I.131": "Min. Verdampfungstemperatur erreicht",
	"I.132": "Neustart Waermepumpenregelung",
	"I.133": "Reset der Elektronikmodule durch Neustart",
	"I.134": "Abtauen aktiv im Betriebsprogramm Frostschutz",
	"I.135": "Abtauen aktiv im Regelbetrieb",
	"I.142": "Min. Laufzeit Verdichter unterschritten",
	"I.143": "EVU-Sperre aktiv",
	"I.144": "Frequenzabweichungen bei Spannungsversorgung des EVU",
	"I.145": "Leistungsueberschreitung Ausseneinheit",
	"I.146": "Ueberhitzung Verdampfer Kuehlbetrieb",
	"I.147": "Ueberhitzung Verfluessiger Heizbetrieb",
	"I.148": "Ueberhitzung Verdampfer Heizbetrieb",
	"I.149": "Waermeanforderung waehrend Abtaubetrieb",
	"I.150": "Anforderung Abtauen waehrend Regelbetrieb",
	"I.151": "Betriebsgrenze Fluessiggas temperatur Verfluessiger erreicht",
	"I.152": "Betriebsgrenze Niederdruck erreicht",
	"I.155": "Estrichtrocknung durch Anwender abgebrochen",
	"I.156": "Warnschwelle Wasser-Volumenstrom Abtaubetrieb erreicht",
	"I.157": "Erforderliche Heissgastemperatur fuer Heizbetrieb ueberschritten",
	"I.158": "Erforderliche Heissgastemperatur fuer Kuehlbetrieb ueberschritten",
	"I.159": "Erhoehte Innenraumtemperatur in Ausseneinheit",
	"I.163": "Strombegrenzung der Wallbox aktiv: Leistung der Photovoltaikanlage zu gering",
	"I.168": "Waermepumpe ist als Fuehrungs-Waermepumpe konfiguriert",
	"I.169": "Waermepumpe ist als Folge-Waermepumpe konfiguriert",
	"I.170": "Durch eine Stoerung uebernimmt eine Folge-Waermepumpe voruebergehend die Aufgabe der Fuehrungs-Waermepumpe",
	"I.171": "Inverter: Software-Update laeuft, Inverter aus",
	"I.173": "Inverter: Ausgangsstrom zu hoch, reduzierte Verdichterdrehzahl",
	"I.174": "Inverter: Leistung fuer Verdichter wird voruebergehend reduziert, reduzierte Verdichterdrehzahl",
	"I.175": "Verdichter startet nicht: Umgebungstemperatur ist niedriger als zulaessige Betriebstemperatur fuer Verdichter, Verdichter temporaer aus",
	"I.176": "Verdichter mit reduzierter Leistung: Umgebungstemperatur ist hoeher als zulaessige Betriebstemperatur fuer Verdichter",
	"I.182": "Verdichter ueberlastet: Normales Regelverhalten",
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

	if strings.HasPrefix(code, "P.") {
		if desc, ok := maintenanceCodes[code]; ok {
			return desc
		}
		return code + " - Unbekannter Wartungscode"
	}

	if strings.HasPrefix(code, "I.") {
		if desc, ok := informationCodes[code]; ok {
			return desc
		}
		return code + " - Unbekannter Informationscode"
	}

	if strings.HasPrefix(code, "A.") {
		if desc, ok := alertCodes[code]; ok {
			return desc
		}
		return code + " - Unbekannter Alarmcode"
	}

	return code
}

func getCodeCategory(code string) string {
	code = strings.TrimSpace(strings.ToUpper(code))

	if strings.HasPrefix(code, "S.") {
		return "status"
	} else if strings.HasPrefix(code, "F.") {
		return "fault"
	} else if strings.HasPrefix(code, "P.") {
		return "maintenance"
	} else if strings.HasPrefix(code, "I.") {
		return "information"
	} else if strings.HasPrefix(code, "A.") {
		return "alert"
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

	if strings.HasPrefix(code, "P.") {
		// Maintenance codes are warnings
		return "warning"
	}

	if strings.HasPrefix(code, "I.") {
		// Information codes are informational
		return "info"
	}

	if strings.HasPrefix(code, "A.") {
		// Alert codes are warnings
		return "warning"
	}

	return "unknown"
}
