let currentInstallationId = null;
let installations = [];
let autoRefreshInterval = null;
let debugMode = false;

// Parse URL parameters
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('installationId')) {
    currentInstallationId = urlParams.get('installationId');
}
if (urlParams.has('debug')) {
    debugMode = true;
    console.log('🔧 Debug mode enabled - using mock data from vitocharge.json');
}

async function init() {
    // In debug mode, skip installation loading and load mock data directly
    if (debugMode) {
        document.getElementById('installationSelect').innerHTML = '<option>Debug Mode (Mock Data)</option>';
        document.getElementById('currentInstallation').textContent = 'Debug Mode';
        await loadVitochargeData();
        return;
    }

    await loadInstallations();
    if (currentInstallationId) {
        await loadVitochargeData();
        // Auto-refresh deaktiviert - manueller Refresh über Button
    }
}

async function loadInstallations() {
    try {
        const response = await fetch('/api/vitocharge/devices');
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
        showError('Fehler beim Laden der Installationen: ' + error.message);
    }
}

async function loadVitochargeData(forceRefresh = false) {
    const contentDiv = document.getElementById('vitochargeContent');
    contentDiv.className = 'loading';
    contentDiv.innerHTML = '<div class="spinner"></div><p>Lade Vitocharge-Daten...</p>';

    try {
        // Debug mode: Load mock data from local JSON
        if (debugMode) {
            console.log('🔧 Loading mock data from /api/vitocharge/debug');
            const response = await fetch('/api/vitocharge/debug');
            if (!response.ok) {
                throw new Error('Mock data API error: ' + response.status);
            }
            const features = await response.json();
            const mockDevice = {
                modelId: 'E3_VitoCharge_03',
                deviceId: 'mock',
                gatewaySerial: 'mock'
            };
            renderVitocharge(features, mockDevice);
            updateLastUpdate();
            return;
        }

        // Normal mode: Use real API
        const currentInstall = installations.find(i => i.installationId === currentInstallationId);
        if (!currentInstall || !currentInstall.devices) {
            throw new Error('Installation nicht gefunden');
        }

        // Find Vitocharge device (electricityStorage)
        const vitochargeDevice = currentInstall.devices.find(d => d.modelId && d.modelId.includes('VitoCharge'));

        if (!vitochargeDevice) {
            contentDiv.innerHTML = '<div class="no-devices">Kein Vitocharge-Gerät gefunden in dieser Installation.</div>';
            return;
        }

        const gatewaySerial = vitochargeDevice.gatewaySerial || '';
        const deviceId = vitochargeDevice.deviceId;

        console.log('Loading Vitocharge:', {
            installationId: currentInstallationId,
            gatewaySerial: gatewaySerial,
            deviceId: deviceId
        });

        const refreshParam = forceRefresh ? '&refresh=true' : '';
        const response = await fetch(`/api/features?installationId=${currentInstallationId}&gatewaySerial=${gatewaySerial}&deviceId=${deviceId}${refreshParam}`);

        if (!response.ok) {
            throw new Error('API Fehler: ' + response.status);
        }

        const features = await response.json();
        renderVitocharge(features, vitochargeDevice);
        updateLastUpdate();

    } catch (error) {
        showError('Fehler beim Laden der Vitocharge-Daten: ' + error.message);
        contentDiv.innerHTML = '<div class="error">Fehler beim Laden der Daten: ' + error.message + '</div>';
    }
}

function renderVitocharge(features, deviceInfo) {
    const contentDiv = document.getElementById('vitochargeContent');
    contentDiv.className = 'vitocharge-container';

    // Helper function to extract feature value
    const getValue = (featureName) => {
        for (const category of [features.temperatures, features.dhw, features.circuits,
                               features.operatingModes, features.other]) {
            if (category && category[featureName]) {
                return category[featureName];
            }
        }
        return null;
    };

    const getNestedValue = (featureName, propertyName) => {
        const feature = getValue(featureName);
        if (!feature) return null;

        // If value is an object with nested properties
        if (feature.value && typeof feature.value === 'object') {
            const prop = feature.value[propertyName];

            // Check if prop has a .value field (standard nested structure)
            if (prop && typeof prop === 'object' && prop.value !== undefined) {
                return prop.value;
            }

            // Otherwise return prop directly if it exists
            if (prop !== undefined) {
                return prop;
            }
        }

        // Fallback: Try direct access if value is not nested
        if (feature.value !== undefined && feature.value !== null && typeof feature.value !== 'object') {
            return feature.value;
        }

        return null;
    };

    // Extract key data
    const pvStatus = getNestedValue('photovoltaic.status', 'status') || 'unknown';
    const pvProductionCurrent = getValue('photovoltaic.production.current')?.value || 0;
    const pvProductionLifeCycle = getNestedValue('photovoltaic.production.cumulated', 'lifeCycle') || 0;
    const pvProductionCurrentDay = getNestedValue('photovoltaic.production.cumulated', 'currentDay') || 0;
    const pvInstalledPeakPower = getValue('photovoltaic.installedPeakPower')?.value || 0;

    const batteryPower = getValue('ess.power')?.value || 0;
    const batterySOC = getValue('ess.stateOfCharge')?.value || 0;
    const batteryCapacity = getNestedValue('ess.battery.usedAverage', 'averageUsableSystemEnergy') || 0;
    const batteryChargeLifeCycle = getNestedValue('ess.transfer.charge.cumulated', 'lifeCycle') || 0;
    const batteryDischargeLifeCycle = getNestedValue('ess.transfer.discharge.cumulated', 'lifeCycle') || 0;

    // Determine battery status from power value (more reliable than operationState)
    // Positive = charging, Negative = discharging
    let batteryStatus = 'standby';
    if (batteryPower > 100) { // Threshold to avoid noise
        batteryStatus = 'charge';
    } else if (batteryPower < -100) {
        batteryStatus = 'discharge';
    }

    const gridPower = getValue('pcc.transfer.power.exchange')?.value || 0;
    const gridConsumptionTotal = getValue('pcc.transfer.consumption.total')?.value || 0;
    const gridFeedInTotal = getValue('pcc.transfer.feedIn.total')?.value || 0;

    const inverterPowerActive = getNestedValue('ess.inverter.ac.power', 'activePower') || 0;
    const systemType = getValue('ess.configuration.systemType')?.value || 'unknown';
    const backupReserve = getValue('ess.configuration.backupBox')?.value || 0;
    const ambientTemp = getNestedValue('ess.sensors.temperature.ambient', 'value') || null;

    // PV String details
    const pvStringVoltages = {
        one: getNestedValue('photovoltaic.string.voltage', 'stringOne') || 0,
        two: getNestedValue('photovoltaic.string.voltage', 'stringTwo') || 0,
        three: getNestedValue('photovoltaic.string.voltage', 'stringThree') || 0
    };
    const pvStringCurrents = {
        one: getNestedValue('photovoltaic.string.current', 'stringOne') || 0,
        two: getNestedValue('photovoltaic.string.current', 'stringTwo') || 0,
        three: getNestedValue('photovoltaic.string.current', 'stringThree') || 0
    };

    // Grid phase details
    const gridCurrents = {
        phaseOne: getNestedValue('pcc.ac.active.current', 'phaseOne') || 0,
        phaseTwo: getNestedValue('pcc.ac.active.current', 'phaseTwo') || 0,
        phaseThree: getNestedValue('pcc.ac.active.current', 'phaseThree') || 0
    };
    const gridReactivePower = {
        phaseOne: getNestedValue('pcc.ac.reactive.power', 'phaseOne') || 0,
        phaseTwo: getNestedValue('pcc.ac.reactive.power', 'phaseTwo') || 0,
        phaseThree: getNestedValue('pcc.ac.reactive.power', 'phaseThree') || 0
    };

    // Battery modules
    const modules = [];
    const moduleSerials = getNestedValue('device.serial.internalComponents', 'vinList') || [];
    for (let i = 1; i <= 6; i++) {
        const moduleName = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'][i-1];
        const capacity = getNestedValue('ess.battery.usedAverage', `usableEnergyModule${moduleName}`);
        if (capacity && capacity > 0) {
            modules.push({
                id: i,
                serial: moduleSerials[i-1] || 'Unknown',
                capacity: capacity
            });
        }
    }

    // Determine battery status class
    let batteryStatusClass = '';
    if (batteryStatus === 'charge') {
        batteryStatusClass = 'charging';
    } else if (batteryStatus === 'discharge') {
        batteryStatusClass = 'discharging';
    }

    // Determine PV status emoji
    let pvStatusEmoji = '⚫';
    let pvStatusText = pvStatus;
    if (pvStatus === 'production') {
        pvStatusEmoji = '🟢';
        pvStatusText = 'Produktion';
    }

    // Determine battery status emoji and text
    let batteryStatusEmoji = '⚫';
    let batteryStatusText = batteryStatus;
    if (batteryStatus === 'charge') {
        batteryStatusEmoji = '🔵';
        batteryStatusText = 'Laden';
    } else if (batteryStatus === 'discharge') {
        batteryStatusEmoji = '🔴';
        batteryStatusText = 'Entladen';
    } else if (batteryStatus === 'standby') {
        batteryStatusEmoji = '⚪';
        batteryStatusText = 'Standby';
    }

    let html = '';

    // Power Flow Diagram
    html += `
        <div class="power-flow">
            <div class="section-header">🔋 Energiefluss</div>
            <div class="flow-diagram">
                <div class="flow-node">
                    <div class="flow-node-icon">☀️</div>
                    <div class="flow-node-label">PV-Produktion</div>
                    <div class="flow-node-value">${formatNum(pvProductionCurrent)} kW</div>
                </div>
                <div class="flow-arrow">→</div>
                <div class="flow-node">
                    <div class="flow-node-icon">🔌</div>
                    <div class="flow-node-label">Wechselrichter</div>
                    <div class="flow-node-value">${formatNum(inverterPowerActive / 1000)} kW</div>
                </div>
                <div class="flow-arrow ${batteryPower > 0 ? 'reverse' : ''}">→</div>
                <div class="flow-node">
                    <div class="flow-node-icon">🔋</div>
                    <div class="flow-node-label">Batterie</div>
                    <div class="flow-node-value">${formatNum(Math.abs(batteryPower) / 1000)} kW</div>
                </div>
                <div class="flow-arrow ${gridPower < 0 ? 'reverse' : ''}">→</div>
                <div class="flow-node">
                    <div class="flow-node-icon">🏠</div>
                    <div class="flow-node-label">Netzbezug</div>
                    <div class="flow-node-value">${formatNum(Math.abs(gridPower) / 1000)} kW</div>
                </div>
            </div>
        </div>
    `;

    // Overview Grid (Photovoltaik + Batterie)
    html += '<div class="overview-grid">';

    // Photovoltaik Card
    html += `
        <div class="section-card">
            <div class="section-header">☀️ Photovoltaik</div>
            <div class="status-box pv-status">
                <div class="status-label">PV Status</div>
                <div class="status-value">${pvStatusEmoji} ${pvStatusText}</div>
            </div>
            <div class="metrics-grid">
                <div class="metric-item">
                    <div class="metric-label">PV Produktion</div>
                    <div class="metric-value">${formatNum(pvProductionCurrent)} <span class="metric-unit">kW</span></div>
                </div>
                <div class="metric-item">
                    <div class="metric-label">Peak Power</div>
                    <div class="metric-value">${formatNum(pvInstalledPeakPower)} <span class="metric-unit">kWp</span></div>
                </div>
                <div class="metric-item">
                    <div class="metric-label">Heute</div>
                    <div class="metric-value">${formatNum(pvProductionCurrentDay / 1000)} <span class="metric-unit">kWh</span></div>
                </div>
                <div class="metric-item">
                    <div class="metric-label">Gesamt</div>
                    <div class="metric-value">${formatNum(pvProductionLifeCycle / 1000000)} <span class="metric-unit">MWh</span></div>
                </div>
            </div>
    `;

    // PV String Details (only if at least one string is active)
    const hasActiveStrings = pvStringCurrents.one > 0 || pvStringCurrents.two > 0 || pvStringCurrents.three > 0;
    if (hasActiveStrings) {
        html += `
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="font-size: 14px; color: #a0a0b0; margin-bottom: 10px; font-weight: 600;">🔌 PV-Strings</div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
        `;

        const strings = [
            { name: 'String 1', voltage: pvStringVoltages.one, current: pvStringCurrents.one },
            { name: 'String 2', voltage: pvStringVoltages.two, current: pvStringCurrents.two },
            { name: 'String 3', voltage: pvStringVoltages.three, current: pvStringCurrents.three }
        ];

        strings.forEach(str => {
            const isActive = str.current > 0.1;
            const power = (str.voltage * str.current).toFixed(0);
            const statusColor = isActive ? '#10b981' : '#6b7280';
            const statusIcon = isActive ? '🟢' : '⚫';

            html += `
                <div style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 11px; color: #a0a0b0; margin-bottom: 4px;">${statusIcon} ${str.name}</div>
                    <div style="font-size: 13px; color: ${statusColor}; font-weight: 600;">${formatNum(str.voltage)} V</div>
                    <div style="font-size: 12px; color: #a0a0b0;">${formatNum(str.current)} A</div>
                    ${isActive ? `<div style="font-size: 11px; color: #667eea; margin-top: 2px;">${power} W</div>` : ''}
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    }

    html += `</div>`;

    // Batterie Card
    html += `
        <div class="section-card">
            <div class="section-header">🔋 Batterie</div>
            <div class="status-box battery-status ${batteryStatusClass}">
                <div class="status-label">Batteriestatus</div>
                <div class="status-value ${batteryStatusClass}">${batteryStatusEmoji} ${batteryStatusText}</div>
            </div>
            <div class="metrics-grid">
                <div class="metric-item">
                    <div class="metric-label">Batterieleistung</div>
                    <div class="metric-value">${formatNum(batteryPower / 1000)} <span class="metric-unit">kW</span></div>
                </div>
                <div class="metric-item">
                    <div class="metric-label">Batterieladezustand</div>
                    <div class="metric-value">${batterySOC} <span class="metric-unit">%</span></div>
                </div>
                <div class="metric-item">
                    <div class="metric-label">Kapazität</div>
                    <div class="metric-value">${formatNum(batteryCapacity / 1000)} <span class="metric-unit">kWh</span></div>
                </div>
                <div class="metric-item">
                    <div class="metric-label">Notstromreserve</div>
                    <div class="metric-value">${backupReserve} <span class="metric-unit">%</span></div>
                </div>
            </div>
        </div>
    `;

    html += '</div>'; // Close overview-grid

    // Battery Modules
    if (modules.length > 0) {
        html += `
            <div class="battery-modules">
                <div class="section-header">🔋 Batteriemodule</div>
                <div class="modules-grid">
        `;
        modules.forEach(module => {
            html += `
                <div class="module-card">
                    <div class="module-header">Batteriemodul ${module.id}</div>
                    <div class="module-info">
                        <span class="module-info-label">Seriennummer:</span>
                        <span class="module-info-value">${module.serial.substring(0, 12)}...</span>
                    </div>
                    <div class="module-info">
                        <span class="module-info-label">Typ:</span>
                        <span class="module-info-value">2.5A</span>
                    </div>
                    <div class="module-info">
                        <span class="module-info-label">Kapazität:</span>
                        <span class="module-info-value">${formatNum(module.capacity / 1000)} kWh</span>
                    </div>
                    <div class="module-info">
                        <span class="module-info-label">Geschätzte Restkapazität:</span>
                        <span class="module-info-value">100 %</span>
                    </div>
                </div>
            `;
        });
        html += `
                </div>
            </div>
        `;
    }

    // Statistics Section
    html += `
        <div class="statistics-section">
            <div class="section-header">📊 Statistiken</div>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-card-label">Laden Gesamt</div>
                    <div class="stat-card-value">${formatNum(batteryChargeLifeCycle / 1000000)} MWh</div>
                </div>
                <div class="stat-card">
                    <div class="stat-card-label">Entladen Gesamt</div>
                    <div class="stat-card-value">${formatNum(batteryDischargeLifeCycle / 1000000)} MWh</div>
                </div>
                <div class="stat-card">
                    <div class="stat-card-label">Netzbezug Gesamt</div>
                    <div class="stat-card-value">${formatNum(gridConsumptionTotal / 1000000)} MWh</div>
                </div>
                <div class="stat-card">
                    <div class="stat-card-label">Netzeinspeisung Gesamt</div>
                    <div class="stat-card-value">${formatNum(gridFeedInTotal / 1000000)} MWh</div>
                </div>
            </div>
    `;

    // Grid Phase Details
    const hasPhaseCurrent = gridCurrents.phaseOne > 0 || gridCurrents.phaseTwo > 0 || gridCurrents.phaseThree > 0;
    if (hasPhaseCurrent) {
        html += `
            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="font-size: 16px; color: #fff; margin-bottom: 15px; font-weight: 600;">⚡ Netzphasen</div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px;">
        `;

        const phases = [
            { name: 'L1', current: gridCurrents.phaseOne, reactive: gridReactivePower.phaseOne },
            { name: 'L2', current: gridCurrents.phaseTwo, reactive: gridReactivePower.phaseTwo },
            { name: 'L3', current: gridCurrents.phaseThree, reactive: gridReactivePower.phaseThree }
        ];

        phases.forEach(phase => {
            const power = (phase.current * 230).toFixed(0); // Approximate active power (assuming 230V)
            const totalPower = Math.sqrt(Math.pow(power, 2) + Math.pow(phase.reactive, 2)).toFixed(0);

            html += `
                <div style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 14px; color: #667eea; font-weight: 600; margin-bottom: 8px;">Phase ${phase.name}</div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span style="font-size: 12px; color: #a0a0b0;">Strom:</span>
                        <span style="font-size: 13px; color: #e0e0e0; font-weight: 600;">${formatNum(phase.current)} A</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span style="font-size: 12px; color: #a0a0b0;">Wirkleistung:</span>
                        <span style="font-size: 13px; color: #e0e0e0;">${power} W</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="font-size: 12px; color: #a0a0b0;">Blindleistung:</span>
                        <span style="font-size: 13px; color: ${phase.reactive < 0 ? '#ef4444' : '#10b981'};">${formatNum(phase.reactive)} W</span>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    }

    html += `</div>`;

    // Device Info
    html += `
        <div class="device-info-section">
            <div class="section-header">ℹ️ Geräteinformationen</div>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-item-label">Produktname:</span>
                    <span class="info-item-value">Wechselrichter ${deviceInfo.modelId}</span>
                </div>
                <div class="info-item">
                    <span class="info-item-label">Systemtyp:</span>
                    <span class="info-item-value">${systemType === 'hybrid' ? 'Hybrid' : systemType}</span>
                </div>
                <div class="info-item">
                    <span class="info-item-label">Gateway:</span>
                    <span class="info-item-value">${deviceInfo.gatewaySerial || 'N/A'}</span>
                </div>
                <div class="info-item">
                    <span class="info-item-label">Device ID:</span>
                    <span class="info-item-value">${deviceInfo.deviceId}</span>
                </div>
                ${ambientTemp !== null ? `
                <div class="info-item">
                    <span class="info-item-label">Umgebungstemperatur:</span>
                    <span class="info-item-value">${formatNum(ambientTemp)} °C</span>
                </div>
                ` : ''}
            </div>
        </div>
    `;

    contentDiv.innerHTML = html;
}

function formatNum(value) {
    if (value === null || value === undefined) return '--';
    return Number(value).toFixed(1);
}

function updateLastUpdate() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent = now.toLocaleTimeString('de-DE');
}

function showError(message) {
    const errorDiv = document.getElementById('errorContainer');
    errorDiv.innerHTML = `<div class="error-message">${message}</div>`;
    setTimeout(() => {
        errorDiv.innerHTML = '';
    }, 5000);
}

function startAutoRefresh() {
    // Refresh every 30 seconds
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    autoRefreshInterval = setInterval(() => {
        loadVitochargeData(false);
    }, 30000);
}

// Event listeners
document.getElementById('installationSelect').addEventListener('change', (e) => {
    currentInstallationId = e.target.value;
    // Update URL
    const url = new URL(window.location);
    url.searchParams.set('installationId', currentInstallationId);
    window.history.pushState({}, '', url);

    loadVitochargeData();
});

document.getElementById('refreshBtn').addEventListener('click', () => {
    loadVitochargeData(true);
});

// Initialize
init();
