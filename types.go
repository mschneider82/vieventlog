package main

import (
	"time"
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
	Serial  string          `json:"serial"`
	Version string          `json:"version,omitempty"`
	Devices []GatewayDevice `json:"devices,omitempty"`
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
	AccountID        string                 `json:"accountId"`              // Which account this event belongs to
	AccountName      string                 `json:"accountName"`            // User-friendly account name
	FeatureName      string                 `json:"featureName,omitempty"`  // For feature-changed events
	FeatureValue     string                 `json:"featureValue,omitempty"` // Value from commandBody
}

type EventsResponse struct {
	Data   []map[string]interface{} `json:"data"`
	Cursor *struct {
		Next string `json:"next"`
	} `json:"cursor,omitempty"`
}

type Device struct {
	DeviceID       string `json:"deviceId"`
	ModelID        string `json:"modelId"`
	DeviceType     string `json:"deviceType,omitempty"`
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

type DeviceSettingsRequest struct {
	AccountID                       string   `json:"accountId"`
	InstallationID                  string   `json:"installationId"`
	DeviceID                        string   `json:"deviceId"`
	CompressorRpmMin                int      `json:"compressorRpmMin"`
	CompressorRpmMax                int      `json:"compressorRpmMax"`
	CompressorPowerCorrectionFactor *float64 `json:"compressorPowerCorrectionFactor,omitempty"`
	UseAirIntakeTemperatureLabel    *bool    `json:"useAirIntakeTemperatureLabel,omitempty"`
	HasHotWaterBuffer               *bool    `json:"hasHotWaterBuffer,omitempty"`
}

type DeviceSettingsResponse struct {
	Success                         bool     `json:"success"`
	Error                           string   `json:"error,omitempty"`
	CompressorRpmMin                int      `json:"compressorRpmMin,omitempty"`
	CompressorRpmMax                int      `json:"compressorRpmMax,omitempty"`
	CompressorPowerCorrectionFactor *float64 `json:"compressorPowerCorrectionFactor,omitempty"`
	UseAirIntakeTemperatureLabel    *bool    `json:"useAirIntakeTemperatureLabel,omitempty"`
	HasHotWaterBuffer               *bool    `json:"hasHotWaterBuffer,omitempty"`
}

type DebugDeviceInfo struct {
	InstallationID   string    `json:"installationId"`
	InstallationDesc string    `json:"installationDesc"`
	GatewaySerial    string    `json:"gatewaySerial"`
	DeviceID         string    `json:"deviceId"`
	DeviceType       string    `json:"deviceType"`
	ModelID          string    `json:"modelId"`
	AccountName      string    `json:"accountName,omitempty"`
	Features         []Feature `json:"features,omitempty"`
	FeaturesError    string    `json:"featuresError,omitempty"`
}

type DebugDevicesResponse struct {
	TotalDevices     int               `json:"totalDevices"`
	UnknownDevices   int               `json:"unknownDevices"`
	Devices          []DebugDeviceInfo `json:"devices"`
	IncludesFeatures bool              `json:"includesFeatures"`
}

// TestAPIRequest represents a request to test an arbitrary Viessmann API endpoint
type TestAPIRequest struct {
	AccountID         string                 `json:"account_id,omitempty"`
	CustomCredentials *CustomCredentials     `json:"custom_credentials,omitempty"`
	Method            string                 `json:"method"`
	URL               string                 `json:"url"`
	Body              map[string]interface{} `json:"body,omitempty"`
}

// CustomCredentials for API testing with temporary authentication
type CustomCredentials struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

// TestAPIResponse represents the response from a test API request
type TestAPIResponse struct {
	Success    bool        `json:"success"`
	Error      string      `json:"error,omitempty"`
	StatusCode int         `json:"status_code,omitempty"`
	Response   interface{} `json:"response,omitempty"`
}

type HybridProControlRequest struct {
	AccountID      string                   `json:"accountId"`
	InstallationID string                   `json:"installationId"`
	DeviceID       string                   `json:"deviceId"`
	Settings       HybridProControlSettings `json:"settings"`
}

type HybridProControlResponse struct {
	Success  bool                      `json:"success"`
	Error    string                    `json:"error,omitempty"`
	Settings *HybridProControlSettings `json:"settings,omitempty"`
}
