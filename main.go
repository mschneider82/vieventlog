package main

import (
	"embed"
	"fmt"
	"log"
	"net"
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

// tryBindAddress versucht auf der angegebenen Adresse zu binden.
// Wenn der Port belegt ist, wird Port+1 versucht (max 1x Retry).
// Gibt die finale Bind-Adresse und den lokalen URL-Präfix für den Benutzer zurück.
func tryBindAddress(bindAddress string) (string, string) {
	// Parse the bind address to get host and port
	parts := strings.Split(bindAddress, ":")
	if len(parts) < 2 {
		return bindAddress, bindAddress
	}

	host := strings.Join(parts[:len(parts)-1], ":")
	portStr := parts[len(parts)-1]
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return bindAddress, bindAddress
	}

	// Try primary port
	if canBind(host, port) {
		return bindAddress, fmt.Sprintf("http://localhost:%d", port)
	}

	log.Printf("Port %d is in use (possibly AirPlay Receiver on macOS). Trying port %d...", port, port+1)

	// Try fallback port (port+1)
	if canBind(host, port+1) {
		fallbackAddress := fmt.Sprintf("%s:%d", host, port+1)
		return fallbackAddress, fmt.Sprintf("http://localhost:%d", port+1)
	}

	// Both ports are in use, return original and let ListenAndServe fail with clear error
	return bindAddress, fmt.Sprintf("http://localhost:%d", port)
}

// canBind prüft, ob auf einem bestimmten Port gebunden werden kann
func canBind(host string, port int) bool {
	addr := fmt.Sprintf("%s:%d", host, port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	listener.Close()
	return true
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
	http.HandleFunc("/dashboard", dashboardPageHandler)
	http.HandleFunc("/smartclimate", smartClimatePageHandler)
	http.HandleFunc("/vitovent", vitoventPageHandler)
	http.HandleFunc("/vitocharge", vitochargePageHandler)
	http.HandleFunc("/apitest", apiTestPageHandler)

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

	// Hybrid Pro Control endpoints
	http.HandleFunc("/api/hybrid-pro-control/get", hybridProControlGetHandler)
	http.HandleFunc("/api/hybrid-pro-control/set", hybridProControlSetHandler)

	// DHW operating mode control
	http.HandleFunc("/api/dhw/mode/set", dhwModeSetHandler)
	http.HandleFunc("/api/dhw/temperature/set", dhwTemperatureSetHandler)
	http.HandleFunc("/api/dhw/temperature2/set", dhwTemperature2SetHandler)
	http.HandleFunc("/api/dhw/hysteresis/set", dhwHysteresisSetHandler)
	http.HandleFunc("/api/dhw/oneTimeCharge/activate", dhwOneTimeChargeHandler)

	// Noise reduction control
	http.HandleFunc("/api/noise-reduction/mode/set", noiseReductionModeSetHandler)

	// Fan ring heating control
	http.HandleFunc("/api/fan-ring/toggle", fanRingToggleHandler)

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

	// SmartClimate endpoints
	http.HandleFunc("/api/smartclimate/devices", smartClimateDevicesHandler)
	http.HandleFunc("/api/smartclimate/trv/temperature/set", trvSetTemperatureHandler)
	http.HandleFunc("/api/smartclimate/device/name/set", deviceSetNameHandler)
	http.HandleFunc("/api/smartclimate/trv/childlock/toggle", childLockToggleHandler)

	// Vitovent endpoints
	http.HandleFunc("/api/vitovent/devices", vitoventDevicesHandler)
	http.HandleFunc("/api/vitovent/operating-mode/set", vitoventOperatingModeHandler)
	http.HandleFunc("/api/vitovent/quickmode/toggle", vitoventQuickModeHandler)

	// Vitocharge endpoints
	http.HandleFunc("/api/vitocharge/devices", vitochargeDevicesHandler)
	http.HandleFunc("/api/vitocharge/debug", vitochargeDebugHandler)
	http.HandleFunc("/api/wallbox/debug", wallboxDebugHandler)

	// Rooms endpoints
	http.HandleFunc("/api/rooms", roomsHandler)
	http.HandleFunc("/api/rooms/name/set", setRoomNameHandler)
	http.HandleFunc("/api/rooms/temperature/set", setRoomTemperatureHandler)

	// Debug endpoints
	http.HandleFunc("/api/debug/devices", debugDevicesHandler)

	// API test endpoint
	http.HandleFunc("/api/test-request", testRequestHandler)

	// Event archive endpoints
	http.HandleFunc("/api/event-archive/settings", eventArchiveSettingsGetHandler)
	http.HandleFunc("/api/event-archive/settings/set", eventArchiveSettingsSetHandler)
	http.HandleFunc("/api/event-archive/stats", eventArchiveStatsHandler)

	// Start event archive scheduler if enabled
	go func() {
		// Small delay to ensure everything is initialized
		time.Sleep(2 * time.Second)

		err := StartEventArchiveScheduler()
		if err != nil {
			log.Printf("Event archive scheduler initialization: %v", err)
		}
	}()

	// Get bind address from environment, with backward compatibility for PORT
	bindAddress := os.Getenv("BIND_ADDRESS")
	if bindAddress == "" {
		port := getEnv("PORT", "5000")
		bindAddress = "0.0.0.0:" + port
	}

	// Try to bind to the address, with fallback for port conflicts (e.g., macOS AirPlay)
	finalBindAddress, userURL := tryBindAddress(bindAddress)

	log.Printf("Starting Event Viewer")
	log.Printf("Open your browser at: %s", userURL)

	// Wrap with Basic Auth middleware if configured
	handler := BasicAuthMiddleware(http.DefaultServeMux)

	log.Fatal(http.ListenAndServe(finalBindAddress, handler))
}
