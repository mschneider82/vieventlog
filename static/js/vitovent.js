let currentInstallationId = null;
let installations = [];
let currentDevice = null;
let currentAccount = null;

// Parse URL parameters
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('installationId')) {
    currentInstallationId = urlParams.get('installationId');
}

async function init() {
    await loadDevices();
    if (currentInstallationId) {
        await loadVitoventData();
    }
}

async function loadDevices() {
    try {
        const response = await fetch('/api/devices');
        const devicesByInstall = await response.json();
        installations = devicesByInstall;

        const installSelect = document.getElementById('installationSelect');
        installSelect.innerHTML = '';

        devicesByInstall.forEach(install => {
            const option = document.createElement('option');
            option.value = install.installationId;
            option.textContent = `${install.description || install.installationId} - ${install.location}`;
            if (install.installationId === currentInstallationId) {
                option.selected = true;
            }
            installSelect.appendChild(option);
        });

        // Set first installation if none selected
        if (!currentInstallationId && devicesByInstall.length > 0) {
            currentInstallationId = devicesByInstall[0].installationId;
            installSelect.value = currentInstallationId;
        }

        // Update current installation display
        const selectedInstall = devicesByInstall.find(i => i.installationId === currentInstallationId);
        if (selectedInstall) {
            document.getElementById('currentInstallation').textContent =
                selectedInstall.description || selectedInstall.installationId;
        }

        // Add change handler
        installSelect.addEventListener('change', (e) => {
            currentInstallationId = e.target.value;
            const selected = devicesByInstall.find(i => i.installationId === currentInstallationId);
            if (selected) {
                document.getElementById('currentInstallation').textContent =
                    selected.description || selected.installationId;
            }
            loadVitoventData();
        });

    } catch (error) {
        showError('Fehler beim Laden der Geräte: ' + error.message);
    }
}

async function loadVitoventData(forceRefresh = false) {
    const contentDiv = document.getElementById('vitoventContent');
    contentDiv.className = 'loading';
    contentDiv.innerHTML = '<div class="spinner"></div><p>Lade Vitovent-Daten...</p>';

    try {
        const refreshParam = forceRefresh ? '&refresh=true' : '';
        const response = await fetch(`/api/vitovent/devices?installationId=${currentInstallationId}${refreshParam}`);

        if (!response.ok) {
            throw new Error('API Fehler: ' + response.status);
        }

        const data = await response.json();

        console.log('Vitovent API Response:', data);

        if (!data.device) {
            contentDiv.className = 'no-device';
            contentDiv.innerHTML = '<div class="no-device">Kein Vitovent-System in dieser Installation gefunden</div>';
            console.warn('No Vitovent device found in installation:', currentInstallationId);
            return;
        }

        console.log('Found Vitovent device:', data.device.modelId, 'DeviceID:', data.device.deviceId);
        currentDevice = data.device;
        currentAccount = {
            id: data.device.accountId,
            installationId: data.installationId,
            gatewaySerial: data.device.gatewaySerial
        };

        renderVitoventDevice(data);
        updateLastUpdate();

    } catch (error) {
        showError('Fehler beim Laden der Daten: ' + error.message);
        contentDiv.innerHTML = '<div class="error">Fehler beim Laden der Daten: ' + error.message + '</div>';
    }
}

function renderVitoventDevice(data) {
    const contentDiv = document.getElementById('vitoventContent');
    contentDiv.className = 'vitovent-container';

    const device = data.device;
    const features = device.features;

    let html = `
        <div class="device-card">
            <div class="device-header">
                <h2>🌬️ ${device.name || 'Vitovent System'}</h2>
                <div class="device-meta">Model: ${device.modelId}</div>
            </div>
            <div class="device-sections">
    `;

    // Operating Modes Section - adapt to device type
    const isVitoair = features.device_type === 'vitoair';
    const is300F = features.device_type === 'vitovent300f';

    html += `
        <div class="section operating-mode-section">
            <div class="section-title">⚙️ Betriebsmodus</div>
            <div class="status-badge ${getOperatingModeBadgeClass(features.operating_mode)}">
                ${formatOperatingMode(features.operating_mode)}
            </div>
    `;

    if (isVitoair) {
        // VitoAir: Complex mode selection
        html += `
            <div class="control-group">
                <label class="control-label">Modus ändern</label>
                <div class="mode-selector">
                    <button class="mode-btn ${features.operating_mode === 'permanent' ? 'active' : ''}"
                            onclick="setOperatingMode('permanent')">Konstant</button>
                    <button class="mode-btn ${features.operating_mode === 'ventilation' ? 'active' : ''}"
                            onclick="setOperatingMode('ventilation')">Programm</button>
                    <button class="mode-btn ${features.operating_mode === 'sensorOverride' ? 'active' : ''}"
                            onclick="setOperatingMode('sensorOverride')">Sensor+Prog</button>
                    <button class="mode-btn ${features.operating_mode === 'sensorDriven' ? 'active' : ''}"
                            onclick="setOperatingMode('sensorDriven')">Auto-Sensor</button>
                </div>
            </div>
        `;
    } else if (is300F) {
        // Vitovent 300F: Simple mode selection
        html += `
            <div class="control-group">
                <label class="control-label">Modus ändern</label>
                <div class="mode-selector">
                    <button class="mode-btn ${features.operating_mode === 'standby' ? 'active' : ''}"
                            onclick="setOperatingMode('standby')">Standby</button>
                    <button class="mode-btn ${features.operating_mode === 'standard' ? 'active' : ''}"
                            onclick="setOperatingMode('standard')">Standard</button>
                    <button class="mode-btn ${features.operating_mode === 'ventilation' ? 'active' : ''}"
                            onclick="setOperatingMode('ventilation')">Lüftung</button>
                </div>
            </div>
        `;
    }

    if (features.operating_state) {
        html += `
            <div class="operating-state">
                <div class="state-item">
                    <span class="state-label">Level:</span>
                    <span class="state-value">${formatLevel(features.operating_state.level)}</span>
                </div>
                <div class="state-item">
                    <span class="state-label">Grund:</span>
                    <span class="state-value">${features.operating_state.reason || '-'}</span>
                </div>
                ${features.operating_state.demand ? `
                <div class="state-item">
                    <span class="state-label">Nachfrage:</span>
                    <span class="state-value">${features.operating_state.demand}</span>
                </div>
                ` : ''}
            </div>
        `;
    }

    html += '</div>';

    // Quick Modes Section - device-specific
    html += `
        <div class="section quickmodes-section">
            <div class="section-title">⚡ Schnellwahl-Modi</div>
    `;

    if (isVitoair) {
        // VitoAir quick modes
        if (features.quickmode_intensive) {
            const active = features.quickmode_intensive.active;
            html += `
                <button class="quickmode-button ${active ? 'active' : ''}" onclick="toggleQuickMode('forcedLevelFour', ${!active})">
                    <span>💨 Intensivlüftung ${active ? '(aktiv)' : ''}</span>
                    <span class="quickmode-info">${features.quickmode_intensive.runtime || 30} Min</span>
                </button>
            `;
        }

        if (features.quickmode_silent) {
            const active = features.quickmode_silent.active;
            html += `
                <button class="quickmode-button ${active ? 'active' : ''}" onclick="toggleQuickMode('silent', ${!active})">
                    <span>🔇 Geräuschreduziert ${active ? '(aktiv)' : ''}</span>
                    <span class="quickmode-info">${features.quickmode_silent.runtime || 30} Min</span>
                </button>
            `;
        }

        if (features.quickmode_shutdown) {
            const active = features.quickmode_shutdown.active;
            html += `
                <button class="quickmode-button ${active ? 'active' : ''}" onclick="toggleQuickMode('temporaryShutdown', ${!active})">
                    <span>⏸️ Temp. Abschaltung ${active ? '(aktiv)' : ''}</span>
                    <span class="quickmode-info">${features.quickmode_shutdown.runtime || 360} Min</span>
                </button>
            `;
        }
    } else if (is300F) {
        // Vitovent 300F quick modes
        if (features.quickmode_comfort) {
            const active = features.quickmode_comfort.active;
            html += `
                <button class="quickmode-button ${active ? 'active' : ''}" onclick="toggleQuickMode('comfort', ${!active})">
                    <span>🛋️ Komfort ${active ? '(aktiv)' : ''}</span>
                </button>
            `;
        }

        if (features.quickmode_eco) {
            const active = features.quickmode_eco.active;
            html += `
                <button class="quickmode-button ${active ? 'active' : ''}" onclick="toggleQuickMode('eco', ${!active})">
                    <span>♻️ Eco ${active ? '(aktiv)' : ''}</span>
                </button>
            `;
        }

        if (features.quickmode_holiday) {
            const active = features.quickmode_holiday.active;
            const dateInfo = (features.quickmode_holiday.start || features.quickmode_holiday.end)
                ? `${features.quickmode_holiday.start} bis ${features.quickmode_holiday.end}`
                : 'nicht aktiv';
            html += `
                <button class="quickmode-button ${active ? 'active' : ''}" onclick="toggleQuickMode('holiday', ${!active})">
                    <span>🏖️ Urlaubsmodus ${active ? '(aktiv)' : ''}</span>
                    <span class="quickmode-info" style="font-size: 0.85em;">${dateInfo}</span>
                </button>
            `;
        }
    }

    html += '</div>';

    // Vitovent 300F: Volume Flow Levels Section
    if (is300F && (features.level_one_volumeflow !== undefined || features.level_two_volumeflow !== undefined ||
                   features.level_three_volumeflow !== undefined || features.level_four_volumeflow !== undefined)) {
        html += `
            <div class="section levels-section">
                <div class="section-title">📊 Lüftungsstufen</div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
        `;

        if (features.level_one_volumeflow !== undefined) {
            html += `
                <div class="sensor-row">
                    <span class="sensor-label">Stufe 1:</span>
                    <span class="sensor-value">${features.level_one_volumeflow} m³/h</span>
                </div>
            `;
        }
        if (features.level_two_volumeflow !== undefined) {
            html += `
                <div class="sensor-row">
                    <span class="sensor-label">Stufe 2:</span>
                    <span class="sensor-value">${features.level_two_volumeflow} m³/h</span>
                </div>
            `;
        }
        if (features.level_three_volumeflow !== undefined) {
            html += `
                <div class="sensor-row">
                    <span class="sensor-label">Stufe 3:</span>
                    <span class="sensor-value">${features.level_three_volumeflow} m³/h</span>
                </div>
            `;
        }
        if (features.level_four_volumeflow !== undefined) {
            html += `
                <div class="sensor-row">
                    <span class="sensor-label">Stufe 4:</span>
                    <span class="sensor-value">${features.level_four_volumeflow} m³/h</span>
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;
    }

    // Sensors Section - Temperatures (VitoAir specific)
    if (isVitoair) {
        html += `
            <div class="section temperature-section">
                <div class="section-title">🌡️ Temperaturen</div>
        `;
    } else {
        // For 300F, only show volume flow section (no temperature sensors)
        html += `
            <div class="section temperature-section" style="display: none;">
                <div class="section-title">🌡️ Temperaturen</div>
        `;
    }

    if (features.temp_supply !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Zuluft:</span>
                <span class="sensor-value">${features.temp_supply.toFixed(1)}°C</span>
            </div>
        `;
    }
    if (features.temp_extract !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Abluft (Raum):</span>
                <span class="sensor-value">${features.temp_extract.toFixed(1)}°C</span>
            </div>
        `;
    }
    if (features.temp_exhaust !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Fortluft:</span>
                <span class="sensor-value">${features.temp_exhaust.toFixed(1)}°C</span>
            </div>
        `;
    }
    if (features.temp_outside !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Außentemperatur:</span>
                <span class="sensor-value">${features.temp_outside.toFixed(1)}°C</span>
            </div>
        `;
    }
    if (features.heat_recovery !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Wärmerückgewinnung:</span>
                <span class="sensor-value">${features.heat_recovery.toFixed(0)}%</span>
            </div>
        `;
    }

    html += '</div>';

    // Humidity Section
    html += `
        <div class="section humidity-section">
            <div class="section-title">💧 Luftfeuchte</div>
    `;

    if (features.humidity_supply !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Zuluft:</span>
                <span class="sensor-value">${features.humidity_supply.toFixed(0)}%</span>
            </div>
        `;
    }
    if (features.humidity_extract !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Abluft (Raum):</span>
                <span class="sensor-value">${features.humidity_extract.toFixed(0)}%</span>
            </div>
        `;
    }
    if (features.humidity_exhaust !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Fortluft:</span>
                <span class="sensor-value">${features.humidity_exhaust.toFixed(0)}%</span>
            </div>
        `;
    }
    if (features.humidity_outdoor !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Außenluft:</span>
                <span class="sensor-value">${features.humidity_outdoor.toFixed(0)}%</span>
            </div>
        `;
    }

    html += '</div>';

    // Volume Flow Section
    html += `
        <div class="section volumeflow-section">
            <div class="section-title">💨 Luftmenge</div>
    `;

    if (features.volumeflow_input !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Zu:</span>
                <span class="sensor-value">${features.volumeflow_input.toFixed(0)} m³/h</span>
            </div>
        `;
    }
    if (features.volumeflow_output !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Ab:</span>
                <span class="sensor-value">${features.volumeflow_output.toFixed(0)} m³/h</span>
            </div>
        `;
    }
    if (features.current_level !== undefined) {
        html += `
            <div class="sensor-row">
                <span class="sensor-label">Aktuell Level:</span>
                <span class="sensor-value">${formatLevel(features.current_level)}</span>
            </div>
        `;
    }

    html += '</div>';

    // Fan Status Section
    html += `
        <div class="section fan-section">
            <div class="section-title">🔄 Ventilatoren</div>
    `;

    if (features.fan_supply) {
        const statusClass = features.fan_supply.status === 'connected' ? 'active' : 'inactive';
        html += `
            <div>
                <div class="sensor-label">Zuluft-Ventilator</div>
                <div class="fan-status">
                    <span class="status-badge ${statusClass}">${features.fan_supply.status || 'unbekannt'}</span>
                    <span class="rpm-display">${features.fan_supply.current_rpm} U/min</span>
                </div>
                ${features.fan_supply_runtime !== undefined ? `<div class="sensor-label">Laufzeit: ${(features.fan_supply_runtime / 1).toFixed(0)} h</div>` : ''}
            </div>
        `;
    }

    if (features.fan_exhaust) {
        const statusClass = features.fan_exhaust.status === 'connected' ? 'active' : 'inactive';
        html += `
            <div style="margin-top: 12px;">
                <div class="sensor-label">Fortluft-Ventilator</div>
                <div class="fan-status">
                    <span class="status-badge ${statusClass}">${features.fan_exhaust.status || 'unbekannt'}</span>
                    <span class="rpm-display">${features.fan_exhaust.current_rpm} U/min</span>
                </div>
                ${features.fan_exhaust_runtime !== undefined ? `<div class="sensor-label">Laufzeit: ${(features.fan_exhaust_runtime / 1).toFixed(0)} h</div>` : ''}
            </div>
        `;
    }

    html += '</div>';

    // Filter Section
    html += `
        <div class="section filter-section">
            <div class="section-title">🔧 Filter</div>
    `;

    if (features.filter_pollution) {
        const pollution = features.filter_pollution.pollution || 0;
        html += `
            <div class="sensor-label">Verschmutzung: ${pollution.toFixed(0)}%</div>
            <div class="filter-bar">
                <div class="filter-fill" style="width: ${Math.min(pollution, 100)}%"></div>
            </div>
        `;
    }

    if (features.filter_runtime) {
        html += `
            <div class="sensor-row" style="margin-top: 8px;">
                <span class="sensor-label">Verbleibend:</span>
                <span class="sensor-value">${features.filter_runtime.remaining_hours || '-'} h</span>
            </div>
            <div class="sensor-row">
                <span class="sensor-label">Betrieb:</span>
                <span class="sensor-value">${features.filter_runtime.operating_hours || '-'} h</span>
            </div>
        `;
    }

    html += '</div>';

    // Bypass Section (if available)
    if (features.bypass_available) {
        html += `
            <div class="section bypass-config-section">
                <div class="section-title">🌡️ Bypass</div>
                <div class="bypass-section">
                    <div class="status-badge ${features.bypass_available ? 'active' : 'inactive'}">
                        ${features.bypass_available ? 'Vorhanden' : 'Nicht vorhanden'}
                    </div>
                    ${features.bypass_mode ? `
                        <div class="bypass-info">
                            <div class="state-item">
                                <span class="state-label">Betriebsart:</span>
                                <span class="state-value">${features.bypass_mode.state || '-'}</span>
                            </div>
                            <div class="state-item">
                                <span class="state-label">Arbeitsweise:</span>
                                <span class="state-value">${formatBypassLevel(features.bypass_mode.level)}</span>
                            </div>
                        </div>
                    ` : ''}
                    ${features.bypass_position !== undefined ? `
                        <div class="bypass-info">
                            <div class="state-item">
                                <span class="state-label">Position:</span>
                                <span class="state-value">${features.bypass_position.toFixed(0)}%</span>
                            </div>
                        </div>
                    ` : ''}
                    ${features.bypass_temp_dynamic !== undefined ? `
                        <div class="bypass-info">
                            <div class="state-item">
                                <span class="state-label">Min. Temp (Dynamisch):</span>
                                <span class="state-value">${features.bypass_temp_dynamic.toFixed(1)}°C</span>
                            </div>
                        </div>
                    ` : ''}
                    ${features.bypass_temp_smooth !== undefined ? `
                        <div class="bypass-info">
                            <div class="state-item">
                                <span class="state-label">Min. Temp (Sanft):</span>
                                <span class="state-value">${features.bypass_temp_smooth.toFixed(1)}°C</span>
                            </div>
                        </div>
                    ` : ''}
                    ${features.bypass_target_temp !== undefined ? `
                        <div class="bypass-info">
                            <div class="state-item">
                                <span class="state-label">Zieltemperatur:</span>
                                <span class="state-value">${features.bypass_target_temp.toFixed(1)}°C</span>
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    html += '</div></div>'; // Close device-sections and device-card

    contentDiv.innerHTML = html;

    // Add event listeners for mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Remove active class from all buttons
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            // Add to clicked button
            e.target.classList.add('active');
        });
    });
}

function formatOperatingMode(mode) {
    const modes = {
        // VitoAir modes
        'permanent': 'Konstantbetrieb',
        'ventilation': 'Zeitprogramm',
        'sensorOverride': 'Zeitprogramm + Sensor',
        'sensorDriven': 'Sensor-Automatikmodus',
        // Vitovent 300F modes
        'standby': 'Standby',
        'standard': 'Standard',
    };
    return modes[mode] || mode;
}

function formatLevel(level) {
    const levels = {
        'levelOne': 'Stufe 1',
        'levelTwo': 'Stufe 2',
        'levelThree': 'Stufe 3',
        'levelFour': 'Stufe 4'
    };
    return levels[level] || level;
}

function formatBypassLevel(level) {
    const levels = {
        'dynamicRegulationMode': 'Dynamisch',
        'smoothRegulation': 'Geräuschreduziert'
    };
    return levels[level] || level;
}

function getOperatingModeBadgeClass(mode) {
    switch(mode) {
        // VitoAir modes - active when running
        case 'permanent': return 'active';
        case 'sensorDriven': return 'active';
        case 'ventilation': return 'active';
        // Vitovent 300F modes - active when in ventilation mode
        case 'ventilation': return 'active';
        case 'standard': return 'active';
        case 'standby': return '';
        default: return '';
    }
}

async function setOperatingMode(mode) {
    if (!currentDevice || !currentAccount) return;

    try {
        const response = await fetch('/api/vitovent/operating-mode/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accountId: currentAccount.id,
                installationId: currentAccount.installationId,
                gatewaySerial: currentDevice.gatewaySerial,
                deviceId: currentDevice.deviceId,
                mode: mode
            })
        });

        const result = await response.json();

        if (result.success) {
            showSuccess(`Betriebsmodus zu "${formatOperatingMode(mode)}" geändert`);
            // Reload data after a short delay (force refresh to clear cache)
            setTimeout(() => loadVitoventData(true), 1000);
        } else {
            showError('Fehler: ' + (result.error || 'Unbekannter Fehler'));
        }
    } catch (error) {
        showError('Fehler beim Ändern des Modus: ' + error.message);
    }
}

async function toggleQuickMode(mode, activate) {
    if (!currentDevice || !currentAccount) return;

    try {
        const response = await fetch('/api/vitovent/quickmode/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accountId: currentAccount.id,
                installationId: currentAccount.installationId,
                gatewaySerial: currentDevice.gatewaySerial,
                deviceId: currentDevice.deviceId,
                mode: mode,
                active: activate
            })
        });

        const result = await response.json();

        if (result.success) {
            const action = activate ? 'aktiviert' : 'deaktiviert';
            showSuccess(`Modus ${action}`);
            // Reload data after a short delay (force refresh to clear cache)
            setTimeout(() => loadVitoventData(true), 1000);
        } else {
            showError('Fehler: ' + (result.error || 'Unbekannter Fehler'));
        }
    } catch (error) {
        showError('Fehler: ' + error.message);
    }
}

function updateLastUpdate() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent = now.toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function showError(message) {
    const errorContainer = document.getElementById('errorContainer');
    errorContainer.innerHTML = `<div class="error-message">${message}</div>`;
    setTimeout(() => {
        errorContainer.innerHTML = '';
    }, 5000);
}

function showSuccess(message) {
    const errorContainer = document.getElementById('errorContainer');
    errorContainer.innerHTML = `<div class="success-message">${message}</div>`;
    setTimeout(() => {
        errorContainer.innerHTML = '';
    }, 3000);
}

// Handle refresh button
document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadVitoventData(true); // Force refresh
        });
    }
    init();
});
