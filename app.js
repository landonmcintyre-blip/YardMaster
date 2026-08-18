const API_URL="https://script.google.com/macros/s/AKfycbxA64sbkXI3bkFhGsjXvSCzIis64XI0M439EcqB00xrCfs4fzLL9jSS08IdHlzpBguBsA/exec";
const CARTON_TYPES=["Bundle","Skid","Stick","Other"];
const KEYS={loader:"yardmaster-loader",session:"yardmaster-session",queue:"yardmaster-pending",cache:"yardmaster-cartons"};
const $=id=>document.getElementById(id);
const ui={loginPage:$("login-page"),loginForm:$("login-form"),loaderSelect:$("loader-select"),pin:$("loader-pin"),loginButton:$("login-button"),loginMessage:$("login-message"),loadPage:$("load-status-page"),loadMessage:$("load-status-message"),scannerPage:$("scanner-page"),loaderName:$("loader-name"),location:$("location-select"),sync:$("sync-status"),video:$("camera"),status:$("scanner-status"),start:$("start-button"),flash:$("flashlight-button"),manual:$("manual-button"),cartonCard:$("carton-card"),cartonId:$("carton-id"),knownNote:$("known-carton-note"),types:$("type-buttons"),save:$("save-scan-button"),signOut:$("sign-out-button"),manualDialog:$("manual-dialog"),manualForm:$("manual-form"),manualCarton:$("manual-carton"),manualCancel:$("manual-cancel"),pendingDialog:$("pending-dialog"),pendingMessage:$("pending-message"),pendingRetry:$("pending-retry"),pendingClose:$("pending-close")};
let session=read(KEYS.session,null),cartons=new Map(),activeCarton="",selectedType="",scannerRunning=false,scanLocked=false,syncing=false,cameraTrack=null,torch=false,cacheTimer=null,expiryTimer=null,lastCode="",lastScanAt=0;
const hints=new Map([[ZXing.DecodeHintType.TRY_HARDER,true]]),reader=new ZXing.BrowserMultiFormatReader(hints);reader.timeBetweenDecodingAttempts=80;
let rotateNextScanFrame = false;

reader.drawFrameOnCanvas = function (
  source,
  dimensions,
  suppliedContext
) {
  const context = suppliedContext || this.captureCanvasContext;
  const canvas = context.canvas;
  const sourceWidth = source.videoWidth;
  const sourceHeight = source.videoHeight;
  const rotateFrame = rotateNextScanFrame;

  rotateNextScanFrame = !rotateNextScanFrame;

  if (!sourceWidth || !sourceHeight) return;

  const targetWidth = rotateFrame ? sourceHeight : sourceWidth;
  const targetHeight = rotateFrame ? sourceWidth : sourceHeight;

  if (
    canvas.width !== targetWidth ||
    canvas.height !== targetHeight
  ) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (rotateFrame) {
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(
      source,
      -sourceWidth / 2,
      -sourceHeight / 2,
      sourceWidth,
      sourceHeight
    );
    context.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }

  context.drawImage(
    source,
    0,
    0,
    sourceWidth,
    sourceHeight
  );
};

ui.loginForm.addEventListener("submit",login);document.querySelectorAll("[data-load-answer]").forEach(b=>b.addEventListener("click",()=>recordLoadStatus(b.dataset.loadAnswer)));ui.start.addEventListener("click",startScanner);ui.flash.addEventListener("click",toggleTorch);ui.save.addEventListener("click",saveScan);ui.signOut.addEventListener("click",signOut);ui.manual.addEventListener("click",()=>{ui.manualCarton.value="";ui.manualDialog.showModal();ui.manualCarton.focus()});ui.manualCancel.addEventListener("click",()=>ui.manualDialog.close());ui.manualForm.addEventListener("submit",e=>{e.preventDefault();const id=normalizeCarton(ui.manualCarton.value);if(id){ui.manualDialog.close();acceptDecoded(id)}});ui.pendingClose.addEventListener("click",()=>ui.pendingDialog.close());ui.pendingRetry.addEventListener("click",async()=>{await syncQueue();if(!queue().length)ui.pendingDialog.close();else showPendingBlock()});window.addEventListener("online",syncQueue);document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){syncQueue();checkExpiry()}});setInterval(syncQueue,15000);

boot();
async function boot(){renderTypes();ui.location.value="Loader Yard";if(session?.sessionId&&session?.loaderName){if(Date.now()<new Date(session.expiresAt).getTime()||queue().length){openScanner();if(navigator.onLine)api("sessionStatus",session).then(status=>{if(status?.valid===false&&!queue().length)handleExpiredSession()}).catch(()=>{});return}clearSession()}await loadLoaders()}
async function loadLoaders(){show("login");ui.loginMessage.textContent="";try{const data=await api("loaders");const loaders=data.loaders||[];ui.loaderSelect.innerHTML='<option value="">Select loader…</option>'+loaders.map(x=>`<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join("");ui.loaderSelect.value=localStorage.getItem(KEYS.loader)||""}catch(e){ui.loaderSelect.innerHTML='<option value="">Could not load loaders</option>';ui.loginMessage.textContent=e.message}}
async function login(e){e.preventDefault();const loaderId=ui.loaderSelect.value,pin=ui.pin.value;if(!loaderId||!pin){ui.loginMessage.textContent="Select your name and enter your PIN.";return}ui.loginButton.disabled=true;ui.loginMessage.textContent="";try{const data=await api("login",{loaderId,pin});if(!data.success)throw new Error(data.message||"Sign-in failed.");session={sessionId:data.sessionId,loaderId:data.loaderId,loaderName:data.loaderName,loginTime:data.loginTime,expiresAt:new Date(new Date(data.loginTime).getTime()+Number(data.sessionHours||9)*3600000).toISOString(),loadStatusAnswered:false};write(KEYS.session,session);localStorage.setItem(KEYS.loader,loaderId);ui.pin.value="";show("load")}catch(e2){ui.loginMessage.textContent=e2.message}finally{ui.loginButton.disabled=false}}
async function recordLoadStatus(answer){ui.loadMessage.textContent="";try{const data=await api("loadStatus",{...session,answer});if(!data.success)throw new Error(data.reason||"Could not save answer.");session.loadStatusAnswered=true;write(KEYS.session,session);openScanner()}catch(e){ui.loadMessage.textContent=e.message}}
async function openScanner(){show("scanner");ui.loaderName.textContent=session.loaderName;ui.location.value="Loader Yard";await loadCache();scheduleExpiry();startScanner();syncQueue()}
function show(page){ui.loginPage.hidden=page!=="login";ui.loadPage.hidden=page!=="load";ui.scannerPage.hidden=page!=="scanner"}

async function startScanner(){if(scannerRunning)return;ui.status.className="scanner-status";ui.status.textContent="Starting camera…";try{const devices=await reader.listVideoInputDevices();if(!devices.length)throw new Error("No camera was found.");const rear=devices.find(x=>/back|rear|environment/i.test(x.label))||devices[devices.length-1];await reader.decodeFromConstraints({video:{deviceId:{exact:rear.deviceId},facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30}},audio:false},ui.video,(result,error)=>{if(result)acceptDecoded(result.getText());if(error&&!(error instanceof ZXing.NotFoundException))console.error(error)});scannerRunning=true;ui.start.hidden=true;ui.status.textContent="Ready — scan carton barcode";cameraTrack=ui.video.srcObject?.getVideoTracks?.()[0]||null;const caps=cameraTrack?.getCapabilities?.()||{};ui.flash.hidden=!caps.torch}catch(e){scannerRunning=false;ui.start.hidden=false;ui.start.textContent="Try Again";ui.status.className="scanner-status error";ui.status.textContent=e.message||"Camera could not start."}}
function acceptDecoded(raw){if(scanLocked)return;const id=normalizeCarton(raw),now=Date.now();if(!/^C\d+$/.test(id)){if(id&&!(id===lastCode&&now-lastScanAt<1800)){lastCode=id;lastScanAt=now;feedback("Unknown barcode",false)}return}if(id===lastCode&&now-lastScanAt<1800)return;lastCode=id;lastScanAt=now;scanLocked=true;activeCarton=id;const known=cartons.get(id);selectedType=known?.cartonType&&CARTON_TYPES.includes(known.cartonType)?known.cartonType:"";ui.cartonId.textContent=id;ui.knownNote.textContent=known?.cartonType?`Known type: ${known.cartonType}`:"New carton — select a type";ui.cartonCard.hidden=false;renderTypes();ui.save.disabled=!selectedType;feedback(`${id} ready to save`,true);beep(true)}
function renderTypes(){ui.types.innerHTML=CARTON_TYPES.map(t=>`<button type="button" class="type-button${t===selectedType?" selected":""}" data-type="${t}">${t}</button>`).join("");ui.types.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{selectedType=b.dataset.type;renderTypes();ui.save.disabled=false}))}
function saveScan(){if(!activeCarton||!selectedType)return;const scan={clientScanId:crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`,cartonId:activeCarton,cartonType:selectedType,location:ui.location.value,scannedAt:new Date().toISOString()};const q=queue();q.push(scan);write(KEYS.queue,q);cartons.set(activeCarton,{...(cartons.get(activeCarton)||{}),cartonId:activeCarton,cartonType:selectedType,location:ui.location.value});saveCache();const saved=activeCarton;activeCarton="";selectedType="";scanLocked=false;ui.cartonCard.hidden=true;feedback(`Saved ${saved} — scan next carton`,true);beep(true);renderSync();syncQueue()}
function normalizeCarton(value){let v=String(value||"").trim().toUpperCase().replace(/\s+/g,"");if(v&&!v.startsWith("C"))v="C"+v;return v}

async function syncQueue() {
  if (
    syncing ||
    !navigator.onLine ||
    !session?.sessionId
  ) {
    return;
  }

  const submitted = queue();

  if (!submitted.length) {
    renderSync();
    return;
  }

  syncing = true;
  renderSync();

  try {
    const data = await api("sync", {
      ...session,
      scans: submitted
    });

    if (data.valid === false) {
      await handleExpiredSession();
      throw new Error(
        data.reason || "Session expired."
      );
    }

    if (!data.success) {
      throw new Error(
        data.reason ||
        data.error ||
        "Sync rejected."
      );
    }

    const results = Array.isArray(data.results)
      ? data.results
      : [];

    const accepted = new Set(
      results
        .filter(result => result.success)
        .map(result => result.clientScanId)
    );

    write(
      KEYS.queue,
      queue().filter(
        scan => !accepted.has(scan.clientScanId)
      )
    );

    const failed = results.filter(
      result => !result.success
    );

    if (failed.length) {
      throw new Error(
        failed[0].error || "Scan rejected."
      );
    }
  } catch (error) {
    console.warn(
      "YardMaster sync paused:",
      error
    );

    ui.status.textContent =
      `SYNC ERROR: ${error.message || "Unknown error"}`;

    ui.status.className =
      "scanner-status error";
  } finally {
    syncing = false;
    renderSync();
  }
}function queue(){const q=read(KEYS.queue,[]);return Array.isArray(q)?q:[]}
function renderSync() {
  const pendingCount = queue().length;

  ui.sync.className =
    "sync-status " +
    (pendingCount ? "warn" : "ok");

  if (syncing) {
    ui.sync.textContent =
      `${pendingCount} syncing…`;
    return;
  }

  if (pendingCount) {
    ui.sync.textContent =
      `${pendingCount} pending — retrying`;
    return;
  }

  ui.sync.textContent = "✓ Synced";
} {
  const pendingCount = queue().length;

  ui.sync.className =
    "sync-status " +
    (pendingCount ? "warn" : "ok");

  if (syncing) {
    ui.sync.textContent =
      `${pendingCount} syncing…`;
    return;
  }

  if (pendingCount) {
    ui.sync.textContent =
      `${pendingCount} pending — retrying`;
    return;
  }

  ui.sync.textContent = "✓ Synced";
} {
  const pendingCount = queue().length;

  ui.sync.className =
    "sync-status " +
    (pendingCount ? "warn" : "ok");

  if (syncing) {
    ui.sync.textContent =
      `${pendingCount} syncing…`;
    return;
  }

  if (pendingCount) {
    ui.sync.textContent =
      `${pendingCount} pending — retrying`;
    return;
  }

  ui.sync.textContent = "✓ Synced";
} {
  const pendingCount = queue().length;

  ui.sync.className =
    "sync-status " +
    (pendingCount ? "warn" : "ok");

  if (syncing) {
    ui.sync.textContent =
      `${pendingCount} syncing…`;
    return;
  }

  if (pendingCount) {
    ui.sync.textContent =
      `${pendingCount} pending — retrying`;
    return;
  }

  ui.sync.textContent = "✓ Synced";
} {
  const pendingCount = queue().length;

  ui.sync.className =
    "sync-status " +
    (pendingCount ? "warn" : "ok");

  if (syncing) {
    ui.sync.textContent =
      `${pendingCount} syncing…`;
    return;
  }

  if (pendingCount) {
    ui.sync.textContent =
      `${pendingCount} pending — retrying`;
    return;
  }

  ui.sync.textContent = "✓ Synced";
}{const n=queue().length;ui.sync.className="sync-status "+(n?"warn":"ok");ui.sync.textContent=syncing?`${n} syncing…`:n?`${n} pending`:"✓ Synced"}
async function loadCache(){const local=read(KEYS.cache,{cartons:[]});applyCache(local.cartons||[]);if(!navigator.onLine){renderSync();return}await refreshCache();clearInterval(cacheTimer);cacheTimer=setInterval(refreshCache,60000)}
async function refreshCache(){try{const data=await api("cartonCache",session);if(data.valid===false)return handleExpiredSession();applyCache(data.cartons||[]);write(KEYS.cache,{savedAt:new Date().toISOString(),cartons:data.cartons||[]})}catch(e){console.warn("Carton cache refresh paused:",e)}}
function applyCache(items){cartons=new Map(items.map(x=>[normalizeCarton(x.cartonId),x]))}function saveCache(){write(KEYS.cache,{savedAt:new Date().toISOString(),cartons:[...cartons.values()]})}

async function signOut(){if(queue().length){showPendingBlock();return}stopScanner();try{await api("logout",session)}catch(e){console.warn(e)}clearSession();await loadLoaders()}
function showPendingBlock(){const n=queue().length;ui.pendingMessage.textContent=`${n} scan${n===1?" is":"s are"} waiting to sync. Sign out is blocked until ${n===1?"it has":"they have"} synced.`;ui.pendingDialog.showModal()}
function scheduleExpiry(){clearTimeout(expiryTimer);const delay=Math.max(0,new Date(session.expiresAt).getTime()-Date.now());expiryTimer=setTimeout(checkExpiry,Math.min(delay,2147483647))}
async function checkExpiry(){if(!session||Date.now()<new Date(session.expiresAt).getTime()){scheduleExpiry();return}if(queue().length){await syncQueue();if(queue().length){setTimeout(checkExpiry,15000);return}}stopScanner();try{await api("expire",session)}catch(e){}clearSession();await loadLoaders()}
async function handleExpiredSession(){if(queue().length)return;stopScanner();clearSession();await loadLoaders()}
function clearSession(){session=null;localStorage.removeItem(KEYS.session);clearInterval(cacheTimer);clearTimeout(expiryTimer)}
function stopScanner(){if(scannerRunning)reader.reset();scannerRunning=false;cameraTrack=null;ui.flash.hidden=true}
async function toggleTorch(){if(!cameraTrack)return;try{torch=!torch;await cameraTrack.applyConstraints({advanced:[{torch}]});ui.flash.classList.toggle("active",torch)}catch(e){torch=false}}
function feedback(message,success){ui.status.textContent=message;ui.status.className=`scanner-status ${success?"success":"error"}`;if(navigator.vibrate)navigator.vibrate(success?80:[100,80,100])}
function beep(ok){try{const C=window.AudioContext||window.webkitAudioContext,c=new C(),o=c.createOscillator(),g=c.createGain();o.frequency.value=ok?1050:240;g.gain.value=.08;o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.09)}catch(e){}}
async function api(action,payload={}){if(API_URL.startsWith("PASTE_"))throw new Error("The YardMaster API URL has not been added yet.");const response=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action,...payload})});if(!response.ok)throw new Error("Could not reach YardMaster.");return response.json()}
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch(e){return fallback}}function write(key,value){localStorage.setItem(key,JSON.stringify(value))}function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]))}
