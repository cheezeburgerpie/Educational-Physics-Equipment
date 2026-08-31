#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <math.h>
#include <esp_gap_ble_api.h>

#define PIN_A 25
#define PIN_B 26

// Counts per full revolution assuming 4x quadrature decoding
#define COUNTS_PER_REV 2400.0f

// BLE UUIDs
#define SERVICE_UUID            "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NOTIFY_CHARACTERISTIC   "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define COMMAND_CHARACTERISTIC  "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

// encoder globals
// encoderCount and old_AB are written by the ISR and read from loop() and the
// BLE task so they must be volatile 
volatile long encoderCount = 0;
volatile uint8_t old_AB = 0;

long encoderOffset = 0; // for reset; only touched outside the ISR

// Spinlock protecting encoderCount / old_AB.
portMUX_TYPE encoderMux = portMUX_INITIALIZER_UNLOCKED;

// DRAM_ATTR keeps this table in RAM instead of flash
static const DRAM_ATTR int8_t enc_delta[] = {
  0, -1, 1, 0,
  1, 0, 0, -1,
 -1, 0, 0, 1,
  0, 1, -1, 0
};

/**
 * Interrupt handler. Runs on every edge of either encoder pin
 */
void IRAM_ATTR encoderISR() {
  uint8_t current_AB = (digitalRead(PIN_A) << 1) | digitalRead(PIN_B);

  portENTER_CRITICAL_ISR(&encoderMux);
  if (current_AB != old_AB) {
    uint8_t index = ((old_AB << 2) | current_AB) & 0x0F;
    encoderCount += enc_delta[index];
    old_AB = current_AB;
  }
  portEXIT_CRITICAL_ISR(&encoderMux);
}

long readEncoderCount() {
  long c;
  portENTER_CRITICAL(&encoderMux);
  c = encoderCount;
  portEXIT_CRITICAL(&encoderMux);
  return c;
}

// start and stop boolean 
bool streamingEnabled = false;

// timing for velocity calculation
unsigned long lastMicros = 0;
long lastCountForVel = 0;

// BLE stuff 
BLEServer* pServer = nullptr;
BLECharacteristic* pNotifyCharacteristic = nullptr;
BLECharacteristic* pCommandCharacteristic = nullptr;

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    Serial.println("*** Device Connected ***");
  }
  void onDisconnect(BLEServer* pServer) override {
    Serial.println("*** device disconnected — restarting advertising ***");
    pServer->startAdvertising();
  }
};

// Command callback 
class CommandCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) override {
    String value;

    #if defined(ARDUINO_ESP32_MAJOR_VERSION) && ARDUINO_ESP32_MAJOR_VERSION >= 2
      std::string rxData = pCharacteristic->getValue();
      value = String(rxData.c_str());
    #else
      value = pCharacteristic->getValue();
    #endif

    value.trim();

    if (value == "RESET") {
      encoderOffset = readEncoderCount();
      Serial.println("Received RESET command from web");
    } 
    else if (value == "START") {
      streamingEnabled = true;
      Serial.println("Received START command from web");
    } 
    else if (value == "STOP") {
      streamingEnabled = false;
      Serial.println("Received STOP command from web");
    } 
    else {
      Serial.print("Unknown command: ");
      Serial.println(value);
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(100);

  Serial.println("Initializing BLE...");
  BLEDevice::init("ESP32 Rotary Motion Sensor V3");
  // Added for stability 
  esp_ble_conn_update_params_t conn_params = {0};
  conn_params.min_int = 0x18;  // 30ms min interval (24 * 1.25ms)
  conn_params.max_int = 0x30;  // 60ms max interval (48 * 1.25ms)
  conn_params.latency = 0;     // No slave latency
  conn_params.timeout = 800;   // 8s supervision timeout (800 * 10ms)

  // update params after connection 
  esp_ble_gap_update_conn_params(&conn_params);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  // Notify characteristic for sensor JSON
  pNotifyCharacteristic = pService->createCharacteristic(
    NOTIFY_CHARACTERISTIC,
    BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ
  );
  if (pNotifyCharacteristic == nullptr) {
    Serial.println("*** ERROR: Failed to create notify characteristic ***");
  } else {
    Serial.println("Notify characteristic created successfully");
  }
  pNotifyCharacteristic->addDescriptor(new BLE2902());

  // Command characteristic (write only)
  pCommandCharacteristic = pService->createCharacteristic(
    COMMAND_CHARACTERISTIC,
    BLECharacteristic::PROPERTY_WRITE
  );
  if (pCommandCharacteristic == nullptr) {
    Serial.println("*** ERROR: Failed to create command characteristic ***");
  } else {
    Serial.println("Command characteristic created successfully");
  }
  pCommandCharacteristic->setCallbacks(new CommandCallback());

  pService->start();

  BLEAdvertising *pAdvertising = pServer->getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->start();

  Serial.println("BLE Advertising started");
  Serial.println("Notify UUID: " + String(NOTIFY_CHARACTERISTIC));
  Serial.println("Command UUID: " + String(COMMAND_CHARACTERISTIC));

  pinMode(PIN_A, INPUT_PULLUP);
  pinMode(PIN_B, INPUT_PULLUP);

  // Seed the state machine with the current pin state before interrupts start
  old_AB = (digitalRead(PIN_A) << 1) | digitalRead(PIN_B);

  // Both pins, both edges
  attachInterrupt(digitalPinToInterrupt(PIN_A), encoderISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_B), encoderISR, CHANGE);
  Serial.println("Encoder interrupts attached");

  // initialize timing 
  lastMicros = micros();
  lastCountForVel = readEncoderCount();
}

void loop() {

  // produce and send JSON when streaming enabled
  static unsigned long lastNotifyMs = 0;
  if (streamingEnabled && (millis() - lastNotifyMs) >= 50) { // 20 Hz
    lastNotifyMs = millis();

    // One snapshot per sample used for all three values below so
    // they stay consistent with each other even if the ISR fires mid sample
    long count = readEncoderCount();

    // compute angle in radians
    long adjustedCount = count - encoderOffset;
    float angle = (float)adjustedCount * (2.0f * M_PI / COUNTS_PER_REV); // radians

    // compute angular velocity (rad/s) using micros() delta
    unsigned long nowMicros = micros();
    unsigned long dtMicros = nowMicros - lastMicros;
    float angularVelocity = 0.0f;
    if (dtMicros > 0) {
      long dCount = count - lastCountForVel;
      float dAngle = (float)dCount * (2.0f * M_PI / COUNTS_PER_REV);
      angularVelocity = dAngle / (dtMicros / 1000000.0f); // rads/s
    }
    // update baselines for next calc
    lastMicros = nowMicros;
    lastCountForVel = count;

    // create JSON string
    // include angle, angularVelocity (rad/s), count
    String json = "{\"angle\":" + String(angle, 4) + ",\"angularVelocity\":" + String(angularVelocity, 4) + ",\"count\":" + String(adjustedCount) + "}";
    pNotifyCharacteristic->setValue(json.c_str());
    pNotifyCharacteristic->notify();

    // print to serial for debugging 
    Serial.println(json);
  }

  // delay 
  delay(1);
}