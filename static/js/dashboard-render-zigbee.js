// Dashboard Render - Zigbee Views  
// Rendering functions for SmartClimate/Zigbee devices
// Part 3 of 3 - refactored from dashboard-render.js

        // SmartClimate / Zigbee device rendering functions

        function renderThermostatView(kf, deviceInfo) {
            let html = '';

            // Device header
            html += renderDeviceHeader(deviceInfo, kf);

            // Main temperature card
            html += `
                <div class="card">
                    <div class="card-header">
                        <h2>🌡️ Raumtemperatur</h2>
                    </div>
                    <div class="status-list">
            `;

            if (kf.deviceTemperature && isValidNumericValue(kf.deviceTemperature)) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Ist-Temperatur</span>
                        <span class="status-value">${formatNum(kf.deviceTemperature.value)} ${kf.deviceTemperature.unit || '°C'}</span>
                    </div>
                `;
            }

            if (kf.trvTemperature && isValidNumericValue(kf.trvTemperature)) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Soll-Temperatur</span>
                        <span class="status-value">${formatNum(kf.trvTemperature.value)} ${kf.trvTemperature.unit || '°C'}</span>
                    </div>
                `;
            }

            if (kf.trvValvePosition) {
                // Nested property: value.position.value
                const valveData = kf.trvValvePosition.value;
                if (valveData && valveData.position && typeof valveData.position.value === 'number') {
                    const valvePos = valveData.position.value;
                    const valveUnit = valveData.position.unit || '%';
                    const valveStatus = valvePos > 0 ? '🟢 Offen' : '⚪ Geschlossen';
                    html += `
                        <div class="status-item">
                            <span class="status-label">Ventilstellung</span>
                            <span class="status-value">${valveStatus} (${formatNum(valvePos)} ${valveUnit})</span>
                        </div>
                    `;
                }
            }

            html += `
                    </div>
                </div>
            `;

            // Settings & Status card
            html += `
                <div class="card">
                    <div class="card-header">
                        <h2>⚙️ Einstellungen & Status</h2>
                    </div>
                    <div class="status-list">
            `;

            if (kf.trvChildLock) {
                // Nested property: value.status.value
                const lockData = kf.trvChildLock.value;
                if (lockData && lockData.status) {
                    const lockStatus = lockData.status.value;
                    const lockText = lockStatus === 'active' ? '🔒 AN' : '🔓 AUS';
                    html += `
                        <div class="status-item">
                            <span class="status-label">Kindersicherung</span>
                            <span class="status-value">${lockText}</span>
                        </div>
                    `;
                }
            }

            if (kf.trvMountingMode) {
                // Nested property: value.active.value
                const mountingData = kf.trvMountingMode.value;
                if (mountingData && mountingData.active && mountingData.active.value !== undefined) {
                    const mountingActive = mountingData.active.value;
                    html += `
                        <div class="status-item">
                            <span class="status-label">Montagemodus</span>
                            <span class="status-value">${mountingActive ? 'Aktiv' : 'Inaktiv'}</span>
                        </div>
                    `;
                }
            }

            html += `
                    </div>
                </div>
            `;

            // Zigbee device info
            html += renderZigbeeDeviceInfo(kf);

            return html;
        }

        function renderClimateSensorView(kf, deviceInfo) {
            let html = '';

            // Device header
            html += renderDeviceHeader(deviceInfo, kf);

            // Sensor data card
            html += `
                <div class="card wide">
                    <div class="card-header">
                        <h2>📊 Sensordaten</h2>
                    </div>
                    <div class="temp-grid">
            `;

            if (kf.deviceTemperature && isValidNumericValue(kf.deviceTemperature)) {
                html += `
                    <div class="temp-item">
                        <span class="temp-label">Temperatur</span>
                        <div>
                            <span class="temp-value">${formatNum(kf.deviceTemperature.value)}</span>
                            <span class="temp-unit">${kf.deviceTemperature.unit || '°C'}</span>
                        </div>
                    </div>
                `;
            }

            if (kf.deviceHumidity && isValidNumericValue(kf.deviceHumidity)) {
                html += `
                    <div class="temp-item">
                        <span class="temp-label">Luftfeuchtigkeit</span>
                        <div>
                            <span class="temp-value">${formatNum(kf.deviceHumidity.value)}</span>
                            <span class="temp-unit">${kf.deviceHumidity.unit || '%'}</span>
                        </div>
                    </div>
                `;
            }

            html += `
                    </div>
                </div>
            `;

            // Zigbee device info
            html += renderZigbeeDeviceInfo(kf);

            return html;
        }

        function renderFloorHeatingView(kf, deviceInfo) {
            let html = '';

            // Device header
            html += renderDeviceHeader(deviceInfo, kf);

            // Operating mode card
            html += `
                <div class="card">
                    <div class="card-header">
                        <h2>🏠 Betriebsmodus</h2>
            `;

            if (kf.fhtOperatingMode && kf.fhtOperatingMode.value) {
                const mode = kf.fhtOperatingMode.value;
                const modeText = mode === 'heating' ? 'Heizen' :
                                 mode === 'cooling' ? 'Kühlen' :
                                 mode === 'heatingCooling' ? 'Heizen/Kühlen' :
                                 'Standby';
                const badgeClass = mode === 'heating' ? 'badge-info' :
                                   mode === 'cooling' ? 'badge-success' :
                                   mode === 'heatingCooling' ? 'badge-primary' :
                                   'badge-warning';
                html += `<span class="badge ${badgeClass}">${modeText}</span>`;
            }

            html += `
                    </div>
                    <div class="status-list">
            `;

            if (kf.fhtSupplyTemp && isValidNumericValue(kf.fhtSupplyTemp)) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Vorlauftemperatur</span>
                        <span class="status-value">${formatNum(kf.fhtSupplyTemp.value)} ${kf.fhtSupplyTemp.unit || '°C'}</span>
                    </div>
                `;
            }

            if (kf.fhtHeatingActive) {
                // Nested property: value.active.value
                const heatingData = kf.fhtHeatingActive.value;
                if (heatingData && heatingData.active && heatingData.active.value !== undefined) {
                    html += `
                        <div class="status-item">
                            <span class="status-label">Heizen</span>
                            <span class="status-value">${heatingData.active.value ? '🟢 Aktiv' : '⚪ Inaktiv'}</span>
                        </div>
                    `;
                }
            }

            if (kf.fhtCoolingActive) {
                // Nested property: value.active.value
                const coolingData = kf.fhtCoolingActive.value;
                if (coolingData && coolingData.active && coolingData.active.value !== undefined) {
                    html += `
                        <div class="status-item">
                            <span class="status-label">Kühlen</span>
                            <span class="status-value">${coolingData.active.value ? '🟢 Aktiv' : '⚪ Inaktiv'}</span>
                        </div>
                    `;
                }
            }

            html += `
                    </div>
                </div>
            `;

            // Zigbee device info
            html += renderZigbeeDeviceInfo(kf);

            return html;
        }

        function renderRepeaterView(kf, deviceInfo) {
            let html = '';

            // Device header
            html += renderDeviceHeader(deviceInfo, kf);

            // Network info card
            html += `
                <div class="card wide">
                    <div class="card-header">
                        <h2>📡 Netzwerk-Informationen</h2>
                    </div>
                    <div class="status-list">
            `;

            if (kf.zigbeeLqi) {
                // Nested property: value.strength.value
                const lqiData = kf.zigbeeLqi.value;
                if (lqiData && lqiData.strength && typeof lqiData.strength.value === 'number') {
                    const lqiValue = lqiData.strength.value;
                    const lqiUnit = lqiData.strength.unit || '%';
                    const lqiColor = lqiValue >= 70 ? '#10b981' : lqiValue >= 40 ? '#f59e0b' : '#ef4444';
                    html += `
                        <div class="status-item">
                            <span class="status-label">Link Quality Indicator</span>
                            <span class="status-value" style="color: ${lqiColor}; font-weight: bold;">
                                ${formatNum(lqiValue)} ${lqiUnit}
                            </span>
                        </div>
                    `;
                }
            }

            html += `
                        <div class="status-item">
                            <span class="status-label">Gerätetyp</span>
                            <span class="status-value">Zigbee Repeater</span>
                        </div>
                    </div>
                </div>
            `;

            return html;
        }

        function renderZigbeeDeviceInfo(kf) {
            if (!kf.deviceBattery && !kf.zigbeeLqi) return '';

            let html = `
                <div class="card">
                    <div class="card-header">
                        <h2>🔋 Geräteinformationen</h2>
                    </div>
                    <div class="status-list">
            `;

            if (kf.deviceBattery) {
                // Nested property: value.level.value
                const batteryData = kf.deviceBattery.value;
                if (batteryData && batteryData.level && typeof batteryData.level.value === 'number') {
                    const battery = batteryData.level.value;
                    const batteryUnit = batteryData.level.unit || '%';
                    const batteryColor = battery >= 70 ? '#10b981' : battery >= 30 ? '#f59e0b' : '#ef4444';
                    const batteryIcon = battery >= 70 ? '🔋' : battery >= 30 ? '🪫' : '🔴';
                    html += `
                        <div class="status-item">
                            <span class="status-label">Batteriestand</span>
                            <span class="status-value" style="color: ${batteryColor}; font-weight: bold;">
                                ${batteryIcon} ${formatNum(battery)} ${batteryUnit}
                            </span>
                        </div>
                    `;
                }
            }

            if (kf.zigbeeLqi) {
                // Nested property: value.strength.value
                const lqiData = kf.zigbeeLqi.value;
                if (lqiData && lqiData.strength && typeof lqiData.strength.value === 'number') {
                    const lqiValue = lqiData.strength.value;
                    const lqiUnit = lqiData.strength.unit || '%';
                    const lqiColor = lqiValue >= 70 ? '#10b981' : lqiValue >= 40 ? '#f59e0b' : '#ef4444';
                    html += `
                        <div class="status-item">
                            <span class="status-label">Link Quality</span>
                            <span class="status-value" style="color: ${lqiColor}; font-weight: bold;">
                                ${formatNum(lqiValue)} ${lqiUnit}
                            </span>
                        </div>
                    `;
                }
            }

            html += `
                    </div>
                </div>
            `;

            return html;
        }
