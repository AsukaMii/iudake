// AIが使えるツールの一覧
// AIができる操作は、ここに登録したものだけに限定する
// 中身はWordPressアダプターの関数を呼ぶだけにして、WordPressの細かい処理はアダプターに任せる

import { tool } from "ai";
import { z } from "zod";
import {
  createDraftPost,
  editPageText,
  getPage,
  listPages,
  publishDraftPost,
  listPosts,
} from "@/lib/adapters/wordpress";

export const tools = {
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

  // 固定ページの文章の一部を差し替える
  // ※ 利用者が画面で承認したときだけ実行される（route.ts の toolApproval で設定）
  editPage: tool({
    description:
      "固定ページの文章の一部を差し替える。before には getPage で取得した本文の中にある文字を、そのまま1か所だけに当てはまる長さで書く。HTMLタグや <!-- --> の記号は含めないこと。",
    inputSchema: z.object({
      id: z.number().int().positive().describe("修正する固定ページのID"),
      title: z
        .string()
        .min(1)
        .describe("修正する固定ページのタイトル（getPage の結果と完全に同じ文字）"),
      edits: z
        .array(
          z.object({
            before: z.string().min(1).max(500).describe("変更前の文字（本文にあるものをそのまま）"),
            after: z.string().max(500).describe("変更後の文字"),
          })
        )
        .min(1)
        .max(10)
        .describe("差し替えの一覧（10件まで）"),
    }),
    execute: async ({ id, title, edits }) => editPageText({ id, title, edits }),
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
};
