const firebaseConfig = {
  apiKey: "AIzaSyC2Fbv0XSUHSqSnC-ezIv9O6SsnpjWuziM",
  authDomain: "legalscan-ai-web-1ff48.firebaseapp.com",
  projectId: "legalscan-ai-web-1ff48",
  storageBucket: "legalscan-ai-web-1ff48.firebasestorage.app",
  messagingSenderId: "580653211253",
  appId: "1:580653211253:web:536e1f1a3fd044c645223c"
};

const FIREBASE_IS_CONFIGURED = firebaseConfig.apiKey !== "YOUR_API_KEY" &&
                                !!firebaseConfig.apiKey &&
                                !!firebaseConfig.projectId;
