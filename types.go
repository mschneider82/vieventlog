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
	ElectricityPrice                *float64 `json:"electricityPrice,omitempty"`
	UseAirIntakeTemperatureLabel    *bool    `json:"useAirIntakeTemperatureLabel,omitempty"`
	HasHotWaterBuffer               *bool    `json:"hasHotWaterBuffer,omitempty"`
}

type DeviceSettingsResponse struct {
	Success                         bool     `json:"success"`
	Error                           string   `json:"error,omitempty"`
	CompressorRpmMin                int      `json:"compressorRpmMin,omitempty"`
	CompressorRpmMax                int      `json:"compressorRpmMax,omitempty"`
	CompressorPowerCorrectionFactor *float64 `json:"compressorPowerCorrectionFactor,omitempty"`
	ElectricityPrice                *float64 `json:"electricityPrice,omitempty"`
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

// TemperatureSnapshot represents a single snapshot of all temperature and sensor data
type TemperatureSnapshot struct {
	Timestamp      time.Time `json:"timestamp"`
	InstallationID string    `json:"installation_id"`
	GatewayID      string    `json:"gateway_id"`
	DeviceID       string    `json:"device_id"`
	AccountID      string    `json:"account_id"`
	AccountName    string    `json:"account_name"`

	// Temperature sensors
	OutsideTemp           *float64 `json:"outside_temp,omitempty"`
	ReturnTemp            *float64 `json:"return_temp,omitempty"`
	SupplyTemp            *float64 `json:"supply_temp,omitempty"`
	PrimarySupplyTemp     *float64 `json:"primary_supply_temp,omitempty"`
	SecondarySupplyTemp   *float64 `json:"secondary_supply_temp,omitempty"`
	PrimaryReturnTemp     *float64 `json:"primary_return_temp,omitempty"`
	SecondaryReturnTemp   *float64 `json:"secondary_return_temp,omitempty"`
	DHWTemp               *float64 `json:"dhw_temp,omitempty"`
	DHWCylinderMiddleTemp *float64 `json:"dhw_cylinder_middle_temp,omitempty"`
	BoilerTemp            *float64 `json:"boiler_temp,omitempty"`
	BufferTemp            *float64 `json:"buffer_temp,omitempty"`
	BufferTempTop         *float64 `json:"buffer_temp_top,omitempty"`
	CalculatedOutsideTemp *float64 `json:"calculated_outside_temp,omitempty"`

	// Compressor data
	CompressorActive     *bool    `json:"compressor_active,omitempty"`
	CompressorSpeed      *float64 `json:"compressor_speed,omitempty"`
	CompressorCurrent    *float64 `json:"compressor_current,omitempty"`
	CompressorPressure   *float64 `json:"compressor_pressure,omitempty"`
	CompressorOilTemp    *float64 `json:"compressor_oil_temp,omitempty"`
	CompressorMotorTemp  *float64 `json:"compressor_motor_temp,omitempty"`
	CompressorInletTemp  *float64 `json:"compressor_inlet_temp,omitempty"`
	CompressorOutletTemp *float64 `json:"compressor_outlet_temp,omitempty"`
	CompressorHours      *float64 `json:"compressor_hours,omitempty"`
	CompressorPower      *float64 `json:"compressor_power,omitempty"`

	// Pump status
	CirculationPumpActive *bool `json:"circulation_pump_active,omitempty"`
	DHWPumpActive         *bool `json:"dhw_pump_active,omitempty"`
	InternalPumpActive    *bool `json:"internal_pump_active,omitempty"`

	// Flow/Energy
	VolumetricFlow *float64 `json:"volumetric_flow,omitempty"`
	ThermalPower   *float64 `json:"thermal_power,omitempty"`
	COP            *float64 `json:"cop,omitempty"`

	// Operating state
	FourWayValve                 *string  `json:"four_way_valve,omitempty"`
	BurnerModulation             *float64 `json:"burner_modulation,omitempty"`
	SecondaryHeatGeneratorStatus *string  `json:"secondary_heat_generator_status,omitempty"`
}

// TemperatureLogSettings holds configuration for temperature logging
type TemperatureLogSettings struct {
	Enabled        bool   `json:"enabled"`
	SampleInterval int    `json:"sample_interval"` // Minutes between samples
	RetentionDays  int    `json:"retention_days"`  // How long to keep data
	DatabasePath   string `json:"database_path"`   // SQLite database path
}

// TemperatureLogStatsResponse provides statistics about temperature logging
type TemperatureLogStatsResponse struct {
	Enabled          bool   `json:"enabled"`
	SchedulerRunning bool   `json:"scheduler_running"`
	TotalSnapshots   int64  `json:"total_snapshots"`
	SampleInterval   int    `json:"sample_interval"`
	RetentionDays    int    `json:"retention_days"`
	DatabasePath     string `json:"database_path"`
	APIUsage10Min    int    `json:"api_usage_10min"`
	APIUsage24Hr     int    `json:"api_usage_24hr"`
	APILimit10Min    int    `json:"api_limit_10min"`
	APILimit24Hr     int    `json:"api_limit_24hr"`
}

// ConsumptionStats represents aggregated consumption statistics for a time period
type ConsumptionStats struct {
	Period          string                 `json:"period"` // "hour", "day", "week", "month", "year"
	StartTime       time.Time              `json:"start_time"`
	EndTime         time.Time              `json:"end_time"`
	ElectricityKWh  float64                `json:"electricity_kwh"` // Total electrical energy consumed
	ThermalKWh      float64                `json:"thermal_kwh"`     // Total thermal energy produced
	AvgCOP          float64                `json:"avg_cop"`         // Average coefficient of performance
	RuntimeHours    float64                `json:"runtime_hours"`   // Hours compressor was active
	Samples         int                    `json:"samples"`         // Number of snapshots
	HourlyBreakdown []ConsumptionDataPoint `json:"hourly_breakdown,omitempty"`
	DailyBreakdown  []ConsumptionDataPoint `json:"daily_breakdown,omitempty"`
}

// ConsumptionDataPoint represents a single data point in consumption breakdown
type ConsumptionDataPoint struct {
	Timestamp      time.Time `json:"timestamp"`
	ElectricityKWh float64   `json:"electricity_kwh"`
	ThermalKWh     float64   `json:"thermal_kwh"`
	AvgCOP         float64   `json:"avg_cop"`
	RuntimeHours   float64   `json:"runtime_hours"`
	Samples        int       `json:"samples"`
}

// ConsumptionComparisonResponse provides comparative consumption statistics
type ConsumptionComparisonResponse struct {
	Current       ConsumptionStats `json:"current"`
	Previous      ConsumptionStats `json:"previous"`
	PercentChange float64          `json:"percent_change"`
}
