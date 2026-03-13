/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_GOOGLE_MAPS_API_KEY: string;
    readonly VITE_GEMINI_API_KEY: string;
    // Add other Vite environment variables here as needed
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
