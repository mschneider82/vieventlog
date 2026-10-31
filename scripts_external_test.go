package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const evccState = `{"grid": {"power": -2592.3}, "pvPower": 5400,
	"loadpoints": [{"title": "Garage", "chargePower": 0, "vehicleSoc": 64}, {"title": "Carport", "chargePower": 3700}],
	"odd keys": {"a.b": 1, "x-y": 2}}`

func TestExtractPath(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{"grid.power", `-2592.3`},
		{".grid.power", `-2592.3`},
		{"$.grid.power", `-2592.3`},
		{"pvPower", `5400`},
		{"loadpoints[0].vehicleSoc", `64`},
		{"loadpoints.0.vehicleSoc", `64`},
		{".loadpoints.[1].chargePower", `3700`},
		{"loadpoints[-1].title", `"Carport"`},
		{"loadpoints[2].title", `null`},
		{"loadpoints[-3]", `null`},
		{`["odd keys"]["a.b"]`, `1`},
		{`['odd keys'].x-y`, `2`},
		{`[ "grid" ].power`, `-2592.3`},
		{"gridPower", `null`},
		{"grid.power.x", `null`},
		{"loadpoints.title", `null`},
		{"", `{"loadpoints":[{"chargePower":0,"title":"Garage","vehicleSoc":64},{"chargePower":3700,"title":"Carport"}],"grid":{"power":-2592.3},"odd keys":{"a.b":1,"x-y":2},"pvPower":5400}`},
		{"$", ``},
		{".", ``},
	}
	doc := parseExternal([]byte(evccState))
	for _, tt := range tests {
		got, err := extractPath(doc, tt.path)
		if err != nil {
			t.Errorf("%q: %v", tt.path, err)
			continue
		}
		want := tt.want
		if want == "" {
			want = toJSON(doc)
		}
		if g := toJSON(got); !sameJSON(g, want) {
			t.Errorf("%q: got %s, want %s", tt.path, g, want)
		}
	}

	for _, bad := range []string{"a..b", "a.", "a[", "a[x]", "a[*]", `a["b]`, `a["b"`, "a[0]b"} {
		if _, err := extractPath(doc, bad); err == nil {
			t.Errorf("%q: expected path error", bad)
		}
	}

	// JSON text is parsed first, other values are walked with reflection
	if v, _ := extractPath(`{"a": [1, 2]}`, "a[1]"); !sameNumber(v, 2) {
		t.Errorf("JSON text: got %v", v)
	}
	if v, _ := extractPath(map[string]float64{"x": 3}, "x"); !sameNumber(v, 3) {
		t.Errorf("typed map: got %v", v)
	}
	if v, _ := extractPath(nil, "x"); v != nil {
		t.Errorf("nil: got %v", v)
	}
}

// sameJSON compares JSON ignoring key order
func sameJSON(a, b string) bool {
	return toJSON(parseExternal([]byte(a))) == toJSON(parseExternal([]byte(b)))
}

func TestToNumber(t *testing.T) {
	tests := []struct {
		in   any
		want any
	}{
		{"22.5", 22.5}, {" 22,5 ", 22.5}, {"22.5 °C", 22.5}, {"22.5°C", 22.5}, {"100%", 100.0}, {"-3", -3.0},
		{"1e3", 1000.0}, {"230V", 230.0}, {".5", 0.5}, {42, 42.0}, {int32(7), 7.0}, {true, 1.0}, {false, 0.0},
		{"unavailable", nil}, {"12:30", nil}, {"1.234,5", nil}, {"2026-10-31", nil}, {"", nil}, {nil, nil}, {[]any{1}, nil},
	}
	for _, tt := range tests {
		if got := toNumberValue(tt.in); got != tt.want {
			t.Errorf("toNumber(%#v) = %#v, want %#v", tt.in, got, tt.want)
		}
	}
}

func TestScriptHTTPGet(t *testing.T) {
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		switch r.URL.Path {
		case "/api/state":
			w.Write([]byte(evccState))
		case "/api/states/sensor.room":
			if r.Header.Get("Authorization") != "Bearer secret" {
				http.Error(w, `{"message": "Unauthorized"}`, http.StatusUnauthorized)
				return
			}
			w.Write([]byte(`{"entity_id": "sensor.room", "state": "21.5", "attributes": {"unit_of_measurement": "°C"}}`))
		case "/plain":
			w.Write([]byte("-2592.3\n"))
		case "/metrics":
			w.Write([]byte("# HELP power_watts Power\npower_watts{phase=\"a\"} 1234.5\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	rc := testScriptRun(nil, time.Now())
	res := rc.run(`
let url = "` + srv.URL + `";
let ha = {"Authorization": "Bearer secret"};
let s = httpGet(url + "/api/state");
[
  httpGet(url + "/api/state", "grid.power"),
  httpGet(url + "/api/state", "loadpoints[1].chargePower"),
  sum(map(s.loadpoints, .chargePower)),
  find(s.loadpoints, .title == "Garage")?.vehicleSoc,
  jsonPath(s, "grid.power") < -2200,
  httpGet(url + "/api/state", "gridPower") ?? "fallback",
  toNumber(httpGet(url + "/api/states/sensor.room", "state", ha)),
  httpGet(url + "/api/states/sensor.room", ha).attributes.unit_of_measurement,
  httpGet(url + "/api/states/sensor.room", "state") ?? "unauthorized",
  httpGet(url + "/plain"),
  toNumber(regexFind(httpGet(url + "/metrics"), ` + "`power_watts\\{[^}]*\\} (\\S+)`" + `)),
  httpGet(url + "/missing", "x") ?? "missing",
  httpGet("http://127.0.0.1:1/unreachable") ?? "down"
]`)
	if res.Status != "ok" {
		t.Fatalf("status %s: %s", res.Status, res.Error)
	}
	want := `[-2592.3,3700,3700,64,true,"fallback",21.5,"°C","unauthorized",-2592.3,1234.5,"missing","down"]`
	if got := toJSON(res.Result); got != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
	// /api/state once, sensor.room with and without token, plain, metrics, missing
	if n := requests.Load(); n != 6 {
		t.Errorf("got %d requests, want 6 (one per URL and headers)", n)
	}
	logs := strings.Join(res.Logs, "\n")
	for _, want := range []string{"HTTP 401 Unauthorized", "HTTP 404 Not Found", "127.0.0.1:1/unreachable"} {
		if !strings.Contains(logs, want) {
			t.Errorf("log should contain %q:\n%s", want, logs)
		}
	}

	// Programming errors stop the script
	for _, code := range []string{
		`httpGet("ftp://example.com/x")`,
		`httpGet("` + srv.URL + `/api/state", "a[x]")`,
		`httpGet("` + srv.URL + `/api/state", "grid", "no map")`,
		`regexFind("abc", "(")`,
	} {
		if res := testScriptRun(nil, time.Now()).run(code); res.Status != "error" {
			t.Errorf("%s: expected error, got %s %v", code, res.Status, res.Result)
		}
	}
}

func TestScriptHTTPGetHidesPassword(t *testing.T) {
	rc := testScriptRun(nil, time.Now())
	res := rc.run(`httpGet("http://user:topsecret@127.0.0.1:1/x") ?? 0`)
	if res.Status != "ok" || len(res.Logs) != 1 {
		t.Fatalf("got %s %v", res.Status, res.Logs)
	}
	if strings.Contains(res.Logs[0], "topsecret") {
		t.Errorf("password in log: %s", res.Logs[0])
	}
}

func TestScriptReadFile(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "files")
	os.MkdirAll(filepath.Join(dir, "sub"), 0755)
	t.Setenv("SCRIPT_FILES_DIR", dir)
	os.WriteFile(filepath.Join(dir, "sensors.json"), []byte(`{"timestamp": "2026-10-26T12:00:00+01:00", "sensor_1": 22.1}`), 0644)
	os.WriteFile(filepath.Join(dir, "sub", "value.txt"), []byte("\xef\xbb\xbf 17,5 °C\n"), 0644)
	os.WriteFile(filepath.Join(dir, "old.json"), []byte(`{"v": 1}`), 0644)
	old := time.Now().Add(-time.Hour)
	os.Chtimes(filepath.Join(dir, "old.json"), old, old)
	os.WriteFile(filepath.Join(base, "secret.json"), []byte(`{"password": "x"}`), 0644)
	os.Symlink(filepath.Join(base, "secret.json"), filepath.Join(dir, "link.json"))

	rc := testScriptRun(nil, time.Now())
	res := rc.run(`[
  readFile("sensors.json", "sensor_1"),
  readFile("sensors.json", "sensor_1", 15),
  readFile("sensors.json").sensor_1,
  toNumber(readFile("sub/value.txt")),
  readFile("old.json", "v"),
  readFile("old.json", "v", 30) ?? "stale",
  readFile("missing.json", "v") ?? "missing",
  readFile("link.json", "password") ?? "blocked",
  date(readFile("sensors.json", "timestamp")).Year(),
  now() - date(readFile("sensors.json", "timestamp")) > duration("15m")
]`)
	if res.Status != "ok" {
		t.Fatalf("status %s: %s", res.Status, res.Error)
	}
	if got, want := toJSON(res.Result), `[22.1,22.1,22.1,17.5,1,"stale","missing","blocked",2026,true]`; got != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
	logs := strings.Join(res.Logs, "\n")
	for _, want := range []string{"old.json: zuletzt vor 60 Minuten", "missing.json: nicht gefunden in " + dir, "link.json"} {
		if !strings.Contains(logs, want) {
			t.Errorf("log should contain %q:\n%s", want, logs)
		}
	}

	for _, name := range []string{"../secret.json", filepath.Join(base, "secret.json"), ""} {
		if res := testScriptRun(nil, time.Now()).run(`readFile("` + name + `")`); res.Status != "error" {
			t.Errorf("readFile(%q): expected error, got %v", name, res.Result)
		}
	}
}

// TestScriptPVSurplusExample runs the evcc example of the docs over several runs
func TestScriptPVSurplusExample(t *testing.T) {
	code := docExample(t, "PV-Überschuss aus evcc")
	grid := -2500.0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(toJSON(map[string]any{"grid": map[string]any{"power": grid}})))
	}))
	defer srv.Close()
	code = strings.Replace(code, "http://192.168.1.10:7070", srv.URL, 1)

	state := map[string]any{}
	run := func(now time.Time) *scriptRunResult {
		rc := testScriptRun(map[string]map[string]any{
			"heating.dhw.sensors.temperature.dhwCylinder": value(40.0),
			"heading.dhw.oneTimeCharge":                   {"active": map[string]any{"type": "boolean", "value": false}},
		}, now)
		rc.state = state
		res := rc.run(code)
		if res.Status != "ok" {
			t.Fatalf("status %s: %s", res.Status, res.Error)
		}
		for k, v := range res.State {
			state[k] = parseExternal([]byte(toJSON(v))) // Stored as JSON like scriptSaveState
		}
		return res
	}

	start := time.Now()
	if res := run(start); len(res.Actions) != 0 {
		t.Errorf("surplus just started, got actions %v", res.Actions)
	}
	// The example uses now(), so the start time is shifted instead of the clock
	state["surplusSince"] = float64(start.Add(-31 * time.Minute).Unix())
	if res := run(start); len(res.Actions) != 1 || res.Actions[0].Function != "startDhwOneTimeCharge" {
		t.Errorf("30 minutes surplus, got actions %v, logs %v", res.Actions, res.Logs)
	}
	grid = 300
	if res := run(start); len(res.Actions) != 0 || state["surplusSince"] != nil {
		t.Errorf("no surplus, got actions %v, state %v", res.Actions, state)
	}
}

var docCodeBlock = regexp.MustCompile("(?s)```\n(.*?)```")

// docExample returns the code block following the bold title in the script docs
func docExample(t *testing.T, title string) string {
	docs := scriptDocs()
	i := strings.Index(docs, "**"+title)
	if i < 0 {
		t.Fatalf("example %q not found in docs", title)
	}
	m := docCodeBlock.FindStringSubmatch(docs[i:])
	if m == nil {
		t.Fatalf("no code block after %q", title)
	}
	return m[1]
}

func TestScriptDate(t *testing.T) {
	rc := testScriptRun(nil, time.Now())
	res := rc.run(`[
  date("2026-10-26").Format("2006-01-02 15:04 MST"),
  date("2026-10-26T12:00:00+01:00").UTC().Format("15:04"),
  date("2026-10-26 12:30:00").Format("15:04"),
  date("26.10.2026 07:15", "02.01.2006 15:04").Format("15:04"),
  date("2026-10-26 12:00", "2006-01-02 15:04", "UTC").Format("15:04 MST"),
  date(1792929600).UTC().Format("2006-01-02T15:04"),
  date(1792929600000).UTC().Format("2006-01-02T15:04"),
  date(nil) ?? "none",
  (now() - date("2026-10-26T12:00:00+01:00")).Hours() > 0
]`)
	if res.Status != "ok" {
		t.Fatalf("status %s: %s", res.Status, res.Error)
	}
	zone, _ := time.Date(2026, 10, 26, 0, 0, 0, 0, time.Local).Zone()
	want := `["2026-10-26 00:00 ` + zone + `","11:00","12:30","07:15","12:00 UTC","2026-10-25T12:00","2026-10-25T12:00","none",true]`
	if got := toJSON(res.Result); got != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
	if res := testScriptRun(nil, time.Now()).run(`date("gestern")`); res.Status != "error" {
		t.Errorf("expected error, got %v", res.Result)
	}
}

// TestScriptDocExamplesCompile makes sure all examples in the docs are valid scripts
func TestScriptDocExamplesCompile(t *testing.T) {
	blocks := regexp.MustCompile("(?s)```\n(.*?)```").FindAllStringSubmatch(scriptDocs(), -1)
	if len(blocks) < 8 {
		t.Fatalf("found only %d code blocks", len(blocks))
	}
	for _, b := range blocks {
		if strings.HasPrefix(strings.TrimSpace(b[1]), "{") {
			continue // JSON sample
		}
		if err := validateScript(b[1]); err != nil {
			t.Errorf("example does not compile: %v\n%s", err, b[1])
		}
	}
}
