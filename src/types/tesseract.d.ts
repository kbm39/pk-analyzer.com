declare module 'tesseract.js' {
  export function recognize(
    image: HTMLCanvasElement | OffscreenCanvas | ImageBitmap | string,
    lang?: string,
    options?: unknown,
  ): Promise<{ data?: { text?: string } }>
}
