// 画像アップロードの窓口
// ブラウザから写真を受け取り、WordPressのメディアライブラリに送る
// ※ ここではページやお知らせには表示されない。設定は、チャットで承認したときに行う

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { uploadMedia } from "@/lib/adapters/wordpress";
import { AUTH_COOKIE_NAME, isValidAuthToken } from "@/lib/auth";

// 受け付ける画像の種類と、拡張子
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// 受け付ける大きさの上限（4MB）
// ※ Vercelは、1回に送れるデータが4.5MBまでなので、それより小さくする
const MAX_FILE_SIZE = 4 * 1024 * 1024;

export async function POST(req: Request) {
  // 合言葉のチェック（合格の印がなければ断る）
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  if (!isValidAuthToken(token)) {
    return Response.json(
      { error: "合言葉を入力してください。ページを再読み込みすると、入力欄が出ます。" },
      { status: 401 }
    );
  }

  // フォームデータから、写真を取り出す
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "写真が見つかりませんでした。" }, { status: 400 });
  }

  // 種類と大きさのチェック
  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return Response.json(
      { error: "使える写真の種類は、JPEG・PNG・WebP です。" },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: "写真が大きすぎます（4MBまで）。" },
      { status: 400 }
    );
  }

  try {
    // ファイル名は、元の名前を使わずに作る（日本語や記号による文字化け・いたずらを防ぐ）
    const media = await uploadMedia({
      data: await file.arrayBuffer(),
      mimeType: file.type,
      fileName: `iudake-${randomUUID().slice(0, 8)}.${extension}`,
    });
    return Response.json(media);
  } catch (error) {
    // くわしい理由はサーバーのログにだけ出す
    console.error(error);
    return Response.json(
      { error: "写真をアップロードできませんでした。少し待ってから、もう一度お試しください。" },
      { status: 500 }
    );
  }
}
