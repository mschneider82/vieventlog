// Dashboard Schedule Rendering
// Hot water (DHW) and circulation pump schedules: week view + editor

        const SCHEDULE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const SCHEDULE_DAY_LABELS = { mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr', sat: 'Sa', sun: 'So' };

        // Schedules shown in the dashboard; `setting` refers to the device setting toggle
        const SCHEDULE_DEFINITIONS = [
            { feature: 'heating.dhw.schedule', title: 'Warmwasser', icon: '💧', setting: 'showDhwSchedule' },
            { feature: 'heating.dhw.pumps.circulation.schedule', title: 'Zirkulationspumpe', icon: '🔄', setting: 'showCirculationSchedule' }
        ];

        const SCHEDULE_MODE_LABELS = {
            'on': 'Ein',
            'off': 'Aus',
            'normal': 'Normal',
            'comfort': 'Komfort',
            'eco': 'Eco',
            'reduced': 'Reduziert',
            'top': 'Top',
            'temp-2': 'Temp. 2'
        };

        const SCHEDULE_MODE_COLORS = {
            'on': '#3b82f6',
            'normal': '#3b82f6',
            'temp-2': '#f59e0b',
            'top': '#ef4444',
            'comfort': '#ef4444',
            'eco': '#10b981',
            'reduced': '#10b981'
        };

        // Templates offered in the editor (applied to all days)
        const SCHEDULE_PRESETS = [
            { label: 'Ganztägig', entries: [['00:00', '24:00']] },
            { label: 'Morgens + Abends', entries: [['05:30', '08:00'], ['17:00', '22:00']] },
            { label: 'Tagsüber', entries: [['06:00', '22:00']] }
        ];

        function scheduleModeLabel(mode) {
            return SCHEDULE_MODE_LABELS[mode] || mode;
        }

        function scheduleModeColor(mode) {
            return SCHEDULE_MODE_COLORS[mode] || '#667eea';
        }

        function scheduleToMinutes(time) {
            const [h, m] = time.split(':').map(Number);
            return h * 60 + m;
        }

        function scheduleFromMinutes(minutes) {
            return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        }

        function getScheduleConstraints(schedule) {
            const c = schedule.constraints || {};
            return {
                modes: c.modes && c.modes.length ? c.modes : ['on'],
                defaultMode: c.defaultMode || 'off',
                maxEntries: c.maxEntries || 4,
                resolution: c.resolution || 10,
                overlapAllowed: !!c.overlapAllowed
            };
        }

        function getVisibleSchedules(features) {
            const schedules = features.schedules || {};
            const deviceInfo = features.deviceInfo;
            const deviceKey = deviceInfo ? `${deviceInfo.installationId}_${deviceInfo.deviceId}` : null;
            const settings = deviceKey && window.deviceSettingsCache ? window.deviceSettingsCache[deviceKey] : null;

            return SCHEDULE_DEFINITIONS.filter(def => {
                if (!schedules[def.feature]) return false;
                // Default: shown unless explicitly disabled in device settings
                return !(settings && settings[def.setting] === false);
            });
        }

        // Schedule blocks for embedding in the hot water card
        function renderDhwScheduleSection(features) {
            const visible = getVisibleSchedules(features);
            if (visible.length === 0) return '';

            // Keep schedules for the editor
            window.currentSchedules = features.schedules;

            return `
                <div class="schedule-section">
                    <div class="schedule-section-title">🕒 Zeitpläne</div>
                    ${visible.map(def => renderScheduleWeek(def, features.schedules[def.feature])).join('')}
                </div>
            `;
        }

        // Standalone card, used when the device has no hot water card
        function renderDhwSchedules(features) {
            const section = renderDhwScheduleSection(features);
            if (!section) return '';

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>🕒 Warmwasser-Zeitpläne</h2>
                    </div>
                    ${section}
                </div>
            `;
        }

        function renderScheduleWeek(def, schedule) {
            const constraints = getScheduleConstraints(schedule);
            const now = new Date();
            const todayKey = SCHEDULE_DAYS[(now.getDay() + 6) % 7];
            const nowPercent = (now.getHours() * 60 + now.getMinutes()) / 1440 * 100;

            const activeBadge = schedule.active === false
                ? '<span class="badge schedule-badge-inactive" title="Zeitprogramm ist am Gerät nicht aktiv">inaktiv</span>'
                : '';

            const rows = SCHEDULE_DAYS.map(day => {
                const entries = (schedule.entries && schedule.entries[day]) || [];
                const segments = entries.map(e => {
                    const start = scheduleToMinutes(e.start);
                    const end = scheduleToMinutes(e.end);
                    const left = start / 1440 * 100;
                    const width = Math.max((end - start) / 1440 * 100, 0.5);
                    return `<div class="schedule-segment" style="left: ${left}%; width: ${width}%; background: ${scheduleModeColor(e.mode)};"
                                 title="${e.start}–${e.end} ${scheduleModeLabel(e.mode)}"></div>`;
                }).join('');
                const text = entries.length
                    ? entries.map(e => `${e.start}–${e.end}`).join(', ')
                    : scheduleModeLabel(constraints.defaultMode);
                const isToday = day === todayKey;

                return `
                    <div class="schedule-row ${isToday ? 'schedule-today' : ''}">
                        <span class="schedule-day">${SCHEDULE_DAY_LABELS[day]}</span>
                        <div class="schedule-bar">
                            ${segments}
                            ${isToday ? `<div class="schedule-now" style="left: ${nowPercent}%;" title="Jetzt"></div>` : ''}
                        </div>
                        <span class="schedule-times" title="${text}">${text}</span>
                    </div>
                `;
            }).join('');

            // Legend only makes sense with more than one mode
            const usedModes = new Set();
            SCHEDULE_DAYS.forEach(day => ((schedule.entries && schedule.entries[day]) || []).forEach(e => usedModes.add(e.mode)));
            const legend = constraints.modes.length > 1 || usedModes.size > 1
                ? `<div class="schedule-legend">${[...new Set([...constraints.modes, ...usedModes])].map(mode =>
                    `<span><i style="background: ${scheduleModeColor(mode)};"></i>${scheduleModeLabel(mode)}</span>`).join('')}
                    <span><i class="schedule-legend-default"></i>${scheduleModeLabel(constraints.defaultMode)}</span></div>`
                : '';

            return `
                <div class="schedule-block">
                    <div class="schedule-block-header">
                        <span class="schedule-block-title">${def.icon} ${def.title} ${activeBadge}</span>
                        ${schedule.writable ? `<button class="schedule-edit-btn" onclick="openScheduleEditor('${def.feature}')">✏️ Bearbeiten</button>` : ''}
                    </div>
                    <div class="schedule-axis">
                        <span></span>
                        <div class="schedule-axis-ticks">${[0, 6, 12, 18, 24].map(h => `<span style="left: ${h / 24 * 100}%;">${h}</span>`).join('')}</div>
                        <span></span>
                    </div>
                    ${rows}
                    ${legend}
                </div>
            `;
        }

        // --- Schedule Editor ---

        function openScheduleEditor(feature) {
            const schedule = window.currentSchedules && window.currentSchedules[feature];
            if (!schedule) return;

            const def = SCHEDULE_DEFINITIONS.find(d => d.feature === feature) || { title: feature, icon: '🕒' };
            const entries = {};
            SCHEDULE_DAYS.forEach(day => {
                entries[day] = ((schedule.entries && schedule.entries[day]) || []).map(e => ({ start: e.start, end: e.end, mode: e.mode }));
            });

            window.scheduleEditState = {
                feature,
                def,
                constraints: getScheduleConstraints(schedule),
                entries
            };

            const modal = document.createElement('div');
            modal.className = 'debug-modal';
            modal.id = 'scheduleEditorModal';
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="schedule-editor">
                    <h2>${def.icon} Zeitplan ${def.title}</h2>
                    <div id="scheduleEditorBody"></div>
                    <div id="scheduleEditorError" class="schedule-editor-error"></div>
                    <div class="schedule-editor-actions">
                        <button id="scheduleSaveBtn" onclick="saveSchedule()">💾 Speichern</button>
                        <button class="schedule-btn-secondary" onclick="closeScheduleEditor()">Abbrechen</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeScheduleEditor();
                }
            });

            renderScheduleEditorBody();
        }

        function closeScheduleEditor() {
            const modal = document.getElementById('scheduleEditorModal');
            if (modal) {
                modal.remove();
            }
            window.scheduleEditState = null;
        }

        function scheduleTimeOptions(from, to, step, selected) {
            const values = [];
            for (let m = from; m <= to; m += step) {
                values.push(scheduleFromMinutes(m));
            }
            // Keep values which are not on the raster (e.g. set via ViCare app)
            if (selected && !values.includes(selected)) {
                values.push(selected);
                values.sort();
            }
            return values.map(v => `<option value="${v}" ${v === selected ? 'selected' : ''}>${v}</option>`).join('');
        }

        // Returns error message per day (or null)
        function validateScheduleDay(entries, constraints) {
            if (entries.length > constraints.maxEntries) {
                return `Maximal ${constraints.maxEntries} Zeitfenster erlaubt`;
            }
            const sorted = [...entries].sort((a, b) => a.start.localeCompare(b.start));
            for (let i = 0; i < sorted.length; i++) {
                if (scheduleToMinutes(sorted[i].start) >= scheduleToMinutes(sorted[i].end)) {
                    return `${sorted[i].start}–${sorted[i].end}: Start muss vor Ende liegen`;
                }
                if (!constraints.overlapAllowed && i > 0 && scheduleToMinutes(sorted[i].start) < scheduleToMinutes(sorted[i - 1].end)) {
                    return `${sorted[i].start}–${sorted[i].end} überschneidet sich mit ${sorted[i - 1].start}–${sorted[i - 1].end}`;
                }
            }
            return null;
        }

        function renderScheduleEditorBody() {
            const state = window.scheduleEditState;
            if (!state) return;
            const { constraints, entries } = state;
            const step = constraints.resolution;

            const hint = `max. ${constraints.maxEntries} Zeitfenster pro Tag · ${step}-Minuten-Raster · außerhalb der Zeitfenster: ${scheduleModeLabel(constraints.defaultMode)}`;

            const presets = SCHEDULE_PRESETS.map((p, i) =>
                `<button class="schedule-btn-small" onclick="applySchedulePreset(${i})">${p.label}</button>`).join('');

            const days = SCHEDULE_DAYS.map(day => {
                const dayEntries = entries[day];
                const error = validateScheduleDay(dayEntries, constraints);

                const rows = dayEntries.map((e, idx) => `
                    <div class="schedule-entry">
                        <select onchange="updateScheduleEntry('${day}', ${idx}, 'start', this.value)">
                            ${scheduleTimeOptions(0, 1440 - step, step, e.start)}
                        </select>
                        <span>–</span>
                        <select onchange="updateScheduleEntry('${day}', ${idx}, 'end', this.value)">
                            ${scheduleTimeOptions(step, 1440, step, e.end)}
                        </select>
                        ${constraints.modes.length > 1 ? `
                        <select onchange="updateScheduleEntry('${day}', ${idx}, 'mode', this.value)">
                            ${constraints.modes.map(m => `<option value="${m}" ${m === e.mode ? 'selected' : ''}>${scheduleModeLabel(m)}</option>`).join('')}
                        </select>` : ''}
                        <button class="schedule-btn-icon" title="Zeitfenster entfernen" onclick="removeScheduleEntry('${day}', ${idx})">✕</button>
                    </div>
                `).join('');

                return `
                    <div class="schedule-editor-day ${error ? 'has-error' : ''}">
                        <div class="schedule-editor-day-header">
                            <strong>${SCHEDULE_DAY_LABELS[day]}</strong>
                            <div class="schedule-editor-day-tools">
                                <button class="schedule-btn-small" ${dayEntries.length >= constraints.maxEntries ? 'disabled' : ''}
                                        onclick="addScheduleEntry('${day}')">+ Zeitfenster</button>
                                <select class="schedule-copy-select" onchange="copyScheduleDay('${day}', this.value); this.value = '';">
                                    <option value="">Kopieren nach…</option>
                                    <option value="all">alle Tage</option>
                                    <option value="weekdays">Mo–Fr</option>
                                    <option value="weekend">Sa–So</option>
                                    ${SCHEDULE_DAYS.filter(d => d !== day).map(d => `<option value="${d}">${SCHEDULE_DAY_LABELS[d]}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        ${rows || `<div class="schedule-editor-empty">${scheduleModeLabel(constraints.defaultMode)} (keine Zeitfenster)</div>`}
                        ${error ? `<div class="schedule-editor-day-error">⚠️ ${error}</div>` : ''}
                    </div>
                `;
            }).join('');

            document.getElementById('scheduleEditorBody').innerHTML = `
                <p class="schedule-editor-hint">${hint}</p>
                <div class="schedule-editor-presets"><span>Vorlage für alle Tage:</span>${presets}
                    <button class="schedule-btn-small" onclick="applySchedulePreset(-1)">Alle leeren</button>
                </div>
                ${days}
            `;

            const hasErrors = SCHEDULE_DAYS.some(day => validateScheduleDay(entries[day], constraints));
            document.getElementById('scheduleSaveBtn').disabled = hasErrors;
        }

        function updateScheduleEntry(day, idx, field, value) {
            window.scheduleEditState.entries[day][idx][field] = value;
            renderScheduleEditorBody();
        }

        function removeScheduleEntry(day, idx) {
            window.scheduleEditState.entries[day].splice(idx, 1);
            renderScheduleEditorBody();
        }

        function addScheduleEntry(day) {
            const { constraints, entries } = window.scheduleEditState;
            const dayEntries = entries[day];
            if (dayEntries.length >= constraints.maxEntries) return;

            // Place the new window after the last one (default 1h), or at 06:00 on an empty day
            const lastEnd = dayEntries.reduce((max, e) => Math.max(max, scheduleToMinutes(e.end)), 0);
            let start = dayEntries.length ? lastEnd : 6 * 60;
            if (start >= 1440) start = 1440 - 60;
            const end = Math.min(start + 60, 1440);
            dayEntries.push({ start: scheduleFromMinutes(start), end: scheduleFromMinutes(end), mode: constraints.modes[0] });
            renderScheduleEditorBody();
        }

        function copyScheduleDay(sourceDay, target) {
            if (!target) return;
            const { entries } = window.scheduleEditState;
            let targets;
            if (target === 'all') targets = SCHEDULE_DAYS;
            else if (target === 'weekdays') targets = ['mon', 'tue', 'wed', 'thu', 'fri'];
            else if (target === 'weekend') targets = ['sat', 'sun'];
            else targets = [target];

            targets.filter(d => d !== sourceDay).forEach(d => {
                entries[d] = entries[sourceDay].map(e => ({ ...e }));
            });
            renderScheduleEditorBody();
        }

        function applySchedulePreset(index) {
            const { constraints, entries } = window.scheduleEditState;
            const preset = index >= 0 ? SCHEDULE_PRESETS[index] : { entries: [] };
            SCHEDULE_DAYS.forEach(day => {
                entries[day] = preset.entries.map(([start, end]) => ({ start, end, mode: constraints.modes[0] }));
            });
            renderScheduleEditorBody();
        }

        async function saveSchedule() {
            const state = window.scheduleEditState;
            if (!state) return;

            const device = window.currentDeviceInfo;
            if (!device || !device.accountId) {
                alert('Kein Account für dieses Gerät verfügbar');
                return;
            }

            const schedule = {};
            SCHEDULE_DAYS.forEach(day => {
                schedule[day] = [...state.entries[day]]
                    .sort((a, b) => a.start.localeCompare(b.start))
                    .map((e, position) => ({ start: e.start, end: e.end, mode: e.mode, position }));
            });

            const saveBtn = document.getElementById('scheduleSaveBtn');
            const errorDiv = document.getElementById('scheduleEditorError');
            saveBtn.disabled = true;
            saveBtn.textContent = '⏳ Speichere...';
            errorDiv.textContent = '';

            try {
                const response = await fetch('/api/schedule/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        accountId: device.accountId,
                        installationId: device.installationId,
                        gatewaySerial: device.gatewaySerial,
                        deviceId: device.deviceId,
                        feature: state.feature,
                        schedule
                    })
                });
                const data = await response.json();

                if (data.success) {
                    console.log('Schedule saved:', state.feature, schedule);
                    closeScheduleEditor();
                    // Wait a bit then reload to show new schedule
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    errorDiv.textContent = 'Fehler beim Speichern: ' + data.error;
                    saveBtn.disabled = false;
                    saveBtn.textContent = '💾 Speichern';
                }
            } catch (error) {
                errorDiv.textContent = 'Fehler beim Speichern: ' + error.message;
                saveBtn.disabled = false;
                saveBtn.textContent = '💾 Speichern';
            }
        }

        window.openScheduleEditor = openScheduleEditor;
        window.closeScheduleEditor = closeScheduleEditor;
        window.saveSchedule = saveSchedule;
