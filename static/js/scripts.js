// ViEventLog – Automatisierungs-Skripte
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const esc = ViMarkdown.escapeHtml;

    const TEMPLATES = {
        outside: {
            name: 'Warmwasser nach Außentemperatur',
            description: 'Über 18,5 °C (2-h-Mittel) Warmwasser 50 °C, unter 17,5 °C 53 °C',
            schedule: '*/5 * * * *',
            code: [
                '// Mittelwert der letzten 2 Stunden glättet kurze Schwankungen',
                'let t = history("outside_temp", 120, "avg") ?? outsideTemp();',
                'log("Außentemperatur (Mittel):", t);',
                'if t > 18.5 {',
                '  setDhwTemperature(50)',
                '} else if t < 17.5 {',
                '  setDhwTemperature(53)',
                '} else {',
                '  false // Schaltlücke: nichts ändern',
                '}',
            ].join('\n'),
        },
        charge: {
            name: 'Warmwasser um 17 Uhr',
            description: 'Startet täglich um 17:00 eine einmalige Warmwasserbereitung',
            schedule: '0 17 * * *',
            code: 'startDhwOneTimeCharge()',
        },
        noise: {
            name: 'Nachts leiser',
            description: 'Geräuschreduzierung zwischen 22 und 6 Uhr',
            schedule: '*/10 * * * *',
            code: 'setNoiseReductionMode(timeBetween("22:00", "06:00") ? "maxReduced" : "notReduced")',
        },
        blank: { name: 'Neues Skript', description: '', schedule: '*/5 * * * *', code: 'log("Außen:", outsideTemp())' },
    };

    const STATUS_LABELS = {
        executed: 'ausgeführt', 'dry-run': 'würde ausführen', unchanged: 'unverändert',
        'recently-done': 'kürzlich erledigt', error: 'Fehler',
    };

    const state = { scripts: [], devices: [], current: null, dirty: false };

    async function api(url, body) {
        const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
        const res = await fetch(url, opts);
        return res.json();
    }

    function fmtTime(iso) {
        if (!iso) return '–';
        return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function deviceKey(d) { return [d.accountId, d.installationId, d.gatewaySerial, d.deviceId].join('|'); }

    function deviceLabel(d) {
        const found = state.devices.find((x) => deviceKey(x) === deviceKey(d));
        if (!found) return d.installationId + ' / ' + d.gatewaySerial;
        return (found.installationName || found.installationId) + ' – ' + found.modelId.replace(/^E3_/, '');
    }

    // ------------------------------------------------------------------
    // List
    // ------------------------------------------------------------------
    async function loadScripts() {
        const data = await api('/api/scripts');
        state.scripts = data.success ? data.scripts : [];
        renderList();
    }

    function renderList() {
        const list = $('scriptList');
        list.innerHTML = '';
        if (!state.scripts.length) {
            list.innerHTML = '<div class="conv-empty">Noch keine Skripte.</div>';
            return;
        }
        state.scripts.forEach((s) => {
            const item = document.createElement('div');
            item.className = 'conv-item script-item' + (state.current && state.current.id === s.id ? ' active' : '');
            const dotCls = s.lastStatus === 'error' ? 'err' : (s.enabled ? 'on' : '');
            item.title = (s.description || '') + (s.lastError ? '\nLetzter Fehler: ' + s.lastError : '');
            item.innerHTML = '<span class="dot ' + dotCls + '"></span><span class="text"><span class="title">' + esc(s.name) +
                '</span><span class="meta">' + esc(s.enabled ? s.schedule : 'inaktiv') + '</span></span>';
            item.onclick = () => openScript(s);
            list.appendChild(item);
        });
    }

    // ------------------------------------------------------------------
    // Editor
    // ------------------------------------------------------------------
    function fillDevices(selected) {
        const sel = $('fDevice');
        sel.innerHTML = '';
        state.devices.forEach((d) => {
            const o = document.createElement('option');
            o.value = deviceKey(d);
            o.textContent = (d.installationName || d.installationId) + ' – ' + d.modelId.replace(/^E3_/, '') + ' (' + d.accountName + ')';
            sel.appendChild(o);
        });
        if (selected) {
            const key = deviceKey(selected);
            if (![...sel.options].some((o) => o.value === key)) {
                const o = document.createElement('option');
                o.value = key;
                o.textContent = deviceLabel(selected) + ' (nicht verfügbar)';
                sel.appendChild(o);
            }
            sel.value = key;
        }
    }

    function openScript(s) {
        if (state.dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
        state.current = s;
        state.dirty = false;
        $('emptyState').hidden = true;
        $('editor').hidden = false;
        $('fName').value = s.name || '';
        $('fDescription').value = s.description || '';
        $('fSchedule').value = s.schedule || '';
        $('fEnabled').checked = !!s.enabled;
        $('fCode').value = s.code || '';
        fillDevices(s.id ? s : null);
        $('result').hidden = true;
        $('editorStatus').textContent = s.id ? 'Zuletzt: ' + fmtTime(s.lastRun) + (s.lastStatus ? ' (' + s.lastStatus + ')' : '') : 'Noch nicht gespeichert';
        $('deleteBtn').hidden = !s.id;
        $('runBtn').hidden = !s.id;
        updateNextRuns(s.nextRuns);
        resetAi();
        renderList();
        loadRuns();
        $('sidebar').classList.remove('open');
    }

    function updateNextRuns(next) {
        $('nextRuns').textContent = next && next.length ? 'Nächste Läufe: ' + next.map(fmtTime).join(', ') : '';
    }

    function formData() {
        const key = $('fDevice').value.split('|');
        return {
            id: state.current && state.current.id || '',
            name: $('fName').value,
            description: $('fDescription').value,
            schedule: $('fSchedule').value,
            enabled: $('fEnabled').checked,
            code: $('fCode').value,
            accountId: key[0] || '', installationId: key[1] || '', gatewaySerial: key[2] || '', deviceId: key[3] || '0',
        };
    }

    function renderResult(res, title, box) {
        box = box || $('result');
        box.hidden = false;
        box.className = 'result ' + (res.status === 'ok' ? 'ok' : 'error');
        let html = '<h4>' + esc(title) + ' · ' + (res.status === 'ok' ? '✓ erfolgreich' : '✕ Fehler') + (res.duration ? ' · ' + esc(res.duration) : '') + '</h4>';
        if (res.error) html += '<div class="err">' + esc(res.error) + '</div>';
        if (res.actions && res.actions.length) {
            html += '<div class="label">Aktionen</div><ul class="actions-list">' + res.actions.map((a) =>
                '<li><span class="st ' + esc(a.status) + '">' + esc(STATUS_LABELS[a.status] || a.status) + '</span>' +
                esc(a.function + '(' + (a.args || []).map((x) => JSON.stringify(x)).join(', ') + ')') +
                (a.detail ? ' <span class="hint">– ' + esc(a.detail) + '</span>' : '') + '</li>').join('') + '</ul>';
        }
        if (res.logs && res.logs.length) html += '<div class="label">Log</div><pre>' + esc(res.logs.join('\n')) + '</pre>';
        if (res.result !== undefined && res.result !== null) html += '<div class="label">Ergebnis</div><pre>' + esc(JSON.stringify(res.result, null, 2)) + '</pre>';
        if (res.state && Object.keys(res.state).length) html += '<div class="label">Variablen' + (res.dryRun ? ' (nicht gespeichert)' : '') + '</div><pre>' + esc(JSON.stringify(res.state, null, 2)) + '</pre>';
        box.innerHTML = html;
    }

    async function loadRuns() {
        const runs = $('runs');
        if (!state.current || !state.current.id) { runs.innerHTML = '<p class="hint">Noch keine Läufe.</p>'; return; }
        const data = await api('/api/scripts/runs?id=' + encodeURIComponent(state.current.id) + ($('runsAll').checked ? '&all=1' : ''));
        if (!data.success || !data.runs.length) { runs.innerHTML = '<p class="hint">Noch keine Läufe' + ($('runsAll').checked ? '' : ' mit Änderungen oder Fehlern') + '.</p>'; return; }
        runs.innerHTML = '';
        data.runs.forEach((r) => {
            const res = r.result || {};
            const executed = (res.actions || []).filter((a) => a.status === 'executed').length;
            const d = document.createElement('details');
            d.className = 'run';
            const summary = res.status === 'error' ? '✕ ' + (res.error || 'Fehler') :
                (executed ? '⚡ ' + executed + ' Aktion(en) ausgeführt' : '✓ keine Änderung');
            d.innerHTML = '<summary><span class="time">' + esc(fmtTime(r.timestamp)) + '</span><span>' + esc(summary.slice(0, 140)) + '</span>' +
                '<span class="trigger">' + (r.trigger === 'manual' ? 'manuell' : 'Zeitplan') + '</span></summary><div class="run-detail"></div>';
            d.addEventListener('toggle', () => {
                if (d.open) renderResult(res, 'Lauf', d.querySelector('.run-detail'));
            });
            runs.appendChild(d);
        });
    }

    async function save(e) {
        e.preventDefault();
        const status = $('editorStatus');
        status.textContent = 'Speichere …';
        const data = await api('/api/scripts/save', formData());
        if (!data.success) { status.textContent = '⚠️ ' + data.error; return; }
        state.dirty = false;
        await loadScripts();
        const saved = state.scripts.find((s) => s.id === data.script.id) || data.script;
        openScript(saved);
        $('editorStatus').textContent = '✓ Gespeichert' + (saved.enabled ? '' : ' (inaktiv)');
    }

    async function test() {
        const f = formData();
        $('editorStatus').textContent = 'Teste …';
        const data = await api('/api/scripts/test', { scriptId: f.id, code: f.code, accountId: f.accountId, installationId: f.installationId, gatewaySerial: f.gatewaySerial, deviceId: f.deviceId });
        $('editorStatus').textContent = '';
        if (!data.success) { renderResult({ status: 'error', error: data.error }, 'Testlauf'); return; }
        renderResult(data.result, 'Testlauf (ohne Aktionen)');
    }

    async function runNow() {
        if (state.dirty) { alertBox('Bitte zuerst speichern – ausgeführt wird die gespeicherte Version.'); return; }
        if (!confirm('Skript „' + state.current.name + '“ jetzt ausführen? Aktionen werden wirklich ausgeführt.')) return;
        $('editorStatus').textContent = 'Führe aus …';
        const data = await api('/api/scripts/run', { id: state.current.id });
        $('editorStatus').textContent = '';
        renderResult(data.result, 'Ausführung');
        await loadScripts();
        loadRuns();
    }

    function alertBox(msg) { $('editorStatus').textContent = '⚠️ ' + msg; }

    async function remove() {
        if (!confirm('Skript „' + state.current.name + '“ löschen?')) return;
        await api('/api/scripts/delete', { id: state.current.id });
        state.current = null;
        state.dirty = false;
        $('editor').hidden = true;
        $('emptyState').hidden = false;
        loadScripts();
    }

    function newScript(templateKey) {
        const t = TEMPLATES[templateKey || 'blank'];
        openScript({ name: t.name, description: t.description, schedule: t.schedule, code: t.code, enabled: false });
        state.dirty = true;
    }


    // ------------------------------------------------------------------
    // AI help (read-only assistant with the current script as context)
    // ------------------------------------------------------------------
    const AI_PROMPTS = {
        explain: 'Erklär mir in einfachen Worten, was dieses Skript macht, wann es läuft und was es an meiner Anlage ändert.',
        check: 'Prüfe das Skript auf Fehler und Risiken (z.B. ständiges Umschalten, fehlende Werte, ungünstiger Zeitplan) und mach einen Testlauf.',
        improve: 'Verbessere das Skript (Robustheit, Hysterese, Lesbarkeit, sparsamer Zeitplan) und erkläre kurz die Änderungen.',
    };
    const ai = { messages: [], busy: false, abort: null };

    async function loadAiModels() {
        const sel = $('aiModel');
        let settings;
        try { settings = await api('/api/ai/settings'); } catch (e) { return; }
        sel.innerHTML = '';
        (settings.providers || []).forEach((p) => (p.models || []).forEach((m) => {
            const o = document.createElement('option');
            o.value = JSON.stringify({ providerId: p.id, model: m });
            o.textContent = m;
            if (p.id === settings.defaultProviderId && m === settings.defaultModel) o.selected = true;
            sel.appendChild(o);
        }));
        if (!sel.options.length) {
            $('aiMessages').innerHTML = '<p class="hint">Kein KI-Modell eingerichtet – bitte im <a href="/assistant">Assistenten</a> unter Einstellungen anlegen.</p>';
            document.querySelectorAll('[data-ask], #aiSend').forEach((b) => { b.disabled = true; });
        }
    }

    function resetAi() {
        if (ai.abort) ai.abort.abort();
        ai.messages = [];
        $('aiMessages').innerHTML = '';
    }

    function addApplyButtons(container) {
        container.querySelectorAll('pre[data-lang="expr"], pre[data-lang=""]').forEach((pre) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-ghost btn-small apply-btn';
            btn.textContent = '↳ In Editor übernehmen';
            btn.onclick = () => {
                $('fCode').value = pre.textContent;
                state.dirty = true;
                btn.textContent = '✓ Übernommen – Testlauf/Speichern nicht vergessen';
                $('fCode').scrollIntoView({ behavior: 'smooth', block: 'center' });
            };
            pre.after(btn);
        });
    }

    async function askAi(question) {
        if (ai.busy || !question.trim()) return;
        $('aiPanel').open = true;
        const box = $('aiMessages');
        const userDiv = document.createElement('div');
        userDiv.className = 'ai-msg user';
        userDiv.textContent = question;
        box.appendChild(userDiv);
        ai.messages.push({ role: 'user', content: question });

        const out = document.createElement('div');
        out.className = 'ai-msg';
        out.innerHTML = '<span class="typing">Denke nach</span>';
        box.appendChild(out);
        let text = '';
        const tools = [];
        const render = (final) => {
            out.innerHTML = tools.map((t) => '<div class="tool-line">🔧 ' + esc(t) + '</div>').join('') +
                (text ? ViMarkdown.render(text, { streaming: !final }) : '<span class="typing">Arbeite</span>');
            if (final) addApplyButtons(out);
            box.scrollTop = box.scrollHeight;
        };

        ai.busy = true;
        $('aiSend').hidden = true;
        $('aiStop').hidden = false;
        ai.abort = new AbortController();
        let sel = {};
        try { sel = JSON.parse($('aiModel').value || '{}'); } catch (e) { /* default model */ }
        const ctx = formData();
        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId: sel.providerId || '', model: sel.model || '', messages: ai.messages, scriptContext: ctx }),
                signal: ai.abort.signal,
            });
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
                    let event = '', data = '';
                    raw.split('\n').forEach((l) => {
                        if (l.startsWith('event:')) event = l.slice(6).trim();
                        else if (l.startsWith('data:')) data += l.slice(5).trim();
                    });
                    if (!data) continue;
                    const d = JSON.parse(data);
                    if (event === 'delta') { text += d.text; render(false); }
                    else if (event === 'message') {
                        ai.messages.push(d.message);
                        (d.message.tool_calls || []).forEach((tc) => tools.push(tc.function.name === 'test_script' ? 'Testlauf' : tc.function.name));
                        if (d.message.role === 'assistant' && d.message.tool_calls && d.message.tool_calls.length) text += '\n\n';
                        render(false);
                    } else if (event === 'error') { text += '\n\n⚠️ ' + d.error; }
                }
            }
        } catch (e) {
            text += e.name === 'AbortError' ? '\n\n_Abgebrochen._' : '\n\n⚠️ ' + e.message;
        } finally {
            render(true);
            ai.busy = false;
            ai.abort = null;
            $('aiSend').hidden = false;
            $('aiStop').hidden = true;
        }
    }

    // ------------------------------------------------------------------
    // Docs
    // ------------------------------------------------------------------
    let docsLoaded = false;
    async function openDocs(e) {
        if (e) e.preventDefault();
        $('docsModal').hidden = false;
        if (docsLoaded) return;
        const text = await (await fetch('/api/scripts/docs')).text();
        $('docsBody').innerHTML = ViMarkdown.render(text);
        docsLoaded = true;
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------
    $('newScriptBtn').onclick = () => {
        if (state.dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
        state.dirty = false;
        state.current = null;
        $('editor').hidden = true;
        $('emptyState').hidden = false;
        renderList();
        $('sidebar').classList.remove('open');
    };
    document.querySelectorAll('[data-template]').forEach((el) => { el.onclick = () => newScript(el.dataset.template); });
    $('editor').onsubmit = save;
    $('editor').addEventListener('input', (e) => { if (!e.target.closest('.ai-panel')) state.dirty = true; });
    $('testBtn').onclick = test;
    $('runBtn').onclick = runNow;
    $('deleteBtn').onclick = remove;
    $('runsAll').onchange = loadRuns;
    $('fPreset').onchange = () => { if ($('fPreset').value) { $('fSchedule').value = $('fPreset').value; state.dirty = true; } $('fPreset').value = ''; };
    $('docsBtn').onclick = openDocs;
    $('docsLink').onclick = openDocs;
    $('sidebarToggle').onclick = () => $('sidebar').classList.toggle('open');
    document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => { $('docsModal').hidden = true; }; });
    $('docsModal').addEventListener('click', (e) => { if (e.target.id === 'docsModal') $('docsModal').hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('docsModal').hidden = true; });
    $('aiBtn').onclick = (e) => {
        e.preventDefault();
        const q = state.current && state.current.code
            ? 'Hilf mir mit meinem ViEventLog-Skript „' + $('fName').value + '“:\n\n```\n' + $('fCode').value + '\n```\n\n'
            : 'Erstelle mir ein ViEventLog-Skript, das ';
        location.href = '/assistant?q=' + encodeURIComponent(q);
    };
    // Tab key inserts two spaces in the code editor
    $('fCode').addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        const ta = e.target, s = ta.selectionStart;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + 2;
        state.dirty = true;
    });
    document.querySelectorAll('[data-ask]').forEach((b) => { b.onclick = () => askAi(AI_PROMPTS[b.dataset.ask]); });
    $('aiSend').onclick = () => { const q = $('aiQuestion').value; $('aiQuestion').value = ''; askAi(q); };
    $('aiQuestion').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('aiSend').click(); } });
    $('aiStop').onclick = () => { if (ai.abort) ai.abort.abort(); };
    window.addEventListener('beforeunload', (e) => { if (state.dirty) e.preventDefault(); });

    (async function init() {
        const [devices] = await Promise.all([api('/api/scripts/devices'), loadScripts(), loadAiModels()]);
        state.devices = devices.success ? devices.devices : [];
        const id = new URLSearchParams(location.search).get('id');
        const s = id && state.scripts.find((x) => x.id === id);
        if (s) openScript(s);
    })();
})();
