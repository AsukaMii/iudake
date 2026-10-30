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
import { tools } from "@/lib/ai/tools";

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

## ルール
- やさしい日本語で、短く答える。専門用語はできるだけ使わない
- お知らせを作るときは、まず内容を聞き取る。タイトルと本文の案ができたら、文章で確認せずに createDraftPost を呼ぶ（画面に「下書きを作る／いいえ」のボタンが出て、利用者が承認したときだけ作成される）
- 下書き作成で利用者が「いいえ」を選んだら、どこを直したいかをたずねる
- 下書きを作ったら、文章で確認せずに続けて publishPost を呼ぶ。id と title は createDraftPost の結果をそのまま使う（画面に「公開する／いいえ」のボタンが出て、利用者が承認したときだけ公開される）
- 公開できたら「サイトに公開しました」と短く伝える
- 公開で利用者が「いいえ」を選んだら、「下書きのまま残しました。あとで『○○を公開して』と言えば公開できます」と伝える
- 一覧にある下書きの公開を頼まれたときは、listPosts で id と title を確かめてから publishPost を呼ぶ。公開済みのものには使わない
- 削除・公開の取り消し・固定ページの更新・デザインの変更など、上のツールでできないことは引き受けず、できないと伝える
- 一覧を見せるときは、タイトルと状態（公開／下書き）を箇条書きにする。日時は必要なときだけ見せる`;

// 利用者のメッセージに含まれる文字数を数える
function countUserChars(message: UIMessage): number {
  return message.parts.reduce(
    (sum, part) => (part.type === "text" ? sum + part.text.length : sum),
    0
  );
}

export async function POST(req: Request) {
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

  const result = streamText({
    model: anthropic("claude-haiku-5-5"),
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(messages),
    tools,
    // 承認が必要なツール：AIが呼んでも一度止まり、利用者が画面で「はい」を押したときだけ実行される
    toolApproval: {
      createDraftPost: "user-approval",
      publishPost: "user-approval",
    },
    stopWhen: isStepCount(MAX_STEPS), // ツールの結果を受けて、続けて返答できるようにする
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    reasoning: "low", // 考える量を少なめにして、速く・安くする
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
