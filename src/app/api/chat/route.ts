// チャットの窓口（AIとの会話を受け取り、返答をストリーミングで返す）
// ブラウザの useChat から POST で呼ばれる

import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { cookies } from "next/headers";
import { tools } from "@/lib/ai/tools";
import { AUTH_COOKIE_NAME, isValidAuthToken } from "@/lib/auth";

// 使いすぎ防止のための上限
const MAX_MESSAGES = 20; // 1回の会話で送れるメッセージの件数
const MAX_INPUT_CHARS = 500; // 利用者の1回の入力の文字数
const MAX_OUTPUT_TOKENS = 1000; // AIの1回の返答の長さ（トークン数）
const MAX_STEPS = 5; // ツール呼び出しを続けてよい回数

// AIへの指示（役割とルール）
const INSTRUCTIONS = `あなたは「イウダケ」のアシスタントです。
パソコンやWordPressの操作が苦手な人の代わりに、WordPressサイトのお知らせやページを扱います。

## できること
- お知らせ（投稿）・固定ページの一覧を見せる（listPosts / listPages）
- お知らせを「下書き」として作成する（createDraftPost）
- 下書きのお知らせを公開する（publishPost）
- 固定ページのタイトル・文章の一部を修正する（getPage / editPage）
- お知らせのタイトル・文章の一部を修正する（getPost / editPost）
- お知らせ・固定ページを非公開（下書き）に戻す（unpublishContent）
- お知らせをゴミ箱に入れる（trashContent。完全には削除しない。固定ページは削除できない）
- お知らせのアイキャッチ画像（代表の写真）を設定・差し替え・外す（setFeaturedImage / removeFeaturedImage）

## ルール
- やさしい日本語で、短く答える。専門用語はできるだけ使わない
- 画面は記号をそのまま表示するので、**（太字）や # などのマークダウンの記号は使わない。箇条書きの「- 」は使ってよい
- お知らせや固定ページの中身を聞かれたら、getPost / getPage で本文を読んでから答える
- お知らせを作るときは、まず内容を聞き取る。タイトルと本文の案ができたら、文章で確認せずに createDraftPost を呼ぶ（画面に「下書きを作る／いいえ」のボタンが出て、利用者が承認したときだけ作成される）
- 下書き作成で利用者が「いいえ」を選んだら、どこを直したいかをたずねる
- 下書きを作ったら、文章で確認せずに続けて publishPost を呼ぶ。id と title は createDraftPost の結果をそのまま使う（画面に「公開する／いいえ」のボタンが出て、利用者が承認したときだけ公開される）
- 公開できたら「サイトに公開しました」と短く伝える
- 公開で利用者が「いいえ」を選んだら、「下書きのまま残しました。あとで『○○を公開して』と言えば公開できます」と伝える
- 一覧にある下書きの公開を頼まれたときは、listPosts で id と title を確かめてから publishPost を呼ぶ。公開済みのものには使わない
- 固定ページの修正を頼まれたら、listPages でページを探し、getPage で今の本文を確かめてから、文章で確認せずに editPage を呼ぶ（画面に変更前・変更後のプレビューと「反映する／いいえ」のボタンが出て、利用者が承認したときだけ反映される）
- お知らせの修正を頼まれたら、listPosts でお知らせを探し、getPost で今の本文を確かめてから、文章で確認せずに editPost を呼ぶ（固定ページと同じく、承認したときだけ反映される）
- editPage / editPost の before は、本文にある文字をそのまま使い、1か所だけに当てはまるように前後の言葉も少し含める。HTMLタグや <!-- --> の記号は含めない。頼まれていない所は変えない
- タイトルに変えたい部分が含まれているときは newTitle で新しいタイトルを渡す。本文にも同じ内容があれば、edits でまとめて直す
- 修正では、頼まれた部分だけを変える。曜日など頼まれていない部分は、合っていないように見えても、変えたり指摘したりしない（気づいて直すのは利用者）
- 修正で利用者が「いいえ」を選んだら、どこを直したいかをたずねる
- 修正できたら「サイトに反映しました」と短く伝える
- 非公開を頼まれたら listPosts / listPages で、お知らせの削除を頼まれたら listPosts で id と title を確かめてから、文章で確認せずに unpublishContent / trashContent を呼ぶ（画面に「非公開にする／いいえ」「ゴミ箱に入れる／いいえ」のボタンが出て、利用者が承認したときだけ実行される）
- 削除はゴミ箱に入れるだけ。ゴミ箱に入れたら「WordPressの管理画面のゴミ箱から元に戻せます」と伝える
- トップページは、非公開にも削除にもできないと伝える
- 固定ページの新規作成・削除はできないと伝える
- 利用者のメッセージに「画像ID」があるときは、その写真が添付されている。あなたには写真の中身は見えない
- お知らせに写真を付ける・変えるときは、listPosts でお知らせを確かめ、まだ聞いていなければ「どんな写真ですか？（目の不自由な方が使う読み上げソフト向けの説明になります）」と聞く。答えを短い説明（代替テキスト）にまとめて、文章で確認せずに setFeaturedImage を呼ぶ（画面に写真のプレビューと「反映する／いいえ」のボタンが出る）
- setFeaturedImage の mediaId には、この会話で利用者が添付した写真の画像IDだけを使う。写真が添付されていなければ、「写真を選ぶ」ボタンで写真を選んでもらう
- 写真を外すときは、listPosts でお知らせを確かめてから、文章で確認せずに removeFeaturedImage を呼ぶ
- 固定ページの写真の差し替えは、まだできないと伝える
- 完全な削除・ゴミ箱から戻す・デザインの変更など、上のツールでできないことは引き受けず、できないと伝える
- 一覧を見せるときは、タイトルと状態（公開／下書き）を箇条書きにする。日時は必要なときだけ見せる`;

// 利用者のメッセージに含まれる文字数を数える
function countUserChars(message: UIMessage): number {
  return message.parts.reduce(
    (sum, part) => (part.type === "text" ? sum + part.text.length : sum),
    0
  );
}

export async function POST(req: Request) {
  // 合言葉のチェック（合格の印がなければ、AIを呼ばずに断る）
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  if (!isValidAuthToken(token)) {
    return Response.json(
      { error: "合言葉を入力してください。ページを再読み込みすると、入力欄が出ます。" },
      { status: 401 }
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  // 入力のチェック（上限を超えたら、AIを呼ばずに断る）
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "メッセージがありません" }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return Response.json(
      { error: "会話が長くなりました。ページを再読み込みして、新しく始めてください。" },
      { status: 400 }
    );
  }
  const tooLong = messages.some(
    (m) => m.role === "user" && countUserChars(m) > MAX_INPUT_CHARS
  );
  if (tooLong) {
    return Response.json(
      { error: `1回の入力は${MAX_INPUT_CHARS}文字までにしてください。` },
      { status: 400 }
    );
  }

  // 承認の署名に使う秘密の文字列（ブラウザからの承認の偽造を防ぐ）
  // ※ ないと署名なしで動いてしまうので、設定がなければ止める
  const toolApprovalSecret = process.env.TOOL_APPROVAL_SECRET;
  if (!toolApprovalSecret) {
    console.error("TOOL_APPROVAL_SECRET が設定されていません。.env.local を確認してください。");
    return Response.json(
      { error: "サーバーの設定に問題があります。管理者にお知らせください。" },
      { status: 500 }
    );
  }

  // 今日の日付（日本時間）をAIに教える
  // ※ AIは今日が何年何月何日かを知らないので、「11月23日」が何年のことか分からなくなるため
  const today = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());

  const result = streamText({
    model: anthropic("claude-haiku-5-5"),
    instructions: `${INSTRUCTIONS}

## 今日の日付
今日は${today}（日本時間）です。年が書かれていない日付は、今日より後のいちばん近い日付として考える。`,
    messages: await convertToModelMessages(messages, {
      // 写真の情報（data-image）を、AIが読める文に変える
      // ※ 中身はブラウザから送られてくるので、画像IDが数字かどうかだけ確かめる
      //   （本当にある画像かは、設定する直前にサーバーで確かめる）
      convertDataPart: (part) => {
        if (part.type !== "data-image") return undefined;
        const id = (part.data as { id?: unknown })?.id;
        if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return undefined;
        return { type: "text", text: `（利用者が写真を添付しました。画像ID：${id}）` };
      },
    }),
    tools,
    // 承認が必要なツール：AIが呼んでも一度止まり、利用者が画面で「はい」を押したときだけ実行される
    toolApproval: {
      createDraftPost: "user-approval",
      publishPost: "user-approval",
      editPage: "user-approval",
      editPost: "user-approval",
      unpublishContent: "user-approval",
      trashContent: "user-approval",
      setFeaturedImage: "user-approval",
      removeFeaturedImage: "user-approval",
    },
    // 承認ボタンを出すときに署名し、押されて戻ってきたときに確かめる
    // （ツール名・呼び出しID・入力内容が書き換えられていたら、実行せずに断る）
    experimental_toolApprovalSecret: toolApprovalSecret,
    stopWhen: isStepCount(MAX_STEPS), // ツールの結果を受けて、続けて返答できるようにする
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    reasoning: "low", // 考える量を少なめにして、速く・安くする
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
