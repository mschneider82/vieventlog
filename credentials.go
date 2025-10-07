package main

import (
	"fmt"
)

const (
	serviceName    = "vicare-event-viewer"
	credKey        = "credentials"
	accountsKey    = "accounts"        // New key for multiple accounts
	activeAcctsKey = "active-accounts" // New key for active account IDs
)

// CredentialStorage is the interface for credential persistence
type CredentialStorage interface {
	SaveCredentials(creds Credentials) error
	LoadCredentials() (*Credentials, error)
	DeleteCredentials() error
	SaveAccounts(store *AccountStore) error
	LoadAccounts() (*AccountStore, error)
}

var storage CredentialStorage

func init() {
	storage = newCredentialStorage()
}

type Credentials struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

type DeviceSettings struct {
	CompressorRpmMin int `json:"compressorRpmMin,omitempty"`
	CompressorRpmMax int `json:"compressorRpmMax,omitempty"`
}

type RoomSettings struct {
	Name string `json:"name"` // User-defined room name (e.g., "Badezimmer", "Wohnzimmer")
}

type Account struct {
	ID             string                     `json:"id"`   // Unique identifier (email)
	Name           string                     `json:"name"` // User-friendly name
	Email          string                     `json:"email"`
	Password       string                     `json:"password"`
	ClientID       string                     `json:"clientId"`
	ClientSecret   string                     `json:"clientSecret"`
	Active         bool                       `json:"active"`                   // Whether this account is currently active
	DeviceSettings map[string]*DeviceSettings `json:"deviceSettings,omitempty"` // Key: "{installationId}_{deviceId}"
	RoomSettings   map[string]*RoomSettings   `json:"roomSettings,omitempty"`   // Key: "{installationId}:{roomId}"
}

type AccountStore struct {
	Accounts map[string]*Account `json:"accounts"` // Key is account ID
}

// SaveCredentials stores credentials using the configured storage backend
func SaveCredentials(creds Credentials) error {
	return storage.SaveCredentials(creds)
}

// LoadCredentials retrieves credentials from the configured storage backend
func LoadCredentials() (*Credentials, error) {
	return storage.LoadCredentials()
}

// DeleteCredentials removes credentials from the configured storage backend
func DeleteCredentials() error {
	return storage.DeleteCredentials()
}

// HasStoredCredentials checks if credentials are stored
func HasStoredCredentials() bool {
	creds, err := LoadCredentials()
	return err == nil && creds != nil && creds.Email != ""
}

// --- New Multi-Account Functions ---

// LoadAccounts retrieves all accounts from the configured storage backend
func LoadAccounts() (*AccountStore, error) {
	return storage.LoadAccounts()
}

// SaveAccounts stores all accounts using the configured storage backend
func SaveAccounts(store *AccountStore) error {
	return storage.SaveAccounts(store)
}

// AddAccount adds a new account to the store
func AddAccount(account *Account) error {
	store, err := LoadAccounts()
	if err != nil {
		return err
	}

	// Use email as ID if ID is not set
	if account.ID == "" {
		account.ID = account.Email
	}

	store.Accounts[account.ID] = account
	return SaveAccounts(store)
}

// DeleteAccount removes an account from the store
func DeleteAccount(accountID string) error {
	store, err := LoadAccounts()
	if err != nil {
		return err
	}

	delete(store.Accounts, accountID)
	return SaveAccounts(store)
}

// UpdateAccount updates an existing account
func UpdateAccount(account *Account) error {
	store, err := LoadAccounts()
	if err != nil {
		return err
	}

	if _, exists := store.Accounts[account.ID]; !exists {
		return fmt.Errorf("account %s not found", account.ID)
	}

	store.Accounts[account.ID] = account
	return SaveAccounts(store)
}

// GetAccount retrieves a specific account
func GetAccount(accountID string) (*Account, error) {
	store, err := LoadAccounts()
	if err != nil {
		return nil, err
	}

	account, exists := store.Accounts[accountID]
	if !exists {
		return nil, fmt.Errorf("account %s not found", accountID)
	}

	return account, nil
}

// GetActiveAccounts returns all accounts marked as active
func GetActiveAccounts() ([]*Account, error) {
	store, err := LoadAccounts()
	if err != nil {
		return nil, err
	}

	var activeAccounts []*Account
	for _, account := range store.Accounts {
		if account.Active {
			activeAccounts = append(activeAccounts, account)
		}
	}

	return activeAccounts, nil
}

// --- Device Settings Functions ---

// GetDeviceSettings retrieves settings for a specific device
func GetDeviceSettings(accountID, deviceKey string) (*DeviceSettings, error) {
	account, err := GetAccount(accountID)
	if err != nil {
		return nil, err
	}

	if account.DeviceSettings == nil {
		return nil, fmt.Errorf("no device settings found for device %s", deviceKey)
	}

	settings, exists := account.DeviceSettings[deviceKey]
	if !exists {
		return nil, fmt.Errorf("device settings not found for device %s", deviceKey)
	}

	return settings, nil
}

// SetDeviceSettings stores or updates settings for a specific device
func SetDeviceSettings(accountID, deviceKey string, settings *DeviceSettings) error {
	store, err := LoadAccounts()
	if err != nil {
		return err
	}

	account, exists := store.Accounts[accountID]
	if !exists {
		return fmt.Errorf("account %s not found", accountID)
	}

	if account.DeviceSettings == nil {
		account.DeviceSettings = make(map[string]*DeviceSettings)
	}

	account.DeviceSettings[deviceKey] = settings
	return SaveAccounts(store)
}

// DeleteDeviceSettings removes settings for a specific device
func DeleteDeviceSettings(accountID, deviceKey string) error {
	store, err := LoadAccounts()
	if err != nil {
		return err
	}

	account, exists := store.Accounts[accountID]
	if !exists {
		return fmt.Errorf("account %s not found", accountID)
	}

	if account.DeviceSettings != nil {
		delete(account.DeviceSettings, deviceKey)
		return SaveAccounts(store)
	}

	return nil
}

// SetAccountActive sets the active status of an account
func SetAccountActive(accountID string, active bool) error {
	store, err := LoadAccounts()
	if err != nil {
		return err
	}

	account, exists := store.Accounts[accountID]
	if !exists {
		return fmt.Errorf("account %s not found", accountID)
	}

	account.Active = active
	return SaveAccounts(store)
}
