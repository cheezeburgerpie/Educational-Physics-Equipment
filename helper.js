// helper.js

let commandCharacteristic = null;
let currentChartMode = "angle"; // "angle" or "velocity"
const COMMAND_CHARACTERISTIC_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";


// dataset labels 
const ANGLE_LABEL = "Rotary Angle (radians)";
const VELOCITY_LABEL = "Rotary Angular Velocity (rad/s)";

export function setChartMode(mode) {
  if (mode !== "angle" && mode !== "velocity") return;
  currentChartMode = mode;
  console.log("Chart mode set to", currentChartMode);
  const modeEl = document.getElementById("chartModeDisplay");
  if (modeEl) modeEl.textContent = mode === "angle" ? "Mode: Angle (rad)" : "Mode: Angular Velocity (rad/s)";
}

export function getChartMode() {
  return currentChartMode;
}

function forwardToChart(jsonObj) {
  if (!jsonObj) return;
  if (currentChartMode === "angle" && typeof jsonObj.angle === "number") {
    window.addDataToChart(ANGLE_LABEL, jsonObj.angle);
  } else if (currentChartMode === "velocity" && typeof jsonObj.angularVelocity === "number") {
    window.addDataToChart(VELOCITY_LABEL, jsonObj.angularVelocity);
  } else {
    // fallback; use angle
    if (typeof jsonObj.angle === "number") {
      window.addDataToChart(ANGLE_LABEL, jsonObj.angle);
    }
  }
}

// Generic Serial reader
export async function readSerial(displayElement, logElement, datasetLabel = ANGLE_LABEL, fieldName = "angle", baudRate = 115200) {
  try {
    const port = await navigator.serial.requestPort({});
    await port.open({ baudRate: baudRate });

    displayElement.textContent = "Connected to serial - waiting for data";
    const reader = port.readable.getReader();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        reader.releaseLock();
        displayElement.textContent = "Serial port closed";
        break;
      }
      buffer += new TextDecoder().decode(value);

      // process lines
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          // display human readable
          if (obj.angle !== undefined && obj.angularVelocity !== undefined) {
            displayElement.textContent = `Angle: ${obj.angle.toFixed(4)} rad, ω: ${obj.angularVelocity.toFixed(4)} rad/s, Count: ${obj.count}`;
          } else if (obj.angle !== undefined) {
            displayElement.textContent = `Angle: ${obj.angle.toFixed(4)} rad, Count: ${obj.count}`;
          }
          forwardToChart(obj);
        } catch (e) {
          console.warn("Invalid JSON from serial:", line);
          if (logElement) logElement.textContent = `Serial JSON error: ${e.message}`;
        }
      }
    }
  } catch (err) {
    console.error("Serial error:", err);
    if (displayElement) displayElement.textContent = "Serial disconnected";
    if (logElement) logElement.textContent = `Serial error: ${err.message}`;
  }
}

// Generic BLE connector 
export async function connectBLE(serviceUUID, notifyUUID, displayElement, datasetLabel = ANGLE_LABEL, fieldName = "angle", logElement = null) {
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [serviceUUID] }],
      optionalServices: [serviceUUID]
    });

    device.addEventListener('gattserverdisconnected', () => {
      if (displayElement) displayElement.textContent = "BLE disconnected";
      commandCharacteristic = null;
      console.warn("BLE device disconnected");
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(serviceUUID);

    // notify characteristic
    const notifyChar = await service.getCharacteristic(notifyUUID);
    await notifyChar.startNotifications();
    notifyChar.addEventListener('characteristicvaluechanged', (event) => {
      let txt;
      try {
        txt = new TextDecoder().decode(event.target.value);
      } catch (e) {
        console.warn("Could not decode BLE value", e);
        return;
      }
      try {
        const json = JSON.parse(txt);
        if (displayElement) {
          if (json.angle !== undefined && json.angularVelocity !== undefined) {
            displayElement.textContent = `Angle: ${json.angle.toFixed(4)} rad, ω: ${json.angularVelocity.toFixed(4)} rad/s, Count: ${json.count}`;
          } else if (json.angle !== undefined) {
            displayElement.textContent = `Angle: ${json.angle.toFixed(4)} rad, Count: ${json.count}`;
          }
        }
        forwardToChart(json);
      } catch (e) {
        console.warn("Invalid JSON from BLE:", txt);
        if (logElement) logElement.textContent = `BLE JSON error: ${e.message}`;
      }
    });

    // command characteristic (write)
    try {
      commandCharacteristic = await service.getCharacteristic(COMMAND_CHARACTERISTIC_UUID);
    } catch (e) {
      console.warn("Command characteristic not found", e);
      commandCharacteristic = null;
    }

    if (displayElement) displayElement.textContent = "Connected to BLE device";
    if (logElement) logElement.textContent = "BLE: connected";
    console.log("BLE connected, notifications started");

    return { device, server, service, notifyChar: notifyChar, commandChar: commandCharacteristic };
  } catch (err) {
    console.error("BLE connection failed:", err);
    if (displayElement) displayElement.textContent = "BLE connection failed";
    if (logElement) logElement.textContent = `BLE error: ${err.message}`;
    throw err;
  }
}

// send command to the ESP32 
export async function sendCommand(cmd) {
  if (!commandCharacteristic) {
    console.warn("No command characteristic available. Connect BLE first.");
    return;
  }
  try {
    const encoder = new TextEncoder();
    await commandCharacteristic.writeValue(encoder.encode(cmd));
    console.log("Sent command:", cmd);
  } catch (err) {
    console.error("Failed to send command:", err);
    throw err;
  }
}
