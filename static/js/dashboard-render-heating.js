// Dashboard Render - Heating Views
// Rendering functions for standard heating devices (Vitocal/Vitodens)
// Part 2 of 3 - refactored from dashboard-render.js

        function renderDeviceHeader(deviceInfo, kf) {
            // Prefer device.name feature over modelId/displayName
            let deviceTitle = deviceInfo.modelId || deviceInfo.displayName;
            if (kf.deviceName && kf.deviceName.value) {
                deviceTitle = kf.deviceName.value;
            }

            // Get deviceSettings only once - used throughout this function
            const deviceKey = `${deviceInfo.installationId}_${deviceInfo.deviceId}`;
            const deviceSettings = window.deviceSettingsCache[deviceKey];

            let hasHotWaterBuffer = true; // default
            if (deviceSettings && deviceSettings.hasHotWaterBuffer !== null && deviceSettings.hasHotWaterBuffer !== undefined) {
                hasHotWaterBuffer = deviceSettings.hasHotWaterBuffer;
            }

            const correctionFactor = deviceSettings?.powerCorrectionFactor || 1.0;

            // Show settings button for heat pumps (devices with compressor)
            const hasCompressor = kf.compressorSpeed || kf.compressorActive || kf.compressorHours;
            const settingsButton = hasCompressor ? `
                <button onclick="openDeviceSettingsModal('${deviceInfo.installationId}', '${deviceInfo.deviceId}')"
                        style="margin-left: 10px; padding: 5px 10px; cursor: pointer;">
                    ⚙️ Einstellungen
                </button>
            ` : '';

            // Check if this is a hybrid system and show Hybrid Pro Control button
            // Only consider it a hybrid if the status feature has an actual value (not null/undefined)
			const isHybrid = kf.secondaryHeatGeneratorStatus != null && typeof kf.secondaryHeatGeneratorStatus?.value === 'string';
            const hybridProControlButton = isHybrid ? `
                <button onclick="openHybridProControlModal('${deviceInfo.installationId}', '${deviceInfo.deviceId}', '${deviceInfo.gatewaySerial}')"
                        style="margin-left: 10px; padding: 5px 10px; cursor: pointer; background-color: #ff9800; color: white; border: none; border-radius: 4px;">
                    ☀️ Hybrid Pro Control
                </button>
            ` : '';

            // Build temperature grid - functionally sorted into groups
            // Group 1: Außen & Systemkreise
            // Group 2: Heizkreis Soll/Ist
            // Group 3: Speicher & Warmwasser
            // Group 4: Energiecockpit (Stromverbrauch, Thermische Leistung, COP)
            let tempsGroup1 = '';
            let tempsGroup2 = '';
            let tempsGroup3 = '';
            let tempsGroup4 = '';

            // --- GROUP 1: Außen & Systemkreise ---
            // Außentemperatur
            if (kf.outsideTemp) {
                const formatted = formatValue(kf.outsideTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                tempsGroup1 += `
                    <div class="temp-item">
                        <span class="temp-label">Außentemperatur</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            // Außentemperatur gedämpft
            if (kf.calculatedOutsideTemp) {
                const formatted = formatValue(kf.calculatedOutsideTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                tempsGroup1 += `
                    <div class="temp-item">
                        <span class="temp-label">Außentemp. (ged.)</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            // Primärkreis-Vorlauf
            if (kf.primarySupplyTemp) {
                const formatted = formatValue(kf.primarySupplyTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                // Determine label: check device settings first, then fall back to auto-detection
                let label = 'Primärkreis-Vorlauf'; // Default

                if (deviceSettings && deviceSettings.useAirIntakeTemperatureLabel !== null && deviceSettings.useAirIntakeTemperatureLabel !== undefined) {
                    // Use the explicit setting from device settings
                    label = deviceSettings.useAirIntakeTemperatureLabel ? 'Lufteintritts-temperatur' : 'Primärkreis-Vorlauf';
                } else {
                    // Fall back to auto-detection based on compressor sensors
                    const isVitocal = kf.compressorActive || kf.compressorSpeed || kf.compressorInletTemp ||
                                     kf.compressorOutletTemp || kf.compressorOilTemp || kf.compressorMotorTemp ||
                                     kf.compressorPressure;
                    if (isVitocal) {
                        label = 'Lufteintritts-temperatur';
                    }
                }

                tempsGroup1 += `
                    <div class="temp-item">
                        <span class="temp-label">${label}</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
			// Primärkreis-Rücklauf
            if (kf.primaryReturnTemp != null && (typeof kf.primaryReturnTemp?.value === 'number')) {
                const formatted = formatValue(kf.primaryReturnTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                tempsGroup1 += `
                    <div class="temp-item">
                        <span class="temp-label">Primärkreis-Rücklauf</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            // Sekundärkreis-Vorlauf
            if (kf.secondarySupplyTemp) {
                const formatted = formatValue(kf.secondarySupplyTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                tempsGroup1 += `
                    <div class="temp-item">
                        <span class="temp-label">Sekundärkreis-Vorlauf</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }

            // --- GROUP 2: Heizkreis Soll/Ist & Leistung ---
            // Solltemperatur (Heizkurve)
            if (kf.outsideTemp && kf.heatingCurveSlope && kf.heatingCurveShift) {
                const outsideTemp = kf.outsideTemp.value;
                const slope = kf.heatingCurveSlope.value;
                const shift = kf.heatingCurveShift.value;

                // Get room setpoint temperature (default: 20°C)
                let roomSetpoint = 20;
                if (window.heatingCurveData && window.heatingCurveData.roomTempSetpoint) {
                    roomSetpoint = window.heatingCurveData.roomTempSetpoint;
                }

                // Calculate target supply temperature using official Viessmann formula:
                // VT = RTSoll + Niveau - Neigung * DAR * (1.4347 + 0.021 * DAR + 247.9 * 10^-6 * DAR^2)
                // with DAR = AT - RTSoll
                const DAR = outsideTemp - roomSetpoint;
                let targetTemp = roomSetpoint + shift - slope * DAR * (1.4347 + 0.021 * DAR + 247.9 * 1e-6 * DAR * DAR);

                // Cap at max supply temperature if available
                const maxSupply = window.heatingCurveData && window.heatingCurveData.maxSupply;
                if (maxSupply !== null && maxSupply !== undefined && targetTemp > maxSupply) {
                    targetTemp = maxSupply;
                }

                tempsGroup2 += `
                    <div class="temp-item">
                        <span class="temp-label">Solltemperatur (Heizkurve)</span>
                        <div>
                            <span class="temp-value">${formatNum(targetTemp)}</span>
                            <span class="temp-unit">°C</span>
                        </div>
                    </div>
                `;
            }

            // Gemeinsame Vorlauftemperatur (only show when NO hot water buffer)
            if (!hasHotWaterBuffer && kf.supplyTemp) {
                const formatted = formatValue(kf.supplyTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                tempsGroup2 += `
                    <div class="temp-item">
                        <span class="temp-label">Gemeinsame Vorlauftemperatur</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            // Rücklauftemperatur
            if (kf.returnTemp) {
                const formatted = formatValue(kf.returnTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                tempsGroup2 += `
                    <div class="temp-item">
                        <span class="temp-label">Rücklauftemperatur</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            // Spreizung Primärkreis
            if (kf.primarySupplyTemp && kf.primaryReturnTemp) {
                const supplyValue = kf.primarySupplyTemp.value;
                const returnValue = kf.primaryReturnTemp.value;
                if (typeof returnValue === 'number' && typeof supplyValue === 'number') {
                    const spreizung = supplyValue - returnValue;
                    tempsGroup2 += `
                        <div class="temp-item">
                            <span class="temp-label">Spreizung Primärkreis</span>
                            <div>
                                <span class="temp-value">${formatNum(spreizung)}</span>
                                <span class="temp-unit">K</span>
                            </div>
                        </div>
                    `;
                }
            }
            // Spreizung Sekundärkreis/Heizkreis - use central calculation

            // Only show spreizung when there is flow > 50 l/h
            const volumetricFlowValue = kf.volumetricFlow ? unwrapValue(kf.volumetricFlow.value) : null;
            if (typeof volumetricFlowValue === 'number' && volumetricFlowValue > 50.0) {
                const spreizungResult = calculateSpreizung(kf, hasHotWaterBuffer);
                if (spreizungResult.spreizung !== null) {
                    tempsGroup2 += `
                        <div class="temp-item">
                            <span class="temp-label">${spreizungResult.label}</span>
                            <div>
                                <span class="temp-value">${formatNum(spreizungResult.spreizung)}</span>
                                <span class="temp-unit">K</span>
                            </div>
                        </div>
                    `;
                }
            }

            // --- GROUP 3: Speicher & Warmwasser ---
            // Warmwasser
            if (kf.dhwTemp) {
                const formatted = formatValue(kf.dhwTemp);
                const [value, ...unitParts] = formatted.split(' ');
                const unit = unitParts.join(' ');
                // Check if DHW is currently active (4-way valve in domesticHotWater position)
                const isDhwActive = kf.fourWayValve && kf.fourWayValve.value === 'domesticHotWater';
                const dhwClass = isDhwActive ? 'with-bg-fire' : '';
                tempsGroup3 += `
                    <div class="temp-item ${dhwClass}">
                        <span class="temp-label">Warmwasser</span>
                        <div>
                            <span class="temp-value">${value}</span>
                            <span class="temp-unit">${unit}</span>
                        </div>
                    </div>
                `;
            }
            // Wärmeerzeuger-Vorlauf (boilerTemp)
            if (kf.boilerTemp) {
				const boilerTempValue = kf.boilerTemp.value;
                if ( typeof boilerTempValue === 'number'){
					const formatted = formatValue(kf.boilerTemp);
                	const [value, ...unitParts] = formatted.split(' ');
                	const unit = unitParts.join(' ');
	                // Check if compressor is running
    	            const isCompressorRunning = kf.compressorActive ? kf.compressorActive.value : (kf.compressorSpeed && kf.compressorSpeed.value > 0);
        	        const compressorClass = isCompressorRunning ? 'with-bg-fan' : '';
            	    tempsGroup3 += `
                	    <div class="temp-item ${compressorClass}">
                    	    <span class="temp-label">Wärmeerzeuger-Vorlauf</span>
                        	<div>
                            	<span class="temp-value">${value}</span>
	                            <span class="temp-unit">${unit}</span>
    	                    </div>
        	            </div>
            	    `;
				}
			}
            // Puffertemperatur
            if (kf.bufferTemp) {
				const bufferTempValue = kf.bufferTemp.value;
                if ( typeof bufferTempValue === 'number'){
					const formatted = formatValue(kf.bufferTemp);
    	            const [value, ...unitParts] = formatted.split(' ');
        	        const unit = unitParts.join(' ');
	                tempsGroup3 += `
    	                <div class="temp-item">
        	                <span class="temp-label">Puffertemperatur</span>
            	            <div>
                	            <span class="temp-value">${value}</span>
                    	        <span class="temp-unit">${unit}</span>
                        	</div>
	                    </div>
    	            `;
				}
			}
            // Puffertemperatur Oben
            if (kf.bufferTempTop) {
				const bufferTempTopValue = kf.bufferTempTop.value;
                if ( typeof bufferTempTopValue === 'number'){
	                const formatted = formatValue(kf.bufferTempTop);
    	            const [value, ...unitParts] = formatted.split(' ');
        	        const unit = unitParts.join(' ');
    	            tempsGroup3 += `
        	            <div class="temp-item">
            	            <span class="temp-label">Puffertemperatur Oben</span>
                	        <div>
                    	        <span class="temp-value">${value}</span>
                        	    <span class="temp-unit">${unit}</span>
	                        </div>
    	                </div>
        	        `;
				}
			}

            // --- GROUP 4: Energiecockpit ---
            // Try to calculate thermal power and COP (either from flow or from direct features)

            let electricalPowerW = null;
            let thermalPowerW = null;

            // Try flow-based calculation first (primary method)
            if (kf.volumetricFlow){ // && kf.compressorPower) { thermal Power doesn't need compress power
                // Use central spreizung calculation
                const spreizungResult = calculateSpreizung(kf, hasHotWaterBuffer);
                const spreizung = spreizungResult.spreizung;
                const supplyTemp = spreizungResult.supplyTemp;

                if (spreizungResult.isValid) {
                    // Calculate water density based on supply temperature
                    const waterDensity = getWaterDensity(supplyTemp); // kg/m³
                    const specificHeatCapacity = 4180; // J/(kg·K)

                    // Convert volumetric flow from l/h to m³/s
                    const volumetricFlowValue = unwrapValue(kf.volumetricFlow.value);
                    if (typeof volumetricFlowValue === 'number') {
                        const volumetricFlowM3s = volumetricFlowValue / 3600000; // l/h to m³/s

                        // Calculate mass flow: ṁ = ρ × V̇
                        const massFlow = waterDensity * volumetricFlowM3s; // kg/s

                        // Calculate thermal power: Q = ṁ × c × ΔT
                        thermalPowerW = massFlow * specificHeatCapacity * spreizung; // W

                        // Get electrical power with correction factor
                        if (kf.compressorPower && kf.compressorPower.value !== undefined) {
                            electricalPowerW = unwrapValue(kf.compressorPower.value) * correctionFactor; // W (corrected)
                        }
                    }
                }
            }

            // Fallback for Oplink devices: use direct current features if flow-based calculation failed
            if (thermalPowerW === null && kf.compressorHeatProductionCurrent) {
                const heatProductionValue = unwrapValue(kf.compressorHeatProductionCurrent.value);
                if (typeof heatProductionValue === 'number') {
                    thermalPowerW = heatProductionValue; // Already in Watt
                }
            }

            if (electricalPowerW === null && kf.compressorPowerConsumptionCurrent) {
                const powerConsumptionValue = unwrapValue(kf.compressorPowerConsumptionCurrent.value);
                if (typeof powerConsumptionValue === 'number') {
                    electricalPowerW = powerConsumptionValue * 1000 * correctionFactor; // kW to W (with correction)
                }
            }


            // Display Energiecockpit if we have values (from either method)
            if (electricalPowerW !== null && electricalPowerW > 0) {

                // Add electrical power consumption tile (in W or kW)
				let elPow = 0.0;
				let elPowUnit = " ";
				let elPowlabel = "Stromverbrauch";
				if (correctionFactor != 1.0) elPowlabel = elPowlabel + "<br>(korrigiert)";
				if (electricalPowerW < 1000.0){elPow = formatNum(electricalPowerW, 0); elPowUnit = elPowUnit + "W";}
				else{elPow = formatNum(electricalPowerW / 1000, 2);elPowUnit = elPowUnit + "kW";}
                tempsGroup4 += `
                    <div class="temp-item">
						<span class="temp-label">${elPowlabel}</span>
                        <div>
                            <span class="temp-value">${elPow}</span>
                            <span class="temp-unit">${elPowUnit}</span>
                        </div>
                    </div>
                `;

                // Calculate thermal power if all required values are available
                if (kf.volumetricFlow || kf.compressorPower){

                    // Use central spreizung calculation
                    const spreizungResult3 = calculateSpreizung(kf, hasHotWaterBuffer);
                    const spreizung = spreizungResult3.spreizung;
                    const supplyTemp = spreizungResult3.supplyTemp;

                    if (spreizungResult3.isValid){

                        // Calculate water density based on supply temperature
                        const waterDensity = getWaterDensity(supplyTemp); // kg/m³
                        const specificHeatCapacity = 4180; // J/(kg·K)

                        // Convert volumetric flow from l/h to m³/s
                        const volumetricFlowValue = unwrapValue(kf.volumetricFlow.value);
                        if (typeof volumetricFlowValue !== 'number') return '';
                        const volumetricFlowM3s = volumetricFlowValue / 3600000; // l/h to m³/s

                        // Calculate mass flow: ṁ = ρ × V̇
                        const massFlow = waterDensity * volumetricFlowM3s; // kg/s

                        // Calculate thermal power: Q = ṁ × c × ΔT
                        const thermalPowerW = massFlow * specificHeatCapacity * spreizung; // W
					}
				}

                // Add thermal power tile if available
                if (thermalPowerW !== null) {
					tempsGroup4 += `
                        <div class="temp-item">
                            <span class="temp-label">Thermische Leistung<br>(berechnet)</span>
                            <div>
                                <span class="temp-value">${formatNum(thermalPowerW / 1000, 2)}</span>
                                <span class="temp-unit">kW</span>
                            </div>
                        </div>
                    `;

                    // Calculate and display COP
                    const cop = thermalPowerW / electricalPowerW;
                    tempsGroup4 += `
                        <div class="temp-item">
                            <span class="temp-label">moment. ArbeitsZahl<br>(berechnet)</span>
                            <div>
                                <span class="temp-value">${formatNum(cop, 2)}</span>
                                <span class="temp-unit"></span>
                            </div>
                        </div>
                    `;
                }
            }

            // Add visual diagram if compressor data available (heat pump) and enabled in settings
            let visualDiagram = '';
            if (hasCompressor && typeof renderRefrigerantCircuitVisual === 'function') {
                // Check if refrigerant visual is enabled (default: true)
                const showRefrigerantVisual = deviceSettings && deviceSettings.showRefrigerantVisual !== undefined
                    ? deviceSettings.showRefrigerantVisual
                    : true;

                if (showRefrigerantVisual) {
                    visualDiagram = renderRefrigerantCircuitVisual(kf);
                }
            }

            return `
                <div class="card wide">
                    <div class="card-header">
                        <h2>🔧 ${deviceTitle}</h2>
                        <div>
                            <span class="badge badge-info">Device ${deviceInfo.deviceId}</span>
                            ${settingsButton}
                            ${hybridProControlButton}
                        </div>
                    </div>
                    ${tempsGroup1 ? `
                        <div class="temp-group">
                            <h3 class="temp-group-title">Außentemperaturen & Systemkreise</h3>
                            <div class="temp-grid">${tempsGroup1}</div>
                        </div>
                    ` : ''}
                    ${tempsGroup2 ? `
                        <div class="temp-group">
                            <h3 class="temp-group-title">Heizkreis</h3>
                            <div class="temp-grid">${tempsGroup2}</div>
                        </div>
                    ` : ''}
                    ${tempsGroup3 ? `
                        <div class="temp-group">
                            <h3 class="temp-group-title">Speicher & Warmwasser</h3>
                            <div class="temp-grid">${tempsGroup3}</div>
                        </div>
                    ` : ''}
                    ${tempsGroup4 ? `
                        <div class="temp-group">
                            <h3 class="temp-group-title">Energiecockpit</h3>
                            <div class="temp-grid">${tempsGroup4}</div>
                        </div>
                    ` : ''}
                    ${visualDiagram ? `
                        <div class="temp-group">
                            <h3 class="temp-group-title">Kältekreislauf-Visualisierung</h3>
                            ${visualDiagram}
                        </div>
                    ` : ''}
                </div>
            `;
        }

        function renderMainTemperatures(kf) {
            // Temperatures are now integrated into renderDeviceHeader
            return '';
        }

        function renderCompressorBurnerStatus(kf, deviceInfo) {
            // Combined status card with all details
            const hasCompressor = kf.compressorSpeed || kf.compressorPower ||
                                  kf.compressorCurrent || kf.compressorPressure ||
                                  kf.compressorOilTemp || kf.compressorMotorTemp ||
                                  kf.compressorInletTemp || kf.compressorOutletTemp ||
                                  kf.compressorStats;
            const hasBurner = kf.burnerModulation;

            if (!hasCompressor && !hasBurner) return '';

            let content = '';
            let title = '';

            if (hasCompressor) {
                title = '⚙️ Verdichter';
                // Use compressorActive boolean if available, otherwise fall back to compressorSpeed
                const isRunning = kf.compressorActive ? kf.compressorActive.value : (kf.compressorSpeed && kf.compressorSpeed.value > 0);

                // Convert speed to RPM if unit is revolutionsPerSecond
                let speedValue = kf.compressorSpeed && kf.compressorSpeed.value !== undefined ? kf.compressorSpeed.value : 0;
                let speedUnit = kf.compressorSpeed && kf.compressorSpeed.value !== undefined ? kf.compressorSpeed.unit : '';

                if (speedUnit === 'revolutionsPerSecond') {
                    speedValue = speedValue * 60;
                    speedUnit = 'U/min';
                }

                // Extract compressor statistics (use compressorStats0 since it now holds the primary compressor data)
                let compressorHours = 0;
                let compressorStarts = 0;
                let avgRuntime = 0;

                // Try compressorStats0 first (new naming), then fall back to legacy compressorStats
                const statsObj = kf.compressorStats0 || kf.compressorStats;
                if (statsObj && statsObj.value) {
                    const stats = statsObj.value;
                    if (stats.hours && stats.hours.value !== undefined) {
                        compressorHours = stats.hours.value;
                    }
                    if (stats.starts && stats.starts.value !== undefined) {
                        compressorStarts = stats.starts.value;
                    }
                    if (compressorHours > 0 && compressorStarts > 0) {
                        avgRuntime = compressorHours / compressorStarts;
                    }
                }

                // Get device settings from cache for RPM percentage calculation
                const deviceInfo = window.currentDeviceInfo;
                let rpmPercentage = null;
                let cyclesPerDay = null;
                if (deviceInfo && window.deviceSettingsCache) {
                    const deviceKey = `${deviceInfo.installationId}_${deviceInfo.deviceId}`;
                    const settings = window.deviceSettingsCache[deviceKey];
                    if (settings && settings.max > settings.min && speedValue > 0) {
                        rpmPercentage = Math.round(((speedValue - settings.min) / (settings.max - settings.min)) * 100);
                        rpmPercentage = Math.max(0, Math.min(100, rpmPercentage));
                    }
                    // Calculate cycles per day (only if enabled in settings)
                    if (settings && settings.showCyclesPerDay && settings.cyclesperdaystart && compressorStarts > 0) {
                        const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds
                        const daysSinceStart = (now - settings.cyclesperdaystart) / (60 * 60 * 24);
                        if (daysSinceStart > 0) {
                            cyclesPerDay = compressorStarts / daysSinceStart;
                        }
                    }
                }


                //  Vitocal 200 A/S Thermische Leistung
                let compressorHeatingPower = kf.compressorHeatPower && kf.compressorHeatPower.value !== undefined ? kf.compressorHeatPower.value : -1;
                let compressorHeatingNow = kf.compressorHeatPercentPower && kf.compressorHeatPercentPower.value !== undefined ? kf.compressorHeatPercentPower.value : -1;
                if ((compressorHeatingPower != -1) && (compressorHeatingNow != -1)) {
                    compressorHeatingNow = compressorHeatingPower * (compressorHeatingNow / 100);
                }
				
                content = `
                    <div class="status-item">
                        <span class="status-label">Status</span>
                        <span class="status-value">${isRunning ? '🟢 An' : '⚪ Aus'}</span>
                    </div>
                    ${kf.compressorSpeed ? `
                        <div class="status-item">
                            <span class="status-label">Drehzahl</span>
                            <span class="status-value">
                                ${speedValue !== 0 ? formatNum(speedValue, 0) + ' ' + speedUnit : '--'}
                                ${rpmPercentage !== null ? `<span style="color: #10b981; margin-left: 8px;">(${rpmPercentage}%)</span>` : ''}
                            </span>
                        </div>
                    ` : ''}
                    ${kf.compressorPower ? `
                        <div class="status-item">
                            <span class="status-label">Leistung</span>
                            <span class="status-value">${(() => {
                                if (!isValidNumericValue(kf.compressorPower)) return '--';
                                if (!kf.compressorPower.value) return '--';
                                const powerW = unwrapValue(kf.compressorPower.value);
                                return formatNum(powerW, 0) + ' W';
                            })()}</span>
                        </div>
                    ` : ''}

					${kf.compressorHeatPower ? `
                        <div class="status-item">
                            <span class="status-label">therm. Leistung</span>
                            <span class="status-value">${(() => {
                                if (!isValidNumericValue(kf.compressorHeatPower)) return '--';
                                if (!kf.compressorHeatPower.value) return '--';
                                const powerW = unwrapValue(kf.compressorHeatPower.value);
                                return formatNum(powerW, 0) + ' kW';
                            })()}</span>
                        </div>
                    ` : ''}

                    ${kf.compressorHeatPercentPower ? `
                        <div class="status-item">
                            <span class="status-label">aktuelle th. Leistung</span>
                            <span class="status-value">${(() => {
                                if (compressorHeatingNow == -1) return '--';
                                return formatNum(compressorHeatingNow, 1) + ' kW';
                            })()}</span>
                        </div>
                    ` : ''}
					
					
					
					
					${kf.compressorCurrent ? `
                        <div class="status-item">
                            <span class="status-label">Stromaufnahme</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorCurrent) ? formatValue(kf.compressorCurrent) : '--'}</span>
                        </div>
                    ` : ''}



                    ${kf.compressorPressure ? `
                        <div class="status-item">
                            <span class="status-label">Einlassdruck</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorPressure) ? formatValue(kf.compressorPressure) : '--'}</span>
                        </div>
                    ` : ''}
                    ${kf.compressorOilTemp ? `
                        <div class="status-item">
                            <span class="status-label">Öltemperatur</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorOilTemp) ? formatValue(kf.compressorOilTemp) : '--'}</span>
                        </div>
                    ` : ''}
                    ${kf.compressorMotorTemp ? `
                        <div class="status-item">
                            <span class="status-label">Motorraumtemperatur</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorMotorTemp) ? formatValue(kf.compressorMotorTemp) : '--'}</span>
                        </div>
                    ` : ''}
                    ${kf.compressorInletTemp ? `
                        <div class="status-item">
                            <span class="status-label">Einlasstemperatur</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorInletTemp) ? formatValue(kf.compressorInletTemp) : '--'}</span>
                        </div>
                    ` : ''}
                    ${kf.compressorOutletTemp ? `
                        <div class="status-item">
                            <span class="status-label">Auslasstemperatur</span>
                            <span class="status-value">${isValidNumericValue(kf.compressorOutletTemp) ? formatValue(kf.compressorOutletTemp) : '--'}</span>
                        </div>
                    ` : ''}
                    ${compressorHours > 0 ? `
                        <div class="status-item">
                            <span class="status-label">Betriebsstunden Verdichter</span>
                            <span class="status-value">${formatNum(compressorHours, 0)} Std.</span>
                        </div>
                    ` : ''}
                    ${compressorStarts > 0 ? `
                        <div class="status-item">
                            <span class="status-label">Anzahl Verdichterstarts</span>
                            <span class="status-value">${compressorStarts}</span>
                        </div>
                    ` : ''}
                    ${avgRuntime > 0 ? `
                        <div class="status-item">
                            <span class="status-label">Durchschnittl. mittlere Laufzeit</span>
                            <span class="status-value">${formatNum(avgRuntime)} Std.</span>
                        </div>
                    ` : ''}
                    ${cyclesPerDay !== null ? `
                        <div class="status-item">
                            <span class="status-label">Durchschnittl. Takte</span>
                            <span class="status-value">${formatNum(cyclesPerDay, 1)} T/Tag</span>
                        </div>
                    ` : ''}
                    ${kf.fanRing ? `
                        <div class="status-item">
                            <span class="status-label">Ventilatorringheizung</span>
                            <span class="status-value">
                                <button id="fanRingToggle" class="toggle-btn ${kf.fanRing.value ? 'active' : ''}"
                                    data-current="${kf.fanRing.value ? 'true' : 'false'}">
                                    ${kf.fanRing.value ? '🟢 An' : '⚪ Aus'}
                                </button>
                            </span>
                        </div>
                    ` : ''}
                    ${kf.condensatePan ? `
                        <div class="status-item">
                            <span class="status-label">Wannenheizung</span>
                            <span class="status-value">
                                <button id="condensatePanToggle" class="toggle-btn ${kf.condensatePan.value ? 'active' : ''}"
                                    data-current="${kf.condensatePan.value ? 'true' : 'false'}">
                                    ${kf.condensatePan.value ? '🟢 An' : '⚪ Aus'}
                                </button>
                            </span>
                        </div>
                    ` : ''}
                `;
            } else if (hasBurner) {
                title = '🔥 Brenner';
                const modulation = kf.burnerModulation ? kf.burnerModulation.value : 0;
                const isRunning = modulation > 0;

                content = `
                    <div class="status-item">
                        <span class="status-label">Status</span>
                        <span class="status-value">${isRunning ? '🟢 An' : '⚪ Aus'}</span>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Modulation</span>
                        <span class="status-value">${formatValue(kf.burnerModulation)}</span>
                    </div>
                `;
            }

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>${title}</h2>
                    </div>
                    <div class="status-list">
                        ${content}
                    </div>
                </div>
            `;
        }

        // Render heating circuit card for a specific circuit
        function renderHeatingCircuitCard(features, circuitId, deviceInfo) {
            const circuitPrefix = `heating.circuits.${circuitId}`;
            console.log(`🔄 renderHeatingCircuitCard called for circuit ${circuitId} (prefix: ${circuitPrefix})`);

            // Extract circuit-specific features
            const find = (exactNames) => {
                if (!Array.isArray(exactNames)) exactNames = [exactNames];
                for (const exactName of exactNames) {
                    for (const category of [features.temperatures, features.circuits, features.operatingModes, features.dhw, features.other]) {
                        if (category && category[exactName]) {
                            const feature = category[exactName];
                            // Handle both simple values and Objects with properties/value
                            if (feature.type === 'object') {
                                // For objects, try to extract the actual value from properties or value
                                const container = feature.value || feature.properties;
                                if (container && typeof container === 'object') {
                                    // Look for a "value" property that has an actual numeric value
                                    if (container.value && container.value.value !== undefined) {
                                        return container.value; // Return the value object
                                    }
                                    // Or return the container itself if it has a direct value
                                    if (container.value !== undefined && typeof container.value === 'number') {
                                        return { value: container.value, type: feature.type, unit: feature.unit };
                                    }
                                }
                                // For object types without specific numeric values, return the whole feature
                                return feature;
                            }
                            // For non-object types, check if it has a value
                            if (feature.value !== null && feature.value !== undefined) {
                                return feature;
                            }
                        }
                    }
                }
                return null;
            };

            const findNested = (featureName, propertyName) => {
                for (const category of [features.circuits, features.operatingModes, features.temperatures, features.dhw, features.other]) {
                    if (category && category[featureName]) {
                        const feature = category[featureName];
                        if (feature.type === 'object') {
                            // Support both "value" and "properties" formats
                            const container = feature.value || feature.properties;
                            if (container && typeof container === 'object') {
                                const nestedValue = container[propertyName];
                                if (nestedValue && nestedValue.value !== undefined) {
                                    return {
                                        type: nestedValue.type || 'number',
                                        value: nestedValue.value,
                                        unit: nestedValue.unit || ''
                                    };
                                }
                            }
                        }
                    }
                }
                return null;
            };

            // Find feature in rawFeatures with isEnabled check
            const findRawFeature = (featureName) => {
                if (!features.rawFeatures) return null;
                const rawFeature = features.rawFeatures.find(f => f.feature === featureName);
                if (!rawFeature) return null;

                // Check if feature is enabled (from API response)
                // The raw feature has isEnabled at the top level
                const featureData = rawFeature.properties || rawFeature;
                if (rawFeature.isEnabled === false) return null;

                // Extract value from properties.value
                if (featureData.value && featureData.value.value !== undefined) {
                    return {
                        type: featureData.value.type || 'number',
                        value: featureData.value.value,
                        unit: featureData.value.unit || ''
                    };
                }
                return null;
            };

            const circuitName = find([`${circuitPrefix}.name`]);
            const operatingMode = find([`${circuitPrefix}.operating.modes.active`]);
            const operatingProgram = find([`${circuitPrefix}.operating.programs.active`]);
            const circuitTemp = find([`${circuitPrefix}.sensors.temperature.supply`]);
            const roomTemp = find([`${circuitPrefix}.sensors.temperature.room`]);
            const circuitPump = findNested(`${circuitPrefix}.circulation.pump`, 'status');
            const heatingCurveSlope = findNested(`${circuitPrefix}.heating.curve`, 'slope');
            const heatingCurveShift = findNested(`${circuitPrefix}.heating.curve`, 'shift');
            const supplyTempMax = findNested(`${circuitPrefix}.temperature.levels`, 'max');

            // Get burner demand temperature (only for circuit 0 = Heizkreis 1)
            // Only show if isEnabled is true
            const burnerDemandTemp = (circuitId === 0) ? findRawFeature('heating.burners.0.demand.temperature') : null;

            console.log(`  └─ Heating curve data - slope: ${heatingCurveSlope}, shift: ${heatingCurveShift}, supplyTempMax: ${supplyTempMax}`);

            // Get program temperatures (normal, comfort, reduced) - these are nested properties
            const normalTemp = findNested(`${circuitPrefix}.operating.programs.normal`, 'temperature');
            const normalHeatingTemp = findNested(`${circuitPrefix}.operating.programs.normalHeating`, 'temperature');
            const comfortTemp = findNested(`${circuitPrefix}.operating.programs.comfort`, 'temperature');
            const comfortHeatingTemp = findNested(`${circuitPrefix}.operating.programs.comfortHeating`, 'temperature');
            const reducedTemp = findNested(`${circuitPrefix}.operating.programs.reduced`, 'temperature');
            const reducedHeatingTemp = findNested(`${circuitPrefix}.operating.programs.reducedHeating`, 'temperature');

            // Check if circuit has any relevant data
            if (!operatingMode && !operatingProgram && !circuitTemp && !heatingCurveSlope && !supplyTempMax) {
                return '';
            }

            // Get circuit name (handle nested structure)
            // Display circuit number starting from 1 (circuitId 0 = Heizkreis 1)
            let displayName = `Heizkreis ${circuitId + 1}`;
            if (circuitName && circuitName.value) {
                let nameValue = circuitName.value;
                if (nameValue.name && typeof nameValue.name === 'object') {
                    if (nameValue.name.value) {
                        nameValue = nameValue.name.value;
                    }
                }
                if (typeof nameValue === 'string') {
                    displayName = nameValue;
                }
            }

            // Program name translations
            const programNames = {
                'normal': 'Normal',
                'normalHeating': 'Normal (Heizen)',
                'normalCooling': 'Normal (Kühlen)',
                'normalEnergySaving': 'Normal (Energiesparen)',
                'normalCoolingEnergySaving': 'Normal (Kühlen, Energiesparen)',
                'comfort': 'Komfort',
                'comfortHeating': 'Komfort (Heizen)',
                'comfortCooling': 'Komfort (Kühlen)',
                'comfortEnergySaving': 'Komfort (Energiesparen)',
                'comfortCoolingEnergySaving': 'Komfort (Kühlen, Energiesparen)',
                'reduced': 'Reduziert',
                'reducedHeating': 'Reduziert (Heizen)',
                'reducedCooling': 'Reduziert (Kühlen)',
                'reducedEnergySaving': 'Reduziert (Energiesparen)',
                'reducedCoolingEnergySaving': 'Reduziert (Kühlen, Energiesparen)',
                'eco': 'Eco',
                'fixed': 'Fest',
                'standby': 'Standby',
                'frostprotection': 'Frostschutz',
                'forcedLastFromSchedule': 'Zeitprogramm',
            };

            // Mode translations
            const modeNames = {
                'heating': 'Heizen',
                'standby': 'Standby',
                'cooling': 'Kühlen',
                'heatingCooling': 'Heizen/Kühlen',
                'dhw': 'Warmwasser',
                'dhwAndHeating': 'Warmwasser und Heizen',
                'forcedReduced': 'Reduziert (Erzwungen)',
                'forcedNormal': 'Normal (Erzwungen)',
            };

            const currentMode = operatingMode ? operatingMode.value : '';
            const currentProgram = operatingProgram ? operatingProgram.value : '';
            const programDisplay = programNames[currentProgram] || currentProgram;
            const modeDisplay = modeNames[currentMode] || currentMode;

            let html = `
                <div class="card wide">
                    <div class="card-header">
                        <h2>🏠 ${displayName}</h2>
                    </div>
                    <div class="status-list">
            `;

            // Operating mode with dropdown
            if (operatingMode) {
                // Dynamically detect available modes by checking which features exist
                const availableModes = ['heating', 'standby'];
                if (find([`${circuitPrefix}.operating.modes.dhwAndHeating`])) {
                    availableModes.push('dhwAndHeating');
                }
                if (find([`${circuitPrefix}.operating.modes.cooling`])) {
                    availableModes.push('cooling');
                }
                if (find([`${circuitPrefix}.operating.modes.heatingCooling`])) {
                    availableModes.push('heatingCooling');
                }

                html += `
                    <div class="status-item">
                        <span class="status-label">Betriebsart</span>
                        <span class="status-value">
                            <select onchange="changeHeatingMode(${circuitId}, this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                `;
                for (const mode of availableModes) {
                    const selected = mode === currentMode ? 'selected' : '';
                    html += `<option value="${mode}" ${selected}>${modeNames[mode] || mode}</option>`;
                }
                html += `
                            </select>
                        </span>
                    </div>
                `;
            }

            // Active program
            if (operatingProgram) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Aktives Programm</span>
                        <span class="status-value">${programDisplay}</span>
                    </div>
                `;
            }

            // Room temperature setpoints - simplified to 3 main programs
            // Priority: Use heating variant if both exist
            const reducedProg = reducedHeatingTemp || reducedTemp;
            const reducedApiName = reducedHeatingTemp ? 'reducedHeating' : 'reduced';
            const normalProg = normalHeatingTemp || normalTemp;
            const normalApiName = normalHeatingTemp ? 'normalHeating' : 'normal';
            const comfortProg = comfortHeatingTemp || comfortTemp;
            const comfortApiName = comfortHeatingTemp ? 'comfortHeating' : 'comfort';

            console.log(`Circuit ${circuitId} room temps:`, {
                reducedTemp: reducedTemp?.value,
                reducedHeatingTemp: reducedHeatingTemp?.value,
                normalTemp: normalTemp?.value,
                normalHeatingTemp: normalHeatingTemp?.value,
                comfortTemp: comfortTemp?.value,
                comfortHeatingTemp: comfortHeatingTemp?.value
            });

            if (reducedProg) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Raumtemperatur Reduziert</span>
                        <span class="status-value">
                            <select onchange="changeRoomTemp(${circuitId}, '${reducedApiName}', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                `;
                for (let temp = 3; temp <= 37; temp++) {
                    const selected = Math.round(reducedProg.value) === temp ? 'selected' : '';
                    html += `<option value="${temp}" ${selected}>${temp}°C</option>`;
                }
                html += `
                            </select>
                        </span>
                    </div>
                `;
            }

            if (normalProg) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Raumtemperatur Normal</span>
                        <span class="status-value">
                            <select onchange="changeRoomTemp(${circuitId}, '${normalApiName}', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                `;
                for (let temp = 3; temp <= 37; temp++) {
                    const selected = Math.round(normalProg.value) === temp ? 'selected' : '';
                    html += `<option value="${temp}" ${selected}>${temp}°C</option>`;
                }
                html += `
                            </select>
                        </span>
                    </div>
                `;
            }

            if (comfortProg) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Raumtemperatur Komfort</span>
                        <span class="status-value">
                            <select onchange="changeRoomTemp(${circuitId}, '${comfortApiName}', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                `;
                for (let temp = 3; temp <= 37; temp++) {
                    const selected = Math.round(comfortProg.value) === temp ? 'selected' : '';
                    html += `<option value="${temp}" ${selected}>${temp}°C</option>`;
                }
                html += `
                            </select>
                        </span>
                    </div>
                `;
            }

            // Circuit temperature
            if (circuitTemp) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Vorlauftemperatur</span>
                        <span class="status-value">${formatValue(circuitTemp)}</span>
                    </div>
                `;
            }

            // Burner demand temperature (Solltemperatur) - only for Vitocal circuit 0
            if (burnerDemandTemp) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Solltemperatur</span>
                        <span class="status-value">${formatValue(burnerDemandTemp)}</span>
                    </div>
                `;
            }

            // Room temperature sensor
            if (roomTemp) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Raumtemperatur (Ist)</span>
                        <span class="status-value">${formatValue(roomTemp)}</span>
                    </div>
                `;
            }

            // Circulation pump status (only show if feature has status property)
            if (circuitPump) {
                const pumpStatus = circuitPump.value;
                const statusDisplay = pumpStatus === 'on' ? '🔄 Ein' : (pumpStatus === 'off' ? '⚪ Aus' : pumpStatus);
                html += `
                    <div class="status-item">
                        <span class="status-label">Umwälzpumpe</span>
                        <span class="status-value">${statusDisplay}</span>
                    </div>
                `;
            }

            // Humidity dewpoint sensor (for cooling systems)
            const humidityDewpoint = find([`${circuitPrefix}.sensors.humidity.dewpoint`]);
            if (humidityDewpoint) {
                let statusText = '';
                let statusClass = '';

                // Check if it's a nested object with properties
                if (typeof humidityDewpoint.value === 'object' && humidityDewpoint.value !== null) {
                    const statusProp = humidityDewpoint.value.status;
                    const valueProp = humidityDewpoint.value.value;

                    if (statusProp && statusProp.value) {
                        statusText = statusProp.value === 'connected' ? 'Verbunden' : 'Nicht verbunden';
                        statusClass = statusProp.value === 'connected' ? 'sensor-connected' : 'sensor-disconnected';
                    }

                    if (valueProp && valueProp.value) {
                        const valueText = valueProp.value === 'on' ? 'EIN' : 'AUS';
                        statusText += ` (${valueText})`;
                        if (valueProp.value === 'on') {
                            statusClass = 'sensor-active';
                        }
                    }
                } else if (humidityDewpoint.value !== null && humidityDewpoint.value !== undefined) {
                    // Direct value (e.g., "on" or "off")
                    const valueText = humidityDewpoint.value === 'on' ? 'EIN' : 'AUS';
                    statusText = valueText;
                    statusClass = humidityDewpoint.value === 'on' ? 'sensor-active' : 'sensor-disconnected';
                }

                if (statusText) {
                    html += `
                        <div class="status-item">
                            <span class="status-label">Feuchteanbauschalter</span>
                            <span class="status-value ${statusClass}">${statusText}</span>
                        </div>
                    `;
                }
            }

            // Heating curve with editable dropdowns
            if (heatingCurveSlope) {
                // Generate slope options from 0.2 to 3.5 in 0.1 steps
                const slopeOptions = [];
                for (let i = 2; i <= 35; i++) {
                    const val = i / 10;
                    const selected = Math.abs(heatingCurveSlope.value - val) < 0.01 ? 'selected' : '';
                    slopeOptions.push(`<option value="${val}" ${selected}>${val}</option>`);
                }
                html += `
                    <div class="status-item">
                        <span class="status-label">Heizkurve Neigung</span>
                        <span class="status-value">
                            <select onchange="changeHeatingCurve(${circuitId}, 'slope', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                ${slopeOptions.join('')}
                            </select>
                        </span>
                    </div>
                `;
            }

            if (heatingCurveShift) {
                // Generate shift options from -13 to 40 in 1 step
                const shiftOptions = [];
                for (let i = -13; i <= 40; i++) {
                    const selected = heatingCurveShift.value === i ? 'selected' : '';
                    shiftOptions.push(`<option value="${i}" ${selected}>${i}</option>`);
                }
                html += `
                    <div class="status-item">
                        <span class="status-label">Heizkurve Niveau</span>
                        <span class="status-value">
                            <select onchange="changeHeatingCurve(${circuitId}, 'shift', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                ${shiftOptions.join('')}
                            </select>
                        </span>
                    </div>
                `;
            }

            // Supply temperature limit
            if (supplyTempMax) {
                html += `
                    <div class="status-item">
                        <span class="status-label">Vorlauftemperaturbegrenzung (max)</span>
                        <span class="status-value">
                            <select onchange="changeSupplyTempMax(${circuitId}, this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                `;
                for (let i = 10; i <= 90; i++) {
                    const selected = Math.round(supplyTempMax.value) === i ? 'selected' : '';
                    html += `<option value="${i}" ${selected}>${i}°C</option>`;
                }
                html += `
                            </select>
                        </span>
                    </div>
                `;
            }

            html += `
                    </div>
            `;

            // Add heating curve chart for circuits with heating curve data
            if (heatingCurveSlope || heatingCurveShift) {
                html += `
                    <div id="heatingCurveChart_${circuitId}" style="width: 100%; height: 400px; margin-top: 15px;"></div>
                `;
            }

            html += `
                </div>
            `;

            return html;
        }

        function renderHotWater(kf) {
            if (!kf.dhwTemp && !kf.dhwTarget && !kf.dhwStatus) return '';

            // Map API modes to user-friendly labels and vice versa
            const modeMapping = {
                'eco': 'Eco',
                'efficient': 'Eco',
                'efficientWithMinComfort': 'Komfort',
                'balanced': 'Balanced',
                'comfort': 'Komfort',
                'off': 'Aus'
            };

            // Get current mode and convert to display mode
            const currentApiMode = kf.dhwStatus ? kf.dhwStatus.value : '';
            const currentDisplayMode = modeMapping[currentApiMode] || currentApiMode;

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>💧 Warmwasser</h2>
                    </div>
                    <div class="status-list">
                        ${kf.dhwStatus ? `
            <div class="status-item">
                <span class="status-label">Betriebsart</span>
                <span class="status-value">
                    <select id="dhwModeSelect" onchange="changeDhwMode(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                        <option value="efficient" ${currentApiMode === 'efficient' ? 'selected' : ''}>Eco</option>
                        <option value="efficientWithMinComfort" ${currentApiMode === 'efficientWithMinComfort' ? 'selected' : ''}>Komfort</option>
                        <option value="balanced" ${currentApiMode === 'balanced' ? 'selected' : ''}>Balanced</option>
                        <option value="off" ${currentApiMode === 'off' ? 'selected' : ''}>Aus</option>
                    </select>
                </span>
            </div>
                        ` : ''}
                        ${kf.dhwTemp ? `
            <div class="status-item">
                <span class="status-label">Ist-Temperatur</span>
                <span class="status-value">${formatValue(kf.dhwTemp)}</span>
            </div>
                        ` : ''}
                        ${kf.dhwCylinderMiddleTemp ? `
            <div class="status-item">
                <span class="status-label">Mittlere Speichertemperatur</span>
                <span class="status-value">${formatValue(kf.dhwCylinderMiddleTemp)}</span>
            </div>
                        ` : ''}
                        ${kf.dhwTarget ? `
            <div class="status-item">
                <span class="status-label">Soll-Temperatur</span>
                <span class="status-value">
                    <select id="dhwTargetSelect" onchange="changeDhwTemperature(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                        ${Array.from({length: 51}, (_, i) => i + 10).map(temp => `
                            <option value="${temp}" ${Math.round(kf.dhwTarget.value) === temp ? 'selected' : ''}>${temp}°C</option>
                        `).join('')}
                    </select>
                </span>
            </div>
                        ` : ''}
                        ${kf.dhwTarget2 ? `
            <div class="status-item">
                <span class="status-label">Soll-Temperatur 2</span>
                <span class="status-value">
                    <select id="dhwTarget2Select" onchange="changeDhwTemperature2(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                        ${Array.from({length: 51}, (_, i) => i + 10).map(temp => `
                            <option value="${temp}" ${Math.round(kf.dhwTarget2.value) === temp ? 'selected' : ''}>${temp}°C</option>
                        `).join('')}
                    </select>
                </span>
            </div>
                        ` : ''}
                        ${kf.dhwHysteresisSwitchOn ? `
            <div class="status-item">
                <span class="status-label">Hysterese Ein</span>
                <span class="status-value">
                    <select id="dhwHysteresisOnSelect" onchange="changeDhwHysteresis('on', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                        ${Array.from({length: 19}, (_, i) => 1 + (i * 0.5)).map(val => `
                            <option value="${val}" ${kf.dhwHysteresisSwitchOn.value === val ? 'selected' : ''}>${val}K</option>
                        `).join('')}
                    </select>
                </span>
            </div>
                        ` : ''}
                        ${kf.dhwHysteresisSwitchOff ? `
            <div class="status-item">
                <span class="status-label">Hysterese Aus</span>
                <span class="status-value">
                    <select id="dhwHysteresisOffSelect" onchange="changeDhwHysteresis('off', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                        <option value="0" ${kf.dhwHysteresisSwitchOff.value === 0 ? 'selected' : ''}>0K</option>
                        <option value="0.5" ${kf.dhwHysteresisSwitchOff.value === 0.5 ? 'selected' : ''}>0.5K</option>
                        <option value="1" ${kf.dhwHysteresisSwitchOff.value === 1 ? 'selected' : ''}>1K</option>
                        <option value="1.5" ${kf.dhwHysteresisSwitchOff.value === 1.5 ? 'selected' : ''}>1.5K</option>
                        <option value="2" ${kf.dhwHysteresisSwitchOff.value === 2 ? 'selected' : ''}>2K</option>
                        <option value="2.5" ${kf.dhwHysteresisSwitchOff.value === 2.5 ? 'selected' : ''}>2.5K</option>
                    </select>
                </span>
            </div>
                        ` : ''}
                    </div>
                    <div style="margin-top: 15px; padding: 0 15px 15px 15px;">
                        <button onclick="startOneTimeCharge()" style="width: 100%; padding: 10px; background: rgba(59, 130, 246, 0.8); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 14px;">
                            🔥 Einmalige Warmwassererwärmung starten
                        </button>
                    </div>
                </div>
            `;
        }

        function renderHeatingCurve(kf) {
            console.log('🔍 renderHeatingCurve called');
            console.log('heatingCurveSlope:', kf.heatingCurveSlope);
            console.log('heatingCurveShift:', kf.heatingCurveShift);

            if (!kf.heatingCurveSlope && !kf.heatingCurveShift) {
                console.warn('⚠️ No heating curve data available');
                return '';
            }

            const slope = kf.heatingCurveSlope ? kf.heatingCurveSlope.value : 1.0;
            const shift = kf.heatingCurveShift ? kf.heatingCurveShift.value : 0;

            console.log('✅ Heating curve values - slope:', slope, 'shift:', shift);
            const currentOutsideTemp = kf.outsideTemp ? kf.outsideTemp.value : null;
            const currentSupplyTemp = kf.supplyTemp ? kf.supplyTemp.value : null;
            const maxSupplyTemp = kf.supplyTempMax ? kf.supplyTempMax.value : null;
            const minSupplyTemp = kf.supplyTempMin ? kf.supplyTempMin.value : null;

            let settings = '';
            if (kf.heatingCurveSlope) {
                // Generate slope options from 0.2 to 3.5 in 0.1 steps
                const slopeOptions = [];
                for (let i = 2; i <= 35; i++) {
                    const val = i / 10;
                    slopeOptions.push(`<option value="${val}" ${Math.abs(kf.heatingCurveSlope.value - val) < 0.01 ? 'selected' : ''}>${val}</option>`);
                }
                settings += `
                    <div class="status-item">
                        <span class="status-label">Neigung</span>
                        <span class="status-value">
                            <select id="heatingCurveSlopeSelect" onchange="changeHeatingCurve('slope', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                ${slopeOptions.join('')}
                            </select>
                        </span>
                    </div>
                `;
            }
            if (kf.heatingCurveShift) {
                // Generate shift options from -13 to 40 in 1 step
                const shiftOptions = [];
                for (let i = -13; i <= 40; i++) {
                    shiftOptions.push(`<option value="${i}" ${kf.heatingCurveShift.value === i ? 'selected' : ''}>${i}</option>`);
                }
                settings += `
                    <div class="status-item">
                        <span class="status-label">Niveau (Verschiebung)</span>
                        <span class="status-value">
                            <select id="heatingCurveShiftSelect" onchange="changeHeatingCurve('shift', this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                ${shiftOptions.join('')}
                            </select>
                        </span>
                    </div>
                `;
            }
            if (kf.supplyTempMax) {
                // Generate max temp options from 10 to 70 in 1°C steps
                const maxTempOptions = [];
                for (let i = 10; i <= 70; i++) {
                    maxTempOptions.push(`<option value="${i}" ${Math.round(kf.supplyTempMax.value) === i ? 'selected' : ''}>${i}°C</option>`);
                }
                settings += `
                    <div class="status-item">
                        <span class="status-label">Vorlauftemperaturbegrenzung (max)</span>
                        <span class="status-value">
                            <select id="supplyTempMaxSelect" onchange="changeSupplyTempMax(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                ${maxTempOptions.join('')}
                            </select>
                        </span>
                    </div>
                `;
            }
            if (kf.supplyTempMin) {
                settings += `
                    <div class="status-item">
                        <span class="status-label">Vorlauftemperatur (min)</span>
                        <span class="status-value">${formatValue(kf.supplyTempMin)}</span>
                    </div>
                `;
            }

            return `
                <div class="card wide">
                    <div class="card-header">
                        <h2>📐 Heizkurve</h2>
                    </div>
                    <div class="status-list" style="margin-bottom: 15px;">
                        ${settings}
                    </div>
                    <div id="heatingCurveChart" style="width: 100%; height: 400px;"></div>
                </div>
            `;
        }

        function renderHeatingCurveChart(circuitId) {
            console.log('📈 Starting to render heating curve chart for circuit', circuitId);

            // Helper function to unwrap nested value objects
            const unwrapValue = (val) => {
                while (val && typeof val === 'object' && val.value !== undefined) {
                    val = val.value;
                }
                return val;
            };

            const chartId = 'heatingCurveChart_' + circuitId;
            const chartElement = document.getElementById(chartId);

            if (!chartElement) {
                console.error('❌ Chart element not found:', chartId);
                return;
            }

            // Check if D3 is loaded
            if (typeof d3 === 'undefined') {
                console.error('❌ D3.js is not loaded');
                chartElement.innerHTML = '<div style="color: #ef4444; padding: 20px; text-align: center;">D3.js konnte nicht geladen werden.</div>';
                return;
            }
            console.log('✅ D3.js is loaded, version:', d3.version);

            const data = window.heatingCurveData && window.heatingCurveData[circuitId];
            if (!data) {
                console.error('❌ No heating curve data available for circuit', circuitId);
                return;
            }

            let {slope, shift, currentOutside, currentSupply, maxSupply, minSupply, roomTempSetpoint} = data;

            // Ensure numeric values (unwrap if still objects)
            if (typeof currentSupply === 'object' && currentSupply !== null) {
                console.warn('⚠️ currentSupply is an object, attempting to unwrap:', currentSupply);
                currentSupply = unwrapValue(currentSupply);
            }
            if (typeof currentOutside === 'object' && currentOutside !== null) {
                console.warn('⚠️ currentOutside is an object, attempting to unwrap:', currentOutside);
                currentOutside = unwrapValue(currentOutside);
            }

            console.log('Chart parameters:', {slope, shift, currentOutside, currentSupply, maxSupply, minSupply, roomTempSetpoint});

            // Clear any existing content
            chartElement.innerHTML = '';

            // Calculate heating curve using official Viessmann formula:
            // VT = RTSoll + Niveau - Neigung * DAR * (1.4347 + 0.021 * DAR + 247.9 * 10^-6 * DAR^2)
            // with DAR = AT - RTSoll
            function calculateSupplyTemp(outsideTemp) {
                const RTSoll = roomTempSetpoint || 20;  // Use room temp from active program, fallback to 20
                const DAR = outsideTemp - RTSoll;
                let VT = RTSoll + shift - slope * DAR * (1.4347 + 0.021 * DAR + 247.9 * 1e-6 * DAR * DAR);

                // Cap at max supply temperature (Viessmann behavior)
                if (maxSupply !== null && VT > maxSupply) {
                    VT = maxSupply;
                }

                // Floor at min supply temperature (Viessmann behavior)
                if (minSupply !== null && VT < minSupply) {
                    VT = minSupply;
                }

                return VT;
            }

            // Setup dimensions
            const margin = {top: 20, right: 30, bottom: 50, left: 60};
            const width = chartElement.clientWidth - margin.left - margin.right;
            const height = 400 - margin.top - margin.bottom;

            console.log(`📏 Chart dimensions for circuit ${circuitId}: clientWidth=${chartElement.clientWidth}, width=${width}, height=${height}`);

            // Create SVG
            const svg = d3.select('#' + chartId)
                .append('svg')
                .attr('width', width + margin.left + margin.right)
                .attr('height', height + margin.top + margin.bottom)
                .append('g')
                .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            // Scales (X-axis reversed: 20°C left, -30°C right)
            const xScale = d3.scaleLinear()
                .domain([20, -30])
                .range([0, width]);

            // Dynamic Y-axis based on min/max supply temperature
            // Add 5°C padding for better visibility
            const yMin = minSupply !== null ? Math.max(0, minSupply - 5) : 20;
            const yMax = maxSupply !== null ? maxSupply + 5 : 70;

            const yScale = d3.scaleLinear()
                .domain([yMin, yMax])
                .range([height, 0]);

            // Grid lines
            svg.append('g')
                .attr('class', 'grid')
                .attr('opacity', 0.1)
                .call(d3.axisLeft(yScale)
                    .tickSize(-width)
                    .tickFormat(''));

            svg.append('g')
                .attr('class', 'grid')
                .attr('opacity', 0.1)
                .attr('transform', 'translate(0,' + height + ')')
                .call(d3.axisBottom(xScale)
                    .tickSize(-height)
                    .tickFormat(''));

            // Generate curve data
            const curveData = [];
            for (let temp = -30; temp <= 20; temp += 0.5) {
                curveData.push({
                    outside: temp,
                    supply: calculateSupplyTemp(temp)
                });
            }

            // Line generator
            const line = d3.line()
                .x(d => xScale(d.outside))
                .y(d => yScale(d.supply))
                .curve(d3.curveMonotoneX);

            // Draw the curve
            svg.append('path')
                .datum(curveData)
                .attr('fill', 'none')
                .attr('stroke', '#667eea')
                .attr('stroke-width', 3)
                .attr('d', line);

            // Draw max supply temp reference line
            if (maxSupply !== null) {
                svg.append('line')
                    .attr('x1', 0)
                    .attr('x2', width)
                    .attr('y1', yScale(maxSupply))
                    .attr('y2', yScale(maxSupply))
                    .attr('stroke', '#ef4444')
                    .attr('stroke-width', 2)
                    .attr('stroke-dasharray', '5,5')
                    .attr('opacity', 0.7);

                svg.append('text')
                    .attr('x', width - 5)
                    .attr('y', yScale(maxSupply) - 5)
                    .attr('text-anchor', 'end')
                    .attr('fill', '#ef4444')
                    .attr('font-size', '11px')
                    .attr('font-weight', 'bold')
                    .text('Max: ' + maxSupply + '°C');
            }

            // Draw min supply temp reference line
            if (minSupply !== null) {
                svg.append('line')
                    .attr('x1', 0)
                    .attr('x2', width)
                    .attr('y1', yScale(minSupply))
                    .attr('y2', yScale(minSupply))
                    .attr('stroke', '#3b82f6')
                    .attr('stroke-width', 2)
                    .attr('stroke-dasharray', '5,5')
                    .attr('opacity', 0.7);

                svg.append('text')
                    .attr('x', width - 5)
                    .attr('y', yScale(minSupply) + 15)
                    .attr('text-anchor', 'end')
                    .attr('fill', '#3b82f6')
                    .attr('font-size', '11px')
                    .attr('font-weight', 'bold')
                    .text('Min: ' + minSupply + '°C');
            }

            // Draw current point if available
            if (currentOutside !== null && currentSupply !== null) {
                svg.append('circle')
                    .attr('cx', xScale(currentOutside))
                    .attr('cy', yScale(currentSupply))
                    .attr('r', 6)
                    .attr('fill', '#f59e0b')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2);

                svg.append('text')
                    .attr('x', xScale(currentOutside) + 10)
                    .attr('y', yScale(currentSupply) - 10)
                    .attr('fill', '#f59e0b')
                    .attr('font-size', '12px')
                    .attr('font-weight', 'bold')
                    .text('Aktuell: ' + currentOutside.toFixed(1) + '°C / ' + currentSupply.toFixed(1) + '°C');
            }

            // X-Axis
            svg.append('g')
                .attr('transform', 'translate(0,' + height + ')')
                .call(d3.axisBottom(xScale).ticks(10))
                .attr('color', '#a0a0b0');

            svg.append('text')
                .attr('x', width / 2)
                .attr('y', height + 40)
                .attr('text-anchor', 'middle')
                .attr('fill', '#e0e0e0')
                .attr('font-size', '14px')
                .text('Außentemperatur (°C)');

            // Y-Axis
            svg.append('g')
                .call(d3.axisLeft(yScale).ticks(10))
                .attr('color', '#a0a0b0');

            svg.append('text')
                .attr('transform', 'rotate(-90)')
                .attr('x', -height / 2)
                .attr('y', -45)
                .attr('text-anchor', 'middle')
                .attr('fill', '#e0e0e0')
                .attr('font-size', '14px')
                .text('Vorlauftemperatur (°C)');

            // Formula text - Viessmann official formula (simplified display)
            const RTSoll = roomTempSetpoint || 20;
            const shiftText = shift >= 0 ? '+ ' + shift : '- ' + Math.abs(shift);
            svg.append('text')
                .attr('x', 10)
                .attr('y', 15)
                .attr('fill', '#667eea')
                .attr('font-size', '11px')
                .attr('font-family', 'monospace')
                .text('VL = ' + RTSoll + ' ' + shiftText + ' - ' + slope.toFixed(1) + ' × DAR × (1.4347 + 0.021×DAR + 247.9×10⁻⁶×DAR²)   mit DAR = AT - ' + RTSoll);

            // Add hover functionality
            // Create tooltip
            const tooltip = d3.select('body')
                .append('div')
                .style('position', 'absolute')
                .style('background', 'rgba(0, 0, 0, 0.8)')
                .style('color', '#fff')
                .style('padding', '8px 12px')
                .style('border-radius', '4px')
                .style('font-size', '12px')
                .style('pointer-events', 'none')
                .style('opacity', 0)
                .style('z-index', 1000);

            // Create hover line and circle
            const hoverLine = svg.append('line')
                .attr('stroke', '#667eea')
                .attr('stroke-width', 1)
                .attr('stroke-dasharray', '3,3')
                .style('opacity', 0);

            const hoverCircle = svg.append('circle')
                .attr('r', 5)
                .attr('fill', '#667eea')
                .attr('stroke', '#fff')
                .attr('stroke-width', 2)
                .style('opacity', 0);

            // Invisible overlay to capture mouse events
            svg.append('rect')
                .attr('width', width)
                .attr('height', height)
                .style('fill', 'none')
                .style('pointer-events', 'all')
                .on('mousemove', function(event) {
                    const [mouseX] = d3.pointer(event);
                    const outsideTemp = xScale.invert(mouseX);
                    const supplyTemp = calculateSupplyTemp(outsideTemp);

                    // Update hover elements
                    hoverLine
                        .attr('x1', mouseX)
                        .attr('x2', mouseX)
                        .attr('y1', 0)
                        .attr('y2', height)
                        .style('opacity', 1);

                    hoverCircle
                        .attr('cx', xScale(outsideTemp))
                        .attr('cy', yScale(supplyTemp))
                        .style('opacity', 1);

                    // Update tooltip
                    tooltip
                        .style('opacity', 1)
                        .html(`
                            <strong>Außentemperatur:</strong> ${outsideTemp.toFixed(1)}°C<br>
                            <strong>Vorlauftemperatur:</strong> ${supplyTemp.toFixed(1)}°C
                        `)
                        .style('left', (event.pageX + 15) + 'px')
                        .style('top', (event.pageY - 15) + 'px');
                })
                .on('mouseout', function() {
                    hoverLine.style('opacity', 0);
                    hoverCircle.style('opacity', 0);
                    tooltip.style('opacity', 0);
                });

            console.log('✅ Heating curve chart rendered successfully');
        }

        function renderConsumption(kf) {
            let consumption = '';

            // Power consumption
            if (kf.powerConsumptionToday) {
                consumption += `
                    <div class="status-item">
                        <span class="status-label">Stromverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.powerConsumptionToday)}</span>
                    </div>
                `;
            }
            if (kf.powerConsumptionHeatingToday) {
                consumption += `
                    <div class="status-item">
                        <span class="status-label">Heizung-Stromverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.powerConsumptionHeatingToday)}</span>
                    </div>
                `;
            }
            if (kf.powerConsumptionDhwToday) {
                consumption += `
                    <div class="status-item">
                        <span class="status-label">WW-Stromverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.powerConsumptionDhwToday)}</span>
                    </div>
                `;
            }

/* RS use other element
            // Gas consumption - new format with day array
            if (kf.gasConsumption?.properties?.day?.["0"]?.value !== undefined) {
                const gasconsumptiontoday = kf.gasConsumption.properties.day["0"].value;
                const gasconsumptionyesterday = kf.gasConsumption.properties.day["1"]?.value;

                consumption += `
                    <div class="status-item">
                        <span class="status-label">Gasverbrauch heute</span>
                        <span class="status-value">${formatValue(gasconsumptiontoday)}</span>
                    </div>
                `;

                if (gasconsumptionyesterday !== undefined) {
                    consumption += `
                        <div class="status-item">
                            <span class="status-label">Gasverbrauch gestern</span>
                            <span class="status-value">${formatValue(gasconsumptionyesterday)}</span>
                        </div>
                    `;
                }
            } else if (kf.gasConsumptionToday) {
                // Fallback to old format
                consumption += `
                    <div class="status-item">
                        <span class="status-label">Gasverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.gasConsumptionToday)}</span>
                    </div>
                `;
            }
            if (kf.gasConsumptionHeatingToday) {
                consumption += `
                    <div class="status-item">
                        <span class="status-label">Heizung-Gasverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.gasConsumptionHeatingToday)}</span>
                    </div>
                `;
            }
            if (kf.gasConsumptionDhwToday) {
                consumption += `
                    <div class="status-item">
                        <span class="status-label">WW-Gasverbrauch heute</span>
                        <span class="status-value">${formatValue(kf.gasConsumptionDhwToday)}</span>
                    </div>
                `;
            }
*/  

            if (!consumption) return '';

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>📊 Verbrauch heute</h2>
                    </div>
                    <div class="status-list">
                        ${consumption}
                    </div>
                </div>
            `;
        }

        function renderConsumptionStatistics(kf) {
            // Check for array-based features (with includeDeviceFeatures=true)
//RS
            const hasArrayFeatures = kf.powerConsumptionDhw || kf.powerConsumptionHeating ||
                                     kf.heatProductionDhw || kf.heatProductionHeating || kf.gasConsumptionHeating;

            // Fallback to summary features
            const hasSummaryFeatures = kf.powerConsumptionSummaryDhw || kf.powerConsumptionSummaryHeating;

            if (!hasArrayFeatures && !hasSummaryFeatures) return '';

            // Use array features if available (gives us historical data)
            if (hasArrayFeatures) {
                console.log('📊 Using array-based consumption statistics');
                return renderConsumptionStatisticsArrays(kf);
            } else {
                console.log('📊 Using summary-based consumption statistics (fallback)');
                return renderConsumptionStatisticsSummary(kf);
            }
        }

        // NEW: Render statistics using array-based features - split into two cards
        function renderConsumptionStatisticsArrays(kf) {
            // Helper to get array value safely
            const getArrayValue = (feature, period, index = 0) => {
                if (!feature || !feature.properties || !feature.properties[period]) return null;
                const arr = feature.properties[period].value;
                if (!Array.isArray(arr) || index >= arr.length) return null;
                return arr[index];
            };

            // Helper to get summary value
            const getSummaryValue = (feature, period) => {
                if (!feature || !feature.properties || !feature.properties[period]) return null;
                const prop = feature.properties[period];
                if (prop && prop.value !== undefined) {
                    return prop.value;
                }
                return null;
            };

            // Check what data is available
//RS
            const hasGasConsumptionArrays = kf.gasConsumptionHeating || kf.gasConsumptionDhw;
            const hasPowerConsumptionArrays = kf.powerConsumptionDhw || kf.powerConsumptionHeating;
            const hasHeatProductionArrays = kf.heatProductionDhw && kf.heatProductionHeating;
            const hasHeatProductionSummary = kf.heatProductionSummaryDhw || kf.heatProductionSummaryHeating;
            const hasCompressorEnergyData = kf.compressorPowerConsumptionDhw || kf.compressorPowerConsumptionHeating ||
                                            kf.compressorHeatProductionDhw || kf.compressorHeatProductionHeating ||
                                            kf.compressorHeatProductionCooling;

            console.log('Power consumption arrays:', hasPowerConsumptionArrays);
            console.log('Heat production arrays:', hasHeatProductionArrays);
            console.log('Heat production summary:', hasHeatProductionSummary);
            console.log('Compressor energy data:', hasCompressorEnergyData);

            let html = '';

            // Card 1: Power Consumption (always with arrays if available)
            if (hasPowerConsumptionArrays) {
                html += renderPowerConsumptionCard(kf, getArrayValue);
            }

            // Card 2: Heat Production (arrays if available, otherwise summary)
            if (hasHeatProductionArrays) {
                html += renderHeatProductionArrayCard(kf, getArrayValue);
            } else if (hasHeatProductionSummary) {
                html += renderHeatProductionSummaryCard(kf, getSummaryValue);
            }

            // Card 3: Compressor-specific energy consumption and production (Vitocal)
            if (hasCompressorEnergyData) {
                html += renderCompressorEnergyCard(kf, getArrayValue);
            }
//RS			
            // Card 3: Gas Consumption (always with arrays if available) (Vitodens)			
            if (hasGasConsumptionArrays) {
                html += renderGasConsumptionCard(kf, getArrayValue);
            }

            return html;
        }

        // Render Power Consumption Card with full array history
        // Power Consumption Card (Stromverbrauch) - separate Kachel
        function renderPowerConsumptionCard(kf, getArrayValue) {
            const getMonthName = (index) => {
                const now = new Date();
                const d = new Date(now.getFullYear(), now.getMonth() - index, 1);
                return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
            };
        
            const getWeekLabel = (index) => {
                const now = new Date();
                const d = new Date(now.getTime() - (index * 7 * 24 * 60 * 60 * 1000));
                const onejan = new Date(d.getFullYear(), 0, 1);
                const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
                return `KW ${week}`;
            };
        
            const getDayLabel = (index) => {
                const now = new Date();
                const d = new Date(now.getTime() - (index * 24 * 60 * 60 * 1000));
                return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
            };
        
            let mainTabsHtml = `
                <button class="stat-tab active" onclick="switchStatPeriod(event, 'power-period-day')">Tag</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'power-period-week')">Woche</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'power-period-month')">Monat</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'power-period-year')">Jahr</button>
            `;
        
            // Build days
            const dayArray = kf.powerConsumptionDhw?.properties?.day?.value || kf.powerConsumptionHeating?.properties?.day?.value || [];
            const maxDays = Math.min(dayArray.length, 8);
            let dayTabsHtml = '', dayContentHtml = '';

            let firstday = 0;
            const dayValueReadAt = kf.powerConsumptionHeating?.properties?.dayValueReadAt?.value || 0;
            if(dayValueReadAt != 0){
                const anyTime = new Date(dayValueReadAt).getTime();
                const currentTime = new Date().getTime();
                if( (currentTime - anyTime) > 4*3600*1000 ){  // more than 4 hours old
                    firstday = 1;                       // don't show day '0'
                }
            }
            for (let i = firstday; i < maxDays; i++) {
                const powerDhw = getArrayValue(kf.powerConsumptionDhw, 'day', i);
                const powerHeating = getArrayValue(kf.powerConsumptionHeating, 'day', i);
                if (powerDhw === null && powerHeating === null) continue;

                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                dayTabsHtml += `<button class="stat-tab ${i === firstday ? 'active' : ''}" onclick="switchStatTab(event, 'power-day-${i}')">${getDayLabel(i)}</button>`;
                dayContentHtml += `
                    <div id="power-day-${i}" class="stat-tab-content" style="${i === firstday ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${powerDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(powerDhw)} kWh</span></div>` : ''}
                            ${powerHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(powerHeating)} kWh</span></div>` : ''}
                            ${totalPower > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalPower)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }
        
            // Build weeks
            const weekArray = kf.powerConsumptionDhw?.properties?.week?.value || kf.powerConsumptionHeating?.properties?.week?.value || [];
            const maxWeeks = Math.min(weekArray.length, 6);
            let weekTabsHtml = '', weekContentHtml = '';
        
            for (let i = 0; i < maxWeeks; i++) {
                const powerDhw = getArrayValue(kf.powerConsumptionDhw, 'week', i);
                const powerHeating = getArrayValue(kf.powerConsumptionHeating, 'week', i);
                if (powerDhw === null && powerHeating === null) continue;
        
                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                weekTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'power-week-${i}')">${getWeekLabel(i)}</button>`;
                weekContentHtml += `
                    <div id="power-week-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${powerDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(powerDhw)} kWh</span></div>` : ''}
                            ${powerHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(powerHeating)} kWh</span></div>` : ''}
                            ${totalPower > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalPower)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }
        
            // Build months
            const monthArray = kf.powerConsumptionDhw?.properties?.month?.value || kf.powerConsumptionHeating?.properties?.month?.value || [];
            const maxMonths = Math.min(monthArray.length, 13);
            let monthTabsHtml = '', monthContentHtml = '';
        
            for (let i = 0; i < maxMonths; i++) {
                const powerDhw = getArrayValue(kf.powerConsumptionDhw, 'month', i);
                const powerHeating = getArrayValue(kf.powerConsumptionHeating, 'month', i);
                if (powerDhw === null && powerHeating === null) continue;
        
                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                monthTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'power-month-${i}')">${getMonthName(i)}</button>`;
                monthContentHtml += `
                    <div id="power-month-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${powerDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(powerDhw)} kWh</span></div>` : ''}
                            ${powerHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(powerHeating)} kWh</span></div>` : ''}
                            ${totalPower > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalPower)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }
        
            // Build years
            const yearArray = kf.powerConsumptionDhw?.properties?.year?.value || kf.powerConsumptionHeating?.properties?.year?.value || [];
            const maxYears = Math.min(yearArray.length, 2);
            let yearTabsHtml = '', yearContentHtml = '';
        
            for (let i = 0; i < maxYears; i++) {
                const powerDhw = getArrayValue(kf.powerConsumptionDhw, 'year', i);
                const powerHeating = getArrayValue(kf.powerConsumptionHeating, 'year', i);
                if (powerDhw === null && powerHeating === null) continue;
        
                const now = new Date();
                const yearLabel = now.getFullYear() - i;
                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                yearTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'power-year-${i}')">${yearLabel}</button>`;
                yearContentHtml += `
                    <div id="power-year-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${powerDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(powerDhw)} kWh</span></div>` : ''}
                            ${powerHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(powerHeating)} kWh</span></div>` : ''}
                            ${totalPower > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalPower)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }
        
            if (!dayTabsHtml && !weekTabsHtml && !monthTabsHtml && !yearTabsHtml) return '';
        
            return `
                <div class="card">
                    <div class="card-header"><h2>⚡ Stromverbrauch</h2></div>
                    <div class="stat-tabs stat-tabs-main">${mainTabsHtml}</div>
                    <div id="power-period-day" class="stat-period-content" style="display: block;">
                        <div class="stat-tabs stat-tabs-scrollable">${dayTabsHtml}</div>
                        <div class="stat-content">${dayContentHtml}</div>
                    </div>
                    <div id="power-period-week" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${weekTabsHtml}</div>
                        <div class="stat-content">${weekContentHtml}</div>
                    </div>
                    <div id="power-period-month" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${monthTabsHtml}</div>
                        <div class="stat-content">${monthContentHtml}</div>
                    </div>
                    <div id="power-period-year" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${yearTabsHtml}</div>
                        <div class="stat-content">${yearContentHtml}</div>
                    </div>
                </div>
            `;
        }
        // Render Gas Consumption Card with full array history
        // Gas Consumption Card (Gasverbrauch) - separate Kachel
        function renderGasConsumptionCard(kf, getArrayValue) {
            // Maximum age for day-0 data before it's considered stale (4 hours in milliseconds)
            const MAX_DAY_AGE_MS = 4 * 3600 * 1000;

            const getMonthName = (index) => {
                const now = new Date();
                const d = new Date(now.getFullYear(), now.getMonth() - index, 1);
                return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
            };

            const getWeekLabel = (index) => {
                const now = new Date();
                const d = new Date(now.getTime() - (index * 7 * 24 * 60 * 60 * 1000));
                const onejan = new Date(d.getFullYear(), 0, 1);
                const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
                return `KW ${week}`;
            };

            const getDayLabel = (index) => {
                const now = new Date();
                const d = new Date(now.getTime() - (index * 24 * 60 * 60 * 1000));
                return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
            };

            let mainTabsHtml = `
                <button class="stat-tab active" onclick="switchStatPeriod(event, 'gas-period-day')">Tag</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'gas-period-week')">Woche</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'gas-period-month')">Monat</button>
                <button class="stat-tab" onclick="switchStatPeriod(event, 'gas-period-year')">Jahr</button>
            `;

            // Build days
            const dayArray = kf.gasConsumptionDhw?.properties?.day?.value || kf.gasConsumptionHeating?.properties?.day?.value || [];
            const maxDays = Math.min(dayArray.length, 8);
            let dayTabsHtml = '', dayContentHtml = '';

            let firstday = 0;
            const dayValueReadAt = kf.gasConsumptionDhw?.properties?.dayValueReadAt?.value ||
                                   kf.gasConsumptionHeating?.properties?.dayValueReadAt?.value || 0;
            if(dayValueReadAt != 0){
                const anyTime = new Date(dayValueReadAt).getTime();
                const currentTime = new Date().getTime();
                if( (currentTime - anyTime) > MAX_DAY_AGE_MS ){
                    firstday = 1;                       // don't show day '0'
                }
            }
            for (let i = firstday; i < maxDays; i++) {
                const gasDhw = getArrayValue(kf.gasConsumptionDhw, 'day', i);
                const gasHeating = getArrayValue(kf.gasConsumptionHeating, 'day', i);
                if (gasDhw === null && gasHeating === null) continue;

                const totalGas = (gasDhw || 0) + (gasHeating || 0);
                dayTabsHtml += `<button class="stat-tab ${i === firstday ? 'active' : ''}" onclick="switchStatTab(event, 'gas-day-${i}')">${getDayLabel(i)}</button>`;
                dayContentHtml += `
                    <div id="gas-day-${i}" class="stat-tab-content" style="${i === firstday ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${gasDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(gasDhw)} m³</span></div>` : ''}
                            ${gasHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(gasHeating)} m³</span></div>` : ''}
                            ${totalGas > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalGas)} m³</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            // Build weeks
            const weekArray = kf.gasConsumptionDhw?.properties?.week?.value || kf.gasConsumptionHeating?.properties?.week?.value || [];
            const maxWeeks = Math.min(weekArray.length, 6);
            let weekTabsHtml = '', weekContentHtml = '';

            for (let i = 0; i < maxWeeks; i++) {
                const gasDhw = getArrayValue(kf.gasConsumptionDhw, 'week', i);
                const gasHeating = getArrayValue(kf.gasConsumptionHeating, 'week', i);
                if (gasDhw === null && gasHeating === null) continue;

                const totalGas = (gasDhw || 0) + (gasHeating || 0);
                weekTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'gas-week-${i}')">${getWeekLabel(i)}</button>`;
                weekContentHtml += `
                    <div id="gas-week-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${gasDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(gasDhw)} m³</span></div>` : ''}
                            ${gasHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(gasHeating)} m³</span></div>` : ''}
                            ${totalGas > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalGas)} m³</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            // Build months
            const monthArray = kf.gasConsumptionDhw?.properties?.month?.value || kf.gasConsumptionHeating?.properties?.month?.value || [];
            const maxMonths = Math.min(monthArray.length, 13);
            let monthTabsHtml = '', monthContentHtml = '';

            for (let i = 0; i < maxMonths; i++) {
                const gasDhw = getArrayValue(kf.gasConsumptionDhw, 'month', i);
                const gasHeating = getArrayValue(kf.gasConsumptionHeating, 'month', i);
                if (gasDhw === null && gasHeating === null) continue;

                const totalGas = (gasDhw || 0) + (gasHeating || 0);
                monthTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'gas-month-${i}')">${getMonthName(i)}</button>`;
                monthContentHtml += `
                    <div id="gas-month-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${gasDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(gasDhw)} m³</span></div>` : ''}
                            ${gasHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(gasHeating)} m³</span></div>` : ''}
                            ${totalGas > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalGas)} m³</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            // Build years
            const yearArray = kf.gasConsumptionDhw?.properties?.year?.value || kf.gasConsumptionHeating?.properties?.year?.value || [];
            const maxYears = Math.min(yearArray.length, 2);
            let yearTabsHtml = '', yearContentHtml = '';

            for (let i = 0; i < maxYears; i++) {
                const gasDhw = getArrayValue(kf.gasConsumptionDhw, 'year', i);
                const gasHeating = getArrayValue(kf.gasConsumptionHeating, 'year', i);
                if (gasDhw === null && gasHeating === null) continue;

                const now = new Date();
                const yearLabel = now.getFullYear() - i;
                const totalGas = (gasDhw || 0) + (gasHeating || 0);
                yearTabsHtml += `<button class="stat-tab ${i === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'gas-year-${i}')">${yearLabel}</button>`;
                yearContentHtml += `
                    <div id="gas-year-${i}" class="stat-tab-content" style="${i === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${gasDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(gasDhw)} m³</span></div>` : ''}
                            ${gasHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(gasHeating)} m³</span></div>` : ''}
                            ${totalGas > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalGas)} m³</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            if (!dayTabsHtml && !weekTabsHtml && !monthTabsHtml && !yearTabsHtml) return '';

            return `
                <div class="card">
                    <div class="card-header"><h2>🔥 Gasverbrauch</h2></div>
                    <div class="stat-tabs stat-tabs-main">${mainTabsHtml}</div>
                    <div id="gas-period-day" class="stat-period-content" style="display: block;">
                        <div class="stat-tabs stat-tabs-scrollable">${dayTabsHtml}</div>
                        <div class="stat-content">${dayContentHtml}</div>
                    </div>
                    <div id="gas-period-week" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${weekTabsHtml}</div>
                        <div class="stat-content">${weekContentHtml}</div>
                    </div>
                    <div id="gas-period-month" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${monthTabsHtml}</div>
                        <div class="stat-content">${monthContentHtml}</div>
                    </div>
                    <div id="gas-period-year" class="stat-period-content" style="display: none;">
                        <div class="stat-tabs stat-tabs-scrollable">${yearTabsHtml}</div>
                        <div class="stat-content">${yearContentHtml}</div>
                    </div>
                </div>
            `;
        }
        
        
        // Heat Production Summary Card (Erzeugte Wärmeenergie) - separate Kachel mit Summary-Daten
        function renderHeatProductionSummaryCard(kf, getSummaryValue) {
            const periods = [
                {key: 'currentDay', label: 'Heute'},
                {key: 'lastSevenDays', label: 'Letzte 7 Tage'},
                {key: 'currentMonth', label: 'Aktueller Monat'},
                {key: 'lastMonth', label: 'Letzter Monat'},
                {key: 'currentYear', label: 'Aktuelles Jahr'},
                {key: 'lastYear', label: 'Letztes Jahr'}
            ];
        
            let tabsHtml = '';
            let contentHtml = '';
        
            periods.forEach((period, index) => {
                const heatDhw = getSummaryValue(kf.heatProductionSummaryDhw, period.key);
                const heatHeating = getSummaryValue(kf.heatProductionSummaryHeating, period.key);
        
                if (heatDhw === null && heatHeating === null) return;
        
                const totalHeat = (heatDhw || 0) + (heatHeating || 0);
        
                tabsHtml += `<button class="stat-tab ${index === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'heat-${period.key}')">${period.label}</button>`;
                contentHtml += `
                    <div id="heat-${period.key}" class="stat-tab-content" style="${index === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${heatDhw !== null ? `<div class="stat-item stat-heat"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(heatDhw)} kWh</span></div>` : ''}
                            ${heatHeating !== null ? `<div class="stat-item stat-heat"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(heatHeating)} kWh</span></div>` : ''}
                            ${totalHeat > 0 ? `<div class="stat-item stat-heat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalHeat)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            });
        
            if (!tabsHtml) return '';
        
            return `
                <div class="card">
                    <div class="card-header"><h2>🌡️ Erzeugte Wärmeenergie</h2></div>
                    <div class="stat-tabs stat-tabs-scrollable">${tabsHtml}</div>
                    <div class="stat-content">${contentHtml}</div>
                </div>
            `;
        }

        // Compressor-specific energy consumption and production card (Vitocal - single week values)
        function renderCompressorEnergyCard(kf, getArrayValue) {
            // Helper to extract single value from feature
            const getValue = (feature) => {
                if (!feature) return null;
                // Handle direct value property
                if (feature.value !== undefined) {
                    return feature.value;
                }
                // Handle properties.value structure
                if (feature.properties && feature.properties.value && feature.properties.value.value !== undefined) {
                    return feature.properties.value.value;
                }
                return null;
            };

            let html = '';

            // Build power consumption card
            const powerDhw = getValue(kf.compressorPowerConsumptionDhw);
            const powerHeating = getValue(kf.compressorPowerConsumptionHeating);

            if (powerDhw !== null || powerHeating !== null) {
                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                html += `
                    <div class="card">
                        <div class="card-header"><h2>⚡ Verdichter Stromverbrauch (Wöchentlich)</h2></div>
                        <div class="stat-grid">
                            ${powerDhw !== null ? `<div class="stat-item stat-power"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(powerDhw)} kWh</span></div>` : ''}
                            ${powerHeating !== null ? `<div class="stat-item stat-power"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(powerHeating)} kWh</span></div>` : ''}
                            ${totalPower > 0 ? `<div class="stat-item stat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalPower)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            // Build heat production card
            const heatDhw = getValue(kf.compressorHeatProductionDhw);
            const heatHeating = getValue(kf.compressorHeatProductionHeating);
            const heatCooling = getValue(kf.compressorHeatProductionCooling);

            if (heatDhw !== null || heatHeating !== null || heatCooling !== null) {
                const totalHeat = (heatDhw || 0) + (heatHeating || 0) + (heatCooling || 0);
                html += `
                    <div class="card">
                        <div class="card-header"><h2>🌡️ Verdichter Wärmeproduktion (Wöchentlich)</h2></div>
                        <div class="stat-grid">
                            ${heatDhw !== null ? `<div class="stat-item stat-heat"><span class="stat-label">💧 Warmwasser</span><span class="stat-value">${formatNum(heatDhw)} kWh</span></div>` : ''}
                            ${heatHeating !== null ? `<div class="stat-item stat-heat"><span class="stat-label">🔥 Heizen</span><span class="stat-value">${formatNum(heatHeating)} kWh</span></div>` : ''}
                            ${heatCooling !== null ? `<div class="stat-item stat-cool"><span class="stat-label">❄️ Kühlung</span><span class="stat-value">${formatNum(heatCooling)} kWh</span></div>` : ''}
                            ${totalHeat > 0 ? `<div class="stat-item stat-heat-total"><span class="stat-label">Gesamt</span><span class="stat-value">${formatNum(totalHeat)} kWh</span></div>` : ''}
                        </div>
                    </div>
                `;
            }

            return html;
        }

        // Fallback: Render statistics using summary features
        function renderConsumptionStatisticsSummary(kf) {

            // Helper to extract property from summary feature
            const getProp = (summary, prop) => {
                if (!summary || !summary.properties || !summary.properties[prop]) return null;
                const property = summary.properties[prop];
                // The property structure is {type: "number", value: X, unit: "kilowattHour"}
                if (property && property.value !== undefined) {
                    return property.value;
                }
                return null;
            };

            // Collect data for each time period
            const periods = [
                {key: 'currentDay', label: 'Heute', divider: 1},
                {key: 'lastSevenDays', label: '7 Tage', divider: 7},
                {key: 'currentMonth', label: 'Monat', divider: 30},
                {key: 'currentYear', label: 'Jahr', divider: 365}
            ];

            let tabsHtml = '';
            let contentHtml = '';

            periods.forEach((period, index) => {
                const powerDhw = getProp(kf.powerConsumptionSummaryDhw, period.key);
                const powerHeating = getProp(kf.powerConsumptionSummaryHeating, period.key);
                const heatDhw = getProp(kf.heatProductionSummaryDhw, period.key);
                const heatHeating = getProp(kf.heatProductionSummaryHeating, period.key);

                // Debug log
                if (period.key === 'currentDay') {
                    console.log(`📊 ${period.label} raw data:`, {
                        powerDhw,
                        powerHeating,
                        heatDhw,
                        heatHeating,
                        powerDhwFeature: kf.powerConsumptionSummaryDhw,
                        powerHeatingFeature: kf.powerConsumptionSummaryHeating
                    });
                }

                // Skip if no data
                if (powerDhw === null && powerHeating === null && heatDhw === null && heatHeating === null) return;

                const totalPower = (powerDhw || 0) + (powerHeating || 0);
                const totalHeat = (heatDhw || 0) + (heatHeating || 0);
                const cop = totalPower > 0 ? (totalHeat / totalPower).toFixed(2) : '-';
                const avgPerWeek = period.divider > 1 ? (totalPower / period.divider * 7).toFixed(1) : null;

                tabsHtml += `
                    <button class="stat-tab ${index === 0 ? 'active' : ''}" onclick="switchStatTab(event, 'stat-${period.key}')">
                        ${period.label}
                    </button>
                `;

                contentHtml += `
                    <div id="stat-${period.key}" class="stat-tab-content" style="${index === 0 ? 'display: block;' : 'display: none;'}">
                        <div class="stat-grid">
                            ${powerDhw !== null ? `
                                <div class="stat-item stat-power">
                                    <span class="stat-label">💧 Warmwasser/Verdichter</span>
                                    <span class="stat-value">${formatNum(powerDhw)} kWh</span>
                                    ${avgPerWeek && period.key !== 'currentDay' ? `<span class="stat-avg">≈ ${avgPerWeek} kWh/Woche</span>` : ''}
                                </div>
                            ` : ''}
                            ${powerHeating !== null ? `
                                <div class="stat-item stat-power">
                                    <span class="stat-label">🔥 Heizen/Verdichter</span>
                                    <span class="stat-value">${formatNum(powerHeating)} kWh</span>
                                </div>
                            ` : ''}
                            ${totalPower > 0 ? `
                                <div class="stat-item stat-total">
                                    <span class="stat-label">⚡ Strom Gesamt</span>
                                    <span class="stat-value">${formatNum(totalPower)} kWh</span>
                                </div>
                            ` : ''}
                            ${heatDhw !== null ? `
                                <div class="stat-item stat-heat">
                                    <span class="stat-label">🌡️ Wärme Warmwasser</span>
                                    <span class="stat-value">${formatNum(heatDhw)} kWh</span>
                                </div>
                            ` : ''}
                            ${heatHeating !== null ? `
                                <div class="stat-item stat-heat">
                                    <span class="stat-label">🏠 Wärme Heizen</span>
                                    <span class="stat-value">${formatNum(heatHeating)} kWh</span>
                                </div>
                            ` : ''}
                            ${totalHeat > 0 && totalPower > 0 ? `
                                <div class="stat-item stat-cop">
                                    <span class="stat-label">📊 momentane AZ (${period.label})</span>
                                    <span class="stat-value">${cop}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            });

            if (!tabsHtml) return '';

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>📈 Verbrauchsstatistik</h2>
                    </div>
                    <div class="stat-tabs">
                        ${tabsHtml}
                    </div>
                    <div class="stat-content">
                        ${contentHtml}
                    </div>
                </div>
            `;
        }

        function renderAdditionalSensors(kf) {
            let sensors = '';

            if (kf.volumetricFlow) {
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Volumenstrom</span>
                        <span class="status-value">${formatNum(kf.volumetricFlow.value, 0)} ${kf.volumetricFlow.unit || 'l/h'}</span>
                    </div>
                `;
            }

            if (kf.pressure) {
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Druck</span>
                        <span class="status-value">${formatNum(kf.pressure.value)} ${kf.pressure.unit || 'bar'}</span>
                    </div>
                `;
            }

            if (kf.pumpInternal) {
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Interne Pumpe</span>
                        <span class="status-value">${formatNum(kf.pumpInternal.value, 0)} ${kf.pumpInternal.unit || '%'}</span>
                    </div>
                `;
            }

            if (kf.fan0) {
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Lüfter 1</span>
                        <span class="status-value">${formatNum(kf.fan0.value, 0)} ${kf.fan0.unit || '%'}</span>
                    </div>
                `;
            }

            if (kf.fan1) {
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Lüfter 2</span>
                        <span class="status-value">${formatNum(kf.fan1.value, 0)} ${kf.fan1.unit || '%'}</span>
                    </div>
                `;
            }

            // 4/3-Way Valve Position
            if (kf.fourWayValve) {
                const valveLabels = {
                    'domesticHotWater': 'Warmwasser',
                    'heating': 'Heizen',
                    'cooling': 'Kühlen',
                    'defrost': 'Abtauen',
                    'standby': 'Standby',
                    'off': 'Aus',
                    'climateCircuitOne': 'Heiz-/Kühlkreis 1',
                    'climatCircuitTwoDefrost': 'Integrierter Pufferspeicher'
                };
                const valveValue = kf.fourWayValve.value;
                const valveDisplay = valveLabels[valveValue] || valveValue;
                sensors += `
                    <div class="status-item">
                        <span class="status-label">4/3-Wege-Ventil</span>
                        <span class="status-value">${valveDisplay}</span>
                    </div>
                `;
            }

            // Secondary Heater (only show if it has an actual value)
            if (kf.secondaryHeater?.value) {
                const heaterStatus = kf.secondaryHeater.value;
                const isActive = heaterStatus !== 'off' && heaterStatus !== 'standby';
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Zusatzheizung</span>
                        <span class="status-value">${isActive ? '🟢' : '⚪'} ${heaterStatus}</span>
                    </div>
                `;
            }

            // Noise Reduction (heat pump) - Read-only display
            if (kf.noiseReductionExists) {
                const currentApiMode = kf.noiseReductionMode ? kf.noiseReductionMode.value : 'notReduced';
                const modeLabels = {
                    'notReduced': 'Aus',
                    'slightlyReduced': 'Leicht reduziert',
                    'maxReduced': 'Maximal reduziert'
                };
                const modeLabel = modeLabels[currentApiMode] || currentApiMode;
                sensors += `
                    <div class="status-item">
                        <span class="status-label">Geräuschreduzierung</span>
                        <span class="status-value">${modeLabel}</span>
                    </div>
                `;
            }

            if (!sensors) return '';

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>🔧 Weitere Komponenten</h2>
                    </div>
                    <div class="status-list">
                        ${sensors}
                    </div>
                </div>
            `;
        }

        function renderHybridProControlInfo(kf) {
            // Get saved settings if available
            const saved = window.savedHybridProControlSettings || {};

            // Debug logging
            console.log('=== Hybrid Pro Control Debug ===');
            console.log('Current kf values:', {
                hybridElectricityPriceLow: kf.hybridElectricityPriceLow,
                hybridElectricityPriceNormal: kf.hybridElectricityPriceNormal,
                hybridHeatPumpEnergyFactor: kf.hybridHeatPumpEnergyFactor,
                hybridFossilEnergyFactor: kf.hybridFossilEnergyFactor,
                hybridFossilPriceLow: kf.hybridFossilPriceLow,
                hybridFossilPriceNormal: kf.hybridFossilPriceNormal,
                hybridControlStrategy: kf.hybridControlStrategy
            });
            console.log('Saved settings:', saved);

            // Debug: Search for any control strategy fields
            console.log('All kf keys with "strategy":', Object.keys(kf).filter(k => k.toLowerCase().includes('strategy')));
            console.log('All kf keys with "control":', Object.keys(kf).filter(k => k.toLowerCase().includes('control')));

            // Simple number formatter for hybrid values (not feature objects)
            const formatNumber = (num) => {
                if (num === null || num === undefined || num === '' || isNaN(num)) {
                    return null;
                }
                const n = parseFloat(num);
                // For prices and energy factors, show up to 3 decimal places but remove trailing zeros
                return n.toFixed(4).replace(/\.?0+$/, '');
            };

            // Prefer saved settings, fallback to API values
            const getDisplayValue = (savedVal, apiVal) => {
                // If saved value exists and is not 0, use it
                if (savedVal !== undefined && savedVal !== null && savedVal !== 0) {
                    console.log('Using saved value:', savedVal);
                    return formatNumber(savedVal);
                }
                // Otherwise use API value
                else if (apiVal) {
                    // apiVal can be an object with a 'value' property or just a number
                    const numVal = (typeof apiVal === 'object' && apiVal.value !== undefined) ? apiVal.value : apiVal;
                    console.log('Using API value:', numVal, 'from apiVal:', apiVal);
                    return formatNumber(numVal);
                }
                return null;
            };

            // Helper to check if a value is valid
            const hasValidValue = (val) => {
                if (val === null || val === undefined || val === '') return false;
                if (typeof val === 'object' && val.value !== undefined) {
                    return val.value !== null && val.value !== undefined && val.value !== '' && !isNaN(val.value);
                }
                return !isNaN(val);
            };

            // Only show if hybrid system with at least one hybrid value (saved or API)
            const hasAnyValue = (saved.electricityPriceLow !== undefined && saved.electricityPriceLow !== 0) ||
                               (saved.electricityPriceNormal !== undefined && saved.electricityPriceNormal !== 0) ||
                               (saved.heatPumpEnergyFactor !== undefined && saved.heatPumpEnergyFactor !== 0) ||
                               (saved.fossilEnergyFactor !== undefined && saved.fossilEnergyFactor !== 0) ||
                               (saved.fossilPriceLow !== undefined && saved.fossilPriceLow !== 0) ||
                               (saved.fossilPriceNormal !== undefined && saved.fossilPriceNormal !== 0) ||
                               hasValidValue(kf.hybridElectricityPriceLow) ||
                               hasValidValue(kf.hybridElectricityPriceNormal) ||
                               hasValidValue(kf.hybridHeatPumpEnergyFactor) ||
                               hasValidValue(kf.hybridFossilEnergyFactor) ||
                               hasValidValue(kf.hybridFossilPriceLow) ||
                               hasValidValue(kf.hybridFossilPriceNormal);

            if (!hasAnyValue) {
                return '';
            }

            let hybrid = '';

            // Stromtarif Niedrig
            const elLow = getDisplayValue(saved.electricityPriceLow, kf.hybridElectricityPriceLow);
            if (elLow) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Stromtarif Niedrig</span>
                        <span class="status-value">${elLow} EUR/kWh</span>
                    </div>
                `;
            }

            // Stromtarif Normal
            const elNorm = getDisplayValue(saved.electricityPriceNormal, kf.hybridElectricityPriceNormal);
            if (elNorm) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Stromtarif Normal</span>
                        <span class="status-value">${elNorm} EUR/kWh</span>
                    </div>
                `;
            }

            // Primärenergiefaktor WP
            const hpFactor = getDisplayValue(saved.heatPumpEnergyFactor, kf.hybridHeatPumpEnergyFactor);
            if (hpFactor) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Primärenergiefaktor WP</span>
                        <span class="status-value">${hpFactor}</span>
                    </div>
                `;
            }

            // Primärenergiefaktor Fossil
            const fosFactor = getDisplayValue(saved.fossilEnergyFactor, kf.hybridFossilEnergyFactor);
            if (fosFactor) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Primärenergiefaktor Fossil</span>
                        <span class="status-value">${fosFactor}</span>
                    </div>
                `;
            }

            // Fossil Tarif Niedrig
            const fosPriceLow = getDisplayValue(saved.fossilPriceLow, kf.hybridFossilPriceLow);
            if (fosPriceLow) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Fossil Tarif Niedrig</span>
                        <span class="status-value">${fosPriceLow} EUR/kWh</span>
                    </div>
                `;
            }

            // Fossil Tarif Normal
            const fosPriceNorm = getDisplayValue(saved.fossilPriceNormal, kf.hybridFossilPriceNormal);
            if (fosPriceNorm) {
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Fossil Tarif Normal</span>
                        <span class="status-value">${fosPriceNorm} EUR/kWh</span>
                    </div>
                `;
            }

            // Regelstrategie (nur aus gespeicherten Einstellungen, nicht aus API)
            const strategyMap = {
                'constant': 'Konstanttemperatur',
                'ecological': 'Ökologisch',
                'economic': 'Ökonomisch'
            };

            if (saved.controlStrategy) {
                const strategy = strategyMap[saved.controlStrategy] || saved.controlStrategy;
                hybrid += `
                    <div class="status-item">
                        <span class="status-label">Regelstrategie</span>
                        <span class="status-value">${strategy}</span>
                    </div>
                `;
            }

            if (!hybrid) return '';

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>☀️ Hybrid Pro Control</h2>
                    </div>
                    <div class="status-list">
                        ${hybrid}
                    </div>
                </div>
            `;
        }

        function renderRefrigerantCircuit(kf) {
            // Only for heat pumps
            if (!kf.evaporatorTemp && !kf.condensorTemp && !kf.inverterTemp) return '';

            let circuit = '';

            if (kf.evaporatorTemp && isValidNumericValue(kf.evaporatorTemp)) {
                circuit += `
                    <div class="status-item">
                        <span class="status-label">Verdampfer</span>
                        <span class="status-value">${formatValue(kf.evaporatorTemp)}</span>
                    </div>
                `;
            }

            if (kf.evaporatorOverheat && isValidNumericValue(kf.evaporatorOverheat)) {
                circuit += `
                    <div class="status-item">
                        <span class="status-label">Verdampfer Überhitzung</span>
                        <span class="status-value">${formatValue(kf.evaporatorOverheat)}</span>
                    </div>
                `;
            }

            if (kf.condensorTemp && isValidNumericValue(kf.condensorTemp)) {
                circuit += `
                    <div class="status-item">
                        <span class="status-label">Verflüssiger</span>
                        <span class="status-value">${formatValue(kf.condensorTemp)}</span>
                    </div>
                `;
            }

            if (kf.economizerTemp && isValidNumericValue(kf.economizerTemp)) {
                circuit += `
                    <div class="status-item">
                        <span class="status-label">Economizer</span>
                        <span class="status-value">${formatValue(kf.economizerTemp)}</span>
                    </div>
                `;
            }

            if (kf.inverterTemp && isValidNumericValue(kf.inverterTemp)) {
                circuit += `
                    <div class="status-item">
                        <span class="status-label">Wechselrichter</span>
                        <span class="status-value">${formatValue(kf.inverterTemp)}</span>
                    </div>
                `;
            }

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>🔧 Kältekreislauf</h2>
                    </div>
                    <div class="status-list">
                        ${circuit}
                    </div>
                </div>
            `;
        }

        function renderSystemStatus(kf) {
            let status = '';

            if (kf.operatingMode) {
                // Map API modes to German labels
                const modeLabels = {
                    'heating': 'Heizen',
                    'standby': 'Standby',
                    'cooling': 'Kühlen',
                    'heatingCooling': 'Heizen/Kühlen'
                };
                const currentMode = kf.operatingMode.value;

                status += `
                    <div class="status-item">
                        <span class="status-label">Betriebsmodus</span>
                        <span class="status-value">
                            <select id="heatingModeSelect" onchange="changeHeatingMode(this.value)" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; cursor: pointer;">
                                <option value="heating" ${currentMode === 'heating' ? 'selected' : ''}>Heizen</option>
                                <option value="standby" ${currentMode === 'standby' ? 'selected' : ''}>Standby</option>
                                <option value="cooling" ${currentMode === 'cooling' ? 'selected' : ''}>Kühlen</option>
                                <option value="heatingCooling" ${currentMode === 'heatingCooling' ? 'selected' : ''}>Heizen/Kühlen</option>
                            </select>
                        </span>
                    </div>
                `;
            }

            if (!status) return '';

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>⚙️ Systemstatus</h2>
                        <span class="badge badge-success">Normal</span>
                    </div>
                    <div class="status-list">
                        ${status}
                    </div>
                </div>
            `;
        }

        function renderDeviceInfo(kf) {
            if (!kf.deviceSerial && !kf.deviceType && !kf.deviceVariant && !kf.scop && !kf.compressorStats) return '';

            let info = '';
            let devVariant = '';

            // Basic device info
            if (kf.deviceVariant) {
                devVariant = kf.deviceVariant.value;
                info += `
                    <div class="status-item">
                        <span class="status-label">Modell</span>
                        <span class="status-value">${devVariant}</span>
                    </div>
                `;
            }

            if (kf.deviceType) {
                info += `
                    <div class="status-item">
                        <span class="status-label">Typ</span>
                        <span class="status-value">${kf.deviceType.value}</span>
                    </div>
                `;
            }

            if (kf.deviceSerial) {
                info += `
                    <div class="status-item">
                        <span class="status-label">Seriennummer</span>
                        <span class="status-value" style="font-family: monospace;">${kf.deviceSerial.value}</span>
                    </div>
                `;
            }

            if (kf.deviceWiFi) {
                let wifiStrength = kf.deviceWiFi.value.strength.value;
                // Only apply -20 dBm offset for Vitocal devices
                if (devVariant && devVariant.toLowerCase().includes("vitocal")) {
                    wifiStrength = wifiStrength - 20.0;
                }
                // Filter out invalid values (< -115 dBm is unrealistic for WiFi)
                if (wifiStrength > -115) {
                    info += `
                        <div class="status-item">
                            <span class="status-label">WiFi Pegel</span>
                            <span class="status-value" style="font-family: monospace;">${wifiStrength} dBm</span>
                        </div>
                    `;
                }
            }

            // JAZ / COP / SCOP / SPF values (Coefficient of Performance)
            if (kf.copTotal || kf.copHeating || kf.copDhw || kf.copCooling || kf.scop || kf.scopHeating || kf.scopDhw || kf.seerCooling) {
                info += `
                    <div class="status-item" style="grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 10px; padding-top: 10px;">
                        <span class="status-label" style="font-weight: 600; color: #667eea;">interne Geräte-JAZ</span>
                    </div>
                `;

                // JAZ Gesamt (COP or SCOP fallback)
                if (kf.copTotal || kf.scop) {
                    const value = kf.copTotal || kf.scop;
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Gesamt</span>
            <span class="status-value">${formatNum(value.value)}</span>
                        </div>
                    `;
                }

                // JAZ Heizen (COP or SCOP fallback)
                if (kf.copHeating || kf.scopHeating) {
                    const value = kf.copHeating || kf.scopHeating;
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Heizen</span>
            <span class="status-value">${formatNum(value.value)}</span>
                        </div>
                    `;
                }

                // JAZ Warmwasser (COP or SCOP fallback)
                if (kf.copDhw || kf.scopDhw) {
                    const value = kf.copDhw || kf.scopDhw;
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Warmwasser</span>
            <span class="status-value">${formatNum(value.value)}</span>
                        </div>
                    `;
                }

                // JAZ Kühlen (COP or SEER fallback)
                if (kf.copCooling || kf.seerCooling) {
                    const value = kf.copCooling || kf.seerCooling;
                    info += `
                        <div class="status-item">
            <span class="status-label">JAZ Kühlen</span>
            <span class="status-value">${formatNum(value.value)}</span>
                        </div>
                    `;
                }
            }

            // Compressor statistics (Lastklassen / Load classes)
            // Helper function to render load class statistics
            function renderCompressorStats(statsObj, compressorIndex) {
                let html = '';
                const stats = statsObj.value;

                if (stats && typeof stats === 'object') {
                    // Check if this has the nested structure (hours/starts from heating.compressors.X.statistics)
                    // These are shown in the Kompressor card, so skip them here
                    const hasHoursStarts = stats.hours && stats.hours.value !== undefined;

                    if (!hasHoursStarts) {
                        // This is the load class data (heating.compressors.X.statistics with loadClassOne, etc.)
                        html += `
            <div class="status-item" style="grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 10px; padding-top: 10px;">
                <span class="status-label" style="font-weight: 600; color: #667eea;">Aufteilung Kompressor-Lastklassen${compressorIndex > 0 ? ' - Kompressor ' + (compressorIndex + 1) : ''}</span>
            </div>
                        `;

                        // Try different property name patterns for load classes
                        const loadClassPatterns = [
            ['hoursLoadClassOne', 'hoursLoadClassTwo', 'hoursLoadClassThree', 'hoursLoadClassFour', 'hoursLoadClassFive'],
            ['loadClassOne', 'loadClassTwo', 'loadClassThree', 'loadClassFour', 'loadClassFive'],
            ['hoursLoadClass1', 'hoursLoadClass2', 'hoursLoadClass3', 'hoursLoadClass4', 'hoursLoadClass5'],
            ['class1', 'class2', 'class3', 'class4', 'class5'],
            ['one', 'two', 'three', 'four', 'five']
                        ];

                        let foundPattern = null;
                        for (const pattern of loadClassPatterns) {
            // Check both direct values and nested structure
            if (stats[pattern[0]] !== undefined) {
                foundPattern = pattern;
                break;
            }
            if (stats[pattern[0]] && stats[pattern[0]].value !== undefined) {
                foundPattern = pattern;
                break;
            }
                        }

                        if (foundPattern) {
            foundPattern.forEach((key, index) => {
                let value = null;
                // Handle both direct values and nested structure
                if (stats[key] !== undefined) {
                    if (typeof stats[key] === 'object' && stats[key].value !== undefined) {
                        value = stats[key].value;
                    } else {
                        value = stats[key];
                    }
                }

                if (value !== null) {
                    html += `
                        <div class="status-item">
                            <span class="status-label">Stunden Lastklasse ${['eins', 'zwei', 'drei', 'vier', 'fünf'][index]}</span>
                            <span class="status-value">${value} h</span>
                        </div>
                    `;
                }
            });
                        }
                    }
                }
                return html;
            }

            // Render all available compressor statistics
            // Prefer load statistics (heating.compressors.X.statistics.load) which contain the load classes
            // Fall back to regular statistics (heating.compressors.X.statistics) if load stats not available
            if (kf.compressorStatsLoad0) {
                console.log('📊 Compressor 0 Load Statistics:', kf.compressorStatsLoad0.value);
                info += renderCompressorStats(kf.compressorStatsLoad0, 0);
            } else if (kf.compressorStats0) {
                console.log('📊 Compressor 0 Statistics:', kf.compressorStats0.value);
                info += renderCompressorStats(kf.compressorStats0, 0);
            }
            if (kf.compressorStatsLoad1) {
                console.log('📊 Compressor 1 Load Statistics:', kf.compressorStatsLoad1.value);
                info += renderCompressorStats(kf.compressorStatsLoad1, 1);
            } else if (kf.compressorStats1) {
                console.log('📊 Compressor 1 Statistics:', kf.compressorStats1.value);
                info += renderCompressorStats(kf.compressorStats1, 1);
            }

            return `
                <div class="card">
                    <div class="card-header">
                        <h2>ℹ️ Geräteinformationen</h2>
                    </div>
                    <div class="status-list">
                        ${info}
                    </div>
                </div>
            `;
        }
