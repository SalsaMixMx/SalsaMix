/* ---------------- STATE ---------------- */
let clients = [];
let notes = [];
let payments = [];
let catalog = [];
let inventoryMovements = [];
let visits = [];
let purchases = [];
let sellers = [];
let loaded = false;
let currentUser = null;
let currentProfile = null;
let deferredInstallPrompt = null;
let unsubscribeCloud = null;
let unsubscribeUsers = null;
let syncState = 'idle'; // idle | cached | syncing | online | offline

const state = {
  tab: 'clientes',
  clientDetailId: null,
  routeDay: 'todos',
  search: '',
  topMenuOpen: false,
  selectedSellerId: null,
  smartRoute: null, // {day, ids, chunks, currentChunk}
  clientMap: null,
  modal: null, // {type, payload}
};

const DAY_LABELS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const DAY_SHORT = ['L','M','M','J','V','S','D'];

function todayISO(){ return new Date().toISOString().slice(0,10); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(n){
  n = Number(n) || 0;

  return 'MX$' + n.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'});
}
function paymentMethodLabel(method){
  const labels = {
    efectivo: 'Efectivo',
    transferencia: 'Transferencia',
    tarjeta: 'Tarjeta'
  };
  return labels[method] || 'Método no especificado';
}
function noteFolio(note){
  if(note?.folio) return note.folio;
  const year=(note?.date||todayISO()).slice(0,4) || String(new Date().getFullYear());
  const source=String(note?.id||'').replace(/[^a-z0-9]/gi,'').toUpperCase();
  const suffix=(source.slice(-6)||'000001').padStart(6,'0');
  const prefix=isConsignmentNote(note) ? 'C' : (note?.fulfillmentStatus==='pedido' ? 'P' : 'V');
  return `${prefix}-${year}-${suffix}`;
}
function nextNoteFolio(data){
  const year=(data.date||todayISO()).slice(0,4);
  const prefix=data.saleType==='consignacion' ? 'C' : (data.fulfillmentStatus==='pedido' ? 'P' : 'V');
  const used=notes
    .filter(n=>(n.date||'').startsWith(year))
    .map(n=>String(n.folio||''))
    .filter(f=>f.startsWith(prefix+'-'+year+'-'))
    .map(f=>Number(f.split('-').pop())||0);
  const next=(Math.max(0,...used)+1).toString().padStart(6,'0');
  return `${prefix}-${year}-${next}`;
}
function formatTicketDate(note){
  const source=note?.createdAt || note?.createdAtISO || (note?.date ? `${note.date}T12:00:00` : new Date().toISOString());
  return new Date(source).toLocaleString('es-MX',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function mondayIndexToday(){ const j = new Date().getDay(); return j===0?6:j-1; }

/* ---------------- AUTENTICACIÓN ---------------- */
function currentActor(){
  return {
    userId: currentUser ? currentUser.uid : null,
    userEmail: currentUser ? (currentUser.email || '') : '',
    userName: currentProfile ? (currentProfile.name || currentProfile.email || 'Usuario') : 'Usuario',
    userRole: currentProfile ? (currentProfile.role || 'vendedor') : 'vendedor',
  };
}
function isAdmin(){ return currentProfile && currentProfile.role === 'admin'; }
function sellerById(uid){ return sellers.find(s=>s.uid===uid); }
function sellerName(uid){
  const seller = sellerById(uid);
  return seller ? (seller.name || seller.email || 'Vendedor') : 'Sin asignar';
}
function visibleClients(){
  if(isAdmin()) return clients;
  return clients.filter(c=>c.assignedTo===currentUser?.uid || (!c.assignedTo && c.createdBy===currentUser?.uid));
}
function visibleClientIds(){ return new Set(visibleClients().map(c=>c.id)); }
function visibleNotes(){
  if(isAdmin()) return notes;
  const ids=visibleClientIds();
  return notes.filter(n=>ids.has(n.clientId) || n.createdBy===currentUser?.uid);
}
function visiblePayments(){
  if(isAdmin()) return payments;
  const ids=visibleClientIds();
  return payments.filter(p=>ids.has(p.clientId) || p.createdBy===currentUser?.uid);
}
function canAccessClient(id){ return isAdmin() || visibleClientIds().has(id); }

function actorFields(prefix='created'){
  const actor = currentActor();
  return {
    [`${prefix}By`]: actor.userId,
    [`${prefix}ByName`]: actor.userName,
    [`${prefix}ByEmail`]: actor.userEmail,
    [`${prefix}At`]: new Date().toISOString(),
  };
}
function renderAuth(){
  const root = document.getElementById('auth-root');
  const shell = document.getElementById('shell');
  if(currentUser && currentProfile){
    root.innerHTML='';
    shell.style.display='flex';
    return;
  }
  shell.style.display='none';
  root.innerHTML=`<div class="auth-screen">
    <div class="auth-card">
      <div class="auth-brand"><img src="assets/img/logo-full2.png" alt="SalsaMix - Pruébala con todo" class="auth-logo"></div>
      <div class="auth-title">Iniciar sesión</div>
      <div class="auth-subtitle">Accede con la cuenta asignada a tu vendedor.</div>
      <form onsubmit="submitLogin(event)">
        <label>Correo electrónico</label>
        <input id="login-email" type="email" autocomplete="username" required placeholder="vendedor@empresa.com">
        <label>Contraseña</label>
        <input id="login-password" type="password" autocomplete="current-password" required minlength="6" placeholder="••••••••">
        <div id="login-error" class="auth-error"></div>
        <button id="login-button" class="btn btn-primary btn-block" type="submit" style="margin-top:14px;">Entrar</button>
        <button class="btn btn-outline btn-block" type="button" style="margin-top:8px;" onclick="requestPasswordReset()">Olvidé mi contraseña</button>
      </form>
      <div class="auth-help">Las cuentas se crean desde Firebase Authentication. La primera cuenta administradora es <strong>josegonzalezcarrillo88@gmail.com</strong>.</div>
    </div>
  </div>`;
}
async function submitLogin(event){
  event.preventDefault();
  const email=document.getElementById('login-email').value.trim();
  const password=document.getElementById('login-password').value;
  const button=document.getElementById('login-button');
  const errorBox=document.getElementById('login-error');
  button.disabled=true; button.textContent='Entrando...'; errorBox.style.display='none';
  try{
    await window.firebaseAuth.login(email,password);
  }catch(error){
    const messages={
      'auth/invalid-credential':'Correo o contraseña incorrectos.',
      'auth/user-disabled':'Esta cuenta está desactivada.',
      'auth/too-many-requests':'Demasiados intentos. Espera unos minutos.',
      'auth/network-request-failed':'No hay conexión a internet.'
    };
    errorBox.textContent=messages[error.code]||'No se pudo iniciar sesión.';
    errorBox.style.display='block';
  }finally{
    button.disabled=false; button.textContent='Entrar';
  }
}
async function requestPasswordReset(){
  const email=(document.getElementById('login-email')?.value||'').trim();
  if(!email){ showToast('Escribe primero tu correo'); return; }
  try{ await window.firebaseAuth.resetPassword(email); showToast('Enviamos el enlace de recuperación'); }
  catch(error){ showToast('No se pudo enviar el enlace'); }
}
async function logoutUser(){
  try{ await window.firebaseAuth.logout(); }
  catch(error){ showToast('No se pudo cerrar la sesión'); }
}

/* ---------------- STORAGE / FIREBASE ---------------- */
const STORAGE_KEYS = {
  clients: 'clients-data',
  notes: 'notes-data',
  payments: 'payments-data',
  catalog: 'catalog-data',
  inventoryMovements: 'inventory-movements-data',
  visits: 'visits-data',
  purchases: 'purchases-data',
};

function scopedStorageKey(key){
  const uid=currentUser?.uid || 'anonymous';
  return `salsamix:${uid}:${key}`;
}

async function readLegacyValue(key){
  try{
    if(window.storage && typeof window.storage.get === 'function'){
      const result = await window.storage.get(key);
      if(result && result.value) return JSON.parse(result.value);
    }
  }catch(e){ console.warn('No se pudo leer window.storage:', key, e); }
  try{
    const scoped=localStorage.getItem(scopedStorageKey(key));
    if(scoped) return JSON.parse(scoped);
    if(isAdmin()){
      const legacy=localStorage.getItem(key);
      return legacy ? JSON.parse(legacy) : [];
    }
    return [];
  }catch(e){ return []; }
}

function saveLocalBackup(key, value){
  try{ localStorage.setItem(scopedStorageKey(key), JSON.stringify(value)); }catch(e){}
}


async function loadLocalSnapshot(){
  const values = await Promise.all([
    readLegacyValue(STORAGE_KEYS.clients),
    readLegacyValue(STORAGE_KEYS.notes),
    readLegacyValue(STORAGE_KEYS.payments),
    readLegacyValue(STORAGE_KEYS.catalog),
    readLegacyValue(STORAGE_KEYS.inventoryMovements),
    readLegacyValue(STORAGE_KEYS.visits),
    readLegacyValue(STORAGE_KEYS.purchases),
  ]);
  [clients, notes, payments, catalog, inventoryMovements, visits, purchases] = values;
  loaded = true;
  syncState = 'cached';
}

function persistCurrentSnapshot(){
  saveLocalBackup(STORAGE_KEYS.clients, clients);
  saveLocalBackup(STORAGE_KEYS.notes, notes);
  saveLocalBackup(STORAGE_KEYS.payments, payments);
  saveLocalBackup(STORAGE_KEYS.catalog, catalog);
  saveLocalBackup(STORAGE_KEYS.inventoryMovements, inventoryMovements);
  saveLocalBackup(STORAGE_KEYS.visits, visits);
  saveLocalBackup(STORAGE_KEYS.purchases, purchases);
}

function applyCloudUpdate(data){
  if(data.clients) clients = data.clients;
  if(data.notes) notes = data.notes;
  if(data.payments) payments = data.payments;
  if(data.catalog) catalog = data.catalog;
  if(data.inventoryMovements) inventoryMovements = data.inventoryMovements;
  if(data.visits) visits = data.visits;
  if(data.purchases) purchases = data.purchases;
  persistCurrentSnapshot();
  syncState = 'online';
  if(loaded) renderApp();
}

async function syncCloudInBackground(){
  syncState = 'syncing';
  if(loaded) renderHeader();
  try{
    await window.firebaseReady;
    const [cloud, profiles] = await Promise.all([
      window.firebaseStore.loadAll(),
      window.firebaseStore.loadUsers(),
    ]);
    sellers = profiles || [];
    const cloudHasData = Object.values(cloud.exists || {}).some(Boolean);

    if(cloudHasData){
      applyCloudUpdate({
        clients: cloud.clients || [], notes: cloud.notes || [], payments: cloud.payments || [],
        catalog: cloud.catalog || [], inventoryMovements: cloud.inventoryMovements || [], visits: cloud.visits || [],
      });
    }else{
      await window.firebaseStore.saveAll({clients, notes, payments, catalog, inventoryMovements, visits});
      syncState = 'online';
    }

    if(unsubscribeCloud) unsubscribeCloud();
    if(unsubscribeUsers) unsubscribeUsers();
    unsubscribeCloud = window.firebaseStore.subscribe(applyCloudUpdate);
    unsubscribeUsers = window.firebaseStore.subscribeUsers((profiles)=>{
      sellers = profiles;
      syncState = 'online';
      if(loaded) renderApp();
    });
    persistCurrentSnapshot();
    if(loaded) renderApp();
  }catch(e){
    console.error(e);
    syncState = 'offline';
    if(loaded){ renderHeader(); showToast('Mostrando datos guardados; sincronizaremos al recuperar conexión'); }
  }
}

async function loadAll(){
  // Muestra primero el último respaldo local para que la app abra de inmediato.
  await loadLocalSnapshot();
  renderApp();
  // Firebase se actualiza sin bloquear la interfaz.
  syncCloudInBackground();
}

async function saveCollection(name, value, localKey){
  // El cambio se guarda de inmediato en el dispositivo.
  saveLocalBackup(localKey, value);
  syncState = navigator.onLine ? 'syncing' : 'offline';
  if(loaded) renderHeader();
  try{
    await window.firebaseReady;
    await window.firebaseStore.save(name, value);
    syncState = 'online';
  }catch(e){
    console.error(e);
    syncState = 'offline';
    showToast('Cambio guardado en este dispositivo; falta sincronizar');
  }
  if(loaded) renderHeader();
}
async function saveClients(){ return saveCollection('clients', clients, STORAGE_KEYS.clients); }
async function saveNotes(){ return saveCollection('notes', notes, STORAGE_KEYS.notes); }
async function savePayments(){ return saveCollection('payments', payments, STORAGE_KEYS.payments); }
async function saveCatalog(){ return saveCollection('catalog', catalog, STORAGE_KEYS.catalog); }
async function saveInventoryMovements(){ return saveCollection('inventoryMovements', inventoryMovements, STORAGE_KEYS.inventoryMovements); }
async function saveVisits(){ return saveCollection('visits', visits, STORAGE_KEYS.visits); }
async function savePurchases(){ return saveCollection('purchases', purchases, STORAGE_KEYS.purchases); }

function showToast(msg){
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast">${esc(msg)}</div>`;
  setTimeout(()=>{ if(root.firstChild) root.innerHTML=''; }, 2200);
}

/* ---------------- DATA HELPERS ---------------- */
function getClient(id){ return clients.find(c=>c.id===id); }
function isDeliveredNote(note){ return note.fulfillmentStatus !== 'pedido'; }
function isConsignmentNote(note){ return note.saleType === 'consignacion'; }
function isCollectableNote(note){ return isDeliveredNote(note) && !isConsignmentNote(note); }
function clientTypeLabel(type){ return type==='punto_venta' ? 'Punto de venta' : 'Cliente'; }

function notesFor(id){ return notes.filter(n=>n.clientId===id).sort((a,b)=> b.date.localeCompare(a.date)); }
function paymentsFor(id){ return payments.filter(p=>p.clientId===id).sort((a,b)=> b.date.localeCompare(a.date)); }
function balanceFor(id){
  const collectableNotes = notes.filter(n=>n.clientId===id && isCollectableNote(n));
  const totalVentas = collectableNotes.reduce((s,n)=>s+n.total,0);
  const totalPagadoVenta = collectableNotes.reduce((s,n)=>s+(n.paid||0),0);
  const totalAbonos = payments.filter(p=>p.clientId===id).reduce((s,p)=>s+p.amount,0);
  return Math.round((totalVentas - totalPagadoVenta - totalAbonos)*100)/100;
}
function productStock(product){ return Math.max(0, Number(product && product.stock)||0); }
function productMinStock(product){ return Math.max(0, Number(product && product.minStock)||0); }
function stockStatus(product){
  const stock = productStock(product);
  if(stock<=0) return {label:'Agotado', color:'var(--red)', bg:'var(--red-bg)'};
  if(stock<=productMinStock(product)) return {label:'Stock bajo', color:'var(--gold-dark)', bg:'#F8E8C7'};
  return {label:'Disponible', color:'var(--green)', bg:'var(--green-bg)'};
}
function getStockShortages(items){
  return (items||[]).map(item=>{
    if(!item.catalogId) return null;
    const product = catalog.find(p=>p.id===item.catalogId);
    if(!product) return null;
    const requested = Number(item.qty)||0;
    const available = productStock(product);
    return requested>available ? {product, requested, available} : null;
  }).filter(Boolean);
}
function addInventoryMovement(productId, type, quantity, details={}){
  inventoryMovements.push({ id:uid(), productId, type, quantity:Number(quantity)||0, date:details.date||todayISO(), createdAt:new Date().toISOString(), noteId:details.noteId||null, reason:details.reason||'', sellerId:currentUser?.uid||null, ...actorFields('created') });
}
function applyInventorySale(items, noteId, date){
  (items||[]).forEach(item=>{
    if(!item.catalogId) return;
    const product = catalog.find(p=>p.id===item.catalogId);
    if(!product) return;
    const qty = Number(item.qty)||0;
    product.stock = Math.max(0, productStock(product)-qty);
    addInventoryMovement(product.id, 'venta', -qty, {noteId, date, reason:'Salida por venta'});
  });
  saveCatalog(); saveInventoryMovements();
}
function restoreInventorySale(items, noteId, date){
  (items||[]).forEach(item=>{
    if(!item.catalogId) return;
    const product = catalog.find(p=>p.id===item.catalogId);
    if(!product) return;
    const qty = Number(item.qty)||0;
    product.stock = productStock(product)+qty;
    addInventoryMovement(product.id, 'cancelacion', qty, {noteId, date, reason:'Devolución por nota eliminada'});
  });
  saveCatalog(); saveInventoryMovements();
}
function totalAdeudoGlobal(){ return clients.reduce((s,c)=>s+Math.max(0,balanceFor(c.id)),0); }

/* Calcula, por cliente, cómo se van cubriendo sus notas más antiguas con los abonos
   generales que ha hecho, para que una nota se marque "Pagada" en cuanto su saldo
   quede cubierto (ya sea porque se pagó al momento o porque un abono posterior la cubrió). */
function computeEffectiveNoteStatuses(){
  const map = new Map();
  const deliveredNotes = notes.filter(isCollectableNote);
  const clientIds = Array.from(new Set(deliveredNotes.map(n=>n.clientId)));
  clientIds.forEach(cid=>{
    const clientNotes = deliveredNotes.filter(n=>n.clientId===cid).slice().sort((a,b)=> a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let pool = payments.filter(p=>p.clientId===cid).reduce((s,p)=>s+(Number(p.amount)||0),0);
    clientNotes.forEach(n=>{
      const basePaid = Number(n.paid)||0;
      let remaining = Math.round((n.total - basePaid)*100)/100;
      let allocated = 0;
      if(remaining>0.004 && pool>0.004){
        allocated = Math.min(pool, remaining);
        pool = Math.round((pool-allocated)*100)/100;
        remaining = Math.round((remaining-allocated)*100)/100;
      }
      const totalPaid = Math.round((basePaid+allocated)*100)/100;
      let status = 'pendiente';
      if(remaining<=0.004) status = 'pagada';
      else if(totalPaid>0.004) status = 'parcial';
      map.set(n.id, { allocated: Math.max(0,allocated), totalPaid, saldo: Math.max(0,remaining), status });
    });
  });
  return map;
}

/* ---------------- GPS DE CLIENTES ---------------- */
function hasClientLocation(client){
  return !!(client && Number.isFinite(Number(client.locationLat)) && Number.isFinite(Number(client.locationLng)));
}
function clientLocationStatus(client){
  return hasClientLocation(client) ? 'Ubicación guardada' : 'Sin ubicación registrada';
}
function saveClientLocation(clientId){
  const client = getClient(clientId);
  if(!client){ showToast('Cliente no encontrado'); return; }
  if(!navigator.geolocation){ showToast('Este dispositivo no permite obtener ubicación'); return; }
  showToast('Obteniendo ubicación…');
  navigator.geolocation.getCurrentPosition(position=>{
    client.locationLat = Number(position.coords.latitude);
    client.locationLng = Number(position.coords.longitude);
    client.locationAccuracy = Math.round(Number(position.coords.accuracy)||0);
    client.locationUpdatedAt = new Date().toISOString();
    Object.assign(client, actorFields('updated'));
    saveClients();
    renderApp();
    showToast('Ubicación guardada');
  }, error=>{
    const messages = {
      1:'Debes permitir el acceso a la ubicación',
      2:'No se pudo obtener la ubicación',
      3:'La ubicación tardó demasiado; intenta otra vez',
    };
    showToast(messages[error.code] || 'No se pudo guardar la ubicación');
  }, { enableHighAccuracy:true, timeout:15000, maximumAge:0 });
}
function getCurrentLocationForRoute(){
  return new Promise((resolve, reject)=>{
    if(!navigator.geolocation){ reject(new Error('Geolocalización no disponible')); return; }
    navigator.geolocation.getCurrentPosition(position=>{
      resolve({
        lat: Number(position.coords.latitude),
        lng: Number(position.coords.longitude),
      });
    }, reject, { enableHighAccuracy:true, timeout:15000, maximumAge:0 });
  });
}
async function openClientMap(clientId){
  const client = getClient(clientId);
  if(!hasClientLocation(client)){ showToast('Este cliente no tiene ubicación guardada'); return; }
  const destination = `${Number(client.locationLat)},${Number(client.locationLng)}`;
  showToast('Obteniendo tu ubicación actual…');
  let url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving&dir_action=navigate`;
  try{
    const current = await getCurrentLocationForRoute();
    const origin = `${current.lat},${current.lng}`;
    url += `&origin=${encodeURIComponent(origin)}`;
  }catch(error){
    showToast('No se pudo obtener tu ubicación; Google Maps elegirá el punto de inicio');
  }
  window.open(url, '_blank', 'noopener');
}
function locatedRouteClients(){
  let list;
  if(state.routeDay==='todos') list = visibleClients().slice();
  else if(state.routeDay==='sin') list = visibleClients().filter(c => !c.days || c.days.length===0);
  else list = visibleClients().filter(c => (c.days||[]).includes(Number(state.routeDay)));
  return list.filter(hasClientLocation);
}
async function openSelectedRouteMap(){
  const list = locatedRouteClients();
  if(!list.length){ showToast('No hay clientes con ubicación en esta ruta'); return; }
  if(list.length===1){ openClientMap(list[0].id); return; }
  const stops = list.slice(0,10);
  const destinationClient = stops[stops.length-1];
  const destination = `${Number(destinationClient.locationLat)},${Number(destinationClient.locationLng)}`;
  const waypoints = stops.slice(0,-1).map(c=>`${Number(c.locationLat)},${Number(c.locationLng)}`).join('|');
  showToast('Obteniendo tu ubicación actual…');
  let url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving&dir_action=navigate`;
  if(waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
  try{
    const current = await getCurrentLocationForRoute();
    const origin = `${current.lat},${current.lng}`;
    url += `&origin=${encodeURIComponent(origin)}`;
  }catch(error){
    showToast('No se pudo obtener tu ubicación; Google Maps elegirá el punto de inicio');
  }
  window.open(url, '_blank', 'noopener');
}

/* ---------------- RUTAS INTELIGENTES ---------------- */
function selectedRouteClients(){
  let list;
  if(state.routeDay==='todos') list=visibleClients().slice();
  else if(state.routeDay==='sin') list=visibleClients().filter(c=>!c.days || c.days.length===0);
  else list=visibleClients().filter(c=>(c.days||[]).includes(Number(state.routeDay)));
  return list;
}
function distanceKm(aLat,aLng,bLat,bLng){
  const toRad=value=>value*Math.PI/180;
  const earth=6371;
  const dLat=toRad(bLat-aLat), dLng=toRad(bLng-aLng);
  const x=Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
  return earth*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function nearestNeighborOrder(clients,start){
  const remaining=clients.slice();
  const ordered=[];
  let current={lat:start.lat,lng:start.lng};
  while(remaining.length){
    let bestIndex=0, bestDistance=Infinity;
    remaining.forEach((client,index)=>{
      const distance=distanceKm(current.lat,current.lng,Number(client.locationLat),Number(client.locationLng));
      if(distance<bestDistance){bestDistance=distance;bestIndex=index;}
    });
    const next=remaining.splice(bestIndex,1)[0];
    ordered.push(next);
    current={lat:Number(next.locationLat),lng:Number(next.locationLng)};
  }
  return ordered;
}
function buildRouteChunks(clients,size=4){
  const chunks=[];
  for(let i=0;i<clients.length;i+=size) chunks.push(clients.slice(i,i+size).map(c=>c.id));
  return chunks;
}
async function optimizeSelectedRoute(){
  const eligible=selectedRouteClients().filter(c=>hasClientLocation(c) && clientVisitStatus(c.id).key!=='visitado');
  if(!eligible.length){showToast('No hay clientes pendientes con ubicación guardada');return;}
  showToast('Obteniendo tu ubicación y ordenando la ruta…');
  try{
    const current=await getCurrentLocationForRoute();
    const ordered=nearestNeighborOrder(eligible,current);
    state.smartRoute={day:state.routeDay,ids:ordered.map(c=>c.id),chunks:buildRouteChunks(ordered),currentChunk:0,origin:current};
    document.getElementById('app').innerHTML=renderRutasTab();
    showToast('Recorrido optimizado');
  }catch(error){showToast('No se pudo obtener tu ubicación actual');}
}
function clearSmartRoute(){state.smartRoute=null;document.getElementById('app').innerHTML=renderRutasTab();}
function smartRouteClients(){
  if(!state.smartRoute || state.smartRoute.day!==state.routeDay) return [];
  return state.smartRoute.ids.map(id=>getClient(id)).filter(Boolean).filter(c=>clientVisitStatus(c.id).key!=='visitado');
}
async function openSmartRouteChunk(index){
  const route=state.smartRoute;
  if(!route || !route.chunks[index]){showToast('No hay otra parte de la ruta');return;}
  const clients=route.chunks[index].map(id=>getClient(id)).filter(c=>hasClientLocation(c) && clientVisitStatus(c.id).key!=='visitado');
  if(!clients.length){showToast('Esta parte de la ruta ya fue completada');return;}
  const destinationClient=clients[clients.length-1];
  const destination=`${Number(destinationClient.locationLat)},${Number(destinationClient.locationLng)}`;
  const waypoints=clients.slice(0,-1).map(c=>`${Number(c.locationLat)},${Number(c.locationLng)}`).join('|');
  let url=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving&dir_action=navigate`;
  if(waypoints) url+=`&waypoints=${encodeURIComponent(waypoints)}`;
  try{
    const current=await getCurrentLocationForRoute();
    url+=`&origin=${encodeURIComponent(`${current.lat},${current.lng}`)}`;
  }catch(error){}
  route.currentChunk=index;
  window.open(url,'_blank','noopener');
}
function openCurrentSmartRoute(){openSmartRouteChunk(state.smartRoute?.currentChunk||0);}
function openNextSmartRoute(){
  if(!state.smartRoute){showToast('Primero optimiza el recorrido');return;}
  const next=(state.smartRoute.currentChunk||0)+1;
  if(next>=state.smartRoute.chunks.length){showToast('No hay otra parte de la ruta');return;}
  openSmartRouteChunk(next);
}

/* ---------------- CONTROL DE VISITAS ---------------- */
function visitSellerMatches(visit){
  return isAdmin() || visit.sellerId===currentUser?.uid;
}
function visitsForClient(clientId){
  return visits.filter(v=>v.clientId===clientId && visitSellerMatches(v));
}
function todayVisitForClient(clientId){
  const today=todayISO();
  return visitsForClient(clientId)
    .filter(v=>v.date===today)
    .sort((a,b)=>(b.startedAt||'').localeCompare(a.startedAt||''))[0] || null;
}
function activeVisitForCurrentUser(){
  return visits.find(v=>v.status==='en_visita' && v.sellerId===currentUser?.uid) || null;
}
function clientVisitStatus(clientId){
  const visit=todayVisitForClient(clientId);
  if(!visit) return {key:'pendiente',label:'Pendiente',icon:'⚪'};
  if(visit.status==='en_visita') return {key:'en_visita',label:'En visita',icon:'🟡'};
  return {key:'visitado',label:'Visitado',icon:'🟢'};
}
function formatClock(iso){
  if(!iso) return '';
  return new Date(iso).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
}
function visitDurationMinutes(visit){
  if(!visit?.startedAt) return 0;
  const end=visit.endedAt ? new Date(visit.endedAt) : new Date();
  return Math.max(0,Math.round((end-new Date(visit.startedAt))/60000));
}
function formatMinutes(total){
  total=Math.max(0,Number(total)||0);
  const h=Math.floor(total/60), m=total%60;
  return h ? `${h} h ${m} min` : `${m} min`;
}
async function startVisit(clientId){
  const client=getClient(clientId);
  if(!client){ showToast('Cliente no encontrado'); return; }
  const existing=todayVisitForClient(clientId);
  if(existing?.status==='en_visita'){ showToast('La visita ya está iniciada'); return; }
  const other=activeVisitForCurrentUser();
  if(other && other.clientId!==clientId){
    const otherClient=getClient(other.clientId);
    showToast(`Finaliza primero la visita de ${otherClient?.name||'otro cliente'}`);
    return;
  }
  const visit={
    id:uid(), clientId, date:todayISO(), status:'en_visita',
    startedAt:new Date().toISOString(), endedAt:null, observations:'',
    sellerId:currentUser?.uid||null, sellerName:currentProfile?.name||currentUser?.email||'Usuario',
    ...actorFields('created')
  };
  try{
    const location=await getCurrentLocationForRoute();
    visit.startLocation={lat:location.lat,lng:location.lng};
  }catch(error){}
  visits.push(visit);
  saveVisits(); renderApp(); showToast('Visita iniciada');
}
function openFinishVisit(clientId){
  const visit=todayVisitForClient(clientId);
  if(!visit || visit.status!=='en_visita'){ showToast('No hay una visita activa'); return; }
  openModal('visitFinish',{visitId:visit.id,observations:visit.observations||''});
}
function modalVisitFinish(){
  const p=state.modal.payload;
  const visit=visits.find(v=>v.id===p.visitId);
  const client=visit?getClient(visit.clientId):null;
  if(!visit) return `<div class="empty">Visita no encontrada.</div>`;
  return `<div class="modal-title"><span>Finalizar visita</span><button onclick="closeModal()">✕</button></div>
    <div class="card"><div class="name">${esc(client?.name||'Cliente')}</div><div class="meta">Inicio: ${formatClock(visit.startedAt)} · ${formatMinutes(visitDurationMinutes(visit))}</div></div>
    <label>Observaciones</label><textarea id="visit-observations" placeholder="Ej. Cliente cerrado, realizó pedido, próxima visita…">${esc(p.observations||'')}</textarea>
    <div class="btnrow"><button class="btn btn-primary btn-block" onclick="submitFinishVisit()">Finalizar visita</button></div>`;
}
async function submitFinishVisit(){
  const visit=visits.find(v=>v.id===state.modal.payload.visitId);
  if(!visit) return;
  visit.status='visitado';
  visit.endedAt=new Date().toISOString();
  visit.observations=(document.getElementById('visit-observations')?.value||'').trim();
  try{
    const location=await getCurrentLocationForRoute();
    visit.endLocation={lat:location.lat,lng:location.lng};
  }catch(error){}
  Object.assign(visit,actorFields('updated'));
  saveVisits(); closeModal(); renderApp(); showToast('Visita finalizada');
}
function routeVisitSummary(list){
  const today=todayISO();
  const ids=new Set(list.map(c=>c.id));
  const dayVisits=visits.filter(v=>v.date===today && ids.has(v.clientId) && visitSellerMatches(v));
  const visitedIds=new Set(dayVisits.filter(v=>v.status==='visitado').map(v=>v.clientId));
  const activeIds=new Set(dayVisits.filter(v=>v.status==='en_visita').map(v=>v.clientId));
  const delivered=visibleNotes().filter(n=>n.date===today && ids.has(n.clientId) && isCollectableNote(n));
  const dayPayments=visiblePayments().filter(p=>p.date===today && ids.has(p.clientId));
  return {
    scheduled:list.length,
    visited:visitedIds.size,
    active:activeIds.size,
    pending:Math.max(0,list.length-visitedIds.size-activeIds.size),
    sales:delivered.reduce((s,n)=>s+(Number(n.total)||0),0),
    collections:dayPayments.reduce((s,p)=>s+(Number(p.amount)||0),0),
    minutes:dayVisits.filter(v=>v.status==='visitado').reduce((s,v)=>s+visitDurationMinutes(v),0),
  };
}
function visitStatusBadge(clientId){
  const status=clientVisitStatus(clientId);
  const styles={pendiente:'background:#EEE7DA;color:var(--ink-light);',en_visita:'background:#F8E8C7;color:var(--gold-dark);',visitado:'background:var(--green-bg);color:var(--green);'};
  return `<span class="badge" style="${styles[status.key]}">${status.icon} ${status.label}</span>`;
}
function visitActionButtons(clientId){
  const status=clientVisitStatus(clientId);
  if(status.key==='en_visita') return `<button class="btn btn-primary btn-sm" onclick="openFinishVisit('${clientId}')">Finalizar visita</button>`;
  if(status.key==='visitado') return `<span class="badge" style="background:var(--green-bg);color:var(--green);padding:7px 10px;">🟢 Visitado hoy</span>`;
  return `<button class="btn btn-primary btn-sm" onclick="startVisit('${clientId}')">Iniciar visita</button>`;
}
function modalVisitPrompt(){
  const p=state.modal.payload;
  const client=getClient(p.clientId);
  return `<div class="modal-title"><span>Registrar visita</span><button onclick="leaveClientWithoutVisit()">✕</button></div>
    <div style="font-size:14px;line-height:1.5;">¿Deseas iniciar una visita a <strong>${esc(client?.name||'este cliente')}</strong> antes de salir?</div>
    <div class="btnrow"><button class="btn btn-outline btn-block" onclick="leaveClientWithoutVisit()">Salir sin registrar</button><button class="btn btn-primary btn-block" onclick="startVisitFromPrompt('${p.clientId}')">Iniciar visita</button></div>`;
}
function leaveClientWithoutVisit(){ state.modal=null; state.clientDetailId=null; renderModal(); renderApp(); }
function startVisitFromPrompt(clientId){ state.modal=null; startVisit(clientId); }

/* Cuántas unidades y cuánto se ha vendido de cada producto/categoría, usando todas las notas. */
function computeProductStats(){
  const map = new Map();

  catalog.forEach(prod=>{
    map.set('c:'+prod.id, {
      name: prod.name || 'Producto',
      category: prod.category || 'Sin categoría',
      qty: 0,
      revenue: 0,
      lastSale: null,
      clients: new Map(),
    });
  });

  notes.filter(isCollectableNote).forEach(note=>{
    const client = getClient(note.clientId);
    const clientKey = note.clientId || 'cliente-eliminado';
    const clientName = client ? client.name : 'Cliente eliminado';

    (note.items||[]).forEach(item=>{
      let key, name, category;
      if(item.catalogId){
        const prod = catalog.find(c=>c.id===item.catalogId);
        key = 'c:'+item.catalogId;
        name = prod ? prod.name : (item.desc||'Producto');
        category = (prod && prod.category) ? prod.category : 'Sin categoría';
      } else {
        const cleanDesc = (item.desc||'Producto').trim();
        key = 'm:'+cleanDesc.toLowerCase();
        name = cleanDesc;
        category = 'Manual / sin catálogo';
      }

      if(!map.has(key)){
        map.set(key, {
          name,
          category,
          qty: 0,
          revenue: 0,
          lastSale: null,
          clients: new Map(),
        });
      }

      const entry = map.get(key);
      const quantity = Number(item.qty)||0;
      const price = Number(item.price)||0;
      entry.qty += quantity;
      entry.revenue += quantity*price;

      if(note.date && (!entry.lastSale || note.date > entry.lastSale)){
        entry.lastSale = note.date;
      }

      const previous = entry.clients.get(clientKey) || { name: clientName, qty: 0 };
      previous.name = clientName;
      previous.qty += quantity;
      entry.clients.set(clientKey, previous);
    });
  });

  return Array.from(map.values())
    .map(product=>({
      ...product,
      clients: Array.from(product.clients.values())
        .filter(client=>client.qty>0)
        .sort((a,b)=>b.qty-a.qty || a.name.localeCompare(b.name)),
    }))
    .sort((a,b)=>b.qty-a.qty || a.name.localeCompare(b.name));
}

function computeCategoryStats(productStats){
  const map = new Map();
  productStats.forEach(p=>{
    if(!map.has(p.category)) map.set(p.category, { category:p.category, qty:0, revenue:0 });
    const e = map.get(p.category);
    e.qty += p.qty; e.revenue += p.revenue;
  });
  return Array.from(map.values()).sort((a,b)=> b.qty-a.qty);
}

/* ---------------- MUTATIONS ---------------- */
function addOrUpdateClient(data, id){
  if(id){
    const c = getClient(id);
    Object.assign(c, data, actorFields('updated'));
  } else {
    clients.push({ id: uid(), createdAt: todayISO(), ...data, assignedTo:data.assignedTo || currentUser?.uid || null, ...actorFields('created') });
  }
  saveClients();
}
function deleteClient(id){
  clients = clients.filter(c=>c.id!==id);
  notes = notes.filter(n=>n.clientId!==id);
  payments = payments.filter(p=>p.clientId!==id);
  saveClients(); saveNotes(); savePayments();
}
function addNote(data){
  const subtotal = data.items.reduce((s,it)=> s + (Number(it.qty)||0)*(Number(it.price)||0), 0);
  const discountPct = Math.min(100, (Number(data.clientDiscountPct)||0) + (Number(data.extraDiscountPct)||0));
  const discountAmount = subtotal * discountPct/100;
  const total = subtotal - discountAmount;
  const client=getClient(data.clientId);
  const note = {
    id: uid(),
    ...data,
    folio: data.folio || nextNoteFolio(data),
    sellerId:data.sellerId || client?.assignedTo || currentUser?.uid || null,
    subtotal: Math.round(subtotal*100)/100,
    discountAmount: Math.round(discountAmount*100)/100,
    total: Math.round(total*100)/100,
    ...actorFields('created'),
  };
  notes.push(note);
  saveNotes();
  return note;
}
function deleteNote(id){
  const note = notes.find(n=>n.id===id);
  if(note && note.inventoryApplied) restoreInventorySale(note.items, note.id, todayISO());
  notes = notes.filter(n=>n.id!==id);
  saveNotes();
}
function addPayment(data){ const client=getClient(data.clientId); payments.push({ id: uid(), ...data, sellerId:data.sellerId || client?.assignedTo || currentUser?.uid || null, ...actorFields('created') }); savePayments(); }
function deletePayment(id){ payments = payments.filter(p=>p.id!==id); savePayments(); }
function addProduct(data){ catalog.push({ id: uid(), cost:0, stock:0, minStock:0, ...data, ...actorFields('created') }); saveCatalog(); }
function updateProduct(id, data){ const p = catalog.find(x=>x.id===id); if(p) Object.assign(p, data, actorFields('updated')); saveCatalog(); }
function deleteProduct(id){ catalog = catalog.filter(p=>p.id!==id); saveCatalog(); }

/* ---------------- ICONS ---------------- */
const ICONS = {
  logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C12 2 4.5 10 4.5 15A7.5 7.5 0 0012 22.5 7.5 7.5 0 0019.5 15C19.5 10 12 2 12 2Z" fill="#E0972E"/><path d="M12 8.2C12 8.2 8.7 12.4 8.7 15.3A3.3 3.3 0 0012 18.6 3.3 3.3 0 0015.3 15.3C15.3 12.4 12 8.2 12 8.2Z" fill="#FBCB6E"/></svg>',
  clientes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="3.4"/><path d="M4.5 20c1-4 4-6 7.5-6s6.5 2 7.5 6"/></svg>',
  rutas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20c3-6 5-2 7-8s3-2 5-8"/><circle cx="4" cy="20" r="1.4"/><circle cx="18" cy="4" r="1.4"/></svg>',
  ventas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  adeudos: `
<svg viewBox="0 0 24 24"
     fill="none"
     stroke="currentColor"
     stroke-width="1.8"
     stroke-linecap="round"
     stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 6.5v11"/>
    <path d="M14.5 8.5c0-1.2-1.1-2-2.5-2s-2.5.8-2.5 2
             c0 3 5 1.8 5 4.8
             c0 1.3-1.1 2.2-2.5 2.2
             s-2.5-.8-2.5-2"/>
</svg>
`,
  reportes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  inventario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 7v10l8 4 8-4V7"/><path d="M12 11v10"/></svg>',
  vendedores: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c.8-4 3.2-6 6-6s5.2 2 6 6"/><path d="M15 15c2.5.2 4.3 1.8 5 5"/></svg>',
  mapa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/><circle cx="15" cy="10" r="2"/><path d="M15 12c-1.6 2-2.4 3.2-2.4 4.1A2.4 2.4 0 0015 18.5a2.4 2.4 0 002.4-2.4C17.4 15.2 16.6 14 15 12z"/></svg>',
  administracion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h16"/><path d="M6 21V8l6-4 6 4v13"/><path d="M9 12h6M9 16h6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4 1.5v3c0 1-1 2-2 2-8 0-14-6-14-14 0-1 1-2 2-2z"/></svg>',
};

/* ---------------- RENDER: HEADER ---------------- */
function renderHeader(){
  const el = document.getElementById('header');
  const brandBar = `<div class="brandbar"><img src="assets/img/logo-header.png" alt="SalsaMix" class="brand-logo"></div>`;
  if(state.clientDetailId){
    const c = getClient(state.clientDetailId);
    el.innerHTML = `
      <div class="header-topline">
        ${brandBar}
        <button class="top-menu-btn" onclick="toggleTopMenu(event)" aria-label="Abrir menú" aria-expanded="${state.topMenuOpen?'true':'false'}">☰</button>
        ${renderTopMenu()}
      </div>
      <div class="subrow">
        <button class="backbtn" onclick="goBack()">${ICONS.back}<span>Clientes</span></button>
      </div>
      <div class="brand stamp" style="margin-top:6px;">${esc(c ? c.name : 'Cliente')}
        <small>Ficha de cliente</small>
      </div>`;
    return;
  }
  const titles = { clientes:'Clientes', rutas:'Rutas de la semana', ventas:'Notas de venta', adeudos:'Adeudos', reportes:'Ventas por producto', inventario:'Inventario', vendedores:'Vendedores', mapa:'Mapa de clientes', administracion:'Administración' };
  const userName = currentProfile ? (currentProfile.name || currentProfile.email || 'Usuario') : 'Usuario';
  const userRole = currentProfile ? (currentProfile.role || 'vendedor') : 'vendedor';
  el.innerHTML = `
    <div class="header-topline">
      ${brandBar}
      <button class="top-menu-btn" onclick="toggleTopMenu(event)" aria-label="Abrir menú" aria-expanded="${state.topMenuOpen?'true':'false'}">☰</button>
      ${renderTopMenu()}
    </div>
    <div class="brand stamp">${titles[state.tab]}<small>Libreta digital de ventas</small><div class="sync-status ${syncState}">${syncState==='syncing'?'↻ Sincronizando…':syncState==='offline'?'⚠ Sin conexión · datos guardados':syncState==='cached'?'◷ Datos guardados · actualizando…':'☁ Sincronizado con Firebase'}</div></div>
    <div class="userbar"><div class="userbar-info"><div class="userbar-name">${esc(userName)}</div><div class="userbar-role">${esc(userRole)}</div></div><button class="logout-btn" onclick="logoutUser()">Salir</button></div>
    ${state.tab==='clientes' ? `<div class="search-wrap"><input type="text" placeholder="Buscar cliente..." value="${esc(state.search)}" oninput="onSearchInput(this.value)"></div>` : ''}
  `;
}

function renderTopMenu(){
  if(!state.topMenuOpen) return '';
  const items = isAdmin()
    ? [['rutas','Rutas'],['mapa','Mapa de clientes'],['reportes','Productos y reportes'],['vendedores','Vendedores'],['administracion','Administración']]
    : [['rutas','Rutas']];
  return `<div class="top-menu-dropdown" onclick="event.stopPropagation()">
    ${items.map(([key,label])=>`<button class="${state.tab===key?'active':''}" onclick="selectTopMenuTab('${key}')">${ICONS[key]}<span>${label}</span></button>`).join('')}
    ${!isPwaInstalled()?`<button onclick="installSalsaMix()"><span class="install-menu-icon">⇩</span><span>Instalar aplicación</span></button>`:''}
  </div>`;
}
function toggleTopMenu(event){
  if(event) event.stopPropagation();
  state.topMenuOpen=!state.topMenuOpen;
  renderHeader();
}
function selectTopMenuTab(tab){
  state.topMenuOpen=false;
  setTab(tab);
}
function closeTopMenu(){
  if(!state.topMenuOpen) return;
  state.topMenuOpen=false;
  renderHeader();
}

/* ---------------- RENDER: BOTTOM NAV ---------------- */
function renderBottomNav(){
  const el = document.getElementById('bottomnav');
  const tabs = isAdmin()
    ? [['clientes','Clientes'],['ventas','Ventas'],['adeudos','Adeudos'],['inventario','Inventario']]
    : [['clientes','Clientes'],['rutas','Rutas'],['ventas','Ventas'],['adeudos','Adeudos']];
  el.innerHTML = tabs.map(([key,label])=>`
    <button class="${state.tab===key?'active':''}" onclick="setTab('${key}')">
      ${ICONS[key]}<span>${label}</span>
    </button>`).join('');
}

/* ---------------- RENDER: FAB ---------------- */
function renderFab(){
  const el = document.getElementById('fab-root');
  if(state.clientDetailId){ el.innerHTML=''; return; }
  let action = null;
  if(state.tab==='clientes') action = () => openClientForm();
  if(state.tab==='ventas') action = () => openNoteForm();
  if(state.tab==='adeudos') action = () => openPaymentForm();
  if(!action){ el.innerHTML=''; return; }
  el.innerHTML = `<div class="fab" onclick="fabAction()">${ICONS.plus}</div>`;
  window.__fabAction = action;
}
function fabAction(){ if(window.__fabAction) window.__fabAction(); }

/* ---------------- RENDER: MAIN ---------------- */
function renderApp(){
  renderHeader(); renderBottomNav(); renderFab();
  const el = document.getElementById('app');
  if(!loaded){ el.innerHTML = `<div class="empty">Cargando libreta...</div>`; return; }
  if(state.clientDetailId){ el.innerHTML = renderClientDetail(state.clientDetailId); return; }
  if(state.tab==='clientes') el.innerHTML = renderClientesTab();
  else if(state.tab==='rutas') el.innerHTML = renderRutasTab();
  else if(state.tab==='ventas') el.innerHTML = renderVentasTab();
  else if(state.tab==='adeudos') el.innerHTML = renderAdeudosTab();
  else if(state.tab==='reportes') el.innerHTML = renderReportesTab();
  else if(state.tab==='inventario') el.innerHTML = renderInventarioTab();
  else if(state.tab==='vendedores') el.innerHTML = renderVendedoresTab();
  else if(state.tab==='administracion') el.innerHTML = renderAdministracionTab();
  else if(state.tab==='mapa'){
    el.innerHTML = renderMapaClientesTab();
    window.setTimeout(initMapaClientes, 0);
  }
}

function setTab(tab){
  state.topMenuOpen=false;
  if(!isAdmin() && ['reportes','inventario','vendedores','mapa','administracion'].includes(tab)){ showToast('Solo el administrador puede entrar'); return; }
  state.tab = tab; state.clientDetailId = null; renderApp();
}
function goBack(){
  state.topMenuOpen=false;
  const clientId=state.clientDetailId;
  if(clientId && state.tab==='rutas' && clientVisitStatus(clientId).key==='pendiente'){
    openModal('visitPrompt',{clientId});
    return;
  }
  state.clientDetailId = null; renderApp();
}
function onSearchInput(v){ state.search = v; document.getElementById('app').innerHTML = renderClientesTab(); }

/* --- Mapa de clientes (solo administrador) --- */
function clientsWithLocation(){
  return clients.filter(hasClientLocation);
}
function renderMapaClientesTab(){
  if(!isAdmin()) return `<div class="empty">Solo el administrador puede consultar el mapa.</div>`;
  const located=clientsWithLocation();
  const missing=clients.length-located.length;
  return `<div class="map-admin-summary">
      <div><strong>${located.length}</strong><span>Con ubicación</span></div>
      <div><strong>${missing}</strong><span>Sin ubicación</span></div>
    </div>
    ${located.length===0
      ? `<div class="empty"><span class="big">🗺️</span>No hay clientes con ubicación guardada.</div>`
      : `<div class="map-toolbar">
          <button class="btn btn-outline btn-sm" onclick="centerAdminMapOnMe()">📍 Mi ubicación</button>
          <button class="btn btn-outline btn-sm" onclick="fitAllClientPins()">◉ Ver todos</button>
        </div>
        <div id="admin-client-map" class="admin-client-map" aria-label="Mapa con ubicaciones de clientes"></div>
        <div class="map-legend"><span>📍 Cada pin representa un cliente con GPS guardado.</span></div>`}`;
}
function initMapaClientes(){
  if(state.tab!=='mapa' || !isAdmin()) return;
  const container=document.getElementById('admin-client-map');
  if(!container) return;
  if(typeof L==='undefined'){
    container.innerHTML='<div class="empty" style="padding:30px 10px;">No se pudo cargar el mapa. Revisa tu conexión a internet.</div>';
    return;
  }
  if(state.clientMapResizeObserver){
    try{ state.clientMapResizeObserver.disconnect(); }catch(error){}
    state.clientMapResizeObserver=null;
  }
  if(state.clientMap){
    try{ state.clientMap.remove(); }catch(error){}
    state.clientMap=null;
  }
  const located=clientsWithLocation();
  const map=L.map(container,{zoomControl:true});
  state.clientMap=map;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
  }).addTo(map);
  const bounds=[];
  located.forEach(client=>{
    const lat=Number(client.locationLat), lng=Number(client.locationLng);
    bounds.push([lat,lng]);
    const seller=isAdmin()?sellerName(client.assignedTo):'';
    const bal=balanceFor(client.id);
    const popup=`<div class="client-map-popup">
      <strong>${esc(client.name)}</strong>
      ${client.zone?`<div>${esc(client.zone)}</div>`:''}
      ${seller?`<div>Vendedor: ${esc(seller)}</div>`:''}
      <div class="${bal>0.004?'map-debt':'map-clear'}">${bal>0.004?`Adeudo: ${fmt(bal)}`:'Al día'}</div>
      <div class="client-map-popup-actions">
        <button onclick="openClientFromMap('${client.id}')">Ver cliente</button>
        <button onclick="openClientMap('${client.id}')">Cómo llegar</button>
      </div>
    </div>`;
    L.marker([lat,lng],{title:client.name}).addTo(map).bindPopup(popup);
  });
  window.__adminClientMapBounds=bounds;

  const refreshMapSize = ()=>{
    if(!state.clientMap || state.clientMap!==map) return;
    map.invalidateSize({pan:false,animate:false});
    if(bounds.length===1) map.setView(bounds[0],16,{animate:false});
    else map.fitBounds(bounds,{padding:[28,28],maxZoom:16,animate:false});
  };

  // La sección se crea dinámicamente. Esperamos a que Leaflet CSS y el
  // contenedor tengan dimensiones reales antes de recalcular los mosaicos.
  const refreshWhenReady = (attempt=0)=>{
    if(!state.clientMap || state.clientMap!==map) return;
    const rect=container.getBoundingClientRect();
    const leafletReady=getComputedStyle(container).position==='relative';
    if(rect.width<100 || rect.height<100 || !leafletReady){
      if(attempt<20) window.setTimeout(()=>refreshWhenReady(attempt+1),100);
      return;
    }
    refreshMapSize();
    window.setTimeout(refreshMapSize,180);
    window.setTimeout(refreshMapSize,600);
  };
  requestAnimationFrame(()=>requestAnimationFrame(()=>refreshWhenReady()));

  if(typeof ResizeObserver!=='undefined'){
    if(state.clientMapResizeObserver) state.clientMapResizeObserver.disconnect();
    state.clientMapResizeObserver=new ResizeObserver(()=>refreshMapSize());
    state.clientMapResizeObserver.observe(container);
  }
}
function fitAllClientPins(){
  const map=state.clientMap, bounds=window.__adminClientMapBounds||[];
  if(!map || !bounds.length) return;
  if(bounds.length===1) map.setView(bounds[0],16);
  else map.fitBounds(bounds,{padding:[28,28],maxZoom:16});
}
async function centerAdminMapOnMe(){
  if(!state.clientMap) return;
  try{
    const position=await getCurrentLocationForRoute();
    state.clientMap.setView([position.lat,position.lng],15);
    L.circleMarker([position.lat,position.lng],{radius:8,color:'#2563eb',fillColor:'#60a5fa',fillOpacity:.9}).addTo(state.clientMap).bindPopup('Tu ubicación actual').openPopup();
  }catch(error){
    showToast(error.message||'No se pudo obtener tu ubicación');
  }
}
function openClientFromMap(clientId){
  state.tab='clientes';
  state.clientDetailId=clientId;
  renderApp();
}

/* --- Clientes tab --- */
function renderClientesTab(){
  const q = state.search.trim().toLowerCase();
  let list = visibleClients().slice().sort((a,b)=>a.name.localeCompare(b.name));
  if(q) list = list.filter(c => c.name.toLowerCase().includes(q) || (c.zone||'').toLowerCase().includes(q));
  if(visibleClients().length===0){
    const adminTools = isAdmin() ? `<div class="btnrow" style="margin-bottom:10px;"><button class="btn btn-outline btn-sm" onclick="openModal('usersManage',{})">👥 Vendedores</button></div>` : '';
    return adminTools + `<div class="empty"><span class="big">📒</span>Aún no tienes clientes.<br>Toca el botón + para agregar el primero.</div>`;
  }
  if(list.length===0){
    return `<div class="empty">No hay clientes que coincidan con "${esc(state.search)}".</div>`;
  }
  const adminTools = isAdmin() ? `<div class="btnrow" style="margin-bottom:10px;"><button class="btn btn-outline btn-sm" onclick="openModal('usersManage',{})">👥 Vendedores (${sellers.filter(s=>s.role==='vendedor').length})</button></div>` : '';
  return adminTools + list.map(c=>{
    const bal = balanceFor(c.id);
    return `<div class="card tap" onclick="openClientDetail('${c.id}')">
      <div class="row-between">
        <div>
          <div class="name">${esc(c.name)} <span class="badge client-type ${c.clientType==='punto_venta'?'pos':'regular'}">${clientTypeLabel(c.clientType)}</span></div>
          <div class="meta">${c.zone?`<span class="badge zone">${esc(c.zone)}</span> `:''}${c.discount>0?`<span class="badge discount">-${c.discount}%</span> `:''}${esc(c.phone||'')}</div>
          <div class="location-inline ${hasClientLocation(c)?'saved':'missing'}">📍 ${clientLocationStatus(c)}</div>
          ${isAdmin()?`<div class="seller-assignment">👤 ${esc(sellerName(c.assignedTo))}</div>`:''}
        </div>
        <div class="balance mono ${bal>0.004?'owed':'clear'}">${bal>0.004? fmt(bal) : 'Al día'}</div>
      </div>
    </div>`;
  }).join('');
}

/* --- Vendedores tab (administrador) --- */
function sellerClients(sellerId){
  return clients.filter(c=>c.assignedTo===sellerId);
}
function sellerNotes(sellerId){
  const clientIds = new Set(sellerClients(sellerId).map(c=>c.id));
  return notes.filter(n=>clientIds.has(n.clientId) || n.createdBy===sellerId);
}
function sellerPayments(sellerId){
  const clientIds = new Set(sellerClients(sellerId).map(c=>c.id));
  return payments.filter(p=>clientIds.has(p.clientId) || p.createdBy===sellerId);
}
function selectSeller(sellerId){
  state.selectedSellerId = sellerId;
  document.getElementById('app').innerHTML = renderVendedoresTab();
}
function clearSelectedSeller(){
  state.selectedSellerId = null;
  document.getElementById('app').innerHTML = renderVendedoresTab();
}
function renderVendedoresTab(){
  if(!isAdmin()) return `<div class="empty">Solo el administrador puede consultar vendedores.</div>`;

  const vendorList = sellers.filter(s=>s.role==='vendedor').slice()
    .sort((a,b)=>(a.name||a.email||'').localeCompare(b.name||b.email||''));

  if(state.selectedSellerId){
    const seller = sellerById(state.selectedSellerId);
    if(!seller){ state.selectedSellerId=null; return renderVendedoresTab(); }
    const assigned = sellerClients(seller.uid).slice().sort((a,b)=>a.name.localeCompare(b.name));
    const sellerSales = sellerNotes(seller.uid).slice().sort((a,b)=>b.date.localeCompare(a.date));
    const deliveredSales = sellerSales.filter(isCollectableNote);
    const pendingOrders = sellerSales.filter(n=>n.fulfillmentStatus==='pedido');
    const sellerCollected = sellerPayments(seller.uid).reduce((sum,p)=>sum+(Number(p.amount)||0),0)
      + deliveredSales.reduce((sum,n)=>sum+(Number(n.paid)||0),0);
    const salesTotal = deliveredSales.reduce((sum,n)=>sum+(Number(n.total)||0),0);
    const routeCounts = DAY_LABELS.map((day,index)=>({day,count:assigned.filter(c=>(c.days||[]).includes(index)).length}));

    const clientsHtml = assigned.length ? assigned.map(c=>{
      const bal=balanceFor(c.id);
      return `<div class="card tap" onclick="openClientDetail('${c.id}')">
        <div class="row-between"><div><div class="name">${esc(c.name)}</div><div class="meta">${esc(c.address||c.zone||'Sin dirección')}</div></div>
        <div class="balance mono ${bal>0.004?'owed':'clear'}">${bal>0.004?fmt(bal):'Al día'}</div></div>
      </div>`;
    }).join('') : `<div class="empty compact">Este vendedor todavía no tiene clientes asignados.</div>`;

    const salesHtml = sellerSales.length ? sellerSales.slice(0,10).map(n=>{
      const c=getClient(n.clientId);
      const pending=n.fulfillmentStatus==='pedido';
      return `<div class="seller-activity-row"><div><strong>${esc(c?.name||'Cliente eliminado')}</strong><div class="meta">${fmtDate(n.date)} · ${pending?'Pedido pendiente':'Venta'}</div></div><div class="mono">${fmt(n.total)}</div></div>`;
    }).join('') : `<div class="meta">Sin ventas ni pedidos registrados.</div>`;

    return `<button class="btn btn-outline btn-sm" onclick="clearSelectedSeller()">← Todos los vendedores</button>
      <div class="seller-profile-card">
        <div><div class="seller-profile-name">${esc(seller.name||'Sin nombre')}</div><div class="meta">${esc(seller.email||'')}</div></div>
        <span class="badge" style="background:${seller.active===false?'var(--red-bg)':'var(--green-bg)'};color:${seller.active===false?'var(--red)':'var(--green)'}">${seller.active===false?'Inactivo':'Activo'}</span>
      </div>
      <div class="seller-kpi-grid">
        <div class="seller-kpi"><span>Clientes</span><strong>${assigned.length}</strong></div>
        <div class="seller-kpi"><span>Ventas</span><strong>${fmt(salesTotal)}</strong></div>
        <div class="seller-kpi"><span>Cobrado</span><strong>${fmt(sellerCollected)}</strong></div>
        <div class="seller-kpi"><span>Pedidos</span><strong>${pendingOrders.length}</strong></div>
      </div>
      <div class="section-title">Rutas asignadas</div>
      <div class="route-summary">${routeCounts.map(r=>`<div><span>${r.day}</span><strong>${r.count}</strong></div>`).join('')}</div>
      <div class="section-title">Clientes de ${esc(seller.name||seller.email||'vendedor')}</div>
      ${clientsHtml}
      <div class="section-title">Últimas ventas y pedidos</div>
      <div class="card">${salesHtml}</div>`;
  }

  if(!vendorList.length){
    return `<div class="empty"><span class="big">👥</span>No hay vendedores disponibles.<br>Deben iniciar sesión una vez para aparecer aquí.</div>`;
  }

  const totalClientsAssigned=clients.filter(c=>c.assignedTo).length;
  const summary=`<div class="seller-kpi-grid">
    <div class="seller-kpi"><span>Vendedores</span><strong>${vendorList.length}</strong></div>
    <div class="seller-kpi"><span>Clientes asignados</span><strong>${totalClientsAssigned}</strong></div>
  </div>`;

  return summary + `<div class="section-title">Selecciona un vendedor</div>` + vendorList.map(s=>{
    const assigned=sellerClients(s.uid);
    const delivered=sellerNotes(s.uid).filter(isCollectableNote);
    const total=delivered.reduce((sum,n)=>sum+(Number(n.total)||0),0);
    return `<div class="card tap" onclick="selectSeller('${s.uid}')">
      <div class="row-between">
        <div><div class="name">${esc(s.name||'Sin nombre')}</div><div class="meta">${esc(s.email||'')} · ${assigned.length} cliente(s)</div></div>
        <div style="text-align:right"><div class="mono" style="font-weight:800">${fmt(total)}</div><div class="meta">ventas</div></div>
      </div>
    </div>`;
  }).join('');
}

/* --- Rutas tab --- */
function renderRutasTab(){
  const chips=[['todos','Todos'],...DAY_SHORT.map((s,i)=>[String(i),DAY_LABELS[i]]),['sin','Sin día']];
  const smartActive=!!(state.smartRoute && state.smartRoute.day===state.routeDay);
  const stripHTML=`<div class="daystrip">${chips.map(([key,label])=>`
    <div class="daychip ${state.routeDay===key?'active':''}" onclick="setRouteDay('${key}')">${label==='Todos'||label==='Sin día'?label:DAY_SHORT[Number(key)]}</div>
  `).join('')}</div>
  <div class="btnrow route-map-actions">
    <button class="btn btn-primary btn-sm" onclick="optimizeSelectedRoute()">✨ Optimizar recorrido</button>
    ${smartActive?`<button class="btn btn-gold btn-sm" onclick="openCurrentSmartRoute()">🗺 Abrir recorrido</button>${state.smartRoute.chunks.length>1?`<button class="btn btn-outline btn-sm" onclick="openNextSmartRoute()">➡️ Siguiente parte</button>`:''}<button class="btn btn-outline btn-sm" onclick="clearSmartRoute()">Restablecer</button>`:`<button class="btn btn-outline btn-sm" onclick="openSelectedRouteMap()">🗺 Abrir ruta normal</button>`}
  </div>`;

  let list=selectedRouteClients();
  const smartList=smartRouteClients();
  if(smartActive){
    const smartIds=new Set(smartList.map(c=>c.id));
    const withoutGps=list.filter(c=>!smartIds.has(c.id) && clientVisitStatus(c.id).key!=='visitado');
    const visited=list.filter(c=>clientVisitStatus(c.id).key==='visitado');
    list=[...smartList,...withoutGps,...visited];
  }else list=list.sort((a,b)=>a.name.localeCompare(b.name));

  const summary=routeVisitSummary(selectedRouteClients());
  const percent=summary.scheduled?Math.round((summary.visited/summary.scheduled)*100):0;
  const summaryHTML=`<div class="smart-progress-card">
    <div class="row-between"><strong>Progreso de la ruta</strong><span>${summary.visited} de ${summary.scheduled} · ${percent}%</span></div>
    <div class="smart-progress"><div style="width:${percent}%"></div></div>
  </div><div class="visit-summary-grid">
    <div class="visit-summary"><span>Programados</span><strong>${summary.scheduled}</strong></div>
    <div class="visit-summary"><span>Visitados</span><strong>${summary.visited}</strong></div>
    <div class="visit-summary"><span>Pendientes</span><strong>${summary.pending}</strong></div>
    <div class="visit-summary"><span>En visita</span><strong>${summary.active}</strong></div>
    <div class="visit-summary"><span>Ventas hoy</span><strong class="mono">${fmt(summary.sales)}</strong></div>
    <div class="visit-summary"><span>Cobrado hoy</span><strong class="mono">${fmt(summary.collections)}</strong></div>
  </div><div class="card visit-time-card"><span>Tiempo en visitas hoy</span><strong>${formatMinutes(summary.minutes)}</strong></div>`;

  if(visibleClients().length===0) return stripHTML+summaryHTML+`<div class="empty"><span class="big">🗺️</span>Agrega clientes y asígnales días de ruta desde su ficha.</div>`;
  if(list.length===0) return stripHTML+summaryHTML+`<div class="empty">Nadie asignado a este día todavía.</div>`;

  const smartPositions=new Map(smartList.map((c,index)=>[c.id,index+1]));
  const rows=list.map(c=>{
    const bal=balanceFor(c.id);
    const position=smartPositions.get(c.id);
    const noGps=!hasClientLocation(c);
    return `<div class="card visit-card ${clientVisitStatus(c.id).key}">
      <div class="row-between">
        <div class="tap" style="flex:1" onclick="openClientDetail('${c.id}')">
          <div class="name">${position?`<span class="route-order">${position}</span>`:''}${esc(c.name)} ${visitStatusBadge(c.id)}</div>
          <div class="meta">${esc(c.address||c.zone||'')}</div>
          <div class="location-inline ${hasClientLocation(c)?'saved':'missing'}">📍 ${clientLocationStatus(c)}${smartActive&&noGps?' · No incluido en optimización':''}</div>
        </div>
        <div class="balance mono ${bal>0.004?'owed':'clear'}" style="font-size:13px;">${bal>0.004?fmt(bal):'Al día'}</div>
      </div>
      <div class="btnrow">
        ${c.phone?`<a href="tel:${esc(c.phone)}" class="btn btn-outline btn-sm">${ICONS.phone} Llamar</a>`:''}
        ${hasClientLocation(c)?`<button class="btn btn-outline btn-sm" onclick="openClientMap('${c.id}')">🗺 Ir</button>`:''}
        ${visitActionButtons(c.id)}
        <button class="btn btn-gold btn-sm" onclick="openNoteForm('${c.id}')">+ Nota</button>
      </div>
    </div>`;
  }).join('');
  return stripHTML+summaryHTML+rows;
}
function setRouteDay(day){
  state.routeDay=day;
  state.smartRoute=null;
  document.getElementById('app').innerHTML=renderRutasTab();
}

/* --- Ventas tab --- */
function renderVentasTab(){
  const catalogBtn = `<div class="btnrow" style="margin-bottom:10px;">
    <button class="btn btn-outline btn-sm" onclick="openModal('catalogManage',{editingId:null})">📦 Catálogo (${catalog.length})</button>
    <button class="btn btn-outline btn-sm" onclick="setTab('reportes')">📊 Ventas por producto</button>
  </div>`;
  if(visibleNotes().length===0){
    return catalogBtn + `<div class="empty"><span class="big">🧾</span>No has registrado notas de venta.<br>Toca + para crear la primera.</div>`;
  }
  const statusMap = computeEffectiveNoteStatuses();
  const list = visibleNotes().slice().sort((a,b)=> b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return catalogBtn + list.map(n=>{
    const c = getClient(n.clientId);
    const info = statusMap.get(n.id) || { saldo: Math.max(0, Math.round((n.total-(n.paid||0))*100)/100), status:'pendiente' };
    let statusBadge;
    if(n.fulfillmentStatus==='pedido') statusBadge = `<span class="badge" style="background:#F8E8C7;color:var(--gold-dark);">${isConsignmentNote(n)?'Pedido en consignación':'Pedido pendiente'}</span>`;
    else if(isConsignmentNote(n)) statusBadge = `<span class="badge consignment">Consignación</span>`;
    else if(info.status==='pagada') statusBadge = `<span class="badge" style="background:var(--green-bg);color:var(--green);">Pagada</span>`;
    else if(info.status==='parcial') statusBadge = `<span class="badge" style="background:var(--blue-bg);color:var(--blue);">Parcial</span>`;
    else statusBadge = `<span class="badge" style="background:var(--red-bg);color:var(--red);">Pendiente</span>`;
    const notePct = (n.clientDiscountPct||0)+(n.extraDiscountPct||0);
    return `<div class="card tap" onclick="openNoteDetail('${n.id}')">
      <div class="row-between">
        <div>
          <div class="name">${esc(c ? c.name : '(cliente eliminado)')}</div>
          <div class="meta">${fmtDate(n.date)} · ${(n.items||[]).length} producto(s) ${statusBadge}${notePct>0?` <span class="badge discount">-${notePct}%</span>`:''}</div>
        </div>
        <div class="balance mono">${fmt(n.total)}</div>
      </div>
    </div>`;
  }).join('');
}

/* --- Reportes: ventas por producto --- */
function renderReportesTab(){
  const productStats = computeProductStats();
  const totalUnits = productStats.reduce((sum,p)=>sum+(Number(p.qty)||0),0);
  const totalRevenue = productStats.reduce((sum,p)=>sum+(Number(p.revenue)||0),0);

  const summary = `<div class="report-summary">
    <div class="report-stat"><div class="label">Unidades vendidas</div><div class="value mono">${totalUnits}</div></div>
    <div class="report-stat"><div class="label">Importe vendido</div><div class="value mono">${fmt(totalRevenue)}</div></div>
  </div>`;

  if(productStats.length===0){
    return summary + `<div class="empty"><span class="big">📦</span>Agrega productos al catálogo para ver aquí sus ventas.</div>`;
  }

  const rows = productStats.map((product,index)=>{
    const clientsHTML = product.clients.length
      ? product.clients.map(client=>`
          <div style="font-size:12px;margin-top:4px;">
            • ${esc(client.name)} <strong>(${client.qty})</strong>
          </div>`).join('')
      : `<div class="meta" style="margin-top:4px;">Sin ventas registradas</div>`;

    return `<div class="card">
      <div class="name">${index+1}. ${esc(product.name)}</div>
      <div class="meta">${esc(product.category)}</div>

      <div style="margin-top:12px;font-size:13px;">
        <strong>Vendidas:</strong> <span class="mono">${product.qty}</span>
      </div>
      <div style="margin-top:5px;font-size:13px;">
        <strong>Ingresos:</strong> <span class="mono">${fmt(product.revenue)}</span>
      </div>
      <div style="margin-top:12px;font-size:13px;">
        <strong>Última venta:</strong><br>
        <span class="meta">${product.lastSale ? fmtDate(product.lastSale) : 'Sin ventas'}</span>
      </div>
      <div style="margin-top:12px;font-size:13px;">
        <strong>Clientes:</strong>
        ${clientsHTML}
      </div>
    </div>`;
  }).join('');

  return summary + `<div class="section-title">Todos los productos</div>` + rows;
}

/* --- Inventario tab --- */
function renderInventarioTab(){
  const sorted = catalog.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const totalUnits = sorted.reduce((sum,p)=>sum+productStock(p),0);
  const lowCount = sorted.filter(p=>productStock(p)<=productMinStock(p)).length;
  const summary = `<div class="report-summary">
    <div class="report-stat"><div class="label">Existencias</div><div class="value mono">${totalUnits}</div></div>
    <div class="report-stat"><div class="label">Alertas</div><div class="value mono">${lowCount}</div></div>
  </div>
  <div class="btnrow" style="margin-bottom:12px;">
    <button class="btn btn-outline btn-sm" onclick="openModal('catalogManage',{editingId:null})">⚙️ Administrar productos</button>
  </div>
  ${renderGlobalShortages()}`;
  if(sorted.length===0) return summary + `<div class="empty"><span class="big">📦</span>Agrega productos al catálogo para administrar inventario.</div>`;
  return summary + sorted.map(product=>{
    const status = stockStatus(product);
    const recent = inventoryMovements.filter(m=>m.productId===product.id).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).slice(0,3);
    const recentHTML = recent.length ? recent.map(m=>`<div class="meta">${fmtDate(m.date)} · ${m.quantity>0?'+':''}${m.quantity} · ${esc(m.reason||m.type)}</div>`).join('') : `<div class="meta">Sin movimientos todavía</div>`;
    return `<div class="card">
      <div class="row-between">
        <div>
          <div class="name">${esc(product.name)}</div>
          <div class="meta">${esc(product.category||'Sin categoría')} · Venta ${fmt(product.price||0)} · Costo ${fmt(product.cost||0)}</div>
        </div>
        <div style="text-align:right;">
          <div class="mono" style="font-size:20px;font-weight:800;">${productStock(product)}</div>
          <span class="badge" style="background:${status.bg};color:${status.color};">${status.label}</span>
        </div>
      </div>
      <div class="hint">Stock mínimo: ${productMinStock(product)}</div>
      <div class="btnrow">
        <button class="btn btn-gold btn-sm" onclick="openInventoryEntry('${product.id}')">+ Entrada</button>
        <button class="btn btn-outline btn-sm" onclick="openModal('catalogManage',{editingId:'${product.id}'})">Editar</button>
      </div>
      <div class="section-title" style="margin-top:12px;">Últimos movimientos</div>
      ${recentHTML}
    </div>`;
  }).join('');
}
function openInventoryEntry(productId){ openModal('inventoryEntry',{productId, quantity:'', reason:'Entrada de mercancía', date:todayISO()}); }
function modalInventoryEntry(){
  const p = state.modal.payload;
  const product = catalog.find(x=>x.id===p.productId);
  if(!product) return `<div class="empty">Producto no encontrado.</div>`;
  return `<div class="modal-title"><span>Entrada de inventario</span><button onclick="closeModal()">✕</button></div>
    <div class="card"><div class="name">${esc(product.name)}</div><div class="meta">Existencia actual: <strong>${productStock(product)}</strong></div></div>
    <label>Cantidad que entra *</label><input type="number" id="inv-qty" min="1" step="1" value="${esc(p.quantity)}">
    <label>Fecha</label><input type="date" id="inv-date" value="${p.date}">
    <label>Motivo / proveedor</label><input type="text" id="inv-reason" value="${esc(p.reason)}" placeholder="Ej. Compra a proveedor">
    <div class="btnrow"><button class="btn btn-primary btn-block" onclick="submitInventoryEntry()">Guardar entrada</button></div>`;
}
function submitInventoryEntry(){
  const p = state.modal.payload;
  const product = catalog.find(x=>x.id===p.productId);
  const quantity = Number(document.getElementById('inv-qty').value);
  const date = document.getElementById('inv-date').value || todayISO();
  const reason = document.getElementById('inv-reason').value.trim() || 'Entrada de mercancía';
  if(!product){ showToast('Producto no encontrado'); return; }
  if(!quantity || quantity<=0){ showToast('Ingresa una cantidad válida'); return; }
  product.stock = productStock(product)+quantity;
  addInventoryMovement(product.id,'entrada',quantity,{date,reason});
  saveCatalog(); saveInventoryMovements();
  closeModal(); renderApp(); showToast('Inventario actualizado');
}
function fulfillOrder(noteId){
  const note = notes.find(n=>n.id===noteId);
  if(!note || note.fulfillmentStatus!=='pedido') return;
  const shortages = getStockShortages(note.items);
  if(shortages.length){
    showToast('Aún falta inventario: '+shortages.map(s=>`${s.product.name} (${s.available}/${s.requested})`).join(', '));
    return;
  }
  applyInventorySale(note.items,note.id,todayISO());
  note.fulfillmentStatus='entregada';
  note.inventoryApplied=true;
  note.fulfilledAt=new Date().toISOString();
  saveNotes(); closeModal(); renderApp(); showToast('Pedido surtido; ya puede cobrarse');
}


/* --- Planeación de surtido y administración financiera --- */
function pendingOrderDemand(){
  const demand=new Map();
  notes.filter(n=>n.fulfillmentStatus==='pedido').forEach(note=>{
    (note.items||[]).forEach(item=>{
      const key=item.catalogId || `name:${String(item.name||'').trim().toLowerCase()}`;
      if(!key) return;
      const row=demand.get(key)||{catalogId:item.catalogId||null,name:item.name||'Producto',qty:0,notes:0};
      row.qty += Number(item.qty)||0; row.notes += 1; demand.set(key,row);
    });
  });
  return [...demand.values()].map(row=>{
    const product=row.catalogId?catalog.find(p=>p.id===row.catalogId):catalog.find(p=>p.name.trim().toLowerCase()===row.name.trim().toLowerCase());
    const stock=productStock(product); const missing=Math.max(0,row.qty-stock);
    return {...row,product,stock,missing};
  }).sort((a,b)=>b.missing-a.missing || a.name.localeCompare(b.name));
}
function renderGlobalShortages(){
  const rows=pendingOrderDemand();
  const missing=rows.filter(r=>r.missing>0);
  const totalMissing=missing.reduce((s,r)=>s+r.missing,0);
  return `<div class="card shortage-card"><div class="row-between"><div><div class="name">Piezas necesarias para surtir notas abiertas</div><div class="meta">Compara pedidos pendientes contra existencia actual.</div></div><div class="mono shortage-total">${totalMissing}</div></div>
  ${rows.length?`<div class="table-scroll"><table class="admin-table"><thead><tr><th>Producto</th><th>Existencia</th><th>Comprometido</th><th>Faltan</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.product?.name||r.name)}</td><td>${r.stock}</td><td>${r.qty}</td><td><strong class="${r.missing?'text-danger':'text-ok'}">${r.missing}</strong></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty compact">No hay pedidos abiertos pendientes de surtir.</div>`}
  <div class="btnrow"><button class="btn btn-outline btn-sm" onclick="exportShortagesCSV()">Exportar CSV</button><button class="btn btn-outline btn-sm" onclick="window.print()">Imprimir</button></div></div>`;
}
function exportShortagesCSV(){
  const rows=pendingOrderDemand();
  const csv=['Producto,Existencia,Comprometido,Faltan',...rows.map(r=>[r.product?.name||r.name,r.stock,r.qty,r.missing].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');
  downloadTextFile(`faltantes-${todayISO()}.csv`,csv,'text/csv;charset=utf-8');
}
function downloadTextFile(name,text,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+text],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
function monthKey(date){ return String(date||'').slice(0,7); }
function financialMetrics(month=''){
  const saleNotes=notes.filter(n=>isCollectableNote(n) && (!month||monthKey(n.date)===month));
  const sales=saleNotes.reduce((sum,n)=>sum+(Number(n.total)||0),0);
  const invested=purchases.filter(p=>!month||monthKey(p.date)===month).reduce((sum,p)=>sum+(Number(p.total)||0),0);
  const profit=sales-invested;
  return {sales,invested,profit,margin:sales?profit/sales*100:0,countSales:saleNotes.length,countPurchases:purchases.filter(p=>!month||monthKey(p.date)===month).length};
}
function renderAdministracionTab(){
  if(!isAdmin()) return `<div class="empty">Solo el administrador puede consultar este apartado.</div>`;
  const selected=state.adminMonth||todayISO().slice(0,7); const m=financialMetrics(selected); const all=financialMetrics('');
  const list=purchases.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||'').localeCompare(a.createdAt||''));
  return `<div class="admin-filter"><label>Periodo</label><input type="month" value="${selected}" onchange="state.adminMonth=this.value;renderApp()"></div>
  <div class="finance-grid"><div class="report-stat"><div class="label">Inversión del mes</div><div class="value mono">${fmt(m.invested)}</div></div><div class="report-stat"><div class="label">Ventas del mes</div><div class="value mono">${fmt(m.sales)}</div></div><div class="report-stat"><div class="label">Resultado</div><div class="value mono ${m.profit<0?'text-danger':'text-ok'}">${fmt(m.profit)}</div></div><div class="report-stat"><div class="label">Margen</div><div class="value mono">${m.margin.toFixed(1)}%</div></div></div>
  <div class="card"><div class="name">Acumulado general</div><div class="financial-line"><span>Inversión registrada</span><strong>${fmt(all.invested)}</strong></div><div class="financial-line"><span>Ventas registradas</span><strong>${fmt(all.sales)}</strong></div><div class="financial-line"><span>Ventas menos compras</span><strong class="${all.profit<0?'text-danger':'text-ok'}">${fmt(all.profit)}</strong></div><div class="hint">Este resultado es flujo simple: ventas menos compras del periodo. No sustituye la utilidad contable ni considera inventario inicial, gastos, impuestos o costo de lo vendido.</div></div>
  <div class="btnrow"><button class="btn btn-primary" onclick="openModal('purchaseForm',{id:null})">+ Registrar compra</button><button class="btn btn-outline" onclick="exportPurchasesCSV()">Exportar compras</button></div>
  <div class="section-title">Compras y documentos de proveedores</div>${list.length?list.map(p=>`<div class="card clickable" onclick="openModal('purchaseDetail',{id:'${p.id}'})"><div class="row-between"><div><div class="name">${esc(p.supplier||'Proveedor')}</div><div class="meta">${fmtDate(p.date)} · ${esc(p.invoiceNumber||p.noteNumber||'Sin folio')} · ${esc(p.material||'Compra')}</div></div><strong class="mono">${fmt(p.total)}</strong></div></div>`).join(''):`<div class="empty">Todavía no hay compras registradas.</div>`}`;
}
function modalPurchaseForm(){
  if(!isAdmin()) return `<div class="empty">Acceso restringido.</div>`;
  const id=state.modal.payload.id; const p=id?purchases.find(x=>x.id===id):null;
  return `<div class="modal-title"><span>${p?'Editar compra':'Registrar compra'}</span><button onclick="closeModal()">✕</button></div>
  <label>Fecha *</label><input id="pur-date" type="date" value="${p?.date||todayISO()}"><label>Proveedor *</label><input id="pur-supplier" value="${esc(p?.supplier||'')}"><label>Número de factura</label><input id="pur-invoice" value="${esc(p?.invoiceNumber||'')}"><label>Número de nota</label><input id="pur-note" value="${esc(p?.noteNumber||'')}"><label>Materia prima / concepto *</label><input id="pur-material" value="${esc(p?.material||'')}"><label>Cantidad</label><input id="pur-qty" type="number" min="0" step="any" value="${p?.quantity??1}" oninput="recalcPurchaseTotal()"><label>Costo unitario</label><input id="pur-unit" type="number" min="0" step="any" value="${p?.unitCost??0}" oninput="recalcPurchaseTotal()"><label>Total *</label><input id="pur-total" type="number" min="0" step="any" value="${p?.total??0}"><label>Observaciones</label><textarea id="pur-comments">${esc(p?.comments||'')}</textarea><label>Factura o nota (PDF/imagen, máximo 650 KB)</label><input id="pur-file" type="file" accept="application/pdf,image/*"><div class="hint">${p?.attachmentName?`Documento actual: ${esc(p.attachmentName)}`:'El documento se almacena con el registro.'}</div><div class="btnrow"><button class="btn btn-primary btn-block" onclick="submitPurchaseForm()">Guardar compra</button></div>`;
}
function recalcPurchaseTotal(){ const q=Number(document.getElementById('pur-qty')?.value)||0,u=Number(document.getElementById('pur-unit')?.value)||0,t=document.getElementById('pur-total'); if(t)t.value=(q*u).toFixed(2); }
function readSmallFile(file){ return new Promise((resolve,reject)=>{ if(!file)return resolve(null); if(file.size>650*1024)return reject(new Error('El archivo supera 650 KB')); const r=new FileReader(); r.onload=()=>resolve({name:file.name,type:file.type,data:r.result}); r.onerror=()=>reject(new Error('No se pudo leer el archivo')); r.readAsDataURL(file); }); }
async function submitPurchaseForm(){
  const id=state.modal.payload.id; const existing=id?purchases.find(x=>x.id===id):null; const supplier=document.getElementById('pur-supplier').value.trim(),material=document.getElementById('pur-material').value.trim(),total=Number(document.getElementById('pur-total').value);
  if(!supplier||!material||!total||total<0){showToast('Completa proveedor, concepto y total');return;}
  try{ const f=document.getElementById('pur-file').files[0]; const attachment=await readSmallFile(f); const data={date:document.getElementById('pur-date').value||todayISO(),supplier,invoiceNumber:document.getElementById('pur-invoice').value.trim(),noteNumber:document.getElementById('pur-note').value.trim(),material,quantity:Number(document.getElementById('pur-qty').value)||0,unitCost:Number(document.getElementById('pur-unit').value)||0,total,comments:document.getElementById('pur-comments').value.trim(),attachmentName:attachment?.name||existing?.attachmentName||'',attachmentType:attachment?.type||existing?.attachmentType||'',attachmentData:attachment?.data||existing?.attachmentData||'',updatedAt:new Date().toISOString()}; if(existing)Object.assign(existing,data,actorFields('updated')); else purchases.push({id:uid(),...data,...actorFields('created')}); await savePurchases(); closeModal(); renderApp(); showToast('Compra guardada'); }catch(e){showToast(e.message||'No se pudo guardar');}
}
function modalPurchaseDetail(){ const p=purchases.find(x=>x.id===state.modal.payload.id); if(!p)return `<div class="empty">Compra no encontrada.</div>`; return `<div class="modal-title"><span>Detalle de compra</span><button onclick="closeModal()">✕</button></div><div class="card"><div class="name">${esc(p.supplier)}</div><div class="meta">${fmtDate(p.date)}</div><div class="financial-line"><span>Concepto</span><strong>${esc(p.material)}</strong></div><div class="financial-line"><span>Cantidad</span><strong>${p.quantity||0}</strong></div><div class="financial-line"><span>Costo unitario</span><strong>${fmt(p.unitCost)}</strong></div><div class="financial-line"><span>Total</span><strong>${fmt(p.total)}</strong></div><div class="financial-line"><span>Factura / nota</span><strong>${esc(p.invoiceNumber||p.noteNumber||'Sin folio')}</strong></div>${p.comments?`<div class="hint">${esc(p.comments)}</div>`:''}</div><div class="btnrow">${p.attachmentData?`<button class="btn btn-gold" onclick="openPurchaseAttachment('${p.id}')">Ver documento</button>`:''}<button class="btn btn-outline" onclick="openModal('purchaseForm',{id:'${p.id}'})">Editar</button><button class="btn btn-danger" onclick="deletePurchase('${p.id}')">Eliminar</button></div>`; }
function openPurchaseAttachment(id){ const p=purchases.find(x=>x.id===id); if(!p?.attachmentData)return; const a=document.createElement('a');a.href=p.attachmentData;a.target='_blank';a.download=p.attachmentName||'documento';a.click(); }
function deletePurchase(id){ if(!confirm('¿Eliminar esta compra?'))return; purchases=purchases.filter(p=>p.id!==id); savePurchases(); closeModal(); renderApp(); showToast('Compra eliminada'); }
function exportPurchasesCSV(){ const csv=['Fecha,Proveedor,Factura,Nota,Concepto,Cantidad,Costo unitario,Total',...purchases.map(p=>[p.date,p.supplier,p.invoiceNumber,p.noteNumber,p.material,p.quantity,p.unitCost,p.total].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(','))].join('\n'); downloadTextFile(`compras-${todayISO()}.csv`,csv,'text/csv;charset=utf-8'); }

/* --- Adeudos tab --- */
function renderAdeudosTab(){
  const withBalance = visibleClients().map(c=>({c, bal: balanceFor(c.id)})).filter(x=>x.bal>0.004).sort((a,b)=>b.bal-a.bal);
  const total = totalAdeudoGlobal();
  const summary = `<div class="card" style="background:var(--cover);color:var(--paper);border:none;">
    <div class="meta" style="color:var(--gold);font-weight:700;">TOTAL POR COBRAR</div>
    <div class="mono" style="font-size:26px;font-weight:800;margin-top:2px;">${fmt(total)}</div>
  </div>`;
  if(withBalance.length===0){
    return summary + `<div class="empty"><span class="big">✅</span>¡Todo cobrado! No hay adeudos pendientes.</div>`;
  }
  const rows = withBalance.map(({c,bal})=>`
    <div class="card">
      <div class="row-between">
        <div class="tap" style="flex:1" onclick="openClientDetail('${c.id}')">
          <div class="name">${esc(c.name)}</div>
          <div class="meta">${c.zone?esc(c.zone):''}</div>
        </div>
        <div class="balance mono owed">${fmt(bal)}</div>
      </div>
      <div class="btnrow">
        ${c.phone?`<a href="tel:${esc(c.phone)}" class="btn btn-outline btn-sm">${ICONS.phone} Llamar</a>`:''}
        <button class="btn btn-gold btn-sm" onclick="openPaymentForm('${c.id}')">Registrar pago</button>
      </div>
    </div>`).join('');
  return summary + rows;
}

/* --- Client detail --- */
function renderClientDetail(id){
  if(!canAccessClient(id)){ state.clientDetailId=null; return `<div class="empty">No tienes acceso a este cliente.</div>`; }
  const c = getClient(id);
  if(!c){ state.clientDetailId=null; return renderClientesTab(); }
  const bal = balanceFor(id);
  const statusMap = computeEffectiveNoteStatuses();
  const cn = notesFor(id).map(n=>({type:'nota', date:n.date, data:n}));
  const cp = paymentsFor(id).map(p=>({type:'pago', date:p.date, data:p}));
  const cv = visitsForClient(id).map(v=>({type:'visita', date:v.date, data:v}));
  const timeline = [...cn, ...cp, ...cv].sort((a,b)=> b.date.localeCompare(a.date));

  const daysBadges = (c.days||[]).length
    ? (c.days||[]).slice().sort().map(d=>`<span class="badge zone" style="margin-right:4px;">${DAY_LABELS[d]}</span>`).join('')
    : '<span class="meta">Sin días de ruta asignados</span>';

  const timelineHTML = timeline.length===0 ? `<div class="empty" style="padding:24px 10px;">Aún no hay historial con este cliente.</div>` :
    timeline.map(item=>{
      if(item.type==='nota'){
        const n = item.data;
        const info = statusMap.get(n.id) || { saldo: Math.max(0, Math.round((n.total-(n.paid||0))*100)/100) };
        return `<div class="tl-item tap" onclick="openNoteDetail('${n.id}')">
          <div class="tl-date">${fmtDate(n.date)}</div>
          <div class="tl-head"><span>${isConsignmentNote(n)?'Consignación':'Nota de venta'}</span><span class="mono">${fmt(n.total)}</span></div>
          <div class="tl-sub">${n.items.length} producto(s) ${isConsignmentNote(n)?'· sin adeudo':(info.saldo>0.004?`· saldo ${fmt(info.saldo)}`:'· pagada')}</div>
        </div>`;
      } else if(item.type==='pago') {
        const p = item.data;
        return `<div class="tl-item">
          <div class="tl-date">${fmtDate(p.date)}</div>
          <div class="tl-head"><span>Pago recibido</span><span class="mono" style="color:var(--green);">+${fmt(p.amount)}</span></div>
          <div class="tl-sub">${paymentMethodLabel(p.method)}${p.notes?` · ${esc(p.notes)}`:''}</div>
        </div>`;
      } else {
        const v=item.data;
        return `<div class="tl-item">
          <div class="tl-date">${fmtDate(v.date)}</div>
          <div class="tl-head"><span>${v.status==='en_visita'?'Visita en curso':'Visita realizada'}</span><span class="mono">${formatMinutes(visitDurationMinutes(v))}</span></div>
          <div class="tl-sub">${formatClock(v.startedAt)}${v.endedAt?`–${formatClock(v.endedAt)}`:''}${v.observations?` · ${esc(v.observations)}`:''}</div>
        </div>`;
      }
    }).join('');

  return `
    <div class="card">
      <div class="row-between">
        <div>
          <div class="meta">${esc(c.address||'Sin dirección registrada')}</div>
          <div style="margin-top:4px;"><span class="badge client-type ${c.clientType==='punto_venta'?'pos':'regular'}">${clientTypeLabel(c.clientType)}</span> ${daysBadges}${c.discount>0?` <span class="badge discount">Descuento fijo -${c.discount}%</span>`:''}</div>
        </div>
      </div>
      <div class="visit-panel">
        <div class="row-between"><div><div class="location-title">📋 Visita de hoy</div><div class="location-state">${visitStatusBadge(c.id)}</div></div></div>
        <div class="btnrow">${visitActionButtons(c.id)}</div>
        ${todayVisitForClient(c.id)?`<div class="hint">Inicio: ${formatClock(todayVisitForClient(c.id).startedAt)}${todayVisitForClient(c.id).endedAt?` · Fin: ${formatClock(todayVisitForClient(c.id).endedAt)} · Duración: ${formatMinutes(visitDurationMinutes(todayVisitForClient(c.id)))}`:''}</div>`:''}
      </div>
      <div class="location-panel">
        <div class="row-between">
          <div><div class="location-title">📍 Ubicación</div><div class="location-state ${hasClientLocation(c)?'saved':'missing'}">${hasClientLocation(c)?'🟢 Ubicación guardada':'⚪ Sin ubicación registrada'}</div></div>
        </div>
        <div class="btnrow">
          <button class="btn btn-outline btn-sm" onclick="saveClientLocation('${c.id}')">${hasClientLocation(c)?'Actualizar ubicación':'Guardar ubicación'}</button>
          ${hasClientLocation(c)?`<button class="btn btn-gold btn-sm" onclick="openClientMap('${c.id}')">🗺 Ir al cliente</button>`:''}
        </div>
      </div>
      <div class="total-strip" style="margin-top:10px;">
        <span>Saldo actual</span>
        <span class="mono ${bal>0.004?'owed':'clear'}" style="font-size:17px;">${bal>0.004?fmt(bal):'Al día'}</span>
      </div>
      <div class="btnrow">
        ${c.phone?`<a href="tel:${esc(c.phone)}" class="btn btn-outline btn-sm">${ICONS.phone} Llamar</a>`:''}
        <button class="btn btn-gold btn-sm" onclick="openNoteForm('${c.id}')">+ Nota de venta</button>
        <button class="btn btn-primary btn-sm" onclick="openPaymentForm('${c.id}')">Registrar pago</button>
        <button class="btn btn-outline btn-sm" onclick="openClientForm('${c.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteClient('${c.id}')">Eliminar</button>
      </div>
    </div>
    <div class="section-title">Historial</div>
    ${timelineHTML}
  `;
}
function openClientDetail(id){ state.clientDetailId = id; renderApp(); }
function confirmDeleteClient(id){
  const c = getClient(id);
  openModal('confirm', {
    title:'Eliminar cliente',
    body:`¿Seguro que quieres eliminar a "${esc(c.name)}"? Esto también borrará sus notas de venta y pagos registrados. Esta acción no se puede deshacer.`,
    onConfirm: () => { deleteClient(id); state.clientDetailId=null; closeModal(); renderApp(); }
  });
}

/* ---------------- MODALS ---------------- */
function openModal(type,payload){ state.modal = {type, payload}; renderModal(); }
function closeModal(){ state.modal = null; renderModal(); }
function renderModal(){
  const root = document.getElementById('modal-root');
  if(!state.modal){ root.innerHTML=''; return; }
  const {type} = state.modal;
  let html='';
  if(type==='clientForm') html = modalClientForm();
  if(type==='noteForm') html = modalNoteForm();
  if(type==='paymentForm') html = modalPaymentForm();
  if(type==='noteDetail') html = modalNoteDetail();
  if(type==='confirm') html = modalConfirm();
  if(type==='catalogManage') html = modalCatalogManage();
  if(type==='salesStats') html = modalSalesStats();
  if(type==='inventoryEntry') html = modalInventoryEntry();
  if(type==='usersManage') html = modalUsersManage();
  if(type==='visitFinish') html = modalVisitFinish();
  if(type==='visitPrompt') html = modalVisitPrompt();
  if(type==='purchaseForm') html = modalPurchaseForm();
  if(type==='purchaseDetail') html = modalPurchaseDetail();
  root.innerHTML = `<div class="modal-overlay" onclick="closeModal()"><div class="modal-sheet" onclick="event.stopPropagation()">${html}</div></div>`;
}

/* --- Cliente form modal --- */
function openClientForm(id){ openModal('clientForm', {id: id||null, days: id ? (getClient(id).days||[]).slice() : []}); }
function toggleFormDay(d){
  const p = state.modal.payload;
  const i = p.days.indexOf(d);
  if(i>=0) p.days.splice(i,1); else p.days.push(d);
  renderModal();
}
function modalClientForm(){
  const p = state.modal.payload;
  const editing = p.id ? getClient(p.id) : null;
  const dayChips = DAY_LABELS.map((label,i)=>`<div class="chip ${p.days.includes(i)?'on':''}" onclick="toggleFormDay(${i})">${DAY_SHORT[i]}</div>`).join('');
  return `
    <div class="modal-title"><span>${editing?'Editar cliente':'Nuevo cliente'}</span><button onclick="closeModal()">✕</button></div>
    <label>Tipo de registro *</label>
    <select id="f-client-type">
      <option value="cliente" ${(editing?.clientType||'cliente')==='cliente'?'selected':''}>Cliente</option>
      <option value="punto_venta" ${(editing?.clientType||'cliente')==='punto_venta'?'selected':''}>Cliente punto de venta</option>
    </select>
    <div class="hint">Usa “Punto de venta” para tiendas, distribuidores o negocios que venden tus productos al público.</div>
    <label>Nombre *</label>
    <input type="text" id="f-name" value="${editing?esc(editing.name):''}" placeholder="Nombre del cliente / negocio">
    <label>Teléfono</label>
    <input type="tel" id="f-phone" value="${editing?esc(editing.phone||''):''}" placeholder="Ej. 33 1234 5678">
    <label>Dirección</label>
    <input type="text" id="f-address" value="${editing?esc(editing.address||''):''}" placeholder="Calle, número, colonia">
    <label>Zona</label>
    <input type="text" id="f-zone" value="${editing?esc(editing.zone||''):''}" placeholder="Ej. Centro, Zapopan Norte...">
    <label>Descuento permanente (%)</label>
    <input type="number" id="f-discount" min="0" max="100" step="any" value="${editing?(editing.discount||0):0}" placeholder="0">
    <div class="hint">Se aplicará automáticamente en cada nota de venta de este cliente. Déjalo en 0 si compra a precio de lista.</div>
    ${isAdmin()?`<label>Vendedor asignado</label>
    <select id="f-assigned-to">
      <option value="">Sin asignar</option>
      ${sellers.filter(s=>s.role==='vendedor' && s.active!==false).map(s=>`<option value="${esc(s.uid)}" ${(editing?.assignedTo||'')===s.uid?'selected':''}>${esc(s.name||s.email)}</option>`).join('')}
    </select>
    <div class="hint">El vendedor solo verá los clientes que tenga asignados.</div>`:''}
    <label>Días de ruta</label>
    <div class="chiprow">${dayChips}</div>
    <div class="hint">Toca los días en que normalmente visitas a este cliente.</div>
    <div class="btnrow">
      <button class="btn btn-primary btn-block" onclick="submitClientForm()">Guardar cliente</button>
    </div>
  `;
}
function submitClientForm(){
  const p = state.modal.payload;
  const name = document.getElementById('f-name').value.trim();
  if(!name){ showToast('El nombre es obligatorio'); return; }
  const data = {
    name,
    clientType: document.getElementById('f-client-type')?.value || 'cliente',
    phone: document.getElementById('f-phone').value.trim(),
    address: document.getElementById('f-address').value.trim(),
    zone: document.getElementById('f-zone').value.trim(),
    discount: Math.min(100, Math.max(0, Number(document.getElementById('f-discount').value)||0)),
    days: p.days.slice(),
    assignedTo: isAdmin() ? (document.getElementById('f-assigned-to')?.value || '') : (p.id ? (getClient(p.id)?.assignedTo || currentUser.uid) : currentUser.uid),
  };
  addOrUpdateClient(data, p.id);
  closeModal(); renderApp();
}

/* --- Nota de venta form modal --- */
function blankItem(){ return { catalogId: catalog.length===0 ? '__custom__' : '', desc:'', qty:1, price:0 }; }
function openNoteForm(clientId){
  openModal('noteForm', {
    clientId: clientId || (visibleClients()[0] ? visibleClients()[0].id : ''),
    date: todayISO(),
    items: [blankItem()],
    paid: 0,
    notes: '',
    saleType: 'venta',
    extraDiscount: 0,
  });
}
function onNoteClientChange(value){
  syncNoteItemsFromDOM();
  state.modal.payload.clientId = value;
  renderModal();
}
function syncNoteItemsFromDOM(){
  const p = state.modal.payload;
  p.items = p.items.map((it,i)=>({
    catalogId: it.catalogId,
    desc: it.catalogId==='__custom__' ? (document.getElementById('ni-desc-'+i)||{value:it.desc}).value : it.desc,
    qty: (document.getElementById('ni-qty-'+i)||{value:it.qty}).value,
    price: (document.getElementById('ni-price-'+i)||{value:it.price}).value,
  }));
  p.paid = (document.getElementById('n-paid')||{value:p.paid}).value;
  p.notes = (document.getElementById('n-notes')||{value:p.notes}).value;
  p.saleType = (document.getElementById('n-sale-type')||{value:p.saleType||'venta'}).value;
  p.clientId = (document.getElementById('n-client')||{value:p.clientId}).value;
  p.date = (document.getElementById('n-date')||{value:p.date}).value;
  p.extraDiscount = (document.getElementById('n-extra-discount')||{value:p.extraDiscount}).value;
}
function addNoteItemRow(){ syncNoteItemsFromDOM(); state.modal.payload.items.push(blankItem()); renderModal(); }
function removeNoteItemRow(i){ syncNoteItemsFromDOM(); state.modal.payload.items.splice(i,1); if(state.modal.payload.items.length===0) state.modal.payload.items.push(blankItem()); renderModal(); }
function onItemProductSelect(i, value){
  syncNoteItemsFromDOM();
  const p = state.modal.payload;
  if(value==='__custom__'){
    p.items[i] = { catalogId:'__custom__', desc: p.items[i].desc||'', qty: p.items[i].qty||1, price: p.items[i].price||0 };
  } else {
    const prod = catalog.find(c=>c.id===value);
    if(prod){ p.items[i] = { catalogId: prod.id, desc: prod.name, qty: p.items[i].qty||1, price: prod.price }; }
    else { p.items[i] = { catalogId:'', desc:'', qty: p.items[i].qty||1, price: p.items[i].price||0 }; }
  }
  renderModal();
}
function modalNoteForm(){
  const p = state.modal.payload;
  if(clients.length===0){
    return `<div class="modal-title"><span>Nueva nota de venta</span><button onclick="closeModal()">✕</button></div>
      <div class="empty">Primero agrega un cliente para poder registrar una venta.</div>`;
  }
  const subtotal = p.items.reduce((s,it)=> s + (Number(it.qty)||0)*(Number(it.price)||0), 0);
  const selectedClient = getClient(p.clientId);
  const clientPct = selectedClient ? Number(selectedClient.discount)||0 : 0;
  const extraPct = Number(p.extraDiscount)||0;
  const totalPct = Math.min(100, clientPct + extraPct);
  const discountAmount = subtotal * totalPct/100;
  const total = subtotal - discountAmount;
  const clientOptions = clients.slice().sort((a,b)=>a.name.localeCompare(b.name))
    .map(c=>`<option value="${c.id}" ${p.clientId===c.id?'selected':''}>${esc(c.name)}${c.discount>0?` (-${c.discount}%)`:''}</option>`).join('');
  const sortedCatalog = catalog.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const itemRows = p.items.map((it,i)=>{
    const isCustom = it.catalogId==='__custom__';
    const catOptions = sortedCatalog.map(c=>`<option value="${c.id}" ${it.catalogId===c.id?'selected':''}>${esc(c.name)} — ${fmt(c.price)}</option>`).join('');
    const itemSubtotal = (Number(it.qty)||0)*(Number(it.price)||0);
    return `<div class="item-block">
      <div class="row-between" style="gap:6px;">
        <select style="flex:1;" onchange="onItemProductSelect(${i}, this.value)">
          <option value="" ${it.catalogId===''?'selected':''} disabled>Selecciona producto...</option>
          ${catOptions}
          <option value="__custom__" ${isCustom?'selected':''}>✏️ Escribir manualmente</option>
        </select>
        <button class="removebtn" onclick="removeNoteItemRow(${i})">✕</button>
      </div>
      ${isCustom ? `<input type="text" id="ni-desc-${i}" placeholder="Nombre del producto" value="${esc(it.desc)}" style="margin-top:6px;">` : ''}
      <div class="qtyprice">
        <div><label>Cantidad</label><input type="number" id="ni-qty-${i}" min="0" step="any" value="${it.qty}" oninput="livePreviewTotal()"></div>
        <div><label>Precio</label><input type="number" id="ni-price-${i}" min="0" step="any" value="${it.price}" oninput="livePreviewTotal()"></div>
      </div>
      <div class="subtotal" id="ni-subtotal-${i}">Subtotal: ${fmt(itemSubtotal)}</div>
    </div>`;
  }).join('');
  return `
    <div class="modal-title"><span>Nueva nota de venta</span><button onclick="closeModal()">✕</button></div>
    <label>Cliente *</label>
    <select id="n-client" onchange="onNoteClientChange(this.value)">${clientOptions}</select>
    ${clientPct>0 ? `<div class="hint">Este cliente tiene un descuento fijo de ${clientPct}% — se aplica automáticamente en todas sus compras.</div>` : ''}
    <label>Fecha</label>
    <input type="date" id="n-date" value="${p.date}">
    <label>Tipo de operación *</label>
    <select id="n-sale-type" onchange="onSaleTypeChange(this.value)">
      <option value="venta" ${(p.saleType||'venta')==='venta'?'selected':''}>Venta normal</option>
      <option value="consignacion" ${(p.saleType||'venta')==='consignacion'?'selected':''}>Consignación</option>
    </select>
    <div class="hint">La consignación descuenta inventario al surtirse, pero no genera adeudo ni permite registrar pago hasta convertirla en venta.</div>
    <label>Productos</label>
    ${sortedCatalog.length===0 ? `<div class="hint" style="margin-bottom:6px;">Aún no tienes productos en tu catálogo. Puedes escribirlos manualmente aquí, o ir a "📦 Catálogo" para guardarlos con precio y no volver a escribirlos.</div>` : ''}
    ${itemRows}
    <button class="btn btn-outline btn-sm" onclick="addNoteItemRow()">${ICONS.plus} Agregar producto</button>
    <label>Descuento extra por única vez (%)</label>
    <input type="number" id="n-extra-discount" min="0" max="100" step="any" value="${p.extraDiscount}" placeholder="0" oninput="livePreviewTotal()">
    <div class="hint">Solo aplica a esta nota de venta — no cambia el descuento fijo del cliente.</div>
    <div class="total-strip"><span>Subtotal</span><span class="mono" id="n-subtotal-value">${fmt(subtotal)}</span></div>
    <div class="total-strip"><span>Descuento (<span id="n-discount-pct">${totalPct}</span>%)</span><span class="mono" id="n-discount-value">-${fmt(discountAmount)}</span></div>
    <div class="total-strip" id="n-total-strip"><span>Total de la nota</span><span class="mono" style="font-size:17px;" id="n-total-value">${fmt(total)}</span></div>
    <label>¿Pagó algo en este momento?</label>
    <input type="number" id="n-paid" min="0" step="any" value="${(p.saleType||'venta')==='consignacion'?0:p.paid}" placeholder="0.00" ${(p.saleType||'venta')==='consignacion'?'disabled':''}>
    ${(p.saleType||'venta')==='consignacion'?`<div class="hint">Las consignaciones no se cobran al registrarse.</div>`:''}
    <label>Notas (opcional)</label>
    <textarea id="n-notes" placeholder="Comentarios sobre la venta...">${esc(p.notes)}</textarea>
    <div class="btnrow">
      <button class="btn btn-primary btn-block" onclick="submitNoteForm()">Guardar nota de venta</button>
    </div>
  `;
}
function onSaleTypeChange(value){
  syncNoteItemsFromDOM();
  state.modal.payload.saleType=value;
  if(value==='consignacion') state.modal.payload.paid=0;
  renderModal();
}
function livePreviewTotal(){
  const p = state.modal.payload;
  let subtotal = 0;
  p.items.forEach((it,i)=>{
    const qtyEl = document.getElementById('ni-qty-'+i);
    const priceEl = document.getElementById('ni-price-'+i);
    const qty = qtyEl ? Number(qtyEl.value)||0 : Number(it.qty)||0;
    const price = priceEl ? Number(priceEl.value)||0 : Number(it.price)||0;
    const itemSubtotal = qty*price;
    subtotal += itemSubtotal;
    const subEl = document.getElementById('ni-subtotal-'+i);
    if(subEl) subEl.textContent = 'Subtotal: ' + fmt(itemSubtotal);
  });
  const clientSelect = document.getElementById('n-client');
  const client = getClient(clientSelect ? clientSelect.value : p.clientId);
  const clientPct = client ? Number(client.discount)||0 : 0;
  const extraEl = document.getElementById('n-extra-discount');
  const extraPct = extraEl ? Number(extraEl.value)||0 : 0;
  const totalPct = Math.min(100, clientPct + extraPct);
  const discountAmount = subtotal * totalPct/100;
  const total = subtotal - discountAmount;
  const subtotalEl = document.getElementById('n-subtotal-value');
  if(subtotalEl) subtotalEl.textContent = fmt(subtotal);
  const discountPctEl = document.getElementById('n-discount-pct');
  if(discountPctEl) discountPctEl.textContent = totalPct;
  const discountValEl = document.getElementById('n-discount-value');
  if(discountValEl) discountValEl.textContent = '-' + fmt(discountAmount);
  const totalEl = document.getElementById('n-total-value');
  if(totalEl) totalEl.textContent = fmt(total);
}
function submitNoteForm(){
  syncNoteItemsFromDOM();
  const p = state.modal.payload;
  if(!p.clientId){ showToast('Selecciona un cliente'); return; }
  const items = p.items
    .map(it=>({
      desc: (it.desc||'').trim() || 'Producto',
      qty: Number(it.qty)||0,
      price: Number(it.price)||0,
      catalogId: (it.catalogId && it.catalogId!=='__custom__') ? it.catalogId : null,
    }))
    .filter(it => it.qty>0 || it.price>0);
  if(items.length===0){ showToast('Agrega al menos un producto'); return; }
  const client = getClient(p.clientId);
  const clientDiscountPct = client ? Number(client.discount)||0 : 0;
  const extraDiscountPct = Math.min(100, Math.max(0, Number(p.extraDiscount)||0));
  const shortages = getStockShortages(items);
  const isOrder = shortages.length>0;
  const saleType = p.saleType==='consignacion' ? 'consignacion' : 'venta';
  const note = addNote({
    clientId: p.clientId,
    date: p.date || todayISO(),
    items,
    saleType,
    paid: (isOrder || saleType==='consignacion') ? 0 : (Number(p.paid)||0),
    notes: (p.notes||'').trim(),
    clientDiscountPct,
    extraDiscountPct,
    fulfillmentStatus: isOrder ? 'pedido' : 'entregada',
    inventoryApplied: !isOrder,
    consignmentStatus: saleType==='consignacion' ? 'activa' : null,
  });
  if(!isOrder) applyInventorySale(items,note.id,note.date);
  closeModal(); renderApp();
  if(isOrder){
    showToast(saleType==='consignacion' ? 'Pedido en consignación guardado; falta inventario' : 'Pedido guardado sin cobrar; falta inventario');
  }else if(saleType==='consignacion'){
    showToast('Consignación guardada sin generar adeudo');
  }else{
    showToast('Nota de venta guardada');
  }
}

/* --- Nota detail modal --- */
function openNoteDetail(id){ openModal('noteDetail', {id}); }
function modalNoteDetail(){
  const n = notes.find(x=>x.id===state.modal.payload.id);
  if(!n){ return `<div class="empty">Esta nota ya no existe.</div>`; }
  const c = getClient(n.clientId);
  const info = computeEffectiveNoteStatuses().get(n.id) || { allocated:0, saldo: Math.max(0, Math.round((n.total-(n.paid||0))*100)/100), status:'pendiente' };
  const subtotal = n.subtotal!=null ? n.subtotal : n.total;
  const clientPct = n.clientDiscountPct||0;
  const extraPct = n.extraDiscountPct||0;
  const totalPct = Math.min(100, clientPct+extraPct);
  const itemsHTML = n.items.map(it=>`
    <div class="row-between" style="padding:6px 0;border-bottom:1px dashed var(--paper-line);font-size:13.5px;">
      <span>${esc(it.desc)} <span class="meta">x${it.qty}</span></span>
      <span class="mono">${fmt(it.qty*it.price)}</span>
    </div>`).join('');
  const discountLine = totalPct>0 ? `
    <div class="total-strip"><span>Subtotal</span><span class="mono">${fmt(subtotal)}</span></div>
    <div class="total-strip"><span>Descuento (${clientPct>0?`fijo ${clientPct}%`:''}${clientPct>0&&extraPct>0?' + ':''}${extraPct>0?`única vez ${extraPct}%`:''})</span><span class="mono">-${fmt(n.discountAmount||0)}</span></div>
  ` : '';
  const isOrder = n.fulfillmentStatus==='pedido';
  const isConsignment = isConsignmentNote(n);
  const statusLabel = isOrder ? (isConsignment?'Pedido en consignación pendiente de surtir':'Pedido pendiente de surtir') : (isConsignment ? 'Consignación activa' : (info.status==='pagada' ? 'Pagada' : info.status==='parcial' ? 'Parcial' : 'Pendiente'));
  const statusColor = (isOrder || isConsignment) ? 'var(--gold-dark)' : (info.status==='pagada' ? 'var(--green)' : info.status==='pendiente' ? 'var(--red)' : 'var(--blue)');
  return `
    <div class="modal-title"><span>${isConsignment?'Consignación':'Nota de venta'}</span><button onclick="closeModal()">✕</button></div>
    <div class="meta">${esc(c?c.name:'(cliente eliminado)')} · ${fmtDate(n.date)}</div>
    <div class="hint" style="margin-top:4px;">Folio: <strong class="mono">${esc(noteFolio(n))}</strong></div>
    <div style="margin-top:10px;">${itemsHTML}</div>
    ${discountLine}
    <div class="total-strip"><span>Total</span><span class="mono">${fmt(n.total)}</span></div>
    <div class="total-strip"><span>${isConsignment?'Cobrado':'Pagado en la venta'}</span><span class="mono">${fmt(n.paid||0)}</span></div>
    ${isOrder?`<div class="hint" style="background:#F8E8C7;padding:10px;border-radius:8px;margin-top:10px;">Este registro es un pedido. No genera adeudo ni permite cobro hasta que haya inventario y se marque como surtido.</div>`:''}
    ${isConsignment&&!isOrder?`<div class="hint" style="background:#F8E8C7;padding:10px;border-radius:8px;margin-top:10px;">La mercancía está en consignación. No genera adeudo hasta convertirla en venta.</div>`:''}
    ${info.allocated>0.004?`<div class="total-strip"><span>Abonos posteriores aplicados</span><span class="mono">${fmt(info.allocated)}</span></div>`:''}
    <div class="total-strip"><span>Estado</span><span class="mono" style="color:${statusColor};">${statusLabel}</span></div>
    <div class="total-strip"><span>${isConsignment?'Saldo exigible':'Saldo de esta nota'}</span><span class="mono ${(!isConsignment&&info.saldo>0.004)?'owed':'clear'}">${isConsignment?'No genera adeudo':(info.saldo>0.004?fmt(info.saldo):'Cubierto')}</span></div>
    ${n.notes?`<div class="hint" style="margin-top:8px;">${esc(n.notes)}</div>`:''}
    <div class="btnrow">
      ${isOrder?`<button class="btn btn-gold btn-block" onclick="fulfillOrder('${n.id}')">Surtir pedido</button>`:''}
      ${isConsignment&&!isOrder?`<button class="btn btn-primary btn-block" onclick="convertConsignmentToSale('${n.id}')">Convertir a venta</button>`:''}
      <button class="btn btn-outline btn-block" onclick="printNoteTicket('${n.id}','58')">🖨 Ticket 58 mm</button>
      <button class="btn btn-outline btn-block" onclick="printNoteTicket('${n.id}','80')">🖨 Ticket 80 mm / PDF</button>
      <button class="btn btn-danger btn-block" onclick="confirmDeleteNote('${n.id}')">Eliminar nota</button>
    </div>
  `;
}
function printNoteTicket(id,width='80'){
  const note=notes.find(n=>n.id===id);
  if(!note){ showToast('No se encontró la nota'); return; }

  const ticketLogoData = 'data:image/png;base64,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';
  const client=getClient(note.clientId);
  const info=computeEffectiveNoteStatuses().get(note.id) || {
    saldo:Math.max(0,(Number(note.total)||0)-(Number(note.paid)||0)),
    status:'pendiente'
  };
  const isOrder=note.fulfillmentStatus==='pedido';
  const isConsignment=isConsignmentNote(note);
  const operationTitle=isOrder
    ? (isConsignment?'PEDIDO EN CONSIGNACIÓN':'PEDIDO')
    : (isConsignment?'CONSIGNACIÓN':'NOTA DE VENTA');
  const statusText=isOrder
    ? 'PENDIENTE DE SURTIR'
    : (isConsignment?'MERCANCÍA EN CONSIGNACIÓN':(info.saldo>0.004?`SALDO PENDIENTE ${fmt(info.saldo)}`:'PAGADA'));
  const seller=note.createdByName || sellerName(note.sellerId) || currentProfile?.name || currentUser?.email || 'Sin especificar';
  const items=(note.items||[]).map(item=>{
    const qty=Number(item.qty)||0;
    const price=Number(item.price)||0;
    return `<tr>
      <td class="qty">${qty}</td>
      <td class="desc">${esc(item.desc||'Producto')}<small>${fmt(price)} c/u</small></td>
      <td class="amount">${fmt(qty*price)}</td>
    </tr>`;
  }).join('');

  const pageWidth=width==='58'?'58mm':'80mm';
  const contentWidth=width==='58'?'52mm':'74mm';
  const fontSize=width==='58'?'10.5px':'12px';
  const titleSize=width==='58'?'14px':'17px';
  const ticketHtml=`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(noteFolio(note))}</title>
<style>
  @page{size:${pageWidth} auto;margin:2mm;}
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;}
  body{width:${contentWidth};margin:0 auto;font-size:${fontSize};line-height:1.28;}
  .ticket{width:100%;padding:1mm 0 2mm;}
  .ticket-logo-wrap{text-align:center;margin:0 auto 2.2mm;}
  .ticket-logo-img{display:block;width:${width==='58'?'43mm':'56mm'};max-width:92%;height:auto;margin:0 auto;object-fit:contain;}
  .document{text-align:center;font-size:${titleSize};font-weight:900;letter-spacing:.08em;margin-top:3mm;}
  .folio{text-align:center;font-weight:800;margin-top:1mm;}
  .date{text-align:center;font-size:.9em;margin-top:.5mm;}
  .rule{border-top:1px dashed #000;margin:2.5mm 0;}
  .info{display:grid;grid-template-columns:auto 1fr;gap:1mm 2mm;margin:.8mm 0;}
  .label{font-weight:800;}
  table{width:100%;border-collapse:collapse;}
  .items th{font-size:.82em;text-transform:uppercase;border-bottom:1px solid #000;padding:1mm 0;text-align:left;}
  .items td{padding:1.5mm 0;border-bottom:1px dotted #777;vertical-align:top;}
  .items .qty{width:8mm;text-align:center;font-weight:800;}
  .items .desc{padding-right:1mm;}
  .items .desc small{display:block;font-size:.82em;margin-top:.4mm;}
  .items .amount,.items th:last-child{text-align:right;white-space:nowrap;font-weight:800;}
  .totals td{padding:.8mm 0;}
  .totals td:last-child{text-align:right;white-space:nowrap;font-weight:800;}
  .totals .grand td{font-size:1.35em;font-weight:900;border-top:2px solid #000;padding-top:1.5mm;}
  .status{margin:2.5mm 0 1mm;border:2px solid #000;padding:1.6mm;text-align:center;font-weight:900;letter-spacing:.04em;}
  .notice{font-size:.85em;text-align:center;margin:1.5mm 0;}
  .notes{font-size:.88em;white-space:pre-wrap;margin-top:1mm;}
  .footer{text-align:center;margin-top:3mm;font-size:.86em;}
  .footer strong{display:block;font-size:1.05em;margin-bottom:.5mm;}
</style>
</head>
<body>
<section class="ticket">
  <div class="ticket-logo-wrap"><img src="${ticketLogoData}" class="ticket-logo-img" alt="SalsaMix"></div>
  <div class="document">${operationTitle}</div>
  <div class="folio">${esc(noteFolio(note))}</div>
  <div class="date">${esc(formatTicketDate(note))}</div>
  <div class="rule"></div>
  <div class="info"><span class="label">Cliente:</span><span>${esc(client?.name||'Cliente eliminado')}</span></div>
  ${client?.ownerName?`<div class="info"><span class="label">Encargado:</span><span>${esc(client.ownerName)}</span></div>`:''}
  <div class="info"><span class="label">Vendedor:</span><span>${esc(seller)}</span></div>
  <div class="rule"></div>
  <table class="items">
    <thead><tr><th>Cant.</th><th>Producto</th><th>Importe</th></tr></thead>
    <tbody>${items}</tbody>
  </table>
  <div class="rule"></div>
  <table class="totals"><tbody>
    <tr><td>Subtotal</td><td>${fmt(note.subtotal!=null?note.subtotal:note.total)}</td></tr>
    ${(Number(note.discountAmount)||0)>0?`<tr><td>Descuento</td><td>-${fmt(note.discountAmount)}</td></tr>`:''}
    <tr class="grand"><td>TOTAL</td><td>${fmt(note.total)}</td></tr>
    <tr><td>Pago inicial</td><td>${fmt(note.paid||0)}</td></tr>
    ${!isConsignment&&!isOrder?`<tr><td>Saldo</td><td>${fmt(info.saldo||0)}</td></tr>`:''}
  </tbody></table>
  <div class="status">${esc(statusText)}</div>
  ${isConsignment?`<div class="notice">Mercancía entregada en consignación.<br>No genera adeudo hasta convertirse en venta.</div>`:''}
  ${isOrder?`<div class="notice">Documento pendiente de surtir.</div>`:''}
  ${note.notes?`<div class="rule"></div><div class="label">Observaciones:</div><div class="notes">${esc(note.notes)}</div>`:''}
  <div class="rule"></div>
  <div class="footer"><strong>Gracias por su preferencia</strong></div>
</section>
<script>
  window.addEventListener('load',()=>{
    const logo=document.querySelector('.ticket-logo-img');
    const printNow=()=>setTimeout(()=>{ window.focus(); window.print(); },80);
    if(!logo || logo.complete){ printNow(); return; }
    let finished=false;
    const done=()=>{ if(finished) return; finished=true; printNow(); };
    logo.addEventListener('load',done,{once:true});
    logo.addEventListener('error',done,{once:true});
    setTimeout(done,1500);
  });
<\/script>
</body>
</html>`;

  document.getElementById('ticket-print-frame')?.remove();
  const frame=document.createElement('iframe');
  frame.id='ticket-print-frame';
  frame.setAttribute('title','Ticket de impresión');
  frame.style.position='fixed';
  frame.style.width=pageWidth;
  frame.style.height='1px';
  frame.style.left='-10000px';
  frame.style.top='0';
  frame.style.border='0';
  frame.style.opacity='0';
  frame.srcdoc=ticketHtml;
  document.body.appendChild(frame);

  const cleanup=()=>{
    setTimeout(()=>frame.remove(),1000);
    window.removeEventListener('focus',cleanup);
  };
  window.addEventListener('focus',cleanup,{once:true});
  setTimeout(()=>frame.remove(),60000);
}

function convertConsignmentToSale(id){
  const note=notes.find(n=>n.id===id);
  if(!note || !isConsignmentNote(note) || note.fulfillmentStatus==='pedido') return;
  note.saleType='venta';
  note.consignmentStatus='convertida';
  note.convertedAt=new Date().toISOString();
  Object.assign(note,actorFields('updated'));
  saveNotes(); closeModal(); renderApp(); showToast('Consignación convertida en venta; ya genera adeudo');
}
function confirmDeleteNote(id){
  openModal('confirm', {
    title:'Eliminar nota de venta',
    body:'¿Seguro que quieres eliminar esta nota de venta? Esta acción no se puede deshacer.',
    onConfirm: () => { deleteNote(id); closeModal(); renderApp(); }
  });
}

/* --- Pago form modal --- */
function openPaymentForm(clientId){
  openModal('paymentForm', { clientId: clientId || (clients[0]?clients[0].id:''), amount:'', method:'efectivo', date: todayISO(), notes:'' });
}
function modalPaymentForm(){
  const p = state.modal.payload;
  if(clients.length===0){
    return `<div class="modal-title"><span>Registrar pago</span><button onclick="closeModal()">✕</button></div>
      <div class="empty">Primero agrega un cliente.</div>`;
  }
  const clientOptions = clients.slice().sort((a,b)=>a.name.localeCompare(b.name))
    .map(c=>`<option value="${c.id}" ${p.clientId===c.id?'selected':''}>${esc(c.name)} — saldo ${fmt(balanceFor(c.id))}</option>`).join('');
  return `
    <div class="modal-title"><span>Registrar pago</span><button onclick="closeModal()">✕</button></div>
    <label>Cliente *</label>
    <select id="p-client">${clientOptions}</select>
    <label>Monto recibido *</label>
    <input type="number" id="p-amount" min="0" step="any" value="${p.amount}" placeholder="0.00">
    <label>Método de pago *</label>
    <select id="p-method">
      <option value="efectivo" ${p.method==='efectivo'?'selected':''}>Efectivo</option>
      <option value="transferencia" ${p.method==='transferencia'?'selected':''}>Transferencia</option>
      <option value="tarjeta" ${p.method==='tarjeta'?'selected':''}>Tarjeta</option>
    </select>
    <label>Fecha</label>
    <input type="date" id="p-date" value="${p.date}">
    <label>Notas (opcional)</label>
    <textarea id="p-notes" placeholder="Ej. Abono a cuenta">${esc(p.notes)}</textarea>
    <div class="btnrow">
      <button class="btn btn-primary btn-block" onclick="submitPaymentForm()">Guardar pago</button>
    </div>
  `;
}
function submitPaymentForm(){
  const clientId = document.getElementById('p-client').value;
  const amount = Number(document.getElementById('p-amount').value);
  const method = document.getElementById('p-method').value;
  const date = document.getElementById('p-date').value || todayISO();
  const notesVal = document.getElementById('p-notes').value.trim();
  if(!clientId){ showToast('Selecciona un cliente'); return; }
  if(!amount || amount<=0){ showToast('Ingresa un monto válido'); return; }
  addPayment({ clientId, amount, method, date, notes: notesVal });
  closeModal(); renderApp();
  showToast('Pago registrado');
}

/* --- Catálogo modal --- */
function modalCatalogManage(){
  const payload = state.modal.payload;
  const sorted = catalog.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const rows = sorted.map(p=>{
    if(payload.editingId===p.id){
      return `<div class="catalog-row" style="display:block;">
        <label style="margin-top:0;">Nombre</label><input type="text" id="ce-name-${p.id}" value="${esc(p.name)}">
        <label>Categoría</label><input type="text" id="ce-category-${p.id}" value="${esc(p.category||'')}">
        <label>Precio de venta</label><input type="number" id="ce-price-${p.id}" min="0" step="any" value="${Number(p.price)||0}">
        <label>Costo</label><input type="number" id="ce-cost-${p.id}" min="0" step="any" value="${Number(p.cost)||0}">
        <label>Existencias</label><input type="number" id="ce-stock-${p.id}" min="0" step="1" value="${productStock(p)}">
        <label>Stock mínimo</label><input type="number" id="ce-minstock-${p.id}" min="0" step="1" value="${productMinStock(p)}">
        <div class="btnrow"><button class="btn btn-primary btn-sm" onclick="saveEditProduct('${p.id}')">Guardar</button><button class="btn btn-outline btn-sm" onclick="cancelEditProduct()">Cancelar</button></div>
      </div>`;
    }
    const status=stockStatus(p);
    return `<div class="catalog-row"><div><div class="cname">${esc(p.name)}</div><div class="meta">${p.category?`<span class="badge zone">${esc(p.category)}</span> `:''}<span class="mono">${fmt(p.price)}</span> · Stock ${productStock(p)} <span class="badge" style="background:${status.bg};color:${status.color};">${status.label}</span></div></div><div style="display:flex;gap:6px;"><button class="btn btn-outline btn-sm" onclick="startEditProduct('${p.id}')">Editar</button><button class="removebtn" style="padding:0 10px;" onclick="deleteProduct('${p.id}'); renderModal();">✕</button></div></div>`;
  }).join('');
  return `<div class="modal-title"><span>Catálogo de productos</span><button onclick="closeModal()">✕</button></div>
    <label>Nuevo producto</label><input type="text" id="new-prod-name" placeholder="Nombre del producto">
    <label>Categoría</label><input type="text" id="new-prod-category" placeholder="Ej. Salsas">
    <label>Precio de venta</label><input type="number" id="new-prod-price" min="0" step="any" placeholder="0.00">
    <label>Costo</label><input type="number" id="new-prod-cost" min="0" step="any" placeholder="0.00">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><div><label>Existencias</label><input type="number" id="new-prod-stock" min="0" step="1" value="0"></div><div><label>Stock mínimo</label><input type="number" id="new-prod-minstock" min="0" step="1" value="0"></div></div>
    <button class="btn btn-gold btn-block" style="margin-top:12px;" onclick="submitNewProduct()">+ Agregar al catálogo</button>
    <div class="section-title">Tus productos</div>${sorted.length===0?`<div class="empty" style="padding:20px 8px;">Aún no tienes productos guardados.</div>`:rows}`;
}
function submitNewProduct(){
  const name=document.getElementById('new-prod-name').value.trim();
  const category=document.getElementById('new-prod-category').value.trim();
  const price=Number(document.getElementById('new-prod-price').value);
  const cost=Number(document.getElementById('new-prod-cost').value)||0;
  const stock=Math.max(0,Number(document.getElementById('new-prod-stock').value)||0);
  const minStock=Math.max(0,Number(document.getElementById('new-prod-minstock').value)||0);
  if(!name){showToast('Escribe el nombre del producto');return;}
  if(price<0 || !Number.isFinite(price)){showToast('Ingresa un precio válido');return;}
  const product={name,category,price,cost,stock,minStock}; addProduct(product);
  if(stock>0){ const created=catalog[catalog.length-1]; addInventoryMovement(created.id,'entrada',stock,{reason:'Existencia inicial'}); saveInventoryMovements(); }
  renderModal();
}
function startEditProduct(id){state.modal.payload.editingId=id;renderModal();}
function cancelEditProduct(){state.modal.payload.editingId=null;renderModal();}
function saveEditProduct(id){
  const product=catalog.find(p=>p.id===id); if(!product)return;
  const oldStock=productStock(product);
  const name=document.getElementById('ce-name-'+id).value.trim();
  const category=document.getElementById('ce-category-'+id).value.trim();
  const price=Number(document.getElementById('ce-price-'+id).value);
  const cost=Math.max(0,Number(document.getElementById('ce-cost-'+id).value)||0);
  const stock=Math.max(0,Number(document.getElementById('ce-stock-'+id).value)||0);
  const minStock=Math.max(0,Number(document.getElementById('ce-minstock-'+id).value)||0);
  if(!name){showToast('Escribe el nombre del producto');return;}
  if(price<0 || !Number.isFinite(price)){showToast('Ingresa un precio válido');return;}
  updateProduct(id,{name,category,price,cost,stock,minStock});
  const difference=stock-oldStock;
  if(difference!==0){addInventoryMovement(id,'ajuste',difference,{reason:'Ajuste manual de existencias'});saveInventoryMovements();}
  state.modal.payload.editingId=null;renderModal();
}

/* --- Estadísticas de ventas (más vendidos) --- */
function modalSalesStats(){
  const productStats = computeProductStats();
  if(productStats.length===0){
    return `<div class="modal-title"><span>Productos más vendidos</span><button onclick="closeModal()">✕</button></div>
      <div class="empty">Aún no hay ventas registradas para mostrar estadísticas.</div>`;
  }
  const categoryStats = computeCategoryStats(productStats);
  const maxCatQty = Math.max(...categoryStats.map(cs=>cs.qty), 1);
  const categoryRows = categoryStats.map(cs=>`
    <div style="margin-bottom:10px;">
      <div class="row-between" style="font-size:13px;font-weight:700;">
        <span>${esc(cs.category)}</span>
        <span class="mono">${cs.qty} uds · ${fmt(cs.revenue)}</span>
      </div>
      <div style="background:var(--paper-line);border-radius:6px;height:8px;margin-top:4px;overflow:hidden;">
        <div style="background:var(--gold);height:100%;width:${Math.round(cs.qty/maxCatQty*100)}%;"></div>
      </div>
    </div>`).join('');
  const productRows = productStats.map((ps,i)=>`
    <div class="row-between" style="padding:7px 0;border-bottom:1px dashed var(--paper-line);gap:8px;">
      <div style="flex:1;">
        <div style="font-size:13.5px;font-weight:700;">${i+1}. ${esc(ps.name)}</div>
        <div class="meta">${esc(ps.category)}</div>
      </div>
      <div style="text-align:right;white-space:nowrap;">
        <div class="mono" style="font-weight:700;">${ps.qty} uds</div>
        <div class="meta mono">${fmt(ps.revenue)}</div>
      </div>
    </div>`).join('');
  return `
    <div class="modal-title"><span>Productos más vendidos</span><button onclick="closeModal()">✕</button></div>
    <div class="section-title">Por categoría</div>
    ${categoryRows}
    <div class="section-title">Ranking de productos (más a menos vendido)</div>
    ${productRows}
  `;
}

/* --- Vendedores (sin Cloud Functions) --- */
function modalUsersManage(){
  if(!isAdmin()) return `<div class="modal-title"><span>Acceso restringido</span><button onclick="closeModal()">✕</button></div><div class="empty">Solo el administrador puede consultar vendedores.</div>`;
  const rows=sellers.slice().sort((a,b)=>(a.name||a.email||'').localeCompare(b.name||b.email||'')).map(s=>`
    <div class="card">
      <div class="row-between">
        <div><div class="name">${esc(s.name||'Sin nombre')}</div><div class="meta">${esc(s.email||'')} · ${esc(s.role||'vendedor')}</div></div>
        <span class="badge" style="background:${s.active===false?'var(--red-bg)':'var(--green-bg)'};color:${s.active===false?'var(--red)':'var(--green)'}">${s.active===false?'Inactivo':'Activo'}</span>
      </div>
      <div class="meta" style="margin-top:8px;">Clientes asignados: ${clients.filter(c=>c.assignedTo===s.uid).length}</div>
    </div>`).join('');
  return `<div class="modal-title"><span>Vendedores</span><button onclick="closeModal()">✕</button></div>
    <div class="hint" style="margin-bottom:12px;">Los usuarios se crean en Firebase Authentication. Deben iniciar sesión una vez para aparecer aquí.</div>
    ${rows || `<div class="empty">Todavía no aparecen perfiles de vendedores.</div>`}`;
}

/* --- Confirm modal --- */
function modalConfirm(){
  const p = state.modal.payload;
  window.__confirmAction = p.onConfirm;
  return `
    <div class="modal-title"><span>${esc(p.title)}</span><button onclick="closeModal()">✕</button></div>
    <div style="font-size:14px;line-height:1.5;">${p.body}</div>
    <div class="btnrow">
      <button class="btn btn-outline btn-block" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger btn-block" onclick="runConfirmAction()">Sí, eliminar</button>
    </div>
  `;
}
function runConfirmAction(){ if(window.__confirmAction) window.__confirmAction(); }

document.addEventListener('click', (event)=>{
  if(state.topMenuOpen && !event.target.closest('.header-topline')) closeTopMenu();
});

/* ---------------- INSTALACIÓN PWA ---------------- */
function isPwaInstalled(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
async function installSalsaMix(){
  state.topMenuOpen=false;
  renderHeader();
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    renderHeader();
    return;
  }
  const isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(isiOS){
    showToast('En iPhone: Compartir → Añadir a pantalla de inicio');
  }else{
    showToast('Abre el menú del navegador y selecciona Instalar aplicación');
  }
}
window.addEventListener('beforeinstallprompt', event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  if(currentUser && currentProfile) renderHeader();
});
window.addEventListener('appinstalled', ()=>{
  deferredInstallPrompt=null;
  showToast('SalsaMix quedó instalada');
  if(currentUser && currentProfile) renderHeader();
});

window.addEventListener('online', ()=>{ syncState='syncing'; if(currentUser) syncCloudInBackground(); });
window.addEventListener('offline', ()=>{ syncState='offline'; if(loaded) renderHeader(); });

/* ---------------- INIT ---------------- */
window.addEventListener('salsamix-auth-change', async event=>{
  currentUser = event.detail.user;
  currentProfile = event.detail.profile;
  renderAuth();
  if(currentUser && currentProfile){
    clients=[]; notes=[]; payments=[]; catalog=[]; inventoryMovements=[]; visits=[]; purchases=[]; sellers=[];
    loaded = false;
    renderApp();
    await loadAll();
    state.routeDay = String(mondayIndexToday());
    renderApp();
  }else{
    loaded = false;
    clients=[]; notes=[]; payments=[]; catalog=[]; inventoryMovements=[]; visits=[]; purchases=[]; sellers=[]; syncState='idle';
    if(unsubscribeCloud){ unsubscribeCloud(); unsubscribeCloud=null; }
    if(unsubscribeUsers){ unsubscribeUsers(); unsubscribeUsers=null; }
  }
});

(async function init(){
  renderAuth();
  await window.firebaseReady;
  const authState = await window.authReady;
  currentUser = authState.user;
  currentProfile = authState.profile;
  renderAuth();
  if(currentUser && currentProfile){
    renderApp();
    await loadAll();
    state.routeDay = String(mondayIndexToday());
    renderApp();
  }
})();
