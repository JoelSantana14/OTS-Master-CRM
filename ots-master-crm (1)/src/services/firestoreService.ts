import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, Unsubscribe, disableNetwork, setLogLevel } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Silence internal Firestore SDK verbose logs/backoff warnings
try {
  setLogLevel('silent');
} catch {}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || undefined);

const STATE_DOC_REF = doc(db, 'crm_state', 'main_database');

let lastCloudStateHash: string = '';
let isQuotaExceeded: boolean = false;
let activeUnsubscribe: Unsubscribe | null = null;

export function getIsQuotaExceeded(): boolean {
  return isQuotaExceeded;
}

function handleQuotaExceeded() {
  if (!isQuotaExceeded) {
    isQuotaExceeded = true;
    console.warn('Firestore cloud quota limit reached. Disabling network and operating in persistent LocalStorage mode.');
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

function serializeStateForCompare(state: any): string {
  if (!state) return '';
  const { updatedAt, ...rest } = state;
  try {
    return JSON.stringify(rest);
  } catch {
    return '';
  }
}

export async function loadStateFromCloud(): Promise<any | null> {
  if (isQuotaExceeded) return null;
  try {
    const snap = await getDoc(STATE_DOC_REF);
    if (snap.exists()) {
      const data = snap.data();
      lastCloudStateHash = serializeStateForCompare(data);
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
          const data = snap.data();
          lastCloudStateHash = serializeStateForCompare(data);
          console.log('Real-time update received from Firestore cloud.');
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

export async function saveStateToCloud(state: any): Promise<boolean> {
  if (isQuotaExceeded) {
    return false;
  }

  const currentHash = serializeStateForCompare(state);
  if (currentHash && currentHash === lastCloudStateHash) {
    // Data has not changed since last cloud update — skip redundant write
    return true;
  }

  try {
    await setDoc(STATE_DOC_REF, {
      ...state,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    lastCloudStateHash = currentHash;
    console.log('State saved successfully to Firestore cloud.');
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



