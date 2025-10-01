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

type Account struct {
	ID           string `json:"id"`   // Unique identifier (email)
	Name         string `json:"name"` // User-friendly name
	Email        string `json:"email"`
	Password     string `json:"password"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	Active       bool   `json:"active"` // Whether this account is currently active
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
