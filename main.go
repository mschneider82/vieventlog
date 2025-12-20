package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
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
	// Build-time version information (set via ldflags)
	version = "dev"
	commit  = "unknown"
	date    = "unknown"

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
	// Create application-wide context for graceful shutdown coordination
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

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
	http.HandleFunc("/api/accounts/fullsync", accountFullSyncHandler)

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

	// Temperature log endpoints
	http.HandleFunc("/api/temperature-log/settings", handleTemperatureLogSettings)
	http.HandleFunc("/api/temperature-log/settings/set", handleSetTemperatureLogSettings)
	http.HandleFunc("/api/temperature-log/stats", handleTemperatureLogStats)
	http.HandleFunc("/api/temperature-log/data", handleTemperatureLogData)

	// Consumption statistics endpoint
	http.HandleFunc("/api/consumption/stats", HandleConsumptionStats)

	// Start event archive scheduler if enabled
	go func() {
		// Small delay to ensure everything is initialized
		time.Sleep(2 * time.Second)

		err := StartEventArchiveScheduler()
		if err != nil {
			log.Printf("Event archive scheduler initialization: %v", err)
		}

		// Start temperature scheduler if enabled
		err = StartTemperatureScheduler()
		if err != nil {
			log.Printf("Temperature scheduler initialization: %v", err)
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

	// Setup signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Wrap with Basic Auth middleware if configured
	handler := BasicAuthMiddleware(http.DefaultServeMux)

	// Create HTTP server with explicit configuration
	server := &http.Server{
		Addr:    finalBindAddress,
		Handler: handler,
	}

	// Run server in goroutine
	go func() {
		log.Printf("Starting Event Viewer")
		log.Printf("Open your browser at: %s", userURL)
		log.Printf("Press Ctrl+C to stop gracefully")

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for interrupt signal
	<-sigChan
	log.Println("\nReceived shutdown signal, shutting down gracefully...")

	// Cancel application context to signal all components
	cancel()

	// Stop all schedulers gracefully
	log.Println("Stopping event archive scheduler...")
	StopEventArchiveScheduler()

	log.Println("Stopping temperature scheduler...")
	StopTemperatureScheduler()

	// Give schedulers time to finish current operations
	time.Sleep(500 * time.Millisecond)

	// Close database if initialized
	log.Println("Closing database...")
	if err := CloseEventDatabase(); err != nil {
		log.Printf("Error closing database: %v", err)
	} else {
		log.Println("Database closed successfully (WAL committed)")
	}

	// Graceful shutdown with timeout for HTTP server
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	log.Println("Shutting down HTTP server...")
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}

	log.Println("Shutdown complete")
}
