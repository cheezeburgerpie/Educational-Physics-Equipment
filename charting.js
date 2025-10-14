// charting
// only rotary sensor compatible at the moment, will add others later
// https://www.chartjs.org/docs/latest
// filling modes is under area graph not line

document.addEventListener("DOMContentLoaded", () => {
  console.log("Charting.js initialized");

  const ctx = document.getElementById("sensorChart").getContext("2d");
  const statusDiv = document.getElementById("data-rotary-BLE"); 
  const startBtn = document.getElementById("startButton");
  const stopBtn = document.getElementById("stopButton");
  const resetBtn = document.getElementById("resetButton");
  const toggleModeBtn = document.getElementById("toggleModeButton");
  const toggleSelectModeBtn = document.getElementById("toggleSelectMode");
  const calculateDeltaBtn = document.getElementById("calculateDelta");
  const calculateAreaBtn = document.getElementById("calculateArea");
  const calculationResultDiv = document.getElementById("calculationResult");
  const bleButton = document.getElementById("button-rotary-BLE");

  let currentMode = "angle"; // default is angle
  let selectMode = false; // point selection 
  let selectedPoints = []; // Array to store selected point 

  const ANGLE_LABEL = "Rotary Angle (radians)";
  const VELOCITY_LABEL = "Rotary Angular Velocity (rad/s)";

  // register annotation plugin 
  const annotationPlugin =
    window.chartjsPluginAnnotation ||
    window['chartjs-plugin-annotation'] ||
    window.chartjs_plugin_annotation ||
    window.ChartAnnotation ||
    window.annotationPlugin ||
    null;

  if (annotationPlugin) {
    try {
      Chart.register(annotationPlugin);
      console.log("Annotation plugin registered.");
    } catch (e) {
      console.warn("Failed to register annotation plugin:", e);
    }
  } else {
    console.warn("Annotation plugin not found. Annotations will be disabled.");
  }

  // Chart setup 
  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: ANGLE_LABEL,
        data: [],
        borderColor: "rgba(54, 162, 235, 1)",
        borderWidth: 2,
        fill: false
      }]
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: { display: true, position: "top" },
        annotation: {
          annotations: {} 
        }
      },
      scales: {
        x: { title: { display: true, text: "Time (s)" } },
        y: { title: { display: true, text: "Angle (rad)" } }
      },
      onClick: (event) => {
        if (!selectMode) return;
        let elements = [];
        if (typeof chart.getElementsAtEventForMode === "function") {
          elements = chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, true);
        } else if (typeof Chart.getElementsAtEventForMode === "function") {
          elements = Chart.getElementsAtEventForMode(chart, event, 'nearest', { intersect: true }, true);
        }
        if (elements && elements.length > 0) {
          const index = elements[0].index;
          if (selectedPoints.includes(index)) return; // already selected
          selectedPoints.push(index);
          if (selectedPoints.length > 2) selectedPoints.shift(); 
          updateAnnotations();
          chart.update();
        }
      }
    }
  });

  // Function to clear highlight dataset
  function clearHighlight() {
    if (chart.data.datasets.length > 1) {
      chart.data.datasets.pop();
      chart.update();
    }
  }

  // Function to update annotations for selected points
  function updateAnnotations() {
    const annotations = {};
    selectedPoints.forEach((index, i) => {
      const point = { x: chart.data.labels[index], y: chart.data.datasets[0].data[index] };
      annotations[`point${i}`] = {
        type: 'point',
        xValue: point.x,
        yValue: point.y,
        backgroundColor: 'red',
        radius: 5,
        label: { content: `P${i+1}`, enabled: true, position: 'top' }
      };
    });
    if (!chart.options.plugins) chart.options.plugins = {};
    if (!chart.options.plugins.annotation) chart.options.plugins.annotation = { annotations: {} };
    chart.options.plugins.annotation.annotations = annotations;
  }

  // Function to update chart config 
  function updateChartMode(mode) {
    currentMode = mode;
    const isAngle = mode === "angle";
    chart.data.datasets[0].label = isAngle ? ANGLE_LABEL : VELOCITY_LABEL;
    chart.options.scales.y.title.text = isAngle ? "Angle (rad)" : "Angular Velocity (rad/s)";
    toggleModeBtn.textContent = isAngle ? "Switch to Velocity" : "Switch to Angle";
    chart.data.labels = []; // Clear data on mode switch 
    chart.data.datasets[0].data = [];
    selectedPoints = []; // Reset selected points
    clearHighlight();
    calculationResultDiv.textContent = '';
    chart.update();
  }

  // Add new point to the chart based on current mode
  function addDataPointObj(json) {
    // json is expected to be { angle: number, angularVelocity: number, count: number }
    const value = currentMode === "angle" ? json.angle : json.angularVelocity;
    if (value === undefined) return; 

    const elapsed = chart.data.labels.length * 0.05; // ~50 ms between updates 
    chart.data.labels.push(elapsed.toFixed(2));
    chart.data.datasets[0].data.push(value);
    if (chart.data.labels.length > 200) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
      // adjust he selectedPoints indices if shifted
      selectedPoints = selectedPoints.map(idx => idx - 1).filter(idx => idx >= 0);
      if (chart.data.datasets.length > 1) {
        chart.data.datasets[1].data.shift();
        chart.data.datasets[1].data.push(null); 
      }
    }
    updateAnnotations(); // Update 
    chart.update();

    // Update status div based on mode
    const unit = currentMode === "angle" ? "rad" : "rad/s";
    if (statusDiv) statusDiv.textContent = `${currentMode.charAt(0).toUpperCase() + currentMode.slice(1)}: ${value.toFixed(2)} ${unit}`;
  }

  // Expose function for helper.js to call
  window.addDataToChart = function(label, value) {
    if (label === ANGLE_LABEL) {
      if (currentMode !== "angle") {
        console.warn("addDataToChart: got angle but chart is in", currentMode, "mode. Ignoring.");
        return;
      }
      addDataPointObj({ angle: Number(value) });
    } else if (label === VELOCITY_LABEL) {
      if (currentMode !== "velocity") {
        console.warn("addDataToChart: got velocity but chart is in", currentMode, "mode. Ignoring.");
        return;
      }
      addDataPointObj({ angularVelocity: Number(value) });
    } else {
      // if chart mode is angle try to use value as angle
      addDataPointObj({ angle: Number(value) });
    }
  };

  // delta and area calcs  
  function calculateDelta() {
    if (selectedPoints.length < 2) {
      calculationResultDiv.textContent = "Select two points first.";
      return;
    }
    const idx1 = Math.min(...selectedPoints);
    const idx2 = Math.max(...selectedPoints);
    const x1 = parseFloat(chart.data.labels[idx1]);
    const y1 = chart.data.datasets[0].data[idx1];
    const x2 = parseFloat(chart.data.labels[idx2]);
    const y2 = chart.data.datasets[0].data[idx2];
    const deltaY = y2 - y1;
    const deltaX = x2 - x1;
    const slope = deltaY / deltaX;
    const unit = currentMode === "angle" ? "rad/s" : "rad/s²";
    calculationResultDiv.textContent = `Delta: Δy = ${deltaY.toFixed(4)}, Δx = ${deltaX.toFixed(4)} s, Slope = ${slope.toFixed(4)} ${unit}`;
  }

  function calculateArea() {
    if (selectedPoints.length < 2) {
      calculationResultDiv.textContent = "Select two points";
      return;
    }
    const idx1 = Math.min(...selectedPoints);
    const idx2 = Math.max(...selectedPoints);
    let area = 0;
    for (let i = idx1; i < idx2; i++) {
      const y1 = chart.data.datasets[0].data[i];
      const y2 = chart.data.datasets[0].data[i + 1];
      const dx = parseFloat(chart.data.labels[i + 1]) - parseFloat(chart.data.labels[i]);
      area += (y1 + y2) / 2 * dx;
    }
    const unit = currentMode === "angle" ? "rad·s" : "rad/s·s = rad";
    calculationResultDiv.textContent = `Area under curve: ${area.toFixed(4)} ${unit}`;

    // highlight the area
    clearHighlight();
    const fullData = new Array(chart.data.datasets[0].data.length).fill(null);
    for (let i = idx1; i <= idx2; i++) {
      fullData[i] = chart.data.datasets[0].data[i];
    }
    const highlightDataset = {
      label: 'Highlighted Area',
      data: fullData,
      borderColor: 'rgba(255, 99, 132, 0.5)',
      backgroundColor: 'rgba(255, 99, 132, 0.3)',
      fill: 'origin',
      borderWidth: 1,
      pointRadius: 0
    };
    chart.data.datasets.push(highlightDataset);
    chart.update();
  }

  // BLE handling 
  let bleDevice = null;
  let bleServer = null;
  let commandChar = null;
  let notifyChar = null;

  async function connectToESP32() {
    try {
      const serviceUUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
      const notifyUUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
      const commandUUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

      if (!navigator.bluetooth) {
        statusDiv.textContent = "Web Bluetooth not supported"
        return;
      }

      statusDiv.textContent = "Connecting to ESP32...";

      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: [serviceUUID] }]
      });

      bleServer = await bleDevice.gatt.connect();
      const service = await bleServer.getPrimaryService(serviceUUID);
      notifyChar = await service.getCharacteristic(notifyUUID);
      commandChar = await service.getCharacteristic(commandUUID);

      await notifyChar.startNotifications();
      notifyChar.addEventListener("characteristicvaluechanged", (event) => {
        const value = new TextDecoder().decode(event.target.value);
        try {
          const json = JSON.parse(value);
          addDataPointObj(json);
        } catch (e) {
          console.warn("Invalid JSON:", value);
        }
      });

      statusDiv.textContent = "Connected. Waiting for data...";
      console.log("Connected to ESP32 via BLE");
    } catch (error) {
      console.error("BLE connection failed:", error);
      statusDiv.textContent = "Connection failed. Try again.";
    }
  }

  async function sendCommand(cmd) {
    if (!commandChar) {
      console.warn("Command characteristic not available.");
      return;
    }
    try {
      await commandChar.writeValue(new TextEncoder().encode(cmd));
      console.log(`Sent command: ${cmd}`);
    } catch (e) {
      console.error("Failed to send command:", e);
    }
  }

  if (bleButton) bleButton.addEventListener("click", connectToESP32);

  if (startBtn) startBtn.addEventListener("click", async () => { await sendCommand("START"); statusDiv.textContent = "Streaming started..."; });
  if (stopBtn) stopBtn.addEventListener("click", async () => { await sendCommand("STOP"); statusDiv.textContent = "Streaming stopped."; });
  if (resetBtn) resetBtn.addEventListener("click", async () => {
    await sendCommand("RESET");
    chart.data.labels = [];
    chart.data.datasets[0].data = [];
    selectedPoints = [];
    clearHighlight();
    calculationResultDiv.textContent = '';
    chart.update();
    statusDiv.textContent = "Chart reset and zeroed on ESP32.";
  });

  // Mode toggles
  if (toggleModeBtn) toggleModeBtn.addEventListener("click", () => {
    const newMode = currentMode === "angle" ? "velocity" : "angle";
    updateChartMode(newMode);
  });

  if (toggleSelectModeBtn) toggleSelectModeBtn.addEventListener("click", () => {
    selectMode = !selectMode;
    toggleSelectModeBtn.textContent = selectMode ? "Disable Point Selection" : "Enable Point Selection";
    if (!selectMode) {
      selectedPoints = [];
      clearHighlight();
      updateAnnotations();
      chart.update();
      calculationResultDiv.textContent = '';
    }
  });

  if (calculateDeltaBtn) calculateDeltaBtn.addEventListener("click", calculateDelta);
  if (calculateAreaBtn) calculateAreaBtn.addEventListener("click", calculateArea);

  // Initialize  the chart mode
  updateChartMode(currentMode);
});
