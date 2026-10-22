package main

import (
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

// MCP server (Streamable HTTP transport, JSON responses only) exposing the assistant tools
// to external clients like Claude Desktop/Claude Code. Enabled and secured via AI settings (Bearer token).

const mcpDefaultProtocolVersion = "2025-06-18"

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func mcpHandler(w http.ResponseWriter, r *http.Request) {
	settings, err := GetAISettings()
	if err != nil || !settings.MCPEnabled || settings.MCPToken == "" {
		http.NotFound(w, r)
		return
	}

	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(token), []byte(settings.MCPToken)) != 1 {
		w.Header().Set("WWW-Authenticate", `Bearer realm="ViEventLog MCP"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodPost:
	case http.MethodDelete:
		w.WriteHeader(http.StatusOK) // Stateless server: nothing to terminate
		return
	default:
		// No server-initiated SSE stream
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req mcpRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, map[string]interface{}{"jsonrpc": "2.0", "id": nil, "error": mcpError{-32700, "Parse error: " + err.Error()}})
		return
	}

	// Notifications (no id) are acknowledged without a body
	if len(req.ID) == 0 || string(req.ID) == "null" {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	result, rpcErr := mcpDispatch(r, settings, &req)
	resp := map[string]interface{}{"jsonrpc": "2.0", "id": req.ID}
	if rpcErr != nil {
		resp["error"] = rpcErr
	} else {
		resp["result"] = result
	}
	writeJSON(w, resp)
}

func mcpDispatch(r *http.Request, settings *AISettings, req *mcpRequest) (interface{}, *mcpError) {
	switch req.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		json.Unmarshal(req.Params, &params)
		protocolVersion := params.ProtocolVersion
		if protocolVersion == "" {
			protocolVersion = mcpDefaultProtocolVersion
		}
		return map[string]interface{}{
			"protocolVersion": protocolVersion,
			"capabilities":    map[string]interface{}{"tools": map[string]interface{}{"listChanged": false}},
			"serverInfo":      map[string]interface{}{"name": "vieventlog", "title": "ViEventLog", "version": version},
			"instructions":    aiSystemPrompt(settings, settings.MCPAllowWrite, true),
		}, nil

	case "ping":
		return map[string]interface{}{}, nil

	case "tools/list":
		tools := []map[string]interface{}{}
		for _, t := range aiAvailableTools(settings.MCPAllowWrite) {
			tools = append(tools, map[string]interface{}{
				"name":        t.Name,
				"description": t.Description,
				"inputSchema": t.Parameters,
				"annotations": map[string]interface{}{"readOnlyHint": !t.Write, "destructiveHint": t.Write},
			})
		}
		return map[string]interface{}{"tools": tools}, nil

	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, &mcpError{-32602, "Invalid params: " + err.Error()}
		}
		var tool *aiTool
		for _, t := range aiAvailableTools(settings.MCPAllowWrite) {
			if t.Name == params.Name {
				t := t
				tool = &t
				break
			}
		}
		if tool == nil {
			return nil, &mcpError{-32602, "Unknown tool: " + params.Name}
		}
		if tool.Write {
			log.Printf("MCP: executing write tool %s %s", tool.Name, string(params.Arguments))
		}
		result := aiRunTool(r.Context(), tool, string(params.Arguments))
		isError := strings.HasPrefix(result, `{"error":`)
		return map[string]interface{}{
			"content": []map[string]interface{}{{"type": "text", "text": result}},
			"isError": isError,
		}, nil

	case "resources/list":
		return map[string]interface{}{"resources": []interface{}{}}, nil
	case "prompts/list":
		return map[string]interface{}{"prompts": []interface{}{}}, nil
	}
	return nil, &mcpError{-32601, "Method not found: " + req.Method}
}
