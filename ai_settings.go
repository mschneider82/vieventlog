package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// AIProvider is an OpenAI-compatible API endpoint (OpenRouter, OpenAI, Ollama, LM Studio, ...)
type AIProvider struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	BaseURL string   `json:"baseUrl"` // e.g. https://openrouter.ai/api/v1
	APIKey  string   `json:"apiKey,omitempty"`
	Models  []string `json:"models"`
}

// AISettings configures the AI assistant and the MCP endpoint
type AISettings struct {
	Providers         []AIProvider `json:"providers"`
	DefaultProviderID string       `json:"defaultProviderId"`
	DefaultModel      string       `json:"defaultModel"`
	PersistChats      bool         `json:"persistChats"`  // Store conversations in SQLite
	AllowWrite        bool         `json:"allowWrite"`    // Allow tools that change device settings (always with confirmation)
	CustomPrompt      string       `json:"customPrompt"`  // Additional instructions appended to the system prompt
	MCPEnabled        bool         `json:"mcpEnabled"`    // Expose tools via MCP at /mcp
	MCPToken          string       `json:"mcpToken"`      // Bearer token for /mcp
	MCPAllowWrite     bool         `json:"mcpAllowWrite"` // Expose write tools via MCP
}

// GetAISettings returns the AI settings, or defaults if not configured
func GetAISettings() (*AISettings, error) {
	store, err := LoadAccounts()
	if err != nil {
		return nil, err
	}
	if store.AISettings == nil {
		return &AISettings{Providers: []AIProvider{}, PersistChats: true}, nil
	}
	if store.AISettings.Providers == nil {
		store.AISettings.Providers = []AIProvider{}
	}
	return store.AISettings, nil
}

// SetAISettings stores the AI settings
func SetAISettings(settings *AISettings) error {
	store, err := LoadAccounts()
	if err != nil {
		return err
	}
	store.AISettings = settings
	return SaveAccounts(store)
}

// findProvider returns the provider with the given ID
func (s *AISettings) findProvider(id string) *AIProvider {
	for i := range s.Providers {
		if s.Providers[i].ID == id {
			return &s.Providers[i]
		}
	}
	return nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// aiSettingsGetHandler handles GET /api/ai/settings (API keys are never returned)
func aiSettingsGetHandler(w http.ResponseWriter, r *http.Request) {
	settings, err := GetAISettings()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type providerView struct {
		AIProvider
		HasAPIKey bool `json:"hasApiKey"`
	}
	providers := make([]providerView, 0, len(settings.Providers))
	for _, p := range settings.Providers {
		hasKey := p.APIKey != ""
		p.APIKey = ""
		providers = append(providers, providerView{AIProvider: p, HasAPIKey: hasKey})
	}

	writeJSON(w, map[string]interface{}{
		"providers":         providers,
		"defaultProviderId": settings.DefaultProviderID,
		"defaultModel":      settings.DefaultModel,
		"persistChats":      settings.PersistChats,
		"allowWrite":        settings.AllowWrite,
		"customPrompt":      settings.CustomPrompt,
		"mcpEnabled":        settings.MCPEnabled,
		"mcpToken":          settings.MCPToken,
		"mcpAllowWrite":     settings.MCPAllowWrite,
	})
}

// aiSettingsSetHandler handles POST /api/ai/settings/set
// An empty apiKey keeps the stored key of the provider with the same ID.
func aiSettingsSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AISettings
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": "Invalid request: " + err.Error()})
		return
	}

	current, err := GetAISettings()
	if err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}

	for i := range req.Providers {
		p := &req.Providers[i]
		if p.ID == "" {
			p.ID = randomHex(6)
		}
		p.BaseURL = strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
		if p.BaseURL == "" {
			writeJSON(w, map[string]interface{}{"success": false, "error": fmt.Sprintf("Provider %q: Base-URL fehlt", p.Name)})
			return
		}
		if p.APIKey == "" {
			if old := current.findProvider(p.ID); old != nil {
				p.APIKey = old.APIKey
			}
		}
		models := make([]string, 0, len(p.Models))
		for _, m := range p.Models {
			if m = strings.TrimSpace(m); m != "" {
				models = append(models, m)
			}
		}
		p.Models = models
	}

	if req.MCPEnabled && req.MCPToken == "" {
		req.MCPToken = randomHex(24)
	}

	if err := SetAISettings(&req); err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"success": true})
}

// aiModelsHandler handles GET /api/ai/models?providerId=... and lists the models offered by the provider
func aiModelsHandler(w http.ResponseWriter, r *http.Request) {
	settings, err := GetAISettings()
	if err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	provider := settings.findProvider(r.URL.Query().Get("providerId"))
	if provider == nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": "Provider nicht gefunden (erst speichern)"})
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, provider.BaseURL+"/models", nil)
	if err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	if provider.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+provider.APIKey)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		writeJSON(w, map[string]interface{}{"success": false, "error": fmt.Sprintf("Status %d: %s", resp.StatusCode, truncateString(string(body), 300))})
		return
	}

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": "Unerwartete Antwort: " + err.Error()})
		return
	}
	models := make([]string, 0, len(result.Data))
	for _, m := range result.Data {
		models = append(models, m.ID)
	}
	sort.Strings(models)
	writeJSON(w, map[string]interface{}{"success": true, "models": models})
}

func truncateString(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + fmt.Sprintf("… [%d Zeichen gekürzt]", len(s)-max)
}
