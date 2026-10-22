package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// aiMessage is a chat message in OpenAI chat completions format
type aiMessage struct {
	Role       string       `json:"role"` // system, user, assistant, tool
	Content    string       `json:"content"`
	ToolCalls  []aiToolCall `json:"tool_calls,omitempty"`
	ToolCallID string       `json:"tool_call_id,omitempty"`
	Name       string       `json:"name,omitempty"`
}

type aiToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type aiToolSpec struct {
	Type     string `json:"type"`
	Function struct {
		Name        string                 `json:"name"`
		Description string                 `json:"description"`
		Parameters  map[string]interface{} `json:"parameters"`
	} `json:"function"`
}

// aiStreamChat calls the chat completions endpoint with streaming and returns the complete assistant message.
// onDelta is called for every content chunk.
func aiStreamChat(ctx context.Context, provider *AIProvider, model string, messages []aiMessage, tools []aiToolSpec, onDelta func(string)) (*aiMessage, error) {
	body := map[string]interface{}{
		"model":    model,
		"messages": messages,
		"stream":   true,
	}
	if len(tools) > 0 {
		body["tools"] = tools
	}
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, provider.BaseURL+"/chat/completions", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if provider.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+provider.APIKey)
	}
	// Attribution headers for OpenRouter, ignored by other providers
	req.Header.Set("HTTP-Referer", "https://github.com/mschneider82/vieventlog")
	req.Header.Set("X-Title", "ViEventLog")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("LLM API Status %d: %s", resp.StatusCode, truncateString(string(errBody), 1000))
	}

	// Non-streaming fallback: some servers ignore stream=true
	if !strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		var result struct {
			Choices []struct {
				Message aiMessage `json:"message"`
			} `json:"choices"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			return nil, fmt.Errorf("unerwartete LLM-Antwort: %w", err)
		}
		if len(result.Choices) == 0 {
			return nil, fmt.Errorf("LLM-Antwort ohne choices")
		}
		msg := result.Choices[0].Message
		msg.Role = "assistant"
		if msg.Content != "" {
			onDelta(msg.Content)
		}
		return &msg, nil
	}

	msg := &aiMessage{Role: "assistant"}
	var content strings.Builder
	toolCalls := map[int]*aiToolCall{}
	maxIndex := -1

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "[DONE]" {
			break
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Type     string `json:"type"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			continue // e.g. OpenRouter keep-alive comments
		}
		if chunk.Error != nil {
			return nil, fmt.Errorf("LLM-Fehler: %s", chunk.Error.Message)
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		delta := chunk.Choices[0].Delta
		if delta.Content != "" {
			content.WriteString(delta.Content)
			onDelta(delta.Content)
		}
		for _, tc := range delta.ToolCalls {
			call, ok := toolCalls[tc.Index]
			if !ok {
				call = &aiToolCall{Type: "function"}
				toolCalls[tc.Index] = call
				if tc.Index > maxIndex {
					maxIndex = tc.Index
				}
			}
			if tc.ID != "" {
				call.ID = tc.ID
			}
			if tc.Function.Name != "" {
				call.Function.Name += tc.Function.Name
			}
			call.Function.Arguments += tc.Function.Arguments
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	msg.Content = content.String()
	for i := 0; i <= maxIndex; i++ {
		call, ok := toolCalls[i]
		if !ok || call.Function.Name == "" {
			continue
		}
		if call.ID == "" {
			call.ID = "call_" + randomHex(8)
		}
		if strings.TrimSpace(call.Function.Arguments) == "" {
			call.Function.Arguments = "{}"
		}
		msg.ToolCalls = append(msg.ToolCalls, *call)
	}
	return msg, nil
}
