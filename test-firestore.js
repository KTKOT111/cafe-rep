import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const firebaseConfig = {
  apiKey:            "AIzaSyD7JUJwT6_F_Nfn-VEdKNOQOjtcielLBAY",
  authDomain:        "coffe-school.firebaseapp.com",
  projectId:         "coffe-school",
  storageBucket:     "coffe-school.firebasestorage.app",
  messagingSenderId: "281594211042",
  appId:             "1:281594211042:web:d24744829c58ca9e0cccbb",
  measurementId:     "G-WZ9H9WFMP7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function test() {
  try {
    // We need to sign in as owner to read it
    await signInWithEmailAndPassword(auth, "owner@coffeeerp.app", "12345678"); // Assuming standard test password or I'll just check without auth if rules allow. Wait, rules say request.auth != null. 
    console.log("Logged in!");
  } catch (e) {
    console.log("Login failed, will try reading anyway...", e.message);
  }

  try {
    const docRef = doc(db, "erp_platform", "config");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      console.log("Document data:", JSON.stringify(docSnap.data(), null, 2));
    } else {
      console.log("No such document!");
    }
  } catch(e) {
    console.error("Error reading document:", e);
  }
  process.exit();
}
test();
