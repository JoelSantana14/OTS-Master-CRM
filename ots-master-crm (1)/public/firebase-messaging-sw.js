// firebase-messaging-sw.js
// Service Worker strictly dedicated to Firebase Push Notifications.
// NOTE: This Service Worker does NOT contain any 'fetch' event listener and does NOT
// intercept, proxy, cache or block any database HTTP/WebSocket network calls.

try {
  importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

  const firebaseConfig = {
    apiKey: "AIzaSyBcGKyZCbsspM4IHIV3q4xo919Uk16TRUk",
    projectId: "optimistic-shape-lc9s2",
    messagingSenderId: "245250708106",
    appId: "1:245250708106:web:09d74cd08c236b83c59373"
  };

  if (typeof firebase !== 'undefined' && firebase.apps && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  if (typeof firebase !== 'undefined' && firebase.messaging) {
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      console.log('[firebase-messaging-sw.js] Background message received:', payload);
      const notificationTitle = payload.notification?.title || 'Jardim Vivência CRM';
      const notificationOptions = {
        body: payload.notification?.body || 'Novo alerta de follow-up pendente.',
        icon: '/favicon.ico',
        badge: '/favicon.ico'
      };

      self.registration.showNotification(notificationTitle, notificationOptions);
    });

    console.log('[firebase-messaging-sw.js] Push Service Worker loaded successfully.');
  }
} catch (e) {
  console.warn('[firebase-messaging-sw.js] Service worker initialization notice (non-blocking):', e);
}

