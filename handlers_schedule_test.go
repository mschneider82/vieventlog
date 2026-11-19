package main

import "testing"

func TestHeatingCommandTarget(t *testing.T) {
	token := &AccountToken{Installations: map[string]*Installation{
		"test-installation": {Gateways: []Gateway{{
			Serial:  "test-gateway",
			Devices: []GatewayDevice{{DeviceID: "0", DeviceType: "heating"}},
		}}},
	}}
	for _, deviceType := range []string{"heating", "systemController", "indoorUnit", "outdoorUnit", "zigbee", "unknown", ""} {
		t.Run(deviceType, func(t *testing.T) {
			token.Installations["test-installation"].Gateways[0].Devices[0].DeviceType = deviceType
			if got := isHeatingCommandTarget(token, "test-installation", "test-gateway", "0"); got != (deviceType == "heating") {
				t.Errorf("isHeatingCommandTarget() = %v for %q", got, deviceType)
			}
		})
	}
	token.Installations["test-installation"].Gateways[0].Devices[0].DeviceType = "heating"
	if isHeatingCommandTarget(nil, "test-installation", "test-gateway", "0") ||
		isHeatingCommandTarget(token, "missing-installation", "test-gateway", "0") ||
		isHeatingCommandTarget(token, "test-installation", "missing-gateway", "0") ||
		isHeatingCommandTarget(token, "test-installation", "test-gateway", "missing-device") {
		t.Fatal("missing targets must be rejected")
	}
	if !isHeatingCommandTarget(token, "test-installation", "", "0") {
		t.Fatal("a unique heating target should work without a gateway")
	}
	token.Installations["test-installation"].Gateways = append(token.Installations["test-installation"].Gateways, Gateway{
		Serial: "other-test-gateway", Devices: []GatewayDevice{{DeviceID: "0", DeviceType: "heating"}},
	})
	if isHeatingCommandTarget(token, "test-installation", "", "0") {
		t.Fatal("ambiguous targets must be rejected")
	}
	if !isHeatingCommandTarget(token, "test-installation", "test-gateway", "0") {
		t.Fatal("an explicit gateway should resolve ambiguity")
	}
}

func TestDashboardDeviceEligibility(t *testing.T) {
	for _, test := range []struct {
		deviceType string
		deviceID   string
		dashboard  bool
		collect    bool
	}{
		{"heating", "0", true, true},
		{"heating", "1", true, false},
		{"systemController", "1", true, true},
		{"outdoorUnit", "2", true, true},
		{"indoorUnit", "3", true, false},
		{"zigbee", "0", false, false},
		{"roomControl", "0", false, false},
		{"electricityStorage", "0", false, false},
		{"unknown", "0", false, false},
		{"", "0", false, false},
	} {
		if got := isSupportedDashboardDeviceType(test.deviceType); got != test.dashboard {
			t.Errorf("dashboard eligibility for %q = %v, want %v", test.deviceType, got, test.dashboard)
		}
		device := GatewayDevice{DeviceID: test.deviceID, DeviceType: test.deviceType}
		if got := shouldCollectTemperatureDevice(device); got != test.collect {
			t.Errorf("collection eligibility for %+v = %v, want %v", device, got, test.collect)
		}
	}
}

func TestNormalizeSchedule(t *testing.T) {
	dhw := &ScheduleConstraints{Modes: []string{"on"}, DefaultMode: "off", MaxEntries: 4, Resolution: 10}

	tests := []struct {
		name        string
		schedule    map[string][]ScheduleEntry
		constraints *ScheduleConstraints
		wantErr     bool
	}{
		{"valid full day", map[string][]ScheduleEntry{"mon": {{Start: "00:00", End: "24:00", Mode: "on"}}}, dhw, false},
		{"unknown day", map[string][]ScheduleEntry{"xyz": {}}, dhw, true},
		{"start after end", map[string][]ScheduleEntry{"mon": {{Start: "10:00", End: "09:00", Mode: "on"}}}, dhw, true},
		{"bad time", map[string][]ScheduleEntry{"mon": {{Start: "7:00", End: "09:00", Mode: "on"}}}, dhw, true},
		{"past midnight", map[string][]ScheduleEntry{"mon": {{Start: "23:00", End: "24:10", Mode: "on"}}}, dhw, true},
		{"resolution", map[string][]ScheduleEntry{"mon": {{Start: "06:05", End: "09:00", Mode: "on"}}}, dhw, true},
		{"resolution unknown constraints", map[string][]ScheduleEntry{"mon": {{Start: "06:05", End: "09:00", Mode: "on"}}}, nil, false},
		{"mode not allowed", map[string][]ScheduleEntry{"mon": {{Start: "06:00", End: "09:00", Mode: "temp-2"}}}, dhw, true},
		{"overlap", map[string][]ScheduleEntry{"mon": {
			{Start: "06:00", End: "09:00", Mode: "on"},
			{Start: "08:00", End: "10:00", Mode: "on"},
		}}, dhw, true},
		{"too many entries", map[string][]ScheduleEntry{"mon": {
			{Start: "01:00", End: "02:00", Mode: "on"},
			{Start: "03:00", End: "04:00", Mode: "on"},
			{Start: "05:00", End: "06:00", Mode: "on"},
			{Start: "07:00", End: "08:00", Mode: "on"},
			{Start: "09:00", End: "10:00", Mode: "on"},
		}}, dhw, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := normalizeSchedule(tt.schedule, tt.constraints)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestNormalizeScheduleSortsAndFillsDays(t *testing.T) {
	got, err := normalizeSchedule(map[string][]ScheduleEntry{"tue": {
		{Start: "17:00", End: "21:00", Mode: "on", Position: 0},
		{Start: "05:30", End: "08:00", Mode: "on", Position: 1},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 7 {
		t.Fatalf("expected 7 days, got %d", len(got))
	}
	if len(got["mon"]) != 0 {
		t.Fatalf("expected empty monday, got %v", got["mon"])
	}
	tue := got["tue"]
	if tue[0].Start != "05:30" || tue[0].Position != 0 || tue[1].Start != "17:00" || tue[1].Position != 1 {
		t.Fatalf("unexpected order: %+v", tue)
	}
}

func TestParseSchedule(t *testing.T) {
	f := Feature{
		Feature: "heating.dhw.schedule",
		Properties: map[string]interface{}{
			"active": map[string]interface{}{"type": "boolean", "value": true},
			"entries": map[string]interface{}{"type": "Schedule", "value": map[string]interface{}{
				"mon": []interface{}{map[string]interface{}{"start": "00:00", "end": "24:00", "mode": "on", "position": 0.0}},
			}},
		},
		Commands: map[string]FeatureCommand{"setSchedule": {
			IsExecutable: true,
			Params: map[string]FeatureCommandParam{"newSchedule": {Type: "Schedule", Constraints: map[string]interface{}{
				"defaultMode": "off", "maxEntries": 4.0, "modes": []interface{}{"on"}, "overlapAllowed": false, "resolution": 10.0,
			}}},
		}},
	}

	info, ok := parseSchedule(f)
	if !ok {
		t.Fatal("expected schedule")
	}
	if info.Active == nil || !*info.Active || !info.Writable {
		t.Fatalf("unexpected flags: %+v", info)
	}
	if info.Constraints == nil || info.Constraints.MaxEntries != 4 || info.Constraints.Resolution != 10 || info.Constraints.Modes[0] != "on" {
		t.Fatalf("unexpected constraints: %+v", info.Constraints)
	}
	if info.Entries["mon"][0].End != "24:00" {
		t.Fatalf("unexpected entries: %+v", info.Entries)
	}

	if _, ok := parseSchedule(Feature{Feature: "heating.dhw.schedule", Properties: map[string]interface{}{}}); ok {
		t.Fatal("empty schedule feature must be ignored")
	}
}
