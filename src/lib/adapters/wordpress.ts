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

// 扱う種類（REST APIのURLの名前）："posts"（お知らせ）または "pages"（固定ページ）
type WpContentType = "posts" | "pages";

// エラーメッセージで使う、種類の呼び方
const TYPE_LABELS: Record<WpContentType, string> = {
  posts: "お知らせ",
  pages: "ページ",
};

// 1件分の取得・更新で受け取る項目
const DETAIL_FIELDS = "context=edit&_fields=id,title,status,date,modified,link,content";

// 固定ページ・お知らせ1件の形（一覧の項目に、本文を足したもの）
export type WpPageDetail = WpItemSummary & {
  content: string; // ブロック形式の本文（<!-- wp:paragraph --> などを含む）
};

// REST APIから返ってくる、本文付きの生データ
type WpRawDetail = WpRawItem & {
  content: { raw: string };
};

// 1件を取得する（お知らせ・固定ページ共通）
// context=edit で、本文を元の形（raw）のまま受け取る
async function getItem(type: WpContentType, id: number): Promise<WpPageDetail> {
  const item = await wpFetch<WpRawDetail>(`/wp/v2/${type}/${id}?${DETAIL_FIELDS}`);
  return { ...toSummary(item), content: item.content.raw };
}

// 固定ページ1件を取得する
// ※ ページの中にある画像の一覧も一緒に返す（画像の差し替えで、どれを替えるか選ぶため）
export async function getPage(id: number): Promise<WpPageDetail & { images: PageImage[] }> {
  const page = await getItem("pages", id);
  const images = findImageBlocks(page.content).map(({ mediaId, url, alt }) => ({
    mediaId,
    url,
    alt,
  }));
  return { ...page, images };
}

// お知らせ（投稿）1件を取得する
// ※ 今のアイキャッチ画像（なければ null）も一緒に返す
export async function getPost(
  id: number
): Promise<WpPageDetail & { featuredImage: WpMedia | null }> {
  const [post, featuredMediaId] = await Promise.all([
    getItem("posts", id),
    getFeaturedMediaId(id),
  ]);
  const featuredImage = featuredMediaId ? await getImage(featuredMediaId) : null;
  return { ...post, featuredImage };
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

// タイトル・本文を更新する（お知らせ・固定ページ共通）
// ※ 利用者が「反映する」を押したときだけ、サーバーから呼ぶ
// ※ 更新前の内容は、WordPressがリビジョンとして自動で残す
async function updateItem(
  type: WpContentType,
  input: {
    id: number;
    title?: string; // 省略したらタイトルは変えない
    content: string; // ブロック形式の本文（getItem で取得した形）
  }
): Promise<WpPageDetail> {
  // 変えてよいのはタイトルと本文だけ（公開状態やURLは送らない）
  const body: { content: string; title?: string } = { content: input.content };
  if (input.title !== undefined) {
    body.title = input.title;
  }

  const item = await wpFetch<WpRawDetail>(`/wp/v2/${type}/${input.id}?${DETAIL_FIELDS}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { ...toSummary(item), content: item.content.raw };
}

// 固定ページのタイトル・本文を更新する
export async function updatePage(input: {
  id: number;
  title?: string;
  content: string;
}): Promise<WpPageDetail> {
  return updateItem("pages", input);
}

// 文章の一部を差し替える（1つの差し替え。お知らせ・固定ページ共通）
export type PageTextEdit = {
  before: string; // 変更前の文字（本文の中にちょうど1か所あること）
  after: string; // 変更後の文字
};

// 文字の中に、探したい文字が何か所あるかを数える
function countOccurrences(text: string, search: string): number {
  return text.split(search).length - 1;
}

// 差し替え方式の修正で受け取る内容
type EditTextInput = {
  id: number;
  title: string; // 承認画面で見せた、今のタイトル
  newTitle?: string; // 新しいタイトル（タイトルを変えないときは省略）
  edits: PageTextEdit[]; // 本文の差し替え（本文を変えないときは空）
};

// 文章を、差し替え方式で修正する（お知らせ・固定ページ共通）
// ※ 利用者が画面で「反映する」を押したときだけ呼ばれる
// ※ 本文の全文は受け取らず、「この文字をこう変える」だけを受け取る
//   （ブロックの記号やデザインを壊さないようにするため）
// ※ 1つでも確認に失敗したら、何も変えずにエラーにする
async function editItemText(
  type: WpContentType,
  input: EditTextInput
): Promise<WpItemSummary> {
  const label = TYPE_LABELS[type];

  // 0. 何か変えるものがあるか
  if (input.edits.length === 0 && input.newTitle === undefined) {
    throw new Error("変える内容がありません。");
  }

  const page = await getItem(type, input.id);

  // 1. タイトルが一致するか（違うページを書き換えないように）
  if (page.title !== input.title) {
    throw new Error(`${label}のタイトルが一致しないため、修正を中止しました。`);
  }

  // 新しいタイトルにも、HTMLタグは入れさせない
  if (input.newTitle !== undefined && /[<>]/.test(input.newTitle)) {
    throw new Error("HTMLタグを含む修正はできません。");
  }

  let content = page.content;
  for (const edit of input.edits) {
    // 2. HTMLタグを含んでいないか（ブロックやデザインを触らせない）
    if (/[<>]/.test(edit.before) || /[<>]/.test(edit.after)) {
      throw new Error("HTMLタグを含む修正はできません。");
    }
    // 3. 変更前の文字が、ちょうど1か所だけあるか
    const count = countOccurrences(content, edit.before);
    if (count === 0) {
      throw new Error(`「${edit.before}」が${label}の中に見つかりませんでした。`);
    }
    if (count > 1) {
      throw new Error(
        `「${edit.before}」が${label}の中に${count}か所あるため、どこを変えるか決められません。`
      );
    }
    // 差し替える（replace は $ などの記号を特別扱いするので、split と join を使う）
    content = content.split(edit.before).join(edit.after);
  }

  // 更新する（変更前の内容は、WordPressがリビジョンとして自動で残す）
  const updated = await updateItem(type, {
    id: input.id,
    title: input.newTitle,
    content,
  });
  // 返すのは本文以外だけにする（AIに長い本文を返さないため）
  const { id, title, status, date, modified, link } = updated;
  return { id, title, status, date, modified, link };
}

// 固定ページの文章を、差し替え方式で修正する
export async function editPageText(input: EditTextInput): Promise<WpItemSummary> {
  return editItemText("pages", input);
}

// お知らせ（投稿）の文章を、差し替え方式で修正する
export async function editPostText(input: EditTextInput): Promise<WpItemSummary> {
  return editItemText("posts", input);
}

// ------------------------------------------------------------
// 非公開にする・ゴミ箱に入れる
// ------------------------------------------------------------

// 非公開・ゴミ箱で受け取る内容
// kind："post"（お知らせ）または "page"（固定ページ）
type ChangeStatusInput = {
  kind: "post" | "page";
  id: number;
  title: string; // 承認画面で見せたタイトル
};

// kind を REST APIのURLの名前に変える
function toContentType(kind: ChangeStatusInput["kind"]): WpContentType {
  return kind === "post" ? "posts" : "pages";
}

// サイトのトップページかどうか（ページのURLが、サイトのURLと同じなら トップページ）
function isFrontPage(item: WpItemSummary): boolean {
  const { baseUrl } = getConfig();
  const normalize = (url: string) => url.replace(/\/+$/, "");
  return normalize(item.link) === normalize(baseUrl);
}

// 非公開・ゴミ箱の前に、共通で確かめること
// 1. タイトルが一致するか（違うものを消さないように）
// 2. トップページではないか（サイトの入り口が表示されなくなるので、イウダケからは触らせない）
async function getItemForStatusChange(input: ChangeStatusInput): Promise<WpPageDetail> {
  const type = toContentType(input.kind);
  const label = TYPE_LABELS[type];
  const item = await getItem(type, input.id);

  if (item.title !== input.title) {
    throw new Error(`${label}のタイトルが一致しないため、中止しました。`);
  }
  if (type === "pages" && isFrontPage(item)) {
    throw new Error("トップページは、イウダケからは非公開にしたり削除したりできません。");
  }
  return item;
}

// 公開中のお知らせ・固定ページを、非公開（下書き）に戻す
// ※ 利用者が画面で「非公開にする」を押したときだけ呼ばれる
// ※ 下書きに戻すだけなので、あとで公開し直せる
export async function unpublishContent(input: ChangeStatusInput): Promise<WpItemSummary> {
  const item = await getItemForStatusChange(input);
  if (item.status !== "publish") {
    throw new Error("公開中ではないため、非公開にする必要はありません。");
  }

  // 公開状態だけを変える（本文などは送らない）
  const type = toContentType(input.kind);
  const updated = await wpFetch<WpRawItem>(
    `/wp/v2/${type}/${input.id}?context=edit&_fields=id,title,status,date,modified,link`,
    {
      method: "POST",
      body: JSON.stringify({ status: "draft" }),
    }
  );
  return toSummary(updated);
}

// お知らせを、ゴミ箱に入れる
// ※ 利用者が画面で「ゴミ箱に入れる」を押したときだけ呼ばれる
// ※ 完全には削除しない（force を付けない）。WordPressの管理画面の「ゴミ箱」から元に戻せる
// ※ 固定ページは、イウダケからは削除させない（ツールの定義でも止めているが、念のためここでも止める）
export async function trashContent(input: ChangeStatusInput): Promise<WpItemSummary> {
  if (input.kind !== "post") {
    throw new Error("固定ページは、イウダケからは削除できません。");
  }
  await getItemForStatusChange(input);

  const type = toContentType(input.kind);
  const trashed = await wpFetch<WpRawItem>(
    `/wp/v2/${type}/${input.id}?context=edit&_fields=id,title,status,date,modified,link`,
    { method: "DELETE" }
  );
  return toSummary(trashed);
}

// ------------------------------------------------------------
// 画像（メディアライブラリ）
// ------------------------------------------------------------

// アップロードした画像の情報
export type WpMedia = {
  id: number; // 画像ID（アイキャッチ画像の設定などで使う）
  url: string; // 元の大きさの画像のURL
  thumbnailUrl: string; // プレビュー用の小さい画像のURL（なければ元の画像）
};

// REST APIから返ってくる、画像の生データ（必要な項目だけ）
type WpRawMedia = {
  id: number;
  source_url: string;
  media_details?: { sizes?: Record<string, { source_url: string }> };
};

// 生データを、画面で使う形に変換する
function toMedia(item: WpRawMedia): WpMedia {
  const sizes = item.media_details?.sizes ?? {};
  return {
    id: item.id,
    url: item.source_url,
    thumbnailUrl: sizes.medium?.source_url ?? item.source_url,
  };
}

// 画像を、メディアライブラリにアップロードする
// ※ ここではページやお知らせには表示されない（設定は、利用者が承認したときに別で行う）
export async function uploadMedia(input: {
  data: ArrayBuffer; // 画像のデータ
  mimeType: string; // "image/jpeg" など
  fileName: string; // 半角英数字のファイル名（日本語は文字化けすることがあるため）
}): Promise<WpMedia> {
  const item = await wpFetch<WpRawMedia>(
    "/wp/v2/media?_fields=id,source_url,media_details",
    {
      method: "POST",
      body: input.data,
      headers: {
        "Content-Type": input.mimeType,
        // WordPressに、ファイル名を伝える
        "Content-Disposition": `attachment; filename="${input.fileName}"`,
      },
    }
  );
  return toMedia(item);
}

// ------------------------------------------------------------
// アイキャッチ画像（お知らせの代表の画像）
// ------------------------------------------------------------

// メディアライブラリの画像1件を、生データのまま取得する
// ※ 画像ではないもの（PDFなど）や、存在しないIDはエラーにする
async function getRawImage(id: number): Promise<WpRawMedia> {
  const item = await wpFetch<WpRawMedia & { media_type: string }>(
    `/wp/v2/media/${id}?context=edit&_fields=id,source_url,media_details,media_type`
  ).catch(() => {
    throw new Error(`画像ID ${id} の画像が見つかりませんでした。`);
  });
  if (item.media_type !== "image") {
    throw new Error(`画像ID ${id} は画像ではありません。`);
  }
  return item;
}

// メディアライブラリの画像1件を取得する
async function getImage(id: number): Promise<WpMedia> {
  return toMedia(await getRawImage(id));
}

// お知らせに設定されている、アイキャッチ画像のID（なければ 0）
async function getFeaturedMediaId(postId: number): Promise<number> {
  const item = await wpFetch<{ featured_media: number }>(
    `/wp/v2/posts/${postId}?context=edit&_fields=featured_media`
  );
  return item.featured_media ?? 0;
}

// お知らせのタイトルが一致するか確かめる（違うお知らせを変えないように）
async function checkPostTitle(postId: number, title: string): Promise<void> {
  const post = await getItem("posts", postId);
  if (post.title !== title) {
    throw new Error("お知らせのタイトルが一致しないため、中止しました。");
  }
}

// お知らせのアイキャッチ画像を設定する（すでにあれば差し替える）
// ※ 利用者が画面で「反映する」を押したときだけ呼ばれる
export async function setFeaturedImage(input: {
  postId: number;
  postTitle: string; // 承認画面で見せたタイトル
  mediaId: number; // 利用者が添えた写真の画像ID
  altText: string; // 代替テキスト（利用者に聞いた、写真の説明）
}): Promise<WpItemSummary & { image: WpMedia }> {
  await checkPostTitle(input.postId, input.postTitle);
  const image = await getImage(input.mediaId); // 本当にある画像か

  // 代替テキストにも、HTMLタグは入れさせない
  if (/[<>]/.test(input.altText)) {
    throw new Error("HTMLタグを含む説明は使えません。");
  }

  // 1. 画像に、代替テキストを設定する
  await wpFetch(`/wp/v2/media/${input.mediaId}?_fields=id`, {
    method: "POST",
    body: JSON.stringify({ alt_text: input.altText }),
  });

  // 2. お知らせに、アイキャッチ画像を設定する（変えるのは featured_media だけ）
  const post = await wpFetch<WpRawItem>(
    `/wp/v2/posts/${input.postId}?context=edit&_fields=id,title,status,date,modified,link`,
    {
      method: "POST",
      body: JSON.stringify({ featured_media: input.mediaId }),
    }
  );
  return { ...toSummary(post), image };
}

// お知らせのアイキャッチ画像を外す
// ※ 利用者が画面で「外す」を押したときだけ呼ばれる
// ※ 画像そのものは、メディアライブラリに残す
export async function removeFeaturedImage(input: {
  postId: number;
  postTitle: string;
}): Promise<WpItemSummary> {
  await checkPostTitle(input.postId, input.postTitle);
  if ((await getFeaturedMediaId(input.postId)) === 0) {
    throw new Error("このお知らせには、写真が設定されていません。");
  }

  const post = await wpFetch<WpRawItem>(
    `/wp/v2/posts/${input.postId}?context=edit&_fields=id,title,status,date,modified,link`,
    {
      method: "POST",
      body: JSON.stringify({ featured_media: 0 }), // 0 で「なし」になる
    }
  );
  return toSummary(post);
}

// ------------------------------------------------------------
// 固定ページの画像の差し替え
// ------------------------------------------------------------

// 固定ページの中にある画像（AIに見せる形）
export type PageImage = {
  mediaId: number; // 画像ID
  url: string; // 表示されている画像のURL
  alt: string; // 今の代替テキスト
};

// 本文の中の画像ブロック1つ分
type ImageBlock = PageImage & {
  block: string; // ブロック全体の文字（<!-- wp:image ... --> 〜 <!-- /wp:image -->）
  attrs: string; // ブロックの設定（JSONの文字）
  sizeSlug: string; // 表示している大きさ（"large" など）
};

// 本文から、ふつうの「画像」ブロックを探す
// ※ カバー（背景画像）などのブロックは対象にしない
function findImageBlocks(content: string): ImageBlock[] {
  const pattern = /<!-- wp:image(?: (\{[\s\S]*?\}))? -->([\s\S]*?)<!-- \/wp:image -->/g;
  const blocks: ImageBlock[] = [];
  for (const match of content.matchAll(pattern)) {
    const attrs = match[1] ?? "{}";
    let parsed: { id?: number; sizeSlug?: string } = {};
    try {
      parsed = JSON.parse(attrs);
    } catch {
      continue; // 読めない設定のブロックは扱わない
    }
    if (!parsed.id) continue; // メディアライブラリの画像でないもの（外部のURLなど）は扱わない
    const html = match[2];
    blocks.push({
      block: match[0],
      attrs,
      mediaId: parsed.id,
      sizeSlug: parsed.sizeSlug ?? "full",
      url: html.match(/<img[^>]*\ssrc="([^"]*)"/)?.[1] ?? "",
      alt: html.match(/<img[^>]*\salt="([^"]*)"/)?.[1] ?? "",
    });
  }
  return blocks;
}

// 固定ページの画像を、別の画像に差し替える
// ※ 利用者が画面で「反映する」を押したときだけ呼ばれる
// ※ 入れ替えるのは、画像ID・画像のURL・代替テキストだけ。大きさ・配置・角の丸みなどの設定はそのまま
// ※ 画像が置かれていない場所に、新しく画像を足すことはできない（デザインに関わるため）
export async function replacePageImage(input: {
  pageId: number;
  pageTitle: string; // 承認画面で見せたタイトル
  oldMediaId: number; // 今の画像の画像ID（getPage の images から選ぶ）
  newMediaId: number; // 利用者が添えた写真の画像ID
  altText: string; // 新しい写真の代替テキスト
}): Promise<WpItemSummary & { image: WpMedia }> {
  const page = await getItem("pages", input.pageId);

  // 1. タイトルが一致するか
  if (page.title !== input.pageTitle) {
    throw new Error("ページのタイトルが一致しないため、中止しました。");
  }
  // 2. 代替テキストに、HTMLタグや " を入れさせない（ブロックを壊さないため）
  if (/[<>"]/.test(input.altText)) {
    throw new Error("写真の説明に、< > \" の記号は使えません。");
  }
  // 3. 差し替える画像が、ページにちょうど1つだけあるか
  const targets = findImageBlocks(page.content).filter((b) => b.mediaId === input.oldMediaId);
  if (targets.length === 0) {
    throw new Error(`画像ID ${input.oldMediaId} の画像が、ページの中に見つかりませんでした。`);
  }
  if (targets.length > 1) {
    throw new Error(`画像ID ${input.oldMediaId} の画像が、ページの中に${targets.length}か所あります。`);
  }
  const target = targets[0];

  // 4. 新しい画像が本当にあるか。元のブロックと同じ大きさの画像のURLを使う
  const raw = await getRawImage(input.newMediaId);
  const newUrl = raw.media_details?.sizes?.[target.sizeSlug]?.source_url ?? raw.source_url;

  // HTMLの中に入れる代替テキスト（& は &amp; にする。WordPressのエディターと同じ書き方にするため）
  const altHtml = input.altText.replace(/&/g, "&amp;");

  // 画像ID・画像のURL・代替テキストの4か所だけを置き換える
  // ※ replace の2つ目に文字を渡すと $ などを特別扱いするので、関数で返す
  const newAttrs = target.attrs.replace(`"id":${input.oldMediaId}`, () => `"id":${input.newMediaId}`);
  let newBlock = target.block
    .replace(target.attrs, () => newAttrs)
    .replace(`wp-image-${input.oldMediaId}`, () => `wp-image-${input.newMediaId}`)
    .replace(/(<img[^>]*\ssrc=")[^"]*(")/, (_, before, after) => before + newUrl + after);
  newBlock = /<img[^>]*\salt="/.test(newBlock)
    ? newBlock.replace(/(<img[^>]*\salt=")[^"]*(")/, (_, before, after) => before + altHtml + after)
    : newBlock.replace("<img ", () => `<img alt="${altHtml}" `);

  // 画像そのものにも、代替テキストを設定しておく
  await wpFetch(`/wp/v2/media/${input.newMediaId}?_fields=id`, {
    method: "POST",
    body: JSON.stringify({ alt_text: input.altText }),
  });

  // 更新する（変更前の内容は、WordPressがリビジョンとして自動で残す）
  const updated = await updateItem("pages", {
    id: input.pageId,
    content: page.content.split(target.block).join(newBlock),
  });
  const { id, title, status, date, modified, link } = updated;
  return { id, title, status, date, modified, link, image: toMedia(raw) };
}
