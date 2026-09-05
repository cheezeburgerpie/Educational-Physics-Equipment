#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <math.h>

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

// sampling cadence
#define SAMPLE_MS 50
unsigned long nextSampleMs = 0;
unsigned long streamStartMs = 0;
unsigned long sampleSeq = 0;

// least squares slope over N samples reduces noise
// by roughly sqrt(N) while staying responsive
#define VEL_WINDOW 5
long          velCounts[VEL_WINDOW];
unsigned long velMicros[VEL_WINDOW];
int velFill = 0;
int velHead = 0;

void velReset() {
  velFill = 0;
  velHead = 0;
}

void velPush(long count, unsigned long tMicros) {
  velCounts[velHead] = count;
  velMicros[velHead] = tMicros;
  velHead = (velHead + 1) % VEL_WINDOW;
  if (velFill < VEL_WINDOW) velFill++;
}

// Least squares slope of count against time in counts per second.
float velSlope() {
  if (velFill < 2) return 0.0f;

  int oldest = (velHead - velFill + VEL_WINDOW) % VEL_WINDOW;
  unsigned long t0 = velMicros[oldest];

  double sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (int k = 0; k < velFill; k++) {
    int i = (oldest + k) % VEL_WINDOW;
    double x = (double)(velMicros[i] - t0) / 1000000.0; // seconds
    double y = (double)velCounts[i];
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  double denom = velFill * sxx - sx * sx;
  if (denom == 0) return 0.0f;
  return (float)((velFill * sxy - sx * sy) / denom);
}

// timing for velocity calculation
unsigned long lastMicros = 0;
long lastCountForVel = 0;

// BLE stuff 
BLEServer* pServer = nullptr;
BLECharacteristic* pNotifyCharacteristic = nullptr;
BLECharacteristic* pCommandCharacteristic = nullptr;

/**
 * Handles START / STOP / RESET. Shared by the BLE command characteristic and
 * the USB serial port so both should behave identically
 */
void handleCommand(String cmd) {
  cmd.trim();

  if (cmd == "RESET") {
    long now = readEncoderCount();
    encoderOffset = now;
    lastCountForVel = now;
    lastMicros = micros();
    velReset();
    Serial.println("# RESET");
  }
  else if (cmd == "START") {
    lastCountForVel = readEncoderCount();
    lastMicros = micros();
    velReset();
    streamStartMs = millis();
    nextSampleMs  = streamStartMs;
    sampleSeq = 0;
    streamingEnabled = true;
    Serial.println("# START");
  }
  else if (cmd == "STOP") {
    streamingEnabled = false;
    Serial.println("# STOP");
  }
  else if (cmd.length() > 0) {
    Serial.print("# unknown command: ");
    Serial.println(cmd);
  }
}

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    Serial.println("# device connected");
  }
  void onDisconnect(BLEServer* pServer) override {
    Serial.println("# device disconnected, restarting advertising");
    streamingEnabled = false;
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

    handleCommand(value);
  }
};

void setup() {
  Serial.begin(115200);
  delay(100);

  Serial.println("# initializing BLE");
  BLEDevice::init("ESP32 Rotary Motion Sensor V3");

  // The JSON payload is ~55 bytes. The default 23 byte MTU leaves room for
  // only 20 which would truncate every notification
  BLEDevice::setMTU(185);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  // Notify characteristic for sensor JSON
  pNotifyCharacteristic = pService->createCharacteristic(
    NOTIFY_CHARACTERISTIC,
    BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ
  );
  if (pNotifyCharacteristic == nullptr) {
    Serial.println("# ERROR: Failed to create notify characteristic");
  } else {
    Serial.println("# Notify characteristic created");
  }
  pNotifyCharacteristic->addDescriptor(new BLE2902());

  // Command characteristic (write only)
  pCommandCharacteristic = pService->createCharacteristic(
    COMMAND_CHARACTERISTIC,
    BLECharacteristic::PROPERTY_WRITE
  );
  if (pCommandCharacteristic == nullptr) {
    Serial.println("# ERROR: failed to create command characteristic");
  } else {
    Serial.println("# command characteristic created");
  }
  pCommandCharacteristic->setCallbacks(new CommandCallback());

  pService->start();

  BLEAdvertising *pAdvertising = pServer->getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  pAdvertising->start();

  Serial.println("# BLE advertising started");

  pinMode(PIN_A, INPUT_PULLUP);
  pinMode(PIN_B, INPUT_PULLUP);

  // Seed the state machine with the current pin state before interrupts start
  old_AB = (digitalRead(PIN_A) << 1) | digitalRead(PIN_B);

  // Both pins, both edges
  attachInterrupt(digitalPinToInterrupt(PIN_A), encoderISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_B), encoderISR, CHANGE);
  Serial.println("# encoder interrupts attached");

  // initialize timing 
  lastMicros = micros();
  lastCountForVel = readEncoderCount();

  Serial.println("# ready, send START to begin streaming");
}

void loop() {
  // Accept the same commands over USB serial as over BLE
  if (Serial.available()) {
    handleCommand(Serial.readStringUntil('\n'));
  }

  // produce and send JSON when streaming enabled
  // advance the deadline by exactly SAMPLE_MS 
  if (streamingEnabled && (long)(millis() - nextSampleMs) >= 0) {
    nextSampleMs += SAMPLE_MS;
    // resynchronise if fallen behind 
    if ((long)(millis() - nextSampleMs) > (long)(4 * SAMPLE_MS)) {
      nextSampleMs = millis() + SAMPLE_MS;
    }

    unsigned long nowMicros = micros();
    unsigned long tMs = millis() - streamStartMs;

    // One snapshot per sample used for all values below so they stay
    // consistent with each other even if the ISR fires mid sample
    long count = readEncoderCount();

    long adjustedCount = count - encoderOffset;
    float angle = (float)adjustedCount * (2.0f * M_PI / COUNTS_PER_REV); // radians

    // Fit velocity over the last VEL_WINDOW samples
    velPush(count, nowMicros);
    float angularVelocity = velSlope() * (2.0f * M_PI / COUNTS_PER_REV); // rad/s

    char json[128];
    snprintf(json, sizeof(json),
             "{\"t\":%lu,\"n\":%lu,\"angle\":%.4f,\"angularVelocity\":%.4f,\"count\":%ld}",
             tMs, sampleSeq++, angle, angularVelocity, adjustedCount);

    pNotifyCharacteristic->setValue((uint8_t*)json, strlen(json));
    pNotifyCharacteristic->notify();

    Serial.println(json);
  }

  // delay 
  delay(1);
}