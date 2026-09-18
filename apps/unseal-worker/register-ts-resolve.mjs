import { register } from "node:module";

// [S1.82 / khoan 116] Bo ghi danh hook resolve cho `pnpm worker:dev`. Cung khuon `apps/api`; xem
// ly do ban sao co chu y o dau `ts-resolve-hook.mjs` — thu muc nay khong duoc import tu app khac.
register("./ts-resolve-hook.mjs", import.meta.url);
