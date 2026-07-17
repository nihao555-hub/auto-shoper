import type { ProductRecord } from "./types";

const DATABASE_NAME = "auto-shoper-workbench";
const DATABASE_VERSION = 1;
const SESSION_STORE = "sessions";

export type WorkbenchSnapshot = {
  version: 1;
  batchId: string;
  products: ProductRecord[];
  updatedAt: string;
};

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        database.createObjectStore(SESSION_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开工作台本地存储"));
  });

const runTransaction = <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> =>
  openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(SESSION_STORE, mode);
        const request = operation(transaction.objectStore(SESSION_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("工作台本地存储操作失败"));
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error("工作台本地存储事务失败"));
        };
      }),
  );

export const workbenchSessionKey = (workspaceId: string, storeId: string | null): string =>
  `${workspaceId}:${storeId ?? "no-store"}`;

export const loadWorkbenchSnapshot = async (
  key: string,
): Promise<WorkbenchSnapshot | null> => {
  const value = await runTransaction<WorkbenchSnapshot | undefined>("readonly", (store) =>
    store.get(key),
  );
  if (!value || value.version !== 1 || !value.batchId || !Array.isArray(value.products)) {
    return null;
  }
  return value;
};

export const saveWorkbenchSnapshot = async (
  key: string,
  snapshot: WorkbenchSnapshot,
): Promise<void> => {
  await runTransaction<IDBValidKey>("readwrite", (store) => store.put(snapshot, key));
};

export const restoreProductImageUrls = (products: ProductRecord[]): ProductRecord[] =>
  products.map((product) => ({
    ...product,
    images: product.images.map((image) => ({
      ...image,
      url:
        image.sourceFile instanceof File
          ? URL.createObjectURL(image.sourceFile)
          : image.photoBankUrl || image.url,
    })),
  }));
