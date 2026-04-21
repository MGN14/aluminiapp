import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom 20 no implementa Blob.text() ni Blob.arrayBuffer(). Los polyfilleamos
// usando FileReader (que sí está disponible) para que el código que lee
// archivos subidos por el usuario funcione en tests igual que en el browser.
function readBlobAs(
  blob: Blob,
  kind: "text" | "arrayBuffer"
): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    if (kind === "text") reader.readAsText(blob);
    else reader.readAsArrayBuffer(blob);
  });
}

if (typeof Blob !== "undefined" && !Blob.prototype.text) {
  Blob.prototype.text = function () {
    return readBlobAs(this, "text") as Promise<string>;
  };
}
if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return readBlobAs(this, "arrayBuffer") as Promise<ArrayBuffer>;
  };
}
