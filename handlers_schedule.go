package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Schedule features that may be written through /api/schedule/set
var writableScheduleFeature = regexp.MustCompile(`^heating\.(dhw\.schedule|dhw\.pumps\.circulation\.schedule|circuits\.\d+\.heating\.schedule)$`)

var scheduleDays = []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"}

var scheduleTimePattern = regexp.MustCompile(`^([01]\d|2[0-4]):([0-5]\d)$`)

// scheduleMinutes converts "HH:MM" into minutes since midnight (24:00 = 1440)
func scheduleMinutes(t string) (int, error) {
	m := scheduleTimePattern.FindStringSubmatch(t)
	if m == nil {
		return 0, fmt.Errorf("invalid time %q (expected HH:MM)", t)
	}
	var h, min int
	fmt.Sscanf(m[1], "%d", &h)
	fmt.Sscanf(m[2], "%d", &min)
	total := h*60 + min
	if total > 24*60 {
		return 0, fmt.Errorf("invalid time %q", t)
	}
	return total, nil
}

// normalizeSchedule validates a schedule against the given constraints (may be nil),
// sorts the entries of each day and renumbers their positions.
// All seven days are always present in the result.
func normalizeSchedule(schedule map[string][]ScheduleEntry, constraints *ScheduleConstraints) (map[string][]ScheduleEntry, error) {
	for day := range schedule {
		if !contains(scheduleDays, day) {
			return nil, fmt.Errorf("unknown day %q", day)
		}
	}

	result := make(map[string][]ScheduleEntry, len(scheduleDays))
	for _, day := range scheduleDays {
		entries := append([]ScheduleEntry(nil), schedule[day]...)

		if constraints != nil && constraints.MaxEntries > 0 && len(entries) > constraints.MaxEntries {
			return nil, fmt.Errorf("%s: maximal %d Zeitfenster erlaubt", day, constraints.MaxEntries)
		}

		// "HH:MM" strings sort chronologically
		sort.SliceStable(entries, func(i, j int) bool { return entries[i].Start < entries[j].Start })

		prevEnd := -1
		for i, e := range entries {
			start, err := scheduleMinutes(e.Start)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", day, err)
			}
			end, err := scheduleMinutes(e.End)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", day, err)
			}
			if start >= end {
				return nil, fmt.Errorf("%s: Start %s muss vor Ende %s liegen", day, e.Start, e.End)
			}
			if constraints != nil && constraints.Resolution > 0 && (start%constraints.Resolution != 0 || end%constraints.Resolution != 0) {
				return nil, fmt.Errorf("%s: Zeiten müssen auf %d Minuten gerastert sein", day, constraints.Resolution)
			}
			if constraints != nil && len(constraints.Modes) > 0 && !contains(constraints.Modes, e.Mode) {
				return nil, fmt.Errorf("%s: Modus %q nicht erlaubt (erlaubt: %s)", day, e.Mode, strings.Join(constraints.Modes, ", "))
			}
			if (constraints == nil || !constraints.OverlapAllowed) && start < prevEnd {
				return nil, fmt.Errorf("%s: Zeitfenster %s-%s überschneidet sich mit %s-%s", day,
					e.Start, e.End, entries[i-1].Start, entries[i-1].End)
			}
			if end > prevEnd {
				prevEnd = end
			}
		}

		for i := range entries {
			entries[i].Position = i
		}
		result[day] = entries
	}

	return result, nil
}

func contains(list []string, value string) bool {
	for _, v := range list {
		if v == value {
			return true
		}
	}
	return false
}

// cachedScheduleConstraints returns the setSchedule constraints from the features cache, if known
func cachedScheduleConstraints(installationID, gatewaySerial, deviceID, feature string) *ScheduleConstraints {
	featuresCacheMutex.RLock()
	defer featuresCacheMutex.RUnlock()
	cached, ok := featuresCache[fmt.Sprintf("%s:%s:%s", installationID, gatewaySerial, deviceID)]
	if !ok || cached.Schedules == nil {
		return nil
	}
	return cached.Schedules[feature].Constraints
}

func writeScheduleResult(w http.ResponseWriter, errMsg string) {
	w.Header().Set("Content-Type", "application/json")
	if errMsg != "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": errMsg})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// scheduleSetHandler handles POST /api/schedule/set
// Writes a complete week schedule via the setSchedule command of the given feature.
func scheduleSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string                     `json:"accountId"`
		InstallationID string                     `json:"installationId"`
		GatewaySerial  string                     `json:"gatewaySerial"`
		DeviceID       string                     `json:"deviceId"`
		Feature        string                     `json:"feature"`
		Schedule       map[string][]ScheduleEntry `json:"schedule"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeScheduleResult(w, "Invalid request: "+err.Error())
		return
	}

	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" || req.Feature == "" || req.Schedule == nil {
		writeScheduleResult(w, "accountId, installationId, gatewaySerial, deviceId, feature and schedule are required")
		return
	}

	if !writableScheduleFeature.MatchString(req.Feature) {
		writeScheduleResult(w, "Feature not supported: "+req.Feature)
		return
	}

	constraints := cachedScheduleConstraints(req.InstallationID, req.GatewaySerial, req.DeviceID, req.Feature)
	schedule, err := normalizeSchedule(req.Schedule, constraints)
	if err != nil {
		writeScheduleResult(w, "Ungültiger Zeitplan: "+err.Error())
		return
	}

	token, exists := getValidAccountToken(req.AccountID)

	if !exists {
		writeScheduleResult(w, "Account not found or not authenticated")
		return
	}

	url := fmt.Sprintf("https://api.viessmann-climatesolutions.com/iot/v2/features/installations/%s/gateways/%s/devices/%s/features/%s/commands/setSchedule",
		req.InstallationID, req.GatewaySerial, req.DeviceID, req.Feature)

	jsonBody, err := json.Marshal(map[string]interface{}{"newSchedule": schedule})
	if err != nil {
		writeScheduleResult(w, "Failed to create request: "+err.Error())
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
	if err != nil {
		writeScheduleResult(w, "Failed to create request: "+err.Error())
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		writeScheduleResult(w, "Failed to call Viessmann API: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		writeScheduleResult(w, fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)))
		return
	}

	log.Printf("Schedule %s updated for device %s (account: %s)", req.Feature, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	delete(featuresCache, fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID))
	featuresCacheMutex.Unlock()

	writeScheduleResult(w, "")
}
