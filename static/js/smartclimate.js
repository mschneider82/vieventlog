let currentInstallationId = null;
let installations = [];
let autoRefreshInterval = null;

// Parse URL parameters
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('installationId')) {
    currentInstallationId = urlParams.get('installationId');
}

async function init() {
    await loadDevices();
    if (currentInstallationId) {
        await loadSmartClimateDevices();
        startAutoRefresh();
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

    } catch (error) {
        showError('Fehler beim Laden der Geräte: ' + error.message);
    }
}

async function loadSmartClimateDevices(forceRefresh = false) {
    const contentDiv = document.getElementById('smartclimateContent');
    contentDiv.className = 'loading';
    contentDiv.innerHTML = '<div class="spinner"></div><p>Lade SmartClimate-Geräte...</p>';

    try {
        const response = await fetch(`/api/smartclimate/devices?installationId=${currentInstallationId}`);
        if (!response.ok) {
            throw new Error('API Fehler: ' + response.status);
        }

        const data = await response.json();
        renderSmartClimateDevices(data);
        updateLastUpdate();

    } catch (error) {
        showError('Fehler beim Laden der SmartClimate-Geräte: ' + error.message);
        contentDiv.innerHTML = '<div class="error">Fehler beim Laden der Daten: ' + error.message + '</div>';
    }
}

function renderSmartClimateDevices(data) {
    const contentDiv = document.getElementById('smartclimateContent');
    contentDiv.className = 'smartclimate-container';

    if (!data.categories || data.categories.length === 0) {
        contentDiv.innerHTML = '<div class="no-devices">Keine SmartClimate-Geräte gefunden</div>';
        return;
    }

    let html = '';

    data.categories.forEach(category => {
        html += `
            <div class="category-section">
                <h2 class="category-header">
                    <span class="category-icon">${category.icon}</span>
                    ${category.name}
                    <span class="device-count">${category.devices.length}</span>
                </h2>
                <div class="devices-grid">
                    ${category.devices.map(device => renderDeviceCard(device)).join('')}
                </div>
            </div>
        `;
    });

    contentDiv.innerHTML = html;
    attachEventListeners();
}

function renderDeviceCard(device) {
    const category = device.category;

    // Different rendering based on category
    switch(category) {
        case 'climate_sensors':
            return renderClimateSensorCard(device);
        case 'radiator_thermostats':
            return renderRadiatorThermostatCard(device);
        case 'floor_thermostats':
            return renderFloorThermostatCard(device);
        case 'repeaters':
            return renderRepeaterCard(device);
        case 'room_control':
            return renderRoomControlCard(device);
        default:
            return renderGenericCard(device);
    }
}

function renderClimateSensorCard(device) {
    const temp = device.features.temperature ? device.features.temperature.toFixed(1) : '-';
    const humidity = device.features.humidity ? Math.round(device.features.humidity) : '-';
    const battery = device.battery !== null ? device.battery : '-';
    const signal = device.signalStrength !== null ? device.signalStrength : '-';

    return `
        <div class="device-card climate-sensor" data-device-id="${device.deviceId}">
            <div class="device-header">
                <div class="device-name-container">
                    <h3 class="device-name-display" id="name-display-${device.deviceId}">${device.name}</h3>
                    <input type="text" class="device-name-edit" id="name-edit-${device.deviceId}" value="${device.name}" style="display: none;" maxlength="40">
                </div>
                <div class="device-header-actions">
                    <span class="device-id">${device.deviceId}</span>
                    <button class="edit-name-btn"
                            data-device-id="${device.deviceId}"
                            data-gateway="${device.gatewaySerial}"
                            data-installation="${device.installationId}"
                            data-account="${device.accountId}"
                            title="Namen bearbeiten">✏️</button>
                </div>
            </div>
            <div class="device-body">
                <div class="sensor-reading main">
                    <span class="icon">🌡️</span>
                    <span class="value">${temp}°C</span>
                </div>
                <div class="sensor-reading">
                    <span class="icon">💧</span>
                    <span class="value">${humidity}%</span>
                </div>
            </div>
            <div class="device-footer">
                <span class="battery ${getBatteryClass(device.battery)}">🔋 ${battery}%</span>
                <span class="signal ${getSignalClass(device.signalStrength)}">📶 ${signal}%</span>
            </div>
        </div>
    `;
}

function renderRadiatorThermostatCard(device) {
    const temp = device.features.temperature ? device.features.temperature.toFixed(1) : '-';
    const setpoint = device.features.trv_setpoint ? device.features.trv_setpoint.toFixed(1) : '-';
    const valvePos = device.features.valve_position !== undefined ? Math.round(device.features.valve_position) : '-';
    const battery = device.battery !== null ? device.battery : '-';
    const signal = device.signalStrength !== null ? device.signalStrength : '-';
    const childLock = device.features.child_lock === 'active';

    return `
        <div class="device-card thermostat" data-device-id="${device.deviceId}">
            <div class="device-header">
                <div class="device-name-container">
                    <h3 class="device-name-display" id="name-display-${device.deviceId}">${device.name}</h3>
                    <input type="text" class="device-name-edit" id="name-edit-${device.deviceId}" value="${device.name}" style="display: none;" maxlength="40">
                </div>
                <div class="device-header-actions">
                    <span class="device-id">${device.deviceId}</span>
                    <div class="button-group">
                        <button class="edit-name-btn"
                                data-device-id="${device.deviceId}"
                                data-gateway="${device.gatewaySerial}"
                                data-installation="${device.installationId}"
                                data-account="${device.accountId}"
                                title="Namen bearbeiten">✏️</button>
                        <button class="child-lock-btn ${childLock ? 'active' : ''}"
                                data-device-id="${device.deviceId}"
                                data-gateway="${device.gatewaySerial}"
                                data-installation="${device.installationId}"
                                data-account="${device.accountId}"
                                data-active="${childLock}"
                                title="Kindersicherung ${childLock ? 'deaktivieren' : 'aktivieren'}">${childLock ? '🔒' : '🔓'}</button>
                    </div>
                </div>
            </div>
            <div class="device-body">
                <div class="sensor-reading main">
                    <span class="icon">🌡️</span>
                    <span class="value">${temp}°C</span>
                    <span class="label">Ist</span>
                </div>
                <div class="sensor-reading editable">
                    <span class="icon">🎯</span>
                    <div class="temp-control">
                        <button class="temp-btn minus"
                                data-device-id="${device.deviceId}"
                                data-gateway="${device.gatewaySerial}"
                                data-installation="${device.installationId}"
                                data-account="${device.accountId}"
                                data-current="${setpoint}">−</button>
                        <span class="value editable-value" id="setpoint-${device.deviceId}">${setpoint}°C</span>
                        <button class="temp-btn plus"
                                data-device-id="${device.deviceId}"
                                data-gateway="${device.gatewaySerial}"
                                data-installation="${device.installationId}"
                                data-account="${device.accountId}"
                                data-current="${setpoint}">+</button>
                    </div>
                    <span class="label">Soll</span>
                </div>
                <div class="valve-indicator">
                    <div class="valve-bar">
                        <div class="valve-fill" style="width: ${valvePos}%"></div>
                    </div>
                    <span class="valve-label">Ventil: ${valvePos}%</span>
                </div>
            </div>
            <div class="device-footer">
                <span class="battery ${getBatteryClass(device.battery)}">🔋 ${battery}%</span>
                <span class="signal ${getSignalClass(device.signalStrength)}">📶 ${signal}%</span>
                ${device.features.heating_circuit_id !== undefined ?
                    `<span class="circuit-id">HK${device.features.heating_circuit_id + 1}</span>` : ''}
            </div>
        </div>
    `;
}

function renderFloorThermostatCard(device) {
    const supplyTemp = device.features.supply_temperature !== undefined ? device.features.supply_temperature.toFixed(1) : '-';
    const mode = device.features.operating_mode || '-';
    const signal = device.signalStrength !== null ? device.signalStrength : '-';
    const maxTemp = device.features.damage_protection_threshold !== undefined ? device.features.damage_protection_threshold : '-';
    const condensation = device.features.condensation_threshold !== undefined ? device.features.condensation_threshold : '-';

    // Format LQI timestamp
    let lqiTimestampFormatted = '';
    if (device.lqiTimestamp) {
        const date = new Date(device.lqiTimestamp);
        lqiTimestampFormatted = date.toLocaleString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    return `
        <div class="device-card floor-thermostat">
            <div class="device-header">
                <h3>${device.name}</h3>
                <span class="device-id">${device.deviceId}</span>
            </div>
            <div class="device-body">
                <div class="sensor-reading main">
                    <span class="icon">🌡️</span>
                    <span class="value">${supplyTemp}°C</span>
                    <span class="label">Vorlauf</span>
                </div>
                <div class="sensor-reading">
                    <span class="icon">🔥</span>
                    <span class="value">${maxTemp}°C</span>
                    <span class="label">Max. Vorlauf</span>
                </div>
                <div class="sensor-reading">
                    <span class="icon">💧</span>
                    <span class="value">${condensation}%</span>
                    <span class="label">Kondensation</span>
                </div>
                <div class="mode-indicator">
                    <span class="mode-badge ${mode.toLowerCase()}">${translateMode(mode)}</span>
                </div>
            </div>
            <div class="device-footer">
                <span class="signal ${getSignalClass(device.signalStrength)}">📶 ${signal}%</span>
                ${lqiTimestampFormatted ? `<span class="timestamp" title="Zuletzt empfangene Daten">🕐 ${lqiTimestampFormatted}</span>` : ''}
                ${device.features.heating_circuit_id !== undefined ?
                    `<span class="circuit-id">HK${device.features.heating_circuit_id + 1}</span>` : ''}
            </div>
        </div>
    `;
}

function renderRepeaterCard(device) {
    const signal = device.signalStrength !== null ? device.signalStrength : '-';

    return `
        <div class="device-card repeater">
            <div class="device-header">
                <h3>${device.name}</h3>
                <span class="device-id">${device.deviceId}</span>
            </div>
            <div class="device-body">
                <div class="sensor-reading main">
                    <span class="icon">📡</span>
                    <span class="value">${signal}%</span>
                    <span class="label">Signal</span>
                </div>
            </div>
            <div class="device-footer">
                <span class="status-indicator online">✓ Online</span>
            </div>
        </div>
    `;
}

function renderRoomControlCard(device) {
    return `
        <div class="device-card room-control">
            <div class="device-header">
                <h3>${device.name}</h3>
                <span class="device-id">${device.deviceId}</span>
            </div>
            <div class="device-body">
                <div class="sensor-reading main">
                    <span class="icon">🎛️</span>
                    <span class="label">Raumsteuerung</span>
                </div>
            </div>
        </div>
    `;
}

function renderGenericCard(device) {
    return `
        <div class="device-card generic">
            <div class="device-header">
                <h3>${device.name}</h3>
                <span class="device-id">${device.deviceId}</span>
            </div>
            <div class="device-body">
                <p>Model: ${device.modelId}</p>
                <p>Type: ${device.deviceType}</p>
            </div>
        </div>
    `;
}

// Helper functions
function getBatteryClass(battery) {
    if (battery === null || battery === '-') return '';
    if (battery > 50) return 'good';
    if (battery > 20) return 'medium';
    return 'low';
}

function getSignalClass(signal) {
    if (signal === null || signal === '-') return '';
    if (signal > 60) return 'good';
    if (signal > 30) return 'medium';
    return 'low';
}

function translateMode(mode) {
    const translations = {
        'heating': 'Heizen',
        'cooling': 'Kühlen',
        'standby': 'Standby',
        'off': 'Aus'
    };
    return translations[mode] || mode;
}

function attachEventListeners() {
    // Child lock toggle buttons
    document.querySelectorAll('.child-lock-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const button = e.target;
            const deviceId = button.dataset.deviceId;
            const gateway = button.dataset.gateway;
            const installation = button.dataset.installation;
            const accountId = button.dataset.account;
            const currentlyActive = button.dataset.active === 'true';
            const newState = !currentlyActive;

            button.disabled = true;
            try {
                await toggleChildLock(accountId, installation, gateway, deviceId, newState);

                // Update button
                button.dataset.active = newState;
                button.textContent = newState ? '🔒' : '🔓';
                button.title = `Kindersicherung ${newState ? 'deaktivieren' : 'aktivieren'}`;
                button.classList.toggle('active', newState);

                showSuccess(`Kindersicherung ${newState ? 'aktiviert' : 'deaktiviert'}`);

                // Reload after 2 seconds
                setTimeout(() => {
                    loadSmartClimateDevices();
                }, 2000);

            } catch (error) {
                showError('Fehler beim Umschalten der Kindersicherung: ' + error.message);
            } finally {
                button.disabled = false;
            }
        });
    });

    // Name edit buttons
    document.querySelectorAll('.edit-name-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const button = e.target;
            const deviceId = button.dataset.deviceId;
            const gateway = button.dataset.gateway;
            const installation = button.dataset.installation;
            const accountId = button.dataset.account;

            const displayElem = document.getElementById(`name-display-${deviceId}`);
            const editElem = document.getElementById(`name-edit-${deviceId}`);

            if (editElem.style.display === 'none') {
                // Switch to edit mode
                displayElem.style.display = 'none';
                editElem.style.display = 'block';
                editElem.focus();
                editElem.select();
                button.textContent = '💾';
                button.title = 'Speichern';
            } else {
                // Save the name
                const newName = editElem.value.trim();
                if (newName === '' || newName.length > 40) {
                    showError('Name muss zwischen 1 und 40 Zeichen lang sein');
                    return;
                }

                button.disabled = true;
                try {
                    await setDeviceName(accountId, installation, gateway, deviceId, newName);

                    // Update display
                    displayElem.textContent = newName;
                    displayElem.style.display = 'block';
                    editElem.style.display = 'none';
                    button.textContent = '✏️';
                    button.title = 'Namen bearbeiten';

                    showSuccess(`Name geändert zu: ${newName}`);

                    // Reload after 2 seconds
                    setTimeout(() => {
                        loadSmartClimateDevices();
                    }, 2000);

                } catch (error) {
                    showError('Fehler beim Ändern des Namens: ' + error.message);
                } finally {
                    button.disabled = false;
                }
            }
        });
    });

    // Temperature control buttons
    document.querySelectorAll('.temp-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const button = e.target;
            const deviceId = button.dataset.deviceId;
            const gateway = button.dataset.gateway;
            const installation = button.dataset.installation;
            const accountId = button.dataset.account;
            const currentTemp = parseFloat(button.dataset.current);

            // Determine new temperature
            let newTemp;
            if (button.classList.contains('plus')) {
                newTemp = Math.min(30, currentTemp + 0.5);
            } else {
                newTemp = Math.max(5, currentTemp - 0.5);
            }

            // Disable buttons during request
            const card = button.closest('.device-card');
            card.querySelectorAll('.temp-btn').forEach(b => b.disabled = true);

            try {
                await setTRVTemperature(accountId, installation, gateway, deviceId, newTemp);

                // Update display
                document.getElementById(`setpoint-${deviceId}`).textContent = newTemp.toFixed(1) + '°C';

                // Update data attributes
                card.querySelectorAll('.temp-btn').forEach(b => {
                    b.dataset.current = newTemp;
                });

                // Show success
                showSuccess(`Temperatur auf ${newTemp.toFixed(1)}°C gesetzt`);

                // Reload after 2 seconds to get actual value
                setTimeout(() => {
                    loadSmartClimateDevices();
                }, 2000);

            } catch (error) {
                showError('Fehler beim Setzen der Temperatur: ' + error.message);
            } finally {
                // Re-enable buttons
                card.querySelectorAll('.temp-btn').forEach(b => b.disabled = false);
            }
        });
    });
}

async function setTRVTemperature(accountId, installationId, gatewaySerial, deviceId, temperature) {
    const response = await fetch('/api/smartclimate/trv/temperature/set', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            accountId,
            installationId,
            gatewaySerial,
            deviceId,
            temperature
        })
    });

    if (!response.ok) {
        throw new Error('API request failed: ' + response.status);
    }

    const data = await response.json();
    if (!data.success) {
        throw new Error(data.error || 'Unknown error');
    }

    return data;
}

async function setDeviceName(accountId, installationId, gatewaySerial, deviceId, name) {
    const response = await fetch('/api/smartclimate/device/name/set', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            accountId,
            installationId,
            gatewaySerial,
            deviceId,
            name
        })
    });

    if (!response.ok) {
        throw new Error('API request failed: ' + response.status);
    }

    const data = await response.json();
    if (!data.success) {
        throw new Error(data.error || 'Unknown error');
    }

    return data;
}

async function toggleChildLock(accountId, installationId, gatewaySerial, deviceId, active) {
    const response = await fetch('/api/smartclimate/trv/childlock/toggle', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            accountId,
            installationId,
            gatewaySerial,
            deviceId,
            active
        })
    });

    if (!response.ok) {
        throw new Error('API request failed: ' + response.status);
    }

    const data = await response.json();
    if (!data.success) {
        throw new Error(data.error || 'Unknown error');
    }

    return data;
}

function showSuccess(message) {
    const errorContainer = document.getElementById('errorContainer');
    errorContainer.innerHTML = `<div class="success-message">${message}</div>`;
    setTimeout(() => {
        errorContainer.innerHTML = '';
    }, 3000);
}

function updateLastUpdate() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent = now.toLocaleTimeString('de-DE');
}

function showError(message) {
    const errorContainer = document.getElementById('errorContainer');
    errorContainer.innerHTML = `<div class="error-message">${message}</div>`;
    setTimeout(() => {
        errorContainer.innerHTML = '';
    }, 5000);
}

function startAutoRefresh() {
    // Refresh every 30 seconds
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    autoRefreshInterval = setInterval(() => {
        loadSmartClimateDevices();
    }, 30000);
}

// Event listeners
document.getElementById('installationSelect').addEventListener('change', async (e) => {
    currentInstallationId = e.target.value;
    const selectedInstall = installations.find(i => i.installationId === currentInstallationId);
    if (selectedInstall) {
        document.getElementById('currentInstallation').textContent =
            selectedInstall.description || selectedInstall.installationId;
    }
    await loadSmartClimateDevices();
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    startAutoRefresh();
});

document.getElementById('refreshBtn').addEventListener('click', () => {
    loadSmartClimateDevices(true);
});

// Initialize on load
init();
