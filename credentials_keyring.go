//go:build !nokeyring

package main

import (
	"encoding/json"
	"fmt"

	"github.com/zalando/go-keyring"
)

// KeyringStorage implements credential storage using system keyring
type KeyringStorage struct{}

func (k *KeyringStorage) SaveCredentials(creds Credentials) error {
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

func (k *KeyringStorage) LoadCredentials() (*Credentials, error) {
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

func (k *KeyringStorage) DeleteCredentials() error {
	err := keyring.Delete(serviceName, credKey)
	if err != nil && err != keyring.ErrNotFound {
		return fmt.Errorf("failed to delete credentials from keyring: %w", err)
	}
	return nil
}

func (k *KeyringStorage) SaveAccounts(store *AccountStore) error {
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

func (k *KeyringStorage) LoadAccounts() (*AccountStore, error) {
	data, err := keyring.Get(serviceName, accountsKey)
	if err != nil {
		if err == keyring.ErrNotFound {
			// Try migrating old single credential
			oldCred, err := k.LoadCredentials()
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
				k.SaveAccounts(store)
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

func newCredentialStorage() CredentialStorage {
	return &KeyringStorage{}
}
