/* ---------------- STATE ---------------- */
let clients = [];
let notes = [];
let payments = [];
let catalog = [];
let inventoryMovements = [];
let visits = [];
let sellers = [];
let loaded = false;
let currentUser = null;
let currentProfile = null;
let unsubscribeCloud = null;
let unsubscribeUsers = null;

const state = {
  tab: 'clientes',
  clientDetailId: null,
  routeDay: 'todos',
  search: '',
  selectedSellerId: null,
  smartRoute: null, // {day, ids, chunks, currentChunk}
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
      <div class="auth-brand"><img src="assets/img/logo-full.png" alt="SalsaMix - Pruébala con todo" class="auth-logo"></div>
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
};

async function readLegacyValue(key){
  try{
    if(window.storage && typeof window.storage.get === 'function'){
      const result = await window.storage.get(key);
      if(result && result.value) return JSON.parse(result.value);
    }
  }catch(e){ console.warn('No se pudo leer window.storage:', key, e); }
  try{
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : [];
  }catch(e){ return []; }
}

function saveLocalBackup(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){}
}

async function loadAll(){
  try{
    await window.firebaseReady;
    const cloud = await window.firebaseStore.loadAll();
    sellers = await window.firebaseStore.loadUsers();
    const cloudHasData = Object.values(cloud.exists).some(Boolean);

    if(cloudHasData){
      clients = cloud.clients || [];
      notes = cloud.notes || [];
      payments = cloud.payments || [];
      catalog = cloud.catalog || [];
      inventoryMovements = cloud.inventoryMovements || [];
      visits = cloud.visits || [];
    }else{
      clients = await readLegacyValue(STORAGE_KEYS.clients);
      notes = await readLegacyValue(STORAGE_KEYS.notes);
      payments = await readLegacyValue(STORAGE_KEYS.payments);
      catalog = await readLegacyValue(STORAGE_KEYS.catalog);
      inventoryMovements = await readLegacyValue(STORAGE_KEYS.inventoryMovements);
      visits = await readLegacyValue(STORAGE_KEYS.visits);
      await window.firebaseStore.saveAll({clients, notes, payments, catalog, inventoryMovements, visits});
    }

    saveLocalBackup(STORAGE_KEYS.clients, clients);
    saveLocalBackup(STORAGE_KEYS.notes, notes);
    saveLocalBackup(STORAGE_KEYS.payments, payments);
    saveLocalBackup(STORAGE_KEYS.catalog, catalog);
    saveLocalBackup(STORAGE_KEYS.inventoryMovements, inventoryMovements);
    saveLocalBackup(STORAGE_KEYS.visits, visits);

    if(unsubscribeCloud) unsubscribeCloud();
    if(unsubscribeUsers) unsubscribeUsers();
    unsubscribeCloud = window.firebaseStore.subscribe((data)=>{
      if(data.clients) clients = data.clients;
      if(data.notes) notes = data.notes;
      if(data.payments) payments = data.payments;
      if(data.catalog) catalog = data.catalog;
      if(data.inventoryMovements) inventoryMovements = data.inventoryMovements;
      if(data.visits) visits = data.visits;
      if(loaded) renderApp();
    });
    unsubscribeUsers = window.firebaseStore.subscribeUsers((profiles)=>{ sellers = profiles; if(loaded) renderApp(); });
  }catch(e){
    console.error(e);
    clients = await readLegacyValue(STORAGE_KEYS.clients);
    notes = await readLegacyValue(STORAGE_KEYS.notes);
    payments = await readLegacyValue(STORAGE_KEYS.payments);
    catalog = await readLegacyValue(STORAGE_KEYS.catalog);
    inventoryMovements = await readLegacyValue(STORAGE_KEYS.inventoryMovements);
    visits = await readLegacyValue(STORAGE_KEYS.visits);
    showToast('Firebase no respondió; usando respaldo local');
  }
  loaded = true;
}

async function saveCollection(name, value, localKey){
  saveLocalBackup(localKey, value);
  try{
    await window.firebaseReady;
    await window.firebaseStore.save(name, value);
  }catch(e){
    console.error(e);
    showToast('No se pudo sincronizar con Firebase');
  }
}
async function saveClients(){ return saveCollection('clients', clients, STORAGE_KEYS.clients); }
async function saveNotes(){ return saveCollection('notes', notes, STORAGE_KEYS.notes); }
async function savePayments(){ return saveCollection('payments', payments, STORAGE_KEYS.payments); }
async function saveCatalog(){ return saveCollection('catalog', catalog, STORAGE_KEYS.catalog); }
async function saveInventoryMovements(){ return saveCollection('inventoryMovements', inventoryMovements, STORAGE_KEYS.inventoryMovements); }
async function saveVisits(){ return saveCollection('visits', visits, STORAGE_KEYS.visits); }

function showToast(msg){
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast">${esc(msg)}</div>`;
  setTimeout(()=>{ if(root.firstChild) root.innerHTML=''; }, 2200);
}

/* ---------------- DATA HELPERS ---------------- */
function getClient(id){ return clients.find(c=>c.id===id); }
function isDeliveredNote(note){ return note.fulfillmentStatus !== 'pedido'; }
function notesFor(id){ return notes.filter(n=>n.clientId===id).sort((a,b)=> b.date.localeCompare(a.date)); }
function paymentsFor(id){ return payments.filter(p=>p.clientId===id).sort((a,b)=> b.date.localeCompare(a.date)); }
function balanceFor(id){
  const collectableNotes = notes.filter(n=>n.clientId===id && isDeliveredNote(n));
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
  inventoryMovements.push({ id:uid(), productId, type, quantity:Number(quantity)||0, date:details.date||todayISO(), createdAt:new Date().toISOString(), noteId:details.noteId||null, reason:details.reason||'', ...actorFields('created') });
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
  const deliveredNotes = notes.filter(isDeliveredNote);
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
  const delivered=visibleNotes().filter(n=>n.date===today && ids.has(n.clientId) && isDeliveredNote(n));
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

  notes.filter(isDeliveredNote).forEach(note=>{
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
    clients.push({ id: uid(), createdAt: todayISO(), ...data, ...actorFields('created') });
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
  const note = {
    id: uid(),
    ...data,
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
function addPayment(data){ payments.push({ id: uid(), ...data, ...actorFields('created') }); savePayments(); }
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
  adeudos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1.4 1.2-2 2.5-2s2.5.7 2.5 2c0 3-5 1.7-5 4.7 0 1.3 1.2 2.3 2.5 2.3s2.5-.7 2.5-2"/></svg>',
  reportes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  inventario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 7v10l8 4 8-4V7"/><path d="M12 11v10"/></svg>',
  vendedores: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c.8-4 3.2-6 6-6s5.2 2 6 6"/><path d="M15 15c2.5.2 4.3 1.8 5 5"/></svg>',
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
      ${brandBar}
      <div class="subrow">
        <button class="backbtn" onclick="goBack()">${ICONS.back}<span>Clientes</span></button>
      </div>
      <div class="brand stamp" style="margin-top:6px;">${esc(c ? c.name : 'Cliente')}
        <small>Ficha de cliente</small>
      </div>`;
    return;
  }
  const titles = { clientes:'Mi Ruta', rutas:'Rutas de la semana', ventas:'Notas de venta', adeudos:'Adeudos', reportes:'Ventas por producto', inventario:'Inventario', vendedores:'Vendedores' };
  const userName = currentProfile ? (currentProfile.name || currentProfile.email || 'Usuario') : 'Usuario';
  const userRole = currentProfile ? (currentProfile.role || 'vendedor') : 'vendedor';
  el.innerHTML = `
    ${brandBar}
    <div class="brand stamp">${titles[state.tab]}<small>Libreta digital de ventas</small><div class="sync-status">☁ Sincronización Firebase</div></div>
    <div class="userbar"><div class="userbar-info"><div class="userbar-name">${esc(userName)}</div><div class="userbar-role">${esc(userRole)}</div></div><button class="logout-btn" onclick="logoutUser()">Salir</button></div>
    ${state.tab==='clientes' ? `<div class="search-wrap"><input type="text" placeholder="Buscar cliente..." value="${esc(state.search)}" oninput="onSearchInput(this.value)"></div>` : ''}
  `;
}

/* ---------------- RENDER: BOTTOM NAV ---------------- */
function renderBottomNav(){
  const el = document.getElementById('bottomnav');
  const tabs = isAdmin()
    ? [['clientes','Clientes'],['vendedores','Vendedores'],['rutas','Rutas'],['ventas','Ventas'],['adeudos','Adeudos'],['reportes','Productos'],['inventario','Inventario']]
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
}

function setTab(tab){
  if(!isAdmin() && ['reportes','inventario','vendedores'].includes(tab)){ showToast('Solo el administrador puede entrar'); return; }
  state.tab = tab; state.clientDetailId = null; renderApp();
}
function goBack(){
  const clientId=state.clientDetailId;
  if(clientId && state.tab==='rutas' && clientVisitStatus(clientId).key==='pendiente'){
    openModal('visitPrompt',{clientId});
    return;
  }
  state.clientDetailId = null; renderApp();
}
function onSearchInput(v){ state.search = v; document.getElementById('app').innerHTML = renderClientesTab(); }

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
          <div class="name">${esc(c.name)}</div>
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
    const deliveredSales = sellerSales.filter(isDeliveredNote);
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
    const delivered=sellerNotes(s.uid).filter(isDeliveredNote);
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
  </div>`;
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
          <div class="tl-head"><span>Nota de venta</span><span class="mono">${fmt(n.total)}</span></div>
          <div class="tl-sub">${n.items.length} producto(s) ${info.saldo>0.004?`· saldo ${fmt(info.saldo)}`:'· pagada'}</div>
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
          <div style="margin-top:4px;">${daysBadges}${c.discount>0?` <span class="badge discount">Descuento fijo -${c.discount}%</span>`:''}</div>
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
    <input type="number" id="n-paid" min="0" step="any" value="${p.paid}" placeholder="0.00">
    <label>Notas (opcional)</label>
    <textarea id="n-notes" placeholder="Comentarios sobre la venta...">${esc(p.notes)}</textarea>
    <div class="btnrow">
      <button class="btn btn-primary btn-block" onclick="submitNoteForm()">Guardar nota de venta</button>
    </div>
  `;
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
  const note = addNote({
    clientId: p.clientId,
    date: p.date || todayISO(),
    items,
    paid: isOrder ? 0 : (Number(p.paid)||0),
    notes: (p.notes||'').trim(),
    clientDiscountPct,
    extraDiscountPct,
    fulfillmentStatus: isOrder ? 'pedido' : 'entregada',
    inventoryApplied: !isOrder,
  });
  if(!isOrder) applyInventorySale(items,note.id,note.date);
  closeModal(); renderApp();
  if(isOrder){
    showToast('Pedido guardado sin cobrar; falta inventario');
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
  const statusLabel = isOrder ? 'Pedido pendiente de surtir' : (info.status==='pagada' ? 'Pagada' : info.status==='parcial' ? 'Parcial' : 'Pendiente');
  const statusColor = isOrder ? 'var(--gold-dark)' : (info.status==='pagada' ? 'var(--green)' : info.status==='pendiente' ? 'var(--red)' : 'var(--blue)');
  return `
    <div class="modal-title"><span>Nota de venta</span><button onclick="closeModal()">✕</button></div>
    <div class="meta">${esc(c?c.name:'(cliente eliminado)')} · ${fmtDate(n.date)}</div>
    <div style="margin-top:10px;">${itemsHTML}</div>
    ${discountLine}
    <div class="total-strip"><span>Total</span><span class="mono">${fmt(n.total)}</span></div>
    <div class="total-strip"><span>Pagado en la venta</span><span class="mono">${fmt(n.paid||0)}</span></div>
    ${isOrder?`<div class="hint" style="background:#F8E8C7;padding:10px;border-radius:8px;margin-top:10px;">Este registro es un pedido. No genera adeudo ni permite cobro hasta que haya inventario y se marque como surtido.</div>`:''}
    ${info.allocated>0.004?`<div class="total-strip"><span>Abonos posteriores aplicados</span><span class="mono">${fmt(info.allocated)}</span></div>`:''}
    <div class="total-strip"><span>Estado</span><span class="mono" style="color:${statusColor};">${statusLabel}</span></div>
    <div class="total-strip"><span>Saldo de esta nota</span><span class="mono ${info.saldo>0.004?'owed':'clear'}">${info.saldo>0.004?fmt(info.saldo):'Cubierto'}</span></div>
    ${n.notes?`<div class="hint" style="margin-top:8px;">${esc(n.notes)}</div>`:''}
    <div class="btnrow">
      ${isOrder?`<button class="btn btn-gold btn-block" onclick="fulfillOrder('${n.id}')">Surtir pedido</button>`:''}
      <button class="btn btn-danger btn-block" onclick="confirmDeleteNote('${n.id}')">Eliminar nota</button>
    </div>
  `;
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

/* ---------------- INIT ---------------- */
window.addEventListener('salsamix-auth-change', async event=>{
  currentUser = event.detail.user;
  currentProfile = event.detail.profile;
  renderAuth();
  if(currentUser && currentProfile){
    loaded = false;
    renderApp();
    await loadAll();
    state.routeDay = String(mondayIndexToday());
    renderApp();
  }else{
    loaded = false;
    clients=[]; notes=[]; payments=[]; catalog=[]; inventoryMovements=[]; sellers=[];
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
