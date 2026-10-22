package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	aiReadDB     *sql.DB
	aiReadDBPath string
	aiReadDBMu   sync.Mutex
)

// aiDatabasePath returns the path of the event/temperature database
func aiDatabasePath() (string, error) {
	settings, err := GetEventArchiveSettings()
	if err != nil {
		return "", err
	}
	return settings.DatabasePath, nil
}

// aiEnsureDatabase makes sure the main database is open (it is otherwise only opened by the schedulers)
// and that the AI tables exist.
func aiEnsureDatabase() error {
	dbMutex.RLock()
	initialized := dbInitialized && eventDB != nil
	dbMutex.RUnlock()

	if !initialized {
		path, err := aiDatabasePath()
		if err != nil {
			return err
		}
		if err := InitEventDatabase(path); err != nil {
			return err
		}
	}

	_, err := eventDB.Exec(`
	CREATE TABLE IF NOT EXISTS ai_conversations (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		provider_id TEXT,
		model TEXT,
		messages TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated ON ai_conversations(updated_at);
	`)
	return err
}

// aiReadOnlyDB returns a separate read-only connection used for queries issued by the AI.
// query_only makes SQLite reject any write, independent of the SQL the model generates.
func aiReadOnlyDB() (*sql.DB, error) {
	path, err := aiDatabasePath()
	if err != nil {
		return nil, err
	}
	if err := aiEnsureDatabase(); err != nil {
		return nil, err
	}

	aiReadDBMu.Lock()
	defer aiReadDBMu.Unlock()
	if aiReadDB != nil && aiReadDBPath == path {
		return aiReadDB, nil
	}
	if aiReadDB != nil {
		aiReadDB.Close()
	}

	dsn := "file:" + strings.NewReplacer("%", "%25", "?", "%3f", "#", "%23").Replace(path) + "?mode=ro&_pragma=query_only(1)&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(2)
	aiReadDB = db
	aiReadDBPath = path
	return db, nil
}

var aiForbiddenSQL = regexp.MustCompile(`(?i)\b(attach|detach|load_extension|vacuum)\b`)

// aiQueryRows runs a read-only query and returns column names and rows (at most maxRows)
func aiQueryRows(ctx context.Context, query string, maxRows int) ([]string, [][]interface{}, bool, error) {
	if aiForbiddenSQL.MatchString(query) {
		return nil, nil, false, fmt.Errorf("ATTACH/DETACH/load_extension/VACUUM sind nicht erlaubt")
	}
	db, err := aiReadOnlyDB()
	if err != nil {
		return nil, nil, false, err
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, nil, false, err
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, nil, false, err
	}

	result := make([][]interface{}, 0)
	truncated := false
	for rows.Next() {
		if len(result) >= maxRows {
			truncated = true
			break
		}
		values := make([]interface{}, len(columns))
		ptrs := make([]interface{}, len(columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, false, err
		}
		for i, v := range values {
			if b, ok := v.([]byte); ok {
				values[i] = string(b)
			}
		}
		result = append(result, values)
	}
	return columns, result, truncated, rows.Err()
}

// --- Conversation persistence ---

type aiConversation struct {
	ID         string      `json:"id"`
	Title      string      `json:"title"`
	ProviderID string      `json:"providerId"`
	Model      string      `json:"model"`
	Messages   []aiMessage `json:"messages,omitempty"`
	CreatedAt  string      `json:"createdAt"`
	UpdatedAt  string      `json:"updatedAt"`
}

func aiSaveConversation(conv *aiConversation) error {
	if err := aiEnsureDatabase(); err != nil {
		return err
	}
	data, err := json.Marshal(conv.Messages)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = eventDB.Exec(`
		INSERT INTO ai_conversations (id, title, provider_id, model, messages, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET provider_id = excluded.provider_id, model = excluded.model,
			messages = excluded.messages, updated_at = excluded.updated_at`,
		conv.ID, conv.Title, conv.ProviderID, conv.Model, string(data), now, now)
	return err
}

// aiConversationsHandler handles GET /api/ai/conversations
func aiConversationsHandler(w http.ResponseWriter, r *http.Request) {
	if err := aiEnsureDatabase(); err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	rows, err := eventDB.Query(`SELECT id, title, provider_id, model, created_at, updated_at
		FROM ai_conversations ORDER BY updated_at DESC LIMIT 200`)
	if err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	defer rows.Close()

	conversations := make([]aiConversation, 0)
	for rows.Next() {
		var c aiConversation
		var providerID, model sql.NullString
		if err := rows.Scan(&c.ID, &c.Title, &providerID, &model, &c.CreatedAt, &c.UpdatedAt); err != nil {
			continue
		}
		c.ProviderID, c.Model = providerID.String, model.String
		conversations = append(conversations, c)
	}
	writeJSON(w, map[string]interface{}{"success": true, "conversations": conversations})
}

// aiConversationGetHandler handles GET /api/ai/conversations/get?id=...
func aiConversationGetHandler(w http.ResponseWriter, r *http.Request) {
	if err := aiEnsureDatabase(); err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	var c aiConversation
	var providerID, model sql.NullString
	var messages string
	err := eventDB.QueryRow(`SELECT id, title, provider_id, model, messages, created_at, updated_at
		FROM ai_conversations WHERE id = ?`, r.URL.Query().Get("id")).
		Scan(&c.ID, &c.Title, &providerID, &model, &messages, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": "Unterhaltung nicht gefunden"})
		return
	}
	c.ProviderID, c.Model = providerID.String, model.String
	json.Unmarshal([]byte(messages), &c.Messages)
	writeJSON(w, map[string]interface{}{"success": true, "conversation": c})
}

// aiConversationDeleteHandler handles POST /api/ai/conversations/delete {"id": "..."}
func aiConversationDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	if err := aiEnsureDatabase(); err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	if _, err := eventDB.Exec(`DELETE FROM ai_conversations WHERE id = ?`, req.ID); err != nil {
		writeJSON(w, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"success": true})
}
