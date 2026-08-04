import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function getAdminApp(): App {
  const existing = getApps();
  if (existing.length) return existing[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON env var");
  }
  const serviceAccount = JSON.parse(raw);
  return initializeApp({ credential: cert(serviceAccount) });
}

export function firestoreDb(): Firestore {
  return getFirestore(getAdminApp());
}
