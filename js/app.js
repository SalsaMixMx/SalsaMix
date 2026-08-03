/* ---------------- STATE ---------------- */
let clients = [];
let notes = [];
let payments = [];
let catalog = [];
let loaded = false;

const state = {
  tab: 'clientes',
  clientDetailId: null,
  routeDay: 'todos',
  search: '',
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
function mondayIndexToday(){ const j = new Date().getDay(); return j===0?6:j-1; }

/* ---------------- STORAGE / FIREBASE ---------------- */
const STORAGE_KEYS = {
  clients: 'clients-data',
  notes: 'notes-data',
  payments: 'payments-data',
  catalog: 'catalog-data',
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
    const cloudHasData = Object.values(cloud.exists).some(Boolean);

    if(cloudHasData){
      clients = cloud.clients || [];
      notes = cloud.notes || [];
      payments = cloud.payments || [];
      catalog = cloud.catalog || [];
    }else{
      clients = await readLegacyValue(STORAGE_KEYS.clients);
      notes = await readLegacyValue(STORAGE_KEYS.notes);
      payments = await readLegacyValue(STORAGE_KEYS.payments);
      catalog = await readLegacyValue(STORAGE_KEYS.catalog);
      await window.firebaseStore.saveAll({clients, notes, payments, catalog});
    }

    saveLocalBackup(STORAGE_KEYS.clients, clients);
    saveLocalBackup(STORAGE_KEYS.notes, notes);
    saveLocalBackup(STORAGE_KEYS.payments, payments);
    saveLocalBackup(STORAGE_KEYS.catalog, catalog);

    window.firebaseStore.subscribe((data)=>{
      if(data.clients) clients = data.clients;
      if(data.notes) notes = data.notes;
      if(data.payments) payments = data.payments;
      if(data.catalog) catalog = data.catalog;
      if(loaded) renderApp();
    });
  }catch(e){
    console.error(e);
    clients = await readLegacyValue(STORAGE_KEYS.clients);
    notes = await readLegacyValue(STORAGE_KEYS.notes);
    payments = await readLegacyValue(STORAGE_KEYS.payments);
    catalog = await readLegacyValue(STORAGE_KEYS.catalog);
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

function showToast(msg){
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast">${esc(msg)}</div>`;
  setTimeout(()=>{ if(root.firstChild) root.innerHTML=''; }, 2200);
}

/* ---------------- DATA HELPERS ---------------- */
function getClient(id){ return clients.find(c=>c.id===id); }
function notesFor(id){ return notes.filter(n=>n.clientId===id).sort((a,b)=> b.date.localeCompare(a.date)); }
function paymentsFor(id){ return payments.filter(p=>p.clientId===id).sort((a,b)=> b.date.localeCompare(a.date)); }
function balanceFor(id){
  const totalVentas = notes.filter(n=>n.clientId===id).reduce((s,n)=>s+n.total,0);
  const totalPagadoVenta = notes.filter(n=>n.clientId===id).reduce((s,n)=>s+(n.paid||0),0);
  const totalAbonos = payments.filter(p=>p.clientId===id).reduce((s,p)=>s+p.amount,0);
  return Math.round((totalVentas - totalPagadoVenta - totalAbonos)*100)/100;
}
function totalAdeudoGlobal(){ return clients.reduce((s,c)=>s+Math.max(0,balanceFor(c.id)),0); }

/* Calcula, por cliente, cómo se van cubriendo sus notas más antiguas con los abonos
   generales que ha hecho, para que una nota se marque "Pagada" en cuanto su saldo
   quede cubierto (ya sea porque se pagó al momento o porque un abono posterior la cubrió). */
function computeEffectiveNoteStatuses(){
  const map = new Map();
  const clientIds = Array.from(new Set(notes.map(n=>n.clientId)));
  clientIds.forEach(cid=>{
    const clientNotes = notes.filter(n=>n.clientId===cid).slice().sort((a,b)=> a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
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

  notes.forEach(note=>{
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
    Object.assign(c, data);
  } else {
    clients.push({ id: uid(), createdAt: todayISO(), ...data });
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
  notes.push({
    id: uid(),
    ...data,
    subtotal: Math.round(subtotal*100)/100,
    discountAmount: Math.round(discountAmount*100)/100,
    total: Math.round(total*100)/100,
  });
  saveNotes();
}
function deleteNote(id){ notes = notes.filter(n=>n.id!==id); saveNotes(); }
function addPayment(data){ payments.push({ id: uid(), ...data }); savePayments(); }
function deletePayment(id){ payments = payments.filter(p=>p.id!==id); savePayments(); }
function addProduct(data){ catalog.push({ id: uid(), ...data }); saveCatalog(); }
function updateProduct(id, data){ const p = catalog.find(x=>x.id===id); if(p) Object.assign(p, data); saveCatalog(); }
function deleteProduct(id){ catalog = catalog.filter(p=>p.id!==id); saveCatalog(); }

/* ---------------- ICONS ---------------- */
const ICONS = {
  logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C12 2 4.5 10 4.5 15A7.5 7.5 0 0012 22.5 7.5 7.5 0 0019.5 15C19.5 10 12 2 12 2Z" fill="#E0972E"/><path d="M12 8.2C12 8.2 8.7 12.4 8.7 15.3A3.3 3.3 0 0012 18.6 3.3 3.3 0 0015.3 15.3C15.3 12.4 12 8.2 12 8.2Z" fill="#FBCB6E"/></svg>',
  clientes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="3.4"/><path d="M4.5 20c1-4 4-6 7.5-6s6.5 2 7.5 6"/></svg>',
  rutas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20c3-6 5-2 7-8s3-2 5-8"/><circle cx="4" cy="20" r="1.4"/><circle cx="18" cy="4" r="1.4"/></svg>',
  ventas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  adeudos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1.4 1.2-2 2.5-2s2.5.7 2.5 2c0 3-5 1.7-5 4.7 0 1.3 1.2 2.3 2.5 2.3s2.5-.7 2.5-2"/></svg>',
  reportes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4 1.5v3c0 1-1 2-2 2-8 0-14-6-14-14 0-1 1-2 2-2z"/></svg>',
};

/* ---------------- RENDER: HEADER ---------------- */
function renderHeader(){
  const el = document.getElementById('header');
  const brandBar = `<div class="brandbar"><div class="brand-word"><span class="brand-salsa">Salsa</span><span class="brand-mixword">mix</span></div></div>`;
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
  const titles = { clientes:'Mi Ruta', rutas:'Rutas de la semana', ventas:'Notas de venta', adeudos:'Adeudos', reportes:'Ventas por producto' };
  el.innerHTML = `
    ${brandBar}
    <div class="brand stamp">${titles[state.tab]}<small>Libreta digital de ventas</small><div class="sync-status">☁ Sincronización Firebase</div></div>
    ${state.tab==='clientes' ? `<div class="search-wrap"><input type="text" placeholder="Buscar cliente..." value="${esc(state.search)}" oninput="onSearchInput(this.value)"></div>` : ''}
  `;
}

/* ---------------- RENDER: BOTTOM NAV ---------------- */
function renderBottomNav(){
  const el = document.getElementById('bottomnav');
  const tabs = [['clientes','Clientes'],['rutas','Rutas'],['ventas','Ventas'],['adeudos','Adeudos'],['reportes','Productos']];
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
}

function setTab(tab){ state.tab = tab; state.clientDetailId = null; renderApp(); }
function goBack(){ state.clientDetailId = null; renderApp(); }
function onSearchInput(v){ state.search = v; document.getElementById('app').innerHTML = renderClientesTab(); }

/* --- Clientes tab --- */
function renderClientesTab(){
  const q = state.search.trim().toLowerCase();
  let list = clients.slice().sort((a,b)=>a.name.localeCompare(b.name));
  if(q) list = list.filter(c => c.name.toLowerCase().includes(q) || (c.zone||'').toLowerCase().includes(q));
  if(clients.length===0){
    return `<div class="empty"><span class="big">📒</span>Aún no tienes clientes.<br>Toca el botón + para agregar el primero.</div>`;
  }
  if(list.length===0){
    return `<div class="empty">No hay clientes que coincidan con "${esc(state.search)}".</div>`;
  }
  return list.map(c=>{
    const bal = balanceFor(c.id);
    return `<div class="card tap" onclick="openClientDetail('${c.id}')">
      <div class="row-between">
        <div>
          <div class="name">${esc(c.name)}</div>
          <div class="meta">${c.zone?`<span class="badge zone">${esc(c.zone)}</span> `:''}${c.discount>0?`<span class="badge discount">-${c.discount}%</span> `:''}${esc(c.phone||'')}</div>
        </div>
        <div class="balance mono ${bal>0.004?'owed':'clear'}">${bal>0.004? fmt(bal) : 'Al día'}</div>
      </div>
    </div>`;
  }).join('');
}

/* --- Rutas tab --- */
function renderRutasTab(){
  if(state.routeDay==='todos' && mondayIndexToday()>=0 && state._routeDaySet!==true){
    // default to today's day the first time
  }
  const chips = [['todos','Todos'], ...DAY_SHORT.map((s,i)=>[String(i), DAY_LABELS[i]]), ['sin','Sin día']];
  const stripHTML = `<div class="daystrip">${chips.map(([key,label])=>`
    <div class="daychip ${state.routeDay===key?'active':''}" onclick="setRouteDay('${key}')">${label==='Todos'||label==='Sin día'?label:DAY_SHORT[Number(key)]}</div>
  `).join('')}</div>`;

  let list;
  if(state.routeDay==='todos') list = clients.slice();
  else if(state.routeDay==='sin') list = clients.filter(c => !c.days || c.days.length===0);
  else list = clients.filter(c => (c.days||[]).includes(Number(state.routeDay)));

  list = list.sort((a,b)=>a.name.localeCompare(b.name));

  if(clients.length===0){
    return stripHTML + `<div class="empty"><span class="big">🗺️</span>Agrega clientes y asígnales días de ruta desde su ficha.</div>`;
  }
  if(list.length===0){
    return stripHTML + `<div class="empty">Nadie asignado a este día todavía.</div>`;
  }
  const rows = list.map(c=>{
    const bal = balanceFor(c.id);
    return `<div class="card">
      <div class="row-between">
        <div class="tap" style="flex:1" onclick="openClientDetail('${c.id}')">
          <div class="name">${esc(c.name)}</div>
          <div class="meta">${esc(c.address||c.zone||'')}</div>
        </div>
        <div class="balance mono ${bal>0.004?'owed':'clear'}" style="font-size:13px;">${bal>0.004? fmt(bal):'Al día'}</div>
      </div>
      <div class="btnrow">
        ${c.phone?`<a href="tel:${esc(c.phone)}" class="btn btn-outline btn-sm">${ICONS.phone} Llamar</a>`:''}
        <button class="btn btn-gold btn-sm" onclick="openNoteForm('${c.id}')">+ Nota de venta</button>
      </div>
    </div>`;
  }).join('');
  return stripHTML + rows;
}
function setRouteDay(day){ state.routeDay = day; document.getElementById('app').innerHTML = renderRutasTab(); }

/* --- Ventas tab --- */
function renderVentasTab(){
  const catalogBtn = `<div class="btnrow" style="margin-bottom:10px;">
    <button class="btn btn-outline btn-sm" onclick="openModal('catalogManage',{editingId:null})">📦 Catálogo (${catalog.length})</button>
    <button class="btn btn-outline btn-sm" onclick="setTab('reportes')">📊 Ventas por producto</button>
  </div>`;
  if(notes.length===0){
    return catalogBtn + `<div class="empty"><span class="big">🧾</span>No has registrado notas de venta.<br>Toca + para crear la primera.</div>`;
  }
  const statusMap = computeEffectiveNoteStatuses();
  const list = notes.slice().sort((a,b)=> b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return catalogBtn + list.map(n=>{
    const c = getClient(n.clientId);
    const info = statusMap.get(n.id) || { saldo: Math.max(0, Math.round((n.total-(n.paid||0))*100)/100), status:'pendiente' };
    let statusBadge;
    if(info.status==='pagada') statusBadge = `<span class="badge" style="background:var(--green-bg);color:var(--green);">Pagada</span>`;
    else if(info.status==='parcial') statusBadge = `<span class="badge" style="background:var(--blue-bg);color:var(--blue);">Parcial</span>`;
    else statusBadge = `<span class="badge" style="background:var(--red-bg);color:var(--red);">Pendiente</span>`;
    const notePct = (n.clientDiscountPct||0)+(n.extraDiscountPct||0);
    return `<div class="card tap" onclick="openNoteDetail('${n.id}')">
      <div class="row-between">
        <div>
          <div class="name">${esc(c ? c.name : '(cliente eliminado)')}</div>
          <div class="meta">${fmtDate(n.date)} · ${n.items.length} producto(s) ${statusBadge}${notePct>0?` <span class="badge discount">-${notePct}%</span>`:''}</div>
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

/* --- Adeudos tab --- */
function renderAdeudosTab(){
  const withBalance = clients.map(c=>({c, bal: balanceFor(c.id)})).filter(x=>x.bal>0.004).sort((a,b)=>b.bal-a.bal);
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
  const c = getClient(id);
  if(!c){ state.clientDetailId=null; return renderClientesTab(); }
  const bal = balanceFor(id);
  const statusMap = computeEffectiveNoteStatuses();
  const cn = notesFor(id).map(n=>({type:'nota', date:n.date, data:n}));
  const cp = paymentsFor(id).map(p=>({type:'pago', date:p.date, data:p}));
  const timeline = [...cn, ...cp].sort((a,b)=> b.date.localeCompare(a.date));

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
      } else {
        const p = item.data;
        return `<div class="tl-item">
          <div class="tl-date">${fmtDate(p.date)}</div>
          <div class="tl-head"><span>Pago recibido</span><span class="mono" style="color:var(--green);">+${fmt(p.amount)}</span></div>
          ${p.notes?`<div class="tl-sub">${esc(p.notes)}</div>`:''}
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
  };
  addOrUpdateClient(data, p.id);
  closeModal(); renderApp();
}

/* --- Nota de venta form modal --- */
function blankItem(){ return { catalogId: catalog.length===0 ? '__custom__' : '', desc:'', qty:1, price:0 }; }
function openNoteForm(clientId){
  openModal('noteForm', {
    clientId: clientId || (clients[0] ? clients[0].id : ''),
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
  addNote({
    clientId: p.clientId,
    date: p.date || todayISO(),
    items,
    paid: Number(p.paid)||0,
    notes: (p.notes||'').trim(),
    clientDiscountPct,
    extraDiscountPct,
  });
  closeModal(); renderApp();
  showToast('Nota de venta guardada');
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
  const statusLabel = info.status==='pagada' ? 'Pagada' : info.status==='parcial' ? 'Parcial' : 'Pendiente';
  const statusColor = info.status==='pagada' ? 'var(--green)' : info.status==='pendiente' ? 'var(--red)' : 'var(--blue)';
  return `
    <div class="modal-title"><span>Nota de venta</span><button onclick="closeModal()">✕</button></div>
    <div class="meta">${esc(c?c.name:'(cliente eliminado)')} · ${fmtDate(n.date)}</div>
    <div style="margin-top:10px;">${itemsHTML}</div>
    ${discountLine}
    <div class="total-strip"><span>Total</span><span class="mono">${fmt(n.total)}</span></div>
    <div class="total-strip"><span>Pagado en la venta</span><span class="mono">${fmt(n.paid||0)}</span></div>
    ${info.allocated>0.004?`<div class="total-strip"><span>Abonos posteriores aplicados</span><span class="mono">${fmt(info.allocated)}</span></div>`:''}
    <div class="total-strip"><span>Estado</span><span class="mono" style="color:${statusColor};">${statusLabel}</span></div>
    <div class="total-strip"><span>Saldo de esta nota</span><span class="mono ${info.saldo>0.004?'owed':'clear'}">${info.saldo>0.004?fmt(info.saldo):'Cubierto'}</span></div>
    ${n.notes?`<div class="hint" style="margin-top:8px;">${esc(n.notes)}</div>`:''}
    <div class="btnrow">
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
  openModal('paymentForm', { clientId: clientId || (clients[0]?clients[0].id:''), amount:'', date: todayISO(), notes:'' });
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
  const date = document.getElementById('p-date').value || todayISO();
  const notesVal = document.getElementById('p-notes').value.trim();
  if(!clientId){ showToast('Selecciona un cliente'); return; }
  if(!amount || amount<=0){ showToast('Ingresa un monto válido'); return; }
  addPayment({ clientId, amount, date, notes: notesVal });
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
        <label style="margin-top:0;">Nombre</label>
        <input type="text" id="ce-name-${p.id}" value="${esc(p.name)}">
        <label>Categoría (opcional)</label>
        <input type="text" id="ce-category-${p.id}" value="${esc(p.category||'')}" placeholder="Ej. Salsas, Botanas...">
        <label>Precio</label>
        <input type="number" id="ce-price-${p.id}" min="0" step="any" value="${p.price}">
        <div class="btnrow">
          <button class="btn btn-primary btn-sm" onclick="saveEditProduct('${p.id}')">Guardar</button>
          <button class="btn btn-outline btn-sm" onclick="cancelEditProduct()">Cancelar</button>
        </div>
      </div>`;
    }
    return `<div class="catalog-row">
      <div>
        <div class="cname">${esc(p.name)}</div>
        <div class="meta">${p.category?`<span class="badge zone">${esc(p.category)}</span> `:''}<span class="mono">${fmt(p.price)}</span></div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-outline btn-sm" onclick="startEditProduct('${p.id}')">Editar</button>
        <button class="removebtn" style="padding:0 10px;" onclick="deleteProduct('${p.id}'); renderModal();">✕</button>
      </div>
    </div>`;
  }).join('');
  return `
    <div class="modal-title"><span>Catálogo de productos</span><button onclick="closeModal()">✕</button></div>
    <label>Nuevo producto</label>
    <input type="text" id="new-prod-name" placeholder="Nombre del producto" style="margin-bottom:6px;">
    <div class="catalog-add">
      <input type="text" id="new-prod-category" placeholder="Categoría (opcional)">
      <input type="number" id="new-prod-price" placeholder="Precio" min="0" step="any">
    </div>
    <button class="btn btn-gold btn-block" onclick="submitNewProduct()">${'+ Agregar al catálogo'}</button>
    <div class="hint">La categoría te sirve para agrupar productos (ej. "Salsas", "Botanas") y ver cuáles se venden más en la sección de estadísticas.</div>
    <div class="section-title">Tus productos</div>
    ${sorted.length===0 ? `<div class="empty" style="padding:20px 8px;">Aún no tienes productos guardados.</div>` : rows}
  `;
}
function submitNewProduct(){
  const name = document.getElementById('new-prod-name').value.trim();
  const category = document.getElementById('new-prod-category').value.trim();
  const price = Number(document.getElementById('new-prod-price').value);
  if(!name){ showToast('Escribe el nombre del producto'); return; }
  if(!price || price<0){ showToast('Ingresa un precio válido'); return; }
  addProduct({ name, category, price });
  renderModal();
}
function startEditProduct(id){ state.modal.payload.editingId = id; renderModal(); }
function cancelEditProduct(){ state.modal.payload.editingId = null; renderModal(); }
function saveEditProduct(id){
  const name = document.getElementById('ce-name-'+id).value.trim();
  const category = document.getElementById('ce-category-'+id).value.trim();
  const price = Number(document.getElementById('ce-price-'+id).value);
  if(!name){ showToast('Escribe el nombre del producto'); return; }
  if(!price || price<0){ showToast('Ingresa un precio válido'); return; }
  updateProduct(id, { name, category, price });
  state.modal.payload.editingId = null;
  renderModal();
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
(async function init(){
  renderApp();
  await loadAll();
  state.routeDay = String(mondayIndexToday());
  renderApp();
})();
