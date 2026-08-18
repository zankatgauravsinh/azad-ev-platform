import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1)); // strip the data: prefix
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Native (Capacitor) file handoff: the Android/iOS WebView can't perform `<a download>`,
 * `window.open(blob:)` or `window.print()`, so we persist the blob to the app's cache and
 * present the OS share/open sheet — the user can view, save, or print from there.
 */
async function nativeOpenFile(blob: Blob, filename: string): Promise<void> {
  const data = await blobToBase64(blob);
  await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
  await Share.share({ title: filename, url: uri });
}

/** Triggers a download for an in-memory Blob (web) or the share/open sheet (native). */
export function saveBlob(blob: Blob, filename: string): void {
  if (Capacitor.isNativePlatform()) {
    void nativeOpenFile(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Opens a Blob (e.g. a PDF) in a new browser tab (web) or the OS viewer (native). */
export function openBlob(blob: Blob, filename = 'document.pdf'): void {
  if (Capacitor.isNativePlatform()) {
    void nativeOpenFile(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  // Give the new tab time to load before releasing the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Prints a Blob via a hidden iframe (web) or hands it to the OS viewer to print (native). */
export function printBlob(blob: Blob, filename = 'document.pdf'): void {
  if (Capacitor.isNativePlatform()) {
    void nativeOpenFile(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  const cleanup = (): void => {
    iframe.remove();
    URL.revokeObjectURL(url);
  };
  iframe.onload = (): void => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.addEventListener('afterprint', cleanup, { once: true });
    win.focus();
    win.print();
    // Fallback cleanup in case afterprint never fires (dialog dismissed).
    window.setTimeout(cleanup, 5 * 60_000);
  };
  iframe.src = url;
  document.body.appendChild(iframe);
}
