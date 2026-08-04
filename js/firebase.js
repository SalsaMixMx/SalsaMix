import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  collection,
  getDocs,
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
const db = getFirestore(app);
const auth = getAuth(app);
const DATA_COLLECTION = "salsamixData";
const NAMES = ["clients", "notes", "payments", "catalog", "inventoryMovements", "visits"];

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


async function loadUsers(){
  const snapshot = await getDocs(collection(db, "users"));
  return snapshot.docs.map(item=>({ uid:item.id, ...item.data() }));
}

function subscribeUsers(callback){
  return onSnapshot(collection(db, "users"), snapshot=>{
    callback(snapshot.docs.map(item=>({ uid:item.id, ...item.data() })));
  }, error=>console.error("Error escuchando usuarios:", error));
}

function profileRef(uid){
  return doc(db, "users", uid);
}

async function ensureUserProfile(user){
  const ref = profileRef(user.uid);
  const snapshot = await getDoc(ref);
  if(snapshot.exists()) return { uid:user.uid, ...snapshot.data() };

  const email = (user.email || "").toLowerCase();
  const profile = {
    name: user.displayName || email.split("@")[0] || "Usuario",
    email,
    role: email === INITIAL_ADMIN_EMAIL ? "admin" : "vendedor",
    active: true,
    createdAt: new Date().toISOString(),
  };
  await setDoc(ref, profile);
  return { uid:user.uid, ...profile };
}

async function login(email, password){
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

async function logout(){
  return signOut(auth);
}

async function resetPassword(email){
  return sendPasswordResetEmail(auth, email.trim());
}

window.firebaseStore = { loadAll, save, saveAll, subscribe, loadUsers, subscribeUsers };
window.firebaseAuth = { login, logout, resetPassword };
window.authReady = new Promise(resolve => {
  onAuthStateChanged(auth, async user => {
    let profile = null;
    if(user){
      try{
        profile = await ensureUserProfile(user);
        if(profile.active === false){
          await signOut(auth);
          user = null;
          profile = null;
        }
      }catch(error){
        console.error("No se pudo cargar el perfil:", error);
      }
    }
    window.currentFirebaseUser = user;
    window.currentUserProfile = profile;
    window.dispatchEvent(new CustomEvent("salsamix-auth-change", { detail:{ user, profile } }));
    resolve({ user, profile });
  });
});
window.__resolveFirebaseReady();
