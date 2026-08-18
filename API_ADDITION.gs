// Replace the old doGet() with this doGet(), then add doPost() and jsonOutput_().
// Keep every other function from the existing YardMaster Code.gs unchanged.

function doGet() {
  return jsonOutput_({
    success: true,
    service: 'YardMaster API'
  });
}

function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(request.action || '').trim();
    let result;

    switch (action) {
      case 'loaders':
        result = { success: true, loaders: getActiveLoaders() };
        break;
      case 'login':
        result = loginLoader(request.loaderId, request.pin);
        break;
      case 'sessionStatus':
        result = getSessionStatus(request.sessionId, request.loaderName);
        break;
      case 'loadStatus':
        result = recordLoadStatus(request.sessionId, request.loaderName, request.answer);
        break;
      case 'cartonCache':
        result = getCartonCache(request.sessionId, request.loaderName);
        break;
      case 'sync':
        result = syncPendingScans(request.sessionId, request.loaderName, request.scans);
        break;
      case 'logout':
        result = logoutLoader(request.sessionId, request.loaderName);
        break;
      case 'expire':
        result = expireSession(request.sessionId, request.loaderName);
        break;
      default:
        result = { success: false, error: 'Unknown API action.' };
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
