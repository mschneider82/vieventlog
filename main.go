package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed templates/*
var templatesFS embed.FS

//go:embed static/*
var staticFS embed.FS

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
	Gateways []Gateway `json:"gateways,omitempty"`
}

type GatewayDevice struct {
	DeviceID   string `json:"deviceId"`
	DeviceType string `json:"deviceType"`
	ModelID    string `json:"modelId"`
}

type Gateway struct {
	Serial  string           `json:"serial"`
	Version string           `json:"version,omitempty"`
	Devices []GatewayDevice  `json:"devices,omitempty"`
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
	GatewaySerial  string `json:"gatewaySerial"`
	AccountID      string `json:"accountId,omitempty"` // Account ID (email) for device settings
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

// Feature represents a single feature from the Viessmann API
type Feature struct {
	Feature    string                 `json:"feature"`
	Properties map[string]interface{} `json:"properties"`
	GatewayID  string                 `json:"gatewayId,omitempty"`
	DeviceID   string                 `json:"deviceId,omitempty"`
	Timestamp  string                 `json:"timestamp,omitempty"`
}

// FeatureValue represents the parsed value of a feature
type FeatureValue struct {
	Type  string      `json:"type"`
	Value interface{} `json:"value"`
	Unit  string      `json:"unit,omitempty"`
}

// FeaturesResponse represents the API response for features
type FeaturesResponse struct {
	Data []Feature `json:"data"`
}

// DeviceFeatures groups features by category for easier display
type DeviceFeatures struct {
	InstallationID string                  `json:"installationId"`
	GatewayID      string                  `json:"gatewayId"`
	DeviceID       string                  `json:"deviceId"`
	Temperatures   map[string]FeatureValue `json:"temperatures"`
	OperatingModes map[string]FeatureValue `json:"operatingModes"`
	DHW            map[string]FeatureValue `json:"dhw"` // Domestic Hot Water
	Circuits       map[string]FeatureValue `json:"circuits"`
	Other          map[string]FeatureValue `json:"other"`
	RawFeatures    []Feature               `json:"rawFeatures"`
	LastUpdate     time.Time               `json:"lastUpdate"`
}

var (
	// Features cache
	featuresCache      = make(map[string]*DeviceFeatures) // key: installationID:gatewayID:deviceID
	featuresCacheMutex sync.RWMutex
)

func main() {
	// Initialize account management
	accountTokens = make(map[string]*AccountToken)

	// Try to load credentials from keyring first
	loadStoredCredentials()

	// Setup HTTP handlers
	http.HandleFunc("/", indexHandler)
	http.HandleFunc("/login", loginPageHandler)
	http.HandleFunc("/accounts", accountsPageHandler)
	http.HandleFunc("/dashboard", dashboardPageHandler)

	// Static files handler
	http.Handle("/static/", http.FileServer(http.FS(staticFS)))

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

	// Device settings endpoints
	http.HandleFunc("/api/device-settings/get", deviceSettingsGetHandler)
	http.HandleFunc("/api/device-settings/set", deviceSettingsSetHandler)
	http.HandleFunc("/api/device-settings/delete", deviceSettingsDeleteHandler)

	// DHW operating mode control
	http.HandleFunc("/api/dhw/mode/set", dhwModeSetHandler)
	http.HandleFunc("/api/dhw/temperature/set", dhwTemperatureSetHandler)
	http.HandleFunc("/api/dhw/hysteresis/set", dhwHysteresisSetHandler)
	http.HandleFunc("/api/dhw/oneTimeCharge/activate", dhwOneTimeChargeHandler)

	// Noise reduction control
	http.HandleFunc("/api/noise-reduction/mode/set", noiseReductionModeSetHandler)

	// Heating curve control
	http.HandleFunc("/api/heating/curve/set", heatingCurveSetHandler)
	http.HandleFunc("/api/heating/mode/set", heatingModeSetHandler)
	http.HandleFunc("/api/heating/supplyTempMax/set", supplyTempMaxSetHandler)
	http.HandleFunc("/api/heating/roomTemp/set", roomTempSetHandler)

	// Data endpoints
	http.HandleFunc("/api/events", eventsHandler)
	http.HandleFunc("/api/status", statusHandler)
	http.HandleFunc("/api/devices", devicesHandler)
	http.HandleFunc("/api/features", featuresHandler)

	// Debug endpoints
	http.HandleFunc("/api/debug/devices", debugDevicesHandler)

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

func dashboardPageHandler(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.ParseFS(templatesFS, "templates/dashboard.html")
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
	// Get active accounts and ensure they're authenticated
	activeAccounts, err := GetActiveAccounts()
	if err == nil && len(activeAccounts) > 0 {
		// Authenticate all active accounts to populate accountTokens
		for _, account := range activeAccounts {
			_, err := ensureAccountAuthenticated(account)
			if err != nil {
				log.Printf("Warning: Failed to authenticate account %s for devices: %v\n", account.Email, err)
			}
		}
	} else if err == nil && len(activeAccounts) == 0 {
		// Fallback to legacy system
		if currentCreds != nil {
			if err := ensureAuthenticated(); err != nil {
				log.Printf("Warning: Failed to authenticate legacy credentials: %v\n", err)
			}
		}
	}

	// Build a unified installations map from all account tokens
	// Track which account owns each installation
	allInstallations := make(map[string]*Installation)
	installationToAccount := make(map[string]string) // installationID -> accountID

	accountsMutex.RLock()
	for accountID, token := range accountTokens {
		for id, installation := range token.Installations {
			allInstallations[id] = installation
			installationToAccount[id] = accountID
		}
	}
	accountsMutex.RUnlock()

	// Also include legacy installations
	if installations != nil {
		for id, installation := range installations {
			if _, exists := allInstallations[id]; !exists {
				allInstallations[id] = installation
				// Legacy installations don't have an account ID
				installationToAccount[id] = ""
			}
		}
	}

	// Group devices by installation - use gateway data (not events!)
	devicesByInstallation := make(map[string]map[string]Device)

	// Build device list from installations' gateway data
	for installID, installation := range allInstallations {
		if _, exists := devicesByInstallation[installID]; !exists {
			devicesByInstallation[installID] = make(map[string]Device)
		}

		accountID := installationToAccount[installID]

		// Iterate through gateways and their devices
		for _, gateway := range installation.Gateways {
			for _, gwDevice := range gateway.Devices {
				// Include heating and zigbee devices (SmartClimate)
				if gwDevice.DeviceType != "heating" && gwDevice.DeviceType != "zigbee" {
					continue
				}

				// Try to get device name from features
				displayName := gwDevice.ModelID

				// Get access token for this account
				accountsMutex.RLock()
				token, hasToken := accountTokens[accountID]
				accountsMutex.RUnlock()

				if hasToken && token.AccessToken != "" {
					// Try to fetch device.name feature
					deviceName := getDeviceNameFromFeatures(installID, gateway.Serial, gwDevice.DeviceID, token.AccessToken)
					if deviceName != "" {
						displayName = deviceName
					}
				}

				key := fmt.Sprintf("%s_%s", gateway.Serial, gwDevice.DeviceID)
				devicesByInstallation[installID][key] = Device{
					DeviceID:       gwDevice.DeviceID,
					ModelID:        gwDevice.ModelID,
					DisplayName:    displayName,
					InstallationID: installID,
					GatewaySerial:  gateway.Serial,
					AccountID:      accountID,
				}
				log.Printf("Registered %s device in installation %s: %s (Gateway %s, Device %s, Account %s)\n",
					gwDevice.DeviceType, installID, displayName, gateway.Serial, gwDevice.DeviceID, accountID)
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

// findModelIDForDevice finds the model ID for a specific device from events
func findModelIDForDevice(installationID, deviceID string, events []Event) string {
	for _, event := range events {
		if event.InstallationID == installationID && event.DeviceID == deviceID && event.ModelID != "" {
			return event.ModelID
		}
	}
	return ""
}

// getGatewayFromEvents extracts gateway serial from cached events for a given installation
func getGatewayFromEvents(installationID string) string {
	fetchMutex.Lock()
	defer fetchMutex.Unlock()

	// Look through cached events to find gateway serial
	for _, event := range eventsCache {
		if event.InstallationID == installationID && event.GatewaySerial != "" {
			log.Printf("Found gateway %s for installation %s from events cache\n", event.GatewaySerial, installationID)
			return event.GatewaySerial
		}
	}

	return ""
}

func featuresHandler(w http.ResponseWriter, r *http.Request) {
	// Get query parameters
	installationID := r.URL.Query().Get("installationId")
	gatewaySerial := r.URL.Query().Get("gatewaySerial")
	deviceID := r.URL.Query().Get("deviceId")
	forceRefresh := r.URL.Query().Get("refresh") == "true"

	if installationID == "" {
		http.Error(w, "installationId parameter required", http.StatusBadRequest)
		return
	}

	if deviceID == "" {
		deviceID = "0" // Default device
	}

	log.Printf("Features request: installation=%s, gateway=%s, device=%s, forceRefresh=%v\n", installationID, gatewaySerial, deviceID, forceRefresh)

	// Get active accounts to find the right token
	activeAccounts, err := GetActiveAccounts()
	var accessToken string
	var gatewayID string

	// Use provided gateway serial if available
	if gatewaySerial != "" {
		gatewayID = gatewaySerial
	}

	if err == nil && len(activeAccounts) > 0 {
		// Try to find the account that owns this installation
		for _, account := range activeAccounts {
			token, err := ensureAccountAuthenticated(account)
			if err != nil {
				continue
			}

			// Check if this account has this installation
			for _, instID := range token.InstallationIDs {
				if instID == installationID {
					accessToken = token.AccessToken

					// Only try to get gateway from installation if not provided
					if gatewayID == "" {
						if installation, ok := token.Installations[installationID]; ok {
							if len(installation.Gateways) > 0 {
								gatewayID = installation.Gateways[0].Serial
							}
						}
					}
					break
				}
			}
			if accessToken != "" {
				break
			}
		}
	}

	// Fallback to legacy single account if no token found
	if accessToken == "" {
		if err := ensureAuthenticated(); err != nil {
			http.Error(w, "Authentication failed: "+err.Error(), http.StatusUnauthorized)
			return
		}
		// Use the global access token from legacy system
		accessToken = getGlobalAccessToken()
		// Only try to get gateway from installations if not provided
		if gatewayID == "" {
			if installation, ok := installations[installationID]; ok {
				if len(installation.Gateways) > 0 {
					gatewayID = installation.Gateways[0].Serial
				}
			}
		}
	}

	if accessToken == "" {
		http.Error(w, "No access token available for this installation", http.StatusUnauthorized)
		return
	}

	if gatewayID == "" {
		// Try to get gateway from cached events (they contain gatewaySerial)
		gatewayID = getGatewayFromEvents(installationID)

		if gatewayID == "" {
			// Last resort: try to fetch from API
			gatewayID, err = fetchGatewayIDForInstallation(installationID, accessToken)
			if err != nil {
				http.Error(w, "Failed to determine gateway ID: "+err.Error()+". Tip: Load events first to populate gateway information.", http.StatusInternalServerError)
				return
			}
		}
	}

	// Fetch features with caching (or force refresh)
	var features *DeviceFeatures
	if forceRefresh {
		log.Printf("Force refresh - bypassing cache for %s:%s:%s\n", installationID, gatewayID, deviceID)
		features, err = fetchFeaturesForDevice(installationID, gatewayID, deviceID, accessToken)
		if err != nil {
			http.Error(w, "Failed to fetch features: "+err.Error(), http.StatusInternalServerError)
			return
		}
		// Update cache with fresh data
		cacheKey := fmt.Sprintf("%s:%s:%s", installationID, gatewayID, deviceID)
		featuresCacheMutex.Lock()
		featuresCache[cacheKey] = features
		featuresCacheMutex.Unlock()
	} else {
		features, err = fetchFeaturesWithCache(installationID, gatewayID, deviceID, accessToken)
		if err != nil {
			http.Error(w, "Failed to fetch features: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(features)
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
	// Use includeGateways=true to get gateway and device info (like PyViCare does)
	req, err := http.NewRequest("GET", "https://api.viessmann.com/iot/v1/equipment/installations?includeGateways=true", nil)
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

		// Extract gateway information (with includeGateways=true, we get full device info)
		if gateways, ok := rawInstall["gateways"].([]interface{}); ok {
			for _, gw := range gateways {
				if gwMap, ok := gw.(map[string]interface{}); ok {
					gateway := Gateway{}
					if serial, ok := gwMap["serial"].(string); ok {
						gateway.Serial = serial
					}
					if version, ok := gwMap["version"].(string); ok {
						gateway.Version = version
					}
					// Extract device information from devices array (PyViCare style)
					if devices, ok := gwMap["devices"].([]interface{}); ok {
						for _, dev := range devices {
							if devMap, ok := dev.(map[string]interface{}); ok {
								var devID string
								var devType string
								var modelID string

								// Get device ID
								if id, ok := devMap["id"].(string); ok {
									devID = id
									// Handle special cases like PyViCare does
									if id == "gateway" && devMap["deviceType"] == "vitoconnect" {
										devID = "0"
									} else if id == "gateway" && devMap["deviceType"] == "tcu" {
										devID = "0"
									} else if id == "HEMS" && devMap["deviceType"] == "hems" {
										devID = "0"
									} else if id == "EEBUS" && devMap["deviceType"] == "EEBus" {
										devID = "0"
									}
								} else if id, ok := devMap["id"].(float64); ok {
									devID = fmt.Sprintf("%.0f", id)
								}

								// Get device type
								if dt, ok := devMap["deviceType"].(string); ok {
									devType = dt
								}

								// Get model ID
								if mid, ok := devMap["modelId"].(string); ok {
									modelID = mid
								}

								if devID != "" {
									gateway.Devices = append(gateway.Devices, GatewayDevice{
										DeviceID:   devID,
										DeviceType: devType,
										ModelID:    modelID,
									})
									log.Printf("Found device in gateway %s: ID=%s, Type=%s, Model=%s\n",
										gateway.Serial, devID, devType, modelID)
								}
							}
						}
					}
					installation.Gateways = append(installation.Gateways, gateway)
				}
			}
		}

		installations[idStr] = installation
		installationIDs = append(installationIDs, idStr)

		// Note: Gateway info is not available from /iot/v1/equipment/installations API
		// We extract it from events instead (see getGatewayFromEvents)
		log.Printf("Loaded installation %s: %s\n", idStr, installation.Description)
	}

	return installationIDs, installations, nil
}

func getMapKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
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

		// Extract errorDescription first
		var errorDescription string
		if errorDesc, ok := body["errorDescription"].(string); ok {
			event.ErrorDescription = errorDesc
			errorDescription = errorDesc
		}

		if errorCode, ok := body["errorCode"].(string); ok {
			event.ErrorCode = errorCode
			event.HumanReadable = getErrorDescription(errorCode)
			event.CodeCategory = getCodeCategory(errorCode)
			event.Severity = getSeverity(errorCode)

			// If description is "Unbekannter..." and we have errorDescription from API, use that instead
			if strings.Contains(event.HumanReadable, "Unbekannter") && errorDescription != "" {
				event.HumanReadable = errorCode + " - " + errorDescription
			}
		}

		if deviceID, ok := body["deviceId"].(string); ok {
			event.DeviceID = deviceID
		} else if deviceID, ok := body["deviceId"].(float64); ok {
			event.DeviceID = fmt.Sprintf("%.0f", deviceID)
		} else {
			// Try to get deviceId from top-level
			if deviceID, ok := raw["deviceId"].(string); ok {
				event.DeviceID = deviceID
			} else if deviceID, ok := raw["deviceId"].(float64); ok {
				event.DeviceID = fmt.Sprintf("%.0f", deviceID)
			} else {
				event.DeviceID = "0"
				// Debug: log event structure to see where deviceId is
				if event.ModelID != "" {
					log.Printf("DEBUG: Event has no deviceId - EventType: %s, ModelID: %s, Body keys: %v\n",
						event.EventType, event.ModelID, getMapKeys(body))
				}
			}
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

		// Extract gateway information (with includeGateways=true, we get full device info)
		if gateways, ok := rawInstall["gateways"].([]interface{}); ok {
			for _, gw := range gateways {
				if gwMap, ok := gw.(map[string]interface{}); ok {
					gateway := Gateway{}
					if serial, ok := gwMap["serial"].(string); ok {
						gateway.Serial = serial
					}
					if version, ok := gwMap["version"].(string); ok {
						gateway.Version = version
					}
					// Extract device information from devices array (PyViCare style)
					if devices, ok := gwMap["devices"].([]interface{}); ok {
						for _, dev := range devices {
							if devMap, ok := dev.(map[string]interface{}); ok {
								var devID string
								var devType string
								var modelID string

								// Get device ID
								if id, ok := devMap["id"].(string); ok {
									devID = id
									// Handle special cases like PyViCare does
									if id == "gateway" && devMap["deviceType"] == "vitoconnect" {
										devID = "0"
									} else if id == "gateway" && devMap["deviceType"] == "tcu" {
										devID = "0"
									} else if id == "HEMS" && devMap["deviceType"] == "hems" {
										devID = "0"
									} else if id == "EEBUS" && devMap["deviceType"] == "EEBus" {
										devID = "0"
									}
								} else if id, ok := devMap["id"].(float64); ok {
									devID = fmt.Sprintf("%.0f", id)
								}

								// Get device type
								if dt, ok := devMap["deviceType"].(string); ok {
									devType = dt
								}

								// Get model ID
								if mid, ok := devMap["modelId"].(string); ok {
									modelID = mid
								}

								if devID != "" {
									gateway.Devices = append(gateway.Devices, GatewayDevice{
										DeviceID:   devID,
										DeviceType: devType,
										ModelID:    modelID,
									})
									log.Printf("Found device in gateway %s: ID=%s, Type=%s, Model=%s\n",
										gateway.Serial, devID, devType, modelID)
								}
							}
						}
					}
					installation.Gateways = append(installation.Gateways, gateway)
				}
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

// --- Device Settings Handlers ---

type DeviceSettingsRequest struct {
	AccountID        string `json:"accountId"`
	InstallationID   string `json:"installationId"`
	DeviceID         string `json:"deviceId"`
	CompressorRpmMin int    `json:"compressorRpmMin"`
	CompressorRpmMax int    `json:"compressorRpmMax"`
}

type DeviceSettingsResponse struct {
	Success          bool   `json:"success"`
	Error            string `json:"error,omitempty"`
	CompressorRpmMin int    `json:"compressorRpmMin,omitempty"`
	CompressorRpmMax int    `json:"compressorRpmMax,omitempty"`
}

func deviceSettingsGetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	accountID := r.URL.Query().Get("accountId")
	installationID := r.URL.Query().Get("installationId")
	deviceID := r.URL.Query().Get("deviceId")

	if accountID == "" || installationID == "" || deviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "accountId, installationId, and deviceId are required",
		})
		return
	}

	deviceKey := fmt.Sprintf("%s_%s", installationID, deviceID)
	settings, err := GetDeviceSettings(accountID, deviceKey)
	if err != nil {
		// No settings found is not an error - return empty settings
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: true,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(DeviceSettingsResponse{
		Success:          true,
		CompressorRpmMin: settings.CompressorRpmMin,
		CompressorRpmMax: settings.CompressorRpmMax,
	})
}

func deviceSettingsSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DeviceSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	if req.AccountID == "" || req.InstallationID == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "accountId, installationId, and deviceId are required",
		})
		return
	}

	deviceKey := fmt.Sprintf("%s_%s", req.InstallationID, req.DeviceID)
	settings := &DeviceSettings{
		CompressorRpmMin: req.CompressorRpmMin,
		CompressorRpmMax: req.CompressorRpmMax,
	}

	if err := SetDeviceSettings(req.AccountID, deviceKey, settings); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "Failed to save settings: " + err.Error(),
		})
		return
	}

	log.Printf("Device settings saved for %s (account: %s): min=%d, max=%d\n",
		deviceKey, req.AccountID, req.CompressorRpmMin, req.CompressorRpmMax)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(DeviceSettingsResponse{Success: true})
}

func deviceSettingsDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DeviceSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "Invalid request: " + err.Error(),
		})
		return
	}

	if req.AccountID == "" || req.InstallationID == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "accountId, installationId, and deviceId are required",
		})
		return
	}

	deviceKey := fmt.Sprintf("%s_%s", req.InstallationID, req.DeviceID)

	if err := DeleteDeviceSettings(req.AccountID, deviceKey); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DeviceSettingsResponse{
			Success: false,
			Error:   "Failed to delete settings: " + err.Error(),
		})
		return
	}

	log.Printf("Device settings deleted for %s (account: %s)\n", deviceKey, req.AccountID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(DeviceSettingsResponse{Success: true})
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// --- Features API Functions ---

// fetchFeaturesForDevice fetches features for a specific installation/gateway/device
func fetchFeaturesForDevice(installationID, gatewayID, deviceID, accessToken string) (*DeviceFeatures, error) {
	// Build API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v2/features/installations/%s/gateways/%s/devices/%s/features",
		installationID, gatewayID, deviceID)

	log.Printf("Fetching features from API: %s\n", url)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("ERROR: API returned status %d for %s\nResponse: %s\n", resp.StatusCode, url, string(bodyBytes))
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var featuresResp FeaturesResponse
	if err := json.NewDecoder(resp.Body).Decode(&featuresResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Parse and categorize features
	deviceFeatures := parseFeatures(featuresResp.Data, installationID, gatewayID, deviceID)
	return deviceFeatures, nil
}

// parseFeatures categorizes features into logical groups
func parseFeatures(features []Feature, installationID, gatewayID, deviceID string) *DeviceFeatures {
	df := &DeviceFeatures{
		InstallationID: installationID,
		GatewayID:      gatewayID,
		DeviceID:       deviceID,
		Temperatures:   make(map[string]FeatureValue),
		OperatingModes: make(map[string]FeatureValue),
		DHW:            make(map[string]FeatureValue),
		Circuits:       make(map[string]FeatureValue),
		Other:          make(map[string]FeatureValue),
		RawFeatures:    features,
		LastUpdate:     time.Now(),
	}

	for _, feature := range features {
		// Extract value from properties
		value := extractFeatureValue(feature.Properties)
		featureName := feature.Feature

		// Categorize by feature name
		if strings.Contains(featureName, "temperature") {
			df.Temperatures[featureName] = value
		} else if strings.Contains(featureName, "dhw") || strings.Contains(featureName, "hotwater") {
			df.DHW[featureName] = value
		} else if strings.Contains(featureName, "operating") || strings.Contains(featureName, "mode") || strings.Contains(featureName, "program") {
			df.OperatingModes[featureName] = value
		} else if strings.Contains(featureName, "circuit") {
			df.Circuits[featureName] = value
		} else {
			df.Other[featureName] = value
		}
	}

	return df
}

// extractFeatureValue extracts the value from feature properties
func extractFeatureValue(properties map[string]interface{}) FeatureValue {
	fv := FeatureValue{}

	// Check if there's a "value" property - this is the primary value
	if valueObj, ok := properties["value"].(map[string]interface{}); ok {
		// Extract the main value
		if typ, ok := valueObj["type"].(string); ok {
			fv.Type = typ
		}
		if val, ok := valueObj["value"]; ok {
			fv.Value = val
		}
		if unit, ok := valueObj["unit"].(string); ok {
			fv.Unit = unit
		}

		// If there are additional meaningful properties (not status/active), include them as nested
		// Properties like switchOnValue, switchOffValue should be included
		hasAdditionalProperties := false
		nestedValues := make(map[string]FeatureValue)

		for propName, propValue := range properties {
			// Skip the main "value" property and metadata properties like "status", "active"
			if propName == "value" || propName == "status" || propName == "active" || propName == "enabled" {
				continue
			}

			if propMap, ok := propValue.(map[string]interface{}); ok {
				nestedFv := FeatureValue{}
				if typ, ok := propMap["type"].(string); ok {
					nestedFv.Type = typ
				}
				if val, ok := propMap["value"]; ok {
					nestedFv.Value = val
				}
				if unit, ok := propMap["unit"].(string); ok {
					nestedFv.Unit = unit
				}
				nestedValues[propName] = nestedFv
				hasAdditionalProperties = true
			}
		}

		// If we have additional properties, return as object
		if hasAdditionalProperties {
			nestedValues["value"] = fv  // Include the main value
			fv.Type = "object"
			fv.Value = nestedValues
		}

		return fv
	}

	// No "value" property - the properties themselves are the data
	// (e.g., heating.curve has "slope" and "shift" directly)
	nestedValues := make(map[string]FeatureValue)
	for propName, propValue := range properties {
		if propMap, ok := propValue.(map[string]interface{}); ok {
			nestedFv := FeatureValue{}
			if typ, ok := propMap["type"].(string); ok {
				nestedFv.Type = typ
			}
			if val, ok := propMap["value"]; ok {
				nestedFv.Value = val
			}
			if unit, ok := propMap["unit"].(string); ok {
				nestedFv.Unit = unit
			}
			nestedValues[propName] = nestedFv
		}
	}

	if len(nestedValues) > 0 {
		fv.Type = "object"
		fv.Value = nestedValues
	}

	return fv
}

// fetchFeaturesWithCache fetches features with caching support
func fetchFeaturesWithCache(installationID, gatewayID, deviceID, accessToken string) (*DeviceFeatures, error) {
	cacheKey := fmt.Sprintf("%s:%s:%s", installationID, gatewayID, deviceID)

	// Check cache first
	featuresCacheMutex.RLock()
	if cached, exists := featuresCache[cacheKey]; exists {
		// Cache valid for 5 minutes
		if time.Since(cached.LastUpdate) < 5*time.Minute {
			featuresCacheMutex.RUnlock()
			return cached, nil
		}
	}
	featuresCacheMutex.RUnlock()

	// Fetch fresh data
	features, err := fetchFeaturesForDevice(installationID, gatewayID, deviceID, accessToken)
	if err != nil {
		// Return stale cache if available
		featuresCacheMutex.RLock()
		if cached, exists := featuresCache[cacheKey]; exists {
			featuresCacheMutex.RUnlock()
			log.Printf("Warning: Using stale cache due to fetch error: %v\n", err)
			return cached, nil
		}
		featuresCacheMutex.RUnlock()
		return nil, err
	}

	// Update cache
	featuresCacheMutex.Lock()
	featuresCache[cacheKey] = features
	featuresCacheMutex.Unlock()

	return features, nil
}

// getDeviceNameFromFeatures fetches the device.name feature for a device
func getDeviceNameFromFeatures(installationID, gatewayID, deviceID, accessToken string) string {
	features, err := fetchFeaturesWithCache(installationID, gatewayID, deviceID, accessToken)
	if err != nil {
		return ""
	}

	// Look for device.name in the "other" category
	if deviceName, exists := features.Other["device.name"]; exists {
		if nameValue, ok := deviceName.Value.(string); ok {
			return nameValue
		}
		// Handle nested structure: value.name.value
		if nameMap, ok := deviceName.Value.(map[string]FeatureValue); ok {
			if nameProp, exists := nameMap["name"]; exists {
				if nameStr, ok := nameProp.Value.(string); ok {
					return nameStr
				}
			}
		}
	}

	return ""
}

// getGlobalAccessToken returns the global access token (for legacy support)
func getGlobalAccessToken() string {
	return accessToken
}

// fetchGatewayIDForInstallation fetches the gateway ID for an installation
func fetchGatewayIDForInstallation(installationID, accessToken string) (string, error) {
	// Fetch all installations to get gateway info
	req, err := http.NewRequest("GET", "https://api.viessmann.com/iot/v1/equipment/installations", nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var result struct {
		Data []map[string]interface{} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	// Find the installation we're looking for
	for _, rawInstall := range result.Data {
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

		if idStr == installationID {
			// Extract gateway from this installation
			if gateways, ok := rawInstall["gateways"].([]interface{}); ok && len(gateways) > 0 {
				if gwMap, ok := gateways[0].(map[string]interface{}); ok {
					if serial, ok := gwMap["serial"].(string); ok {
						log.Printf("Found gateway %s for installation %s\n", serial, installationID)
						return serial, nil
					}
				}
			}
		}
	}

	return "", fmt.Errorf("no gateways found for installation %s (checked %d installations)", installationID, len(result.Data))
}

// --- Debug API Handlers ---

type DebugDeviceInfo struct {
	InstallationID  string                 `json:"installationId"`
	InstallationDesc string                 `json:"installationDesc"`
	GatewaySerial   string                 `json:"gatewaySerial"`
	DeviceID        string                 `json:"deviceId"`
	DeviceType      string                 `json:"deviceType"`
	ModelID         string                 `json:"modelId"`
	AccountName     string                 `json:"accountName,omitempty"`
	Features        []Feature              `json:"features,omitempty"`
	FeaturesError   string                 `json:"featuresError,omitempty"`
}

type DebugDevicesResponse struct {
	TotalDevices   int               `json:"totalDevices"`
	UnknownDevices int               `json:"unknownDevices"`
	Devices        []DebugDeviceInfo `json:"devices"`
	IncludesFeatures bool            `json:"includesFeatures"`
}

func debugDevicesHandler(w http.ResponseWriter, r *http.Request) {
	// Check query parameters
	onlyUnknown := r.URL.Query().Get("onlyUnknown") == "true"
	includeFeatures := r.URL.Query().Get("includeFeatures") == "true"

	// Build a unified installations map from all account tokens
	allInstallations := make(map[string]*Installation)
	accountNames := make(map[string]string) // installationID -> accountName
	accountTokenMap := make(map[string]string) // installationID -> accessToken

	accountsMutex.RLock()
	for accountID, token := range accountTokens {
		// Get account name
		account, _ := GetAccount(accountID)
		accountName := accountID
		if account != nil {
			accountName = account.Name
		}

		for id, installation := range token.Installations {
			allInstallations[id] = installation
			accountNames[id] = accountName
			accountTokenMap[id] = token.AccessToken
		}
	}
	accountsMutex.RUnlock()

	// Also include legacy installations
	if installations != nil {
		for id, installation := range installations {
			if _, exists := allInstallations[id]; !exists {
				allInstallations[id] = installation
				accountNames[id] = "Legacy Account"
				accountTokenMap[id] = accessToken
			}
		}
	}

	// Collect all devices
	debugDevices := make([]DebugDeviceInfo, 0)
	unknownCount := 0

	for installID, installation := range allInstallations {
		for _, gateway := range installation.Gateways {
			for _, gwDevice := range gateway.Devices {
				isUnknown := gwDevice.DeviceType != "heating"

				// Count unknown devices
				if isUnknown {
					unknownCount++
				}

				// Skip known devices if only unknown requested
				if onlyUnknown && !isUnknown {
					continue
				}

				deviceInfo := DebugDeviceInfo{
					InstallationID:  installID,
					InstallationDesc: installation.Description,
					GatewaySerial:   gateway.Serial,
					DeviceID:        gwDevice.DeviceID,
					DeviceType:      gwDevice.DeviceType,
					ModelID:         gwDevice.ModelID,
					AccountName:     accountNames[installID],
				}

				// Fetch features if requested
				if includeFeatures {
					if token, ok := accountTokenMap[installID]; ok {
						features, err := fetchFeaturesForDevice(installID, gateway.Serial, gwDevice.DeviceID, token)
						if err != nil {
							deviceInfo.FeaturesError = err.Error()
							log.Printf("Failed to fetch features for %s/%s/%s: %v\n",
								installID, gateway.Serial, gwDevice.DeviceID, err)
						} else if features != nil {
							deviceInfo.Features = features.RawFeatures
						}
					}
				}

				debugDevices = append(debugDevices, deviceInfo)
			}
		}
	}

	response := DebugDevicesResponse{
		TotalDevices:     len(debugDevices),
		UnknownDevices:   unknownCount,
		Devices:          debugDevices,
		IncludesFeatures: includeFeatures,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DHW Mode Set Handler
func dhwModeSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
		Mode           string `json:"mode"` // eco, comfort, off
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" || req.Mode == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, and mode are required",
		})
		return
	}

	// Validate mode
	validModes := map[string]bool{
		"efficient":                true,
		"efficientWithMinComfort":  true,
		"off":                      true,
	}
	if !validModes[req.Mode] {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid mode. Must be one of: efficient, efficientWithMinComfort, off",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.dhw.operating.modes.active/commands/setMode",
		req.InstallationID, req.GatewaySerial, req.DeviceID)

	// Prepare request body
	requestBody := map[string]string{
		"mode": req.Mode,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("DHW mode changed to '%s' for device %s (account: %s)", req.Mode, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// Noise Reduction Mode Set Handler
func noiseReductionModeSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
		Mode           string `json:"mode"` // notReduced, slightlyReduced, maxReduced
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" || req.Mode == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, and mode are required",
		})
		return
	}

	// Validate mode
	validModes := map[string]bool{
		"notReduced":       true,
		"slightlyReduced": true,
		"maxReduced":      true,
	}
	if !validModes[req.Mode] {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid mode. Must be one of: notReduced, slightlyReduced, maxReduced",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.noise.reduction.operating.programs.active/commands/setMode",
		req.InstallationID, req.GatewaySerial, req.DeviceID)

	// Prepare request body
	requestBody := map[string]string{
		"mode": req.Mode,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("Noise reduction mode changed to '%s' for device %s (account: %s)", req.Mode, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// DHW Temperature Set Handler
func dhwTemperatureSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string  `json:"accountId"`
		InstallationID string  `json:"installationId"`
		GatewaySerial  string  `json:"gatewaySerial"`
		DeviceID       string  `json:"deviceId"`
		Temperature    float64 `json:"temperature"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, and temperature are required",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.dhw.temperature.main/commands/setTargetTemperature",
		req.InstallationID, req.GatewaySerial, req.DeviceID)

	// Prepare request body
	requestBody := map[string]int{
		"temperature": int(req.Temperature),
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("DHW temperature changed to %.1f°C for device %s (account: %s)", req.Temperature, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// DHW Hysteresis Set Handler
func dhwHysteresisSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string  `json:"accountId"`
		InstallationID string  `json:"installationId"`
		GatewaySerial  string  `json:"gatewaySerial"`
		DeviceID       string  `json:"deviceId"`
		Type           string  `json:"type"` // "on" or "off"
		Value          float64 `json:"value"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" || req.Type == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, type, and value are required",
		})
		return
	}

	// Validate type
	var command string
	if req.Type == "on" {
		command = "setHysteresisSwitchOnValue"
	} else if req.Type == "off" {
		command = "setHysteresisSwitchOffValue"
	} else {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid type. Must be 'on' or 'off'",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.dhw.temperature.hysteresis/commands/%s",
		req.InstallationID, req.GatewaySerial, req.DeviceID, command)

	// Prepare request body
	requestBody := map[string]float64{
		"hysteresis": req.Value,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("DHW hysteresis %s changed to %.1fK for device %s (account: %s)", req.Type, req.Value, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// DHW One Time Charge Handler
func dhwOneTimeChargeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, and deviceId are required",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.dhw.oneTimeCharge/commands/activate",
		req.InstallationID, req.GatewaySerial, req.DeviceID)

	// Prepare empty request body
	requestBody := map[string]interface{}{}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("DHW one-time charge activated for device %s (account: %s)", req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// Heating Curve Set Handler
func heatingCurveSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string  `json:"accountId"`
		InstallationID string  `json:"installationId"`
		GatewaySerial  string  `json:"gatewaySerial"`
		DeviceID       string  `json:"deviceId"`
		Circuit        int     `json:"circuit"` // Circuit number, usually 0
		Shift          int     `json:"shift"`
		Slope          float64 `json:"slope"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId are required",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.circuits.%d.heating.curve/commands/setCurve",
		req.InstallationID, req.GatewaySerial, req.DeviceID, req.Circuit)

	// Prepare request body - shift as int, slope as float rounded to 1 decimal
	requestBody := map[string]interface{}{
		"shift": req.Shift,
		"slope": float64(int(req.Slope*10+0.5)) / 10, // Round to 1 decimal
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("Heating curve changed to shift=%d, slope=%.1f for device %s (account: %s)", req.Shift, req.Slope, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// Heating Mode Set Handler
func heatingModeSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
		Circuit        int    `json:"circuit"` // Circuit number, usually 0
		Mode           string `json:"mode"`    // heating, standby
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" || req.Mode == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, and mode are required",
		})
		return
	}

	// Validate mode
	validModes := map[string]bool{
		"heating": true,
		"standby": true,
	}
	if !validModes[req.Mode] {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid mode. Must be one of: heating, standby",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/features/installations/%s/gateways/%s/devices/%s/features/heating.circuits.%d.operating.modes.active/commands/setMode",
		req.InstallationID, req.GatewaySerial, req.DeviceID, req.Circuit)

	// Prepare request body
	requestBody := map[string]string{
		"mode": req.Mode,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("Heating mode changed to '%s' for device %s (account: %s)", req.Mode, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// Supply Temperature Max Set Handler
func supplyTempMaxSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
		Circuit        int    `json:"circuit"` // Circuit number, usually 0
		Temperature    int    `json:"temperature"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, and temperature are required",
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL - NOTE: using v2 API!
	url := fmt.Sprintf("https://api.viessmann.com/iot/v2/features/installations/%s/gateways/%s/devices/%s/features/heating.circuits.%d.temperature.levels/commands/setMax",
		req.InstallationID, req.GatewaySerial, req.DeviceID, req.Circuit)

	// Prepare request body
	requestBody := map[string]int{
		"temperature": req.Temperature,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("Supply temperature max changed to %d°C for device %s (account: %s)", req.Temperature, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// Room Temperature Setpoint Handler
func roomTempSetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AccountID      string `json:"accountId"`
		InstallationID string `json:"installationId"`
		GatewaySerial  string `json:"gatewaySerial"`
		DeviceID       string `json:"deviceId"`
		Circuit        int    `json:"circuit"` // Circuit number, usually 0
		Temperature    int    `json:"temperature"`
		Program        string `json:"program"` // Program: normal, comfort, reduced
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Invalid request: " + err.Error(),
		})
		return
	}

	// Validate required fields
	if req.AccountID == "" || req.InstallationID == "" || req.GatewaySerial == "" || req.DeviceID == "" || req.Program == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "accountId, installationId, gatewaySerial, deviceId, program, and temperature are required",
		})
		return
	}

	// Validate program - accept various program types
	validPrograms := map[string]bool{
		"normal":                            true,
		"normalHeating":                     true,
		"normalCooling":                     true,
		"normalEnergySaving":                true,
		"normalCoolingEnergySaving":         true,
		"comfort":                           true,
		"comfortHeating":                    true,
		"comfortCooling":                    true,
		"comfortEnergySaving":               true,
		"comfortCoolingEnergySaving":        true,
		"reduced":                           true,
		"reducedHeating":                    true,
		"reducedCooling":                    true,
		"reducedEnergySaving":               true,
		"reducedCoolingEnergySaving":        true,
		"eco":                               true,
		"fixed":                             true,
		"standby":                           true,
		"frostprotection":                   true,
		"forcedLastFromSchedule":            true,
		"summerEco":                         true,
	}
	if !validPrograms[req.Program] {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Invalid program: %s", req.Program),
		})
		return
	}

	// Get access token for the account
	accountsMutex.RLock()
	token, exists := accountTokens[req.AccountID]
	accountsMutex.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Account not found or not authenticated",
		})
		return
	}

	// Build Viessmann API URL
	url := fmt.Sprintf("https://api.viessmann.com/iot/v1/equipment/installations/%s/gateways/%s/devices/%s/features/heating.circuits.%d.operating.programs.%s/commands/setTemperature",
		req.InstallationID, req.GatewaySerial, req.DeviceID, req.Circuit, req.Program)

	// Prepare request body
	requestBody := map[string]int{
		"targetTemperature": req.Temperature,
	}
	jsonBody, err := json.Marshal(requestBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	// Make API call
	client := &http.Client{Timeout: 30 * time.Second}
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(jsonBody)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to create request: " + err.Error(),
		})
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Failed to call Viessmann API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Viessmann API error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Viessmann API returned status %d: %s", resp.StatusCode, string(bodyBytes)),
		})
		return
	}

	log.Printf("Room temperature for program %s changed to %d°C for circuit %d, device %s (account: %s)", req.Program, req.Temperature, req.Circuit, req.DeviceID, req.AccountID)

	// Clear features cache to force refresh
	featuresCacheMutex.Lock()
	cacheKey := fmt.Sprintf("%s:%s:%s", req.InstallationID, req.GatewaySerial, req.DeviceID)
	delete(featuresCache, cacheKey)
	featuresCacheMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}
