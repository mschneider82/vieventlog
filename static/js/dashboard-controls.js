        async function showDebugDevices() {
            try {
                const params = new URLSearchParams();
                if (!showAllDevices) params.append('onlyUnknown', 'true');

                const response = await fetch('/api/debug/devices?' + params.toString());
                if (!response.ok) {
                    throw new Error('API Fehler: ' + response.status);
                }

                const data = await response.json();
                currentDebugData = data;
                renderDebugModal(data);

            } catch (error) {
                showError('Fehler beim Laden der Debug-Daten: ' + error.message);
            }
        }

        function renderDebugModal(data) {
            // Create modal
            const modal = document.createElement('div');
            modal.className = 'debug-modal';
            modal.id = 'debugModal';

            let devicesHtml = '';
            for (let i = 0; i < data.devices.length; i++) {
                const device = data.devices[i];
                const deviceKey = `${device.installationId}_${device.gatewaySerial}_${device.deviceId}`;
                const hasFeatures = deviceFeatures[deviceKey];

                let featuresHtml = '';
                if (hasFeatures) {
                    if (hasFeatures.error) {
                        featuresHtml = `
            <div style="margin-top: 10px; padding: 10px; background: rgba(220, 38, 38, 0.1); border: 1px solid rgba(220, 38, 38, 0.3); border-radius: 4px; color: #fca5a5;">
                ❌ Fehler beim Laden der Features: ${hasFeatures.error}
            </div>
                        `;
                    } else if (hasFeatures.features && hasFeatures.features.length > 0) {
                        featuresHtml = `
            <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); border-radius: 4px;">
                <div style="color: #667eea; font-weight: 600; margin-bottom: 8px;">📊 Features (${hasFeatures.features.length}):</div>
                <div style="max-height: 200px; overflow-y: auto; font-size: 11px;">
                    ${hasFeatures.features.map(f => `
                        <div style="margin-bottom: 6px; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 3px;">
                            <div style="color: #fbbf24;">${f.feature}</div>
                            ${f.properties && f.properties.value ? `
                                <div style="color: #a0a0b0; margin-left: 10px;">
                                    ${JSON.stringify(f.properties.value).substring(0, 100)}${JSON.stringify(f.properties.value).length > 100 ? '...' : ''}
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
                        `;
                    } else {
                        featuresHtml = `
            <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 4px; color: #a0a0b0; font-style: italic;">
                Keine Features gefunden
            </div>
                        `;
                    }
                }

                devicesHtml += `
                    <div class="debug-device">
                        <div class="debug-device-header">
            <span class="debug-device-type">${device.deviceType}</span>
            <span class="debug-device-model">${device.modelId}</span>
                        </div>
                        <div class="debug-device-details">
            <div class="debug-device-detail">
                <span class="debug-device-detail-label">Installation:</span>
                <span>${device.installationDesc || device.installationId}</span>
            </div>
            <div class="debug-device-detail">
                <span class="debug-device-detail-label">Device ID:</span>
                <span>${device.deviceId}</span>
            </div>
            <div class="debug-device-detail">
                <span class="debug-device-detail-label">Gateway:</span>
                <span>${device.gatewaySerial}</span>
            </div>
            ${device.accountName ? `
            <div class="debug-device-detail">
                <span class="debug-device-detail-label">Account:</span>
                <span>${device.accountName}</span>
            </div>
            ` : ''}
                        </div>
                        ${featuresHtml}
                        <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="toggle-all" style="flex: 1; min-width: 140px; ${hasFeatures ? 'background: linear-gradient(135deg, #10b981 0%, #059669 100%);' : ''}"
                    onclick="loadDeviceFeatures('${deviceKey}', ${i})">
                ${hasFeatures ? '✅ Features geladen' : '📊 Features laden'}
            </button>
            <button class="toggle-all" style="flex: 1; min-width: 140px;" onclick="copyDeviceJson(${i})">
                📋 JSON kopieren
            </button>
            <button class="toggle-all" style="flex: 1; min-width: 140px;" onclick="downloadDeviceJson(${i})">
                💾 JSON herunterladen
            </button>
                        </div>
                    </div>
                `;
            }

            const jsonString = JSON.stringify(data, null, 2);

            modal.innerHTML = `
                <div class="debug-content">
                    <div class="debug-header">
                        <h2>🐛 Debug: Geräte-Übersicht</h2>
                        <button class="close-btn" onclick="closeDebugModal()">✕ Schließen</button>
                    </div>
                    <div class="debug-summary">
                        <div class="debug-stat">
            <div class="debug-stat-label">Angezeigte Geräte</div>
            <div class="debug-stat-value">${data.totalDevices}</div>
                        </div>
                        <div class="debug-stat">
            <div class="debug-stat-label">Unbekannte Geräte</div>
            <div class="debug-stat-value">${data.unknownDevices}</div>
                        </div>
                    </div>
                    <div class="debug-actions">
                        <button class="toggle-all" onclick="toggleAllDevices()">
            ${showAllDevices ? '🔽 Nur unbekannte Geräte' : '🔼 Alle Geräte anzeigen'}
                        </button>
                        <button class="toggle-all" onclick="toggleJsonView()">
            ${showJsonView ? '👁️ Liste anzeigen' : '📄 JSON anzeigen'}
                        </button>
                    </div>
                    <div style="padding: 12px; background: rgba(102, 126, 234, 0.1); border: 1px solid rgba(102, 126, 234, 0.3); border-radius: 6px; margin-bottom: 15px; color: #667eea; font-size: 13px;">
                        ℹ️ Verwende die Buttons unter jedem Gerät um Features zu laden oder das Gerät zu exportieren.
                    </div>
                    <div id="debugDeviceList" style="max-height: 500px; overflow-y: auto; display: ${showJsonView ? 'none' : 'block'};">
                        ${devicesHtml || '<p style="color: #a0a0b0; text-align: center; padding: 20px;">Keine Geräte gefunden</p>'}
                    </div>
                    <div id="debugJsonView" class="json-view" style="display: ${showJsonView ? 'block' : 'none'};">${jsonString}</div>
                </div>
            `;

            document.body.appendChild(modal);

            // Close on background click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeDebugModal();
                }
            });
        }

        function closeDebugModal() {
            const modal = document.getElementById('debugModal');
            if (modal) {
                modal.remove();
            }
        }

        function toggleAllDevices() {
            showAllDevices = !showAllDevices;
            closeDebugModal();
            showDebugDevices();
        }

        function toggleJsonView() {
            showJsonView = !showJsonView;
            closeDebugModal();
            renderDebugModal(currentDebugData);
        }

        async function loadDeviceFeatures(deviceKey, deviceIndex) {
            const device = currentDebugData.devices[deviceIndex];

            // Show loading indicator
            const btn = event.target;
            const originalText = btn.textContent;
            btn.textContent = '⏳ Laden...';
            btn.disabled = true;

            try {
                const response = await fetch(`/api/features?installationId=${device.installationId}&gatewaySerial=${device.gatewaySerial}&deviceId=${device.deviceId}`);
                if (!response.ok) {
                    throw new Error('API Fehler: ' + response.status);
                }

                const features = await response.json();

                // Store features for this device
                deviceFeatures[deviceKey] = {
                    features: features.rawFeatures || []
                };

                // Re-render modal to show features
                closeDebugModal();
                renderDebugModal(currentDebugData);

            } catch (error) {
                deviceFeatures[deviceKey] = {
                    error: error.message
                };
                closeDebugModal();
                renderDebugModal(currentDebugData);
            }
        }

        async function copyDeviceJson(deviceIndex) {
            const device = currentDebugData.devices[deviceIndex];
            const deviceKey = `${device.installationId}_${device.gatewaySerial}_${device.deviceId}`;

            // Build device JSON with features if loaded
            const deviceData = { ...device };
            if (deviceFeatures[deviceKey]) {
                if (deviceFeatures[deviceKey].features) {
                    deviceData.features = deviceFeatures[deviceKey].features;
                }
                if (deviceFeatures[deviceKey].error) {
                    deviceData.featuresError = deviceFeatures[deviceKey].error;
                }
            }

            const jsonString = JSON.stringify(deviceData, null, 2);

            try {
                await navigator.clipboard.writeText(jsonString);
                // Show success feedback
                const btn = event.target;
                const originalText = btn.textContent;
                btn.textContent = '✅ Kopiert!';
                btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '';
                }, 2000);
            } catch (err) {
                showError('Fehler beim Kopieren: ' + err.message);
            }
        }

        function downloadDeviceJson(deviceIndex) {
            const device = currentDebugData.devices[deviceIndex];
            const deviceKey = `${device.installationId}_${device.gatewaySerial}_${device.deviceId}`;

            // Build device JSON with features if loaded
            const deviceData = { ...device };
            if (deviceFeatures[deviceKey]) {
                if (deviceFeatures[deviceKey].features) {
                    deviceData.features = deviceFeatures[deviceKey].features;
                }
                if (deviceFeatures[deviceKey].error) {
                    deviceData.featuresError = deviceFeatures[deviceKey].error;
                }
            }

            const jsonString = JSON.stringify(deviceData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            // Create filename from device info
            const filename = `vicare-device-${device.deviceType}-${device.modelId.replace(/[^a-zA-Z0-9]/g, '_')}-${device.deviceId}.json`;
            a.download = filename;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Show success feedback
            const btn = event.target;
            const originalText = btn.textContent;
            btn.textContent = '✅ Heruntergeladen!';
            btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = '';
            }, 2000);
        }

        // --- Device Settings Modal ---

        window.deviceSettingsCache = {}; // Cache for device settings

        async function loadDeviceSettings(installationId, deviceId) {
            // Get account from current device
            const accountId = window.currentDeviceInfo?.accountId;
            if (!accountId) {
                console.log('No accountId available for device settings');
                return;
            }

            try {
                const response = await fetch(`/api/device-settings/get?accountId=${encodeURIComponent(accountId)}&installationId=${encodeURIComponent(installationId)}&deviceId=${encodeURIComponent(deviceId)}`);
                const data = await response.json();

                if (data.success) {
                    const deviceKey = `${installationId}_${deviceId}`;
                    window.deviceSettingsCache[deviceKey] = {
                        min: data.compressorRpmMin || 0,
                        max: data.compressorRpmMax || 0,
                        powerCorrectionFactor: data.compressorPowerCorrectionFactor || 1.0,
                        electricityPrice: data.electricityPrice || 0.30,
                        useAirIntakeTemperatureLabel: data.useAirIntakeTemperatureLabel, // null = auto-detect, true/false = override
                        hasHotWaterBuffer: data.hasHotWaterBuffer, // true = secundär , false = Heizkreis
                        cyclesperdaystart: data.cyclesperdaystart,
                        showCyclesPerDay: data.showCyclesPerDay
                    };
                }
            } catch (error) {
                console.error('Error loading device settings:', error);
            }
        }

        async function openDeviceSettingsModal(installationId, deviceId) {
            // Get account from current device
            const accountId = window.currentDeviceInfo?.accountId;
            if (!accountId) {
                alert('Kein Account für dieses Gerät verfügbar');
                return;
            }

            // Load current settings
            try {
                const response = await fetch(`/api/device-settings/get?accountId=${encodeURIComponent(accountId)}&installationId=${encodeURIComponent(installationId)}&deviceId=${encodeURIComponent(deviceId)}`);
                const data = await response.json();

                if (!data.success) {
                    console.error('Failed to load settings:', data.error);
                }

                showDeviceSettingsModal(installationId, deviceId, data.compressorRpmMin || 0, data.compressorRpmMax || 0, data.compressorPowerCorrectionFactor || 1.0, data.electricityPrice || 0.30, data.useAirIntakeTemperatureLabel, data.hasHotWaterBuffer, data.cyclesperdaystart, data.showCyclesPerDay);
            } catch (error) {
                console.error('Error loading device settings:', error);
                showDeviceSettingsModal(installationId, deviceId, 0, 0, 1.0, 0.30, null, null, null, false);
            }
        }

        function showDeviceSettingsModal(installationId, deviceId, currentMin, currentMax, correctionFactor, electricityPrice, useAirIntakeTemperatureLabel, hasHotWaterBuffer, cyclesperdaystart, showCyclesPerDay) {
            const modal = document.createElement('div');
            modal.className = 'debug-modal';
            modal.style.display = 'flex';

            // Determine radio button state for temperature label
            let radioState = 'auto'; // default
            if (useAirIntakeTemperatureLabel === true) {
                radioState = 'air';
            } else if (useAirIntakeTemperatureLabel === false) {
                radioState = 'primary';
            }

            // Determine radio button state for spreizung and COP
            let spreizungState = 'IDU'; // default
            if (hasHotWaterBuffer === true) {
                spreizungState = 'ODU';
            } else if (hasHotWaterBuffer === false) {
                spreizungState = 'IDU';
            }

            // Format cyclesperdaystart for date picker (CORRECTED VERSION)
            let cyclestart = "2025-01-01";
            if (cyclesperdaystart !== undefined && !isNaN(cyclesperdaystart)) {
                const date = new Date(cyclesperdaystart * 1000);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                cyclestart = `${year}-${month}-${day}`;
            }

            // Determine toggle state (default to true if cyclesperdaystart is set)
            const toggleChecked = showCyclesPerDay !== undefined ? showCyclesPerDay : (cyclesperdaystart !== undefined);

            modal.innerHTML = `
                <div style="background: #1a1a2e; padding: 30px; border-radius: 12px; max-width: 500px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
                    <h2 style="margin-top: 0; color: #fff;">⚙️ Geräteeinstellungen</h2>
                    <p style="color: #a0a0b0; margin-bottom: 20px;">Device: ${deviceId}</p>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; color: #fff; margin-bottom: 8px; font-weight: 600;">
                            Kompressor U/min Minimum
                        </label>
                        <input type="number" id="rpmMin" value="${currentMin}"
                               style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; font-size: 14px;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; color: #fff; margin-bottom: 8px; font-weight: 600;">
                            Kompressor U/min Maximum
                        </label>
                        <input type="number" id="rpmMax" value="${currentMax}"
                               style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; font-size: 14px;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; color: #fff; margin-bottom: 8px; font-weight: 600;">
                            Leistungskorrekturfaktor (Standard: 1.00)
                        </label>
                        <input type="number" id="powerCorrectionFactor" value="${correctionFactor.toFixed(2)}" step="0.01" min="0.01" max="10.00"
                               style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; font-size: 14px;">
                        <p style="color: #a0a0b0; font-size: 12px; margin-top: 5px;">Korrigiert die Leistungsanzeige und COP-Berechnung (Leistung × Faktor)</p>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; color: #fff; margin-bottom: 8px; font-weight: 600;">
                            ⚡ Strompreis (Standard: 0.30 €/kWh)
                        </label>
                        <input type="number" id="electricityPrice" value="${electricityPrice.toFixed(2)}" step="0.01" min="0.01" max="1.00"
                               style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; font-size: 14px;">
                        <p style="color: #a0a0b0; font-size: 12px; margin-top: 5px;">Preis pro kWh für Verbrauchskosten-Berechnung in den Statistiken</p>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; color: #fff; margin-bottom: 12px; font-weight: 600;">
                            Temperaturbezeichnung für Primärkreis
                        </label>
                        <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px;">
                            <div style="margin-bottom: 8px;">
                                <input type="radio" id="labelAuto" name="tempLabel" value="auto" ${radioState === 'auto' ? 'checked' : ''}
                                       style="cursor: pointer;">
                                <label for="labelAuto" style="color: #a0a0b0; cursor: pointer; display: inline;">
                                    Automatisch erkennen (Standard)
                                </label>
                            </div>
                            <div style="margin-bottom: 8px;">
                                <input type="radio" id="labelAir" name="tempLabel" value="air" ${radioState === 'air' ? 'checked' : ''}
                                       style="cursor: pointer;">
                                <label for="labelAir" style="color: #a0a0b0; cursor: pointer; display: inline;">
                                    Lufteintrittstemperatur
                                </label>
                            </div>
                            <div>
                                <input type="radio" id="labelPrimary" name="tempLabel" value="primary" ${radioState === 'primary' ? 'checked' : ''}
                                       style="cursor: pointer;">
                                <label for="labelPrimary" style="color: #a0a0b0; cursor: pointer; display: inline;">
                                    Primärkreisvorlauf
                                </label>
                            </div>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; color: #fff; margin-bottom: 12px; font-weight: 600;">
                            Spreizungs- / COP- berechnung
                        </label>
                        <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px;">
                            <div style="margin-bottom: 8px;">
                                <input type="radio" id="spreizungODU" name="spreizung" value="ODU" ${spreizungState === 'ODU' ? 'checked' : ''}
                                       style="cursor: pointer;">
                                <label for="spreizungWith" style="color: #a0a0b0; cursor: pointer; display: inline;">
                                    ODU Sekundärkreis
                                </label>
                            </div>
                            <div>
                                <input type="radio" id="spreizungIDU" name="spreizung" value="IDU" ${spreizungState === 'IDU' ? 'checked' : ''}
                                       style="cursor: pointer;">
                                <label for="spreizungWithout" style="color: #a0a0b0; cursor: pointer; display: inline;">
                                    IDU Heizkreis / Wärmeerzeuger
                                </label>
                            </div>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; color: #fff; margin-bottom: 12px; font-weight: 600;">
                            Takte pro Tag
                        </label>
                        <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 10px;">
                            <label style="color: #a0a0b0; font-size: 16px;">Anzeigen:</label>
                            <label style="position: relative; display: inline-block; width: 50px; height: 24px; cursor: pointer;">
                                <input type="checkbox" id="showCyclesPerDayToggle" ${toggleChecked ? 'checked' : ''}
                                       onchange="document.getElementById('showCyclesPerDayToggle').nextElementSibling.style.backgroundColor = this.checked ? '#667eea' : 'rgba(255,255,255,0.2)'; document.getElementById('showCyclesPerDayToggle').nextElementSibling.nextElementSibling.style.transform = this.checked ? 'translateX(26px)' : 'translateX(0)';"
                                       style="opacity: 0; width: 0; height: 0;">
                                <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${toggleChecked ? '#667eea' : 'rgba(255,255,255,0.2)'}; transition: .4s; border-radius: 24px; border: 1px solid rgba(255,255,255,0.1);"></span>
                                <span style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; transform: ${toggleChecked ? 'translateX(26px)' : 'translateX(0)'};"></span>
                            </label>
                        </div>
                        <div style="display: inline-flex; align-items: center; gap: 8px; margin-left: 10px;">
                            <label for="cyclesperDayCustomDatePicker" style="color: #a0a0b0; font-size: 16px; white-space: nowrap;">📅 erster Tag:</label>
                            <input type="date" id="cyclesperDayCustomDatePicker" class="custom-date-input" value="${cyclestart}" style="padding: 6px 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; font-size: 16px; cursor: pointer;">
                        </div>
                    </div>

                    <div style="display: flex; gap: 10px; margin-top: 30px;">
                        <button onclick="saveDeviceSettings('${installationId}', '${deviceId}')"
                                style="flex: 1; padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                            💾 Speichern
                        </button>
                        <button onclick="deleteDeviceSettings('${installationId}', '${deviceId}')"
                                style="flex: 1; padding: 12px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                            🗑️ Löschen
                        </button>
                        <button onclick="closeDeviceSettingsModal()"
                                style="padding: 12px 20px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; cursor: pointer; font-weight: 600;">
                            Abbrechen
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            modal.id = 'deviceSettingsModal';

            // Close on background click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeDeviceSettingsModal();
                }
            });
        }

        function closeDeviceSettingsModal() {
            const modal = document.getElementById('deviceSettingsModal');
            if (modal) {
                modal.remove();
            }
        }

        async function saveDeviceSettings(installationId, deviceId) {
            const accountId = window.currentDeviceInfo?.accountId;
            if (!accountId) {
                alert('Kein Account für dieses Gerät verfügbar');
                return;
            }

            const rpmMin = parseInt(document.getElementById('rpmMin').value) || 0;
            const rpmMax = parseInt(document.getElementById('rpmMax').value) || 0;
            const powerCorrectionFactor = parseFloat(document.getElementById('powerCorrectionFactor').value) || 1.0;
            const electricityPrice = parseFloat(document.getElementById('electricityPrice').value) || 0.30;

            if (rpmMin >= rpmMax && rpmMax !== 0) {
                alert('Minimum muss kleiner als Maximum sein');
                return;
            }

            if (powerCorrectionFactor <= 0 || powerCorrectionFactor > 10) {
                alert('Korrekturfaktor muss zwischen 0.01 und 10.00 liegen');
                return;
            }

            if (electricityPrice <= 0 || electricityPrice > 1) {
                alert('Strompreis muss zwischen 0.01 und 1.00 €/kWh liegen');
                return;
            }

            // Get temperature label setting from radio buttons
            const radioValue = document.querySelector('input[name="tempLabel"]:checked').value;
            let useAirIntakeTemperatureLabel = null;
            if (radioValue === 'air') {
                useAirIntakeTemperatureLabel = true;
            } else if (radioValue === 'primary') {
                useAirIntakeTemperatureLabel = false;
            }
            // else 'auto' means null (auto-detect)

            // Get spreizung setting from radio buttons
            const spreizungValue = document.querySelector('input[name="spreizung"]:checked').value;
            let hasHotWaterBuffer = false;
            if (spreizungValue === 'ODU') {
                hasHotWaterBuffer = true;
            }
            // else if (spreizungValue === 'IDU') {hasHotWaterBuffer = false;}
            // else 'auto' means null (auto-detect)

            // Get cycles per day start date
            let cyclesperdaystart = 1735686000; // Default: 2025-01-01
            const datePicker = document.querySelector('#cyclesperDayCustomDatePicker');
            if (datePicker && datePicker.value) {
                const startdate = datePicker.value;
                cyclesperdaystart = Date.parse(startdate) / 1000; // Convert to Unix timestamp in seconds
                if (isNaN(cyclesperdaystart)) {
                    cyclesperdaystart = 1735686000; // Fallback if date parsing fails
                }
            }

            // Get show cycles per day toggle
            const showCyclesPerDayToggle = document.querySelector('#showCyclesPerDayToggle');
            const showCyclesPerDay = showCyclesPerDayToggle ? showCyclesPerDayToggle.checked : false;

            try {
                const response = await fetch('/api/device-settings/set', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        accountId: accountId,
                        installationId: installationId,
                        deviceId: deviceId,
                        compressorRpmMin: rpmMin,
                        compressorRpmMax: rpmMax,
                        compressorPowerCorrectionFactor: powerCorrectionFactor,
                        electricityPrice: electricityPrice,
                        useAirIntakeTemperatureLabel: useAirIntakeTemperatureLabel,
                        hasHotWaterBuffer: hasHotWaterBuffer,
                        cyclesperdaystart: cyclesperdaystart,
                        showCyclesPerDay: showCyclesPerDay
                    })
                });

                const data = await response.json();

                if (data.success) {
                    // Update cache
                    const deviceKey = `${installationId}_${deviceId}`;
                    if (!window.deviceSettingsCache[deviceKey]) {
                        window.deviceSettingsCache[deviceKey] = {};
                    }
                    window.deviceSettingsCache[deviceKey].min = rpmMin;
                    window.deviceSettingsCache[deviceKey].max = rpmMax;
                    window.deviceSettingsCache[deviceKey].powerCorrectionFactor = powerCorrectionFactor;
                    window.deviceSettingsCache[deviceKey].electricityPrice = electricityPrice;
                    window.deviceSettingsCache[deviceKey].useAirIntakeTemperatureLabel = useAirIntakeTemperatureLabel;
                    window.deviceSettingsCache[deviceKey].hasHotWaterBuffer = hasHotWaterBuffer;
                    window.deviceSettingsCache[deviceKey].cyclesperdaystart = cyclesperdaystart;
                    window.deviceSettingsCache[deviceKey].showCyclesPerDay = showCyclesPerDay;

                    alert('Einstellungen gespeichert!');
                    closeDeviceSettingsModal();

                    // Reload dashboard to show updated labels and percentages
                    loadDashboard();
                } else {
                    alert('Fehler beim Speichern: ' + data.error);
                }
            } catch (error) {
                alert('Fehler beim Speichern: ' + error.message);
            }
        }

        async function deleteDeviceSettings(installationId, deviceId) {
            if (!confirm('Einstellungen wirklich löschen?')) {
                return;
            }

            const accountId = window.currentDeviceInfo?.accountId;
            if (!accountId) {
                alert('Kein Account für dieses Gerät verfügbar');
                return;
            }

            try {
                const response = await fetch('/api/device-settings/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        accountId: accountId,
                        installationId: installationId,
                        deviceId: deviceId
                    })
                });

                const data = await response.json();

                if (data.success) {
                    // Clear cache
                    const deviceKey = `${installationId}_${deviceId}`;
                    delete window.deviceSettingsCache[deviceKey];

                    alert('Einstellungen gelöscht!');
                    closeDeviceSettingsModal();

                    // Reload dashboard
                    loadDashboard();
                } else {
                    alert('Fehler beim Löschen: ' + data.error);
                }
            } catch (error) {
                alert('Fehler beim Löschen: ' + error.message);
            }
        }

        // DHW Mode Change Function
        async function changeDhwMode(newMode) {
            const select = document.getElementById('dhwModeSelect');
            const originalValue = select.value;

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing
                select.disabled = true;

                const response = await fetch('/api/dhw/mode/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        mode: newMode
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log('DHW mode changed to:', newMode);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Betriebsart: ' + data.error);
                    select.value = originalValue;
                    select.disabled = false;
                }
            } catch (error) {
                alert('Fehler beim Ändern der Betriebsart: ' + error.message);
                select.value = originalValue;
                select.disabled = false;
            }
        }

        // Make changeDhwMode available globally
        window.changeDhwMode = changeDhwMode;

        // DHW Temperature Change Function
        async function changeDhwTemperature(newTemp) {
            const select = document.getElementById('dhwTargetSelect');
            const originalValue = select.value;

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing
                select.disabled = true;

                const response = await fetch('/api/dhw/temperature/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        temperature: parseFloat(newTemp)
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log('DHW temperature changed to:', newTemp);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Temperatur: ' + data.error);
                    select.value = originalValue;
                    select.disabled = false;
                }
            } catch (error) {
                alert('Fehler beim Ändern der Temperatur: ' + error.message);
                select.value = originalValue;
                select.disabled = false;
            }
        }

        // DHW Hysteresis Change Function
        async function changeDhwHysteresis(type, newValue) {
            const selectId = type === 'on' ? 'dhwHysteresisOnSelect' : 'dhwHysteresisOffSelect';
            const select = document.getElementById(selectId);
            const originalValue = select.value;

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing
                select.disabled = true;

                const response = await fetch('/api/dhw/hysteresis/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        type: type,
                        value: parseFloat(newValue)
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`DHW hysteresis ${type} changed to:`, newValue);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Hysterese: ' + data.error);
                    select.value = originalValue;
                    select.disabled = false;
                }
            } catch (error) {
                alert('Fehler beim Ändern der Hysterese: ' + error.message);
                select.value = originalValue;
                select.disabled = false;
            }
        }

        // DHW Temperature 2 Change Function
        async function changeDhwTemperature2(newTemp) {
            const select = document.getElementById('dhwTarget2Select');
            const originalValue = select.value;

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing
                select.disabled = true;

                const response = await fetch('/api/dhw/temperature2/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        temperature: parseFloat(newTemp)
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log('DHW temperature 2 changed to:', newTemp);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Temperatur 2: ' + data.error);
                    select.value = originalValue;
                    select.disabled = false;
                }
            } catch (error) {
                alert('Fehler beim Ändern der Temperatur 2: ' + error.message);
                select.value = originalValue;
                select.disabled = false;
            }
        }

        // Make functions available globally
        window.changeDhwTemperature = changeDhwTemperature;
        window.changeDhwTemperature2 = changeDhwTemperature2;
        window.changeDhwHysteresis = changeDhwHysteresis;

        // DHW One Time Charge Function
        async function startOneTimeCharge() {
            if (!confirm('Möchten Sie die einmalige Warmwassererwärmung wirklich starten?')) {
                return;
            }

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                const response = await fetch('/api/dhw/oneTimeCharge/activate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId
                    })
                });

                const data = await response.json();

                if (data.success) {
                    alert('Einmalige Warmwassererwärmung wurde gestartet! ✓');
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Starten: ' + data.error);
                }
            } catch (error) {
                alert('Fehler beim Starten: ' + error.message);
            }
        }

        // Make function available globally
        window.startOneTimeCharge = startOneTimeCharge;

        // Heating Curve Change Function
        async function changeHeatingCurve(circuitIdOrType, typeOrValue, valueOrNull = null) {
            // Support both old signature changeHeatingCurve(type, value) and new changeHeatingCurve(circuitId, type, value)
            let circuitId, type, newValue;
            if (valueOrNull === null) {
                // Old signature: changeHeatingCurve(type, value)
                circuitId = 0;
                type = circuitIdOrType;
                newValue = typeOrValue;
            } else {
                // New signature: changeHeatingCurve(circuitId, type, value)
                circuitId = circuitIdOrType;
                type = typeOrValue;
                newValue = valueOrNull;
            }

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Get current values from window.heatingCurveData for this circuit
                let shift = 0;
                let slope = 1.0;
                if (window.heatingCurveData && window.heatingCurveData[circuitId]) {
                    shift = window.heatingCurveData[circuitId].shift || 0;
                    slope = window.heatingCurveData[circuitId].slope || 1.0;
                }

                // Update the changed value
                if (type === 'shift') {
                    shift = parseInt(newValue);
                } else if (type === 'slope') {
                    slope = parseFloat(newValue);
                }

                // Disable both selects while changing (if they exist)
                const shiftSelect = document.getElementById('heatingCurveShiftSelect');
                const slopeSelect = document.getElementById('heatingCurveSlopeSelect');
                if (shiftSelect) shiftSelect.disabled = true;
                if (slopeSelect) slopeSelect.disabled = true;

                const response = await fetch('/api/heating/curve/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        circuit: circuitId,
                        shift: shift,
                        slope: slope
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`Heating curve changed for circuit ${circuitId}: shift=${shift}, slope=${slope}`);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Heizkurve: ' + data.error);
                    if (shiftSelect) shiftSelect.disabled = false;
                    if (slopeSelect) slopeSelect.disabled = false;
                }
            } catch (error) {
                alert('Fehler beim Ändern der Heizkurve: ' + error.message);
                const shiftSelect = document.getElementById('heatingCurveShiftSelect');
                const slopeSelect = document.getElementById('heatingCurveSlopeSelect');
                if (shiftSelect) shiftSelect.disabled = false;
                if (slopeSelect) slopeSelect.disabled = false;
            }
        }

        // Supply Temperature Max Change Function
        async function changeSupplyTempMax(circuitIdOrValue, tempValue = null) {
            // Support both old signature changeSupplyTempMax(value) and new changeSupplyTempMax(circuitId, value)
            let circuitId, newValue;
            if (tempValue === null) {
                // Old signature: changeSupplyTempMax(value)
                circuitId = 0;
                newValue = circuitIdOrValue;
            } else {
                // New signature: changeSupplyTempMax(circuitId, value)
                circuitId = circuitIdOrValue;
                newValue = tempValue;
            }

            const select = document.getElementById('supplyTempMaxSelect');

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing (if it exists)
                if (select) {
                    select.disabled = true;
                }

                const response = await fetch('/api/heating/supplyTempMax/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        circuit: circuitId,
                        temperature: parseInt(newValue)
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`Supply temperature max changed to ${newValue} for circuit ${circuitId}`);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Vorlauftemperaturbegrenzung: ' + data.error);
                    if (select) {
                        select.disabled = false;
                    }
                }
            } catch (error) {
                alert('Fehler beim Ändern der Vorlauftemperaturbegrenzung: ' + error.message);
                if (select) {
                    select.disabled = false;
                }
            }
        }

        // Room Temperature Change Function
        async function changeRoomTemp(circuitId, program, temperature) {
            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                const response = await fetch('/api/heating/roomTemp/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        circuit: circuitId,
                        program: program,
                        temperature: parseInt(temperature)
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`Room temperature for program ${program} changed to ${temperature}°C for circuit ${circuitId}`);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern der Raumtemperatur: ' + data.error);
                }
            } catch (error) {
                alert('Fehler beim Ändern der Raumtemperatur: ' + error.message);
            }
        }

        // Make functions available globally
        window.changeHeatingCurve = changeHeatingCurve;
        window.changeSupplyTempMax = changeSupplyTempMax;
        window.changeRoomTemp = changeRoomTemp;

        // Tab switching function for consumption statistics
        function switchStatTab(event, tabId) {
            // Find the parent card to scope operations to current card only
            const card = event.currentTarget.closest('.card');

            // Hide all tab contents within this card only
            const contents = card.querySelectorAll('.stat-tab-content');
            contents.forEach(content => content.style.display = 'none');

            // Remove active class from all tabs in current period
            const parentTabs = event.currentTarget.parentElement;
            const tabs = parentTabs.querySelectorAll('.stat-tab');
            tabs.forEach(tab => tab.classList.remove('active'));

            // Show selected tab content
            document.getElementById(tabId).style.display = 'block';

            // Add active class to clicked tab
            event.currentTarget.classList.add('active');
        }
        window.switchStatTab = switchStatTab;

        function switchStatPeriod(event, periodId) {
            // Find the parent card to scope operations to current card only
            const card = event.currentTarget.closest('.card');

            // Hide all period contents within this card only
            const contents = card.querySelectorAll('.stat-period-content');
            contents.forEach(content => content.style.display = 'none');

            // Remove active class from period tabs
            const parentTabs = event.currentTarget.parentElement;
            const tabs = parentTabs.querySelectorAll('.stat-tab');
            tabs.forEach(tab => tab.classList.remove('active'));

            // Show selected period content
            const periodElement = document.getElementById(periodId);
            periodElement.style.display = 'block';

            // Add active class to clicked period tab
            event.currentTarget.classList.add('active');

            // Show first tab content in the new period and activate first tab
            const firstTabContent = periodElement.querySelector('.stat-tab-content');
            const allTabContents = periodElement.querySelectorAll('.stat-tab-content');
            const subTabs = periodElement.querySelectorAll('.stat-tabs-scrollable .stat-tab');

            // Hide all tab contents in this period
            allTabContents.forEach(content => content.style.display = 'none');
            // Remove active from all sub-tabs
            subTabs.forEach(tab => tab.classList.remove('active'));

            // Show first tab content and mark first tab as active
            if (firstTabContent) {
                firstTabContent.style.display = 'block';
            }
            if (subTabs.length > 0) {
                subTabs[0].classList.add('active');
            }
        }
        window.switchStatPeriod = switchStatPeriod;

        // Heating Mode Change Function
        async function changeHeatingMode(circuitIdOrMode, modeValue = null) {
            // Support both old signature changeHeatingMode(mode) and new changeHeatingMode(circuitId, mode)
            let circuitId, newMode;
            if (modeValue === null) {
                // Old signature: changeHeatingMode(mode)
                circuitId = 0;
                newMode = circuitIdOrMode;
            } else {
                // New signature: changeHeatingMode(circuitId, mode)
                circuitId = circuitIdOrMode;
                newMode = modeValue;
            }

            const select = document.getElementById('heatingModeSelect');

            try {
                // Get current device info
                const currentInstall = installations.find(i => i.installationId === currentInstallationId);
                if (!currentInstall || !currentInstall.devices) {
                    throw new Error('Installation nicht gefunden');
                }

                const currentDevice = currentInstall.devices.find(d =>
                    d.deviceId === currentDeviceId && d.gatewaySerial === currentGatewaySerial
                );

                if (!currentDevice) {
                    throw new Error('Gerät nicht gefunden');
                }

                // Disable select while changing (if it exists)
                if (select) {
                    select.disabled = true;
                }

                const response = await fetch('/api/heating/mode/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDevice.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        circuit: circuitId,
                        mode: newMode
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`Heating mode changed to ${newMode} for circuit ${circuitId}`);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Ändern des Betriebsmodus: ' + data.error);
                    if (select) {
                        select.disabled = false;
                    }
                }
            } catch (error) {
                alert('Fehler beim Ändern des Betriebsmodus: ' + error.message);
                if (select) {
                    select.disabled = false;
                }
            }
        }

        // Make function available globally
        window.changeHeatingMode = changeHeatingMode;

        // --- Fan Ring Heating Control ---
        async function toggleFanRing(event) {
            event.preventDefault();

            try {
                if (!currentDeviceInfo) {
                    throw new Error('Device-Information nicht verfügbar');
                }

                const button = event.target;
                const currentState = button.dataset.current === 'true';
                const newState = !currentState;

                // Disable button while changing
                button.disabled = true;
                const originalText = button.textContent;
                button.textContent = '⏳ Wird geändert...';

                const response = await fetch('/api/fan-ring/toggle', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        accountId: currentDeviceInfo.accountId,
                        installationId: currentInstallationId,
                        gatewaySerial: currentGatewaySerial,
                        deviceId: currentDeviceId,
                        active: newState
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log(`Fan ring heating turned ${newState ? 'on' : 'off'}`);
                    // Wait a bit then reload to show new status
                    setTimeout(() => {
                        loadDashboard(true); // Force refresh
                    }, 2000);
                } else {
                    alert('Fehler beim Umschalten der Ventilatorringheizung: ' + data.error);
                    button.disabled = false;
                    button.textContent = originalText;
                }
            } catch (error) {
                alert('Fehler beim Umschalten der Ventilatorringheizung: ' + error.message);
                button.disabled = false;
                const originalText = event.target.dataset.originalText;
                if (originalText) {
                    event.target.textContent = originalText;
                }
            }
        }

        // Make function available globally
        window.toggleFanRing = toggleFanRing;

        // Hybrid Pro Control Modal Functions
        async function openHybridProControlModal(installationId, deviceId, gatewaySerial) {
            // Get account from current device
            const accountId = window.currentDeviceInfo?.accountId;
            if (!accountId) {
                alert('Kein Account für dieses Gerät verfügbar');
                return;
            }

            showHybridProControlModal(installationId, deviceId, gatewaySerial, accountId);
        }

        function showHybridProControlModal(installationId, deviceId, gatewaySerial, accountId) {
            // Store parameters for later use
            hybridModalParams = {
                installationId: installationId,
                deviceId: deviceId,
                accountId: accountId,
                gatewaySerial: gatewaySerial
            };

            const modal = document.createElement('div');
            modal.className = 'debug-modal';
            modal.style.display = 'flex';
            modal.style.zIndex = '10000';

            // Create a temporary container for the form
            const formContainer = document.createElement('div');
            formContainer.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 12px; max-width: 800px; width: 95%; max-height: 85vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <div id="hybridProControlContainer" style="display: block;">
                        <!-- Form will be loaded here -->
                    </div>
                </div>
            `;

            modal.appendChild(formContainer);
            document.body.appendChild(modal);
            modal.id = 'hybridProControlModal';

            // Close on background click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeHybridProControlModal();
                }
            });

            // Create inline form
            const container = document.getElementById('hybridProControlContainer');
            if (container) {
                container.innerHTML = `
                    <div style="margin-bottom: 20px; border-bottom: 2px solid #ddd; padding-bottom: 10px;">
                        <h2 style="margin: 0 0 5px 0; color: #333;">☀️ Hybrid Pro Control</h2>
                        <p style="margin: 0; color: #666; font-size: 14px;">Einstellungen für Hybrid-Wärmepumpensysteme</p>
                    </div>

                    <div id="hybridTabs" style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid #ddd; flex-wrap: wrap;">
                        <button class="hybrid-tab-btn active" onclick="switchHybridTab(event, 'electricity')" style="padding: 10px 15px; border: none; background: #f5f5f5; cursor: pointer; border-radius: 4px 4px 0 0; color: #666; font-weight: 500; transition: all 0.3s ease;">💡 Stromtarife</button>
                        <button class="hybrid-tab-btn" onclick="switchHybridTab(event, 'strategy')" style="padding: 10px 15px; border: none; background: #f5f5f5; cursor: pointer; border-radius: 4px 4px 0 0; color: #666; font-weight: 500; transition: all 0.3s ease;">⚙️ Regelstrategie</button>
                        <button class="hybrid-tab-btn" onclick="switchHybridTab(event, 'energyFactors')" style="padding: 10px 15px; border: none; background: #f5f5f5; cursor: pointer; border-radius: 4px 4px 0 0; color: #666; font-weight: 500; transition: all 0.3s ease;">📊 Primärenergiefaktoren</button>
                        <button class="hybrid-tab-btn" onclick="switchHybridTab(event, 'fossil')" style="padding: 10px 15px; border: none; background: #f5f5f5; cursor: pointer; border-radius: 4px 4px 0 0; color: #666; font-weight: 500; transition: all 0.3s ease;">🔥 Fossile Brennstoffe</button>
                    </div>

                    <form id="hybridProControlForm" style="margin-bottom: 20px;">
                        <!-- Electricity Prices Tab -->
                        <div id="electricity-tab" style="display: block; background: #f9f9f9; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                            <h3 style="margin: 0 0 10px 0; color: #333;">Elektrizitätstarife</h3>
                            <p style="margin: 0 0 15px 0; color: #888; font-size: 13px;">Einheit: EUR/kWh</p>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Niedertarif (Low) <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="electricityPriceLow" name="electricityPriceLow" step="0.001" min="0" placeholder="z.B. 0.15" required style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">EUR/kWh</span>
                                </div>
                            </div>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Normaltarif (Normal) <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="electricityPriceNormal" name="electricityPriceNormal" step="0.001" min="0" placeholder="z.B. 0.28" required style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">EUR/kWh</span>
                                </div>
                            </div>
                        </div>

                        <!-- Control Strategy Tab -->
                        <div id="strategy-tab" style="display: none; background: #f9f9f9; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                            <h3 style="margin: 0 0 10px 0; color: #333;">Regelstrategie</h3>
                            <p style="margin: 0 0 15px 0; color: #888; font-size: 13px;">Auswahl der Betriebsstrategie für das Hybrid-System</p>

                            <div style="margin: 0;">
                                <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 15px; padding: 12px; background: white; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; transition: all 0.2s ease;">
                                    <input type="radio" id="strategy-constant" name="controlStrategy" value="constant" style="cursor: pointer; accent-color: #4CAF50; margin-top: 2px;">
                                    <label for="strategy-constant" style="margin: 0; cursor: pointer; flex: 1;"><strong>Konstanttemperatur</strong><br><span style="color: #666; font-size: 13px;">Konstante Rücklauftemperatur unabhängig von Außentemperatur</span></label>
                                </div>

                                <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 15px; padding: 12px; background: white; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; transition: all 0.2s ease;">
                                    <input type="radio" id="strategy-ecological" name="controlStrategy" value="ecological" style="cursor: pointer; accent-color: #4CAF50; margin-top: 2px;">
                                    <label for="strategy-ecological" style="margin: 0; cursor: pointer; flex: 1;"><strong>Ökologisch</strong><br><span style="color: #666; font-size: 13px;">Maximaler Einsatz der Wärmepumpe für geringere CO₂-Emissionen</span></label>
                                </div>

                                <div style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: white; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; transition: all 0.2s ease;">
                                    <input type="radio" id="strategy-economic" name="controlStrategy" value="economic" style="cursor: pointer; accent-color: #4CAF50; margin-top: 2px;">
                                    <label for="strategy-economic" style="margin: 0; cursor: pointer; flex: 1;"><strong>Ökonomisch</strong><br><span style="color: #666; font-size: 13px;">Optimierung der Betriebskosten unter Berücksichtigung der Strompreise</span></label>
                                </div>
                            </div>
                        </div>

                        <!-- Energy Factors Tab -->
                        <div id="energyFactors-tab" style="display: none; background: #f9f9f9; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                            <h3 style="margin: 0 0 10px 0; color: #333;">Primärenergiefaktoren</h3>
                            <p style="margin: 0 0 15px 0; color: #888; font-size: 13px;">Wertangaben für die Effizienzberechnung</p>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Primärenergiefaktor Wärmepumpe <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="heatPumpEnergyFactor" name="heatPumpEnergyFactor" step="0.01" min="0" placeholder="z.B. 2.4" required style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">(dimensionslos)</span>
                                </div>
                                <small style="display: block; margin-top: 4px; color: #999; font-size: 12px;">Typisch: 2.0 - 3.5 für moderne Wärmepumpen</small>
                            </div>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Primärenergiefaktor Fossil (Kessel) <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="fossilEnergyFactor" name="fossilEnergyFactor" step="0.01" min="0" placeholder="z.B. 1.1" required style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">(dimensionslos)</span>
                                </div>
                                <small style="display: block; margin-top: 4px; color: #999; font-size: 12px;">Typisch: 1.0 - 1.3 für Gasheizungen</small>
                            </div>
                        </div>

                        <!-- Fossil Fuels Tab -->
                        <div id="fossil-tab" style="display: none; background: #f9f9f9; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                            <h3 style="margin: 0 0 10px 0; color: #333;">Energiekosten externer Wärmeerzeuger (Fossil)</h3>
                            <p style="margin: 0 0 15px 0; color: #888; font-size: 13px;">Einheit: EUR/kWh (für Gas) oder EUR/Liter (für Öl)</p>

                            <div style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px; margin-bottom: 15px; border-radius: 4px; color: #1976d2; font-size: 13px;">
                                💡 <strong>Hinweis:</strong> Diese Werte sind optional und werden für erweiterte Kostenberechnungen verwendet.
                            </div>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Niedertarif (Low) <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="fossilPriceLow" name="fossilPriceLow" step="0.001" min="0" placeholder="z.B. 0.08" style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">EUR/kWh</span>
                                </div>
                            </div>

                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #333;">Normaltarif (Normal) <span style="color: #2196F3; font-size: 12px;">ℹ️</span></label>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <input type="number" id="fossilPriceNormal" name="fossilPriceNormal" step="0.001" min="0" placeholder="z.B. 0.10" style="flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                    <span style="white-space: nowrap; color: #666; font-size: 13px; padding: 8px 10px; background: #f0f0f0; border-radius: 4px;">EUR/kWh</span>
                                </div>
                            </div>
                        </div>
                    </form>

                    <div style="display: flex; gap: 10px; align-items: center; margin-top: 20px; flex-wrap: wrap;">
                        <button onclick="saveHybridProControlFromModal()" style="padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; font-weight: 500; cursor: pointer;">💾 Einstellungen speichern</button>
                        <button onclick="resetHybridProControl()" style="padding: 10px 20px; background: #f0f0f0; color: #333; border: 1px solid #ddd; border-radius: 4px; font-weight: 500; cursor: pointer;">🔄 Zurücksetzen</button>
                        <div id="hybridProControlStatus" style="flex: 1; min-height: 20px; font-size: 13px; display: flex; align-items: center;"></div>
                    </div>
                `;

                // Add close button
                const closeBtn = document.createElement('button');
                closeBtn.textContent = '✕';
                closeBtn.style.cssText = `
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                    color: #666;
                    z-index: 10001;
                `;
                closeBtn.onclick = closeHybridProControlModal;
                formContainer.querySelector('div').appendChild(closeBtn);

                // Load settings after a small delay to ensure DOM is ready
                setTimeout(() => {
                    loadHybridProControlSettings(installationId, deviceId, accountId);
                }, 100);
            }
        }

        function closeHybridProControlModal() {
            const modal = document.getElementById('hybridProControlModal');
            if (modal) {
                modal.remove();
            }
        }

        // Switch between Hybrid Pro Control tabs
        function switchHybridTab(event, tabName) {
            // Remove active class from all buttons
            document.querySelectorAll('#hybridTabs .hybrid-tab-btn').forEach(btn => {
                btn.style.background = '#f5f5f5';
                btn.style.color = '#666';
            });

            // Hide all tab contents
            ['electricity', 'strategy', 'energyFactors', 'fossil'].forEach(tab => {
                const tabEl = document.getElementById(tab + '-tab');
                if (tabEl) tabEl.style.display = 'none';
            });

            // Activate clicked button
            event.target.style.background = '#4CAF50';
            event.target.style.color = 'white';

            // Show clicked tab
            const tabEl = document.getElementById(tabName + '-tab');
            if (tabEl) tabEl.style.display = 'block';
        }

        // Load Hybrid Pro Control settings (from both API and saved settings)
        async function loadHybridProControlSettings(installationId, deviceId, accountId) {
            try {
                // Get form elements (wait a bit to ensure they exist)
                const elLow = document.getElementById('electricityPriceLow');
                const elNorm = document.getElementById('electricityPriceNormal');
                const hpFactor = document.getElementById('heatPumpEnergyFactor');
                const fosFactor = document.getElementById('fossilEnergyFactor');
                const fosPriceLow = document.getElementById('fossilPriceLow');
                const fosPriceNorm = document.getElementById('fossilPriceNormal');

                if (!elLow) {
                    console.warn('Form elements not found, retrying in 300ms...');
                    setTimeout(() => loadHybridProControlSettings(installationId, deviceId, accountId), 300);
                    return;
                }

                // First, try to load saved settings from our API
                console.log('Loading hybrid settings for:', {installationId, deviceId, accountId});
                const params = new URLSearchParams({
                    accountId: accountId,
                    installationId: installationId,
                    deviceId: deviceId
                });

                let savedSettings = null;
                try {
                    const response = await fetch(`/api/hybrid-pro-control/get?${params}`);
                    const data = await response.json();
                    console.log('Saved settings response:', data);
                    if (data.success && data.settings) {
                        savedSettings = data.settings;
                    }
                } catch (e) {
                    console.log('No saved settings found');
                }

                // Also get current API values from keyFeatures (which are in the dashboard)
                const kf = window.currentKeyFeatures || {};
                console.log('Current API values from dashboard:', {
                    hybridElectricityPriceLow: kf.hybridElectricityPriceLow,
                    hybridElectricityPriceNormal: kf.hybridElectricityPriceNormal,
                    hybridHeatPumpEnergyFactor: kf.hybridHeatPumpEnergyFactor,
                    hybridFossilEnergyFactor: kf.hybridFossilEnergyFactor,
                    hybridFossilPriceLow: kf.hybridFossilPriceLow,
                    hybridFossilPriceNormal: kf.hybridFossilPriceNormal
                });

                // Helper to format number with up to 4 decimal places (but remove trailing zeros)
                const formatDecimal = (val) => {
                    if (!val) return '';
                    const num = parseFloat(val);
                    // Show up to 4 decimal places, but remove trailing zeros
                    return num.toFixed(4).replace(/\.?0+$/, '');
                };

                // Populate form: prefer saved settings, fallback to API values
                if (savedSettings && savedSettings.electricityPriceLow) {
                    elLow.value = formatDecimal(savedSettings.electricityPriceLow);
                } else if (kf.hybridElectricityPriceLow?.value) {
                    elLow.value = formatDecimal(kf.hybridElectricityPriceLow.value);
                }

                if (savedSettings && savedSettings.electricityPriceNormal) {
                    elNorm.value = formatDecimal(savedSettings.electricityPriceNormal);
                } else if (kf.hybridElectricityPriceNormal?.value) {
                    elNorm.value = formatDecimal(kf.hybridElectricityPriceNormal.value);
                }

                if (savedSettings && savedSettings.heatPumpEnergyFactor) {
                    hpFactor.value = formatDecimal(savedSettings.heatPumpEnergyFactor);
                } else if (kf.hybridHeatPumpEnergyFactor?.value) {
                    hpFactor.value = formatDecimal(kf.hybridHeatPumpEnergyFactor.value);
                }

                if (savedSettings && savedSettings.fossilEnergyFactor) {
                    fosFactor.value = formatDecimal(savedSettings.fossilEnergyFactor);
                } else if (kf.hybridFossilEnergyFactor?.value) {
                    fosFactor.value = formatDecimal(kf.hybridFossilEnergyFactor.value);
                }

                if (savedSettings && savedSettings.fossilPriceLow) {
                    fosPriceLow.value = formatDecimal(savedSettings.fossilPriceLow);
                } else if (kf.hybridFossilPriceLow?.value) {
                    fosPriceLow.value = formatDecimal(kf.hybridFossilPriceLow.value);
                }

                if (savedSettings && savedSettings.fossilPriceNormal) {
                    fosPriceNorm.value = formatDecimal(savedSettings.fossilPriceNormal);
                } else if (kf.hybridFossilPriceNormal?.value) {
                    fosPriceNorm.value = formatDecimal(kf.hybridFossilPriceNormal.value);
                }

                if (savedSettings && savedSettings.controlStrategy) {
                    const strategyRadio = document.getElementById('strategy-' + savedSettings.controlStrategy);
                    if (strategyRadio) {
                        strategyRadio.checked = true;
                        console.log('Selected strategy:', savedSettings.controlStrategy);
                    }
                }

                console.log('✅ Settings loaded and form populated');
            } catch (error) {
                console.error('Error loading hybrid settings:', error);
            }
        }

        // Save Hybrid Pro Control settings from modal
        function saveHybridProControlFromModal() {
            if (hybridModalParams.installationId && hybridModalParams.deviceId && hybridModalParams.accountId) {
                saveHybridProControl(hybridModalParams.installationId, hybridModalParams.deviceId, hybridModalParams.accountId);
            } else {
                showHybridStatus('❌ Fehler: Keine Geräte-Informationen verfügbar', 'error');
            }
        }

        // Save Hybrid Pro Control settings
        async function saveHybridProControl(installationId, deviceId, accountId) {
            // Get current form values
            const electricityLow = document.getElementById('electricityPriceLow').value;
            const electricityNormal = document.getElementById('electricityPriceNormal').value;
            const strategy = document.querySelector('input[name="controlStrategy"]:checked');
            const heatPumpFactor = document.getElementById('heatPumpEnergyFactor').value;
            const fossilFactor = document.getElementById('fossilEnergyFactor').value;
            const fossilPriceLow = document.getElementById('fossilPriceLow').value;
            const fossilPriceNorm = document.getElementById('fossilPriceNormal').value;

            // Check if at least ONE field has been filled in
            if (!electricityLow && !electricityNormal && !strategy && !heatPumpFactor && !fossilFactor && !fossilPriceLow && !fossilPriceNorm) {
                showHybridStatus('❌ Bitte füllen Sie mindestens ein Feld aus', 'error');
                return;
            }

            // Load current saved settings to merge with new values
            const params = new URLSearchParams({
                accountId: accountId,
                installationId: installationId,
                deviceId: deviceId
            });

            let currentSettings = null;
            try {
                const response = await fetch(`/api/hybrid-pro-control/get?${params}`);
                const data = await response.json();
                if (data.success && data.settings) {
                    currentSettings = data.settings;
                }
            } catch (e) {
                console.log('No existing settings found');
            }

            // Also get current API values as fallback
            const kf = window.currentKeyFeatures || {};

            // Build settings object: use filled values, keep existing values for empty fields
            const settings = {
                electricityPriceLow: electricityLow ? parseFloat(electricityLow) :
                                   (currentSettings?.electricityPriceLow || kf.hybridElectricityPriceLow?.value || 0),
                electricityPriceNormal: electricityNormal ? parseFloat(electricityNormal) :
                                       (currentSettings?.electricityPriceNormal || kf.hybridElectricityPriceNormal?.value || 0),
                controlStrategy: strategy ? strategy.value :
                               (currentSettings?.controlStrategy || ''),
                heatPumpEnergyFactor: heatPumpFactor ? parseFloat(heatPumpFactor) :
                                     (currentSettings?.heatPumpEnergyFactor || kf.hybridHeatPumpEnergyFactor?.value || 0),
                fossilEnergyFactor: fossilFactor ? parseFloat(fossilFactor) :
                                   (currentSettings?.fossilEnergyFactor || kf.hybridFossilEnergyFactor?.value || 0),
                fossilPriceLow: fossilPriceLow ? parseFloat(fossilPriceLow) :
                               (currentSettings?.fossilPriceLow || kf.hybridFossilPriceLow?.value || 0),
                fossilPriceNormal: fossilPriceNorm ? parseFloat(fossilPriceNorm) :
                                  (currentSettings?.fossilPriceNormal || kf.hybridFossilPriceNormal?.value || 0)
            };

            const request = {
                accountId: accountId,
                installationId: installationId,
                deviceId: deviceId,
                settings: settings
            };

            showHybridStatus('Speichern...', 'loading');

            try {
                const response = await fetch('/api/hybrid-pro-control/set', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(request)
                });

                const data = await response.json();

                if (data.success) {
                    showHybridStatus('✅ Einstellungen erfolgreich gespeichert', 'success');
                } else {
                    showHybridStatus('❌ Fehler: ' + (data.error || 'Unbekannter Fehler'), 'error');
                }
            } catch (error) {
                showHybridStatus('❌ Fehler beim Speichern: ' + error.message, 'error');
            }
        }

        // Reset Hybrid Pro Control form
        function resetHybridProControl() {
            // Get current values from server and reload form
            const form = document.getElementById('hybridProControlForm');
            if (form) {
                form.reset();
                // Use stored parameters
                if (hybridModalParams.installationId && hybridModalParams.deviceId && hybridModalParams.accountId) {
                    loadHybridProControlSettings(hybridModalParams.installationId, hybridModalParams.deviceId, hybridModalParams.accountId);
                }
            }
        }

        // Store parameters for use in hybrid modal
        let hybridModalParams = {
            installationId: null,
            deviceId: null,
            accountId: null,
            gatewaySerial: null
        };

        // Load saved hybrid pro control settings and store globally
        async function loadSavedHybridProControlSettings(accountId, installationId, deviceId) {
            try {
                const params = new URLSearchParams({
                    accountId: accountId,
                    installationId: installationId,
                    deviceId: deviceId
                });

                const response = await fetch(`/api/hybrid-pro-control/get?${params}`);
                const data = await response.json();

                if (data.success && data.settings) {
                    // Store saved settings globally
                    window.savedHybridProControlSettings = data.settings;
                    console.log('✅ Saved Hybrid Pro Control settings loaded:', data.settings);
                } else {
                    window.savedHybridProControlSettings = null;
                    console.log('No saved hybrid settings found');
                }
            } catch (error) {
                console.error('Error loading saved hybrid settings:', error);
                window.savedHybridProControlSettings = null;
            }
        }

        // Show status message for Hybrid Pro Control
        function showHybridStatus(message, type) {
            const statusDiv = document.getElementById('hybridProControlStatus');
            if (!statusDiv) return;

            statusDiv.textContent = message;
            statusDiv.style.color = type === 'success' ? '#2e7d32' : type === 'error' ? '#c62828' : '#f57f17';

            if (type === 'success' || type === 'error') {
                setTimeout(() => {
                    statusDiv.textContent = '';
                }, 4000);
            }
        }


        // Make functions available globally
        window.openHybridProControlModal = openHybridProControlModal;
        window.closeHybridProControlModal = closeHybridProControlModal;
        window.switchHybridTab = switchHybridTab;
        window.saveHybridProControl = saveHybridProControl;
        window.saveHybridProControlFromModal = saveHybridProControlFromModal;
        window.resetHybridProControl = resetHybridProControl;
