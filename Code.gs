const SESSION_HOURS = 9;
const SHEETS = {
CARTONS: 'Carton Reference',
INVENTORY: 'Inventory Log',
SCAN_LOG: 'Scan Log',
LOAD_STATUS: 'Load Status Log',
LOGIN: 'Login Log',
LOADERS: 'Loaders'
};
// ============================================================
// WEB APP
// ============================================================
function doGet() {
return jsonOutput_({ success: true, service: 'YardMaster API' });
}
function doPost(e) {
try {
const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
const action = String(request.action || '').trim();
let result;
switch (action) {
case 'loaders': result = { success: true, loaders: getActiveLoaders() }; break;
case 'login': result = loginLoader(request.loaderId, request.pin); break;
case 'sessionStatus': result = getSessionStatus(request.sessionId, request.loaderName); break;
case 'loadStatus': result = recordLoadStatus(request.sessionId, request.loaderName, request.answer); break;
case 'cartonCache': result = getCartonCache(request.sessionId, request.loaderName); break;
case 'sync': result = syncPendingScans(request.sessionId, request.loaderName, request.scans); break;
case 'logout': result = logoutLoader(request.sessionId, request.loaderName); break;
case 'expire': result = expireSession(request.sessionId, request.loaderName); break;
default: result = { success: false, error: 'Unknown API action.' };
}
return jsonOutput_(result);
} catch (error) {
return jsonOutput_({ success: false, error: error.message || String(error) });
}
}
function jsonOutput_(value) {
return ContentService
.createTextOutput(JSON.stringify(value))
.setMimeType(ContentService.MimeType.JSON);
}
// ============================================================
// BASIC HELPERS
// ============================================================
function getSS_() {
return SpreadsheetApp.getActiveSpreadsheet();
}
function getSheet_(name) {
const sheet = getSS_().getSheetByName(name);
if (!sheet) {
throw new Error('Missing sheet: ' + name);
}
return sheet;
}
function getTimeZone_() {
return getSS_().getSpreadsheetTimeZone();
}
// ============================================================
// LOADERS
// Loaders:
// LoaderID | LoaderName | Active | PIN
// ============================================================
function getActiveLoaders() {
const sheet = getSheet_(SHEETS.LOADERS);
if (sheet.getLastRow() < 2) {
return [];
}
const rows = sheet
.getRange(2, 1, sheet.getLastRow() - 1, 4)
.getDisplayValues();
return rows
.filter(row =>
String(row[0]).trim() &&
String(row[1]).trim() &&
String(row[2]).trim().toUpperCase() === 'TRUE'
)
.map(row => ({
id: String(row[0]).trim(),
name: String(row[1]).trim()
}))
.sort((a, b) =>
a.name.localeCompare(b.name, undefined, {
sensitivity: 'base'
})
);
}
// ============================================================
// LOGIN
// ============================================================
function loginLoader(loaderId, enteredPin) {
const loadersSheet = getSheet_(SHEETS.LOADERS);
const loginSheet = getSheet_(SHEETS.LOGIN);
if (loadersSheet.getLastRow() < 2) {
return {
success: false,
message: 'No loaders are configured.'
};
}
const rows = loadersSheet
.getRange(2, 1, loadersSheet.getLastRow() - 1, 4)
.getDisplayValues();
const loader = rows.find(row =>
String(row[0]).trim() === String(loaderId).trim() &&
String(row[2]).trim().toUpperCase() === 'TRUE'
);
if (!loader) {
return {
success: false,
message: 'Loader not found or inactive.'
};
}
const storedPin = String(loader[3]).trim();
const suppliedPin = String(enteredPin).trim();
if (storedPin !== suppliedPin) {
return {
success: false,
message: 'Incorrect PIN.'
};
}
const now = new Date();
loginSheet.appendRow([
String(loader[1]).trim(),
now,
'',
''
]);
return {
success: true,
sessionId: loginSheet.getLastRow(),
loaderId: String(loader[0]).trim(),
loaderName: String(loader[1]).trim(),
loginTime: now.toISOString(),
sessionHours: SESSION_HOURS
};
}
// ============================================================
// SESSION
// ============================================================
function validateOpenSession_(sessionId, loaderName) {
const sheet = getSheet_(SHEETS.LOGIN);
const row = Number(sessionId);
if (!row || row < 2 || row > sheet.getLastRow()) {
return {
valid: false,
reason: 'Invalid session'
};
}
const values = sheet
.getRange(row, 1, 1, 4)
.getValues()[0];
if (
String(values[0]).trim() !== String(loaderName).trim()
) {
return {
valid: false,
reason: 'Invalid session'
};
}
if (values[2]) {
return {
valid: false,
reason: 'Signed out'
};
}
return {
valid: true,
loaderName: String(values[0]).trim(),
loginTime: values[1]
};
}
function getSessionStatus(sessionId, loaderName) {
const session = validateOpenSession_(
sessionId,
loaderName
);
if (!session.valid) {
return session;
}
const expiresAt = new Date(
new Date(session.loginTime).getTime() +
SESSION_HOURS * 60 * 60 * 1000
);
return {
valid: true,
expired: new Date() >= expiresAt,
expiresAt: expiresAt.toISOString()
};
}
function logoutLoader(sessionId, loaderName) {
const session = validateOpenSession_(
sessionId,
loaderName
);
if (!session.valid) {
return {
success: true
};
}
const sheet = getSheet_(SHEETS.LOGIN);
const row = Number(sessionId);
sheet.getRange(row, 3).setValue(new Date());
sheet.getRange(row, 4).setValue('Manual Logout');
return {
success: true
};
}
function expireSession(sessionId, loaderName) {
const session = validateOpenSession_(
sessionId,
loaderName
);
if (!session.valid) {
return {
success: true
};
}
const sheet = getSheet_(SHEETS.LOGIN);
const row = Number(sessionId);
sheet.getRange(row, 3).setValue(new Date());
sheet.getRange(row, 4).setValue('9-Hour Timeout');
return {
success: true
};
}
// ============================================================
// ALL TRUCKS LOADED?
// ============================================================
function recordLoadStatus(
sessionId,
loaderName,
answer
) {
const session = validateOpenSession_(
sessionId,
loaderName
);
if (!session.valid) {
return session;
}
const normalized =
String(answer).trim().toLowerCase() === 'yes'
? 'Yes'
: 'No';
getSheet_(SHEETS.LOAD_STATUS)
.appendRow([
loaderName,
normalized,
new Date()
]);
return {
success: true
};
}
// ============================================================
// CARTON CACHE
// ============================================================
function getCartonCache(sessionId, loaderName) {
const session = validateOpenSession_(
sessionId,
loaderName
);
if (!session.valid) {
return session;
}
const sheet = getSheet_(SHEETS.CARTONS);
if (sheet.getLastRow() < 2) {
return {
valid: true,
cartons: []
};
}
const rows = sheet
.getRange(
2,
1,
sheet.getLastRow() - 1,
7
)
.getValues();
return {
valid: true,
cartons: rows
.filter(row => String(row[0]).trim())
.map(row => ({
cartonId: normalizeCartonId_(row[0]),
cartonType: String(row[1] || '').trim(),
firstSeenDate: row[2]
? dateKey_(row[2])
: '',
lastScannedAt: row[3]
? new Date(row[3]).toISOString()
: '',
location: String(row[4] || '').trim(),
yardDays: Number(row[5]) || 0,
scanCount: Number(row[6]) || 0
}))
};
}
function refreshCartonCache(sessionId, loaderName) {
return getCartonCache(
sessionId,
loaderName
);
}
// ============================================================
// BACKGROUND BATCH SYNC
// ============================================================
function syncPendingScans(
sessionId,
loaderName,
scans
) {
const session = validateOpenSession_(
sessionId,
loaderName
);
if (!session.valid) {
return session;
}
if (!Array.isArray(scans) || scans.length === 0) {
return {
valid: true,
success: true,
results: []
};
}
const lock = LockService.getScriptLock();
lock.waitLock(30000);
try {
return syncPendingScansLocked_(
loaderName,
scans
);
} finally {
lock.releaseLock();
}
}
function syncPendingScansLocked_(
loaderName,
scans
) {
const cartonSheet =
getSheet_(SHEETS.CARTONS);
const inventorySheet =
getSheet_(SHEETS.INVENTORY);
const scanLogSheet =
getSheet_(SHEETS.SCAN_LOG);
// ----------------------------------------------------------
// CARTON REFERENCE MAP
// ----------------------------------------------------------
const cartonMap = new Map();
if (cartonSheet.getLastRow() >= 2) {
const rows = cartonSheet
.getRange(
2,
1,
cartonSheet.getLastRow() - 1,
7
)
.getValues();
rows.forEach((row, index) => {
const cartonId =
normalizeCartonId_(row[0]);
if (!cartonId) return;
cartonMap.set(cartonId, {
rowNumber: index + 2,
cartonId: cartonId,
cartonType: String(row[1] || '').trim(),
firstSeenDate: row[2]
? dateKey_(row[2])
: '',
lastScannedAt: row[3]
? new Date(row[3])
: null,
location: String(row[4] || '').trim(),
yardDays: Number(row[5]) || 0,
scanCount: Number(row[6]) || 0
});
});
}
// ----------------------------------------------------------
// DAILY INVENTORY KEYS
// carton + date
// ----------------------------------------------------------
const inventoryDayKeys = new Set();
if (inventorySheet.getLastRow() >= 2) {
const rows = inventorySheet
.getRange(
2,
1,
inventorySheet.getLastRow() - 1,
7
)
.getValues();
rows.forEach(row => {
if (!row[0] || !row[1]) return;
inventoryDayKeys.add(
normalizeCartonId_(row[1]) +
'|' +
dateKey_(row[0])
);
});
}
// ----------------------------------------------------------
// PHYSICAL SCAN IDs
//
// This is what prevents a network retry from incrementing
// ScanCount twice.
// ----------------------------------------------------------
const existingClientScanIds = new Set();
if (scanLogSheet.getLastRow() >= 2) {
const ids = scanLogSheet
.getRange(
2,
1,
scanLogSheet.getLastRow() - 1,
1
)
.getDisplayValues();
ids.forEach(row => {
const id = String(row[0]).trim();
if (id) {
existingClientScanIds.add(id);
}
});
}
const orderedScans = scans
.map(scan => ({
...scan,
_date: safeDate_(scan.scannedAt)
}))
.filter(scan =>
scan._date &&
String(scan.cartonId || '').trim()
)
.sort((a, b) =>
a._date.getTime() -
b._date.getTime()
);
const inventoryRows = [];
const scanLogRows = [];
const results = [];
orderedScans.forEach(scan => {
const clientScanId =
String(scan.clientScanId || '').trim();
const cartonId =
normalizeCartonId_(scan.cartonId);
const cartonType =
String(scan.cartonType || '').trim();
let location =
String(
scan.location || 'Loader Yard'
).trim();
const scannedAt =
scan._date;
const scanDate =
dateKey_(scannedAt);
if (!clientScanId) {
results.push({
success: false,
cartonId: cartonId,
error: 'Missing ClientScanID'
});
return;
}
// Exact same physical scan already synced.
if (
existingClientScanIds.has(
clientScanId
)
) {
results.push({
success: true,
clientScanId: clientScanId,
cartonId: cartonId,
retryDuplicate: true
});
return;
}
if (!cartonId) {
results.push({
success: false,
clientScanId: clientScanId,
error: 'Missing carton number'
});
return;
}
if (!cartonType) {
results.push({
success: false,
clientScanId: clientScanId,
cartonId: cartonId,
error: 'Missing carton type'
});
return;
}
if (
location !== 'Loader Yard' &&
location !== 'Seconds Yard'
) {
location =
'Loader Yard';
}
let carton =
cartonMap.get(cartonId);
if (!carton) {
carton = {
rowNumber: null,
cartonId: cartonId,
cartonType: cartonType,
firstSeenDate: scanDate,
lastScannedAt: scannedAt,
location: location,
yardDays: 1,
scanCount: 0
};
cartonMap.set(
cartonId,
carton
);
}
// --------------------------------------------------------
// EVERY UNIQUE PHYSICAL SCAN COUNTS
// --------------------------------------------------------
carton.scanCount++;
// --------------------------------------------------------
// RAW SCAN LOG
// --------------------------------------------------------
scanLogRows.push([
clientScanId,
cartonId,
scannedAt,
loaderName,
location
]);
existingClientScanIds.add(
clientScanId
);
// --------------------------------------------------------
// EARLIEST FIRST-SEEN DATE
// --------------------------------------------------------
if (
!carton.firstSeenDate ||
scanDate < carton.firstSeenDate
) {
carton.firstSeenDate =
scanDate;
}
// --------------------------------------------------------
// DAILY INVENTORY
//
// Only ONE row per carton per calendar day.
// --------------------------------------------------------
const dailyKey =
cartonId + '|' + scanDate;
const alreadyInInventory =
inventoryDayKeys.has(dailyKey);
if (!alreadyInInventory) {
inventoryRows.push([
dateFromKey_(scanDate),
cartonId,
cartonType,
location,
scannedAt,
loaderName,
clientScanId
]);
inventoryDayKeys.add(
dailyKey
);
}
// --------------------------------------------------------
// CURRENT CARTON STATE
// --------------------------------------------------------
if (
!carton.lastScannedAt ||
scannedAt.getTime() >=
carton.lastScannedAt.getTime()
) {
carton.cartonType =
cartonType;
carton.location =
location;
carton.lastScannedAt =
scannedAt;
}
const latestDate =
carton.lastScannedAt
? dateKey_(carton.lastScannedAt)
: scanDate;
// --------------------------------------------------------
// YARD DAYS
// Weekdays only.
// Missed weekdays still age the carton.
// Weekends do not.
// --------------------------------------------------------
carton.yardDays =
calculateYardDays_(
carton.firstSeenDate,
latestDate
);
results.push({
success: true,
clientScanId: clientScanId,
cartonId: cartonId,
duplicateToday:
alreadyInInventory,
cartonType:
carton.cartonType,
location:
carton.location,
yardDays:
carton.yardDays,
scanCount:
carton.scanCount
});
});
// ==========================================================
// WRITE SCAN LOG
// ==========================================================
if (scanLogRows.length) {
scanLogSheet
.getRange(
scanLogSheet.getLastRow() + 1,
1,
scanLogRows.length,
5
)
.setValues(scanLogRows);
}
// ==========================================================
// WRITE DAILY INVENTORY LOG
// ==========================================================
if (inventoryRows.length) {
inventorySheet
.getRange(
inventorySheet.getLastRow() + 1,
1,
inventoryRows.length,
7
)
.setValues(inventoryRows);
}
// ==========================================================
// WRITE CARTON REFERENCE
// ==========================================================
const newRows = [];
cartonMap.forEach(carton => {
const values = [[
carton.cartonId,
carton.cartonType,
dateFromKey_(
carton.firstSeenDate
),
carton.lastScannedAt || '',
carton.location,
carton.yardDays,
carton.scanCount
]];
if (carton.rowNumber) {
cartonSheet
.getRange(
carton.rowNumber,
1,
1,
7
)
.setValues(values);
} else {
newRows.push(
values[0]
);
}
});
if (newRows.length) {
cartonSheet
.getRange(
cartonSheet.getLastRow() + 1,
1,
newRows.length,
7
)
.setValues(newRows);
}
return {
valid: true,
success: true,
syncedPhysicalScans:
scanLogRows.length,
inventoryRowsAdded:
inventoryRows.length,
results: results
};
}
// ============================================================
// HELPERS
// ============================================================
function normalizeCartonId_(value) {
let carton =
String(value || '')
.trim()
.toUpperCase()
.replace(/\s+/g, '');
if (!carton) {
return '';
}
if (!carton.startsWith('C')) {
carton = 'C' + carton;
}
return carton;
}
function safeDate_(value) {
if (!value) {
return null;
}
const date = new Date(value);
if (isNaN(date.getTime())) {
return null;
}
return date;
}
function dateKey_(value) {
const date =
value instanceof Date
? value
: new Date(value);
return Utilities.formatDate(
date,
getTimeZone_(),
'yyyy-MM-dd'
);
}
function dateFromKey_(key) {
const parts =
String(key)
.split('-')
.map(Number);
return new Date(
parts[0],
parts[1] - 1,
parts[2],
12,
0,
0,
0
);
}
function calculateYardDays_(
startKey,
endKey
) {
if (!startKey || !endKey) {
return 1;
}
const startParts =
startKey
.split('-')
.map(Number);
const endParts =
endKey
.split('-')
.map(Number);
let current =
new Date(
Date.UTC(
startParts[0],
startParts[1] - 1,
startParts[2]
)
);
const end =
new Date(
Date.UTC(
endParts[0],
endParts[1] - 1,
endParts[2]
)
);
if (end < current) {
return 1;
}
let count = 0;
while (current <= end) {
const day =
current.getUTCDay();
if (
day !== 0 &&
day !== 6
) {
count++;
}
current.setUTCDate(
current.getUTCDate() + 1
);
}
return Math.max(count, 1);
}
