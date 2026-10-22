package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/dop251/goja"
)

// aiTool is a function the assistant (chat UI or MCP client) can call
type aiTool struct {
	Name        string
	Description string
	Parameters  map[string]interface{} // JSON schema
	Write       bool                   // Changes device settings, requires user confirmation
	Run         func(ctx context.Context, args map[string]interface{}) (string, error)
}

const aiMaxToolResult = 60000

var aiDeviceParams = map[string]interface{}{
	"accountId":      map[string]interface{}{"type": "string", "description": "Account-ID aus list_devices"},
	"installationId": map[string]interface{}{"type": "string", "description": "Installations-ID aus list_devices"},
	"gatewaySerial":  map[string]interface{}{"type": "string", "description": "Gateway-Seriennummer aus list_devices"},
	"deviceId":       map[string]interface{}{"type": "string", "description": "Geräte-ID aus list_devices (meist \"0\")"},
}

func aiSchema(props map[string]interface{}, required ...string) map[string]interface{} {
	if required == nil {
		required = []string{}
	}
	return map[string]interface{}{"type": "object", "properties": props, "required": required}
}

func aiWithDevice(extra map[string]interface{}) map[string]interface{} {
	props := map[string]interface{}{}
	for k, v := range aiDeviceParams {
		props[k] = v
	}
	for k, v := range extra {
		props[k] = v
	}
	return props
}

func aiDeviceRequired(extra ...string) []string {
	return append([]string{"accountId", "installationId", "gatewaySerial", "deviceId"}, extra...)
}

func argString(args map[string]interface{}, key, def string) string {
	if v, ok := args[key]; ok && v != nil {
		switch t := v.(type) {
		case string:
			if t != "" {
				return t
			}
		case float64:
			return fmt.Sprintf("%v", t)
		}
	}
	return def
}

func argInt(args map[string]interface{}, key string, def int) int {
	if v, ok := args[key].(float64); ok {
		return int(v)
	}
	return def
}

func toJSON(v interface{}) string {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf(`{"error": %q}`, err.Error())
	}
	return string(data)
}

// aiCallHandler runs an existing HTTP handler in-process, so tools reuse its validation and API logic
func aiCallHandler(h http.HandlerFunc, method, target string, body interface{}) (int, string) {
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, target, reader)
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec.Code, rec.Body.String()
}

// aiTools returns all tools. Write tools are included; callers filter them by settings.
func aiTools() []aiTool {
	tools := []aiTool{
		{
			Name: "list_devices",
			Description: "Listet alle Accounts, Installationen und Geräte (Wärmepumpe, Gasheizung, Thermostate, Lüftung, ...) " +
				"mit den IDs, die andere Tools benötigen, den Geräte-Einstellungen aus ViEventLog (z.B. Strompreis) " +
				"und dem in der Datenbank vorhandenen Datenzeitraum. Zuerst aufrufen.",
			Parameters: aiSchema(map[string]interface{}{}),
			Run:        aiToolListDevices,
		},
		{
			Name: "get_database_schema",
			Description: "Beschreibt die Tabellen der SQLite-Datenbank (Event-Log und Temperatur-/Leistungs-Historie) " +
				"inkl. Spalten und Einheiten. Vor dem ersten query_database aufrufen.",
			Parameters: aiSchema(map[string]interface{}{}),
			Run:        aiToolSchema,
		},
		{
			Name: "query_database",
			Description: "Führt eine lesende SQL-Abfrage (SQLite-Dialekt, nur SELECT/WITH) auf der ViEventLog-Datenbank aus. " +
				"Aggregiere möglichst in SQL statt viele Rohzeilen zu laden. Ergebnis: columns + rows.",
			Parameters: aiSchema(map[string]interface{}{
				"sql":     map[string]interface{}{"type": "string", "description": "SQL-Abfrage"},
				"maxRows": map[string]interface{}{"type": "integer", "description": "Maximale Zeilenanzahl (Standard 200, max 2000)"},
			}, "sql"),
			Run: aiToolQuery,
		},
		{
			Name: "get_consumption_stats",
			Description: "Energiestatistik einer Wärmepumpe aus der Historie (wie im Dashboard): Strom kWh, Wärme kWh, COP, Laufzeit. " +
				"Optional Aufschlüsselung pro Tag oder pro Stunde (für einen einzelnen Tag).",
			Parameters: aiSchema(aiWithDevice(map[string]interface{}{
				"start":     map[string]interface{}{"type": "string", "description": "Start (YYYY-MM-DD, lokale Zeit, inklusive)"},
				"end":       map[string]interface{}{"type": "string", "description": "Ende (YYYY-MM-DD, lokale Zeit, inklusive)"},
				"breakdown": map[string]interface{}{"type": "string", "enum": []string{"none", "daily", "hourly"}, "description": "hourly nur für start == end"},
			}), "installationId", "gatewaySerial", "deviceId", "start", "end"),
			Run: aiToolConsumption,
		},
		{
			Name: "get_live_features",
			Description: "Liest die aktuellen Live-Werte und Einstellungen eines Geräts aus der Viessmann-Cloud " +
				"(z.B. Heizkurve, Warmwasser-Soll, Hysterese, Betriebsart, Zeitprogramme, Zähler). " +
				"Mit filter (Regex auf den Feature-Namen) die Ausgabe eingrenzen, z.B. \"dhw\" oder \"heating.circuits.0.heating.curve\".",
			Parameters: aiSchema(aiWithDevice(map[string]interface{}{
				"filter":  map[string]interface{}{"type": "string", "description": "Regex auf Feature-Namen (case-insensitive)"},
				"refresh": map[string]interface{}{"type": "boolean", "description": "Cache umgehen (kostet API-Kontingent)"},
			}), "installationId", "deviceId"),
			Run: aiToolLiveFeatures,
		},
		{
			Name: "run_javascript",
			Description: "Führt JavaScript (ES5.1+, goja) aus, um zu rechnen und Daten auszuwerten. " +
				"Verfügbar: query(sql) liefert ein Array von Objekten (lesend, wie query_database, max 50000 Zeilen), " +
				"console.log(...). Der Wert des letzten Ausdrucks wird als JSON zurückgegeben. Timeout 20s. " +
				"Für alle Berechnungen nutzen, statt im Kopf zu rechnen.",
			Parameters: aiSchema(map[string]interface{}{
				"code": map[string]interface{}{"type": "string", "description": "JavaScript-Code"},
			}, "code"),
			Run: aiToolJavaScript,
		},
	}

	// Write tools reuse the existing control handlers (same validation and API calls as the dashboard)
	writeTool := func(name, desc string, h http.HandlerFunc, extra map[string]interface{}, required ...string) aiTool {
		return aiTool{
			Name:        name,
			Description: desc + " Ändert die Anlage, nur nach ausdrücklichem Wunsch des Benutzers verwenden.",
			Parameters:  aiSchema(aiWithDevice(extra), aiDeviceRequired(required...)...),
			Write:       true,
			Run: func(ctx context.Context, args map[string]interface{}) (string, error) {
				if args["deviceId"] == nil {
					args["deviceId"] = "0"
				}
				status, body := aiCallHandler(h, http.MethodPost, "/", args)
				if status != http.StatusOK {
					return "", fmt.Errorf("Status %d: %s", status, strings.TrimSpace(body))
				}
				return body, nil
			},
		}
	}
	circuit := map[string]interface{}{"type": "integer", "description": "Heizkreis (0 = erster Heizkreis)"}

	tools = append(tools, aiScriptTools()...)

	tools = append(tools,
		writeTool("set_dhw_temperature", "Setzt die Warmwasser-Solltemperatur (°C).", dhwTemperatureSetHandler,
			map[string]interface{}{"temperature": map[string]interface{}{"type": "number"}}, "temperature"),
		writeTool("set_dhw_temperature2", "Setzt die zweite Warmwasser-Solltemperatur (temp2, °C).", dhwTemperature2SetHandler,
			map[string]interface{}{"temperature": map[string]interface{}{"type": "number"}}, "temperature"),
		writeTool("set_dhw_hysteresis", "Setzt die Warmwasser-Hysterese (K) für Einschalten (on) oder Ausschalten (off).", dhwHysteresisSetHandler,
			map[string]interface{}{
				"type":  map[string]interface{}{"type": "string", "enum": []string{"on", "off"}},
				"value": map[string]interface{}{"type": "number"},
			}, "type", "value"),
		writeTool("set_dhw_mode", "Setzt die Warmwasser-Betriebsart (z.B. efficient, efficientWithMinComfort, off – je nach Gerät, siehe Live-Feature heating.dhw.operating.modes.active).", dhwModeSetHandler,
			map[string]interface{}{"mode": map[string]interface{}{"type": "string"}}, "mode"),
		writeTool("start_dhw_one_time_charge", "Startet eine einmalige Warmwasserbereitung.", dhwOneTimeChargeHandler, nil),
		writeTool("set_heating_curve", "Setzt die Heizkurve: Neigung (slope 0.2–3.5, Schritt 0.1) und Niveau (shift -13..40).", heatingCurveSetHandler,
			map[string]interface{}{
				"circuit": circuit,
				"slope":   map[string]interface{}{"type": "number"},
				"shift":   map[string]interface{}{"type": "integer"},
			}, "circuit", "slope", "shift"),
		writeTool("set_heating_mode", "Setzt die Betriebsart eines Heizkreises: heating, standby, cooling, heatingCooling.", heatingModeSetHandler,
			map[string]interface{}{
				"circuit": circuit,
				"mode":    map[string]interface{}{"type": "string", "enum": []string{"heating", "standby", "cooling", "heatingCooling"}},
			}, "circuit", "mode"),
		writeTool("set_supply_temp_max", "Setzt die maximale Vorlauftemperatur eines Heizkreises (°C).", supplyTempMaxSetHandler,
			map[string]interface{}{"circuit": circuit, "temperature": map[string]interface{}{"type": "integer"}}, "circuit", "temperature"),
		writeTool("set_room_temperature", "Setzt die Raum-Solltemperatur eines Heizprogramms (normal, comfort, reduced).", roomTempSetHandler,
			map[string]interface{}{
				"circuit":     circuit,
				"program":     map[string]interface{}{"type": "string", "enum": []string{"normal", "comfort", "reduced"}},
				"temperature": map[string]interface{}{"type": "integer"},
			}, "circuit", "program", "temperature"),
		writeTool("set_noise_reduction_mode", "Setzt die Geräuschreduzierung: notReduced, slightlyReduced, maxReduced.", noiseReductionModeSetHandler,
			map[string]interface{}{"mode": map[string]interface{}{"type": "string", "enum": []string{"notReduced", "slightlyReduced", "maxReduced"}}}, "mode"),
		writeTool("set_schedule", "Setzt ein Zeitprogramm (z.B. heating.dhw.schedule, heating.dhw.pumps.circulation.schedule, heating.circuits.0.heating.schedule). "+
			"Vorher das aktuelle Programm per get_live_features lesen und vollständig (alle Wochentage mon..sun) übergeben.", scheduleSetHandler,
			map[string]interface{}{
				"feature": map[string]interface{}{"type": "string"},
				"schedule": map[string]interface{}{
					"type":        "object",
					"description": "Wochentag (mon..sun) -> Liste von {start: \"HH:MM\", end: \"HH:MM\", mode, position}",
				},
			}, "feature", "schedule"),
	)
	return tools
}

// --- Read tools ---

func aiToolListDevices(ctx context.Context, args map[string]interface{}) (string, error) {
	accounts, err := GetActiveAccounts()
	if err != nil {
		return "", err
	}

	type deviceInfo struct {
		DeviceID   string          `json:"deviceId"`
		DeviceType string          `json:"deviceType"`
		ModelID    string          `json:"modelId"`
		Settings   *DeviceSettings `json:"viEventLogSettings,omitempty"`
	}
	type gatewayInfo struct {
		Serial  string       `json:"gatewaySerial"`
		Devices []deviceInfo `json:"devices"`
	}
	type installationInfo struct {
		InstallationID string        `json:"installationId"`
		Description    string        `json:"description"`
		Location       string        `json:"location"`
		Gateways       []gatewayInfo `json:"gateways"`
	}
	type accountInfo struct {
		AccountID     string             `json:"accountId"`
		Name          string             `json:"name"`
		Installations []installationInfo `json:"installations"`
		Error         string             `json:"error,omitempty"`
	}

	result := []accountInfo{}
	for _, account := range accounts {
		info := accountInfo{AccountID: account.ID, Name: account.Name}
		token, err := ensureAccountAuthenticated(account)
		if err != nil {
			info.Error = err.Error()
			result = append(result, info)
			continue
		}
		ids := make([]string, 0, len(token.Installations))
		for id := range token.Installations {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			inst := token.Installations[id]
			ii := installationInfo{
				InstallationID: id,
				Description:    inst.Description,
				Location:       strings.TrimSpace(inst.Address.Zip + " " + inst.Address.City),
			}
			for _, gw := range inst.Gateways {
				gi := gatewayInfo{Serial: gw.Serial}
				for _, d := range gw.Devices {
					di := deviceInfo{DeviceID: d.DeviceID, DeviceType: d.DeviceType, ModelID: d.ModelID}
					if d.DeviceType != "heating" {
						// Device settings are keyed by installation and device ID, which only identifies heating devices
					} else if s, err := GetDeviceSettings(account.ID, id+"_"+d.DeviceID); err == nil && s != nil {
						di.Settings = s
					}
					gi.Devices = append(gi.Devices, di)
				}
				ii.Gateways = append(ii.Gateways, gi)
			}
			info.Installations = append(info.Installations, ii)
		}
		result = append(result, info)
	}

	out := map[string]interface{}{"accounts": result}

	// Data available in the database
	if cols, rows, _, err := aiQueryRows(ctx, `SELECT installation_id, gateway_id, device_id, COUNT(*) AS samples,
		MIN(timestamp) AS first, MAX(timestamp) AS last
		FROM temperature_snapshots GROUP BY installation_id, gateway_id, device_id`, 100); err == nil {
		out["temperatureHistory"] = map[string]interface{}{"columns": cols, "rows": rows}
	}
	if cols, rows, _, err := aiQueryRows(ctx, `SELECT installation_id, device_id, COUNT(*) AS events,
		MIN(event_timestamp) AS first, MAX(event_timestamp) AS last
		FROM events GROUP BY installation_id, device_id`, 100); err == nil {
		out["eventLog"] = map[string]interface{}{"columns": cols, "rows": rows}
	}
	return toJSON(out), nil
}

const aiSchemaNotes = `Hinweise:
- Alle Zeitstempel sind UTC im Format RFC3339 (z.B. 2026-10-22T06:30:00Z). Lokale Zeit: datetime(timestamp, 'localtime') bzw. date(timestamp, 'localtime').
- temperature_snapshots: eine Zeile je Gerät und Messintervall (sample_interval in Minuten, typisch 5).
  Temperaturen in °C. compressor_power = elektrische Leistung in WATT, thermal_power = Wärmeleistung in KILOWATT,
  cop = momentane Leistungszahl. compressor_active 0/1. compressor_speed in U/s bzw. %.
  compressor_starts und compressor_hours sind kumulative Zähler (Differenz max-min = Starts/Stunden im Zeitraum).
  volumetric_flow in l/h. four_way_valve = Ventilstellung (Text, z.B. domesticHotWater, climateCircuitOne).
  supply_temp/return_temp = Vor-/Rücklauf, dhw_temp = Warmwasserspeicher, outside_temp = Außentemperatur.
  burner_modulation in % (Gasheizung).
  Energie eines Intervalls: compressor_power * sample_interval / 60 = Wh, thermal_power * sample_interval / 60 = kWh.
  Warmwasserbereitung erkennt man an four_way_valve = 'domesticHotWater' (falls vorhanden) bzw. steigender dhw_temp bei laufendem Verdichter.
- events: Ereignis-/Fehlerprotokoll der Viessmann-Cloud. event_timestamp UTC, error_code (z.B. F.xxx, S.xxx, I.xxx),
  human_readable / error_description = Klartext, severity, active (1 = Meldung kommt, 0 = geht), feature_name/feature_value bei Feature-Änderungen.
- ai_conversations: gespeicherte Chats (nicht relevant für Analysen).`

func aiToolSchema(ctx context.Context, args map[string]interface{}) (string, error) {
	_, tables, _, err := aiQueryRows(ctx, `SELECT name FROM sqlite_master WHERE type = 'table'
		AND name NOT LIKE 'sqlite_%' AND name NOT IN ('healthcheck', 'schema_migrations') ORDER BY name`, 100)
	if err != nil {
		return "", err
	}
	var sb strings.Builder
	for _, row := range tables {
		name := fmt.Sprint(row[0])
		_, cols, _, err := aiQueryRows(ctx, fmt.Sprintf("PRAGMA table_info(%q)", name), 200)
		if err != nil {
			continue
		}
		parts := make([]string, 0, len(cols))
		for _, c := range cols {
			parts = append(parts, fmt.Sprintf("%v %v", c[1], c[2]))
		}
		sb.WriteString(fmt.Sprintf("TABLE %s (%s)\n", name, strings.Join(parts, ", ")))
	}
	sb.WriteString("\n" + aiSchemaNotes)
	return sb.String(), nil
}

func aiToolQuery(ctx context.Context, args map[string]interface{}) (string, error) {
	query := argString(args, "sql", "")
	if query == "" {
		return "", fmt.Errorf("sql fehlt")
	}
	maxRows := argInt(args, "maxRows", 200)
	if maxRows <= 0 || maxRows > 2000 {
		maxRows = 2000
	}
	cols, rows, truncated, err := aiQueryRows(ctx, query, maxRows)
	if err != nil {
		return "", err
	}
	return toJSON(map[string]interface{}{"columns": cols, "rows": rows, "rowCount": len(rows), "truncated": truncated}), nil
}

func aiToolConsumption(ctx context.Context, args map[string]interface{}) (string, error) {
	if err := aiEnsureDatabase(); err != nil {
		return "", err
	}
	installationID := argString(args, "installationId", "")
	gatewayID := argString(args, "gatewaySerial", "")
	deviceID := argString(args, "deviceId", "0")

	start, err := time.ParseInLocation("2006-01-02", argString(args, "start", ""), time.Local)
	if err != nil {
		return "", fmt.Errorf("start: %v", err)
	}
	end, err := time.ParseInLocation("2006-01-02", argString(args, "end", ""), time.Local)
	if err != nil {
		return "", fmt.Errorf("end: %v", err)
	}
	endExclusive := end.AddDate(0, 0, 1)

	stats, err := GetConsumptionStats(installationID, gatewayID, deviceID, start, endExclusive)
	if err != nil {
		return "", err
	}
	switch argString(args, "breakdown", "none") {
	case "daily":
		stats.DailyBreakdown, err = GetDailyConsumptionBreakdown(installationID, gatewayID, deviceID, start, endExclusive)
	case "hourly":
		stats.HourlyBreakdown, err = GetHourlyConsumptionBreakdown(installationID, gatewayID, deviceID, start)
	}
	if err != nil {
		return "", err
	}
	return toJSON(stats), nil
}

func aiToolLiveFeatures(ctx context.Context, args map[string]interface{}) (string, error) {
	q := url.Values{}
	q.Set("installationId", argString(args, "installationId", ""))
	q.Set("gatewaySerial", argString(args, "gatewaySerial", ""))
	q.Set("deviceId", argString(args, "deviceId", "0"))
	if refresh, _ := args["refresh"].(bool); refresh {
		q.Set("refresh", "true")
	}
	status, body := aiCallHandler(featuresHandler, http.MethodGet, "/api/features?"+q.Encode(), nil)
	if status != http.StatusOK {
		return "", fmt.Errorf("Status %d: %s", status, strings.TrimSpace(body))
	}

	var features DeviceFeatures
	if err := json.Unmarshal([]byte(body), &features); err != nil {
		return "", err
	}

	var filter *regexp.Regexp
	if f := argString(args, "filter", ""); f != "" {
		var err error
		if filter, err = regexp.Compile("(?i)" + f); err != nil {
			return "", fmt.Errorf("ungültiger filter: %v", err)
		}
	}

	result := map[string]interface{}{}
	for _, f := range features.RawFeatures {
		if filter != nil && !filter.MatchString(f.Feature) {
			continue
		}
		if len(f.Properties) == 0 {
			continue
		}
		result[f.Feature] = aiSimplifyProperties(f.Properties)
	}
	return toJSON(map[string]interface{}{"lastUpdate": features.LastUpdate, "featureCount": len(result), "features": result}), nil
}

// aiSimplifyProperties turns {"value": {"type": "number", "value": 45, "unit": "celsius"}} into {"value": "45 celsius"}
// to save tokens, but keeps structured values (schedules, arrays) intact.
func aiSimplifyProperties(props map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	for k, v := range props {
		m, ok := v.(map[string]interface{})
		if !ok {
			out[k] = v
			continue
		}
		val, hasVal := m["value"]
		if !hasVal {
			out[k] = v
			continue
		}
		if unit, ok := m["unit"].(string); ok && unit != "" {
			if _, isScalar := val.(map[string]interface{}); !isScalar {
				out[k] = fmt.Sprintf("%v %s", val, unit)
				continue
			}
		}
		out[k] = val
	}
	return out
}

func aiToolJavaScript(ctx context.Context, args map[string]interface{}) (string, error) {
	code := argString(args, "code", "")
	if code == "" {
		return "", fmt.Errorf("code fehlt")
	}

	vm := goja.New()
	vm.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
	var logs []string

	console := vm.NewObject()
	console.Set("log", func(call goja.FunctionCall) goja.Value {
		parts := make([]string, 0, len(call.Arguments))
		for _, a := range call.Arguments {
			if obj, ok := a.(*goja.Object); ok && obj.ClassName() != "Function" {
				data, _ := json.Marshal(obj.Export())
				parts = append(parts, string(data))
			} else {
				parts = append(parts, a.String())
			}
		}
		logs = append(logs, strings.Join(parts, " "))
		return goja.Undefined()
	})
	vm.Set("console", console)

	vm.Set("query", func(sql string) []map[string]interface{} {
		cols, rows, _, err := aiQueryRows(ctx, sql, 50000)
		if err != nil {
			panic(vm.NewGoError(err))
		}
		out := make([]map[string]interface{}, 0, len(rows))
		for _, row := range rows {
			obj := make(map[string]interface{}, len(cols))
			for i, c := range cols {
				obj[c] = row[i]
			}
			out = append(out, obj)
		}
		return out
	})

	timer := time.AfterFunc(20*time.Second, func() { vm.Interrupt("Timeout nach 20s") })
	defer timer.Stop()

	value, err := vm.RunString(code)
	result := map[string]interface{}{}
	if len(logs) > 0 {
		result["console"] = strings.Join(logs, "\n")
	}
	if err != nil {
		result["error"] = err.Error()
		return toJSON(result), nil
	}
	if value != nil && !goja.IsUndefined(value) {
		result["result"] = value.Export()
	}
	return toJSON(result), nil
}

// aiRunTool executes a tool and returns a (truncated) result string for the model
func aiRunTool(ctx context.Context, tool *aiTool, rawArgs string) string {
	args := map[string]interface{}{}
	if strings.TrimSpace(rawArgs) != "" {
		if err := json.Unmarshal([]byte(rawArgs), &args); err != nil {
			return toJSON(map[string]string{"error": "Ungültige Argumente (kein JSON-Objekt): " + err.Error()})
		}
	}
	result, err := tool.Run(ctx, args)
	if err != nil {
		return toJSON(map[string]string{"error": err.Error()})
	}
	if len(result) > aiMaxToolResult {
		result = result[:aiMaxToolResult] + "\n… [Ergebnis gekürzt – Abfrage eingrenzen oder aggregieren]"
	}
	return result
}

// --- Automation script tools ---

func aiScriptTools() []aiTool {
	str := func(desc string) map[string]interface{} {
		return map[string]interface{}{"type": "string", "description": desc}
	}
	scriptProps := aiWithDevice(map[string]interface{}{
		"id":          str("ID eines bestehenden Skripts zum Ändern, leer für ein neues Skript"),
		"name":        str("Kurzer Name"),
		"description": str("Was das Skript macht"),
		"schedule":    str("Cron-Zeitplan (5 Felder, lokale Zeit), z.B. \"*/5 * * * *\" oder \"0 17 * * *\""),
		"enabled":     map[string]interface{}{"type": "boolean", "description": "Skript aktiv (wird nach Zeitplan ausgeführt)"},
		"code":        str("Skript-Code in expr-Syntax (siehe get_script_docs)"),
	})

	return []aiTool{
		{
			Name: "get_script_docs",
			Description: "Dokumentation der Automatisierungs-Skripte: Syntax (expr), alle Funktionen, Zeitplan-Format und Beispiele. " +
				"Vor dem Schreiben eines Skripts immer lesen.",
			Parameters: aiSchema(map[string]interface{}{}),
			Run: func(ctx context.Context, args map[string]interface{}) (string, error) {
				return scriptDocs(), nil
			},
		},
		{
			Name:        "list_scripts",
			Description: "Listet alle gespeicherten Automatisierungs-Skripte mit Code, Zeitplan, Gerät und letztem Ergebnis.",
			Parameters:  aiSchema(map[string]interface{}{}),
			Run: func(ctx context.Context, args map[string]interface{}) (string, error) {
				scripts, err := listScripts()
				if err != nil {
					return "", err
				}
				return toJSON(scripts), nil
			},
		},
		{
			Name: "test_script",
			Description: "Testlauf eines Skripts für ein Gerät mit echten Live-Werten, ohne Aktionen auszuführen. " +
				"Zeigt Ergebnis, Logs und welche Aktionen ausgeführt würden. Vor save_script immer testen.",
			Parameters: aiSchema(aiWithDevice(map[string]interface{}{
				"code":     str("Skript-Code"),
				"scriptId": str("Optional: ID eines gespeicherten Skripts, um dessen Variablen zu verwenden"),
			}), "accountId", "installationId", "gatewaySerial", "deviceId", "code"),
			Run: func(ctx context.Context, args map[string]interface{}) (string, error) {
				device := scriptDevice{
					AccountID:      argString(args, "accountId", ""),
					InstallationID: argString(args, "installationId", ""),
					GatewaySerial:  argString(args, "gatewaySerial", ""),
					DeviceID:       argString(args, "deviceId", "0"),
				}
				return toJSON(runScript(ctx, argString(args, "scriptId", ""), device, argString(args, "code", ""), true)), nil
			},
		},
		{
			Name:        "get_script_runs",
			Description: "Ausführungsprotokoll eines Skripts (Standard: nur Fehler, manuelle Läufe und ausgeführte Aktionen).",
			Parameters: aiSchema(map[string]interface{}{
				"id":  str("Skript-ID"),
				"all": map[string]interface{}{"type": "boolean", "description": "Auch Läufe ohne Änderung anzeigen"},
			}, "id"),
			Run: func(ctx context.Context, args map[string]interface{}) (string, error) {
				all, _ := args["all"].(bool)
				runs, err := scriptRuns(argString(args, "id", ""), 30, !all)
				if err != nil {
					return "", err
				}
				return toJSON(runs), nil
			},
		},
		{
			Name: "save_script",
			Description: "Speichert ein Automatisierungs-Skript (neu oder Änderung). Aktive Skripte ändern die Anlage automatisch nach Zeitplan. " +
				"Vorher mit test_script prüfen.",
			Parameters: aiSchema(scriptProps, "name", "schedule", "enabled", "code", "accountId", "installationId", "gatewaySerial", "deviceId"),
			Write:      true,
			Run: func(ctx context.Context, args map[string]interface{}) (string, error) {
				enabled, _ := args["enabled"].(bool)
				s := &Script{
					ID: argString(args, "id", ""), Name: argString(args, "name", ""), Description: argString(args, "description", ""),
					Schedule: argString(args, "schedule", ""), Enabled: enabled, Code: argString(args, "code", ""),
					scriptDevice: scriptDevice{
						AccountID:      argString(args, "accountId", ""),
						InstallationID: argString(args, "installationId", ""),
						GatewaySerial:  argString(args, "gatewaySerial", ""),
						DeviceID:       argString(args, "deviceId", "0"),
					},
				}
				saved, err := saveScript(s)
				if err != nil {
					return "", err
				}
				return toJSON(map[string]interface{}{"success": true, "script": saved, "nextRuns": scriptNextRuns(saved.Schedule, 3)}), nil
			},
		},
		{
			Name:        "delete_script",
			Description: "Löscht ein Automatisierungs-Skript inkl. Variablen und Protokoll.",
			Parameters:  aiSchema(map[string]interface{}{"id": str("Skript-ID")}, "id"),
			Write:       true,
			Run: func(ctx context.Context, args map[string]interface{}) (string, error) {
				if err := deleteScript(argString(args, "id", "")); err != nil {
					return "", err
				}
				return `{"success":true}`, nil
			},
		},
		{
			Name:        "run_script_now",
			Description: "Führt ein gespeichertes Skript sofort aus (inkl. Aktionen).",
			Parameters:  aiSchema(map[string]interface{}{"id": str("Skript-ID")}, "id"),
			Write:       true,
			Run: func(ctx context.Context, args map[string]interface{}) (string, error) {
				return toJSON(executeScript(argString(args, "id", ""), "manual")), nil
			},
		},
	}
}
