import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, Unsubscribe, disableNetwork, setLogLevel, collection, query, orderBy, limit } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { DeletionAuditRecord } from '../types';

// Silence internal Firestore SDK verbose logs/backoff warnings
try {
  setLogLevel('silent');
} catch {}

const getEnvVar = (key1: string, key2: string): string | undefined => {
  try {
    const metaEnv = (import.meta as any).env;
    if (metaEnv) {
      if (metaEnv[key1]) return metaEnv[key1];
      if (metaEnv[key2]) return metaEnv[key2];
    }
  } catch {}
  try {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env[key1]) return process.env[key1];
      if (process.env[key2]) return process.env[key2];
    }
  } catch {}
  return undefined;
};

const activeFirebaseConfig = {
  apiKey: getEnvVar('VITE_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_API_KEY') || firebaseConfig.apiKey,
  authDomain: getEnvVar('VITE_FIREBASE_AUTH_DOMAIN', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN') || firebaseConfig.authDomain,
  projectId: getEnvVar('VITE_FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID') || firebaseConfig.projectId,
  storageBucket: getEnvVar('VITE_FIREBASE_STORAGE_BUCKET', 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET') || firebaseConfig.storageBucket,
  messagingSenderId: getEnvVar('VITE_FIREBASE_MESSAGING_SENDER_ID', 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID') || firebaseConfig.messagingSenderId,
  appId: getEnvVar('VITE_FIREBASE_APP_ID', 'NEXT_PUBLIC_FIREBASE_APP_ID') || firebaseConfig.appId,
  firestoreDatabaseId: getEnvVar('VITE_FIREBASE_DATABASE_ID', 'FIREBASE_DATABASE_ID') || (firebaseConfig as any).firestoreDatabaseId,
};

const app = getApps().length === 0 ? initializeApp(activeFirebaseConfig) : getApps()[0];
export const db = getFirestore(app, activeFirebaseConfig.firestoreDatabaseId || undefined);

const STATE_DOC_REF = doc(db, 'crm_state', 'main_database');

const QUOTA_STORAGE_KEY = 'jv_firestore_quota_exceeded_day';

let lastCloudStateHash: string = '';
let lastSavedMutationId: string = '';
let isQuotaExceeded: boolean = false;
let activeUnsubscribe: Unsubscribe | null = null;

// Auto-reset quota flag on module load so app always attempts fresh cloud sync on page refresh
resetQuotaExceededFlag();

export function getIsQuotaExceeded(): boolean {
  return isQuotaExceeded;
}

export function resetQuotaExceededFlag(): void {
  isQuotaExceeded = false;
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(QUOTA_STORAGE_KEY);
    }
  } catch {}
}

function handleQuotaExceeded() {
  if (!isQuotaExceeded) {
    isQuotaExceeded = true;
    try {
      if (typeof window !== 'undefined') {
        const today = new Date().toISOString().split('T')[0];
        localStorage.setItem(QUOTA_STORAGE_KEY, today);
      }
    } catch {}
    console.warn('Firestore cloud quota limit reached. Operating in persistent LocalStorage mode.');
  }
  if (activeUnsubscribe) {
    try {
      activeUnsubscribe();
    } catch {}
    activeUnsubscribe = null;
  }
  disableNetwork(db).catch(() => {});
}

function isQuotaError(err: any): boolean {
  if (!err) return false;
  const code = String(err?.code || '').toLowerCase();
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === 'resource-exhausted' ||
    code.includes('quota') ||
    code.includes('exhausted') ||
    msg.includes('quota') ||
    msg.includes('limit exceeded') ||
    msg.includes('resource-exhausted') ||
    msg.includes('resource_exhausted')
  );
}

// Canonical JSON serialization with recursively sorted keys to guarantee deterministic hash comparisons
function canonicalSerialize(obj: any): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalSerialize(item)).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs: string[] = [];
  for (const key of keys) {
    if (key === 'updatedAt' || key === 'lastMutationId') continue;
    pairs.push(JSON.stringify(key) + ':' + canonicalSerialize(obj[key]));
  }
  return '{' + pairs.join(',') + '}';
}

export async function loadStateFromCloud(): Promise<any | null> {
  if (isQuotaExceeded) return null;
  try {
    const snap = await getDoc(STATE_DOC_REF);
    if (snap.exists()) {
      const data = snap.data();
      lastCloudStateHash = canonicalSerialize(data);
      if (data.lastMutationId) {
        lastSavedMutationId = data.lastMutationId;
      }
      console.log('State loaded successfully from Firestore cloud.');
      return data;
    }
    return null;
  } catch (err: any) {
    if (isQuotaError(err)) {
      handleQuotaExceeded();
    } else {
      console.warn('Could not load state from Firestore cloud (using local fallback):', err);
    }
    return null;
  }
}

export function subscribeToCloudState(
  onData: (data: any, exists: boolean) => void,
  onError?: (err: any) => void
): () => void {
  if (isQuotaExceeded) {
    onData(null, false);
    return () => {};
  }

  // Cleanup existing subscription if any
  if (activeUnsubscribe) {
    try {
      activeUnsubscribe();
    } catch {}
    activeUnsubscribe = null;
  }

  try {
    const unsub = onSnapshot(
      STATE_DOC_REF,
      (snap) => {
        if (snap.exists()) {
          // 1. If snapshot represents in-flight local writes, never overwrite local state
          if (snap.metadata.hasPendingWrites) {
            return;
          }

          const data = snap.data();

          // 2. If snapshot has the mutationId we just sent, it is our own server confirmation echo
          if (data.lastMutationId && data.lastMutationId === lastSavedMutationId) {
            return;
          }

          // 3. Compare canonical hashes to prevent redundant or out-of-order re-hydrations
          const incomingHash = canonicalSerialize(data);
          if (incomingHash && incomingHash === lastCloudStateHash) {
            return;
          }

          lastCloudStateHash = incomingHash;
          if (data.lastMutationId) {
            lastSavedMutationId = data.lastMutationId;
          }
          console.log('Real-time remote update received from Firestore cloud.');
          onData(data, true);
        } else {
          onData(null, false);
        }
      },
      (err: any) => {
        if (isQuotaError(err)) {
          handleQuotaExceeded();
          onData(null, false);
        } else {
          console.warn('Could not subscribe to Firestore cloud state:', err);
          if (onError) onError(err);
        }
      }
    );

    activeUnsubscribe = unsub;

    return () => {
      if (activeUnsubscribe === unsub) {
        activeUnsubscribe = null;
      }
      try {
        unsub();
      } catch {}
    };
  } catch (err: any) {
    if (isQuotaError(err)) {
      handleQuotaExceeded();
    }
    onData(null, false);
    return () => {};
  }
}

export async function saveStateToCloud(state: any, force = false): Promise<boolean> {
  if (isQuotaExceeded) {
    return false;
  }

  const currentHash = canonicalSerialize(state);
  if (!force && currentHash && currentHash === lastCloudStateHash) {
    // Data has not changed since last cloud update — skip redundant write
    return true;
  }

  // Generate a distinct mutation ID for this write operation
  const mutationId = 'mut_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  lastSavedMutationId = mutationId;
  lastCloudStateHash = currentHash;

  try {
    await setDoc(STATE_DOC_REF, {
      ...state,
      lastMutationId: mutationId,
      updatedAt: new Date().toISOString()
    });
    console.log('State saved successfully to Firestore cloud (mutation: ' + mutationId + ').');
    return true;
  } catch (err: any) {
    if (isQuotaError(err)) {
      handleQuotaExceeded();
    } else {
      console.warn('Could not save state to Firestore cloud:', err);
    }
    return false;
  }
}

export async function updateUserProfilePhotoInFirestore(userId: string, avatarUrl: string): Promise<boolean> {
  if (isQuotaExceeded) return false;
  try {
    const userDocRef = doc(db, 'users', userId);
    await setDoc(userDocRef, {
      id: userId,
      avatar: avatarUrl,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`User ${userId} avatar updated in Firestore successfully.`);
    return true;
  } catch (err: any) {
    if (isQuotaError(err)) {
      handleQuotaExceeded();
    }
    console.error(`Error updating user ${userId} avatar in Firestore:`, err);
    return false;
  }
}

export async function logDeletionToFirestore(record: DeletionAuditRecord): Promise<boolean> {
  if (isQuotaExceeded) return false;
  try {
    const logDocRef = doc(db, 'deletion_audit_logs', record.id);
    await setDoc(logDocRef, {
      ...record,
      createdAt: new Date().toISOString(),
    });
    console.log(`Deletion log ${record.id} recorded in Firestore.`);
    return true;
  } catch (err: any) {
    if (isQuotaError(err)) {
      handleQuotaExceeded();
    } else {
      console.warn('Could not save deletion log to Firestore:', err);
    }
    return false;
  }
}

export function subscribeToDeletionLogs(callback: (logs: DeletionAuditRecord[]) => void): Unsubscribe {
  if (isQuotaExceeded) {
    callback([]);
    return () => {};
  }

  try {
    const logsCollection = collection(db, 'deletion_audit_logs');
    const logsQuery = query(logsCollection, orderBy('timestamp', 'desc'), limit(150));

    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        const logs: DeletionAuditRecord[] = [];
        snapshot.forEach((docSnap) => {
          logs.push(docSnap.data() as DeletionAuditRecord);
        });
        callback(logs);
      },
      (err) => {
        if (isQuotaError(err)) {
          handleQuotaExceeded();
        } else {
          console.warn('Error listening to deletion logs in Firestore:', err);
        }
      }
    );

    return unsubscribe;
  } catch (err) {
    console.warn('Could not subscribe to deletion logs:', err);
    return () => {};
  }
}



