import { register } from "node:module";

// [S1.11] Bo ghi danh hook resolve cho `pnpm api:dev`. Cung khuon hai tool dev; xem ly do ban sao
// co chu y o dau `ts-resolve-hook.mjs` (mot cạnh import giua app va tool la mot cạnh depcruise phai bless).
register("./ts-resolve-hook.mjs", import.meta.url);
