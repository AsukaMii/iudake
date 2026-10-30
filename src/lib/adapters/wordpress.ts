// WordPress用アダプター
// WordPressのREST APIとのやり取りは、すべてこのファイルにまとめる
// ※ サーバー側（Route Handlerなど）からだけ使うこと。ブラウザ側で読み込まない

// 一覧で使う、投稿・固定ページの共通の形
export type WpItemSummary = {
  id: number;
  title: string;
  status: string; // publish（公開）、draft（下書き）など
  date: string; // 作成日時
  modified: string; // 最終更新日時
  link: string; // 公開ページのURL
};

// REST APIから返ってくる生データの形（必要な項目だけ）
type WpRawItem = {
  id: number;
  title: { raw: string };
  status: string;
  date: string;
  modified: string;
  link: string;
};

// .env.local から接続情報を読み込む
function getConfig() {
  const baseUrl = process.env.WP_BASE_URL;
  const username = process.env.WP_USERNAME;
  const appPassword = process.env.WP_APP_PASSWORD;

  if (!baseUrl || !username || !appPassword) {
    throw new Error(
      "WordPressの接続情報が足りません。.env.local を確認してください。"
    );
  }

  return { baseUrl, username, appPassword };
}

// WordPressのREST APIを呼び出す共通の関数
// path の例："/wp/v2/posts?per_page=10"
async function wpFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, username, appPassword } = getConfig();

  // Basic認証：「ユーザー名:パスワード」をBase64に変換してヘッダーに付ける
  const token = Buffer.from(`${username}:${appPassword}`).toString("base64");

  const res = await fetch(`${baseUrl}/wp-json${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store", // 常に最新の内容を取得する
  });

  if (!res.ok) {
    // エラーの内容はサーバーのログで確認できるようにする（秘密情報は含めない）
    const body = await res.text();
    throw new Error(`WordPress APIエラー（${res.status}）：${body}`);
  }

  return res.json() as Promise<T>;
}

// 生データを、一覧用の形に変換する
function toSummary(item: WpRawItem): WpItemSummary {
  return {
    id: item.id,
    title: item.title.raw,
    status: item.status,
    date: item.date,
    modified: item.modified,
    link: item.link,
  };
}

// 一覧取得で共通して付けるパラメーター
const LIST_PARAMS = new URLSearchParams({
  context: "edit", // 元の文字のままのタイトル（raw）を受け取る
  status: "publish,draft", // 公開済みと下書きの両方
  per_page: "20", // 最大件数
  _fields: "id,title,status,date,modified,link", // 必要な項目だけ
}).toString();

// 投稿（お知らせ）の一覧を取得する
export async function listPosts(): Promise<WpItemSummary[]> {
  const items = await wpFetch<WpRawItem[]>(`/wp/v2/posts?${LIST_PARAMS}`);
  return items.map(toSummary);
}

// 固定ページの一覧を取得する
export async function listPages(): Promise<WpItemSummary[]> {
  const items = await wpFetch<WpRawItem[]>(`/wp/v2/pages?${LIST_PARAMS}`);
  return items.map(toSummary);
}

// ------------------------------------------------------------
// 1件の取得・作成・更新
// ------------------------------------------------------------

// 固定ページ1件の形（一覧の項目に、本文を足したもの）
export type WpPageDetail = WpItemSummary & {
  content: string; // ブロック形式の本文（<!-- wp:paragraph --> などを含む）
};

// REST APIから返ってくる、本文付きの生データ
type WpRawDetail = WpRawItem & {
  content: { raw: string };
};

// 固定ページ1件を取得する
export async function getPage(id: number): Promise<WpPageDetail> {
  const params = new URLSearchParams({
    context: "edit", // 本文を元の形（raw）のまま受け取る
    _fields: "id,title,status,date,modified,link,content",
  }).toString();

  const item = await wpFetch<WpRawDetail>(`/wp/v2/pages/${id}?${params}`);
  return { ...toSummary(item), content: item.content.raw };
}

// HTMLとして特別な意味を持つ文字を、安全な形に置き換える
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ただの文章を、ブロックエディタの段落ブロックに変換する
// 空行で区切られたかたまりを1つの段落にし、段落内の改行は <br> にする
function textToBlocks(text: string): string {
  return text
    .split(/\n\s*\n/) // 空行で分ける
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => {
      const html = escapeHtml(paragraph).replace(/\n/g, "<br>");
      return `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`;
    })
    .join("\n\n");
}

// お知らせ（投稿）を下書きで作成する
// ※ 安全のため、必ず下書き（draft）で作る。公開は利用者がWordPressで行う
//   （または、利用者が画面で承認したときに publishDraftPost で公開する）
export async function createDraftPost(input: {
  title: string;
  content: string; // ただの文章（改行・空行はそのまま段落になる）
}): Promise<WpItemSummary> {
  const item = await wpFetch<WpRawItem>(
    "/wp/v2/posts?context=edit&_fields=id,title,status,date,modified,link",
    {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        content: textToBlocks(input.content),
        status: "draft", // 外から変えられないように固定
      }),
    }
  );
  return toSummary(item);
}

// 下書きのお知らせ（投稿）を公開する
// ※ 利用者が画面で「はい、公開する」を押したときだけ呼ばれる
// ※ 間違ったお知らせを公開しないように、公開する前に次の2つを確かめる
//   1. 今「下書き」であること（公開済みや予約投稿などは触らない）
//   2. タイトルが、利用者が承認画面で見たものと一致すること
export async function publishDraftPost(input: {
  id: number;
  title: string; // 承認画面で見せたタイトル
}): Promise<WpItemSummary> {
  const fields = "context=edit&_fields=id,title,status,date,modified,link";

  // まず今の状態を取得する
  const current = await wpFetch<WpRawItem>(`/wp/v2/posts/${input.id}?${fields}`);
  if (current.status !== "draft") {
    throw new Error("このお知らせは下書きではないため、公開できません。");
  }
  if (current.title.raw !== input.title) {
    throw new Error("タイトルが一致しないため、公開を中止しました。");
  }

  // 公開状態だけを変える（本文などは送らない）
  const item = await wpFetch<WpRawItem>(`/wp/v2/posts/${input.id}?${fields}`, {
    method: "POST",
    body: JSON.stringify({ status: "publish" }),
  });
  return toSummary(item);
}

// 固定ページのタイトル・本文を更新する
// ※ 利用者が「反映する」を押したときだけ、サーバーから呼ぶ
// ※ 更新前の内容は、WordPressがリビジョンとして自動で残す
export async function updatePage(input: {
  id: number;
  title?: string; // 省略したらタイトルは変えない
  content: string; // ブロック形式の本文（getPage で取得した形）
}): Promise<WpPageDetail> {
  // 変えてよいのはタイトルと本文だけ（公開状態やURLは送らない）
  const body: { content: string; title?: string } = { content: input.content };
  if (input.title !== undefined) {
    body.title = input.title;
  }

  const item = await wpFetch<WpRawDetail>(
    `/wp/v2/pages/${input.id}?context=edit&_fields=id,title,status,date,modified,link,content`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  return { ...toSummary(item), content: item.content.raw };
}
