import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBbW9tiBlRk83ZwCjc4TXPXLiidtcNWpyo",
  authDomain: "pokecards-bad1d.firebaseapp.com",
  projectId: "pokecards-bad1d",
  storageBucket: "pokecards-bad1d.firebasestorage.app",
  messagingSenderId: "200788230137",
  appId: "1:200788230137:web:d90b1228574a203af48728",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();