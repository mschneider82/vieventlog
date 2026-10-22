package main

import "testing"

func TestAiCloseOpenToolCalls(t *testing.T) {
	call := func(id string) aiToolCall {
		c := aiToolCall{ID: id, Type: "function"}
		c.Function.Name = "query_database"
		return c
	}
	messages := []aiMessage{
		{Role: "user", Content: "frage"},
		{Role: "assistant", ToolCalls: []aiToolCall{call("a"), call("b")}},
		{Role: "tool", ToolCallID: "a", Content: "ok"},
		{Role: "user", Content: "neue frage"},
	}

	out := aiCloseOpenToolCalls(messages)

	wantRoles := []string{"user", "assistant", "tool", "tool", "user"}
	if len(out) != len(wantRoles) {
		t.Fatalf("got %d messages, want %d", len(out), len(wantRoles))
	}
	for i, role := range wantRoles {
		if out[i].Role != role {
			t.Errorf("message %d: role %q, want %q", i, out[i].Role, role)
		}
	}
	if out[3].ToolCallID != "b" {
		t.Errorf("synthetic result for %q, want b", out[3].ToolCallID)
	}
	if len(messages) != 4 {
		t.Errorf("input modified")
	}
}
