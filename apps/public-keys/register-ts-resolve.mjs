import { register } from "node:module";

// [S1.128 / khoan 15] Bo ghi danh hook resolve cho `pnpm public-keys:dev`. Cung khuon
// `apps/unseal-worker`; xem ly do ban sao co chu y o dau `ts-resolve-hook.mjs`.
register("./ts-resolve-hook.mjs", import.meta.url);
