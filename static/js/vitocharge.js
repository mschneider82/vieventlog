let currentInstallationId = null;
let installations = [];
let autoRefreshInterval = null;
let debugMode = false;
let currentAccountId = null;
let currentDeviceId = null;
let pvSettings = null;

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

            // Try to load wallbox debug data
            let wallboxFeatures = null;
            try {
                const wallboxResponse = await fetch('/api/wallbox/debug');
                if (wallboxResponse.ok) {
                    wallboxFeatures = await wallboxResponse.json();
                }
            } catch (err) {
                console.warn('No wallbox debug data available');
            }

            const mockWallboxDevice = wallboxFeatures ? {
                modelId: 'E3_HEMS_VCS',
                deviceId: 'eebus-1',
                deviceType: 'vehicleChargingStation'
            } : null;

            renderVitocharge(features, mockDevice, wallboxFeatures, mockWallboxDevice);
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
        const wallboxDevice = currentInstall.devices.find(d => d.deviceType === 'vehicleChargingStation');

        console.log('Devices in installation:', currentInstall.devices);
        console.log('Vitocharge device found:', vitochargeDevice);
        console.log('Wallbox device found:', wallboxDevice);

        if (!vitochargeDevice) {
            contentDiv.innerHTML = '<div class="no-devices">Kein Vitocharge-Gerät gefunden in dieser Installation.</div>';
            return;
        }

        const gatewaySerial = vitochargeDevice.gatewaySerial || '';
        const deviceId = vitochargeDevice.deviceId;

        // Store device info for PV settings
        currentDeviceId = deviceId;
        currentAccountId = vitochargeDevice.accountId || null; // Account ID from device

        console.log('Loading Vitocharge:', {
            installationId: currentInstallationId,
            gatewaySerial: gatewaySerial,
            deviceId: deviceId,
            accountId: currentAccountId
        });

        // Load PV settings for this device
        await loadPVSettings();

        const refreshParam = forceRefresh ? '&refresh=true' : '';
        const response = await fetch(`/api/features?installationId=${currentInstallationId}&gatewaySerial=${gatewaySerial}&deviceId=${deviceId}${refreshParam}`);

        if (!response.ok) {
            throw new Error('API Fehler: ' + response.status);
        }

        const features = await response.json();

        // Load wallbox data if available
        let wallboxFeatures = null;
        if (wallboxDevice) {
            try {
                const wallboxResponse = await fetch(`/api/features?installationId=${currentInstallationId}&gatewaySerial=${wallboxDevice.gatewaySerial || gatewaySerial}&deviceId=${wallboxDevice.deviceId}${refreshParam}`);
                if (wallboxResponse.ok) {
                    wallboxFeatures = await wallboxResponse.json();
                }
            } catch (err) {
                console.warn('Could not load wallbox data:', err);
            }
        }

        renderVitocharge(features, vitochargeDevice, wallboxFeatures, wallboxDevice);
        updateLastUpdate();

    } catch (error) {
        showError('Fehler beim Laden der Vitocharge-Daten: ' + error.message);
        contentDiv.innerHTML = '<div class="error">Fehler beim Laden der Daten: ' + error.message + '</div>';
    }
}

function renderVitocharge(features, deviceInfo, wallboxFeatures = null, wallboxDevice = null) {
    const contentDiv = document.getElementById('vitochargeContent');
    contentDiv.className = 'vitocharge-container';

    // Helper function to extract feature value from Vitocharge
    const getValue = (featureName) => {
        for (const category of [features.temperatures, features.dhw, features.circuits,
                               features.operatingModes, features.other]) {
            if (category && category[featureName]) {
                return category[featureName];
            }
        }
        return null;
    };

    // Helper function to extract feature value from Wallbox
    const getWallboxValue = (featureName) => {
        if (!wallboxFeatures) return null;
        for (const category of [wallboxFeatures.temperatures, wallboxFeatures.dhw, wallboxFeatures.circuits,
                               wallboxFeatures.operatingModes, wallboxFeatures.other]) {
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

    // Helper function to format energy values (Wh -> kWh -> MWh)
    const formatEnergy = (wh) => {
        if (wh >= 10000000) { // >= 10000 kWh
            return `${(wh / 1000000).toFixed(1)} MWh`;
        } else {
            return `${(wh / 1000).toFixed(1)} kWh`;
        }
    };

    // Extract wallbox data if available
    let wallboxPower = 0;
    let wallboxStatus = 'unknown';
    let wallboxSessionEnergy = 0;
    let wallboxSessionTime = 0;
    let wallboxManufacturer = '';
    let wallboxModel = '';

    if (wallboxFeatures) {
        // Session status (connected, charging, etc.)
        const sessionStatus = getWallboxValue('vcs.session');
        if (sessionStatus && sessionStatus.value) {
            if (typeof sessionStatus.value === 'object' && sessionStatus.value.status) {
                // Extract the status value - it's a nested FeatureValue object
                const statusObj = sessionStatus.value.status;
                wallboxStatus = typeof statusObj === 'object' ? (statusObj.value || statusObj) : statusObj;
            } else if (typeof sessionStatus.value === 'string') {
                wallboxStatus = sessionStatus.value;
            }
        }

        // Current charging session data
        const sessionCharging = getWallboxValue('vcs.session.charging');
        if (sessionCharging && sessionCharging.value) {
            // Extract energy value (can be nested in different ways)
            if (sessionCharging.value.energy !== undefined) {
                const energyValue = sessionCharging.value.energy;
                wallboxSessionEnergy = typeof energyValue === 'object' ? (energyValue.value || 0) : (energyValue || 0);
            }

            // Extract time value (can be nested in different ways)
            if (sessionCharging.value.time !== undefined) {
                const timeValue = sessionCharging.value.time;
                wallboxSessionTime = typeof timeValue === 'object' ? (timeValue.value || 0) : (timeValue || 0);
            }
        }

        // Calculate power from energy and time only if actively charging
        // If connected but not charging, power should be 0
        if (wallboxStatus === 'charging' && wallboxSessionTime > 0 && wallboxSessionEnergy > 0) {
            wallboxPower = (wallboxSessionEnergy / (wallboxSessionTime / 3600)) * 1000; // Convert to W
        } else {
            wallboxPower = 0; // Not charging = 0 power
        }

        // Device info
        const manufacturer = getWallboxValue('device.thirdparty.manufacturer');
        const model = getWallboxValue('device.thirdparty.model');
        wallboxManufacturer = manufacturer?.value?.value || manufacturer?.value || '';
        wallboxModel = model?.value?.value || model?.value || '';
    }

    // Determine battery status from power value (more reliable than operationState)
    // Negative = charging (Energie geht in die Batterie), Positive = discharging (Energie kommt aus der Batterie)
    let batteryStatus = 'standby';
    if (batteryPower < -100) { // Threshold to avoid noise
        batteryStatus = 'charge';
    } else if (batteryPower > 100) {
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
    const gridActivePower = {
        phaseOne: getNestedValue('pcc.ac.active.power', 'phaseOne') || 0,
        phaseTwo: getNestedValue('pcc.ac.active.power', 'phaseTwo') || 0,
        phaseThree: getNestedValue('pcc.ac.active.power', 'phaseThree') || 0
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
        const capacityWh = getNestedValue('ess.battery.usedAverage', `usableEnergyModule${moduleName}`);
        // Nur Module mit Kapazität > 0 Wh anzeigen
        if (capacityWh && capacityWh > 0) {
            modules.push({
                id: i,
                serial: moduleSerials[i-1] || 'Unknown',
                capacityWh: capacityWh,
                capacityKWh: (capacityWh / 1000).toFixed(2)
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
                ${wallboxFeatures ? `
                <div class="flow-arrow">→</div>
                <div class="flow-node ${wallboxStatus === 'charging' ? 'active' : ''}">
                    <div class="flow-node-icon">🚗</div>
                    <div class="flow-node-label">Wallbox</div>
                    <div class="flow-node-value">${formatNum(Math.abs(wallboxPower) / 1000)} kW</div>
                </div>
                ` : ''}
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

    // PV String Details - ALWAYS show, not just when active
    // Check if we have calculated values from backend
    const hasCalculatedValues = features.other && Object.keys(features.other).some(k => k.startsWith('pv.string'));

    html += `
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <div style="font-size: 14px; color: #a0a0b0; font-weight: 600;">🔌 PV-Strings</div>
                ${hasCalculatedValues ? '<span style="font-size: 11px; color: #10b981; background: rgba(16, 185, 129, 0.1); padding: 4px 8px; border-radius: 4px;">⚙️ Berechnet</span>' : '<span style="font-size: 11px; color: #6b7280; background: rgba(107, 114, 128, 0.1); padding: 4px 8px; border-radius: 4px;">📊 API-Werte</span>'}
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;">
    `;

    // Determine how many strings to display
    let stringsToShow = [];

    if (hasCalculatedValues) {
        // Use calculated values - show all configured strings
        for (let i = 1; i <= 6; i++) {
            const nameKey = `pv.string${i}.name`;
            const powerKey = `pv.string${i}.power.calculated`;
            const currentKey = `pv.string${i}.current.calculated`;
            const voltageKey = `photovoltaic.string.voltage`;

            if (getValue(nameKey)) {
                const name = getValue(nameKey)?.value || `String ${i}`;
                const power = getValue(powerKey)?.value || 0; // kW
                const current = getValue(currentKey)?.value || 0; // A or "N/A"

                // Get voltage from API
                let voltage = 0;
                const voltFeature = getValue(voltageKey);
                if (voltFeature && voltFeature.value) {
                    const stringNames = ['stringOne', 'stringTwo', 'stringThree', 'stringFour', 'stringFive', 'stringSix'];
                    const voltKey = stringNames[i - 1];
                    if (voltFeature.value[voltKey] !== undefined) {
                        voltage = voltFeature.value[voltKey];
                    }
                }

                stringsToShow.push({ name, voltage, current, power, calculated: true });
            }
        }
    } else {
        // Fallback to API values (legacy display)
        const apiStrings = [
            { name: 'String 1', voltage: pvStringVoltages.one, current: pvStringCurrents.one },
            { name: 'String 2', voltage: pvStringVoltages.two, current: pvStringCurrents.two },
            { name: 'String 3', voltage: pvStringVoltages.three, current: pvStringCurrents.three }
        ];
        stringsToShow = apiStrings.filter(s => s.voltage > 0 || s.current > 0).map(s => ({
            ...s,
            power: (s.voltage * s.current) / 1000, // Calculate power in kW
            calculated: false
        }));
    }

    // Render strings
    if (stringsToShow.length === 0) {
        html += `<div style="color: #6b7280; font-size: 13px; grid-column: 1/-1; text-align: center; padding: 20px;">Keine PV-String-Daten verfügbar. Konfigurieren Sie PV-Strings über den Button "⚙️ PV-Strings".</div>`;
    } else {
        stringsToShow.forEach(str => {
            const isActive = str.power > 0.01; // Active if power > 10W
            const statusColor = isActive ? '#10b981' : '#6b7280';
            const statusIcon = isActive ? '🟢' : '⚫';
            const currentDisplay = typeof str.current === 'string' ? str.current : formatNum(str.current) + ' A';

            html += `
                <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 11px; color: #a0a0b0; margin-bottom: 6px;">${statusIcon} ${str.name}</div>
                    ${str.calculated ? `<div style="font-size: 14px; color: ${statusColor}; font-weight: 600; margin-bottom: 2px;">${formatNum(str.power)} kW</div>` : ''}
                    <div style="font-size: 13px; color: ${statusColor}; font-weight: ${str.calculated ? '500' : '600'};">${formatNum(str.voltage)} V</div>
                    <div style="font-size: 12px; color: #a0a0b0;">${currentDisplay}</div>
                </div>
            `;
        });
    }

    html += `
            </div>
        </div>
    `;

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
                    <div class="metric-label">Gesamtkapazität</div>
                    <div class="metric-value">${Math.round(batteryCapacity)} <span class="metric-unit">Wh</span> <span style="font-size: 0.8em; color: #a0a0b0;">(${(batteryCapacity / 1000).toFixed(2)} kWh)</span></div>
                </div>
                <div class="metric-item">
                    <div class="metric-label">Notstromreserve</div>
                    <div class="metric-value">${backupReserve} <span class="metric-unit">%</span></div>
                </div>
            </div>
        </div>
    `;

    // Wallbox Card (if available)
    if (wallboxFeatures) {
        const statusEmoji = wallboxStatus === 'charging' ? '🔌' : wallboxStatus === 'connected' ? '🔗' : '⚫';
        const statusText = wallboxStatus === 'charging' ? 'Lädt' : wallboxStatus === 'connected' ? 'Verbunden' : 'Nicht verbunden';
        const statusClass = wallboxStatus === 'charging' ? 'charging' : '';

        // Format session time
        const hours = Math.floor(wallboxSessionTime / 3600);
        const minutes = Math.floor((wallboxSessionTime % 3600) / 60);
        const sessionTimeFormatted = `${hours}h ${minutes}min`;

        html += `
            <div class="section-card">
                <div class="section-header">🚗 Wallbox</div>
                <div class="status-box ${statusClass}">
                    <div class="status-label">Status</div>
                    <div class="status-value ${statusClass}">${statusEmoji} ${statusText}</div>
                </div>
                <div class="metrics-grid">
                    <div class="metric-item">
                        <div class="metric-label">Ladeleistung</div>
                        <div class="metric-value">${formatNum(wallboxPower / 1000)} <span class="metric-unit">kW</span></div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">Session-Energie</div>
                        <div class="metric-value">${(wallboxSessionEnergy || 0).toFixed(2)} <span class="metric-unit">kWh</span></div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">Ladezeit (Session)</div>
                        <div class="metric-value">${sessionTimeFormatted}</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">Modell</div>
                        <div class="metric-value" style="font-size: 0.85em;">${wallboxManufacturer} ${wallboxModel}</div>
                    </div>
                </div>
            </div>
        `;
    }

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
                        <span class="module-info-value">${module.serial}</span>
                    </div>
                    <div class="module-info">
                        <span class="module-info-label">Kapazität:</span>
                        <span class="module-info-value">${Math.round(module.capacityWh)} Wh (${module.capacityKWh} kWh)</span>
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
                    <div class="stat-card-value">${formatEnergy(batteryChargeLifeCycle)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-card-label">Entladen Gesamt</div>
                    <div class="stat-card-value">${formatEnergy(batteryDischargeLifeCycle)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-card-label">Netzbezug Gesamt</div>
                    <div class="stat-card-value">${formatEnergy(gridConsumptionTotal)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-card-label">Netzeinspeisung Gesamt</div>
                    <div class="stat-card-value">${formatEnergy(gridFeedInTotal)}</div>
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
            { name: 'L1', current: gridCurrents.phaseOne, active: gridActivePower.phaseOne, reactive: gridReactivePower.phaseOne },
            { name: 'L2', current: gridCurrents.phaseTwo, active: gridActivePower.phaseTwo, reactive: gridReactivePower.phaseTwo },
            { name: 'L3', current: gridCurrents.phaseThree, active: gridActivePower.phaseThree, reactive: gridReactivePower.phaseThree }
        ];

        phases.forEach(phase => {
            // Calculate apparent power S = √(P² + Q²)
            const apparentPower = Math.sqrt(Math.pow(phase.active, 2) + Math.pow(phase.reactive, 2));
            const totalPower = apparentPower.toFixed(0);

            // Calculate power factor cos(φ) = P / S
            const cosPhi = phase.active / apparentPower;

            // Calculate current using I = P / (U × cos(φ)) where U = 230V nominal
            const calculatedCurrent = (phase.active / (230 * cosPhi)).toFixed(2);

            html += `
                <div style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 14px; color: #667eea; font-weight: 600; margin-bottom: 8px;">Phase ${phase.name}</div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span style="font-size: 12px; color: #a0a0b0;">Strom:</span>
                        <span style="font-size: 13px; color: #e0e0e0; font-weight: 600;">${calculatedCurrent} A</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span style="font-size: 12px; color: #a0a0b0;">Wirkleistung:</span>
                        <span style="font-size: 13px; color: #e0e0e0;">${phase.active} W</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="font-size: 12px; color: #a0a0b0;">Blindleistung:</span>
                        <span style="font-size: 13px; color: ${phase.reactive < 0 ? '#ef4444' : '#10b981'};">${Math.round(phase.reactive)} W</span>
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

document.getElementById('pvSettingsBtn').addEventListener('click', () => {
    showPVSettingsModal();
});

// Initialize
init();

// ============= PV String Settings =============

async function loadPVSettings() {
    if (!currentAccountId || !currentInstallationId || !currentDeviceId) {
        console.log('Cannot load PV settings: missing account/installation/device info');
        return;
    }

    try {
        const response = await fetch('/api/pv-settings/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accountId: currentAccountId,
                installationId: currentInstallationId,
                deviceId: currentDeviceId
            })
        });

        if (!response.ok) {
            throw new Error('Failed to load PV settings: ' + response.status);
        }

        const data = await response.json();
        pvSettings = data.settings; // may be null if not configured
        console.log('Loaded PV settings:', pvSettings);
    } catch (error) {
        console.error('Error loading PV settings:', error);
        pvSettings = null;
    }
}

async function savePVSettings(settings) {
    if (!currentAccountId || !currentInstallationId || !currentDeviceId) {
        throw new Error('Missing account/installation/device info');
    }

    const response = await fetch('/api/pv-settings/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            accountId: currentAccountId,
            installationId: currentInstallationId,
            deviceId: currentDeviceId,
            settings: settings
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error('Failed to save PV settings: ' + text);
    }

    const data = await response.json();
    if (!data.success) {
        throw new Error(data.error || 'Unknown error saving PV settings');
    }

    pvSettings = data.settings;
    console.log('Saved PV settings:', pvSettings);
}

function showPVSettingsModal() {
    // Create modal HTML
    const modalHTML = `
        <div id="pvSettingsModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;">
            <div style="background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%); padding: 30px; border-radius: 12px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1);">
                <h2 style="margin-top: 0; color: #fff; margin-bottom: 20px;">⚙️ PV-String Konfiguration</h2>
                <p style="color: #a0a0b0; font-size: 14px; margin-bottom: 20px;">
                    Konfigurieren Sie die PV-Strings für präzise Leistungs- und Stromberechnungen (±5% Genauigkeit).
                </p>
                <div id="pvStringsContainer"></div>
                <button id="addStringBtn" style="margin-top: 15px; padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer;">
                    ➕ String hinzufügen
                </button>
                <div style="margin-top: 25px; display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="pvSettingsCancelBtn" style="padding: 10px 20px; background: #6b7280; color: white; border: none; border-radius: 6px; cursor: pointer;">
                        Abbrechen
                    </button>
                    <button id="pvSettingsSaveBtn" style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        💾 Speichern
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Populate with existing settings
    const container = document.getElementById('pvStringsContainer');
    if (pvSettings && pvSettings.strings && pvSettings.strings.length > 0) {
        pvSettings.strings.forEach((str, idx) => {
            addStringRow(container, idx + 1, str.name, str.moduleCount, str.modulePower);
        });
    } else {
        // Add one default string
        addStringRow(container, 1, 'String 1', 10, 400);
    }

    // Event listeners
    document.getElementById('addStringBtn').addEventListener('click', () => {
        const count = container.children.length + 1;
        addStringRow(container, count, `String ${count}`, 10, 400);
    });

    document.getElementById('pvSettingsCancelBtn').addEventListener('click', () => {
        document.getElementById('pvSettingsModal').remove();
    });

    document.getElementById('pvSettingsSaveBtn').addEventListener('click', async () => {
        try {
            const strings = [];
            const rows = container.querySelectorAll('.pv-string-row');

            rows.forEach(row => {
                const name = row.querySelector('.string-name').value.trim();
                const moduleCount = parseInt(row.querySelector('.module-count').value);
                const modulePower = parseFloat(row.querySelector('.module-power').value);

                if (name && moduleCount > 0 && modulePower > 0) {
                    strings.push({ name, moduleCount, modulePower });
                }
            });

            if (strings.length === 0) {
                alert('Bitte mindestens einen String konfigurieren.');
                return;
            }

            await savePVSettings({ strings });
            document.getElementById('pvSettingsModal').remove();

            // Reload dashboard to show calculated values
            await loadVitochargeData(true);

        } catch (error) {
            alert('Fehler beim Speichern: ' + error.message);
        }
    });
}

function addStringRow(container, number, name, moduleCount, modulePower) {
    const rowHTML = `
        <div class="pv-string-row" style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <label style="color: #667eea; font-weight: 600;">String ${number}</label>
                <button class="remove-string-btn" style="background: #ef4444; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;">
                    🗑️ Entfernen
                </button>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                <div>
                    <label style="display: block; color: #a0a0b0; font-size: 12px; margin-bottom: 5px;">Name</label>
                    <input type="text" class="string-name" value="${name}" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white;">
                </div>
                <div>
                    <label style="display: block; color: #a0a0b0; font-size: 12px; margin-bottom: 5px;">Anzahl Module</label>
                    <input type="number" class="module-count" value="${moduleCount}" min="1" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white;">
                </div>
                <div>
                    <label style="display: block; color: #a0a0b0; font-size: 12px; margin-bottom: 5px;">Leistung/Modul [W]</label>
                    <input type="number" class="module-power" value="${modulePower}" min="1" step="0.1" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white;">
                </div>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', rowHTML);

    // Add remove button handler
    const lastRow = container.lastElementChild;
    lastRow.querySelector('.remove-string-btn').addEventListener('click', () => {
        if (container.children.length > 1) {
            lastRow.remove();
        } else {
            alert('Mindestens ein String muss konfiguriert sein.');
        }
    });
}
