// charting
// https://www.chartjs.org/docs/latest
// filling modes is under area graph not line
// https://developer.mozilla.org/en-US/docs/Web/API/Blob
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array
// https://developer.mozilla.org/en-US/docs/Web/API/FileReader
// https://www.w3schools.com/jsref/dom_obj_fileupload.asp
// https://www.papaparse.com/

document.addEventListener("DOMContentLoaded", () => {
    console.log("Charting.js initialised");

    const ctxAngle    = document.getElementById("sensorChartAngle")?.getContext("2d");
    const ctxVelocity = document.getElementById("sensorChartVelocity")?.getContext("2d");

    const statusDiv                    = document.getElementById("data-rotary-BLE");
    
    // buttons and stuff
    const startBtn                     = document.getElementById("startButton");
    const stopBtn                      = document.getElementById("stopButton");
    const resetBtn                     = document.getElementById("resetButton");
    const toggleModeBtn                = document.getElementById("toggleModeButton");
    const dualModeBtn                  = document.getElementById("dualModeButton");
    const calculateDeltaAngleBtn       = document.getElementById("calculateDeltaAngle");
    const calculateAreaAngleBtn        = document.getElementById("calculateAreaAngle");
    const calculateDeltaVelocityBtn    = document.getElementById("calculateDeltaVelocity");
    const calculateAreaVelocityBtn     = document.getElementById("calculateAreaVelocity");
    const calculationResultAngleDiv    = document.getElementById("calculationResultAngle");
    const calculationResultVelocityDiv = document.getElementById("calculationResultVelocity");
    const bleButton                    = document.getElementById("button-rotary-BLE"); //unused?
    const saveCsvBtn                   = document.getElementById("saveCsvButton");
    const importCsvInput               = document.getElementById("importCsvInput");
    const importCsvBtn                 = document.getElementById("importCsvButton");
    
    // Point selection 
    const COLOR_ENDPOINT = '#e03131';
    const COLOR_RANGE    = '#ffcc00';
    // Fully transparent rather than null
    const COLOR_NORMAL   = 'rgba(0,0,0,0)';
    const RADIUS_ENDPOINT = 6;
    const RADIUS_RANGE    = 3;
    const RADIUS_NORMAL   = 0;
    const SHADE_FILL      = 'rgba(75, 192, 192, 0.25)';

    //misc
    let isDual          = false;
    let activeSingle    = "angle";
    let selectedPointsAngle    = [];
    let selectedPointsVelocity = [];
    let allData         = [];
    let startTime       = null;
    let isStreaming     = false;
    
    // labels
    let POSITION_LABEL  = "Rotary Angle (radians)";
    let VELOCITY_LABEL  = "Rotary Angular Velocity (rad/s)";

    // Ultrasonic outlier rejection
    let lastGoodPosition = 0;
    const OUTLIER_THRESHOLD = 150; 

    // Register plugins
    if (window['chartjs-plugin-annotation']) {
        Chart.register(window['chartjs-plugin-annotation']);
    }

    // Create charts
    const chartAngle = new Chart(ctxAngle, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: POSITION_LABEL,
                data: [],
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1,
                pointBackgroundColor: [],
                pointBorderColor: [],
                pointRadius: [],
                // Click target is independent of the radius
                pointHitRadius: 20
            }, {
                // Shading for area under the curve
                label: '__area',
                data: [],
                borderWidth: 0,
                pointRadius: 0,
                fill: 'origin',
                backgroundColor: SHADE_FILL,
                tension: 0.1
            }]
        },
        options: {
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            plugins: {
                legend: { labels: { filter: item => item.text !== '__area' } }
            },
            scales: {
                x: { title: { display: true, text: 'Time (s)' } },
                y: { title: { display: true, text: POSITION_LABEL } }
            },
            onClick: (event, elements, chart) => {
                const hits = chart.getElementsAtEventForMode(
                    event.native || event, 'nearest', { axis: 'x', intersect: false }, true);
                if (hits.length === 0) return;
                const idx = hits[0].index;

                // Selection logic 
                if (selectedPointsAngle.length >= 2 || selectedPointsAngle.includes(idx)) {
                    selectedPointsAngle = [idx];   // start a fresh selection
                } else {
                    selectedPointsAngle.push(idx);
                }
                clearAreaShading(chartAngle);

                updatePointHighlights(chartAngle, selectedPointsAngle);
                updateCalculationResult(calculationResultAngleDiv, selectedPointsAngle, chartAngle, POSITION_LABEL);
            },
        }
    });

    const chartVelocity = new Chart(ctxVelocity, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: VELOCITY_LABEL,
                data: [],
                borderColor: 'rgb(153, 102, 255)',
                tension: 0.1,
                pointBackgroundColor: [],
                pointBorderColor: [],
                pointRadius: [],
                // Click target is independent of the radius
                pointHitRadius: 20
            }, {
                label: '__area',
                data: [],
                borderWidth: 0,
                pointRadius: 0,
                fill: 'origin',
                backgroundColor: 'rgba(153, 102, 255, 0.25)',
                tension: 0.1
            }]
        },
        options: {
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            plugins: {
                legend: { labels: { filter: item => item.text !== '__area' } }
            },
            scales: {
                x: { title: { display: true, text: 'Time (s)' } },
                y: { title: { display: true, text: VELOCITY_LABEL } }
            },
            onClick: (event, elements, chart) => {
                const hits = chart.getElementsAtEventForMode(
                    event.native || event, 'nearest', { axis: 'x', intersect: false }, true);
                if (hits.length === 0) return;
                const idx = hits[0].index;

                // Selection logic
                if (selectedPointsVelocity.length >= 2 || selectedPointsVelocity.includes(idx)) {
                    selectedPointsVelocity = [idx];
                } else {
                    selectedPointsVelocity.push(idx);
                }
                clearAreaShading(chartVelocity);

                updatePointHighlights(chartVelocity, selectedPointsVelocity);
                updateCalculationResult(calculationResultVelocityDiv, selectedPointsVelocity, chartVelocity, VELOCITY_LABEL);
            },
        }
    });

    // Function to update labels based on sensor
    window.updateChartLabels = function() {
        if (window.currentSensor === 'ultrasonic') {
            POSITION_LABEL = "Distance (mm)";
            VELOCITY_LABEL = "Velocity (mm/s)";
        } else {
            POSITION_LABEL = "Rotary Angle (radians)";
            VELOCITY_LABEL = "Rotary Angular Velocity (rad/s)";
        }
        chartAngle.data.datasets[0].label = POSITION_LABEL;
        chartAngle.options.scales.y.title.text = POSITION_LABEL;
        chartVelocity.data.datasets[0].label = VELOCITY_LABEL;
        chartVelocity.options.scales.y.title.text = VELOCITY_LABEL;
        chartAngle.update('none');
        chartVelocity.update('none');
    };

    // Add data to chart 
    window.addDataToChart = function(jsonObj) {
        if (!isStreaming) return;

        const now = Date.now();
        if (startTime === null) startTime = now;

        const time = (now - startTime) / 1000; // time in seconds

        let position, velocity = 0, count = 0;

        if (jsonObj.angle !== undefined) {
            position = jsonObj.angle;
            velocity = jsonObj.angularVelocity || 0;
            count = jsonObj.count || 0;
        } else if (jsonObj.distance !== undefined) {
            position = jsonObj.distance;

            // outlier rejection
            if (window.currentSensor === 'ultrasonic') {
                if (allData.length > 0) {
                    const delta = Math.abs(position - lastGoodPosition);
                    if (delta > OUTLIER_THRESHOLD) {
                        position = lastGoodPosition; // reject outlier
                    }
                }
                lastGoodPosition = position; // update reference
            }
            // Compute velocity from adjusted position
            if (allData.length > 0) {
                const last = allData[allData.length - 1];
                const dt = time - last.time;
                velocity = dt > 0 ? (position - last.position) / dt : 0;
            }
        } else {
            return;
        }

        allData.push({ time, position, velocity, count });

        // A shaded span refers to fixed indices so drop it once new points arrives
        if (chartAngle.data.datasets[1].data.length) clearAreaShading(chartAngle);
        if (chartVelocity.data.datasets[1].data.length) clearAreaShading(chartVelocity);

        chartAngle.data.labels.push(time.toFixed(2));
        chartAngle.data.datasets[0].data.push(position);
        chartVelocity.data.labels.push(time.toFixed(2));
        chartVelocity.data.datasets[0].data.push(velocity);
        
        if (selectedPointsAngle.length > 0) {
            updatePointHighlights(chartAngle, selectedPointsAngle);
        }
        if (selectedPointsVelocity.length > 0) {
            updatePointHighlights(chartVelocity, selectedPointsVelocity);
        }
        
        chartAngle.update('none');
        chartVelocity.update('none');
    };

    // Button listeners
    if (startBtn) startBtn.addEventListener("click", async () => {
        if (window.currentSensor === 'rotary') {
            await window.sendCommand?.("START");
        }
        isStreaming = true;
        startTime = null;
        statusDiv.textContent = "Streaming started.";
    });

    if (stopBtn) stopBtn.addEventListener("click", async () => {
        if (window.currentSensor === 'rotary') {
            await window.sendCommand?.("STOP");
        }
        isStreaming = false;
        statusDiv.textContent = "Streaming stopped.";
    });

    if (resetBtn) resetBtn.addEventListener("click", async () => {
        if (window.currentSensor === 'rotary') {
            await window.sendCommand?.("RESET");
        }

        chartAngle.data.labels = [];
        chartAngle.data.datasets[0].data = [];
        chartAngle.data.datasets[0].pointBackgroundColor = [];
        chartAngle.data.datasets[0].pointBorderColor = [];
        chartAngle.data.datasets[0].pointRadius = [];
        chartAngle.data.datasets[1].data = [];
        chartAngle.reset();
        chartAngle.update('none');

        chartVelocity.data.labels = [];
        chartVelocity.data.datasets[0].data = [];
        chartVelocity.data.datasets[0].pointBackgroundColor = [];
        chartVelocity.data.datasets[0].pointBorderColor = [];
        chartVelocity.data.datasets[0].pointRadius = [];
        chartVelocity.data.datasets[1].data = [];
        chartVelocity.reset();
        chartVelocity.update('none');

        allData = [];
        selectedPointsAngle = [];
        selectedPointsVelocity = [];
        startTime = null;
        lastGoodPosition = 0;
        isStreaming = false;
        

        // Forgot what this is
        calculationResultAngleDiv.textContent = '';
        calculationResultVelocityDiv.textContent = '';

        statusDiv.textContent = window.currentSensor === 'ultrasonic'
            ? "Ultrasonic chart & data reset"
            : "Chart reset and sensor zeroed";

        console.log("Reseted :", window.currentSensor || "unknown");
    });

    if (toggleModeBtn) toggleModeBtn.addEventListener("click", () => {
        activeSingle = activeSingle === "angle" ? "velocity" : "angle";
        toggleModeBtn.textContent = `Switch to ${activeSingle === "angle" ? "Velocity" : "Angle"}`;
        if (!isDual) {
            document.getElementById("angleChartContainer").style.display = activeSingle === "angle" ? "block" : "none";
            document.getElementById("velocityChartContainer").style.display = activeSingle === "velocity" ? "block" : "none";
        }
    });

    if (dualModeBtn) dualModeBtn.addEventListener("click", () => {
        isDual = !isDual;
        dualModeBtn.textContent = isDual ? "Disable Two Charts" : "Enable Two Charts";
        if (isDual) {
            document.getElementById("angleChartContainer").style.display = "block";
            document.getElementById("velocityChartContainer").style.display = "block";
            toggleModeBtn.style.display = "none";
        } else {
            toggleModeBtn.style.display = "inline-block";
            document.getElementById("angleChartContainer").style.display = activeSingle === "angle" ? "block" : "none";
            document.getElementById("velocityChartContainer").style.display = activeSingle === "velocity" ? "block" : "none";
        }
    });

    // Calculation buttons
    if (calculateDeltaAngleBtn)    calculateDeltaAngleBtn.addEventListener("click", calculateDeltaAngle);
    if (calculateAreaAngleBtn)     calculateAreaAngleBtn.addEventListener("click", calculateAreaAngle);
    if (calculateDeltaVelocityBtn) calculateDeltaVelocityBtn.addEventListener("click", calculateDeltaVelocity);
    if (calculateAreaVelocityBtn)  calculateAreaVelocityBtn.addEventListener("click", calculateAreaVelocity);

    if (saveCsvBtn)    saveCsvBtn.addEventListener("click", saveAsCsv);
    if (importCsvInput) importCsvInput.addEventListener("change", handleCsvImport);
    if (importCsvBtn)  importCsvBtn.addEventListener("click", () => importCsvInput.click());

    function calculateDeltaAngle() {
        if (selectedPointsAngle.length !== 2) {
            calculationResultAngleDiv.textContent = "Please select 2 points on the chart.";
            return;
        }
        const [i1, i2] = [...selectedPointsAngle].sort((a,b)=>a-b);
        const y1 = chartAngle.data.datasets[0].data[i1];
        const y2 = chartAngle.data.datasets[0].data[i2];
        const delta = y2 - y1;
        const dt = parseFloat(chartAngle.data.labels[i2]) - parseFloat(chartAngle.data.labels[i1]);
        let msg = `Δ = ${delta.toFixed(3)} ${POSITION_LABEL.split('(')[0].trim()}`;
        if (dt > 0) msg += `  (avg rate: ${(delta/dt).toFixed(3)} /s)`;
        calculationResultAngleDiv.textContent = msg;
    }

    function calculateDeltaVelocity() {
        if (selectedPointsVelocity.length !== 2) {
            calculationResultVelocityDiv.textContent = "Please select 2 points on the chart.";
            return;
        }
        const [i1, i2] = [...selectedPointsVelocity].sort((a,b)=>a-b);
        const y1 = chartVelocity.data.datasets[0].data[i1];
        const y2 = chartVelocity.data.datasets[0].data[i2];
        const delta = y2 - y1;
        const dt = parseFloat(chartVelocity.data.labels[i2]) - parseFloat(chartVelocity.data.labels[i1]);
        let msg = `Δ = ${delta.toFixed(3)} ${VELOCITY_LABEL.split('(')[0].trim()}`;
        if (dt > 0) msg += `  (avg accel: ${(delta/dt).toFixed(3)} /s²)`;
        calculationResultVelocityDiv.textContent = msg;
    }

    function calculateAreaAngle() {
        if (selectedPointsAngle.length !== 2) {
            calculationResultAngleDiv.textContent = "Please select 2 points on the chart.";
            return;
        }
        const [i1, i2] = [...selectedPointsAngle].sort((a,b)=>a-b);
        let area = 0;
        for (let i = i1; i < i2; i++) {
            const t1 = parseFloat(chartAngle.data.labels[i]);
            const t2 = parseFloat(chartAngle.data.labels[i+1]);
            const y1 = chartAngle.data.datasets[0].data[i];
            const y2 = chartAngle.data.datasets[0].data[i+1];
            area += (y1 + y2) / 2 * (t2 - t1);
        }
        const unit = POSITION_LABEL.includes("mm") ? "mm" : "rad";
        shadeArea(chartAngle, i1, i2);
        calculationResultAngleDiv.textContent = `Area ≈ ${area.toFixed(3)} ${unit}·s`;
    }

    function calculateAreaVelocity() {
        if (selectedPointsVelocity.length !== 2) {
            calculationResultVelocityDiv.textContent = "Please select 2 points on the chart.";
            return;
        }
        const [i1, i2] = [...selectedPointsVelocity].sort((a,b)=>a-b);
        let area = 0;
        for (let i = i1; i < i2; i++) {
            const t1 = parseFloat(chartVelocity.data.labels[i]);
            const t2 = parseFloat(chartVelocity.data.labels[i+1]);
            const y1 = chartVelocity.data.datasets[0].data[i];
            const y2 = chartVelocity.data.datasets[0].data[i+1];
            area += (y1 + y2) / 2 * (t2 - t1);
        }
        const unit = VELOCITY_LABEL.includes("mm") ? "mm" : "rad";
        shadeArea(chartVelocity, i1, i2);
        calculationResultVelocityDiv.textContent = `Displacement = ${area.toFixed(3)} ${unit}`;
    }

    // CSV import 
    function handleCsvImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const lines = e.target.result.split("\n").slice(1);
            allData = [];
            lines.forEach(line => {
                if (!line.trim()) return;
                const [timeStr, posStr, velStr, countStr] = line.split(",");
                const time = parseFloat(timeStr);
                const position = parseFloat(posStr);
                const velocity = parseFloat(velStr);
                const count = parseInt(countStr || "0", 10);
                if (!isNaN(time) && !isNaN(position) && !isNaN(velocity)) {
                    allData.push({ time, position, velocity, count });

        // A shaded span refers to fixed indices so drop it once new points arrives
        if (chartAngle.data.datasets[1].data.length) clearAreaShading(chartAngle);
        if (chartVelocity.data.datasets[1].data.length) clearAreaShading(chartVelocity);
                }
            });
            allData.sort((a,b) => a.time - b.time);

            chartAngle.data.labels = allData.map(d => d.time.toFixed(2));
            chartAngle.data.datasets[0].data = allData.map(d => d.position);
            chartVelocity.data.labels = allData.map(d => d.time.toFixed(2));
            chartVelocity.data.datasets[0].data = allData.map(d => d.velocity);

            selectedPointsAngle = [];
            selectedPointsVelocity = [];

            clearAreaShading(chartAngle);
            clearAreaShading(chartVelocity);

            // Clear all highlights
            updatePointHighlights(chartAngle, selectedPointsAngle);
            updatePointHighlights(chartVelocity, selectedPointsVelocity);
            
            calculationResultAngleDiv.textContent = '';
            calculationResultVelocityDiv.textContent = '';

            console.log("CSV imported");
        };
        reader.readAsText(file);
    }

    function saveAsCsv() {
        if (allData.length === 0) {
            alert("No data to save.");
            return;
        }
        const csv = "time,position,velocity,count\n" +
            allData.map(d => `${d.time.toFixed(3)},${d.position.toFixed(3)},${d.velocity.toFixed(3)},${d.count}`).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "sensor_data.csv";
        a.click();
        URL.revokeObjectURL(url);
    }


    // clear selections
    document.getElementById('clearSelections')?.addEventListener('click', () => {
        selectedPointsAngle = [];
        selectedPointsVelocity = [];

        clearAreaShading(chartAngle);
        clearAreaShading(chartVelocity);

        // clear all colors
        updatePointHighlights(chartAngle, selectedPointsAngle);
        updatePointHighlights(chartVelocity, selectedPointsVelocity);
        
        calculationResultAngleDiv.textContent = '';
        calculationResultVelocityDiv.textContent = 'Selections cleared.';
    });

// Updates point colours based on selection 
function updatePointHighlights(chart, selectedIndices) {
    if (!chart?.data?.datasets?.[0]) {
        console.warn("Chart or dataset not ready");
        return;
    }

    const numPoints = chart.data.labels.length;
    if (numPoints === 0) return;

    const bg     = new Array(numPoints).fill(COLOR_NORMAL);
    const border = new Array(numPoints).fill(COLOR_NORMAL);
    const radius = new Array(numPoints).fill(RADIUS_NORMAL);

    const valid = selectedIndices.filter(i => i >= 0 && i < numPoints);

    if (valid.length === 2) {
        const start = Math.min(valid[0], valid[1]);
        const end   = Math.max(valid[0], valid[1]);
        for (let i = start + 1; i < end; i++) {
            bg[i] = COLOR_RANGE;
            border[i] = COLOR_RANGE;
            radius[i] = RADIUS_RANGE;
        }
    }

    // Endpoints drawn last so they always sit on top of the range colour.
    valid.forEach(idx => {
        bg[idx] = COLOR_ENDPOINT;
        border[idx] = COLOR_ENDPOINT;
        radius[idx] = RADIUS_ENDPOINT;
    });

    chart.data.datasets[0].pointBackgroundColor = bg;
    chart.data.datasets[0].pointBorderColor = border;
    chart.data.datasets[0].pointRadius = radius;
    chart.update('none');
}

// Fills the region between two selected indices following the curve.
function shadeArea(chart, i1, i2) {
    const main = chart.data.datasets[0].data;
    const shade = new Array(chart.data.labels.length).fill(null);
    for (let i = i1; i <= i2; i++) {
        shade[i] = main[i];
    }
    chart.data.datasets[1].data = shade;
    chart.update('none');
}

function clearAreaShading(chart) {
    if (!chart?.data?.datasets?.[1]) return;
    chart.data.datasets[1].data = [];
    chart.update('none');
}

// Update text below chart 
function updateCalculationResult(resultDiv, selectedIndices, chart, label) {
    if (selectedIndices.length === 0) {
        resultDiv.textContent = '';
        return;
    }

    if (selectedIndices.length === 1) {
        const idx = selectedIndices[0];
        resultDiv.textContent = `Selected first point ${idx + 1} (t = ${chart.data.labels[idx]} s)`;
        return;
    }

    if (selectedIndices.length === 2) {
        const [i1, i2] = selectedIndices.sort((a,b)=>a-b);
        const t1 = parseFloat(chart.data.labels[i1]);
        const t2 = parseFloat(chart.data.labels[i2]);
        resultDiv.textContent = `Selected range: ${i1 + 1} to ${i2 + 1} (${(t2 - t1).toFixed(2)} s)`;
    }
}



    console.log("charting.js loaded");
});