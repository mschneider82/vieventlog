package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

//go:embed templates/*
var templatesFS embed.FS

const (
	// Viessmann API constants
	defaultClientSecret = "8ad97aceb92c5892e102b093c7c083fa"
)

var (
	// Configuration - will be loaded from keyring or env
	currentCreds *Credentials // Legacy support

	// Multi-account support
	accountStore  *AccountStore
	accountTokens map[string]*AccountToken // Account ID -> Token info
	accountsMutex sync.RWMutex

	// Cache
	eventsCache     []Event
	lastFetchTime   time.Time
	installationIDs []string
	installations   map[string]*Installation
	fetchMutex      sync.Mutex

	// OAuth2 Token (legacy)
	accessToken  string
	refreshToken string
	tokenExpiry  time.Time
)

// AccountToken holds authentication tokens for a specific account
type AccountToken struct {
	AccessToken     string
	RefreshToken    string
	TokenExpiry     time.Time
	InstallationIDs []string
	Installations   map[string]*Installation
}

type Installation struct {
	ID          string `json:"id"`
	Description string `json:"description"`
	Address     struct {
		Street      string `json:"street"`
		HouseNumber string `json:"houseNumber"`
		Zip         string `json:"zip"`
		City        string `json:"city"`
		Country     string `json:"country"`
	} `json:"address"`
}

type Event struct {
	EventTimestamp   string                 `json:"eventTimestamp"`
	CreatedAt        string                 `json:"createdAt"`
	EventType        string                 `json:"eventType"`
	GatewaySerial    string                 `json:"gatewaySerial"`
	Body             map[string]interface{} `json:"body"`
	ErrorCode        string                 `json:"errorCode"`
	ErrorDescription string                 `json:"errorDescription"`
	HumanReadable    string                 `json:"humanReadable"`
	CodeCategory     string                 `json:"codeCategory"`
	Severity         string                 `json:"severity"`
	DeviceID         string                 `json:"deviceId"`
	ModelID          string                 `json:"modelId"`
	Active           *bool                  `json:"active"`
	FormattedTime    string                 `json:"formatted_time"`
	Raw              string                 `json:"raw"`
	InstallationID   string                 `json:"installationId"`
	AccountID        string                 `json:"accountId"`   // Which account this event belongs to
	AccountName      string                 `json:"accountName"` // User-friendly account name
}

type EventsResponse struct {
	Data []map[string]interface{} `json:"data"`
}

type Device struct {
	DeviceID       string `json:"deviceId"`
	ModelID        string `json:"modelId"`
	DisplayName    string `json:"displayName"`
	InstallationID string `json:"installationId"`
}

type DevicesByInstallation struct {
	InstallationID string   `json:"installationId"`
	Location       string   `json:"location"`
	Description    string   `json:"description"`
	Devices        []Device `json:"devices"`
}

type StatusResponse struct {
	Connected    bool    `json:"connected"`
	DeviceID     string  `json:"device_id,omitempty"`
	LastFetch    *string `json:"last_fetch,omitempty"`
	CachedEvents int     `json:"cached_events"`
	Error        string  `json:"error,omitempty"`
}

type LoginRequest struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

type LoginResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

type CredentialsCheckResponse struct {
	HasCredentials bool   `json:"hasCredentials"`
	Email          string `json:"email,omitempty"`
	ClientID       string `json:"clientId,omitempty"`
}

type AccountRequest struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	Password     string `json:"password"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	Active       bool   `json:"active"`
}

type AccountResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Email       string `json:"email"`
	ClientID    string `json:"clientId"`
	Active      bool   `json:"active"`
	HasPassword bool   `json:"hasPassword"` // Don't return actual password
}

type AccountsListResponse struct {
	Accounts []AccountResponse `json:"accounts"`
}

type AccountActionResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

func main() {
	// Initialize account management
	accountTokens = make(map[string]*AccountToken)

	// Try to load credentials from keyring first
	loadStoredCredentials()

	// Setup HTTP handlers
	http.HandleFunc("/", indexHandler)
	http.HandleFunc("/login", loginPageHandler)
	http.HandleFunc("/accounts", accountsPageHandler)

	// Legacy API endpoints
	http.HandleFunc("/api/login", loginHandler)
	http.HandleFunc("/api/credentials/check", credentialsCheckHandler)
	http.HandleFunc("/api/credentials/delete", credentialsDeleteHandler)

	// New account management endpoints
	http.HandleFunc("/api/accounts", accountsHandler)
	http.HandleFunc("/api/accounts/add", accountAddHandler)
	http.HandleFunc("/api/accounts/update", accountUpdateHandler)
	http.HandleFunc("/api/accounts/delete", accountDeleteHandler)
	http.HandleFunc("/api/accounts/toggle", accountToggleHandler)

	// Data endpoints
	http.HandleFunc("/api/events", eventsHandler)
	http.HandleFunc("/api/status", statusHandler)
	http.HandleFunc("/api/devices", devicesHandler)

	// Get bind address from environment, with backward compatibility for PORT
	bindAddress := os.Getenv("BIND_ADDRESS")
	if bindAddress == "" {
		port := getEnv("PORT", "5000")
		bindAddress = "0.0.0.0:" + port
	}

	log.Printf("Starting Event Viewer on %s\n", bindAddress)

	// Wrap with Basic Auth middleware if configured
	handler := BasicAuthMiddleware(http.DefaultServeMux)

	log.Fatal(http.ListenAndServe(bindAddress, handler))
}

func loadStoredCredentials() {
	// Load credentials from keyring
	creds, err := LoadCredentials()
	if err == nil && creds != nil && creds.Email != "" {
		currentCreds = creds
		log.Printf("Loaded credentials from keyring for: %s\n", creds.Email)
		return
	}

	log.Println("No credentials found. Please login via web interface.")
}

func indexHandler(w http.ResponseWriter, r *http.Request) {
	// Check if credentials are available
	if currentCreds == nil {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}

	tmpl, err := template.ParseFS(templatesFS, "templates/index.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tmpl.Execute(w, nil)
}

func loginPageHandler(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.ParseFS(templatesFS, "templates/login.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tmpl.Execute(w, nil)
}

func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(LoginResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.Email == "" || req.Password == "" || req.ClientID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(LoginResponse{
			Success: false,
			Error:   "Email, password, and client ID are required",
		})
		return
	}

	// Test the credentials (always use default client secret)
	testCreds := &Credentials{
		Email:        req.Email,
		Password:     req.Password,
		ClientID:     req.ClientID,
		ClientSecret: defaultClientSecret,
	}

	if err := testCredentials(testCreds); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(LoginResponse{
			Success: false,
			Error:   "Authentication failed: " + err.Error(),
		})
		return
	}

	// Save credentials to keyring
	if err := SaveCredentials(*testCreds); err != nil {
		log.Printf("Warning: Failed to save credentials to keyring: %v\n", err)
		// Continue anyway - credentials are valid
	} else {
		log.Println("Credentials successfully saved to keyring")
	}

	// Update current credentials
	currentCreds = testCreds

	// Reset token to force re-authentication with new credentials
	accessToken = ""
	refreshToken = ""
	tokenExpiry = time.Time{}
	installationIDs = nil

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(LoginResponse{
		Success: true,
	})
}

func credentialsCheckHandler(w http.ResponseWriter, r *http.Request) {
	response := CredentialsCheckResponse{
		HasCredentials: currentCreds != nil && currentCreds.Email != "",
	}

	if currentCreds != nil {
		response.Email = currentCreds.Email
		response.ClientID = currentCreds.ClientID
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func credentialsDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := DeleteCredentials(); err != nil {
		log.Printf("Warning: Failed to delete credentials from keyring: %v\n", err)
	}

	currentCreds = nil
	accessToken = ""
	refreshToken = ""
	tokenExpiry = time.Time{}
	installationIDs = nil

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func testCredentials(creds *Credentials) error {
	// Use the ViCare-specific authentication (Authorization Code flow with PKCE)
	tokenResp, err := AuthenticateWithViCare(creds.Email, creds.Password, creds.ClientID)
	if err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}

	// Try to fetch installations to verify the token works
	req, err := http.NewRequest("GET", "https://api.viessmann.com/iot/v1/equipment/installations", nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to verify token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var result struct {
		Data []struct {
			ID interface{} `json:"id"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	if len(result.Data) == 0 {
		return fmt.Errorf("no installations found for this account")
	}

	log.Printf("Successfully authenticated and found %d installation(s)\n", len(result.Data))
	return nil
}

func eventsHandler(w http.ResponseWriter, r *http.Request) {
	daysStr := r.URL.Query().Get("days")
	days := 7
	if daysStr != "" {
		if d, err := strconv.Atoi(daysStr); err == nil {
			days = d
		}
	}

	events, err := fetchEvents(days)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(events)
}

func statusHandler(w http.ResponseWriter, r *http.Request) {
	status := StatusResponse{}

	// Get active accounts
	activeAccounts, err := GetActiveAccounts()
	if err != nil {
		status.Connected = false
		status.Error = err.Error()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
		return
	}

	if len(activeAccounts) == 0 {
		// Fallback to legacy system
		err := ensureAuthenticated()
		if err != nil {
			status.Connected = false
			status.Error = err.Error()
		} else {
			status.Connected = true
			if len(installationIDs) > 0 {
				status.DeviceID = fmt.Sprintf("%d installations: %v", len(installationIDs), installationIDs)
			}
			status.CachedEvents = len(eventsCache)
			if !lastFetchTime.IsZero() {
				t := lastFetchTime.Format(time.RFC3339)
				status.LastFetch = &t
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
		return
	}

	// Multi-account system
	status.Connected = true
	totalInstallations := 0
	accountNames := make([]string, 0, len(activeAccounts))

	// Ensure accounts are authenticated to get installation counts
	for _, account := range activeAccounts {
		accountNames = append(accountNames, account.Name)

		// Try to get or create token for this account
		token, err := ensureAccountAuthenticated(account)
		if err != nil {
			log.Printf("Warning: Failed to authenticate account %s for status: %v\n", account.Email, err)
			continue
		}

		totalInstallations += len(token.InstallationIDs)
	}

	if len(activeAccounts) == 1 {
		status.DeviceID = fmt.Sprintf("%s (%d installations)", activeAccounts[0].Name, totalInstallations)
	} else {
		status.DeviceID = fmt.Sprintf("%d accounts (%d installations)", len(activeAccounts), totalInstallations)
	}

	status.CachedEvents = len(eventsCache)
	if !lastFetchTime.IsZero() {
		t := lastFetchTime.Format(time.RFC3339)
		status.LastFetch = &t
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

func devicesHandler(w http.ResponseWriter, r *http.Request) {
	// Use cached events if available, otherwise fetch with long timespan
	events := eventsCache
	if len(events) == 0 {
		var err error
		events, err = fetchEvents(365)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Build a unified installations map from all account tokens
	allInstallations := make(map[string]*Installation)
	accountsMutex.RLock()
	for _, token := range accountTokens {
		for id, installation := range token.Installations {
			allInstallations[id] = installation
		}
	}
	accountsMutex.RUnlock()

	// Also include legacy installations
	if installations != nil {
		for id, installation := range installations {
			if _, exists := allInstallations[id]; !exists {
				allInstallations[id] = installation
			}
		}
	}

	// Group devices by installation
	devicesByInstallation := make(map[string]map[string]Device)

	for _, event := range events {
		installID := getInstallationForEvent(event)

		if _, exists := devicesByInstallation[installID]; !exists {
			devicesByInstallation[installID] = make(map[string]Device)
		}

		key := event.DeviceID + "_" + event.ModelID
		if _, exists := devicesByInstallation[installID][key]; !exists {
			devicesByInstallation[installID][key] = Device{
				DeviceID:       event.DeviceID,
				ModelID:        event.ModelID,
				DisplayName:    fmt.Sprintf("%s (Device %s)", event.ModelID, event.DeviceID),
				InstallationID: installID,
			}
		}
	}

	// Build response grouped by installation
	response := make([]DevicesByInstallation, 0)

	for installID, devices := range devicesByInstallation {
		installation := allInstallations[installID]
		location := "Unknown"
		description := ""

		if installation != nil {
			description = installation.Description
			if installation.Address.City != "" {
				location = fmt.Sprintf("%s %s, %s %s",
					installation.Address.Street,
					installation.Address.HouseNumber,
					installation.Address.Zip,
					installation.Address.City)
			}
		}

		deviceList := make([]Device, 0, len(devices))
		for _, device := range devices {
			deviceList = append(deviceList, device)
		}

		response = append(response, DevicesByInstallation{
			InstallationID: installID,
			Location:       location,
			Description:    description,
			Devices:        deviceList,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func getInstallationForEvent(event Event) string {
	// Events are now tagged with their installation ID during fetch
	if event.InstallationID != "" {
		return event.InstallationID
	}
	return "unknown"
}

func fetchEvents(daysBack int) ([]Event, error) {
	fetchMutex.Lock()
	defer fetchMutex.Unlock()

	// Check cache (5 minutes)
	if !lastFetchTime.IsZero() && time.Since(lastFetchTime) < 5*time.Minute {
		return eventsCache, nil
	}

	// Get active accounts
	activeAccounts, err := GetActiveAccounts()
	if err != nil {
		return eventsCache, fmt.Errorf("failed to get active accounts: %w", err)
	}

	if len(activeAccounts) == 0 {
		// Fallback to legacy single credential
		if currentCreds != nil {
			return fetchEventsLegacy(daysBack)
		}
		return nil, fmt.Errorf("no active accounts found")
	}

	// Calculate date range
	endDate := time.Now()
	startDate := endDate.AddDate(0, 0, -daysBack)
	startStr := startDate.Format("2006-01-02T15:04:05.000Z")
	endStr := endDate.Format("2006-01-02T15:04:05.000Z")

	// Fetch events from all active accounts
	allEvents := make([]Event, 0)

	for _, account := range activeAccounts {
		log.Printf("Fetching events for account: %s (%s)\n", account.Name, account.Email)

		// Ensure this account is authenticated
		token, err := ensureAccountAuthenticated(account)
		if err != nil {
			log.Printf("Failed to authenticate account %s: %v\n", account.Email, err)
			continue
		}

		// Fetch events from all installations for this account
		for _, installationID := range token.InstallationIDs {
			url := fmt.Sprintf("https://api.viessmann-climatesolutions.com/iot/v2/events-history/installations/%s/events", installationID)
			req, err := http.NewRequest("GET", url, nil)
			if err != nil {
				log.Printf("Error creating request for installation %s: %v\n", installationID, err)
				continue
			}

			q := req.URL.Query()
			q.Add("start", startStr)
			q.Add("end", endStr)
			q.Add("limit", "500")
			req.URL.RawQuery = q.Encode()

			req.Header.Set("Authorization", "Bearer "+token.AccessToken)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				log.Printf("Error fetching events for installation %s: %v\n", installationID, err)
				continue
			}

			if resp.StatusCode != http.StatusOK {
				log.Printf("API returned status %d for installation %s\n", resp.StatusCode, installationID)
				resp.Body.Close()
				continue
			}

			var eventsResp EventsResponse
			if err := json.NewDecoder(resp.Body).Decode(&eventsResp); err != nil {
				log.Printf("Error decoding events for installation %s: %v\n", installationID, err)
				resp.Body.Close()
				continue
			}
			resp.Body.Close()

			// Process events and tag with installation ID and account info
			for _, rawEvent := range eventsResp.Data {
				event := processEvent(rawEvent)
				event.InstallationID = installationID
				event.AccountID = account.ID
				event.AccountName = account.Name
				allEvents = append(allEvents, event)
			}

			log.Printf("Fetched %d events from installation %s (account: %s)\n",
				len(eventsResp.Data), installationID, account.Name)
		}
	}

	eventsCache = allEvents
	lastFetchTime = time.Now()
	log.Printf("Fetched total %d events from %d account(s)\n", len(allEvents), len(activeAccounts))

	return allEvents, nil
}

// Legacy fetch for single credential (backward compatibility)
func fetchEventsLegacy(daysBack int) ([]Event, error) {
	if err := ensureAuthenticated(); err != nil {
		return eventsCache, err
	}

	endDate := time.Now()
	startDate := endDate.AddDate(0, 0, -daysBack)
	startStr := startDate.Format("2006-01-02T15:04:05.000Z")
	endStr := endDate.Format("2006-01-02T15:04:05.000Z")

	allEvents := make([]Event, 0)

	for _, installationID := range installationIDs {
		url := fmt.Sprintf("https://api.viessmann-climatesolutions.com/iot/v2/events-history/installations/%s/events", installationID)
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			log.Printf("Error creating request for installation %s: %v\n", installationID, err)
			continue
		}

		q := req.URL.Query()
		q.Add("start", startStr)
		q.Add("end", endStr)
		q.Add("limit", "500")
		req.URL.RawQuery = q.Encode()

		req.Header.Set("Authorization", "Bearer "+accessToken)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			log.Printf("Error fetching events for installation %s: %v\n", installationID, err)
			continue
		}

		if resp.StatusCode != http.StatusOK {
			log.Printf("API returned status %d for installation %s\n", resp.StatusCode, installationID)
			resp.Body.Close()
			continue
		}

		var eventsResp EventsResponse
		if err := json.NewDecoder(resp.Body).Decode(&eventsResp); err != nil {
			log.Printf("Error decoding events for installation %s: %v\n", installationID, err)
			resp.Body.Close()
			continue
		}
		resp.Body.Close()

		for _, rawEvent := range eventsResp.Data {
			event := processEvent(rawEvent)
			event.InstallationID = installationID
			allEvents = append(allEvents, event)
		}

		log.Printf("Fetched %d events from installation %s\n", len(eventsResp.Data), installationID)
	}

	eventsCache = allEvents
	lastFetchTime = time.Now()
	return allEvents, nil
}

// ensureAccountAuthenticated ensures an account is authenticated and returns its token
func ensureAccountAuthenticated(account *Account) (*AccountToken, error) {
	accountsMutex.RLock()
	token, exists := accountTokens[account.ID]
	accountsMutex.RUnlock()

	// Check if token is still valid
	if exists && token.AccessToken != "" && time.Now().Before(token.TokenExpiry) {
		return token, nil
	}

	// Need to authenticate
	accountsMutex.Lock()
	defer accountsMutex.Unlock()

	// Double-check after acquiring write lock
	token, exists = accountTokens[account.ID]
	if exists && token.AccessToken != "" && time.Now().Before(token.TokenExpiry) {
		return token, nil
	}

	// Authenticate
	tokenResp, err := AuthenticateWithViCare(account.Email, account.Password, account.ClientID)
	if err != nil {
		return nil, fmt.Errorf("authentication failed: %w", err)
	}

	// Fetch installation IDs for this account
	installationIDs, installations, err := fetchInstallationIDsForAccount(tokenResp.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch installations: %w", err)
	}

	// Store token
	token = &AccountToken{
		AccessToken:     tokenResp.AccessToken,
		RefreshToken:    tokenResp.RefreshToken,
		TokenExpiry:     time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second),
		InstallationIDs: installationIDs,
		Installations:   installations,
	}
	accountTokens[account.ID] = token

	log.Printf("Authenticated account %s, found %d installations\n", account.Email, len(installationIDs))

	return token, nil
}

// fetchInstallationIDsForAccount fetches installation IDs for a specific account
func fetchInstallationIDsForAccount(accessToken string) ([]string, map[string]*Installation, error) {
	req, err := http.NewRequest("GET", "https://api.viessmann.com/iot/v1/equipment/installations", nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	var rawResult struct {
		Data []map[string]interface{} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&rawResult); err != nil {
		return nil, nil, err
	}

	if len(rawResult.Data) == 0 {
		return nil, nil, fmt.Errorf("no installations found")
	}

	installations := make(map[string]*Installation)
	installationIDs := make([]string, 0, len(rawResult.Data))

	for _, rawInstall := range rawResult.Data {
		installation := &Installation{}

		var idStr string
		if id, ok := rawInstall["id"]; ok {
			switch v := id.(type) {
			case float64:
				idStr = fmt.Sprintf("%.0f", v)
			case string:
				idStr = v
			default:
				idStr = fmt.Sprintf("%v", v)
			}
		}

		if idStr == "" {
			continue
		}

		installation.ID = idStr

		if desc, ok := rawInstall["description"].(string); ok {
			installation.Description = desc
		}

		if addr, ok := rawInstall["address"].(map[string]interface{}); ok {
			if street, ok := addr["street"].(string); ok {
				installation.Address.Street = street
			}
			if houseNumber, ok := addr["houseNumber"].(string); ok {
				installation.Address.HouseNumber = houseNumber
			}
			if zip, ok := addr["zip"].(string); ok {
				installation.Address.Zip = zip
			}
			if city, ok := addr["city"].(string); ok {
				installation.Address.City = city
			}
			if country, ok := addr["country"].(string); ok {
				installation.Address.Country = country
			}
		}

		installations[idStr] = installation
		installationIDs = append(installationIDs, idStr)
	}

	return installationIDs, installations, nil
}

func processEvent(raw map[string]interface{}) Event {
	event := Event{}

	// Extract basic fields
	event.EventTimestamp, _ = raw["eventTimestamp"].(string)
	event.CreatedAt, _ = raw["createdAt"].(string)
	event.EventType, _ = raw["eventType"].(string)
	event.GatewaySerial, _ = raw["gatewaySerial"].(string)

	// Use eventTimestamp or createdAt for timestamp
	timestamp := event.EventTimestamp
	if timestamp == "" {
		timestamp = event.CreatedAt
	}

	// Keep timestamp in RFC3339 format for browser-side timezone conversion
	event.FormattedTime = timestamp

	// Extract body
	if body, ok := raw["body"].(map[string]interface{}); ok {
		event.Body = body

		if errorCode, ok := body["errorCode"].(string); ok {
			event.ErrorCode = errorCode
			event.HumanReadable = getErrorDescription(errorCode)
			event.CodeCategory = getCodeCategory(errorCode)
			event.Severity = getSeverity(errorCode)
		}

		if errorDesc, ok := body["errorDescription"].(string); ok {
			event.ErrorDescription = errorDesc
		}

		if deviceID, ok := body["deviceId"].(string); ok {
			event.DeviceID = deviceID
		} else if deviceID, ok := body["deviceId"].(float64); ok {
			event.DeviceID = fmt.Sprintf("%.0f", deviceID)
		} else {
			event.DeviceID = "0"
		}

		if modelID, ok := body["modelId"].(string); ok {
			event.ModelID = modelID
		} else {
			event.ModelID = "Unknown"
		}

		if active, ok := body["active"].(bool); ok {
			event.Active = &active
		}
	}

	// Store raw JSON
	if rawJSON, err := json.MarshalIndent(raw, "", "  "); err == nil {
		event.Raw = string(rawJSON)
	}

	return event
}

func ensureAuthenticated() error {
	if currentCreds == nil {
		return fmt.Errorf("no credentials configured")
	}

	// Check if token is still valid
	if accessToken != "" && time.Now().Before(tokenExpiry) {
		return nil
	}

	// Get installation IDs if we don't have them
	if len(installationIDs) == 0 {
		if err := fetchInstallationIDs(); err != nil {
			return err
		}
	}

	// Authenticate using ViCare Authorization Code flow with PKCE
	tokenResp, err := AuthenticateWithViCare(currentCreds.Email, currentCreds.Password, currentCreds.ClientID)
	if err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}

	accessToken = tokenResp.AccessToken
	refreshToken = tokenResp.RefreshToken
	tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)

	log.Println("Successfully authenticated")
	return nil
}

func fetchInstallationIDs() error {
	if currentCreds == nil {
		return fmt.Errorf("no credentials configured")
	}

	// First authenticate
	tokenResp, err := AuthenticateWithViCare(currentCreds.Email, currentCreds.Password, currentCreds.ClientID)
	if err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}

	accessToken = tokenResp.AccessToken
	refreshToken = tokenResp.RefreshToken
	tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)

	// Get installations
	req, err := http.NewRequest("GET", "https://api.viessmann.com/iot/v1/equipment/installations", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// First decode as raw JSON to handle ID type flexibility
	var rawResult struct {
		Data []map[string]interface{} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&rawResult); err != nil {
		return err
	}

	if len(rawResult.Data) == 0 {
		return fmt.Errorf("no installations found")
	}

	// Initialize installations map
	installations = make(map[string]*Installation)
	installationIDs = make([]string, 0, len(rawResult.Data))

	// Process each installation
	for _, rawInstall := range rawResult.Data {
		installation := &Installation{}

		// Extract ID (can be string or number)
		var idStr string
		if id, ok := rawInstall["id"]; ok {
			switch v := id.(type) {
			case float64:
				idStr = fmt.Sprintf("%.0f", v)
			case string:
				idStr = v
			default:
				idStr = fmt.Sprintf("%v", v)
			}
		}

		if idStr == "" {
			continue
		}

		installation.ID = idStr

		// Extract description
		if desc, ok := rawInstall["description"].(string); ok {
			installation.Description = desc
		}

		// Extract address
		if addr, ok := rawInstall["address"].(map[string]interface{}); ok {
			if street, ok := addr["street"].(string); ok {
				installation.Address.Street = street
			}
			if houseNumber, ok := addr["houseNumber"].(string); ok {
				installation.Address.HouseNumber = houseNumber
			}
			if zip, ok := addr["zip"].(string); ok {
				installation.Address.Zip = zip
			}
			if city, ok := addr["city"].(string); ok {
				installation.Address.City = city
			}
			if country, ok := addr["country"].(string); ok {
				installation.Address.Country = country
			}
		}

		installations[idStr] = installation
		installationIDs = append(installationIDs, idStr)

		location := "Unknown location"
		if installation.Address.City != "" {
			location = fmt.Sprintf("%s, %s", installation.Address.City, installation.Address.Country)
		}

		log.Printf("Found installation ID: %s (%s) at %s\n",
			idStr, installation.Description, location)
	}

	log.Printf("Total installations found: %d\n", len(installationIDs))
	return nil
}

// --- New Account Management Handlers ---

func accountsPageHandler(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.ParseFS(templatesFS, "templates/accounts.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tmpl.Execute(w, nil)
}

func accountsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	store, err := LoadAccounts()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	accounts := make([]AccountResponse, 0, len(store.Accounts))
	for _, acc := range store.Accounts {
		accounts = append(accounts, AccountResponse{
			ID:          acc.ID,
			Name:        acc.Name,
			Email:       acc.Email,
			ClientID:    acc.ClientID,
			Active:      acc.Active,
			HasPassword: acc.Password != "",
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AccountsListResponse{Accounts: accounts})
}

func accountAddHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.Email == "" || req.Password == "" || req.ClientID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Email, password, and client ID are required",
		})
		return
	}

	// Test credentials before adding (always use default client secret)
	testCreds := &Credentials{
		Email:        req.Email,
		Password:     req.Password,
		ClientID:     req.ClientID,
		ClientSecret: defaultClientSecret,
	}

	if err := testCredentials(testCreds); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Authentication failed: " + err.Error(),
		})
		return
	}

	// Add account (always use default client secret)
	account := &Account{
		ID:           req.Email, // Use email as ID
		Name:         req.Name,
		Email:        req.Email,
		Password:     req.Password,
		ClientID:     req.ClientID,
		ClientSecret: defaultClientSecret,
		Active:       req.Active,
	}

	if account.Name == "" {
		account.Name = account.Email
	}

	if err := AddAccount(account); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Failed to add account: " + err.Error(),
		})
		return
	}

	// Clear cache to force refresh with new account
	fetchMutex.Lock()
	eventsCache = nil
	lastFetchTime = time.Time{}
	fetchMutex.Unlock()

	log.Printf("Account added: %s (%s)\n", account.Name, account.Email)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AccountActionResponse{Success: true})
}

func accountUpdateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	// Get existing account
	existing, err := GetAccount(req.ID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Account not found: " + err.Error(),
		})
		return
	}

	// Update fields
	if req.Name != "" {
		existing.Name = req.Name
	}
	if req.Password != "" {
		existing.Password = req.Password
	}
	if req.ClientID != "" {
		existing.ClientID = req.ClientID
	}
	// Always use default client secret
	existing.ClientSecret = defaultClientSecret

	if err := UpdateAccount(existing); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Failed to update account: " + err.Error(),
		})
		return
	}

	// Clear token for this account (will re-authenticate with new credentials)
	accountsMutex.Lock()
	delete(accountTokens, existing.ID)
	accountsMutex.Unlock()

	// Clear cache to force refresh
	fetchMutex.Lock()
	eventsCache = nil
	lastFetchTime = time.Time{}
	fetchMutex.Unlock()

	log.Printf("Account updated: %s (%s)\n", existing.Name, existing.Email)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AccountActionResponse{Success: true})
}

func accountDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	if err := DeleteAccount(req.ID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Failed to delete account: " + err.Error(),
		})
		return
	}

	// Remove token for this account
	accountsMutex.Lock()
	delete(accountTokens, req.ID)
	accountsMutex.Unlock()

	log.Printf("Account deleted: %s\n", req.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AccountActionResponse{Success: true})
}

func accountToggleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID     string `json:"id"`
		Active bool   `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	if err := SetAccountActive(req.ID, req.Active); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(AccountActionResponse{
			Success: false,
			Error:   "Failed to toggle account: " + err.Error(),
		})
		return
	}

	// Clear cache when toggling accounts
	fetchMutex.Lock()
	eventsCache = nil
	lastFetchTime = time.Time{}
	fetchMutex.Unlock()

	log.Printf("Account %s set to active=%v\n", req.ID, req.Active)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AccountActionResponse{Success: true})
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
