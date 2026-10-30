// AIが使えるツールの一覧
// AIができる操作は、ここに登録したものだけに限定する
// 中身はWordPressアダプターの関数を呼ぶだけにして、WordPressの細かい処理はアダプターに任せる

import { tool } from "ai";
import { z } from "zod";
import {
  createDraftPost,
  editPageText,
  editPostText,
  getPage,
  getPost,
  listPages,
  publishDraftPost,
  removeFeaturedImage,
  setFeaturedImage,
  trashContent,
  unpublishContent,
  listPosts,
} from "@/lib/adapters/wordpress";

// 差し替え方式の修正で受け取る内容（editPage・editPost 共通）
// what：「固定ページ」「お知らせ」など、説明文に入れる呼び方
// getTool：今の本文を取得するツールの名前
function editInputSchema(what: string, getTool: string) {
  return z.object({
    id: z.number().int().positive().describe(`修正する${what}のID`),
    title: z
      .string()
      .min(1)
      .describe(`修正する${what}の今のタイトル（${getTool} の結果と完全に同じ文字）`),
    newTitle: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe("新しいタイトル。タイトルを変えるときだけ書く（変えないときは省略）"),
    edits: z
      .array(
        z.object({
          before: z.string().min(1).max(500).describe("変更前の文字（本文にあるものをそのまま）"),
          after: z.string().max(500).describe("変更後の文字"),
        })
      )
      .max(10)
      .describe("本文の差し替えの一覧（10件まで）。本文を変えないときは空の配列"),
  });
}

// 曜日の呼び方（Date の getUTCDay() の 0〜6 に合わせる）
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export const tools = {
  // 日付の曜日を調べる
  // ※ AIは曜日の計算をよく間違えるので、利用者に曜日を聞かれたときはこれで答えさせる
  getWeekday: tool({
    description:
      "日付の曜日を調べる。利用者に曜日を聞かれたときだけ使う。お知らせなどの修正では使わない。",
    inputSchema: z.object({
      year: z.number().int().min(2000).max(2100).describe("年（例：2026）"),
      month: z.number().int().min(1).max(12).describe("月"),
      day: z.number().int().min(1).max(31).describe("日"),
    }),
    execute: async ({ year, month, day }) => {
      // 時差の影響を受けないように、UTC（世界標準時）で計算する
      const date = new Date(Date.UTC(year, month - 1, day));
      // 2月30日のように、存在しない日付ではないか
      if (date.getUTCMonth() !== month - 1) {
        throw new Error(`${year}年${month}月${day}日は存在しない日付です。`);
      }
      return { date: `${year}年${month}月${day}日`, weekday: WEEKDAYS[date.getUTCDay()] };
    },
  }),

  // 投稿（お知らせ）の一覧を取得する
  listPosts: tool({
    description:
      "サイトのお知らせ（投稿）の一覧を取得する。公開済みと下書きの両方を含む。",
    inputSchema: z.object({}), // 入力なし
    execute: async () => listPosts(),
  }),

  // 固定ページの一覧を取得する
  listPages: tool({
    description:
      "サイトの固定ページ（会社概要など）の一覧を取得する。公開済みと下書きの両方を含む。",
    inputSchema: z.object({}), // 入力なし
    execute: async () => listPages(),
  }),

  // 固定ページ1件の内容（本文）を取得する
  getPage: tool({
    description:
      "固定ページ1件のタイトルと本文を取得する。固定ページを修正する前に、必ずこれで今の本文を確かめること。",
    inputSchema: z.object({
      id: z.number().int().positive().describe("固定ページのID（listPages で確かめる）"),
    }),
    execute: async ({ id }) => getPage(id),
  }),

  // 固定ページのタイトル・文章の一部を差し替える
  // ※ 利用者が画面で承認したときだけ実行される（route.ts の toolApproval で設定）
  editPage: tool({
    description:
      "固定ページのタイトルや文章の一部を差し替える。before には getPage で取得した本文の中にある文字を、そのまま1か所だけに当てはまる長さで書く。HTMLタグや <!-- --> の記号は含めないこと。",
    inputSchema: editInputSchema("固定ページ", "getPage"),
    execute: async (input) => editPageText(input),
  }),

  // お知らせ（投稿）1件の内容（本文）を取得する
  getPost: tool({
    description:
      "お知らせ（投稿）1件のタイトルと本文を取得する。お知らせを修正する前に、必ずこれで今の本文を確かめること。",
    inputSchema: z.object({
      id: z.number().int().positive().describe("お知らせのID（listPosts で確かめる）"),
    }),
    execute: async ({ id }) => getPost(id),
  }),

  // お知らせ（投稿）のタイトル・文章の一部を差し替える
  // ※ 利用者が画面で承認したときだけ実行される（route.ts の toolApproval で設定）
  editPost: tool({
    description:
      "お知らせ（投稿）のタイトルや文章の一部を差し替える。before には getPost で取得した本文の中にある文字を、そのまま1か所だけに当てはまる長さで書く。HTMLタグや <!-- --> の記号は含めないこと。",
    inputSchema: editInputSchema("お知らせ", "getPost"),
    execute: async (input) => editPostText(input),
  }),

  // お知らせを下書きで作成する
  // ※ 下書きなので、サイトにはまだ公開されない
  createDraftPost: tool({
    description:
      "お知らせ（投稿）を下書きとして作成する。必ず利用者にタイトルと本文を確認し、了承を得てから使うこと。",
    inputSchema: z.object({
      title: z
        .string()
        .min(1)
        .max(100)
        .describe("お知らせのタイトル（100文字以内）"),
      content: z
        .string()
        .min(1)
        .max(2000)
        .describe("お知らせの本文。段落は空行で区切る（2000文字以内）"),
    }),
    execute: async ({ title, content }) => createDraftPost({ title, content }),
  }),

  // 下書きのお知らせを公開する
  // ※ 利用者が画面で承認したときだけ実行される（route.ts の toolApproval で設定）
  publishPost: tool({
    description:
      "下書きのお知らせ（投稿）を公開する。id と title は、createDraftPost の結果か listPosts の一覧にあるものをそのまま使うこと。",
    inputSchema: z.object({
      id: z.number().int().positive().describe("公開するお知らせの投稿ID"),
      title: z
        .string()
        .min(1)
        .describe("公開するお知らせのタイトル（一覧にあるものと完全に同じ文字）"),
    }),
    execute: async ({ id, title }) => publishDraftPost({ id, title }),
  }),
  // お知らせ・固定ページを非公開（下書き）に戻す
  // ※ 利用者が画面で承認したときだけ実行される（route.ts の toolApproval で設定）
  unpublishContent: tool({
    description:
      "公開中のお知らせ・固定ページを非公開（下書き）に戻す。id と title は listPosts / listPages の一覧にあるものをそのまま使うこと。トップページには使えない。",
    inputSchema: z.object({
      kind: z.enum(["post", "page"]).describe("post：お知らせ、page：固定ページ"),
      id: z.number().int().positive().describe("ID"),
      title: z.string().min(1).describe("タイトル（一覧にあるものと完全に同じ文字）"),
    }),
    execute: async (input) => unpublishContent(input),
  }),

  // お知らせをゴミ箱に入れる（完全には削除しない）
  // ※ 利用者が画面で承認したときだけ実行される（route.ts の toolApproval で設定）
  // ※ 固定ページは削除させない（kind は "post" だけ）
  trashContent: tool({
    description:
      "お知らせをゴミ箱に入れる（削除）。完全には削除されず、WordPressの管理画面から元に戻せる。id と title は listPosts の一覧にあるものをそのまま使うこと。固定ページには使えない。",
    inputSchema: z.object({
      kind: z.enum(["post"]).describe("post：お知らせ（固定ページは削除できない）"),
      id: z.number().int().positive().describe("ID"),
      title: z.string().min(1).describe("タイトル（一覧にあるものと完全に同じ文字）"),
    }),
    execute: async (input) => trashContent(input),
  }),
  // お知らせのアイキャッチ画像（代表の写真）を設定する・差し替える
  // ※ 利用者が画面で承認したときだけ実行される（route.ts の toolApproval で設定）
  setFeaturedImage: tool({
    description:
      "お知らせのアイキャッチ画像（代表の写真）を設定する。すでにあれば差し替える。mediaId には、この会話で利用者が添付した写真の画像IDだけを使う。altText は、利用者に聞いた写真の説明を短くまとめたもの。",
    inputSchema: z.object({
      postId: z.number().int().positive().describe("お知らせのID（listPosts で確かめる）"),
      postTitle: z.string().min(1).describe("お知らせのタイトル（一覧にあるものと完全に同じ文字）"),
      mediaId: z.number().int().positive().describe("利用者が添付した写真の画像ID"),
      altText: z
        .string()
        .min(1)
        .max(150)
        .describe("代替テキスト。写真に何が写っているかの短い説明（例：作業着のスタッフ3人が事務所の前に並んでいる）"),
    }),
    execute: async (input) => setFeaturedImage(input),
  }),

  // お知らせのアイキャッチ画像を外す（画像はメディアライブラリに残る）
  // ※ 利用者が画面で承認したときだけ実行される（route.ts の toolApproval で設定）
  removeFeaturedImage: tool({
    description:
      "お知らせのアイキャッチ画像（代表の写真）を外す。画像はメディアライブラリに残る。",
    inputSchema: z.object({
      postId: z.number().int().positive().describe("お知らせのID（listPosts で確かめる）"),
      postTitle: z.string().min(1).describe("お知らせのタイトル（一覧にあるものと完全に同じ文字）"),
    }),
    execute: async (input) => removeFeaturedImage(input),
  }),
};
