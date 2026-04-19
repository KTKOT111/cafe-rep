const firebaseConfig = {
  apiKey:            "AIzaSyD7JUJwT6_F_Nfn-VEdKNOQOjtcielLBAY",
  authDomain:        "coffe-school.firebaseapp.com",
  projectId:         "coffe-school",
  storageBucket:     "coffe-school.firebasestorage.app",
  messagingSenderId: "281594211042",
  appId:             "1:281594211042:web:d24744829c58ca9e0cccbb",
  measurementId:     "G-WZ9H9WFMP7"
}

import { initializeApp } from 'firebase/app'
import { getAuth }       from 'firebase/auth'
import { getFirestore }  from 'firebase/firestore'

const app         = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db   = getFirestore(app)
export default app
