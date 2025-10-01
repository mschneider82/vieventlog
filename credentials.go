package main

import (
	"encoding/json"
	"fmt"

	"github.com/zalando/go-keyring"
)

const (
	serviceName    = "vicare-event-viewer"
	credKey        = "credentials"
	accountsKey    = "accounts"        // New key for multiple accounts
	activeAcctsKey = "active-accounts" // New key for active account IDs
)

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

// SaveCredentials stores credentials securely in the system keyring
func SaveCredentials(creds Credentials) error {
	data, err := json.Marshal(creds)
	if err != nil {
		return fmt.Errorf("failed to marshal credentials: %w", err)
	}

	err = keyring.Set(serviceName, credKey, string(data))
	if err != nil {
		return fmt.Errorf("failed to save credentials to keyring: %w", err)
	}

	return nil
}

// LoadCredentials retrieves credentials from the system keyring
func LoadCredentials() (*Credentials, error) {
	data, err := keyring.Get(serviceName, credKey)
	if err != nil {
		if err == keyring.ErrNotFound {
			return nil, nil // No credentials stored
		}
		return nil, fmt.Errorf("failed to load credentials from keyring: %w", err)
	}

	var creds Credentials
	err = json.Unmarshal([]byte(data), &creds)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal credentials: %w", err)
	}

	return &creds, nil
}

// DeleteCredentials removes credentials from the system keyring
func DeleteCredentials() error {
	err := keyring.Delete(serviceName, credKey)
	if err != nil && err != keyring.ErrNotFound {
		return fmt.Errorf("failed to delete credentials from keyring: %w", err)
	}
	return nil
}

// HasStoredCredentials checks if credentials are stored
func HasStoredCredentials() bool {
	creds, err := LoadCredentials()
	return err == nil && creds != nil && creds.Email != ""
}

// --- New Multi-Account Functions ---

// LoadAccounts retrieves all accounts from the keyring
func LoadAccounts() (*AccountStore, error) {
	data, err := keyring.Get(serviceName, accountsKey)
	if err != nil {
		if err == keyring.ErrNotFound {
			// Try migrating old single credential
			oldCred, err := LoadCredentials()
			if err == nil && oldCred != nil && oldCred.Email != "" {
				// Migrate to new system
				store := &AccountStore{
					Accounts: make(map[string]*Account),
				}
				account := &Account{
					ID:           oldCred.Email,
					Name:         oldCred.Email,
					Email:        oldCred.Email,
					Password:     oldCred.Password,
					ClientID:     oldCred.ClientID,
					ClientSecret: oldCred.ClientSecret,
					Active:       true,
				}
				store.Accounts[account.ID] = account
				SaveAccounts(store)
				return store, nil
			}
			// No accounts stored
			return &AccountStore{Accounts: make(map[string]*Account)}, nil
		}
		return nil, fmt.Errorf("failed to load accounts from keyring: %w", err)
	}

	var store AccountStore
	err = json.Unmarshal([]byte(data), &store)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal accounts: %w", err)
	}

	if store.Accounts == nil {
		store.Accounts = make(map[string]*Account)
	}

	return &store, nil
}

// SaveAccounts stores all accounts in the keyring
func SaveAccounts(store *AccountStore) error {
	data, err := json.Marshal(store)
	if err != nil {
		return fmt.Errorf("failed to marshal accounts: %w", err)
	}

	err = keyring.Set(serviceName, accountsKey, string(data))
	if err != nil {
		return fmt.Errorf("failed to save accounts to keyring: %w", err)
	}

	return nil
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
