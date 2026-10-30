// 合言葉の窓口
// 合言葉が正しければ、cookie に「合格の印」を入れて返す

import { cookies } from "next/headers";
import { z } from "zod";
import {
  AUTH_COOKIE_MAX_AGE,
  AUTH_COOKIE_NAME,
  createAuthToken,
  isValidPasscode,
} from "@/lib/auth";

// 送られてくる内容のチェック
const bodySchema = z.object({
  passcode: z.string().min(1).max(100),
});

// 間違えたときに少し待たせて、合言葉を総当たりで試されにくくする
const WRONG_PASSCODE_DELAY_MS = 1000;

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "合言葉を入力してください。" }, { status: 400 });
  }

  if (!isValidPasscode(parsed.data.passcode)) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSCODE_DELAY_MS));
    return Response.json({ error: "合言葉が違います。" }, { status: 401 });
  }

  // 合格の印を cookie に入れる
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, createAuthToken(), {
    httpOnly: true, // JavaScript から読めないようにする（盗まれにくくする）
    secure: process.env.NODE_ENV === "production", // 公開時は https のときだけ送る
    sameSite: "lax", // ほかのサイトからのリクエストには付けない
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  });

  return Response.json({ ok: true });
}
