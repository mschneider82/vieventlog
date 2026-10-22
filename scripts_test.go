package main

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func testScriptRun(features map[string]map[string]any, now time.Time) *scriptRun {
	df := &DeviceFeatures{}
	for name, props := range features {
		df.RawFeatures = append(df.RawFeatures, Feature{Feature: name, Properties: props})
	}
	return &scriptRun{
		ctx: context.Background(), dryRun: true, now: now, features: df,
		state: map[string]any{}, stateSet: map[string]bool{},
	}
}

func value(v any) map[string]any {
	return map[string]any{"value": map[string]any{"type": "number", "value": v}}
}

func TestScriptOutsideTempRule(t *testing.T) {
	code := `
let t = outsideTemp();
if t > 18 {
  setDhwTemperature(50)
} else {
  setDhwTemperature(53)
}`
	tests := []struct {
		name       string
		outside    float64
		target     float64
		wantStatus string
		wantArg    float64
	}{
		{"warm, change", 20, 53, "dry-run", 50},
		{"cold, change", 10, 50, "dry-run", 53},
		{"warm, already set", 20, 50, "unchanged", 50},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rc := testScriptRun(map[string]map[string]any{
				"heating.sensors.temperature.outside": value(tt.outside),
				"heating.dhw.temperature.main":        value(tt.target),
			}, time.Now())
			res := rc.run(code)
			if res.Status != "ok" {
				t.Fatalf("status %s: %s", res.Status, res.Error)
			}
			if len(res.Actions) != 1 {
				t.Fatalf("got %d actions, want 1", len(res.Actions))
			}
			a := res.Actions[0]
			if a.Status != tt.wantStatus || !sameNumber(a.Args[0], tt.wantArg) {
				t.Errorf("got %s(%v) %s, want %v %s", a.Function, a.Args, a.Status, tt.wantArg, tt.wantStatus)
			}
		})
	}
}

func TestScriptTimeAndState(t *testing.T) {
	now := time.Date(2026, 10, 24, 23, 30, 0, 0, time.Local) // Saturday
	rc := testScriptRun(nil, now)
	res := rc.run(`set("x", 5); [timeBetween("22:00", "06:00"), timeBetween("08:00", "12:00"), weekday(), hour(), get("x"), get("y", "d")]`)
	if res.Status != "ok" {
		t.Fatalf("status %s: %s", res.Status, res.Error)
	}
	got := toJSON(res.Result)
	if want := `[true,false,6,23,5,"d"]`; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
	if res.State["x"] != 5 {
		t.Errorf("state not reported: %v", res.State)
	}
}

func TestScriptValidation(t *testing.T) {
	if err := validateScript(`setDhwTemperature(50)`); err != nil {
		t.Errorf("valid script rejected: %v", err)
	}
	if err := validateScript(`unknownFunction(1)`); err == nil {
		t.Error("unknown function accepted")
	}
	if err := validateScript(`let x = ;`); err == nil {
		t.Error("syntax error accepted")
	}
}

// TestScriptDocsUpToDate keeps docs/SCRIPTS.md in sync with the function table.
// Regenerate with: UPDATE_DOCS=1 go test -run TestScriptDocsUpToDate
func TestScriptDocsUpToDate(t *testing.T) {
	docs := scriptDocs()
	if os.Getenv("UPDATE_DOCS") == "1" {
		if err := os.WriteFile("docs/SCRIPTS.md", []byte(docs), 0644); err != nil {
			t.Fatal(err)
		}
	}
	current, err := os.ReadFile("docs/SCRIPTS.md")
	if err != nil || string(current) != docs {
		t.Fatal("docs/SCRIPTS.md is outdated, run: UPDATE_DOCS=1 go test -run TestScriptDocsUpToDate")
	}
	for _, f := range scriptFunctions() {
		if !strings.Contains(docs, "`"+f.Sig+"`") {
			t.Errorf("function %s missing in docs", f.Name)
		}
	}
}
