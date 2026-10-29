// 確認用：WordPressアダプターが動くかを試すためのAPI
// ブラウザで /api/wp-test を開くと、投稿と固定ページの一覧をJSONで返す
// ※ 下書きも表示されるので、開発中（npm run dev）だけ動くようにしている
//
// 使い方（?action= で試す内容を切り替える）
//   /api/wp-test                         → 投稿と固定ページの一覧
//   /api/wp-test?action=getPage&id=9     → 固定ページ1件の本文
//   /api/wp-test?action=createDraft      → テスト用のお知らせを下書きで作成
// ※ 本来、作成などの操作はGETでは行わない。開発中の確認用なので例外的にGETで試せるようにしている

import { connection, NextResponse, type NextRequest } from "next/server";
import {
  createDraftPost,
  getPage,
  listPages,
  listPosts,
} from "@/lib/adapters/wordpress";

export async function GET(request: NextRequest) {
  // アクセスのたびに実行する（ビルド時に結果を固定しない）
  await connection();

  // 本番環境では使えないようにする
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  // URLの ?action= と ?id= を読み取る
  const action = request.nextUrl.searchParams.get("action");
  const id = Number(request.nextUrl.searchParams.get("id"));

  try {
    // 固定ページ1件を取得する
    if (action === "getPage") {
      if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json(
          { error: "id を正しく指定してください（例：?action=getPage&id=9）" },
          { status: 400 }
        );
      }
      const page = await getPage(id);
      return NextResponse.json({ page });
    }

    // テスト用のお知らせを下書きで作成する
    if (action === "createDraft") {
      const post = await createDraftPost({
        title: "【テスト】イウダケからの下書き",
        content:
          "これはイウダケのテストで作成した下書きです。\n2行目は改行のテストです。\n\nここから2つ目の段落です。",
      });
      return NextResponse.json({ post });
    }

    // 指定なし：投稿と固定ページを同時に取得する
    const [posts, pages] = await Promise.all([listPosts(), listPages()]);
    return NextResponse.json({ posts, pages });
  } catch (error) {
    // 詳しいエラーはサーバーのターミナルに出す
    console.error(error);
    return NextResponse.json(
      { error: "WordPressからの取得に失敗しました" },
      { status: 500 }
    );
  }
}
