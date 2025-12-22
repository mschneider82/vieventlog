// Dashboard Render Engine
// Main orchestration, feature extraction, and circuit detection
// Part 1 of 3 - refactored from dashboard-render.js

        function renderDashboard(features) {
            const contentDiv = document.getElementById('dashboardContent');
            contentDiv.className = 'dashboard-grid';

            // Helper function to unwrap nested value objects (available locally in renderDashboard)
            const unwrapValue = (val) => {
                while (val && typeof val === 'object' && val.value !== undefined) {
                    val = val.value;
                }
                return val;
            };

            // Store features globally for debugging
            window.currentFeaturesData = features;

            // Extract key features
            const keyFeatures = extractKeyFeatures(features);

            // Store key features globally for use in Modal
            window.currentKeyFeatures = keyFeatures;

            // Debug: Log features with specific keywords
            if (features.rawFeatures) {
                const volumeFlowFeatures = features.rawFeatures.filter(f =>
                    f.feature && (
                        f.feature.toLowerCase().includes('volume') ||
                        f.feature.toLowerCase().includes('flow') ||
                        f.feature.toLowerCase().includes('fan')
                    )
                );
                if (volumeFlowFeatures.length > 0) {
                    console.log('🔍 Features mit volume/flow/fan:', volumeFlowFeatures);
                }

                const statsFeatures = features.rawFeatures.filter(f =>
                    f.feature && f.feature.toLowerCase().includes('statistic')
                );
                if (statsFeatures.length > 0) {
                    console.log('📊 Statistics Features:', statsFeatures);
                }
            }

            // Build dashboard HTML
            let html = '';

            // Check if this is a SmartClimate / Zigbee device
            const deviceInfo = features.deviceInfo;
            const deviceType = deviceInfo ? deviceInfo.deviceType : null;
            const modelId = deviceInfo ? deviceInfo.modelId : null;

            console.log('Device Type:', deviceType, 'Model ID:', modelId);

            // Render appropriate view based on device type
            if (deviceType === 'zigbee') {
                // SmartClimate / Zigbee device
                if (modelId && modelId.includes('eTRV')) {
                    // Heizkörper-Thermostat
                    html += renderThermostatView(keyFeatures, deviceInfo);
                } else if (modelId && modelId.includes('cs_generic')) {
                    // Klimasensor
                    html += renderClimateSensorView(keyFeatures, deviceInfo);
                } else if (modelId && modelId.includes('fht')) {
                    // Fußboden-Thermostat
                    html += renderFloorHeatingView(keyFeatures, deviceInfo);
                } else if (modelId && modelId.includes('repeater')) {
                    // Repeater
                    html += renderRepeaterView(keyFeatures, deviceInfo);
                } else {
                    // Unknown zigbee device - show generic info
                    html += renderDeviceHeader(deviceInfo, keyFeatures);
                    html += renderZigbeeDeviceInfo(keyFeatures);
                }
            } else {
                // Standard heating device (Vitocal/Vitodens)

                // Detect heating circuits first
                const circuits = detectHeatingCircuits(features);
                console.log('Rendering circuits:', circuits);

                // Store heating curve data per circuit for later use (BEFORE rendering header)
                if (!window.heatingCurveData) {
                    window.heatingCurveData = {};
                }

                // Get room temperature setpoint from active program
                let roomTempSetpoint = 20; // Default fallback
                if (keyFeatures.operatingProgram && keyFeatures.operatingProgram.value) {
                    const activeProgram = keyFeatures.operatingProgram.value;
                    console.log('🔍 Active program for heating curve:', activeProgram);
                    // Try to get temperature for active program (it's a nested property)
                    const programFeatureName = `heating.circuits.0.operating.programs.${activeProgram}`;
                    console.log('🔍 Looking for feature:', programFeatureName);
                    for (const category of [features.circuits, features.operatingModes, features.temperatures, features.other]) {
                        if (category && category[programFeatureName]) {
                            const programFeature = category[programFeatureName];
                            console.log('🔍 Found program feature:', programFeature);
                            if (programFeature.value && programFeature.value.temperature) {
                                const tempProp = programFeature.value.temperature;
                                if (tempProp.value !== undefined && tempProp.value !== null) {
                                    roomTempSetpoint = tempProp.value;
                                    console.log(`✅ Using room temp setpoint from active program ${activeProgram}: ${roomTempSetpoint}°C`);
                                    break;
                                }
                            }
                        }
                    }
                    if (roomTempSetpoint === 20) {
                        console.log('⚠️ Could not find temperature for active program, using default 20°C');
                    }
                }

                // Store data for circuit 0 (backward compatibility)
                window.heatingCurveData[0] = {
                    slope: keyFeatures.heatingCurveSlope ? keyFeatures.heatingCurveSlope.value : null,
                    shift: keyFeatures.heatingCurveShift ? keyFeatures.heatingCurveShift.value : null,
                    currentOutside: keyFeatures.outsideTemp ? keyFeatures.outsideTemp.value : null,
                    currentSupply: keyFeatures.supplyTemp ? keyFeatures.supplyTemp.value : null,
                    maxSupply: keyFeatures.supplyTempMax ? keyFeatures.supplyTempMax.value : null,
                    minSupply: keyFeatures.supplyTempMin ? keyFeatures.supplyTempMin.value : null,
                    roomTempSetpoint: roomTempSetpoint
                };
                // Keep legacy format for backward compatibility (for chart rendering)
                window.heatingCurveData.slope = window.heatingCurveData[0].slope;
                window.heatingCurveData.shift = window.heatingCurveData[0].shift;
                window.heatingCurveData.currentOutside = window.heatingCurveData[0].currentOutside;
                window.heatingCurveData.currentSupply = window.heatingCurveData[0].currentSupply;
                window.heatingCurveData.maxSupply = window.heatingCurveData[0].maxSupply;
                window.heatingCurveData.minSupply = window.heatingCurveData[0].minSupply;
                window.heatingCurveData.roomTempSetpoint = window.heatingCurveData[0].roomTempSetpoint;

                // Device info header (if available) - NOW with heatingCurveData available
                if (features.deviceInfo) {
                    html += renderDeviceHeader(features.deviceInfo, keyFeatures);
                }

                // Main temperature displays (outside, supply)
                html += renderMainTemperatures(keyFeatures);

                // Store data for each circuit
                for (const circuitId of circuits) {
                    const circuitPrefix = `heating.circuits.${circuitId}`;
                    const find = (exactName) => {
                        for (const category of [features.circuits, features.operatingModes, features.temperatures, features.other]) {
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
                        return null;
                    };
                    const findNested = (featureName, propertyName) => {
                        for (const category of [features.circuits, features.operatingModes, features.temperatures, features.other]) {
                            if (category && category[featureName]) {
                                const feature = category[featureName];
                                if (feature.type === 'object') {
                                    // Support both "value" and "properties" formats
                                    const container = feature.value || feature.properties;
                                    if (container && typeof container === 'object') {
                                        const nestedValue = container[propertyName];
                                        if (nestedValue && nestedValue.value !== undefined) {
                                            return nestedValue.value;
                                        }
                                    }
                                }
                            }
                        }
                        return null;
                    };

                    const slope = findNested(`${circuitPrefix}.heating.curve`, 'slope');
                    const shift = findNested(`${circuitPrefix}.heating.curve`, 'shift');
                    const circuitSupplyTemp = find(`${circuitPrefix}.sensors.temperature.supply`);
                    const maxSupply = findNested(`${circuitPrefix}.temperature.levels`, 'max');
                    const minSupply = findNested(`${circuitPrefix}.temperature.levels`, 'min');

                    // Get room temperature setpoint from active program for this circuit
                    let circuitRoomTempSetpoint = 20; // Default fallback
                    const operatingProgram = find(`${circuitPrefix}.operating.programs.active`);
                    if (operatingProgram && operatingProgram.value) {
                        const activeProgram = operatingProgram.value;
                        const programFeatureName = `${circuitPrefix}.operating.programs.${activeProgram}`;
                        for (const category of [features.circuits, features.operatingModes, features.temperatures, features.other]) {
                            if (category && category[programFeatureName]) {
                                const programFeature = category[programFeatureName];
                                if (programFeature.value && programFeature.value.temperature) {
                                    const tempProp = programFeature.value.temperature;
                                    if (tempProp.value !== undefined && tempProp.value !== null) {
                                        circuitRoomTempSetpoint = tempProp.value;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // Unwrap values that might be nested objects
                    const unwrappedOutsideTemp = keyFeatures.outsideTemp ? unwrapValue(keyFeatures.outsideTemp.value) : null;
                    const unwrappedSupplyTemp = circuitSupplyTemp ? unwrapValue(circuitSupplyTemp.value) : null;

                    window.heatingCurveData[circuitId] = {
                        slope: slope,
                        shift: shift,
                        currentOutside: typeof unwrappedOutsideTemp === 'number' ? unwrappedOutsideTemp : null,
                        currentSupply: typeof unwrappedSupplyTemp === 'number' ? unwrappedSupplyTemp : null,
                        maxSupply: maxSupply,
                        minSupply: minSupply,
                        roomTempSetpoint: circuitRoomTempSetpoint
                    };
                    console.log(`📊 Stored heating curve data for circuit ${circuitId}:`, window.heatingCurveData[circuitId]);
                }

                // Compressor/burner status card with all details
                html += renderCompressorBurnerStatus(keyFeatures, deviceInfo);

                // Render heating circuits
                for (const circuitId of circuits) {
                    html += renderHeatingCircuitCard(features, circuitId, deviceInfo);
                }

                // Hot water card
                html += renderHotWater(keyFeatures);

                // Heating curve & settings - only show if no heating circuit cards were rendered
                if (circuits.length === 0) {
                    html += renderHeatingCurve(keyFeatures);
                }

                // Consumption
                html += renderConsumption(keyFeatures);

                // Consumption/Production Statistics
                html += renderConsumptionStatistics(keyFeatures);

                // Additional sensors & pumps
                html += renderAdditionalSensors(keyFeatures);

                // Refrigerant circuit (heat pump only)
                html += renderRefrigerantCircuit(keyFeatures);

                // Hybrid Pro Control (hybrid systems)
                html += renderHybridProControlInfo(keyFeatures);

                // System status - only show if no heating circuit cards were rendered
                if (circuits.length === 0) {
                    html += renderSystemStatus(keyFeatures);
                }

                // Device information
                html += renderDeviceInfo(keyFeatures);
            }

            contentDiv.innerHTML = html;

            // Render D3 charts after DOM is updated (only for heating devices)
            if (deviceType !== 'zigbee' && window.heatingCurveData) {
                // Use longer timeout to allow DOM to fully layout (especially important with multiple circuits)
                setTimeout(() => {
                    console.log('📈 Starting to render all heating curve charts...');
                    console.log('Available circuits in heatingCurveData:', Object.keys(window.heatingCurveData));
                    // Render chart for each circuit that has heating curve data
                    for (const circuitId in window.heatingCurveData) {
                        if (circuitId !== 'slope' && circuitId !== 'shift' && circuitId !== 'currentOutside' &&
                            circuitId !== 'currentSupply' && circuitId !== 'maxSupply' && circuitId !== 'minSupply' &&
                            circuitId !== 'roomTempSetpoint') {
                            const data = window.heatingCurveData[circuitId];
                            console.log(`  Circuit ${circuitId}: data=${JSON.stringify(data)}`);
                            if (data && (data.slope !== null || data.shift !== null)) {
                                console.log(`  └─ Rendering chart for circuit ${circuitId}`);
                                renderHeatingCurveChart(parseInt(circuitId));
                            }
                        }
                    }
                }, 300); // Increased timeout from 100ms to 300ms for better DOM layout with multiple circuits
            }

            // Load consumption tile after temperature chart (if enabled)
            setTimeout(async () => {
                if (typeof renderConsumptionTile === 'function') {
                    await renderConsumptionTile(features.deviceInfo, features);
                }
            }, 400);
        }

        function extractKeyFeatures(features) {
            // Find features by exact name first, then by pattern
            const find = (exactNames, patterns = []) => {
                if (!Array.isArray(exactNames)) exactNames = [exactNames];
                if (!Array.isArray(patterns)) patterns = patterns ? [patterns] : [];

                // Try exact matches first
                for (const exactName of exactNames) {
                    for (const category of [features.temperatures, features.dhw, features.circuits,
                           features.operatingModes, features.other]) {
                        if (category[exactName]) {
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
                                // This handles cases like heating.compressors.0.statistics
                                return feature;
                            }
                            // For non-object types, check if it has a value
                            if (feature.value !== null && feature.value !== undefined) {
                                return feature;
                            }
                        }
                    }
                }

                // Fall back to pattern matching
                for (const pattern of patterns) {
                    for (const category of [features.temperatures, features.dhw, features.circuits,
                           features.operatingModes, features.other]) {
                        for (const [key, value] of Object.entries(category)) {
            if (key.toLowerCase().includes(pattern.toLowerCase()) &&
                value.value !== null && value.value !== undefined) {
                return value;
            }
                        }
                    }
                }
                return null;
            };

            // Special find for nested properties (e.g., heating.curve has slope and shift as properties)
            const findNested = (featureName, propertyName) => {
                for (const category of [features.temperatures, features.dhw, features.circuits,
                       features.operatingModes, features.other]) {
                    if (category[featureName]) {
                        const feature = category[featureName];
                        // Check if it has nested properties (Go now returns type="object" with nested FeatureValues)
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

            const findAll = (pattern) => {
                const results = [];
                for (const category of [features.temperatures, features.dhw, features.circuits,
                       features.operatingModes, features.other]) {
                    for (const [key, value] of Object.entries(category)) {
                        if (key.toLowerCase().includes(pattern.toLowerCase()) &&
            value.value !== null && value.value !== undefined) {
            results.push({ name: key, value: value });
                        }
                    }
                }
                return results;
            };

            return {
                // Temperatures
                outsideTemp: find(['heating.sensors.temperature.outside'], ['outside']),
                calculatedOutsideTemp: find(['heating.calculated.temperature.outside']),
                supplyTemp: find(['heating.circuits.0.sensors.temperature.supply']),
                returnTemp: find(['heating.sensors.temperature.return']),
                primarySupplyTemp: find(['heating.primaryCircuit.sensors.temperature.supply']),
                primaryReturnTemp: find(['heating.primaryCircuit.sensors.temperature.return']),
                secondarySupplyTemp: find(['heating.secondaryCircuit.sensors.temperature.supply']),
                secondaryReturnTemp: find(['heating.secondaryCircuit.sensors.temperature.return', 'heating.sensors.temperature.return']),
                bufferTemp: find(['heating.buffer.sensors.temperature.main', 'heating.bufferCylinder.sensors.temperature.main']),
                bufferTempTop: find(['heating.buffer.sensors.temperature.top', 'heating.bufferCylinder.sensors.temperature.top']),
                boilerTemp: find(['heating.boiler.sensors.temperature.commonSupply', 'heating.boiler.temperature.current', 'heating.boiler.temperature']),
                roomTemp: find(['heating.circuits.0.sensors.temperature.room']),
                circuitTemp: find(['heating.circuits.0.temperature']),

                // DHW
                dhwTemp: find(['heating.dhw.sensors.temperature.hotWaterStorage', 'heating.dhw.sensors.temperature.dhwCylinder']),
                dhwCylinderMiddleTemp: find(['heating.dhw.sensors.temperature.hotWaterStorage.middle', 'heating.dhw.sensors.temperature.dhwCylinder.middle']),
                dhwTarget: find(['heating.dhw.temperature.main']),
                dhwTarget2: find(['heating.dhw.temperature.temp2']),
                dhwStatus: find(['heating.dhw.operating.modes.active']),
                dhwHysteresis: find(['heating.dhw.temperature.hysteresis']),
                dhwHysteresisSwitchOn: findNested('heating.dhw.temperature.hysteresis', 'switchOnValue'),
                dhwHysteresisSwitchOff: findNested('heating.dhw.temperature.hysteresis', 'switchOffValue'),

                // Heating curve - these need to be fetched from circuits category
                heatingCurveSlope: findNested('heating.circuits.0.heating.curve', 'slope'),
                heatingCurveShift: findNested('heating.circuits.0.heating.curve', 'shift'),
                supplyTempMax: findNested('heating.circuits.0.temperature.levels', 'max'),
                supplyTempMin: findNested('heating.circuits.0.temperature.levels', 'min'),

                // Operating mode
                operatingMode: find(['heating.circuits.0.operating.modes.active']),
                operatingProgram: find(['heating.circuits.0.operating.programs.active']),

                // Compressor (heat pump - Vitocal)
                compressorActive: findNested('heating.compressors.0', 'active'),
                compressorSpeed: find(['heating.compressors.0.speed.current']),
                compressorPower: find(['heating.inverters.0.sensors.power.output']),
                compressorCurrent: find(['heating.inverters.0.sensors.power.current']),
                compressorInletTemp: find(['heating.compressors.0.sensors.temperature.inlet']),
                compressorOutletTemp: find(['heating.compressors.0.sensors.temperature.outlet']),
                compressorOilTemp: find(['heating.compressors.0.sensors.temperature.oil']),
                compressorMotorTemp: find(['heating.compressors.0.sensors.temperature.motorChamber']),
                compressorPressure: find(['heating.compressors.0.sensors.pressure.inlet']),

                // Fallback features for Oplink devices (current consumption/production)
                compressorPowerConsumptionCurrent: find(['heating.compressors.0.power.consumption.current']),
                compressorHeatProductionCurrent: find(['heating.compressors.0.heat.production.current']),

                // Noise reduction (heat pump - Vitocal)
                noiseReductionMode: find(['heating.noise.reduction.operating.programs.active']),

                // Also check if noise reduction feature exists (even without value)
                noiseReductionExists: (() => {
                    // Check in categories first
                    for (const category of [features.operatingModes, features.other]) {
                        if (category && category['heating.noise.reduction.operating.programs.active']) {
                            return true;
                        }
                    }
                    // Check in raw features as fallback
                    if (features.rawFeatures) {
                        return features.rawFeatures.some(f =>
                            f.feature === 'heating.noise.reduction.operating.programs.active'
                        );
                    }
                    return false;
                })(),

                // Burner (gas heating - Vitodens)
                burnerModulation: find(['heating.burners.0.modulation']),

                // Additional sensors
                volumetricFlow: find(['heating.sensors.volumetricFlow.allengra']),
                pressure: find(['heating.sensors.pressure.supply']),
                pumpInternal: find(['heating.boiler.pumps.internal.current']),
                fan0: find(['heating.primaryCircuit.fans.0.current']),
                fan1: find(['heating.primaryCircuit.fans.1.current']),

                // Efficiency
                // COP (Coefficient of Performance) features - primary source
                copTotal: find(['heating.cop.total']),
                copHeating: find(['heating.cop.heating']),
                copDhw: find(['heating.cop.dhw']),
                copCooling: find(['heating.cop.cooling']),
                // SCOP/SPF fallback if COP not available
                scop: find(['heating.scop.total', 'heating.spf.total']),
                scopHeating: find(['heating.scop.heating', 'heating.spf.heating']),
                scopDhw: find(['heating.scop.dhw', 'heating.spf.dhw']),
                seerCooling: find(['heating.seer.cooling']),

                // Valves and auxiliary systems
                fourWayValve: find(['heating.valves.fourThreeWay.position']),
                secondaryHeater: find(['heating.secondaryHeatGenerator.state', 'heating.secondaryHeatGenerator.status']),
                secondaryHeatGeneratorStatus: find(['heating.secondaryHeatGenerator.status']),
                fanRing: findNested('heating.heater.fanRing', 'active'),
                condensatePan: findNested('heating.heater.condensatePan', 'active'),

                // Hybrid Pro Control features
                hybridElectricityPriceLow: find(['heating.secondaryHeatGenerator.electricity.price.low']),
                hybridElectricityPriceNormal: find(['heating.secondaryHeatGenerator.electricity.price.normal']),
                hybridHeatPumpEnergyFactor: find(['heating.secondaryHeatGenerator.electricity.energyFactor']),
                hybridFossilEnergyFactor: find(['heating.secondaryHeatGenerator.fossil.energyFactor']),
                hybridFossilPriceLow: find(['heating.secondaryHeatGenerator.fossil.price.low']),
                hybridFossilPriceNormal: find(['heating.secondaryHeatGenerator.fossil.price.normal']),
                hybridControlStrategy: find(['heating.secondaryHeatGenerator.control.strategy']),

                // Refrigerant circuit (heat pump specific)
                evaporatorTemp: find(['heating.evaporators.0.sensors.temperature.liquid']),
                evaporatorOverheat: find(['heating.evaporators.0.sensors.temperature.overheat']),
                condensorTemp: find(['heating.condensors.0.sensors.temperature.liquid']),
                economizerTemp: find(['heating.economizers.0.sensors.temperature.liquid']),
                inverterTemp: find(['heating.inverters.0.sensors.temperature.powerModule']),

                // Device information
                deviceSerial: find(['device.serial']),
                deviceType: find(['device.type']),
                deviceVariant: find(['device.variant', 'heating.device.variant']),
                deviceWiFI: find(['tcu.wifi']),

                // Compressor statistics (load classes)
                compressorStats0: find(['heating.compressors.0.statistics']),
                compressorStats1: find(['heating.compressors.1.statistics']),

                // SmartClimate / Zigbee device features
                // Device generic
                deviceName: find(['device.name']),
                deviceBattery: find(['device.power.battery']),
                zigbeeLqi: find(['device.zigbee.lqi']),
                deviceHumidity: find(['device.sensors.humidity']),
                deviceTemperature: find(['device.sensors.temperature']),

                // Thermostat (TRV) features
                trvTemperature: find(['trv.temperature']),
                trvValvePosition: find(['trv.valve.position']),
                trvChildLock: find(['trv.childLock']),
                trvMountingMode: find(['trv.mountingMode']),

                // Floor heating thermostat (FHT) features
                fhtOperatingMode: find(['fht.operating.modes.active']),
                fhtSupplyTemp: find(['fht.sensors.temperature.supply']),
                fhtHeatingActive: find(['fht.operating.modes.heating']),
                fhtCoolingActive: find(['fht.operating.modes.cooling']),
                fhtStandbyActive: find(['fht.operating.modes.standby']),

                // Consumption/Production Statistics (Arrays with history)
                // With includeDeviceFeatures=true, these features have day/week/month/year arrays
                powerConsumptionDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.power.consumption.dhw');
                    return f || null;
                })(),
                powerConsumptionHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.power.consumption.heating');
                    return f || null;
                })(),
                powerConsumptionTotal: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.power.consumption.total');
                    return f || null;
                })(),
                heatProductionDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.heat.production.dhw');
                    return f || null;
                })(),
                heatProductionHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.heat.production.heating');
                    return f || null;
                })(),
                // Keep summary features as fallback
                powerConsumptionSummaryDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.power.consumption.summary.dhw');
                    return f || null;
                })(),
                powerConsumptionSummaryHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.power.consumption.summary.heating');
                    return f || null;
                })(),
                heatProductionSummaryDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.heat.production.summary.dhw');
                    return f || null;
                })(),
                heatProductionSummaryHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.heat.production.summary.heating');
                    return f || null;
                })(),

                // Compressor-specific energy consumption/production (Vitocal)
                // Only available with includeDeviceFeatures=true
                compressorPowerConsumptionDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.compressors.0.power.consumption.dhw.week');
                    return f || null;
                })(),
                compressorPowerConsumptionHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.compressors.0.power.consumption.heating.week');
                    return f || null;
                })(),
                compressorHeatProductionDhw: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.compressors.0.heat.production.dhw.week');
                    return f || null;
                })(),
                compressorHeatProductionHeating: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.compressors.0.heat.production.heating.week');
                    return f || null;
                })(),
                compressorHeatProductionCooling: (() => {
                    if (!features.rawFeatures) return null;
                    const f = features.rawFeatures.find(f => f.feature === 'heating.compressors.0.heat.production.cooling.week');
                    return f || null;
                })(),

            };
        }

        // Detect available heating circuits
        function detectHeatingCircuits(features) {
            if (features.circuits && features.circuits['heating.circuits']) {
                const heatingCircuits = features.circuits['heating.circuits'];

                if (heatingCircuits.value && heatingCircuits.value.enabled) {
                    let enabled = heatingCircuits.value.enabled;

                    // Handle nested structure: {type: 'array', value: [...]}
                    if (enabled.type === 'array' && enabled.value) {
                        enabled = enabled.value;
                    }

                    // Check if enabled is an array
                    if (Array.isArray(enabled)) {
                        console.log('Found enabled circuits array:', enabled);
                        return enabled.map(c => parseInt(c));
                    }

                    // Handle single value as string or number
                    if (typeof enabled === 'string' || typeof enabled === 'number') {
                        console.log('Found single circuit:', enabled);
                        return [parseInt(enabled)];
                    }
                }
            }

            // Fallback: search for heating.circuits.X features
            console.log('Fallback: searching for circuit features');
            const circuitNumbers = new Set();
            for (const category of [features.circuits, features.operatingModes, features.temperatures, features.dhw, features.other]) {
                if (category) {
                    for (const key of Object.keys(category)) {
                        const match = key.match(/^heating\.circuits\.(\d+)\./);
                        if (match) {
                            circuitNumbers.add(parseInt(match[1]));
                        }
                    }
                }
            }

            if (circuitNumbers.size > 0) {
                const circuits = Array.from(circuitNumbers).sort((a, b) => a - b);
                console.log('Found circuits from features:', circuits);
                return circuits;
            }

            // Ultimate fallback: assume circuit 0 exists
            console.log('No circuits found, defaulting to [0]');
            return [0];
        }
