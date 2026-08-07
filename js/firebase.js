import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  documentId,
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD4NQrruIPkM3JYtf4pGIQm1py9bad9aDA",
  authDomain: "salsamix-2936b.firebaseapp.com",
  projectId: "salsamix-2936b",
  storageBucket: "salsamix-2936b.firebasestorage.app",
  messagingSenderId: "20318993167",
  appId: "1:20318993167:web:e7593f7a0efcaa846d5c7a",
  measurementId: "G-EDCK9H3FR2",
};

const INITIAL_ADMIN_EMAIL = "josegonzalezcarrillo88@gmail.com";
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
const auth = getAuth(app);

const SECURE_COLLECTIONS = ["clients", "notes", "payments", "catalog", "inventoryMovements", "visits", "purchases"];
const LEGACY_COLLECTION = "salsamixData";

function profileRef(uid){ return doc(db, "users", uid); }
function isAdminProfile(profile){ return profile?.role === "admin"; }
function normalizeItem(item, name, clientsById, currentUid){
  const result={...item};
  if(!result.id) result.id=crypto.randomUUID();
  if(name==="clients"){
    result.assignedTo=result.assignedTo || result.createdBy || currentUid;
  }
  if(name==="notes" || name==="payments"){
    const client=clientsById.get(result.clientId);
    result.sellerId=result.sellerId || client?.assignedTo || result.createdBy || currentUid;
  }
  if(name==="visits") result.sellerId=result.sellerId || result.createdBy || currentUid;
  if(name==="inventoryMovements") result.sellerId=result.sellerId || result.createdBy || currentUid;
  if(name==="purchases") result.sellerId=result.sellerId || result.createdBy || currentUid;
  return result;
}

async function readLegacyArrays(){
  const result={};
  await Promise.all(SECURE_COLLECTIONS.map(async name=>{
    const snapshot=await getDoc(doc(db,LEGACY_COLLECTION,name));
    result[name]=snapshot.exists() ? (snapshot.data().items||[]) : [];
  }));
  return result;
}

async function writeInChunks(entries){
  for(let i=0;i<entries.length;i+=400){
    const batch=writeBatch(db);
    entries.slice(i,i+400).forEach(({ref,data})=>batch.set(ref,data));
    await batch.commit();
  }
}

async function secureCollectionsHaveData(){
  const check=await getDocs(query(collection(db,"clients")));
  return !check.empty;
}

async function migrateLegacyIfNeeded(profile,user){
  if(!isAdminProfile(profile)) return;
  if(await secureCollectionsHaveData()) return;
  const legacy=await readLegacyArrays();
  if(!SECURE_COLLECTIONS.some(name=>(legacy[name]||[]).length)) return;

  const clientsById=new Map((legacy.clients||[]).map(item=>[item.id,item]));
  const entries=[];
  SECURE_COLLECTIONS.forEach(name=>{
    (legacy[name]||[]).forEach(item=>{
      const normalized=normalizeItem(item,name,clientsById,user.uid);
      entries.push({ref:doc(db,name,normalized.id),data:normalized});
    });
  });
  await writeInChunks(entries);
  await setDoc(doc(db,"system","migration"),{
    completed:true,
    completedAt:new Date().toISOString(),
    completedBy:user.uid,
    source:"salsamixData-arrays",
  });
}

function collectionQuery(name,profile,user){
  if(isAdminProfile(profile) || name==="catalog") return query(collection(db,name));
  if(name==="clients") return query(collection(db,name),where("assignedTo","==",user.uid));
  if(["notes","payments","visits","inventoryMovements"].includes(name)){
    return query(collection(db,name),where("sellerId","==",user.uid));
  }
  return query(collection(db,name),where(documentId(),"==","__none__"));
}

async function readCollection(name,profile,user){
  const snapshot=await getDocs(collectionQuery(name,profile,user));
  return snapshot.docs.map(item=>({id:item.id,...item.data()}));
}

async function loadAll(){
  const user=auth.currentUser;
  const profile=window.currentUserProfile;
  if(!user || !profile) throw new Error("Sesión no disponible");
  await migrateLegacyIfNeeded(profile,user);
  const result={exists:{}};
  await Promise.all(SECURE_COLLECTIONS.map(async name=>{
    const items=await readCollection(name,profile,user);
    result[name]=items;
    result.exists[name]=items.length>0;
  }));
  return result;
}

async function syncCollection(name,items){
  if(!SECURE_COLLECTIONS.includes(name)) throw new Error(`Colección no válida: ${name}`);
  const user=auth.currentUser;
  const profile=window.currentUserProfile;
  if(!user || !profile) throw new Error("Sesión no disponible");

  const existing=await readCollection(name,profile,user);
  const incomingIds=new Set(items.map(item=>item.id));
  const writes=[];
  for(const item of items){
    if(!item.id) continue;
    writes.push({ref:doc(db,name,item.id),data:item});
  }
  await writeInChunks(writes);

  // Solo elimina documentos dentro del conjunto que el usuario tiene permitido consultar.
  await Promise.all(existing.filter(item=>!incomingIds.has(item.id)).map(item=>deleteDoc(doc(db,name,item.id))));
}

async function save(name,items){ return syncCollection(name,items); }
async function saveAll(data){
  for(const name of SECURE_COLLECTIONS) await syncCollection(name,data[name]||[]);
}

function subscribe(callback){
  const user=auth.currentUser;
  const profile=window.currentUserProfile;
  if(!user || !profile) return ()=>{};
  const unsubscribers=SECURE_COLLECTIONS.map(name=>onSnapshot(collectionQuery(name,profile,user),snapshot=>{
    callback({[name]:snapshot.docs.map(item=>({id:item.id,...item.data()}))});
  },error=>console.error(`Error escuchando ${name}:`,error)));
  return ()=>unsubscribers.forEach(unsubscribe=>unsubscribe());
}

async function loadUsers(){
  const user=auth.currentUser;
  const profile=window.currentUserProfile;
  if(!user || !profile) return [];
  if(isAdminProfile(profile)){
    const snapshot=await getDocs(collection(db,"users"));
    return snapshot.docs.map(item=>({uid:item.id,...item.data()}));
  }
  const own=await getDoc(profileRef(user.uid));
  return own.exists() ? [{uid:own.id,...own.data()}] : [];
}

function subscribeUsers(callback){
  const user=auth.currentUser;
  const profile=window.currentUserProfile;
  if(!user || !profile) return ()=>{};
  if(isAdminProfile(profile)){
    return onSnapshot(collection(db,"users"),snapshot=>callback(snapshot.docs.map(item=>({uid:item.id,...item.data()}))),error=>console.error("Error escuchando usuarios:",error));
  }
  return onSnapshot(profileRef(user.uid),snapshot=>callback(snapshot.exists()?[{uid:snapshot.id,...snapshot.data()}]:[]),error=>console.error("Error escuchando usuario:",error));
}

async function ensureUserProfile(user){
  const ref=profileRef(user.uid);
  const snapshot=await getDoc(ref);
  if(snapshot.exists()) return {uid:user.uid,...snapshot.data()};
  const email=(user.email||"").toLowerCase();
  const profile={
    name:user.displayName||email.split("@")[0]||"Usuario",
    email,
    role:email===INITIAL_ADMIN_EMAIL?"admin":"vendedor",
    active:true,
    createdAt:new Date().toISOString(),
  };
  await setDoc(ref,profile);
  return {uid:user.uid,...profile};
}

async function login(email,password){ return signInWithEmailAndPassword(auth,email.trim(),password); }
async function logout(){ return signOut(auth); }
async function resetPassword(email){ return sendPasswordResetEmail(auth,email.trim()); }

window.firebaseStore={loadAll,save,saveAll,subscribe,loadUsers,subscribeUsers};
window.firebaseAuth={login,logout,resetPassword};
window.authReady=new Promise(resolve=>{
  onAuthStateChanged(auth,async user=>{
    let profile=null;
    if(user){
      try{
        profile=await ensureUserProfile(user);
        if(profile.active===false){ await signOut(auth); user=null; profile=null; }
      }catch(error){ console.error("No se pudo cargar el perfil:",error); }
    }
    window.currentFirebaseUser=user;
    window.currentUserProfile=profile;
    window.dispatchEvent(new CustomEvent("salsamix-auth-change",{detail:{user,profile}}));
    resolve({user,profile});
  });
});
window.__resolveFirebaseReady();
