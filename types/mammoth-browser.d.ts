declare module "mammoth/mammoth.browser" {
  export interface MammothMessage {
    type: string;
    message: string;
  }

  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  export function convertToHtml(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<MammothResult>;

  export function extractRawText(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<MammothResult>;
}
