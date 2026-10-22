package main

import (
	"encoding/json"
	"html/template"
	"net/http"
	"sort"
)

func scriptsPageHandler(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.ParseFS(templatesFS, "templates/scripts.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tmpl.Execute(w, newTemplateData())
}

type scriptWithMeta struct {
	*Script
	NextRuns []string `json:"nextRuns,omitempty"`
}

// scriptsListHandler handles GET /api/scripts
func scriptsListHandler(w http.ResponseWriter, r *http.Request) {
	scripts, err := listScripts()
	if err != nil {
		writeJSON(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	out := make([]scriptWithMeta, 0, len(scripts))
	for _, s := range scripts {
		m := scriptWithMeta{Script: s}
		if s.Enabled {
			m.NextRuns = scriptNextRuns(s.Schedule, 3)
		}
		out = append(out, m)
	}
	writeJSON(w, map[string]any{"success": true, "scripts": out})
}

// scriptsSaveHandler handles POST /api/scripts/save
func scriptsSaveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var s Script
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		writeJSON(w, map[string]any{"success": false, "error": "Invalid request: " + err.Error()})
		return
	}
	saved, err := saveScript(&s)
	if err != nil {
		writeJSON(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"success": true, "script": saved})
}

// scriptsDeleteHandler handles POST /api/scripts/delete {"id": "..."}
func scriptsDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	if err := deleteScript(req.ID); err != nil {
		writeJSON(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"success": true})
}

// scriptsTestHandler handles POST /api/scripts/test: dry run of (unsaved) code for a device
func scriptsTestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ScriptID string `json:"scriptId"` // Optional: use the saved variables of this script
		Code     string `json:"code"`
		scriptDevice
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	if req.DeviceID == "" {
		req.DeviceID = "0"
	}
	res := runScript(r.Context(), req.ScriptID, req.scriptDevice, req.Code, true)
	writeJSON(w, map[string]any{"success": true, "result": res})
}

// scriptsRunHandler handles POST /api/scripts/run {"id": "..."}: executes the saved script now (with actions)
func scriptsRunHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"success": true, "result": executeScript(req.ID, "manual")})
}

// scriptsRunsHandler handles GET /api/scripts/runs?id=...&all=1
func scriptsRunsHandler(w http.ResponseWriter, r *http.Request) {
	runs, err := scriptRuns(r.URL.Query().Get("id"), 100, r.URL.Query().Get("all") != "1")
	if err != nil {
		writeJSON(w, map[string]any{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"success": true, "runs": runs})
}

// scriptsDocsHandler handles GET /api/scripts/docs (Markdown)
func scriptsDocsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Write([]byte(scriptDocs()))
}

// scriptDeviceOption is a device that scripts can be bound to
type scriptDeviceOption struct {
	scriptDevice
	AccountName      string `json:"accountName"`
	InstallationName string `json:"installationName"`
	ModelID          string `json:"modelId"`
}

// heatingDevices lists all heating devices of the active accounts
func heatingDevices() []scriptDeviceOption {
	out := []scriptDeviceOption{}
	accounts, err := GetActiveAccounts()
	if err != nil {
		return out
	}
	for _, account := range accounts {
		token, err := ensureAccountAuthenticated(account)
		if err != nil {
			continue
		}
		for id, inst := range token.Installations {
			for _, gw := range inst.Gateways {
				for _, d := range gw.Devices {
					if d.DeviceType != "heating" {
						continue
					}
					out = append(out, scriptDeviceOption{
						scriptDevice:     scriptDevice{AccountID: account.ID, InstallationID: id, GatewaySerial: gw.Serial, DeviceID: d.DeviceID},
						AccountName:      account.Name,
						InstallationName: inst.Description,
						ModelID:          d.ModelID,
					})
				}
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].InstallationName != out[j].InstallationName {
			return out[i].InstallationName < out[j].InstallationName
		}
		return out[i].ModelID < out[j].ModelID
	})
	return out
}

// scriptsDevicesHandler handles GET /api/scripts/devices
func scriptsDevicesHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"success": true, "devices": heatingDevices()})
}
