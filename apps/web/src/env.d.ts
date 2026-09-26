/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_API_URL?: string;
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_MAX_UPLOAD_BYTES?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
interface Window {
  dzToast?: (msg: string) => void;
}
