// AIが使えるツールの一覧
// AIができる操作は、ここに登録したものだけに限定する
// 中身はWordPressアダプターの関数を呼ぶだけにして、WordPressの細かい処理はアダプターに任せる

import { tool } from "ai";
import { z } from "zod";
import {
  createDraftPost,
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
