// Firebase v12 Modular SDK imports - Enhanced Version
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { 
  getAuth, 
  setPersistence, 
  browserLocalPersistence,
  connectAuthEmulator 
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { 
  getFirestore, 
  connectFirestoreEmulator,
  enableNetwork,
  disableNetwork
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { 
  getStorage,
  connectStorageEmulator 
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js';

// ✅ Your Firebase web app configuration
const firebaseConfig = {
  apiKey: "AIzaSyD_URV0MAg7L6jho6Rcuwc47reakhyv7Hg",
  authDomain: "collegeconnect-9ad89.firebaseapp.com",
  projectId: "collegeconnect-9ad89",
  storageBucket: "collegeconnect-9ad89.firebasestorage.app",
  messagingSenderId: "348147420019",
  appId: "1:348147420019:web:d1588e5f73bc7cb1ec9306"
};

// 🔥 Initialize Firebase with enhanced error handling and logging
console.log("🔥 Initializing CollegeConnect Firebase with config:", {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
  version: "Enhanced v2.0"
});

let app;
try {
  app = initializeApp(firebaseConfig);
  console.log("✅ Firebase app initialized successfully for CollegeConnect");
} catch (error) {
  console.error("❌ Failed to initialize Firebase app:", error);
  // Show user-friendly error message
  if (typeof window !== 'undefined') {
    showSystemError("Failed to connect to CollegeConnect servers. Please check your internet connection.");
  }
  throw error;
}

// 🚀 Initialize Firebase services with enhanced error handling
let auth, db, storage;

try {
  auth = getAuth(app);
  console.log("✅ Firebase Auth initialized for CollegeConnect");
} catch (error) {
  console.error("❌ Failed to initialize Firebase Auth:", error);
  throw error;
}

try {
  db = getFirestore(app);
  console.log("✅ Firestore database initialized for CollegeConnect");
  
  // Enable Firestore network with enhanced handling
  enableNetwork(db).then(() => {
    console.log("✅ Firestore network enabled - Real-time features active");
    if (typeof window !== 'undefined') {
      window.firestoreOnline = true;
    }
  }).catch(err => {
    console.warn("⚠️ Could not enable Firestore network:", err);
    if (typeof window !== 'undefined') {
      window.firestoreOnline = false;
    }
  });
  
} catch (error) {
  console.error("❌ Failed to initialize Firestore:", error);
  throw error;
}

try {
  storage = getStorage(app);
  console.log("✅ Firebase Storage initialized for file uploads");
} catch (error) {
  console.error("❌ Failed to initialize Firebase Storage:", error);
  throw error;
}

// 📌 Enhanced auth persistence setup
async function setupAuthPersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
    console.log("✅ Auth persistence set to 'local' - Users stay logged in");
  } catch (error) {
    console.error("❌ Failed to set auth persistence:", error);
    console.warn("⚠️ Users may need to login again on page refresh");
  }
}

// Call persistence setup
setupAuthPersistence();

// Enhanced connection monitoring
let connectionStatus = {
  online: navigator.onLine,
  firestore: false,
  lastCheck: new Date()
};

// Connection monitoring functions
function updateConnectionStatus(online) {
  connectionStatus.online = online;
  connectionStatus.lastCheck = new Date();
  
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('connectionChange', { 
      detail: connectionStatus 
    }));
  }
}

// Enhanced network event listeners
window.addEventListener('online', () => {
  console.log("🌐 Network connection restored");
  updateConnectionStatus(true);
  
  if (db) {
    enableNetwork(db).then(() => {
      connectionStatus.firestore = true;
      console.log("✅ Firestore reconnected");
    }).catch(err => {
      console.warn("Could not re-enable Firestore:", err);
      connectionStatus.firestore = false;
    });
  }
});

window.addEventListener('offline', () => {
  console.log("🌐 Network connection lost - Switching to offline mode");
  updateConnectionStatus(false);
  connectionStatus.firestore = false;
});

// Enhanced error display function
function showSystemError(message) {
  if (typeof document === 'undefined') return;
  
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #ef4444, #dc2626);
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.3);
    z-index: 10000;
    max-width: 400px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    animation: slideIn 0.3s ease-out;
  `;
  
  errorDiv.innerHTML = `
    <div style="display: flex; items-center; gap: 12px;">
      <div style="font-size: 24px;">🔥</div>
      <div>
        <div style="font-weight: bold; margin-bottom: 4px;">Connection Error</div>
        <div style="opacity: 0.9;">${message}</div>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" 
              style="background: none; border: none; color: white; font-size: 20px; cursor: pointer; margin-left: auto;">
        ×
      </button>
    </div>
  `;
  
  // Add animation styles
  if (!document.getElementById('firebase-error-styles')) {
    const styles = document.createElement('style');
    styles.id = 'firebase-error-styles';
    styles.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(styles);
  }
  
  document.body.appendChild(errorDiv);
  
  // Auto remove after 8 seconds
  setTimeout(() => {
    if (errorDiv.parentNode) {
      errorDiv.remove();
    }
  }, 8000);
}

// 🛠 Enhanced development helpers and debugging
if (typeof window !== 'undefined') {
  // Store instances globally for debugging
  window.firebase_instances = { auth, db, storage, app };
  window.connectionStatus = connectionStatus;
  
  // Enhanced Firestore connection test
  window.testFirestore = async () => {
    try {
      console.log("🧪 Testing Firestore connection...");
      const { doc, setDoc, getDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
      
      const testDoc = doc(db, 'system', 'connection-test');
      const testData = {
        test: true,
        timestamp: serverTimestamp(),
        userAgent: navigator.userAgent,
        message: 'CollegeConnect Firestore connection test successful',
        version: '2.0'
      };
      
      await setDoc(testDoc, testData);
      console.log("✅ Firestore write test successful");
      
      const testRead = await getDoc(testDoc);
      if (testRead.exists()) {
        console.log("✅ Firestore read test successful:", testRead.data());
        connectionStatus.firestore = true;
        return true;
      } else {
        console.error("❌ Firestore read test failed: document not found");
        connectionStatus.firestore = false;
        return false;
      }
    } catch (error) {
      console.error("❌ Firestore test failed:", error);
      connectionStatus.firestore = false;
      return false;
    }
  };
  
  // Enhanced Auth test helper
  window.testAuth = () => {
    const authInfo = {
      isInitialized: !!auth,
      currentUser: auth.currentUser,
      isSignedIn: !!auth.currentUser,
      email: auth.currentUser?.email || 'Not signed in',
      uid: auth.currentUser?.uid || 'No UID',
      emailVerified: auth.currentUser?.emailVerified || false
    };
    
    console.log("🔐 CollegeConnect Auth Status:", authInfo);
    return authInfo;
  };
  
  // Connection status checker
  window.checkConnectionStatus = () => {
    console.log("🌐 CollegeConnect Connection Status:", connectionStatus);
    return connectionStatus;
  };
  
  // Performance monitoring
  window.getFirebasePerformance = () => {
    const performance = {
      initTime: Date.now(),
      authReady: !!auth,
      firestoreReady: !!db,
      storageReady: !!storage,
      online: connectionStatus.online,
      firestoreOnline: connectionStatus.firestore
    };
    
    console.log("⚡ CollegeConnect Performance Stats:", performance);
    return performance;
  };
  
  console.log("✅ CollegeConnect Firebase initialized successfully");
  console.log("🛠 Enhanced debug helpers available:");
  console.log("   - window.testFirestore() - Test database connection");
  console.log("   - window.testAuth() - Check authentication status");
  console.log("   - window.checkConnectionStatus() - Network status");
  console.log("   - window.getFirebasePerformance() - Performance stats");
}

// Enhanced error recovery system
async function attemptReconnection(maxAttempts = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🔄 Attempting reconnection ${attempt}/${maxAttempts}...`);
      
      await enableNetwork(db);
      connectionStatus.firestore = true;
      console.log("✅ Reconnection successful!");
      
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('firestoreReconnected'));
      }
      
      return true;
    } catch (error) {
      console.warn(`❌ Reconnection attempt ${attempt} failed:`, error);
      
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
  }
  
  console.error("❌ All reconnection attempts failed");
  return false;
}

// Auto-reconnection when network comes back online
window.addEventListener('online', () => {
  if (!connectionStatus.firestore) {
    setTimeout(() => {
      attemptReconnection();
    }, 1000);
  }
});

// Enhanced exports for the application
export { 
  auth, 
  db, 
  storage, 
  app,
  connectionStatus,
  attemptReconnection,
  showSystemError
};

// Export test functions for debugging
export const testFirestoreConnection = async () => {
  if (typeof window !== 'undefined' && window.testFirestore) {
    return await window.testFirestore();
  }
  return false;
};

// Additional debugging exports
export { firebaseConfig };

// System ready notification
console.log("🎉 CollegeConnect Firebase System Ready!");
console.log("📊 Project:", firebaseConfig.projectId);
console.log("🔐 Auth Domain:", firebaseConfig.authDomain);
console.log("💾 Storage Bucket:", firebaseConfig.storageBucket);