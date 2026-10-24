package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/expr-lang/expr"
)

// Automation scripts written in the expr language (https://expr-lang.org).
// A script is bound to one device; all functions operate on that device.

const (
	scriptMaxActionsPerRun = 10
	scriptRepeatGuard      = 15 * time.Minute // An identical action is not repeated within this time
	scriptDataMaxAge       = 30 * time.Minute // Cached live values / snapshots up to this age are used without an API call
)

// scriptFunc describes a function available in scripts. The documentation is generated from this table.
type scriptFunc struct {
	Name     string
	Category string
	Sig      string
	Desc     string
	Example  string
	Action   bool // Changes device settings
	Impl     func(rc *scriptRun, args []any) (any, error)
}

// scriptDevice identifies the device a script works on
type scriptDevice struct {
	AccountID      string `json:"accountId"`
	InstallationID string `json:"installationId"`
	GatewaySerial  string `json:"gatewaySerial"`
	DeviceID       string `json:"deviceId"`
}

// scriptAction is an action executed (or planned in a dry run) by a script
type scriptAction struct {
	Function string `json:"function"`
	Args     []any  `json:"args"`
	Status   string `json:"status"` // executed, dry-run, unchanged, recently-done, error
	Detail   string `json:"detail,omitempty"`
}

// scriptRun holds the state of a single script execution
type scriptRun struct {
	ctx      context.Context
	scriptID string
	device   scriptDevice
	dryRun   bool
	now      time.Time
	features *DeviceFeatures
	logs     []string
	actions  []scriptAction
	state    map[string]any
	stateSet map[string]bool
}

// scriptRunResult is returned by runScript and stored in the run log
type scriptRunResult struct {
	Status   string         `json:"status"` // ok, error
	Result   any            `json:"result"`
	Error    string         `json:"error,omitempty"`
	Logs     []string       `json:"logs"`
	Actions  []scriptAction `json:"actions"`
	State    map[string]any `json:"state,omitempty"`
	DryRun   bool           `json:"dryRun"`
	Duration string         `json:"duration"`
}

var (
	scriptRecentActions   = map[string]time.Time{} // scriptID|action signature -> time
	scriptRecentActionsMu sync.Mutex

	scriptLastFetch   = map[string]time.Time{} // device cache key -> last API fetch triggered by scripts
	scriptLastFetchMu sync.Mutex
)

// --- Value helpers ---

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

func argFloat(args []any, i int, name string) (float64, error) {
	if i >= len(args) {
		return 0, fmt.Errorf("Parameter %s fehlt", name)
	}
	f, ok := toFloat(args[i])
	if !ok {
		return 0, fmt.Errorf("Parameter %s muss eine Zahl sein, ist %T", name, args[i])
	}
	return f, nil
}

func argStr(args []any, i int, name string) (string, error) {
	if i >= len(args) {
		return "", fmt.Errorf("Parameter %s fehlt", name)
	}
	s, ok := args[i].(string)
	if !ok {
		return "", fmt.Errorf("Parameter %s muss ein Text sein, ist %T", name, args[i])
	}
	return s, nil
}

func sameNumber(a any, b float64) bool {
	f, ok := toFloat(a)
	return ok && math.Abs(f-b) < 0.001
}

// --- Feature access ---

// loadFeatures returns live values without burdening the API quota: the shared features cache
// (filled by temperature logger and dashboard) is used if it is younger than scriptDataMaxAge.
// Only if there is no recent data, scripts fetch themselves, at most once per device per scriptDataMaxAge.
func (rc *scriptRun) loadFeatures() (*DeviceFeatures, error) {
	if rc.features != nil {
		return rc.features, nil
	}
	key := fmt.Sprintf("%s:%s:%s", rc.device.InstallationID, rc.device.GatewaySerial, rc.device.DeviceID)
	featuresCacheMutex.RLock()
	cached := featuresCache[key]
	featuresCacheMutex.RUnlock()
	if cached != nil && time.Since(cached.LastUpdate) < scriptDataMaxAge {
		rc.features = cached
		return cached, nil
	}

	scriptLastFetchMu.Lock()
	allowed := time.Since(scriptLastFetch[key]) >= scriptDataMaxAge
	if allowed {
		scriptLastFetch[key] = time.Now()
	}
	scriptLastFetchMu.Unlock()
	if !allowed {
		if cached != nil {
			rc.features = cached
			return cached, nil
		}
		return nil, fmt.Errorf("keine aktuellen Live-Daten im Cache (API-Abruf durch Skripte max. alle %d Minuten, Temperatur-Logging aktivieren)", int(scriptDataMaxAge.Minutes()))
	}

	token, ok := getValidAccountToken(rc.device.AccountID)
	if !ok {
		return nil, fmt.Errorf("Account %s nicht angemeldet", rc.device.AccountID)
	}
	rc.logs = append(rc.logs, "Hinweis: keine aktuellen Daten im Cache, Live-Werte von Viessmann abgerufen")
	features, err := fetchFeaturesWithCache(rc.device.InstallationID, rc.device.GatewaySerial, rc.device.DeviceID, token.AccessToken)
	if err != nil {
		return nil, err
	}
	rc.features = features
	return features, nil
}

// cachedValue reads a feature property only if recent data is cached (never calls the API)
func (rc *scriptRun) cachedValue(prop string, names ...string) any {
	if rc.features == nil {
		key := fmt.Sprintf("%s:%s:%s", rc.device.InstallationID, rc.device.GatewaySerial, rc.device.DeviceID)
		featuresCacheMutex.RLock()
		cached := featuresCache[key]
		featuresCacheMutex.RUnlock()
		if cached == nil || time.Since(cached.LastUpdate) >= scriptDataMaxAge {
			return nil
		}
		rc.features = cached
	}
	for _, n := range names {
		if v, _ := rc.featureProp(n, prop); v != nil {
			return v
		}
	}
	return nil
}

// snapshotValue reads the latest value of a temperature_snapshots column (temperature logger)
func (rc *scriptRun) snapshotValue(column string) any {
	db, err := aiReadOnlyDB()
	if err != nil || !scriptHistoryColumn.MatchString(column) {
		return nil
	}
	since := time.Now().Add(-scriptDataMaxAge).UTC().Format(time.RFC3339)
	var v any
	err = db.QueryRowContext(rc.ctx, fmt.Sprintf(`SELECT %s FROM temperature_snapshots WHERE installation_id = ? AND gateway_id = ?
		AND device_id = ? AND timestamp >= ? AND %s IS NOT NULL ORDER BY timestamp DESC LIMIT 1`, column, column),
		rc.device.InstallationID, rc.device.GatewaySerial, rc.device.DeviceID, since).Scan(&v)
	if err != nil {
		return nil
	}
	return v
}

// value reads a measured value: features cache, then latest logger snapshot, then (rate-limited) API fetch
func (rc *scriptRun) value(column string, prop string, names ...string) (any, error) {
	if v := rc.cachedValue(prop, names...); v != nil {
		return v, nil
	}
	if column != "" {
		if v := rc.snapshotValue(column); v != nil {
			return v, nil
		}
	}
	for _, n := range names {
		v, err := rc.featureProp(n, prop)
		if err != nil || v != nil {
			return v, err
		}
	}
	return nil, nil
}

func (rc *scriptRun) findFeature(name string) (*Feature, error) {
	features, err := rc.loadFeatures()
	if err != nil {
		return nil, err
	}
	for i := range features.RawFeatures {
		if features.RawFeatures[i].Feature == name {
			return &features.RawFeatures[i], nil
		}
	}
	return nil, nil
}

// featureProp returns properties[prop].value of a feature, or nil
func (rc *scriptRun) featureProp(name, prop string) (any, error) {
	f, err := rc.findFeature(name)
	if err != nil || f == nil {
		return nil, err
	}
	if p, ok := f.Properties[prop].(map[string]any); ok {
		return p["value"], nil
	}
	return nil, nil
}

// firstFeatureValue returns the "value" property of the first existing feature
func (rc *scriptRun) firstFeatureValue(names ...string) (any, error) {
	for _, n := range names {
		v, err := rc.featureProp(n, "value")
		if err != nil {
			return nil, err
		}
		if v != nil {
			return v, nil
		}
	}
	return nil, nil
}

// --- Actions ---

// action runs a control command unless the current value already matches (current == nil means unknown).
func (rc *scriptRun) action(fn string, args []any, unchanged bool, h http.HandlerFunc, body map[string]any) (any, error) {
	a := scriptAction{Function: fn, Args: args}
	defer func() { rc.actions = append(rc.actions, a) }()

	if unchanged {
		a.Status = "unchanged"
		a.Detail = "Wert ist bereits gesetzt"
		return false, nil
	}

	sig := rc.scriptID + "|" + fn + "|" + toJSON(args)
	scriptRecentActionsMu.Lock()
	last, recent := scriptRecentActions[sig]
	scriptRecentActionsMu.Unlock()
	if recent && time.Since(last) < scriptRepeatGuard && !rc.dryRun {
		a.Status = "recently-done"
		a.Detail = fmt.Sprintf("vor %s bereits ausgeführt, Cloud-Wert noch nicht aktualisiert", time.Since(last).Round(time.Second))
		return false, nil
	}

	executed := 0
	for _, x := range rc.actions {
		if x.Status == "executed" || x.Status == "dry-run" {
			executed++
		}
	}
	if executed >= scriptMaxActionsPerRun {
		a.Status = "error"
		a.Detail = "zu viele Aktionen in einem Lauf"
		return false, fmt.Errorf("maximal %d Aktionen pro Lauf", scriptMaxActionsPerRun)
	}

	if rc.dryRun {
		a.Status = "dry-run"
		a.Detail = "würde ausgeführt"
		return true, nil
	}

	body["accountId"] = rc.device.AccountID
	body["installationId"] = rc.device.InstallationID
	body["gatewaySerial"] = rc.device.GatewaySerial
	body["deviceId"] = rc.device.DeviceID
	status, resp := aiCallHandler(h, http.MethodPost, "/", body)
	var parsed struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
	}
	json.Unmarshal([]byte(resp), &parsed)
	if status != http.StatusOK || !parsed.Success {
		a.Status = "error"
		a.Detail = parsed.Error
		if a.Detail == "" {
			a.Detail = truncateString(strings.TrimSpace(resp), 300)
		}
		return false, fmt.Errorf("%s fehlgeschlagen: %s", fn, a.Detail)
	}

	a.Status = "executed"
	scriptRecentActionsMu.Lock()
	scriptRecentActions[sig] = time.Now()
	scriptRecentActionsMu.Unlock()
	return true, nil
}

// --- Function table ---

var scriptHistoryColumn = regexp.MustCompile(`^[a-z0-9_]+$`)

func scriptFunctions() []scriptFunc {
	circuitFeature := func(args []any, i int, pattern string) (string, int, error) {
		c, err := argFloat(args, i, "circuit")
		if err != nil {
			return "", 0, err
		}
		return fmt.Sprintf(pattern, int(c)), int(c), nil
	}

	return []scriptFunc{
		// --- Values ---
		{Name: "outsideTemp", Category: "Werte", Sig: "outsideTemp()", Desc: "Außentemperatur in °C.",
			Example: "outsideTemp() > 18",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				return rc.value("outside_temp", "value", "heating.sensors.temperature.outside")
			}},
		{Name: "dhwTemp", Category: "Werte", Sig: "dhwTemp()", Desc: "Aktuelle Warmwasser-Speichertemperatur in °C.",
			Example: "dhwTemp() < 45",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				return rc.value("dhw_temp", "value", "heating.dhw.sensors.temperature.dhwCylinder", "heating.dhw.sensors.temperature.hotWaterStorage")
			}},
		{Name: "dhwTarget", Category: "Werte", Sig: "dhwTarget()", Desc: "Eingestellte Warmwasser-Solltemperatur in °C.",
			Example: "dhwTarget() == 53",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				return rc.firstFeatureValue("heating.dhw.temperature.main")
			}},
		{Name: "supplyTemp", Category: "Werte", Sig: "supplyTemp(circuit)", Desc: "Vorlauftemperatur eines Heizkreises in °C (circuit 0 = erster Heizkreis).",
			Example: "supplyTemp(0)",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				name, c, err := circuitFeature(args, 0, "heating.circuits.%d.sensors.temperature.supply")
				if err != nil {
					return nil, err
				}
				return rc.value(fmt.Sprintf("heating_circuit_%d_supply_temp", c), "value", name)
			}},
		{Name: "returnTemp", Category: "Werte", Sig: "returnTemp()", Desc: "Rücklauftemperatur in °C.",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				return rc.value("return_temp", "value", "heating.sensors.temperature.return")
			}},
		{Name: "compressorActive", Category: "Werte", Sig: "compressorActive()", Desc: "true, wenn der Verdichter der Wärmepumpe läuft.",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				v, err := rc.value("compressor_active", "active", "heating.compressors.0")
				if n, ok := toFloat(v); ok {
					return n != 0, err // Snapshot stores 0/1
				}
				return v, err
			}},
		{Name: "heatingMode", Category: "Werte", Sig: "heatingMode(circuit)", Desc: "Betriebsart eines Heizkreises, z.B. \"heating\", \"standby\", \"cooling\".",
			Example: "heatingMode(0) == \"heating\"",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				name, _, err := circuitFeature(args, 0, "heating.circuits.%d.operating.modes.active")
				if err != nil {
					return nil, err
				}
				return rc.firstFeatureValue(name)
			}},
		{Name: "dhwMode", Category: "Werte", Sig: "dhwMode()", Desc: "Warmwasser-Betriebsart, z.B. \"efficient\", \"off\".",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				return rc.firstFeatureValue("heating.dhw.operating.modes.active")
			}},
		{Name: "feature", Category: "Werte", Sig: "feature(name)", Desc: "Wert (properties.value) eines beliebigen Viessmann-Features oder nil. Feature-Namen siehe Dashboard / /api/features.",
			Example: "feature(\"heating.circuits.0.heating.curve\") ?? 0",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				name, err := argStr(args, 0, "name")
				if err != nil {
					return nil, err
				}
				return rc.featureProp(name, "value")
			}},
		{Name: "featureProp", Category: "Werte", Sig: "featureProp(name, property)", Desc: "Beliebige Eigenschaft eines Features, z.B. slope der Heizkurve oder active des Verdichters.",
			Example: "featureProp(\"heating.circuits.0.heating.curve\", \"slope\")",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				name, err := argStr(args, 0, "name")
				if err != nil {
					return nil, err
				}
				prop, err := argStr(args, 1, "property")
				if err != nil {
					return nil, err
				}
				return rc.featureProp(name, prop)
			}},
		{Name: "history", Category: "Werte", Sig: "history(column, minutes, agg)",
			Desc: "Aggregat einer Spalte der Temperatur-Historie dieses Geräts über die letzten Minuten. agg: \"avg\", \"min\", \"max\", \"sum\", \"count\", \"last\". " +
				"Spalten wie outside_temp, dhw_temp, supply_temp, compressor_power (W), thermal_power (kW), compressor_active. Benötigt aktiviertes Temperatur-Logging.",
			Example: "history(\"outside_temp\", 120, \"avg\") > 18",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				col, err := argStr(args, 0, "column")
				if err != nil {
					return nil, err
				}
				minutes, err := argFloat(args, 1, "minutes")
				if err != nil {
					return nil, err
				}
				agg, err := argStr(args, 2, "agg")
				if err != nil {
					return nil, err
				}
				db, err := aiReadOnlyDB()
				if err != nil {
					return nil, err
				}
				if !scriptHistoryColumn.MatchString(col) || !columnExists("temperature_snapshots", col) {
					return nil, fmt.Errorf("unbekannte Spalte %q", col)
				}
				since := rc.now.Add(-time.Duration(minutes) * time.Minute).UTC().Format(time.RFC3339)
				var query string
				switch agg {
				case "avg", "min", "max", "sum", "count":
					query = fmt.Sprintf("SELECT %s(%s) FROM temperature_snapshots WHERE installation_id = ? AND gateway_id = ? AND device_id = ? AND timestamp >= ?", strings.ToUpper(agg), col)
				case "last":
					query = fmt.Sprintf("SELECT %s FROM temperature_snapshots WHERE installation_id = ? AND gateway_id = ? AND device_id = ? AND timestamp >= ? AND %s IS NOT NULL ORDER BY timestamp DESC LIMIT 1", col, col)
				default:
					return nil, fmt.Errorf("agg muss avg, min, max, sum, count oder last sein")
				}
				var v any
				err = db.QueryRowContext(rc.ctx, query, rc.device.InstallationID, rc.device.GatewaySerial, rc.device.DeviceID, since).Scan(&v)
				if err != nil {
					return nil, nil // No data in this period
				}
				if b, ok := v.([]byte); ok {
					return string(b), nil
				}
				return v, nil
			}},

		// --- Time ---
		{Name: "hour", Category: "Zeit", Sig: "hour()", Desc: "Aktuelle Stunde (0–23, lokale Zeit).", Example: "hour() >= 17",
			Impl: func(rc *scriptRun, args []any) (any, error) { return rc.now.Hour(), nil }},
		{Name: "minute", Category: "Zeit", Sig: "minute()", Desc: "Aktuelle Minute (0–59).",
			Impl: func(rc *scriptRun, args []any) (any, error) { return rc.now.Minute(), nil }},
		{Name: "weekday", Category: "Zeit", Sig: "weekday()", Desc: "Wochentag 1 = Montag … 7 = Sonntag.", Example: "weekday() >= 6 // Wochenende",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				wd := int(rc.now.Weekday())
				if wd == 0 {
					wd = 7
				}
				return wd, nil
			}},
		{Name: "timeBetween", Category: "Zeit", Sig: "timeBetween(from, to)", Desc: "true, wenn die aktuelle Uhrzeit im Bereich liegt (\"HH:MM\", inkl. Bereich über Mitternacht).",
			Example: "timeBetween(\"22:00\", \"06:00\")",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				parse := func(i int) (int, error) {
					s, err := argStr(args, i, "time")
					if err != nil {
						return 0, err
					}
					t, err := time.Parse("15:04", s)
					if err != nil {
						return 0, fmt.Errorf("Uhrzeit %q muss HH:MM sein", s)
					}
					return t.Hour()*60 + t.Minute(), nil
				}
				from, err := parse(0)
				if err != nil {
					return nil, err
				}
				to, err := parse(1)
				if err != nil {
					return nil, err
				}
				cur := rc.now.Hour()*60 + rc.now.Minute()
				if from <= to {
					return cur >= from && cur < to, nil
				}
				return cur >= from || cur < to, nil
			}},

		// --- State & output ---
		{Name: "get", Category: "Variablen & Ausgabe", Sig: "get(key[, default])", Desc: "Liest eine dauerhaft gespeicherte Variable dieses Skripts (bleibt zwischen Läufen erhalten).",
			Example: "get(\"mode\", \"normal\")",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				key, err := argStr(args, 0, "key")
				if err != nil {
					return nil, err
				}
				if v, ok := rc.state[key]; ok && v != nil {
					return v, nil
				}
				if len(args) > 1 {
					return args[1], nil
				}
				return nil, nil
			}},
		{Name: "set", Category: "Variablen & Ausgabe", Sig: "set(key, value)", Desc: "Speichert eine Variable dauerhaft (nicht im Testlauf). Gibt value zurück.",
			Example: "set(\"mode\", \"sommer\")",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				key, err := argStr(args, 0, "key")
				if err != nil {
					return nil, err
				}
				if len(args) < 2 {
					return nil, fmt.Errorf("Parameter value fehlt")
				}
				rc.state[key] = args[1]
				rc.stateSet[key] = true
				return args[1], nil
			}},
		{Name: "log", Category: "Variablen & Ausgabe", Sig: "log(values...)", Desc: "Schreibt eine Zeile in das Ausführungsprotokoll. Gibt true zurück.",
			Example: "log(\"Außen:\", outsideTemp())",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				parts := make([]string, len(args))
				for i, a := range args {
					parts[i] = fmt.Sprint(a)
				}
				rc.logs = append(rc.logs, strings.Join(parts, " "))
				return true, nil
			}},

		// --- Actions ---
		{Name: "setDhwTemperature", Category: "Aktionen", Action: true, Sig: "setDhwTemperature(celsius)", Desc: "Setzt die Warmwasser-Solltemperatur.",
			Example: "setDhwTemperature(50)",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				t, err := argFloat(args, 0, "celsius")
				if err != nil {
					return nil, err
				}
				cur, err := rc.firstFeatureValue("heating.dhw.temperature.main")
				if err != nil {
					return nil, err
				}
				return rc.action("setDhwTemperature", args, sameNumber(cur, t), dhwTemperatureSetHandler, map[string]any{"temperature": t})
			}},
		{Name: "setDhwTemperature2", Category: "Aktionen", Action: true, Sig: "setDhwTemperature2(celsius)", Desc: "Setzt die zweite Warmwasser-Solltemperatur (temp2).",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				t, err := argFloat(args, 0, "celsius")
				if err != nil {
					return nil, err
				}
				cur, err := rc.firstFeatureValue("heating.dhw.temperature.temp2")
				if err != nil {
					return nil, err
				}
				return rc.action("setDhwTemperature2", args, sameNumber(cur, t), dhwTemperature2SetHandler, map[string]any{"temperature": t})
			}},
		{Name: "setDhwHysteresis", Category: "Aktionen", Action: true, Sig: "setDhwHysteresis(type, kelvin)", Desc: "Setzt die Warmwasser-Hysterese, type \"on\" (Einschalten) oder \"off\" (Ausschalten).",
			Example: "setDhwHysteresis(\"on\", 5)",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				typ, err := argStr(args, 0, "type")
				if err != nil {
					return nil, err
				}
				v, err := argFloat(args, 1, "kelvin")
				if err != nil {
					return nil, err
				}
				prop := map[string]string{"on": "switchOnValue", "off": "switchOffValue"}[typ]
				if prop == "" {
					return nil, fmt.Errorf("type muss \"on\" oder \"off\" sein")
				}
				cur, err := rc.featureProp("heating.dhw.temperature.hysteresis", prop)
				if err != nil {
					return nil, err
				}
				return rc.action("setDhwHysteresis", args, sameNumber(cur, v), dhwHysteresisSetHandler, map[string]any{"type": typ, "value": v})
			}},
		{Name: "setDhwMode", Category: "Aktionen", Action: true, Sig: "setDhwMode(mode)", Desc: "Setzt die Warmwasser-Betriebsart (Werte je nach Gerät, siehe dhwMode()).",
			Example: "setDhwMode(\"efficient\")",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				mode, err := argStr(args, 0, "mode")
				if err != nil {
					return nil, err
				}
				cur, err := rc.firstFeatureValue("heating.dhw.operating.modes.active")
				if err != nil {
					return nil, err
				}
				return rc.action("setDhwMode", args, cur == mode, dhwModeSetHandler, map[string]any{"mode": mode})
			}},
		{Name: "startDhwOneTimeCharge", Category: "Aktionen", Action: true, Sig: "startDhwOneTimeCharge()", Desc: "Startet eine einmalige Warmwasserbereitung (übersprungen, wenn sie bereits läuft).",
			Example: "hour() == 17 && minute() == 0 ? startDhwOneTimeCharge() : false",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				active, err := rc.featureProp("heating.dhw.oneTimeCharge", "active")
				if err != nil {
					return nil, err
				}
				return rc.action("startDhwOneTimeCharge", args, active == true, dhwOneTimeChargeHandler, map[string]any{})
			}},
		{Name: "setHeatingCurve", Category: "Aktionen", Action: true, Sig: "setHeatingCurve(circuit, slope, shift)", Desc: "Setzt die Heizkurve: Neigung 0.2–3.5, Niveau -13 bis 40.",
			Example: "setHeatingCurve(0, 0.6, 2)",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				name, circuit, err := circuitFeature(args, 0, "heating.circuits.%d.heating.curve")
				if err != nil {
					return nil, err
				}
				slope, err := argFloat(args, 1, "slope")
				if err != nil {
					return nil, err
				}
				shift, err := argFloat(args, 2, "shift")
				if err != nil {
					return nil, err
				}
				curSlope, err := rc.featureProp(name, "slope")
				if err != nil {
					return nil, err
				}
				curShift, _ := rc.featureProp(name, "shift")
				return rc.action("setHeatingCurve", args, sameNumber(curSlope, slope) && sameNumber(curShift, shift), heatingCurveSetHandler,
					map[string]any{"circuit": circuit, "slope": slope, "shift": int(shift)})
			}},
		{Name: "setHeatingMode", Category: "Aktionen", Action: true, Sig: "setHeatingMode(circuit, mode)", Desc: "Setzt die Betriebsart eines Heizkreises: \"heating\", \"standby\", \"cooling\", \"heatingCooling\".",
			Example: "setHeatingMode(0, \"standby\")",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				name, circuit, err := circuitFeature(args, 0, "heating.circuits.%d.operating.modes.active")
				if err != nil {
					return nil, err
				}
				mode, err := argStr(args, 1, "mode")
				if err != nil {
					return nil, err
				}
				cur, err := rc.firstFeatureValue(name)
				if err != nil {
					return nil, err
				}
				return rc.action("setHeatingMode", args, cur == mode, heatingModeSetHandler, map[string]any{"circuit": circuit, "mode": mode})
			}},
		{Name: "setSupplyTempMax", Category: "Aktionen", Action: true, Sig: "setSupplyTempMax(circuit, celsius)", Desc: "Setzt die maximale Vorlauftemperatur eines Heizkreises.",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				name, circuit, err := circuitFeature(args, 0, "heating.circuits.%d.temperature.levels")
				if err != nil {
					return nil, err
				}
				t, err := argFloat(args, 1, "celsius")
				if err != nil {
					return nil, err
				}
				cur, err := rc.featureProp(name, "max")
				if err != nil {
					return nil, err
				}
				return rc.action("setSupplyTempMax", args, sameNumber(cur, t), supplyTempMaxSetHandler, map[string]any{"circuit": circuit, "temperature": int(t)})
			}},
		{Name: "setRoomTemperature", Category: "Aktionen", Action: true, Sig: "setRoomTemperature(circuit, program, celsius)", Desc: "Setzt die Raum-Solltemperatur eines Programms: \"normal\", \"comfort\", \"reduced\".",
			Example: "setRoomTemperature(0, \"normal\", 21)",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				c, err := argFloat(args, 0, "circuit")
				if err != nil {
					return nil, err
				}
				program, err := argStr(args, 1, "program")
				if err != nil {
					return nil, err
				}
				t, err := argFloat(args, 2, "celsius")
				if err != nil {
					return nil, err
				}
				// Many devices expose e.g. "normalHeating" instead of "normal" (like the dashboard does)
				var cur any
				resolved := program
				for _, cand := range []string{program, program + "Heating"} {
					f, err := rc.findFeature(fmt.Sprintf("heating.circuits.%d.operating.programs.%s", int(c), cand))
					if err != nil {
						return nil, err
					}
					if f != nil {
						resolved = cand
						if p, ok := f.Properties["temperature"].(map[string]any); ok {
							cur = p["value"]
						}
						break
					}
				}
				return rc.action("setRoomTemperature", args, sameNumber(cur, t), roomTempSetHandler,
					map[string]any{"circuit": int(c), "program": resolved, "temperature": int(t)})
			}},
		{Name: "setNoiseReductionMode", Category: "Aktionen", Action: true, Sig: "setNoiseReductionMode(mode)", Desc: "Setzt die Geräuschreduzierung: \"notReduced\", \"slightlyReduced\", \"maxReduced\".",
			Example: "setNoiseReductionMode(timeBetween(\"22:00\", \"06:00\") ? \"maxReduced\" : \"notReduced\")",
			Impl: func(rc *scriptRun, args []any) (any, error) {
				mode, err := argStr(args, 0, "mode")
				if err != nil {
					return nil, err
				}
				cur, err := rc.firstFeatureValue("heating.noise.reduction.operating.programs.active")
				if err != nil {
					return nil, err
				}
				return rc.action("setNoiseReductionMode", args, cur == mode, noiseReductionModeSetHandler, map[string]any{"mode": mode})
			}},
	}
}

// scriptCompileOptions builds the expr options; rc is nil for syntax checks only
func scriptCompileOptions(rc *scriptRun) []expr.Option {
	opts := []expr.Option{expr.Env(map[string]any{}), expr.Timezone(time.Local.String())}
	for _, f := range scriptFunctions() {
		f := f
		opts = append(opts, expr.Function(f.Name, func(params ...any) (any, error) {
			if rc == nil {
				return nil, fmt.Errorf("nicht ausführbar")
			}
			if err := rc.ctx.Err(); err != nil {
				return nil, err
			}
			return f.Impl(rc, params)
		}))
	}
	return opts
}

// validateScript checks the syntax of a script
func validateScript(code string) error {
	_, err := expr.Compile(code, scriptCompileOptions(nil)...)
	return err
}

// runScript executes a script for its device. In a dry run no actions are executed and no state is stored.
func runScript(ctx context.Context, scriptID string, device scriptDevice, code string, dryRun bool) *scriptRunResult {
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	rc := &scriptRun{
		ctx: ctx, scriptID: scriptID, device: device, dryRun: dryRun, now: time.Now(),
		state: map[string]any{}, stateSet: map[string]bool{},
	}
	if scriptID != "" {
		rc.state = scriptLoadState(scriptID)
	}
	res := rc.run(code)
	res.Duration = time.Since(start).Round(time.Millisecond).String()
	return res
}

func (rc *scriptRun) run(code string) *scriptRunResult {
	dryRun := rc.dryRun
	scriptID := rc.scriptID
	res := &scriptRunResult{DryRun: dryRun}
	program, err := expr.Compile(code, scriptCompileOptions(rc)...)
	if err == nil {
		res.Result, err = expr.Run(program, map[string]any{})
	}
	if err != nil {
		res.Status = "error"
		res.Error = scriptErrorText(err)
	} else {
		res.Status = "ok"
	}

	if len(rc.stateSet) > 0 {
		res.State = map[string]any{}
		for k := range rc.stateSet {
			res.State[k] = rc.state[k]
		}
		if !dryRun && scriptID != "" {
			scriptSaveState(scriptID, res.State)
		}
	}
	res.Logs = rc.logs
	res.Actions = rc.actions
	if res.Logs == nil {
		res.Logs = []string{}
	}
	if res.Actions == nil {
		res.Actions = []scriptAction{}
	}
	return res
}

var scriptHTMLError = regexp.MustCompile(`(?s)<!DOCTYPE.*|<html.*`)

// scriptErrorText shortens errors, e.g. Viessmann error pages returned as HTML
func scriptErrorText(err error) string {
	msg := scriptHTMLError.ReplaceAllString(err.Error(), "[HTML-Fehlerseite der Viessmann-Cloud]")
	return truncateString(msg, 600)
}
