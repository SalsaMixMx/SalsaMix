import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD4NQrruIPkM3JYtf4pGIQm1py9bad9aDA",
  authDomain: "salsamix-2936b.firebaseapp.com",
  projectId: "salsamix-2936b",
  storageBucket: "salsamix-2936b.firebasestorage.app",
  messagingSenderId: "20318993167",
  appId: "1:20318993167:web:e7593f7a0efcaa846d5c7a",
  measurementId: "G-EDCK9H3FR2",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const DATA_COLLECTION = "salsamixData";
const NAMES = ["clients", "notes", "payments", "catalog"];

function dataRef(name){
  return doc(db, DATA_COLLECTION, name);
}

async function loadAll(){
  const result = { exists: {} };
  await Promise.all(NAMES.map(async name => {
    const snapshot = await getDoc(dataRef(name));
    result.exists[name] = snapshot.exists();
    result[name] = snapshot.exists() ? (snapshot.data().items || []) : [];
  }));
  return result;
}

async function save(name, items){
  if(!NAMES.includes(name)) throw new Error(`Colección no válida: ${name}`);
  await setDoc(dataRef(name), {
    items,
    updatedAt: new Date().toISOString(),
  });
}

async function saveAll(data){
  await Promise.all(NAMES.map(name => save(name, data[name] || [])));
}

function subscribe(callback){
  const current = {};
  const unsubscribers = NAMES.map(name => onSnapshot(dataRef(name), snapshot => {
    if(!snapshot.exists()) return;
    current[name] = snapshot.data().items || [];
    callback({ [name]: current[name] });
  }, error => console.error(`Error escuchando ${name}:`, error)));
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

window.firebaseStore = { loadAll, save, saveAll, subscribe };
window.__resolveFirebaseReady();
