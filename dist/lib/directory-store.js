const DB_NAME = 'xiv-orchestrion-player';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'sqpack';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地目录记忆。'));
  });
}

export async function saveDirectoryHandle(handle) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    request.onsuccess = resolve; request.onerror = () => reject(request.error);
  });
  db.close();
}

export async function loadDirectoryHandle() {
  const db = await openDatabase();
  const handle = await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
  });
  db.close();
  return handle;
}

export async function directoryPermission(handle, request = false) {
  if (!handle?.queryPermission) return 'denied';
  let permission = await handle.queryPermission({ mode: 'read' });
  if (permission === 'prompt' && request && handle.requestPermission) permission = await handle.requestPermission({ mode: 'read' });
  return permission;
}
