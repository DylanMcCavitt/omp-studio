// Ambient types for the renderer component tests (*.test.tsx). tsconfig.web
// compiles `src/renderer/**`, which includes these tests, so make the Vitest
// globals (describe/it/expect/vi) and jest-dom's matcher augmentation visible to
// `tsc` here rather than importing them in every test file.
/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />
