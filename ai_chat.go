package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

const aiMaxToolRounds = 25

// aiSystemPrompt describes the assistant's role. Shared by the chat UI and MCP (as server instructions).
func aiSystemPrompt(settings *AISettings, allowWrite, autoApprove bool) string {
	now := time.Now()
	var sb strings.Builder
	sb.WriteString(`Du bist der ViEventLog-Assistent: ein Experte für Viessmann-Heizungsanlagen (Wärmepumpen, Gas-/Hybridheizungen, Thermostate, Lüftung) und Energieeffizienz.
Du beantwortest Fragen zu den Daten des Benutzers: Live-Werte aus der Viessmann-Cloud, die historische Temperatur-/Leistungsaufzeichnung und das Ereignisprotokoll in der SQLite-Datenbank von ViEventLog.

Arbeitsweise:
- Nutze die Tools, statt zu raten. Beginne mit list_devices, um IDs und den verfügbaren Datenzeitraum zu kennen. Rufe get_database_schema vor der ersten SQL-Abfrage auf.
- Rechne nie im Kopf: Nutze run_javascript (mit query(sql) für Daten) oder aggregiere in SQL. Zeige wichtige Zwischenergebnisse.
- Nenne Datengrundlage, Zeitraum und Annahmen. Unterscheide klar zwischen Messwerten und Schätzungen und gib bei Prognosen eine Spanne an.
- Taktung: Verdichterstarts pro Tag aus compressor_starts (Zählerdifferenz) oder aus Wechseln von compressor_active 0->1. Typische Stellschrauben: Heizkurve (Neigung/Niveau), Hysterese, Warmwasser-Soll und -Hysterese, Zeitprogramme, max. Vorlauftemperatur, Pufferspeicher.
- Energieschätzungen z.B. für Warmwasser: Energie der Warmwasserphasen aus der Historie bestimmen, Einfluss der Temperatur über Speicherverluste (proportional zur Temperaturdifferenz zur Umgebung) und COP-Änderung (ca. 2–3 % pro Kelvin Vorlauf) abschätzen.
- Antworte in der Sprache des Benutzers, prägnant, mit Markdown (Tabellen für Zahlen).
- Diagramme: Gib einen Codeblock mit Sprache "echarts" und einer gültigen ECharts-Option als reines JSON (keine Funktionen) aus, er wird im Chat gerendert. Nur verwenden, wenn ein Diagramm wirklich hilft.
`)
	if allowWrite && autoApprove {
		sb.WriteString(`- Einstellungen änderst du nur mit den set_*/start_*-Tools und nur, wenn der Benutzer es wünscht. Lies vorher den aktuellen Wert (get_live_features) und nenne alten und neuen Wert.
  Änderungen werden SOFORT ohne weitere Bestätigung ausgeführt. Wenn der Benutzer eine Änderung verlangt, führe sie direkt aus. Bei eigenen Empfehlungen frage immer vorher, ob du sie umsetzen sollst.
`)
	} else if allowWrite {
		sb.WriteString(`- Einstellungen änderst du nur mit den set_*/start_*-Tools und nur, wenn der Benutzer es wünscht. Lies vorher den aktuellen Wert (get_live_features) und nenne alten und neuen Wert.
  Wenn der Benutzer eine Änderung verlangt, rufe das Tool direkt auf, ohne im Chat nachzufragen: Jeder Aufruf wird dem Benutzer automatisch zur Bestätigung vorgelegt. Bei eigenen Empfehlungen frage vorher, ob du sie umsetzen sollst.
`)
	} else {
		sb.WriteString(`- Schreibzugriff ist deaktiviert: Gib Empfehlungen für Einstellungen, ändere aber nichts. Der Benutzer kann den Schreibzugriff in den Assistent-Einstellungen aktivieren.
`)
	}
	sb.WriteString(fmt.Sprintf("\nAktuelles Datum/Uhrzeit: %s (Zeitzone %s).\n", now.Format("Monday, 2006-01-02 15:04"), now.Location()))
	if settings != nil && strings.TrimSpace(settings.CustomPrompt) != "" {
		sb.WriteString("\nZusätzliche Hinweise des Benutzers:\n" + settings.CustomPrompt + "\n")
	}
	return sb.String()
}

// aiAvailableTools returns the tools for the given write permission
func aiAvailableTools(allowWrite bool) []aiTool {
	var out []aiTool
	for _, t := range aiTools() {
		if t.Write && !allowWrite {
			continue
		}
		out = append(out, t)
	}
	return out
}

func aiToolSpecs(tools []aiTool) []aiToolSpec {
	specs := make([]aiToolSpec, 0, len(tools))
	for _, t := range tools {
		var s aiToolSpec
		s.Type = "function"
		s.Function.Name = t.Name
		s.Function.Description = t.Description
		s.Function.Parameters = t.Parameters
		specs = append(specs, s)
	}
	return specs
}

type aiChatRequest struct {
	ConversationID string          `json:"conversationId"`
	ProviderID     string          `json:"providerId"`
	Model          string          `json:"model"`
	Messages       []aiMessage     `json:"messages"`      // Complete history without system prompt
	Confirmations  map[string]bool `json:"confirmations"` // tool_call_id -> approved, for pending write tools
}

// aiChatHandler handles POST /api/ai/chat and streams Server-Sent Events:
// delta {text}, message {message}, tool_result {id, name}, confirm {calls}, error {error}, done {conversationId, title}
func aiChatHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req aiChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request: "+err.Error(), http.StatusBadRequest)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	send := func(event string, data interface{}) {
		payload, _ := json.Marshal(data)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload)
		flusher.Flush()
	}
	fail := func(err error) {
		send("error", map[string]string{"error": err.Error()})
	}

	settings, err := GetAISettings()
	if err != nil {
		fail(err)
		return
	}
	providerID := req.ProviderID
	if providerID == "" {
		providerID = settings.DefaultProviderID
	}
	provider := settings.findProvider(providerID)
	if provider == nil && len(settings.Providers) > 0 {
		provider = &settings.Providers[0]
	}
	if provider == nil {
		fail(fmt.Errorf("kein KI-Anbieter konfiguriert – bitte in den Einstellungen anlegen"))
		return
	}
	model := req.Model
	if model == "" {
		model = settings.DefaultModel
	}
	if model == "" && len(provider.Models) > 0 {
		model = provider.Models[0]
	}
	if model == "" {
		fail(fmt.Errorf("kein Modell ausgewählt"))
		return
	}

	if req.ConversationID == "" {
		req.ConversationID = randomHex(12)
	}
	conv := &aiConversation{ID: req.ConversationID, Title: aiConversationTitle(req.Messages), ProviderID: provider.ID, Model: model}

	messages := req.Messages
	tools := aiAvailableTools(settings.AllowWrite)
	toolByName := map[string]*aiTool{}
	for i := range tools {
		toolByName[tools[i].Name] = &tools[i]
	}

	appendMessage := func(m aiMessage) {
		messages = append(messages, m)
		send("message", map[string]interface{}{"message": m})
	}
	finish := func() {
		conv.Messages = messages
		if settings.PersistChats {
			if err := aiSaveConversation(conv); err != nil {
				log.Printf("AI: failed to save conversation: %v", err)
			}
		}
		send("done", map[string]interface{}{"conversationId": conv.ID, "title": conv.Title, "persisted": settings.PersistChats})
	}

	// runToolCalls executes the tool calls of the last assistant message that have no result yet.
	// Returns the write calls that still need the user's confirmation.
	runToolCalls := func(ctx context.Context) []aiToolCall {
		lastAssistant := -1
		for i := len(messages) - 1; i >= 0; i-- {
			if messages[i].Role == "assistant" {
				lastAssistant = i
				break
			}
		}
		// A user message after the tool calls means they were abandoned (e.g. aborted stream)
		if lastAssistant < 0 || len(messages[lastAssistant].ToolCalls) == 0 || messages[len(messages)-1].Role == "user" {
			return nil
		}
		answered := map[string]bool{}
		for _, m := range messages[lastAssistant+1:] {
			if m.Role == "tool" {
				answered[m.ToolCallID] = true
			}
		}

		var pending []aiToolCall
		for _, call := range messages[lastAssistant].ToolCalls {
			if answered[call.ID] {
				continue
			}
			tool, ok := toolByName[call.Function.Name]
			var result string
			switch {
			case !ok:
				result = toJSON(map[string]string{"error": "Unbekanntes oder deaktiviertes Tool: " + call.Function.Name})
			case tool.Write && settings.AutoApproveWrite:
				log.Printf("AI: executing write tool %s without confirmation (auto-approve) %s", call.Function.Name, call.Function.Arguments)
				result = aiRunTool(ctx, tool, call.Function.Arguments)
			case tool.Write:
				approved, decided := req.Confirmations[call.ID]
				if !decided {
					pending = append(pending, call)
					continue
				}
				if !approved {
					result = toJSON(map[string]string{"error": "Der Benutzer hat diese Änderung abgelehnt."})
				} else {
					log.Printf("AI: executing confirmed write tool %s %s", call.Function.Name, call.Function.Arguments)
					result = aiRunTool(ctx, tool, call.Function.Arguments)
				}
			default:
				result = aiRunTool(ctx, tool, call.Function.Arguments)
			}
			appendMessage(aiMessage{Role: "tool", ToolCallID: call.ID, Name: call.Function.Name, Content: result})
		}
		return pending
	}

	ctx := r.Context()
	for round := 0; round < aiMaxToolRounds; round++ {
		if pending := runToolCalls(ctx); len(pending) > 0 {
			send("confirm", map[string]interface{}{"calls": pending})
			finish()
			return
		}
		if len(messages) > 0 && messages[len(messages)-1].Role == "assistant" && len(messages[len(messages)-1].ToolCalls) == 0 {
			break // Final answer reached
		}

		llmMessages := append([]aiMessage{{Role: "system", Content: aiSystemPrompt(settings, settings.AllowWrite, settings.AutoApproveWrite)}}, aiCloseOpenToolCalls(messages)...)
		reply, err := aiStreamChat(ctx, provider, model, llmMessages, aiToolSpecs(tools), func(text string) {
			send("delta", map[string]string{"text": text})
		})
		if err != nil {
			fail(err)
			finish()
			return
		}
		appendMessage(*reply)
	}
	finish()
}

// aiCloseOpenToolCalls adds a result for tool calls that never got one (aborted stream, abandoned confirmation),
// because the chat completions API rejects histories with unanswered tool calls.
func aiCloseOpenToolCalls(messages []aiMessage) []aiMessage {
	out := make([]aiMessage, 0, len(messages))
	for i := 0; i < len(messages); i++ {
		m := messages[i]
		out = append(out, m)
		if m.Role != "assistant" || len(m.ToolCalls) == 0 {
			continue
		}
		// Results directly follow their assistant message
		answered := map[string]bool{}
		for i+1 < len(messages) && messages[i+1].Role == "tool" {
			i++
			answered[messages[i].ToolCallID] = true
			out = append(out, messages[i])
		}
		for _, call := range m.ToolCalls {
			if !answered[call.ID] {
				out = append(out, aiMessage{Role: "tool", ToolCallID: call.ID, Name: call.Function.Name,
					Content: toJSON(map[string]string{"error": "Abgebrochen, nicht ausgeführt."})})
			}
		}
	}
	return out
}

func aiConversationTitle(messages []aiMessage) string {
	for _, m := range messages {
		if m.Role == "user" && strings.TrimSpace(m.Content) != "" {
			title := strings.Join(strings.Fields(m.Content), " ")
			if r := []rune(title); len(r) > 60 {
				title = string(r[:60]) + "…"
			}
			return title
		}
	}
	return "Neue Unterhaltung"
}

// aiToolsInfoHandler handles GET /api/ai/tools (for the UI: tool names and write flags)
func aiToolsInfoHandler(w http.ResponseWriter, r *http.Request) {
	type info struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Write       bool   `json:"write"`
	}
	out := []info{}
	for _, t := range aiTools() {
		out = append(out, info{t.Name, t.Description, t.Write})
	}
	writeJSON(w, out)
}
