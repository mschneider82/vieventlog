// ViEventLog KI-Assistent – Chat UI
(function () {
    'use strict';

    const TOOL_LABELS = {
        list_devices: 'Geräte & Datenbestand abrufen',
        get_database_schema: 'Datenbankschema lesen',
        query_database: 'SQL-Abfrage',
        get_consumption_stats: 'Energiestatistik',
        get_live_features: 'Live-Werte abrufen',
        run_javascript: 'Berechnung (JavaScript)',
        set_dhw_temperature: 'Warmwasser-Soll setzen',
        set_dhw_temperature2: 'Warmwasser-Soll 2 setzen',
        set_dhw_hysteresis: 'Warmwasser-Hysterese setzen',
        set_dhw_mode: 'Warmwasser-Betriebsart setzen',
        start_dhw_one_time_charge: 'Einmalige Warmwasserbereitung',
        set_heating_curve: 'Heizkurve setzen',
        set_heating_mode: 'Heizkreis-Betriebsart setzen',
        set_supply_temp_max: 'Max. Vorlauftemperatur setzen',
        set_room_temperature: 'Raumtemperatur setzen',
        set_noise_reduction_mode: 'Geräuschreduzierung setzen',
        set_schedule: 'Zeitprogramm setzen',
    };

    const EXAMPLES = [
        'Wie oft hat meine Wärmepumpe in den letzten 14 Tagen pro Tag getaktet, und welche Einstellungen könnten wir ändern, um weniger Takte zu haben?',
        'Wie viel Energie würde ich voraussichtlich sparen, wenn ich das Warmwasser 1 °C kühler einstelle?',
        'Zeig mir Stromverbrauch, Wärme und COP der letzten 30 Tage pro Tag als Diagramm.',
        'Welche Fehler- und Statusmeldungen gab es im letzten Monat, und was bedeuten sie?',
    ];

    const state = {
        settings: null,
        conversationId: '',
        title: '',
        messages: [],           // OpenAI format history (without system prompt)
        busy: false,
        abort: null,
        pendingConfirm: null,   // {calls: [...], decisions: {id: bool}}
    };

    const $ = (id) => document.getElementById(id);
    const els = {
        messages: $('messages'), input: $('input'), composer: $('composer'),
        sendBtn: $('sendBtn'), stopBtn: $('stopBtn'), modelSelect: $('modelSelect'),
        convList: $('convList'), writeBadge: $('writeBadge'), sidebar: $('sidebar'),
    };

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }

    function prettyJSON(s) {
        try { return JSON.stringify(typeof s === 'string' ? JSON.parse(s) : s, null, 2); } catch (e) { return String(s); }
    }

    function scrollToBottom(force) {
        const m = els.messages;
        const nearBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 150;
        if (force || nearBottom) m.scrollTop = m.scrollHeight;
    }

    async function api(url, body) {
        const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
        const res = await fetch(url, opts);
        return res.json();
    }

    // ------------------------------------------------------------------
    // Markdown (small subset: headings, lists, tables, code, quotes, inline)
    // ------------------------------------------------------------------
    function inlineMd(s) {
        const codes = [];
        s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
        s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + codes[+i] + '</code>');
        return s;
    }

    function splitRow(line) {
        let l = line.trim();
        if (l.startsWith('|')) l = l.slice(1);
        if (l.endsWith('|')) l = l.slice(0, -1);
        return l.split('|').map((c) => c.trim());
    }

    function renderMarkdown(text, opts) {
        opts = opts || {};
        const blocks = [];
        // Fenced code blocks first (content stays raw)
        let src = text.replace(/```(\w*)[^\n]*\n([\s\S]*?)(```|$)/g, (m, lang, code, close) => {
            blocks.push({ lang: lang.toLowerCase(), code: code.replace(/\n$/, ''), closed: close === '```' });
            return '\n\u0001' + (blocks.length - 1) + '\u0001\n';
        });
        src = escapeHtml(src);

        const lines = src.split('\n');
        const out = [];
        let para = [];
        const flush = () => { if (para.length) { out.push('<p>' + inlineMd(para.join('<br>')) + '</p>'); para = []; } };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const t = line.trim();
            let m;

            if ((m = t.match(/^\u0001(\d+)\u0001$/))) {
                flush();
                const b = blocks[+m[1]];
                if (b.lang === 'echarts' || b.lang === 'chart') {
                    if (opts.streaming || !b.closed) {
                        out.push('<p class="typing">Diagramm wird erstellt</p>');
                    } else {
                        out.push('<div class="chart" data-chart="' + escapeHtml(b.code) + '"></div>');
                    }
                } else {
                    out.push('<pre><code>' + escapeHtml(b.code) + '</code></pre>');
                }
                continue;
            }
            if (!t) { flush(); continue; }
            if ((m = t.match(/^(#{1,4})\s+(.*)$/))) {
                flush();
                const lvl = m[1].length;
                out.push('<h' + lvl + '>' + inlineMd(m[2]) + '</h' + lvl + '>');
                continue;
            }
            if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); out.push('<hr>'); continue; }

            // Table: header row followed by separator row
            if (t.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(lines[i + 1].trim())) {
                flush();
                const head = splitRow(t);
                const rows = [];
                i += 2;
                while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++; }
                i--;
                const isNum = (c) => /^[-+]?[\d.,]+\s*(%|°C|K|kWh|kW|W|€|h|l\/h)?$/.test(c);
                let html = '<div class="table-wrap"><table><thead><tr>' + head.map((h) => '<th>' + inlineMd(h) + '</th>').join('') + '</tr></thead><tbody>';
                rows.forEach((r) => {
                    html += '<tr>' + r.map((c) => '<td' + (isNum(c) ? ' class="num"' : '') + '>' + inlineMd(c) + '</td>').join('') + '</tr>';
                });
                out.push(html + '</tbody></table></div>');
                continue;
            }

            // Lists
            if (/^([-*+]|\d+[.)])\s+/.test(t)) {
                flush();
                const ordered = /^\d+[.)]/.test(t);
                const items = [];
                while (i < lines.length && /^([-*+]|\d+[.)])\s+/.test(lines[i].trim())) {
                    items.push(lines[i].trim().replace(/^([-*+]|\d+[.)])\s+/, ''));
                    // continuation lines (indented)
                    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i + 1])) {
                        items[items.length - 1] += '<br>' + lines[i + 1].trim();
                        i++;
                    }
                    i++;
                }
                i--;
                const tag = ordered ? 'ol' : 'ul';
                out.push('<' + tag + '>' + items.map((it) => '<li>' + inlineMd(it) + '</li>').join('') + '</' + tag + '>');
                continue;
            }
            if (t.startsWith('&gt;')) {
                flush();
                const q = [];
                while (i < lines.length && lines[i].trim().startsWith('&gt;')) { q.push(lines[i].trim().replace(/^&gt;\s?/, '')); i++; }
                i--;
                out.push('<blockquote>' + inlineMd(q.join('<br>')) + '</blockquote>');
                continue;
            }
            para.push(t);
        }
        flush();
        return out.join('');
    }

    function renderCharts(container) {
        if (typeof echarts === 'undefined') return;
        container.querySelectorAll('.chart[data-chart]').forEach((div) => {
            const code = div.getAttribute('data-chart');
            div.removeAttribute('data-chart');
            try {
                const option = JSON.parse(code);
                option.backgroundColor = option.backgroundColor || 'transparent';
                const chart = echarts.init(div, 'dark');
                chart.setOption(option);
                window.addEventListener('resize', () => chart.resize());
            } catch (e) {
                div.outerHTML = '<pre><code>' + escapeHtml(code) + '</code></pre><p class="hint">Diagramm konnte nicht dargestellt werden: ' + escapeHtml(e.message) + '</p>';
            }
        });
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------
    function renderEmpty() {
        const wrap = el('div', 'empty');
        wrap.innerHTML = '<h2>Was möchtest du über deine Anlage wissen?</h2>' +
            '<p>Der Assistent hat Zugriff auf Live-Werte, die Temperatur- und Verbrauchshistorie und das Ereignisprotokoll.</p>';
        const grid = el('div', 'examples');
        EXAMPLES.forEach((ex) => {
            const b = el('div', 'example');
            b.textContent = ex;
            b.onclick = () => { els.input.value = ex; autoGrow(); els.input.focus(); };
            grid.appendChild(b);
        });
        wrap.appendChild(grid);
        if (!state.settings || !state.settings.providers.length) {
            const p = el('p', 'hint', '⚠️ Noch kein KI-Anbieter eingerichtet – bitte zuerst <a href="#" id="emptySettings">Einstellungen</a> öffnen.');
            p.style.marginTop = '24px';
            wrap.appendChild(p);
            setTimeout(() => { const a = $('emptySettings'); if (a) a.onclick = (e) => { e.preventDefault(); openSettings(); }; });
        }
        els.messages.appendChild(wrap);
    }

    function toolResultOf(callId) {
        return state.messages.find((m) => m.role === 'tool' && m.tool_call_id === callId);
    }

    function renderToolCall(call) {
        const d = el('details', 'tool');
        d.dataset.callId = call.id;
        const label = TOOL_LABELS[call.function.name] || call.function.name;
        d.innerHTML = '<summary>🔧 <span>' + escapeHtml(label) + '</span><span class="state"></span></summary>' +
            '<div class="tool-body"><div class="label">Argumente</div><pre class="args"></pre><div class="label">Ergebnis</div><pre class="result">–</pre></div>';
        let args = call.function.arguments;
        try {
            const parsed = JSON.parse(args);
            if (call.function.name === 'run_javascript' && parsed.code) args = parsed.code;
            else if (call.function.name === 'query_database' && parsed.sql) args = parsed.sql;
            else args = JSON.stringify(parsed, null, 2);
        } catch (e) { /* keep raw */ }
        d.querySelector('.args').textContent = args;
        updateToolState(d, toolResultOf(call.id));
        return d;
    }

    function updateToolState(d, resultMsg) {
        d.classList.remove('running', 'done', 'failed', 'waiting');
        if (!resultMsg) {
            d.classList.add(state.pendingConfirm && state.pendingConfirm.calls.some((c) => c.id === d.dataset.callId) ? 'waiting' : 'running');
            return;
        }
        const content = resultMsg.content || '';
        d.classList.add(content.startsWith('{"error"') ? 'failed' : 'done');
        d.querySelector('.result').textContent = prettyJSON(content);
    }

    function renderAssistant(msg, container) {
        const wrap = container || el('div', 'msg assistant');
        wrap.innerHTML = '';
        if (msg.content) {
            const c = el('div', 'content md', renderMarkdown(msg.content));
            wrap.appendChild(c);
            renderCharts(c);
        }
        if (msg.tool_calls && msg.tool_calls.length) {
            const tools = el('div', 'tools');
            msg.tool_calls.forEach((call) => tools.appendChild(renderToolCall(call)));
            wrap.appendChild(tools);
        }
        return wrap;
    }

    function renderUser(msg) {
        const wrap = el('div', 'msg user');
        const b = el('div', 'bubble');
        b.textContent = msg.content;
        wrap.appendChild(b);
        return wrap;
    }

    function renderError(text) {
        const wrap = el('div', 'msg error');
        wrap.appendChild(el('div', 'content', '⚠️ ' + escapeHtml(text)));
        els.messages.appendChild(wrap);
        scrollToBottom(true);
    }

    function renderAll() {
        els.messages.innerHTML = '';
        if (!state.messages.length) { renderEmpty(); return; }
        state.messages.forEach((m) => {
            if (m.role === 'user') els.messages.appendChild(renderUser(m));
            else if (m.role === 'assistant' && (m.content || (m.tool_calls && m.tool_calls.length))) els.messages.appendChild(renderAssistant(m));
        });
        if (state.pendingConfirm) renderConfirm();
        scrollToBottom(true);
    }

    function renderConfirm() {
        const pc = state.pendingConfirm;
        const card = el('div', 'confirm-card');
        card.id = 'confirmCard';
        card.innerHTML = '<h4>⚠️ Der Assistent möchte Einstellungen ändern</h4>';
        pc.calls.forEach((call) => {
            const item = el('div', 'confirm-item');
            const label = TOOL_LABELS[call.function.name] || call.function.name;
            item.innerHTML = '<div class="name">' + escapeHtml(label) + '</div><pre>' + escapeHtml(prettyJSON(call.function.arguments)) + '</pre>';
            const actions = el('div', 'actions');
            const decision = el('span', 'decision');
            const ok = el('button', 'btn btn-ok btn-small', 'Ausführen');
            const no = el('button', 'btn btn-ghost btn-small', 'Ablehnen');
            const decide = (v) => {
                pc.decisions[call.id] = v;
                ok.remove(); no.remove();
                decision.textContent = v ? '✓ bestätigt' : '✕ abgelehnt';
                if (pc.calls.every((c) => c.id in pc.decisions)) {
                    const confirmations = pc.decisions;
                    state.pendingConfirm = null;
                    card.remove();
                    runChat(confirmations);
                }
            };
            ok.onclick = () => decide(true);
            no.onclick = () => decide(false);
            actions.append(ok, no, decision);
            item.appendChild(actions);
            card.appendChild(item);
        });
        els.messages.appendChild(card);
        scrollToBottom(true);
    }

    // ------------------------------------------------------------------
    // Chat
    // ------------------------------------------------------------------
    function setBusy(b) {
        state.busy = b;
        els.sendBtn.hidden = b;
        els.stopBtn.hidden = !b;
        els.input.disabled = false;
    }

    function selectedModel() {
        try { return JSON.parse(els.modelSelect.value || '{}'); } catch (e) { return {}; }
    }

    async function sendMessage(text) {
        if (state.busy || !text.trim()) return;
        if (state.pendingConfirm) { renderError('Bitte zuerst die ausstehende Änderung bestätigen oder ablehnen.'); return; }
        if (!state.messages.length) els.messages.innerHTML = '';
        const msg = { role: 'user', content: text.trim() };
        state.messages.push(msg);
        els.messages.appendChild(renderUser(msg));
        scrollToBottom(true);
        await runChat(null);
    }

    async function runChat(confirmations) {
        setBusy(true);
        const sel = selectedModel();
        const controller = new AbortController();
        state.abort = controller;

        // Live container for the assistant message currently being streamed
        let live = el('div', 'msg assistant');
        let liveText = '';
        live.appendChild(el('div', 'typing', 'Denke nach'));
        els.messages.appendChild(live);
        scrollToBottom(true);

        let renderPending = false;
        const renderLive = () => {
            if (renderPending) return;
            renderPending = true;
            requestAnimationFrame(() => {
                renderPending = false;
                live.innerHTML = '';
                live.appendChild(el('div', 'content md', renderMarkdown(liveText, { streaming: true })));
                scrollToBottom();
            });
        };

        const handlers = {
            delta(d) { liveText += d.text; renderLive(); },
            message(d) {
                const m = d.message;
                state.messages.push(m);
                if (m.role === 'assistant') {
                    renderAssistant(m, live);
                    // New live container for whatever comes next
                    live = el('div', 'msg assistant');
                    liveText = '';
                    live.appendChild(el('div', 'typing', 'Arbeite'));
                    els.messages.appendChild(live);
                } else if (m.role === 'tool') {
                    const d2 = els.messages.querySelector('details.tool[data-call-id="' + CSS.escape(m.tool_call_id) + '"]');
                    if (d2) updateToolState(d2, m);
                }
                scrollToBottom();
            },
            confirm(d) {
                state.pendingConfirm = { calls: d.calls, decisions: {} };
                d.calls.forEach((c) => {
                    const d2 = els.messages.querySelector('details.tool[data-call-id="' + CSS.escape(c.id) + '"]');
                    if (d2) updateToolState(d2, null);
                });
            },
            error(d) { renderError(d.error); },
            done(d) {
                const isNew = state.conversationId !== d.conversationId;
                state.conversationId = d.conversationId;
                state.title = d.title;
                if (d.persisted && isNew) loadConversations();
                else highlightConversation();
            },
        };

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversationId: state.conversationId,
                    providerId: sel.providerId || '',
                    model: sel.model || '',
                    messages: state.messages,
                    confirmations: confirmations || {},
                }),
                signal: controller.signal,
            });
            if (!res.ok || !res.body) throw new Error('HTTP ' + res.status + ': ' + (await res.text()));

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = buffer.indexOf('\n\n')) >= 0) {
                    const raw = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 2);
                    let event = 'message', data = '';
                    raw.split('\n').forEach((line) => {
                        if (line.startsWith('event:')) event = line.slice(6).trim();
                        else if (line.startsWith('data:')) data += line.slice(5).trim();
                    });
                    if (handlers[event] && data) handlers[event](JSON.parse(data));
                }
            }
        } catch (e) {
            if (e.name !== 'AbortError') renderError(e.message);
            else renderError('Abgebrochen.');
        } finally {
            if (live && !live.querySelector('.content')) live.remove();
            else if (live && liveText) {
                // Stream ended without a final message event (e.g. aborted): keep text in history
                state.messages.push({ role: 'assistant', content: liveText });
                renderAssistant({ role: 'assistant', content: liveText }, live);
            }
            state.abort = null;
            setBusy(false);
            if (state.pendingConfirm) renderConfirm();
            els.input.focus();
        }
    }

    // ------------------------------------------------------------------
    // Conversations
    // ------------------------------------------------------------------
    async function loadConversations() {
        els.convList.innerHTML = '';
        if (!state.settings || !state.settings.persistChats) {
            els.convList.appendChild(el('div', 'conv-empty', 'Speichern ist deaktiviert (Einstellungen).'));
            return;
        }
        let data;
        try { data = await api('/api/ai/conversations'); } catch (e) { return; }
        if (!data.success) { els.convList.appendChild(el('div', 'conv-empty', escapeHtml(data.error || 'Fehler'))); return; }
        if (!data.conversations.length) { els.convList.appendChild(el('div', 'conv-empty', 'Noch keine Unterhaltungen.')); return; }
        data.conversations.forEach((c) => {
            const item = el('div', 'conv-item');
            item.dataset.id = c.id;
            item.title = c.title + '\n' + new Date(c.updatedAt).toLocaleString('de-DE');
            const title = el('span', 'title');
            title.textContent = c.title;
            const del = el('button', 'del', '🗑');
            del.title = 'Löschen';
            del.onclick = async (e) => {
                e.stopPropagation();
                if (!confirm('Unterhaltung „' + c.title + '“ löschen?')) return;
                await api('/api/ai/conversations/delete', { id: c.id });
                if (state.conversationId === c.id) newChat();
                loadConversations();
            };
            item.append(title, del);
            item.onclick = () => openConversation(c.id);
            els.convList.appendChild(item);
        });
        highlightConversation();
    }

    function highlightConversation() {
        els.convList.querySelectorAll('.conv-item').forEach((i) => i.classList.toggle('active', i.dataset.id === state.conversationId));
    }

    async function openConversation(id) {
        if (state.busy) return;
        const data = await api('/api/ai/conversations/get?id=' + encodeURIComponent(id));
        if (!data.success) { renderError(data.error); return; }
        const c = data.conversation;
        state.conversationId = c.id;
        state.title = c.title;
        state.messages = c.messages || [];
        state.pendingConfirm = null;
        // Restore pending confirmation if the last assistant message has unanswered write calls
        const last = state.messages[state.messages.length - 1];
        const lastAssistant = [...state.messages].reverse().find((m) => m.role === 'assistant');
        if (lastAssistant && lastAssistant.tool_calls && last && last.role !== 'user') {
            const open = lastAssistant.tool_calls.filter((tc) => !toolResultOf(tc.id));
            if (open.length) state.pendingConfirm = { calls: open, decisions: {} };
        }
        selectModel(c.providerId, c.model);
        renderAll();
        highlightConversation();
        els.sidebar.classList.remove('open');
    }

    function newChat() {
        if (state.busy && state.abort) state.abort.abort();
        state.conversationId = '';
        state.title = '';
        state.messages = [];
        state.pendingConfirm = null;
        renderAll();
        highlightConversation();
        els.sidebar.classList.remove('open');
        els.input.focus();
    }

    // ------------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------------
    async function loadSettings() {
        state.settings = await api('/api/ai/settings');
        fillModelSelect(els.modelSelect, true);
        const w = state.settings.allowWrite;
        const yolo = w && state.settings.autoApproveWrite;
        els.writeBadge.textContent = yolo ? '⚡ Schreiben ohne Bestätigung' : (w ? '✎ Schreiben mit Bestätigung' : '👁 Nur lesen');
        els.writeBadge.className = 'badge ' + (yolo ? 'yolo' : (w ? 'write' : 'read'));
    }

    function fillModelSelect(select, useStoredDefault) {
        const s = state.settings;
        select.innerHTML = '';
        s.providers.forEach((p) => {
            const group = document.createElement('optgroup');
            group.label = p.name || p.baseUrl;
            (p.models || []).forEach((m) => {
                const o = document.createElement('option');
                o.value = JSON.stringify({ providerId: p.id, model: m });
                o.textContent = m;
                group.appendChild(o);
            });
            select.appendChild(group);
        });
        if (!select.options.length) {
            const o = document.createElement('option');
            o.textContent = 'Kein Modell konfiguriert';
            o.value = '';
            select.appendChild(o);
        }
        if (useStoredDefault) selectModel(s.defaultProviderId, s.defaultModel, select);
    }

    function selectModel(providerId, model, select) {
        select = select || els.modelSelect;
        const v = JSON.stringify({ providerId: providerId, model: model });
        for (const o of select.options) { if (o.value === v) { select.value = v; return; } }
    }

    // Working copy of the settings while the dialog is open
    let draft = null;

    function openSettings() {
        const s = state.settings;
        draft = JSON.parse(JSON.stringify(s));
        draft.providers.forEach((p) => { p.apiKey = ''; });
        $('persistChats').checked = s.persistChats;
        $('allowWrite').checked = s.allowWrite;
        $('autoApproveWrite').checked = s.autoApproveWrite;
        updateWriteOptions();
        $('customPrompt').value = s.customPrompt || '';
        $('mcpEnabled').checked = s.mcpEnabled;
        $('mcpAllowWrite').checked = s.mcpAllowWrite;
        $('mcpToken').value = s.mcpToken || '';
        $('settingsStatus').textContent = '';
        renderProviders();
        updateMcpDetails();
        $('settingsModal').hidden = false;
    }

    function closeSettings() { $('settingsModal').hidden = true; }

    function renderProviders() {
        const list = $('providerList');
        list.innerHTML = '';
        if (!draft.providers.length) list.appendChild(el('p', 'hint', 'Noch kein Anbieter angelegt.'));
        draft.providers.forEach((p, idx) => {
            const box = el('div', 'provider');
            box.innerHTML =
                '<div class="grid">' +
                '<label>Name<input class="input" data-f="name" placeholder="OpenRouter"></label>' +
                '<label>Base-URL<input class="input mono" data-f="baseUrl" placeholder="https://openrouter.ai/api/v1"></label>' +
                '<label class="full">API-Key<input class="input mono" type="password" data-f="apiKey" autocomplete="off"></label>' +
                '<label class="full">Modelle (eins pro Zeile, z.B. anthropic/claude-sonnet-5)<textarea class="input mono" rows="3" data-f="models"></textarea></label>' +
                '</div>' +
                '<div class="actions"><span class="hint load-status"></span>' +
                '<select class="input model-pick" hidden style="max-width:320px"></select>' +
                '<button class="btn btn-ghost btn-small" data-a="load">Modelle laden</button>' +
                '<button class="btn btn-ghost btn-small" data-a="remove">Entfernen</button></div>';
            const q = (sel) => box.querySelector(sel);
            q('[data-f="name"]').value = p.name || '';
            q('[data-f="baseUrl"]').value = p.baseUrl || '';
            q('[data-f="apiKey"]').placeholder = p.hasApiKey ? '•••••••• (gespeichert, leer lassen zum Beibehalten)' : 'sk-…';
            q('[data-f="models"]').value = (p.models || []).join('\n');
            box.querySelectorAll('[data-f]').forEach((inp) => {
                inp.oninput = () => {
                    const f = inp.dataset.f;
                    p[f] = f === 'models' ? inp.value.split('\n').map((x) => x.trim()).filter(Boolean) : inp.value;
                    fillDefaultModelSelect();
                };
            });
            q('[data-a="remove"]').onclick = () => { draft.providers.splice(idx, 1); renderProviders(); };
            q('[data-a="load"]').onclick = async () => {
                const status = q('.load-status');
                if (!p.id || !state.settings.providers.some((sp) => sp.id === p.id)) { status.textContent = 'Bitte zuerst speichern.'; return; }
                status.textContent = 'Lade …';
                const data = await api('/api/ai/models?providerId=' + encodeURIComponent(p.id));
                if (!data.success) { status.textContent = data.error; return; }
                status.textContent = data.models.length + ' Modelle';
                const pick = q('.model-pick');
                pick.innerHTML = '<option value="">+ Modell hinzufügen …</option>' + data.models.map((m) => '<option>' + escapeHtml(m) + '</option>').join('');
                pick.hidden = false;
                pick.onchange = () => {
                    if (!pick.value) return;
                    p.models = p.models || [];
                    if (!p.models.includes(pick.value)) p.models.push(pick.value);
                    q('[data-f="models"]').value = p.models.join('\n');
                    pick.value = '';
                    fillDefaultModelSelect();
                };
            };
            list.appendChild(box);
        });
        fillDefaultModelSelect();
    }

    function fillDefaultModelSelect() {
        const select = $('defaultModelSelect');
        const current = select.value || JSON.stringify({ providerId: draft.defaultProviderId, model: draft.defaultModel });
        const saved = state.settings;
        state.settings = draft;
        fillModelSelect(select, false);
        state.settings = saved;
        for (const o of select.options) { if (o.value === current) select.value = current; }
    }

    function updateWriteOptions() {
        const enabled = $('allowWrite').checked;
        $('autoApproveWrite').disabled = !enabled;
        $('autoApproveWrite').parentElement.classList.toggle('disabled', !enabled);
    }

    function updateMcpDetails() {
        const enabled = $('mcpEnabled').checked;
        $('mcpDetails').hidden = !enabled || !$('mcpToken').value;
        const url = location.origin + '/mcp';
        const token = $('mcpToken').value;
        $('mcpSnippetCode').textContent = 'claude mcp add --transport http vieventlog ' + url + ' \\\n  --header "Authorization: Bearer ' + token + '"';
        const args = ['-y', 'mcp-remote', url, '--header', 'Authorization: Bearer ' + token];
        if (location.protocol === 'http:') args.push('--allow-http');
        $('mcpSnippetDesktop').textContent = JSON.stringify({ mcpServers: { vieventlog: { command: 'npx', args: args } } }, null, 2);
    }

    async function saveSettings() {
        const def = (() => { try { return JSON.parse($('defaultModelSelect').value || '{}'); } catch (e) { return {}; } })();
        const body = {
            providers: draft.providers.map((p) => ({ id: p.id || '', name: p.name || '', baseUrl: p.baseUrl || '', apiKey: p.apiKey || '', models: p.models || [] })),
            defaultProviderId: def.providerId || '',
            defaultModel: def.model || '',
            persistChats: $('persistChats').checked,
            allowWrite: $('allowWrite').checked,
            autoApproveWrite: $('allowWrite').checked && $('autoApproveWrite').checked,
            customPrompt: $('customPrompt').value,
            mcpEnabled: $('mcpEnabled').checked,
            mcpToken: $('mcpToken').value,
            mcpAllowWrite: $('mcpAllowWrite').checked,
        };
        // New providers without id: map default selection by index after save
        const status = $('settingsStatus');
        status.textContent = 'Speichere …';
        const res = await api('/api/ai/settings/set', body);
        if (!res.success) { status.textContent = '⚠️ ' + res.error; return; }
        await loadSettings();
        // Default model of a newly created provider: pick first model if none chosen
        if (!state.settings.defaultModel && state.settings.providers.length && state.settings.providers[0].models.length) {
            const p = state.settings.providers[0];
            await api('/api/ai/settings/set', Object.assign({}, body, {
                providers: state.settings.providers.map((x) => ({ id: x.id, name: x.name, baseUrl: x.baseUrl, apiKey: '', models: x.models })),
                defaultProviderId: p.id, defaultModel: p.models[0],
            }));
            await loadSettings();
        }
        loadConversations();
        if (!state.messages.length) renderAll();
        status.textContent = '✓ Gespeichert';
        $('mcpToken').value = state.settings.mcpToken || '';
        draft = JSON.parse(JSON.stringify(state.settings));
        renderProviders();
        updateMcpDetails();
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------
    function autoGrow() {
        els.input.style.height = 'auto';
        els.input.style.height = Math.min(els.input.scrollHeight, 220) + 'px';
    }

    els.composer.onsubmit = (e) => {
        e.preventDefault();
        const text = els.input.value;
        els.input.value = '';
        autoGrow();
        sendMessage(text);
    };
    els.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); els.composer.requestSubmit(); }
    });
    els.input.addEventListener('input', autoGrow);
    els.stopBtn.onclick = () => { if (state.abort) state.abort.abort(); };
    $('newChatBtn').onclick = newChat;
    $('settingsBtn').onclick = openSettings;
    $('sidebarToggle').onclick = () => els.sidebar.classList.toggle('open');
    $('addProviderBtn').onclick = () => {
        draft.providers.push({ id: '', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', models: [] });
        renderProviders();
    };
    $('saveSettingsBtn').onclick = saveSettings;
    $('mcpEnabled').onchange = updateMcpDetails;
    $('allowWrite').onchange = updateWriteOptions;
    $('mcpRegenBtn').onclick = () => { $('mcpToken').value = ''; $('settingsStatus').textContent = 'Neues Token wird beim Speichern erzeugt.'; };
    document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = closeSettings; });
    $('settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') closeSettings(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

    (async function init() {
        try { await loadSettings(); } catch (e) { renderError('Einstellungen konnten nicht geladen werden: ' + e.message); }
        loadConversations();
        renderAll();
        if (state.settings && !state.settings.providers.length) openSettings();
        els.input.focus();
    })();
})();
