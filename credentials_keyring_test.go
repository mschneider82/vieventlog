//go:build !nokeyring

package main

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

// limitedKeyring emulates a keyring with a per-entry size limit
// (Windows Credential Manager: 2560 bytes).
type limitedKeyring struct {
	limit   int
	entries map[string]string
}

func newLimitedKeyring(limit int) *limitedKeyring {
	return &limitedKeyring{limit: limit, entries: map[string]string{}}
}

func (l *limitedKeyring) Get(service, user string) (string, error) {
	v, ok := l.entries[service+"/"+user]
	if !ok {
		return "", keyring.ErrNotFound
	}
	return v, nil
}

func (l *limitedKeyring) Set(service, user, password string) error {
	if len(password) > l.limit {
		return keyring.ErrSetDataTooBig
	}
	l.entries[service+"/"+user] = password
	return nil
}

func (l *limitedKeyring) Delete(service, user string) error {
	if _, ok := l.entries[service+"/"+user]; !ok {
		return keyring.ErrNotFound
	}
	delete(l.entries, service+"/"+user)
	return nil
}

func (l *limitedKeyring) chunkEntries() []string {
	var keys []string
	for k := range l.entries {
		if strings.HasPrefix(k, serviceName+"/"+accountsKey+".") {
			keys = append(keys, k)
		}
	}
	return keys
}

func testAccountStore(rooms int, prompt string) *AccountStore {
	account := &Account{
		ID:           "user@example.com",
		Name:         "Haus",
		Email:        "user@example.com",
		Password:     "geheim'\"pass",
		ClientID:     "0123456789abcdef0123456789abcdef",
		ClientSecret: defaultClientSecret,
		Active:       true,
		RoomSettings: map[string]*RoomSettings{},
	}
	for i := range rooms {
		account.RoomSettings[fmt.Sprintf("1234567:%d", i)] = &RoomSettings{Name: fmt.Sprintf("Raum Nr. %d – Wohnküche", i)}
	}
	return &AccountStore{
		Accounts: map[string]*Account{account.ID: account},
		AISettings: &AISettings{
			Providers:    []AIProvider{{ID: "or", Name: "OpenRouter", BaseURL: "https://openrouter.ai/api/v1", APIKey: "sk-or-v1-" + strings.Repeat("a", 64), Models: []string{"some/model"}}},
			CustomPrompt: prompt,
			MCPToken:     strings.Repeat("f", 64),
		},
	}
}

func TestKeyringStorageSmallStoreSingleEntry(t *testing.T) {
	kr := newLimitedKeyring(2560)
	s := &KeyringStorage{kr: kr}

	store := testAccountStore(2, "")
	if err := s.SaveAccounts(store); err != nil {
		t.Fatalf("SaveAccounts: %v", err)
	}
	if chunks := kr.chunkEntries(); len(chunks) != 0 {
		t.Fatalf("expected no chunk entries, got %v", chunks)
	}

	loaded, err := s.LoadAccounts()
	if err != nil {
		t.Fatalf("LoadAccounts: %v", err)
	}
	if !reflect.DeepEqual(store, loaded) {
		t.Fatalf("loaded store differs from saved store")
	}
}

func TestKeyringStorageLargeStoreIsChunked(t *testing.T) {
	kr := newLimitedKeyring(2560)
	s := &KeyringStorage{kr: kr}

	// 40 rooms plus a long prompt with quotes/umlauts: far above 2560 bytes
	store := testAccountStore(40, strings.Repeat("Bitte 'immer' auf Deutsch antworten, Grüße. ", 60))
	if err := s.SaveAccounts(store); err != nil {
		t.Fatalf("SaveAccounts: %v", err)
	}

	chunks := kr.chunkEntries()
	if len(chunks) < 2 {
		t.Fatalf("expected several chunk entries, got %d", len(chunks))
	}
	for k, v := range kr.entries {
		if len(v) > 2560 {
			t.Fatalf("entry %s exceeds limit: %d bytes", k, len(v))
		}
	}

	loaded, err := s.LoadAccounts()
	if err != nil {
		t.Fatalf("LoadAccounts: %v", err)
	}
	if !reflect.DeepEqual(store, loaded) {
		t.Fatalf("loaded store differs from saved store")
	}

	// Saving a large store again replaces the old chunk generation
	store.Accounts["user@example.com"].RoomSettings["1234567:0"].Name = "Bad"
	if err := s.SaveAccounts(store); err != nil {
		t.Fatalf("SaveAccounts (2nd): %v", err)
	}
	if got := len(kr.chunkEntries()); got != len(chunks) {
		t.Fatalf("expected %d chunk entries after re-save, got %d (stale chunks left?)", len(chunks), got)
	}
	loaded, err = s.LoadAccounts()
	if err != nil {
		t.Fatalf("LoadAccounts (2nd): %v", err)
	}
	if loaded.Accounts["user@example.com"].RoomSettings["1234567:0"].Name != "Bad" {
		t.Fatalf("updated room name not loaded")
	}

	// Shrinking back to a single entry removes all chunks
	if err := s.SaveAccounts(testAccountStore(1, "")); err != nil {
		t.Fatalf("SaveAccounts (small): %v", err)
	}
	if chunks := kr.chunkEntries(); len(chunks) != 0 {
		t.Fatalf("expected chunk entries to be removed, got %v", chunks)
	}
	loaded, err = s.LoadAccounts()
	if err != nil {
		t.Fatalf("LoadAccounts (small): %v", err)
	}
	if len(loaded.Accounts["user@example.com"].RoomSettings) != 1 {
		t.Fatalf("expected 1 room after shrinking, got %d", len(loaded.Accounts["user@example.com"].RoomSettings))
	}
}

func TestKeyringStorageMissingChunkIsError(t *testing.T) {
	kr := newLimitedKeyring(2560)
	s := &KeyringStorage{kr: kr}

	if err := s.SaveAccounts(testAccountStore(60, "")); err != nil {
		t.Fatalf("SaveAccounts: %v", err)
	}
	chunks := kr.chunkEntries()
	if len(chunks) == 0 {
		t.Fatalf("expected chunk entries")
	}
	delete(kr.entries, chunks[0])

	// Must fail instead of returning an empty store, otherwise the next save
	// would wipe all accounts.
	if _, err := s.LoadAccounts(); err == nil {
		t.Fatalf("expected error for missing chunk")
	}
}

func TestKeyringStorageLegacySingleEntryStillReadable(t *testing.T) {
	kr := newLimitedKeyring(2560)
	kr.entries[serviceName+"/"+accountsKey] = `{"accounts":{"a@b.de":{"id":"a@b.de","name":"A","email":"a@b.de","password":"x","clientId":"c","clientSecret":"s","active":true}}}`
	s := &KeyringStorage{kr: kr}

	loaded, err := s.LoadAccounts()
	if err != nil {
		t.Fatalf("LoadAccounts: %v", err)
	}
	if loaded.Accounts["a@b.de"] == nil || loaded.Accounts["a@b.de"].Password != "x" {
		t.Fatalf("legacy entry not loaded correctly: %+v", loaded.Accounts)
	}
}
