// rotary java script logic

import { readSerial, connectBLE } from "./helper.js";

//has to match .ino
const ROTARY_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const ROTARY_CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

const rotarySerialElement = document.getElementById("data-rotary-serial");
const rotaryBLEElement = document.getElementById("data-rotary-BLE");
const logSerialElement = document.getElementById("log-serial");

// Serial
document.getElementById("button-rotary-serial").addEventListener("click", async () => {
  readSerial(rotarySerialElement, logSerialElement, "Rotary Angle (radians)", "angle", 115200);
});

// BLE
/*document.getElementById("button-rotary-BLE").addEventListener("click", async () => {
  connectBLE(ROTARY_SERVICE_UUID, ROTARY_CHARACTERISTIC_UUID, rotaryBLEElement, "Rotary Angle (radians)", "angle", logSerialElement);
});
*/
