/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
    readonly SEA_APP_TITLE: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
