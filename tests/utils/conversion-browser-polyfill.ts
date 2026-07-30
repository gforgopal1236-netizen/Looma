import { Image as CanvasImage, createCanvas } from "@napi-rs/canvas";

const blobUrls = new Map<string, Blob>();
let installed = false;
let objectUrlCounter = 0;
const canvasImageBase = CanvasImage as unknown as new () => {
  decode(): Promise<void>;
};
const imageSrcDescriptor = Object.getOwnPropertyDescriptor(CanvasImage.prototype, "src");

export function installConversionBrowserPolyfill() {
  if (installed) {
    return;
  }

  installed = true;

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement(tagName: string) {
        if (tagName.toLowerCase() === "canvas") {
          return createCanvas(1, 1);
        }

        throw new Error(`Unsupported test DOM element: ${tagName}`);
      }
    }
  });

  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class TestImage extends canvasImageBase {
      #src = "";

      get src() {
        return this.#src;
      }

      set src(value: string | Buffer) {
        if (Buffer.isBuffer(value)) {
          imageSrcDescriptor?.set?.call(this, value);
          this.#src = "";
          return;
        }

        this.#src = String(value);

        if (!blobUrls.has(this.#src)) {
          imageSrcDescriptor?.set?.call(this, value);
        }
      }

      async decode() {
        const blob = blobUrls.get(this.#src);

        if (blob) {
          imageSrcDescriptor?.set?.call(this, Buffer.from(await blob.arrayBuffer()));
        }

        return super.decode();
      }
    }
  });

  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:looma-test-${objectUrlCounter}`;
    objectUrlCounter += 1;
    blobUrls.set(url, blob);
    return url;
  };

  URL.revokeObjectURL = (url: string) => {
    blobUrls.delete(url);
  };
}
