//go:build !nokeyring

package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/zalando/go-keyring"
)

const (
	// chunkedPrefix marks a keyring value that does not hold the data itself but
	// references chunk entries. Format: "chunked:<generation>:<count>".
	chunkedPrefix = "chunked:"

	// keyringChunkSize is the length of one chunk (base64 characters).
	// Windows Credential Manager accepts at most 2560 bytes per entry, macOS
	// limits the whole `security` command (value base64-encoded again by
	// go-keyring) to 4096 bytes. 2000 stays below both limits.
	keyringChunkSize = 2000
)

// keyringBackend abstracts the system keyring (allows testing size limits).
type keyringBackend interface {
	Get(service, user string) (string, error)
	Set(service, user, password string) error
	Delete(service, user string) error
}

type systemKeyring struct{}

func (systemKeyring) Get(service, user string) (string, error) { return keyring.Get(service, user) }
func (systemKeyring) Set(service, user, password string) error {
	return keyring.Set(service, user, password)
}
func (systemKeyring) Delete(service, user string) error { return keyring.Delete(service, user) }

// KeyringStorage implements credential storage using system keyring
type KeyringStorage struct {
	mu sync.Mutex
	kr keyringBackend
}

func (k *KeyringStorage) SaveCredentials(creds Credentials) error {
	data, err := json.Marshal(creds)
	if err != nil {
		return fmt.Errorf("failed to marshal credentials: %w", err)
	}

	err = k.kr.Set(serviceName, credKey, string(data))
	if err != nil {
		return fmt.Errorf("failed to save credentials to keyring: %w", err)
	}

	return nil
}

func (k *KeyringStorage) LoadCredentials() (*Credentials, error) {
	data, err := k.kr.Get(serviceName, credKey)
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
	err := k.kr.Delete(serviceName, credKey)
	if err != nil && err != keyring.ErrNotFound {
		return fmt.Errorf("failed to delete credentials from keyring: %w", err)
	}
	return nil
}

func (k *KeyringStorage) SaveAccounts(store *AccountStore) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.saveAccounts(store)
}

func (k *KeyringStorage) saveAccounts(store *AccountStore) error {
	data, err := json.Marshal(store)
	if err != nil {
		return fmt.Errorf("failed to marshal accounts: %w", err)
	}

	if err := k.setLarge(accountsKey, string(data)); err != nil {
		return fmt.Errorf("failed to save accounts to keyring: %w", err)
	}

	return nil
}

func (k *KeyringStorage) LoadAccounts() (*AccountStore, error) {
	k.mu.Lock()
	defer k.mu.Unlock()

	data, err := k.getLarge(accountsKey)
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
				k.saveAccounts(store)
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

// setLarge stores value under key. If the keyring rejects the value as too big
// (Windows: 2560 bytes, macOS: ~4 KB), it is split into several entries and
// key only holds a header referencing them.
func (k *KeyringStorage) setLarge(key, value string) error {
	oldChunks := k.currentChunkKeys(key)

	err := k.kr.Set(serviceName, key, value)
	if err == nil {
		k.deleteKeys(oldChunks)
		return nil
	}
	if !errors.Is(err, keyring.ErrSetDataTooBig) {
		return err
	}

	// Write the chunks under a new generation first and switch the header
	// afterwards, so the previously stored data stays readable until the end.
	encoded := base64.StdEncoding.EncodeToString([]byte(value))
	gen := newChunkGeneration()
	var written []string
	for start := 0; start < len(encoded); start += keyringChunkSize {
		end := min(start+keyringChunkSize, len(encoded))
		ck := chunkKey(key, gen, len(written))
		if err := k.kr.Set(serviceName, ck, encoded[start:end]); err != nil {
			k.deleteKeys(written)
			return fmt.Errorf("failed to write keyring chunk %d: %w", len(written)+1, err)
		}
		written = append(written, ck)
	}

	header := chunkedPrefix + gen + ":" + strconv.Itoa(len(written))
	if err := k.kr.Set(serviceName, key, header); err != nil {
		k.deleteKeys(written)
		return err
	}

	k.deleteKeys(without(oldChunks, written))
	return nil
}

// getLarge reads a value written by setLarge (single entry or chunked).
func (k *KeyringStorage) getLarge(key string) (string, error) {
	value, err := k.kr.Get(serviceName, key)
	if err != nil {
		return "", err
	}

	gen, count, ok := parseChunkHeader(value)
	if !ok {
		return value, nil
	}

	var sb strings.Builder
	for i := range count {
		part, err := k.kr.Get(serviceName, chunkKey(key, gen, i))
		if err != nil {
			// Deliberately not wrapped: a missing chunk must not look like
			// "no accounts stored" (ErrNotFound) to the caller.
			return "", fmt.Errorf("failed to read keyring chunk %d/%d: %v", i+1, count, err)
		}
		sb.WriteString(part)
	}

	decoded, err := base64.StdEncoding.DecodeString(sb.String())
	if err != nil {
		return "", fmt.Errorf("failed to decode chunked keyring data: %v", err)
	}
	return string(decoded), nil
}

// currentChunkKeys returns the chunk entries currently referenced by key.
func (k *KeyringStorage) currentChunkKeys(key string) []string {
	value, err := k.kr.Get(serviceName, key)
	if err != nil {
		return nil
	}
	gen, count, ok := parseChunkHeader(value)
	if !ok {
		return nil
	}
	keys := make([]string, count)
	for i := range keys {
		keys[i] = chunkKey(key, gen, i)
	}
	return keys
}

func (k *KeyringStorage) deleteKeys(keys []string) {
	for _, key := range keys {
		_ = k.kr.Delete(serviceName, key)
	}
}

// without returns keys that are not contained in exclude.
func without(keys, exclude []string) []string {
	var result []string
	for _, key := range keys {
		if !slices.Contains(exclude, key) {
			result = append(result, key)
		}
	}
	return result
}

func newChunkGeneration() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func chunkKey(key, gen string, index int) string {
	return fmt.Sprintf("%s.%s.%d", key, gen, index)
}

func parseChunkHeader(value string) (gen string, count int, ok bool) {
	rest, found := strings.CutPrefix(value, chunkedPrefix)
	if !found {
		return "", 0, false
	}
	gen, countStr, found := strings.Cut(rest, ":")
	if !found || gen == "" {
		return "", 0, false
	}
	count, err := strconv.Atoi(countStr)
	if err != nil || count <= 0 {
		return "", 0, false
	}
	return gen, count, true
}

func newCredentialStorage() CredentialStorage {
	return &KeyringStorage{kr: systemKeyring{}}
}
